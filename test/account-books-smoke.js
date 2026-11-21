'use strict';
const {app,BrowserWindow}=require('electron'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const out=fs.mkdtempSync(path.join(os.tmpdir(),'desktop-erp-account-books-'));process.env.DESKTOP_ERP_DATA_DIR=out;require('../main');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
app.whenReady().then(async()=>{
 await require('./wait-for-window')();const win=BrowserWindow.getAllWindows()[0],page=win.webContents;win.setSize(1200,760);win.show();win.focus();page.focus();
 const js=code=>page.executeJavaScript(code),api=(method,args={})=>js(`window.books.call(${JSON.stringify(method)},${JSON.stringify(args)})`);
 async function press(keyCode,modifiers=[]){page.sendInputEvent({type:'keyDown',keyCode,modifiers});page.sendInputEvent({type:'keyUp',keyCode,modifiers});await sleep(170);}
 async function type(text){await page.insertText(text);await sleep(70);}
 async function shot(name){fs.writeFileSync(path.join(out,name+'.png'),(await page.capturePage()).toPNG());}
 async function fits(){for(const height of [640,760]){win.setSize(1200,height);await sleep(120);assert.deepEqual(await js(`[...document.querySelectorAll('#nav,.account-books,.account-book-body')].filter(el=>el.scrollWidth>el.clientWidth+2||el.scrollHeight>el.clientHeight+2).map(el=>el.className)`),[]);} }
 try{
  const party=(await api('saveLedger',{name:'Ledger Buyer',groupId:(await api('groups')).find(g=>g.name==='Sundry Debtors').id,opening:1000})).id;
  const item=(await api('saveItem',{name:'Rice',unit:'KG'})).id;
  await api('saveInvoice',{type:'Stock In',date:'2026-10-31',items:[{itemId:item,qty:10000,rate:5000}]});
  await api('saveInvoice',{type:'Sales',date:'2026-11-02',partyId:party,items:[{itemId:item,qty:2000,rate:10000}]});
  await press('k',['control']);await type('Ledger Register');await press('Enter');await press('Enter');await type('Ledger Buyer');await press('Enter');
  assert.equal(await js('document.querySelector(".account-book-heading h2").textContent'),'Ledger Buyer');
  assert.match(await js('document.querySelector(".account-entries thead").textContent'),/DebitCreditBalance/);
  assert.match(await js('document.querySelector(".account-totals").textContent'),/210.00 Dr/);await fits();await shot('account');
  await press('Enter');assert.match(await js('document.querySelector("#title").textContent'),/Sales invoice/);if(await js('!!document.querySelector(".choice-panel:not([hidden])")'))await press('Escape');await press('Escape');
  await press('Escape');await js(`[...document.querySelectorAll('.register-rail button')].find(button=>button.textContent==='Stock Register').click()`);await sleep(180);await type('Rice');await press('Enter');assert.equal(await js('document.querySelector(".account-book-heading h2").textContent'),'Rice');
  await press('F2',['alt']);await press('a',['control']);await type('01-11-2026');await press('r',['control']);await press('l',['alt']);
  assert.match(await js('document.querySelector(".account-totals").textContent'),/Opening balance10 KG/);assert.match(await js('document.querySelector(".account-totals").textContent'),/Closing balance8 KG/);
  assert.match(await js('document.querySelector(".account-entries tbody").textContent'),/Sales/);await fits();await shot('stock');
  await press('Enter');assert.match(await js('document.querySelector("#title").textContent'),/Sales invoice/);await press('Escape');
  console.log('ACCOUNT BOOKS SMOKE OK. Screenshots: '+out);app.exit(0);
 }catch(error){await shot('failure');console.error(error.stack,'Screenshots: '+out);app.exit(1);}
});
