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
  assert.equal(await js("document.querySelectorAll('.quick-actions').length"),0);
  assert.equal(await js("document.querySelectorAll('.dashboard-company-panel>button').length"),5);
  for(const [key,label] of [['F8','Sales invoice'],['F9','Purchase bill'],['F6','Receipt'],['F5','Payment']]){
   await press(key);assert.equal(await js("document.querySelector('.creation-rail button.active span').textContent"),label);await press('h',['control']);
  }
  await js("document.querySelector('.dashboard-company-panel>button').focus()");await press('Down');assert.match(await js('document.activeElement.textContent'),/Sales invoice/);await press('Enter');assert.equal(await js("document.querySelector('.creation-rail button.active span').textContent"),'Sales invoice');await press('h',['control']);
  await press('k',['control']);await page.insertText('Masters');await press('Enter');assert.ok(await js("document.querySelector('.manage-rail').getBoundingClientRect().width>=200"));
  console.log(await js("JSON.stringify({url:[...document.styleSheets].map(s=>s.href),keyOrder:getComputedStyle(document.querySelector('.manage-rail button kbd')).order,card:getComputedStyle(document.querySelector('.manage-rail')).backgroundImage,rules:[...document.styleSheets].at(-1).cssRules.length})"));fs.writeFileSync(path.join(out,'wide-masters.png'),(await page.capturePage()).toPNG());await press('h',['control']);
  await press('k',['control']);await page.insertText('Reports');await press('Enter');await press('Down');
  assert.equal(await js("getComputedStyle(document.querySelector('.report-link.on')).outlineStyle"),'none');assert.equal(await js("getComputedStyle(document.querySelector('.report-link.on')).backgroundColor"),await js("getComputedStyle(document.documentElement).getPropertyValue('--selection').trim()=== '#7052bc'?'rgb(112, 82, 188)':'rgb(91, 97, 80)'"));
  await press('h',['control']);await press('k',['control']);await page.insertText('Registers');await press('Enter');
  assert.equal(await js("getComputedStyle(document.activeElement).outlineStyle"),'none');
  for(const width of [1100,1384]){win.setSize(width,800);await sleep(200);assert.deepEqual(await js("[...document.querySelectorAll('.registers-workspace,.register-content,.register-rail')].filter(e=>e.scrollWidth>e.clientWidth+1).map(e=>e.className)"),[]);}
  fs.writeFileSync(path.join(out,'registers-fill.png'),(await page.capturePage()).toPNG());
  console.log('WORKSPACE ACTIONS SMOKE OK: dashboard F5/F6/F8/F9, menu arrows, wider Masters, fill highlights and register widths. '+out);app.exit(0);
 }catch(error){console.error(error.stack);fs.writeFileSync(path.join(out,'failure.png'),(await page.capturePage()).toPNG());console.error(out);app.exit(1);}
});
