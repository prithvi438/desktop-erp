'use strict';
const { app, BrowserWindow, ipcMain, Menu, safeStorage, dialog } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { BooksError } = require('./src/books');
const { openDesktopBooks } = require('./src/desktop-books');

const {profileDirectory}=require('./src/legacy-compat');

// Keep development and installed builds on the same existing books profile.
app.setPath('userData', profileDirectory(app.getPath('appData')));
// Claim the profile before Chromium opens its caches or PostgreSQL is touched.
if(process.env.DESKTOP_ERP_DATA_DIR){
  fs.mkdirSync(process.env.DESKTOP_ERP_DATA_DIR,{recursive:true});
  app.setPath('userData',path.resolve(process.env.DESKTOP_ERP_DATA_DIR));
}
if(!app.requestSingleInstanceLock())app.exit(0);
let mainWindow;
app.on('second-instance',()=>{
  if(!mainWindow||mainWindow.isDestroyed())return;
  if(mainWindow.isMinimized())mainWindow.restore();
  mainWindow.show();mainWindow.focus();
});

let books;
let postgres;
let quitting=false;
let stopping;
function shutdown(){
  if(stopping)return stopping;
  books?.close();books=null;
  stopping=Promise.resolve(postgres?.stop());return stopping;
}
module.exports={shutdown};

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 860,
    minWidth: 1100,
    minHeight: 640,
    show: false,
    backgroundColor: '#f3f6fa',
    title: 'Desktop ERP',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  mainWindow=win;
  win.once('ready-to-show', () => win.show());
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  return win;
}

// Runs one request from the window against a set of allowed methods.
// Only messages meant for the user cross over; anything else is logged here.
async function answer(methods, method, args) {
  if (!Object.hasOwn(methods, method)) return { ok: false, error: `Unknown request: ${method}` };
  try {
    return { ok: true, value: await methods[method](args ?? {}) };
  } catch (error) {
    if (!(error instanceof BooksError)) console.error(error);
    return { ok: false, error: error instanceof BooksError ? error.message : 'Something went wrong. The change was not saved.' };
  }
}

app.whenReady().then(async () => {
  // No application menu: it would claim Alt and the function keys the screens use.
  Menu.setApplicationMenu(null);

  const dataDir = process.env.DESKTOP_ERP_DATA_DIR || app.getPath('userData');
  if(!process.env.DESKTOP_ERP_PG_URL){
    if(!await safeStorage.isAsyncEncryptionAvailable())throw Error('Windows secure credential storage is unavailable. PostgreSQL cannot be started securely.');
    postgres=await require('./src/local-postgres').startLocalPostgres(dataDir,{encrypt:value=>safeStorage.encryptStringAsync(value),decrypt:async value=>(await safeStorage.decryptStringAsync(value)).result});
    process.env.DESKTOP_ERP_PG_URL=postgres.connectionString;
  }
  const {companyWorkspace,fiscal}=require('./src/company-workspace');
  const workspace=companyWorkspace(dataDir,openDesktopBooks);
  books = workspace.books;
  postgres?.takeOwnership();

  let fileBusy=0;
  const checkSwitch=()=>{if(fileBusy)throw new BooksError('Wait for the current file operation to finish before changing company or year.');};
  ipcMain.handle('books', (_event, method, args) => {
    if(quitting||!books)return {ok:false,error:'The application is closing.'};
    const years=fiscal(books.api,books.database);
    const methods={...books.api,...years,companyList:()=>workspace.list(),createCompany:values=>{checkSwitch();return workspace.create(values);},selectCompany:values=>{checkSwitch();workspace.select(values);books=workspace.books;return workspace.list();},selectFinancialYear:values=>{checkSwitch();return years.selectFinancialYear(values);}};
    if(['saveVoucher','saveInvoice','settleReferences'].includes(method)){const original=methods[method];methods[method]=values=>{const year=years.financialYearState().active;if(values.date&&(values.date<year.from||values.date>year.to))throw new BooksError(`Voucher date must be within selected financial year ${year.name}. Switch financial year to enter this date.`);return original(values);};}
    return answer(methods,method,args);
  });
  ipcMain.handle('files', async (event, method, args) => {fileBusy++;try{return await answer({
    async exportReport(data){
      const exporter=require('./src/report-export');exporter.validate(data);
      if(!['xlsx','pdf'].includes(data.format))throw new BooksError('Choose Excel or PDF');
      const extension=data.format,name=String(data.title||'Report').replace(/[<>:"/\\|?*]/g,'-').slice(0,100);
      const result=await dialog.showSaveDialog(BrowserWindow.fromWebContents(event.sender),{title:'Export report',defaultPath:name+'.'+extension,filters:[{name:extension==='xlsx'?'Excel workbook':'PDF document',extensions:[extension]}]});
      if(result.canceled||!result.filePath)return {saved:false};
      const target=result.filePath.toLowerCase().endsWith('.'+extension)?result.filePath:result.filePath+'.'+extension;
      const payload={...data,company:books.api.company()};
      const bytes=extension==='xlsx'?await exporter.workbook(payload):await exporter.pdf(payload,BrowserWindow);
      await fs.promises.writeFile(target,bytes);return {saved:true,file:target};
    },
    async exportTable({columns,rows}){
      let csv;try{csv=require('./src/csv').tableCsv({columns,rows});}catch(error){throw new BooksError(error.message);}
      const result=await dialog.showSaveDialog(BrowserWindow.fromWebContents(event.sender),{title:'Export report',defaultPath:`DesktopERP-report-${new Date().toISOString().slice(0,10)}.csv`,filters:[{name:'CSV spreadsheet',extensions:['csv']}]});
      if(result.canceled||!result.filePath)return {saved:false};
      const target=/\.csv$/i.test(result.filePath)?result.filePath:`${result.filePath}.csv`;
      fs.writeFileSync(target,csv,'utf8');return {saved:true,file:target};
    },
    async backup(){
      const result=await dialog.showSaveDialog(BrowserWindow.fromWebContents(event.sender),{title:'Back up PostgreSQL books',defaultPath:`DesktopERP-${new Date().toISOString().slice(0,10)}.speedobook`,filters:[{name:'Desktop ERP books backup',extensions:['speedobook']}]});
      if(result.canceled||!result.filePath)return {saved:false};
      if(path.resolve(result.filePath).toLowerCase()===path.resolve(dataDir,'books.db').toLowerCase())throw new BooksError('Choose a backup location outside the current books file.');
      return books.backup(result.filePath);
    },
    async restore(){
      const result=await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender),{title:'Choose a Desktop ERP books backup',properties:['openFile'],filters:[{name:'Desktop ERP books backup',extensions:['speedobook']}]});
      if(result.canceled||!result.filePaths.length)return {restored:false};
      const source=result.filePaths[0],backup=require('./src/postgres-backup');
      let info;try{info=backup.inspect(source,books.schemaVersion);}catch(error){throw new BooksError(`Cannot restore this backup: ${error.message}`);}
      const choice=await dialog.showMessageBox(BrowserWindow.fromWebContents(event.sender),{type:'warning',buttons:['Cancel','Restore backup'],defaultId:0,cancelId:0,title:'Restore local books',message:`Replace current local books with ${info.company} (${info.vouchers} vouchers)?`,detail:'A safety backup of current books will be kept. The app will return to the dashboard.'});
      if(choice.response!==1)return {restored:false};
      const safety=path.join(workspace.directory,`before-restore-${Date.now()}.speedobook`);
      books.backup(safety);
      backup.restore(books.database,source,books.schemaVersion);
      fs.rmSync(path.join(workspace.directory,'sync.key'),{force:true});books=workspace.reopen();
      return {restored:true,safetyBackup:safety};
    },
    async pick() {
      const result = await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender), {
        title:'Attach images or PDF to local books', properties:['openFile','multiSelections'],
        filters:[{ name:'Images and PDF',extensions:['png','jpg','jpeg','webp','pdf'] }],
      });
      if (result.canceled) return [];
      if (result.filePaths.length > 10) throw new BooksError('Choose up to 10 files');
      const added = [];
      try {
        for (const file of result.filePaths) {
          if (fs.statSync(file).size > 10*1024*1024) throw new BooksError('Each file must be 10 MB or smaller');
          added.push(books.files.importFile({ name:path.basename(file),bytes:fs.readFileSync(file) }));
        }
        return added;
      } catch (error) { books.api.discardFiles({ ids:added.map(f => f.id) }); throw error; }
    },
    async export({ id }) {
      const file = books.files.fileBytes(id);
      const result = await dialog.showSaveDialog(BrowserWindow.fromWebContents(event.sender), { title:'Save attachment copy',defaultPath:file.name });
      if (!result.canceled && result.filePath) fs.writeFileSync(result.filePath,file.bytes);
      return { saved:!result.canceled };
    },
  },method,args);}finally{fileBusy--;}});
  ipcMain.on('quit', () => app.quit());


  createWindow();
}).catch(async error=>{
  console.error('Database startup failed:',error.message);
  dialog.showErrorBox('Could not open PostgreSQL books',`${error.message}\n\nExisting books have not been deleted. Close other Desktop ERP windows and try again.`);
  app.quit();
});

app.on('window-all-closed', () => {
  app.quit();
});
app.on('before-quit',event=>{
  if(quitting)return;
  event.preventDefault();quitting=true;
  shutdown().catch(error=>console.error('PostgreSQL shutdown:',error.message)).finally(()=>app.quit());
});
