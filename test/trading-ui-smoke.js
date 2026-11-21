'use strict';
const {app,BrowserWindow}=require('electron'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const out=fs.mkdtempSync(path.join(os.tmpdir(),'desktop-erp-trading-ui-'));process.env.DESKTOP_ERP_DATA_DIR=out;require('../main');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
app.whenReady().then(async()=>{
 await require('./wait-for-window')();const win=BrowserWindow.getAllWindows()[0],page=win.webContents;win.show();win.focus();page.focus();
 const js=async code=>{try{return await page.executeJavaScript(code);}catch(error){console.error('Failed script:',code);throw error;}},api=(method,args={})=>js(`window.books.call(${JSON.stringify(method)},${JSON.stringify(args)})`);
 async function press(keyCode,modifiers=[]){page.sendInputEvent({type:'keyDown',keyCode,modifiers});page.sendInputEvent({type:'keyUp',keyCode,modifiers});await sleep(170);}
 async function open(args){await js(`(async()=>{const {push}=await import('./router.js');const {invoiceEntry}=await import('./invoice.js');await push(invoiceEntry(${JSON.stringify(args)}));})()`);}
 async function shot(name){await sleep(200);fs.writeFileSync(path.join(out,name+'.png'),(await page.capturePage()).toPNG());}
 try{
  const groups=await api('groups');
  const customer=(await api('saveLedger',{name:'Acme Retail',groupId:groups.find(g=>g.name==='Sundry Debtors').id})).id;
  const supplier=(await api('saveLedger',{name:'Metro Supplies',groupId:groups.find(g=>g.name==='Sundry Creditors').id})).id;
  const freight=(await api('saveLedger',{name:'Delivery charges',groupId:groups.find(g=>g.name==='Indirect Expenses').id})).id;
  const discount=(await api('saveLedger',{name:'Special deduction',groupId:groups.find(g=>g.name==='Indirect Expenses').id})).id;
  const item=(await api('saveItem',{name:'Desk Lamp',unit:'PCS',saleRate:12000,purchaseRate:8000,gstRate:1800,hsn:'9405'})).id;
  await api('saveInvoice',{type:'Stock In',date:'2026-11-01',items:[{itemId:item,qty:100000,rate:8000}]});
  for(const type of ['Sales','Purchase','Credit Note','Debit Note']){
   const purchase=['Purchase','Debit Note'].includes(type);
   await open({type,draft:{partyId:purchase?supplier:customer,items:[{itemId:item,qty:2000,rate:purchase?8000:12000}]}});
   assert.equal(await js('document.querySelector(".trade-invoice").dataset.documentType'),type);
   if(type==='Purchase'){await js('document.querySelector("input[placeholder^=Supplier]").focus()');await page.insertText('SUP-101');await press('Enter');await press('Escape');}
   await js('document.querySelector("input[aria-label^=item]").focus()');await press('Escape');
   assert.match(await js('document.querySelector(".invoice-item-info").textContent'),/Available/);
   const entryTitle=await js('document.querySelector("#title").textContent');
   await press('l',['alt']);assert.equal(await js('document.querySelector("#title").textContent'),entryTitle);
   await page.insertText('Delivery charges');await press('Enter');await page.insertText('15');await press('Enter');
   await page.insertText('Special deduction');await press('Enter');await page.insertText('-5');await press('Enter');await press('Enter');
   assert.equal(await js('document.querySelector("#title").textContent'),entryTitle);
   assert.equal(await js('document.querySelector(".inline-charges").hidden'),false);
   assert.deepEqual(await js('[...document.querySelectorAll(".charge-row input")].map(input=>input.value)'),['Delivery charges','15','Special deduction','-5']);
   assert.match(await js('document.querySelector(".document-breakdown").textContent'),/10.00/);
   for(const [width,height] of [[1200,800],[1100,640]]){
    win.setSize(width,height);await sleep(180);
    assert.deepEqual(await js(`[...document.querySelectorAll('.trade-invoice,.invoice-party-panel,.document-save')].filter(el=>el.scrollWidth>el.clientWidth+2||(el.scrollHeight>el.clientHeight+2&&!['auto','scroll'].includes(getComputedStyle(el).overflowY))).map(el=>({class:el.className,width:[el.scrollWidth,el.clientWidth],height:[el.scrollHeight,el.clientHeight]}))`),[]);
    await shot(type.replaceAll(' ','-')+'-'+height);
   }
   const before=(await api('items')).find(i=>i.id===item).stock;
   await press('s',['control']);
   const saved=(await api('dayBook',{types:[type]})).at(-1);assert.ok(saved,'Voucher saved');
   const invoice=await api('invoice',{id:saved.id});assert.equal(invoice.details.reference||'','');
   assert.deepEqual(invoice.details.charges,[{ledgerId:freight,amount:1500},{ledgerId:discount,amount:-500}]);
   if(type==='Purchase')assert.equal(invoice.details.billNumber,'SUP-101');
   assert.equal(invoice.items[0].qty,2000);assert.equal(invoice.items[0].gstRate,1800);
   const after=(await api('items')).find(i=>i.id===item).stock;
   assert.equal(after,before+(['Sales','Debit Note'].includes(type)?-2000:2000));
   await js(`(async()=>{(await import('./router.js')).pop();})()`);
   await open({id:saved.id});
   assert.equal(await js('!!document.querySelector("input[aria-label=reference]")'),false);
   assert.equal(await js('document.querySelector(".trade-invoice").dataset.documentType'),type);
   assert.equal(await js('document.querySelector(".inline-charges").hidden'),false);
   assert.deepEqual(await js('[...document.querySelectorAll(".charge-row input")].map(input=>input.value)'),['Delivery charges','15.00','Special deduction','-5.00']);
   await press('s',['control']);
   assert.equal((await api('items')).find(i=>i.id===item).stock,after);
   assert.deepEqual((await api('invoice',{id:saved.id})).items,invoice.items);
  }
  console.log('TRADING UI SMOKE OK: four document types, save/reopen, stock directions and compact layouts. Screenshots: '+out);app.exit(0);
 }catch(error){await shot('failure');console.error(error.stack,'Screenshots: '+out);app.exit(1);}
});
