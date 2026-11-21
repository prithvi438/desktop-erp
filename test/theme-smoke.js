'use strict';
const {app,BrowserWindow}=require('electron'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const out=fs.mkdtempSync(path.join(os.tmpdir(),'desktop-erp-report-directory-'));process.env.DESKTOP_ERP_DATA_DIR=out;require('../main');
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
  await js("localStorage.setItem('desktop-erp-appearance','light');location.reload()");await sleep(1100);
  assert.equal(await js('document.documentElement.dataset.theme'),'light');
  fs.writeFileSync(path.join(out,'light-dashboard.png'),(await page.capturePage()).toPNG());
  await press('l',['control','shift']);assert.equal(await js('document.documentElement.dataset.theme'),'dark');
  fs.writeFileSync(path.join(out,'dark-dashboard.png'),(await page.capturePage()).toPNG());
  await js('location.reload()');await sleep(1100);assert.equal(await js('document.documentElement.dataset.theme'),'dark');
  await press('k',['control']);await page.insertText('Reports');await press('Enter');
  fs.writeFileSync(path.join(out,'dark-reports.png'),(await page.capturePage()).toPNG());
  await press('Down');await press('Enter');await sleep(150);
  fs.writeFileSync(path.join(out,'dark-statement.png'),(await page.capturePage()).toPNG());
  await js("window.testModal=import('./ui.js').then(u=>u.ask('Theme keyboard check','Draft text'));void 0");await sleep(100);
  await press('l',['control','shift']);assert.equal(await js('document.documentElement.dataset.theme'),'light');assert.equal(await js('document.activeElement.value'),'Draft text');await press('Escape');
  await press('l',['control','shift']);await press('h',['control']);
  await js("(async()=>{const {push}=await import('./router.js');const {ledgerForm}=await import('./ledgers.js');await push(ledgerForm(null,'Sundry Creditors'));})()");
  await sleep(250);fs.writeFileSync(path.join(out,'dark-ledger.png'),(await page.capturePage()).toPNG());
  await js("import('./router.js').then(r=>r.goHome())");await press('k',['control']);await page.insertText('Masters');await press('Enter');await sleep(250);fs.writeFileSync(path.join(out,'dark-masters.png'),(await page.capturePage()).toPNG());
  assert.ok(await js("document.querySelector('#hints').textContent.includes('Ctrl+Shift+L')"));
  await js("document.querySelector('#theme-toggle').focus()");await press('Enter');assert.equal(await js('document.documentElement.dataset.theme'),'light');
  console.log('THEME SMOKE OK: shortcut, persisted preference, modal focus preservation, header button and dark reports/forms. '+out);app.exit(0);
 }catch(error){console.error(error.stack);fs.writeFileSync(path.join(out,'failure.png'),(await page.capturePage()).toPNG());console.error(out);app.exit(1);}
});
