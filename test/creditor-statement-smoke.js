'use strict';
const {app,BrowserWindow}=require('electron'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
process.env.SPEEDOONE_DATA_DIR=fs.mkdtempSync(path.join(os.tmpdir(),'speedoone-creditor-statement-'));require('../main');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
app.whenReady().then(async()=>{
 await require('./wait-for-window')();const win=BrowserWindow.getAllWindows()[0],page=win.webContents;win.show();win.focus();page.focus();
 const js=code=>page.executeJavaScript(code),api=(method,args={})=>js(`window.books.call(${JSON.stringify(method)},${JSON.stringify(args)})`);
 async function press(keyCode,modifiers=[]){page.sendInputEvent({type:'keyDown',keyCode,modifiers});page.sendInputEvent({type:'keyUp',keyCode,modifiers});await sleep(180);}
 async function type(text){await page.insertText(text);await sleep(70);}
 const status=()=>js('document.querySelector(".account-status").textContent');
 const totals=()=>js('document.querySelector(".account-totals").textContent');
 try{
  const creditor=(await api('saveLedger',{name:'Statement Supplier',groupId:(await api('groups')).find(g=>g.name==='Sundry Creditors').id,opening:-10000})).id;
  const cash=(await api('ledgers')).find(l=>l.name==='Cash').id;
  for(const date of ['2000-01-01','2099-01-01'])await api('saveVoucher',{type:'Payment',date,narration:date==='2000-01-01'?'Earlier payment':'Later payment',lines:[{ledgerId:creditor,amount:2000},{ledgerId:cash,amount:-2000}]});
  await press('k',['control']);await type('Masters');await press('Enter');await press('s');await type('tatement Supplier');await press('Enter');await press('F1');
  assert.equal(await js('document.querySelector("#title").textContent'),'Ledger account');
  assert.equal(await js('document.querySelector(".account-book-heading h2").textContent'),'Statement Supplier');
  assert.match(await status(),/2 entries.*All dates/);
  assert.match(await totals(),/Opening balance100.00 Cr.*Total debit40.00.*Closing balance60.00 Cr/);
  assert.match(await js('document.querySelector(".account-entries tbody").textContent'),/Earlier payment.*Later payment/);
  await press('Enter');assert.equal(await js('document.querySelector("#title").textContent'),'Alter voucher: Payment');
  if(await js('!!document.querySelector(".choice-panel:not([hidden])")'))await press('Escape');await press('Escape');
  await press('F3');await type('01-01-2020');await press('r',['control']);
  assert.match(await status(),/1 entries/);assert.match(await totals(),/Opening balance80.00 Cr.*Closing balance60.00 Cr/);
  await press('F3');await press('a',['control']);await press('Backspace');await press('r',['control']);
  assert.match(await status(),/2 entries.*All dates/);
  await js(`(async()=>{const {push}=await import('./router.js');const {accountBooks}=await import('./account-books.js');await push(accountBooks({selectedId:${creditor}}));})()`);
  assert.match(await status(),/2 entries.*All dates/);
  console.log('CREDITOR STATEMENT SMOKE OK: historical and future payments, filters, and both account entry points.');app.exit(0);
 }catch(error){console.error(error.stack);app.exit(1);}
});
