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
  assert.equal(await js("document.querySelectorAll('.dashboard-chart svg').length"),4);
  const ledgers=await api('ledgers'),groups=await api('groups'),cash=ledgers.find(r=>r.name==='Cash').id,sales=ledgers.find(r=>r.name==='Sales').id,purchase=ledgers.find(r=>r.name==='Purchase').id;
  const expense=(await api('saveLedger',{name:'Rent',groupId:groups.find(g=>g.name==='Indirect Expenses').id})).id;
  for(const [date,s,p] of [['2026-04-15',1800000,850000],['2026-05-15',2500000,1200000],['2026-06-15',2100000,700000],['2026-07-15',3500000,1600000],['2026-08-15',2900000,1200000],['2026-09-15',4200000,1900000],['2026-10-15',3800000,1500000]]){
   await api('saveVoucher',{type:'Sales',date,lines:[{ledgerId:cash,amount:s},{ledgerId:sales,amount:-s}]});
   await api('saveVoucher',{type:'Purchase',date,lines:[{ledgerId:purchase,amount:p},{ledgerId:cash,amount:-p}]});
   await api('saveVoucher',{type:'Payment',date,lines:[{ledgerId:expense,amount:300000},{ledgerId:cash,amount:-300000}]});
  }
  await js("import('./router.js').then(r=>r.goHome())");
  assert.equal(await js("document.querySelectorAll('.dashboard-chart svg').length"),4);
  assert.ok(await js("document.querySelector('.dashboard-chart table').textContent.includes('18,000.00')"));
  assert.equal(await js("document.querySelectorAll('.expense-legend > div').length"),2);
  for(const width of [1384,1100]){win.setSize(width,850);await sleep(150);assert.equal(await js("document.querySelector('.dash').scrollWidth<=document.querySelector('.dash').clientWidth+2"),true);}
  await press('d',['alt']);assert.equal(await js("document.activeElement.className"),'dashboard-analytics-host');await press('PageDown');assert.ok(await js("document.querySelector('.dash').scrollTop>0"));
  win.setSize(1500,1000);await sleep(150);await js("document.querySelector('.dash').scrollTop=350");
  fs.writeFileSync(path.join(out,'dashboard-charts.png'),(await page.capturePage()).toPNG());
  await js("document.querySelector('.chart-data summary').focus()");await press('Enter');assert.equal(await js("document.querySelector('.chart-data').open"),true);
  await js("document.querySelector('.chart-heading button').focus()");await press('Enter');assert.match(await title(),/profit and loss/i);await press('Escape');await press('h',['control']);await press('F3');assert.equal(await title(),'Companies & financial years');
  console.log('DASHBOARD CHARTS SMOKE OK: empty/populated data, chart values, responsive scrolling, keyboard figures/report drill-down and F3. '+out);app.exit(0);
 }catch(error){console.error(error.stack);fs.writeFileSync(path.join(out,'failure.png'),(await page.capturePage()).toPNG());console.error(out);app.exit(1);}
});
