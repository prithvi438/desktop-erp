'use strict';
const { app, BrowserWindow, ipcMain, Menu, safeStorage, dialog } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { BooksError } = require('./src/books');
const { openDesktopBooks } = require('./src/desktop-books');
const { createSync } = require('./src/sync');

const AUTO_SYNC_MS = 60000;

// Keep development and installed builds on the same existing books profile.
app.setPath('userData', path.join(app.getPath('appData'), 'speedoone-pos'));
// Claim the profile before Chromium opens its caches or PostgreSQL is touched.
if(process.env.SPEEDOONE_DATA_DIR){
  fs.mkdirSync(process.env.SPEEDOONE_DATA_DIR,{recursive:true});
  app.setPath('userData',path.resolve(process.env.SPEEDOONE_DATA_DIR));
}
if(!app.requestSingleInstanceLock())app.exit(0);
let mainWindow;
app.on('second-instance',()=>{
  if(!mainWindow||mainWindow.isDestroyed())return;
  if(mainWindow.isMinimized())mainWindow.restore();
  mainWindow.show();mainWindow.focus();
});

let books;
let autoSync;
let postgres;
let quitting=false;
let stopping;
function shutdown(){
  if(stopping)return stopping;
  clearInterval(autoSync);books?.close();books=null;
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
    title: 'Speedo One Books',
    icon: path.join(__dirname, 'build', 'icon.png'),
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

// The key that lets this computer sync is a secret. It is encrypted by the operating
// system (DPAPI on Windows, Keychain on macOS) and kept beside the books, never in them.
function keyStore(file) {
  return {
    get() {
      try {
        return safeStorage.decryptString(fs.readFileSync(file));
      } catch {
        return '';
      }
    },
    set(value) {
      if (!value) return fs.rmSync(file, { force: true });
      if (!safeStorage.isEncryptionAvailable()) throw new BooksError('This computer cannot store the sync key securely, so sync cannot be set up here.');
      fs.writeFileSync(file, safeStorage.encryptString(value), { mode: 0o600 });
    },
  };
}

app.whenReady().then(async () => {
  // No application menu: it would claim Alt and the function keys the screens use.
  Menu.setApplicationMenu(null);

  const dataDir = process.env.SPEEDOONE_DATA_DIR || app.getPath('userData');
  if(!process.env.SPEEDOONE_PG_URL){
    if(!await safeStorage.isAsyncEncryptionAvailable())throw Error('Windows secure credential storage is unavailable. PostgreSQL cannot be started securely.');
    postgres=await require('./src/local-postgres').startLocalPostgres(dataDir,{encrypt:value=>safeStorage.encryptStringAsync(value),decrypt:async value=>(await safeStorage.decryptStringAsync(value)).result});
    process.env.SPEEDOONE_PG_URL=postgres.connectionString;
  }
  const {companyWorkspace,fiscal}=require('./src/company-workspace');
  const workspace=companyWorkspace(dataDir,openDesktopBooks);
  books = workspace.books;
  postgres?.takeOwnership();
  let keys=keyStore(path.join(workspace.directory,'sync.key'));
  const makeSync=()=>createSync({support:books.support,keyStore:keys,version:app.getVersion()});
  let sync = makeSync();

  let fileBusy=0;
  const checkSwitch=()=>{if(fileBusy||sync.api.status().busy)throw new BooksError('Wait for the current file operation or sync to finish before changing company or year.');};
  ipcMain.handle('books', (_event, method, args) => {
    if(quitting||!books)return {ok:false,error:'The application is closing.'};
    const years=fiscal(books.api,books.database);
    const methods={...books.api,...years,companyList:()=>workspace.list(),createCompany:values=>{checkSwitch();return workspace.create(values);},selectCompany:values=>{checkSwitch();workspace.select(values);books=workspace.books;keys=keyStore(path.join(workspace.directory,'sync.key'));sync=makeSync();return workspace.list();},selectFinancialYear:values=>{checkSwitch();return years.selectFinancialYear(values);}};
    if(['saveVoucher','saveInvoice','settleReferences'].includes(method)){const original=methods[method];methods[method]=values=>{const year=years.financialYearState().active;if(values.date&&(values.date<year.from||values.date>year.to))throw new BooksError(`Voucher date must be within selected financial year ${year.name}. Switch financial year to enter this date.`);return original(values);};}
    return answer(methods,method,args);
  });
  ipcMain.handle('sync', (_event, method, args) => quitting||!books?{ok:false,error:'The application is closing.'}:answer(sync.api, method, args));
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
      const result=await dialog.showSaveDialog(BrowserWindow.fromWebContents(event.sender),{title:'Export report',defaultPath:`SpeedoOne-report-${new Date().toISOString().slice(0,10)}.csv`,filters:[{name:'CSV spreadsheet',extensions:['csv']}]});
      if(result.canceled||!result.filePath)return {saved:false};
      const target=/\.csv$/i.test(result.filePath)?result.filePath:`${result.filePath}.csv`;
      fs.writeFileSync(target,csv,'utf8');return {saved:true,file:target};
    },
    async backup(){
      const result=await dialog.showSaveDialog(BrowserWindow.fromWebContents(event.sender),{title:'Back up PostgreSQL books',defaultPath:`SpeedoOne-${new Date().toISOString().slice(0,10)}.speedobook`,filters:[{name:'Speedo One books backup',extensions:['speedobook']}]});
      if(result.canceled||!result.filePath)return {saved:false};
      if(path.resolve(result.filePath).toLowerCase()===path.resolve(dataDir,'books.db').toLowerCase())throw new BooksError('Choose a backup location outside the current books file.');
      return books.backup(result.filePath);
    },
    async restore(){
      if(sync.api.status().busy)throw new BooksError('Wait for sync to finish before restoring a backup.');
      const result=await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender),{title:'Choose a Speedo One books backup',properties:['openFile'],filters:[{name:'Speedo One books backup',extensions:['speedobook']}]});
      if(result.canceled||!result.filePaths.length)return {restored:false};
      const source=result.filePaths[0],backup=require('./src/postgres-backup');
      let info;try{info=backup.inspect(source,books.schemaVersion);}catch(error){throw new BooksError(`Cannot restore this backup: ${error.message}`);}
      const choice=await dialog.showMessageBox(BrowserWindow.fromWebContents(event.sender),{type:'warning',buttons:['Cancel','Restore backup'],defaultId:0,cancelId:0,title:'Restore local books',message:`Replace current local books with ${info.company} (${info.vouchers} vouchers)?`,detail:'A safety backup of current books will be kept. Cloud sync will be unlinked. The app will return to the dashboard.'});
      if(choice.response!==1)return {restored:false};
      if(sync.api.status().busy)throw new BooksError('Sync started while the dialog was open. Wait for it to finish before restoring.');
      const safety=path.join(workspace.directory,`before-restore-${Date.now()}.speedobook`);
      books.backup(safety);
      backup.restore(books.database,source,books.schemaVersion);
      keys.set('');books=workspace.reopen();sync=makeSync();
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

  // With automatic sync on, a round runs every minute. cycle() records problems itself.
  autoSync = setInterval(() => { if (sync.api.status().auto) sync.cycle(); }, AUTO_SYNC_MS);

  createWindow();
}).catch(async error=>{
  console.error('Database startup failed:',error.message);
  dialog.showErrorBox('Could not open PostgreSQL books',`${error.message}\n\nExisting books have not been deleted. Close other Speedo One windows and try again.`);
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
