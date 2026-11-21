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
  assert.equal(await js("[...document.querySelectorAll('#nav strong')].some(n=>/Companies|Outstandings/.test(n.textContent))"),false);
  assert.ok(await js("!!document.querySelector('.dashboard-company-panel')"));
  fs.writeFileSync(path.join(out,'dashboard.png'),(await page.capturePage()).toPNG());
  await press('F3');assert.equal(await title(),'Companies & financial years');assert.equal(await js("document.querySelectorAll('.company-actions button').length"),3);
  fs.writeFileSync(path.join(out,'companies.png'),(await page.capturePage()).toPNG());await press('Escape');
  await press('k',['control']);await page.insertText('Reports');await press('Enter');
  assert.equal(await js("document.querySelectorAll('.report-category').length"),7);
  await press('Down');await press('Right');assert.equal(await js("document.activeElement.closest('.report-category').querySelector('h3').textContent"),'Account books');await press('Tab');
  await press('End');assert.ok(await js("document.querySelector('.report-category-grid').scrollTop>0"));
  await press('Enter');assert.equal(await title(),'Financial years');await press('Escape');
  assert.equal(await title(),'Reports');assert.ok(await js("(()=>{const b=document.querySelector('.report-link.on').getBoundingClientRect(),g=document.querySelector('.report-category-grid').getBoundingClientRect();return b.top>=g.top&&b.bottom<=g.bottom+1})()"));
  await press('Home');assert.equal(await js("document.querySelector('.report-category-grid').scrollTop"),0);
  fs.writeFileSync(path.join(out,'report-categories.png'),(await page.capturePage()).toPNG());
  await find('Outstanding');assert.equal(await title(),'Outstanding & credit management');await press('Escape');await press('Escape');
  await press('k',['control']);await page.insertText('Registers');await press('Enter');
  assert.equal(await js("getComputedStyle(document.querySelector('.registers-workspace')).display"),'grid');
  assert.equal(await js("document.querySelector('.daybook-filters').textContent.includes('F2')"),false);
  assert.ok(await js("document.querySelector('#hints').textContent.includes('Alt+F2')"));
  fs.writeFileSync(path.join(out,'expanded-registers.png'),(await page.capturePage()).toPNG());
  console.log('WORKSPACE LAYOUT SMOKE OK: company F3, sidebar, grouped reports, arrow/Tab navigation, scroll restoration, outstandings, register footer. '+out);app.exit(0);
 }catch(error){console.error(error.stack);console.error(await js("import('./app.js').catch(e=>e.stack)"));fs.writeFileSync(path.join(out,'failure.png'),(await page.capturePage()).toPNG());console.error(out);app.exit(1);}
});
