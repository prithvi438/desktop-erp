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
  const groups=await api('groups');await api('saveLedger',{name:'Layout customer',groupId:groups.find(g=>g.name==='Sundry Debtors').id});
  await press('F8');await sleep(300);
  for(const [width,height] of [[1384,850],[1100,700]]){
   win.setSize(width,height);await sleep(300);
   await js("document.querySelector('.invoice-party-main input').focus()");await press('a',['control']);await page.insertText('Layout');await sleep(250);
   assert.equal(await js("getComputedStyle(document.querySelector('.creation-rail')).display"),'none');
   assert.ok(await js("document.querySelector('.invoice-lines-area').clientHeight>=70"));
   assert.ok(await js("(()=>{const a=document.querySelector('.invoice-lines-area').getBoundingClientRect();return [...document.querySelectorAll('.lines th')].filter(e=>!e.hidden).every(e=>{const r=e.getBoundingClientRect();return r.height>=25&&r.top>=a.top&&r.bottom<=a.bottom;});})()"));
   fs.writeFileSync(path.join(out,'picker-'+width+'.png'),(await page.capturePage()).toPNG());await press('Escape');assert.notEqual(await js("getComputedStyle(document.querySelector('.creation-rail')).display"),'none');
  }
  console.log('VOUCHER PICKER LAYOUT OK: visible headers and item area, picker rail replacement and Escape restore. '+out);app.exit(0);
 }catch(error){console.error(error.stack);fs.writeFileSync(path.join(out,'failure.png'),(await page.capturePage()).toPNG());console.error(out);app.exit(1);}
});
