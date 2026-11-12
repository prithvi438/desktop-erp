'use strict';
const {app,BrowserWindow}=require('electron'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const out=fs.mkdtempSync(path.join(os.tmpdir(),'speedoone-report-directory-'));process.env.SPEEDOONE_DATA_DIR=out;require('../main');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
app.whenReady().then(async()=>{
 await require('./wait-for-window')();const win=BrowserWindow.getAllWindows()[0],page=win.webContents;win.show();win.focus();page.focus();
 const js=code=>page.executeJavaScript(code),api=(method,args={})=>js(`window.books.call(${JSON.stringify(method)},${JSON.stringify(args)})`);
 async function press(keyCode,modifiers=[]){page.sendInputEvent({type:'keyDown',keyCode,modifiers});page.sendInputEvent({type:'keyUp',keyCode,modifiers});await sleep(170);}
 async function find(name){await press('l',['control']);await page.insertText(name);await press('Enter');}
 const title=()=>js('document.querySelector("#title").textContent');
 async function drillIntoCustomer(){
  const reportTitle=await title();
  await js(`[...document.querySelectorAll('.expanded-report tbody tr')].find(row=>row.textContent.includes('Report Customer')).click()`);await press('Enter');
  assert.equal(await title(),'Ledger account');
  assert.equal(await js('document.querySelector(".account-book-heading h2").textContent'),'Report Customer');
  assert.equal(await js('!!document.querySelector(".account-picker,.account-tabs")'),false);
  assert.match(await js('document.querySelector(".account-totals").textContent'),/Closing balance100.00 Cr/);
  await press('Enter');assert.equal(await title(),'Alter voucher: Receipt');
  if(await js('!!document.querySelector(".choice-panel:not([hidden])")'))await press('Escape');await press('Escape');
  assert.equal(await title(),'Ledger account');await press('Escape');assert.equal(await title(),reportTitle);
  assert.match(await js('document.querySelector(".expanded-report tr.on").textContent'),/Report Customer/);
 }


 try{
  await api('setCompany',{name:'A Very Long Company Name For Multiple Branches And Trading Operations Private Limited'});await js('location.reload()');await sleep(1000);
  assert.equal(await js('!!document.querySelector("#side img")'),false);assert.equal(await js('document.querySelector("#sidebar-company").classList.contains("long-name")'),true);
  assert.ok(await js('document.querySelector("#sidebar-company").clientHeight>30'));
  fs.writeFileSync(path.join(out,'company-sidebar.png'),(await page.capturePage()).toPNG());
  await press('k',['control']);await page.insertText('Registers');await press('Enter');await press('F2');
  for(const digit of '12112026')await page.insertText(digit);
  assert.equal(await js('document.activeElement.value'),'12-11-2026');
  await press('Up');assert.equal(await js('document.activeElement.value'),'11-11-2026');await press('Down');assert.equal(await js('document.activeElement.value'),'12-11-2026');await press('Enter');
  await press('F2',['alt']);await press('a',['control']);await page.insertText('01102026');assert.equal(await js('document.activeElement.value'),'01-10-2026');
  await press('Tab');await press('a',['control']);await page.insertText('30112026');assert.equal(await js('document.activeElement.value'),'30-11-2026');
  await js("document.activeElement.setSelectionRange(3,5)");await page.insertText('12');assert.equal(await js('document.activeElement.value'),'30-12-2026');
  await press('a',['control']);await press('Backspace');await page.insertText('12');assert.equal(await js('document.activeElement.value'),'12-');await press('Backspace');assert.equal(await js('document.activeElement.value'),'12');await press('Backspace');assert.equal(await js('document.activeElement.value'),'1');
  await js("window.datePromise=import('./ui.js').then(u=>u.ask('Test date (dd-mm-yyyy)'));void 0");await sleep(100);await page.insertText('29022024');assert.equal(await js('document.activeElement.value'),'29-02-2024');
  await press('Down');assert.equal(await js('document.activeElement.value'),'01-03-2024');await press('Up');assert.equal(await js('document.activeElement.value'),'29-02-2024');
  await js("document.activeElement.value='01-01-2026'");await press('Up');assert.equal(await js('document.activeElement.value'),'31-12-2025');await press('Down');assert.equal(await js('document.activeElement.value'),'01-01-2026');
  await js("document.activeElement.value='31-02-2026'");await press('Down');assert.equal(await js('document.activeElement.value'),'31-02-2026');
  assert.equal(await js("document.activeElement.classList.contains('date-entry')"),true);
  await js("document.activeElement.value='29-02-2024'");await press('Enter');assert.equal(await js('window.datePromise'),'29-02-2024');
  assert.deepEqual(await js("import('./ui.js').then(u=>['12112026','29-02-2025','6/11/26','12-'].map(u.parseDate))"),['2026-11-12',null,'2026-11-06','2026-11-12']);
  assert.equal(await js("import('./ui.js').then(u=>u.h('input',{'aria-label':'Phone number'}).dataset.dateInput||'')"),'');
  console.log('DATE INPUT SMOKE OK: digits, separators, selection edits, deletion, paste, dialogs, invalid dates and long company names. '+out);app.exit(0);
 }catch(error){console.error(error.stack);fs.writeFileSync(path.join(out,'failure.png'),(await page.capturePage()).toPNG());console.error(out);app.exit(1);}
});
