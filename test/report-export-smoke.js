'use strict';
const {app,BrowserWindow,dialog}=require('electron'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const out=fs.mkdtempSync(path.join(os.tmpdir(),'speedoone-report-exports-'));process.env.SPEEDOONE_DATA_DIR=out;
let exported=[];dialog.showSaveDialog=async(_win,options)=>{const filePath=path.join(out,`${exported.length+1}-`+options.defaultPath);exported.push(filePath);return {canceled:false,filePath};};require('../main');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
app.whenReady().then(async()=>{await require('./wait-for-window')();const win=BrowserWindow.getAllWindows()[0],page=win.webContents;win.show();win.focus();page.focus();
 const js=code=>page.executeJavaScript(code),api=(name,args={})=>js(`window.books.call(${JSON.stringify(name)},${JSON.stringify(args)})`);
 async function press(keyCode,modifiers=[]){page.sendInputEvent({type:'keyDown',keyCode,modifiers});page.sendInputEvent({type:'keyUp',keyCode,modifiers});await sleep(160);}
 async function waitFile(){for(let i=0;i<100;i++){if(exported.length&&fs.existsSync(exported.at(-1)))return;await sleep(100);}throw Error('Export did not finish');}
 async function open(module,screen){await js(`(async()=>{await (await import('./router.js')).push((await import('./${module}.js')).${screen});})()`);}
 try{
  await api('setCompany',{name:'Bharat Trading & Co',address:'Mumbai, Maharashtra'});
  const groups=await api('groups'),cash=(await api('ledgers')).find(r=>r.name==='Cash');
  const capital=(await api('saveLedger',{name:'Capital',groupId:groups.find(g=>g.name==='Capital Account').id,opening:-100000})).id;
  await api('saveLedger',{...cash,opening:100000});
  for(let n=0;n<45;n++)await api('saveLedger',{name:`Customer ${String(n).padStart(3,'0')}`,groupId:groups.find(g=>g.name==='Sundry Debtors').id});
  const debtor=(await api('ledgers')).find(r=>r.name==='Customer 000').id;
  await api('saveVoucher',{type:'Receipt',date:'2026-11-12',lines:[{ledgerId:cash.id,amount:12345},{ledgerId:debtor,amount:-12345}]});
  await api('saveReportingSettings',{framework:'division1',notes:'Historical cost basis. Amounts presented in INR.'});
  await open('financial-reports',"financialStatement('balanceSheet')");await sleep(200);
  assert.equal(await js('document.querySelector(".financial-heading h1").textContent'),'Bharat Trading & Co');
  assert.match(await js('document.querySelector(".financial-heading p").textContent'),/Comparative/);
  fs.writeFileSync(path.join(out,'balance-sheet.png'),(await page.capturePage()).toPNG());
  await press('e',['alt']);assert.match(await js('document.querySelector(".dialog").textContent'),/Excel workbook/);await press('Enter');await waitFile();
  const ExcelJS=require('exceljs'),book=new ExcelJS.Workbook();await book.xlsx.readFile(exported[0]);assert.equal(book.worksheets[0].getCell('A1').value,'Bharat Trading & Co');assert.ok(book.worksheets[0].rowCount>50);
  await press('e',['alt']);await press('Down');await press('Enter');await waitFile();assert.ok(fs.readFileSync(exported[1]).subarray(0,5).equals(Buffer.from('%PDF-')));
  const pdf=fs.readFileSync(exported[1]).toString('latin1');assert.ok((pdf.match(/\/Type \/Page\b/g)||[]).length>1,'PDF paginates the entire report');
  const model=await api('financialReport',{type:'balanceSheet',asOf:'2026-11-12'});assert.equal(model.rows.find(r=>r.name==='TOTAL ASSETS').amount,model.rows.find(r=>r.name==='TOTAL EQUITY AND LIABILITIES').amount);
  await open('reports','stockSummary()');await press('e',['alt']);await press('Escape');
  await open('daybook','transactionRegister({allDates:true})');await press('e',['alt']);await press('Enter');await waitFile();
  const ledger=(await api('ledgers')).find(r=>r.name==='Customer 000');await open('account-books',`accountBooks({mode:'accounts',selectedId:${ledger.id}})`);await press('e',['alt']);await press('Enter');await waitFile();
  const ledgerBook=new ExcelJS.Workbook();await ledgerBook.xlsx.readFile(exported.at(-1));assert.match(ledgerBook.worksheets[0].getCell('A2').value,/Customer 000/);assert.match(ledgerBook.worksheets[0].getCell('A3').value,/01-04-2026 to/);
  await open('financial-reports','reportingSettings()');assert.equal(await js('document.querySelectorAll("select")[0].options.length'),4);await press('s',['control']);
  console.log('REPORT EXPORT SMOKE OK: framework settings, XLSX numeric workbook, multipage PDF, stock reports, daybook and ledger exports. '+out);app.exit(0);
 }catch(e){console.error(e.stack);fs.writeFileSync(path.join(out,'failure.png'),(await page.capturePage()).toPNG());console.error(out);app.exit(1);}
});
