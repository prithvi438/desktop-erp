'use strict';
const {app,BrowserWindow}=require('electron'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const out=fs.mkdtempSync(path.join(os.tmpdir(),'desktop-erp-ledger-account-'));process.env.DESKTOP_ERP_DATA_DIR=out;require('../main');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
app.whenReady().then(async()=>{
 await require('./wait-for-window')();const win=BrowserWindow.getAllWindows()[0],page=win.webContents;win.setSize(1200,760);win.show();win.focus();page.focus();
 const js=code=>page.executeJavaScript(code),api=(method,args={})=>js(`window.books.call(${JSON.stringify(method)},${JSON.stringify(args)})`);
 async function press(keyCode,modifiers=[]){page.sendInputEvent({type:'keyDown',keyCode,modifiers});page.sendInputEvent({type:'keyUp',keyCode,modifiers});await sleep(160);}
 async function type(text){await page.insertText(text);await sleep(70);}
 const title=()=>js('document.querySelector("#title").textContent');
 try{
  const id=(await api('saveLedger',{name:'Ledger Buyer',groupId:(await api('groups')).find(g=>g.name==='Sundry Debtors').id,opening:1000})).id;
  const cash=(await api('ledgers')).find(row=>row.name==='Cash').id;
  await api('saveVoucher',{type:'Receipt',date:'2026-11-02',narration:'Received payment',lines:[{ledgerId:id,amount:-500},{ledgerId:cash,amount:500}]});
  await press('k',['control']);await type('Masters');await press('Enter');await press('l');await type('edger Buyer');await press('Enter');assert.equal(await title(),'Alter ledger');
  await type('Unsaved buyer name');await press('F1');assert.equal(await title(),'Ledger account');
  assert.equal(await js('!!document.querySelector(".account-picker")'),false);assert.equal(await js('document.querySelector(".account-book-heading h2").textContent'),'Ledger Buyer');
  assert.match(await js('document.querySelector(".account-entries thead").textContent'),/DebitCreditBalance/);
  assert.match(await js('document.querySelector(".account-totals").textContent'),/Closing balance5.00 Dr/);
  for(const height of [640,760]){win.setSize(1200,height);await sleep(100);assert.deepEqual(await js(`[...document.querySelectorAll('.dedicated-ledger,.account-book-body')].filter(el=>el.scrollWidth>el.clientWidth+2||el.scrollHeight>el.clientHeight+2).map(el=>el.className)`),[]);}
  fs.writeFileSync(path.join(out,'ledger-account.png'),(await page.capturePage()).toPNG());
  await press('Enter');assert.equal(await title(),'Alter voucher: Receipt');
  assert.equal(await js('document.querySelector(".settlement").hidden'),false);
  assert.equal(await js('document.querySelector(".voucher > table.lines").hidden'),true);
  if(await js('!!document.querySelector(".choice-panel:not([hidden])")'))await press('Escape');await press('Escape');assert.equal(await title(),'Ledger account');
  await press('Escape');assert.equal(await title(),'Alter ledger');assert.equal(await js('document.activeElement.value'),'Unsaved buyer name');assert.equal((await api('ledgers')).find(row=>row.id===id).name,'Ledger Buyer');
  await press('s',['control']);assert.equal((await api('ledgers')).find(row=>row.id===id).name,'Unsaved buyer name');
  console.log('LEDGER ACCOUNT SMOKE OK. Screenshots: '+out);app.exit(0);
 }catch(error){console.error(error.stack,await title());app.exit(1);}
});
