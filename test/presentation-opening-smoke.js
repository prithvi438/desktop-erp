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
  for(const type of ['trialBalance','balanceSheet','profitLoss','trading']){
   await js("(async()=>{const {push}=await import('./router.js');const {financialStatement}=await import('./financial-reports.js');await push(financialStatement('"+type+"'));})()");
   const before=await js("document.querySelector('select[aria-label=\"Reporting framework\"]').value");
   await press('p',['alt']);await press('Down');await press('Enter');
   assert.notEqual(await js("document.querySelector('select[aria-label=\"Reporting framework\"]').value"),before);assert.equal(await js("!!document.querySelector('body > .overlay')"),false);
   await press('Escape');
  }
  await js("(async()=>{const {push}=await import('./router.js');const {ledgerForm}=await import('./ledgers.js');await push(ledgerForm(null,'Sundry Creditors'));})()");
  assert.equal(await js("document.querySelector('.side').value"),'Cr');
  await js("(()=>{const e=document.querySelector('.ledger-compact');e.querySelector('input.wide').value='Opening supplier';const amount=e.querySelector('input.num');amount.value='50';amount.dispatchEvent(new Event('input',{bubbles:true}));})()");
  assert.match(await js("document.querySelector('.opening-status').textContent"),/50.00 Cr/);
  await press('s',['control']);assert.match(await js("document.querySelector('body > .overlay').textContent"),/Opening balances will differ/);await press('n');
  assert.equal((await api('ledgers')).some(r=>r.name==='Opening supplier'),false);
  await press('s',['control']);await press('y');assert.equal((await api('ledgers')).find(r=>r.name==='Opening supplier').opening,-5000);
  await js("(async()=>{const {push}=await import('./router.js');const {financialStatement}=await import('./financial-reports.js');await push(financialStatement('trialBalance'));})()");await press('o',['alt']);assert.equal(await title(),'Review opening balances');assert.match(await js("document.querySelector('[role=status]').textContent"),/Difference INR 50.00 Cr/);
  const cash=(await api('ledgers')).find(r=>r.name==='Cash');await api('saveLedger',{...cash,opening:5000});const report=await api('financialReport',{type:'trialBalance',asOf:'2026-11-12'});assert.equal(report.rows.at(-1).amount,0);assert.equal(report.warnings.some(w=>w.includes('Opening balance mismatch')),false);
  console.log('PRESENTATION / OPENINGS SMOKE OK: Alt+P on all financial statements, creditor Cr default, mismatch confirmation and balanced completion. '+out);app.exit(0);
 }catch(error){console.error(error.stack);fs.writeFileSync(path.join(out,'failure.png'),(await page.capturePage()).toPNG());console.error(out);app.exit(1);}
});
