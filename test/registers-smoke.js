'use strict';
const {app,BrowserWindow}=require('electron'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const out=fs.mkdtempSync(path.join(os.tmpdir(),'desktop-erp-registers-'));process.env.DESKTOP_ERP_DATA_DIR=out;require('../main');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
app.whenReady().then(async()=>{
 await require('./wait-for-window')();const win=BrowserWindow.getAllWindows()[0],page=win.webContents;win.show();win.focus();page.focus();
 const js=code=>page.executeJavaScript(code),api=(name,args={})=>js(`window.books.call(${JSON.stringify(name)},${JSON.stringify(args)})`);
 async function press(keyCode,modifiers=[]){page.sendInputEvent({type:'keyDown',keyCode,modifiers});page.sendInputEvent({type:'keyUp',keyCode,modifiers});await sleep(180);}
 async function replace(text){await press('a',['control']);await page.insertText(text);}
 const heading=()=>js('document.querySelector(".register-content h2").textContent');
 const status=()=>js('document.querySelector(".register-content .daybook > .tip").textContent');
 try{
  const old=await api('createFinancialYear',{from:'1999-04-01',to:'2000-03-31'});await api('selectFinancialYear',old);page.reload();await new Promise(r=>page.once('did-finish-load',r));await sleep(600);
  const cash=(await api('ledgers')).find(l=>l.name==='Cash').id;
  const party=(await api('saveLedger',{name:'Register Party',groupId:(await api('groups')).find(g=>g.name==='Sundry Creditors').id})).id;
  for(const type of ['Payment','Receipt','Contra','Journal'])for(const date of ['2000-01-01','2000-01-02'])await api('saveVoucher',{type,date,narration:type+' '+date,lines:[{ledgerId:party,amount:1000},{ledgerId:cash,amount:-1000}]});
  const item=(await api('saveItem',{name:'Register item',unit:'PCS',saleRate:1000,purchaseRate:1000})).id;
  await api('saveInvoice',{type:'Stock In',date:'2000-01-01',items:[{itemId:item,qty:20000,rate:1000}]});
  for(const type of ['Sales','Purchase','Credit Note','Debit Note','Quotation','Sales Order','Purchase Order'])await api('saveInvoice',{type,date:'2000-01-02',partyId:party,items:[{itemId:item,qty:1000,rate:1000}]});
  await press('k',['control']);await page.insertText('Registers');await press('Enter');
  assert.equal(await js('document.querySelector("#nav [aria-current] strong").textContent'),'Registers');
  assert.equal(await heading(),'Payment register');assert.match(await status(),/2 transactions.*01-04-1999/);
  assert.equal(await js('document.querySelectorAll(".register-rail > button").length'),14);
  assert.equal(await js(`[...document.querySelectorAll('#nav strong')].some(el=>el.textContent==='Ledger & Stock')`),false);
  await press('Down');assert.equal(await heading(),'Receipt register');await press('Tab');assert.equal(await heading(),'Contra register');await press('Up');assert.equal(await heading(),'Receipt register');
  await press('Enter');await press('F2');await replace('01-01-2000');await press('Enter');assert.match(await status(),/^1 transactions/);
  await press('F2',['alt']);await replace('01-01-2000');await press('Tab');await replace('02-01-2000');await press('Enter');assert.match(await status(),/^2 transactions/);
  await press('Enter');assert.equal(await js('document.querySelector("#title").textContent'),'Alter voucher: Receipt');
  if(await js('!!document.querySelector(".choice-panel:not([hidden])")'))await press('Escape');await press('Escape');assert.match(await status(),/^2 transactions/);
  await press('m',['alt']);await press('Home');
  for(let at=0;at<12;at++){
   await js(`document.querySelectorAll('.register-rail > button')[${at}].click()`);await sleep(180);
   assert.match(await status(),/^[12] transactions/);
   const title=await heading();
   if(at>=4&&at<=7){await press('Enter');assert.equal(await js('!!document.querySelector(".trade-invoice")'),true,title);if(await js('!!document.querySelector(".choice-panel:not([hidden])")'))await press('Escape');await press('Escape');}
  }
  for(const [at,name,title] of [[12,'Register Party','Ledger account'],[13,'Register item','Stock ledger']]){
   await js(`document.querySelectorAll('.register-rail > button')[${at}].click()`);await sleep(180);
   await page.insertText(name);await press('Enter');
   assert.equal(await js('document.querySelector("#title").textContent'),title);
   assert.equal(await js('document.querySelector(".account-book-heading h2").textContent'),name);
   assert.match(await js('document.querySelector(".account-status").textContent'),/01-04-1999 to 31-03-2000/);
   assert.equal(await js('!!document.querySelector(".account-picker")'),false);
   assert.match(await js('document.querySelector(".account-entries tbody").textContent'),/2000/);
   await press('Enter');assert.notEqual(await js('document.querySelector("#title").textContent'),title);
   if(await js('!!document.querySelector(".choice-panel:not([hidden])")'))await press('Escape');await press('Escape');
   assert.equal(await js('document.querySelector("#title").textContent'),title);await press('Escape');
   assert.equal(await js('document.querySelector(".account-picker input").value'),name);
  }
  for(const height of [640,800]){win.setSize(1100,height);await sleep(150);assert.deepEqual(await js(`[...document.querySelectorAll('.registers-workspace,.register-content,.transaction-register,.register-master-list,.account-picker')].filter(el=>el.scrollHeight>el.clientHeight+2||el.scrollWidth>el.clientWidth+2).map(el=>({class:el.className,width:[el.scrollWidth,el.clientWidth],height:[el.scrollHeight,el.clientHeight]}))`),[]);}
  fs.writeFileSync(path.join(out,'registers.png'),(await page.capturePage()).toPNG());
  // Escape leaves entry controls for the selected register; only a second Escape exits.
  for(const at of [0,12,13]){
   await js(`document.querySelectorAll('.register-rail > button')[${at}].click()`);await sleep(180);
   if(at===0)await press('F2');
   await press('Escape');
   assert.equal(await js('document.querySelector("#title").textContent'),'Registers');
   assert.equal(await js(`document.activeElement===document.querySelectorAll('.register-rail > button')[${at}]`),true);
   await press('Down');assert.equal(await js('document.activeElement.closest(".register-rail")!==null'),true);
   await press('Enter');await press('Escape');assert.equal(await js('document.activeElement.closest(".register-rail")!==null'),true);
  }
  await press('Escape');assert.equal(await js('document.querySelector("#title").textContent'),'Dashboard');
  console.log('REGISTERS SMOKE OK: twelve types, arrows/Tab, dates, and original voucher editors. '+out);app.exit(0);
 }catch(error){console.error(error.stack);fs.writeFileSync(path.join(out,'failure.png'),(await page.capturePage()).toPNG());console.error(out);app.exit(1);}
});
