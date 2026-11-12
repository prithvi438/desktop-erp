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
  const cash=(await api('ledgers')).find(l=>l.name==='Cash').id;
  const party=(await api('saveLedger',{name:'Report Customer',groupId:(await api('groups')).find(g=>g.name==='Sundry Debtors').id})).id;
  await api('saveVoucher',{type:'Receipt',date:'2026-11-11',lines:[{ledgerId:cash,amount:10000},{ledgerId:party,amount:-10000}]});
  assert.equal(await js(`[...document.querySelectorAll('#nav strong')].some(n=>n.textContent==='Manage Records')`),false);
  await press('k',['control']);await page.insertText('Reports');await press('Enter');
  assert.equal(await title(),'Reports');assert.equal(await js('!!document.querySelector(".browse-rail")'),false);
  assert.ok(await js('document.querySelectorAll(".report-directory .report-link").length')>20);
  await press('Down');await press('Enter');assert.match(await title(),/^Trial balance/);
  assert.equal(await js('!!document.querySelector(".expanded-report")'),true);
  assert.match(await js('document.querySelector(".expanded-report tbody").textContent'),/Report Customer/);
  await drillIntoCustomer();
  await press('F2');assert.equal(await js('document.activeElement.getAttribute("aria-label")'),'Reporting date');await press('Escape');
  assert.equal(await title(),'Reports');assert.match(await js('document.querySelector(".report-directory .report-link.on").textContent'),/Trial balance/);
  for(const name of ['Trading account','Profit & loss','Balance sheet','Cash flow','Funds flow','Changes in working capital','Cash / bank book','Group summary','Stock movement analysis','Stock category summary','Stock ageing analysis','Ratios']){
   await find(name);assert.ok((await title()).startsWith(name==='Profit & loss'?'Statement of profit and loss':name));assert.equal(await js('!!document.querySelector(".browse-rail")'),false);
   for(const height of [640,800]){win.setSize(1100,height);await sleep(100);assert.deepEqual(await js(`[...document.querySelectorAll('.expanded-report')].filter(el=>el.scrollWidth>el.clientWidth+2||el.scrollHeight>el.clientHeight+2).map(el=>el.className)`),[]);}
   if(name==='Cash flow')assert.equal(await js('!!document.querySelector(".daybook-filters")'),true);
   if(name==='Cash flow'){
    await js(`[...document.querySelectorAll('.expanded-report tbody tr')].find(row=>row.textContent.includes('November')).click()`);await press('Enter');assert.match(await title(),/^Cash flow: November/);assert.match(await js('document.querySelector(".expanded-report tbody").textContent'),/Receipt/);await press('Enter');assert.equal(await title(),'Alter voucher: Receipt');if(await js('!!document.querySelector(".choice-panel:not([hidden])")'))await press('Escape');await press('Escape');await press('Escape');assert.match(await title(),/^Cash flow:/);
   }
   if(name==='Funds flow'){await press('Enter');assert.match(await title(),/^Funds flow: sources and applications/);await press('Escape');}
   if(name==='Balance sheet')await drillIntoCustomer();
   fs.writeFileSync(path.join(out,name.replace(/[^a-z0-9-]/gi,'-')+'.png'),(await page.capturePage()).toPNG());
   await press('Escape');assert.equal(await title(),'Reports');assert.equal(await js('document.querySelector(".report-directory input").value'),name);
  }
  const stockItem=await api('saveItem',{name:'Monthly test item',unit:'pc'});
  await api('saveInvoice',{type:'Stock In',date:'2026-11-01',items:[{itemId:stockItem.id,qty:5000,rate:1000}]});
  await find('Stock item monthly summary');await page.insertText('Monthly test item');await press('Enter');assert.match(await title(),/^Stock item monthly summary: Monthly test item/);
  await js(`[...document.querySelectorAll('.expanded-report tbody tr')].find(row=>row.textContent.includes('November')).click()`);await press('Enter');
  assert.equal(await js(`document.querySelector('input[aria-label="From date"]').value`),'01-11-2026');assert.match(await js('document.querySelector(".account-totals").textContent'),/5 PC/i);await press('Escape');await press('Escape');assert.equal(await title(),'Reports');
  await press('Escape');assert.equal(await title(),'Dashboard');
  await press('k',['control']);await page.insertText('Trial balance');await press('Enter');assert.match(await title(),/^Trial balance/);await press('Escape');assert.equal(await title(),'Reports');
  console.log('REPORT DIRECTORY SMOKE OK: expanded financial and inventory reports, monthly cash/funds drill-down, dates, search retention, aliases and Escape. '+out);app.exit(0);
 }catch(error){console.error(error.stack);fs.writeFileSync(path.join(out,'failure.png'),(await page.capturePage()).toPNG());console.error(out);app.exit(1);}
});
