'use strict';
const {app,BrowserWindow}=require('electron'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const out=fs.mkdtempSync(path.join(os.tmpdir(),'speedoone-inventory-ui-'));process.env.SPEEDOONE_DATA_DIR=out;require('../main');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
app.whenReady().then(async()=>{await require('./wait-for-window')();const win=BrowserWindow.getAllWindows()[0],page=win.webContents;win.show();win.focus();page.focus();
 page.on('console-message',(_e,...args)=>console.log('RENDERER',...args));
 const js=async code=>{try{return await page.executeJavaScript(code);}catch(e){console.error('SCRIPT',code);throw e;}},api=(method,args={})=>js(`window.books.call(${JSON.stringify(method)},${JSON.stringify(args)})`);
 async function press(keyCode,modifiers=[]){page.sendInputEvent({type:'keyDown',keyCode,modifiers});page.sendInputEvent({type:'keyUp',keyCode,modifiers});await sleep(150);}
 const open=(module,expression)=>js(`(async()=>{const m=await import('./${module}.js');await (await import('./router.js')).push(${expression});})()`);
 try{
  for(let i=0;i<5;i++)await press('Down');await press('Enter');
  assert.equal(await js('document.querySelector("#title").textContent'),'Settings');
  fs.writeFileSync(path.join(out,'settings.png'),(await page.capturePage()).toPNG());
  await page.insertText('Inventory features');await press('Enter');
  assert.equal(await js('document.activeElement.value'),'No');await press('y');assert.equal(await js('document.activeElement.value'),'Yes');await press('Right');assert.equal(await js('document.activeElement.value'),'No');await press('Left');assert.equal(await js('document.activeElement.value'),'Yes');await press('Enter');await press('y');await press('s',['control']);
  assert.equal((await api('settings')).freeOffers,true);
  fs.writeFileSync(path.join(out,'features.png'),(await page.capturePage()).toPNG());await press('Escape');
  const groups=await api('groups'),party=(await api('saveLedger',{name:'Test customer',groupId:groups.find(g=>g.name==='Sundry Debtors').id})).id;
  const item=(await api('saveItem',{name:'Offer soap',unit:'PCS',saleRate:10000})).id;
  await api('saveInventoryRules',{itemId:item,saleMin:500,saleDefault:1000,saleMax:2000,buyQty:1000,freeQty:1000});
  await api('saveInvoice',{type:'Stock In',date:'2026-11-01',items:[{itemId:item,qty:100000,rate:5000}]});
  await api('saveSettings',{batchTracking:false,expiryTracking:false});
  await open('invoice',`m.invoiceEntry({type:'Sales'})`);
  await page.insertText('Test customer');await press('Enter');await page.insertText('Offer soap');await press('Enter');await page.insertText('2');await press('Enter');
  assert.equal(await js('document.querySelector(".discount-cell input").value'),'10.00');
  assert.equal(await js('document.querySelector(".free-quantity").value'),'2');
  assert.equal(await js('document.querySelectorAll("thead th")[1].hidden'),true);
  assert.equal(await js('document.querySelectorAll("thead th")[2].hidden'),true);
  fs.writeFileSync(path.join(out,'invoice.png'),(await page.capturePage()).toPNG());await press('s',['control']);
  const entries=await api('dayBook',{types:['Sales']});assert.equal(entries.length,1);
  const invoice=await api('invoice',{id:entries[0].id});assert.equal(invoice.items[0].freeQty,2000);assert.equal(invoice.items[0].discountPct,1000);assert.equal((await api('items'))[0].stock,96000);
  await press('Escape');await open('inventory-settings',`m.inventoryRuleForm(${JSON.stringify((await api('items'))[0])})`);
  await sleep(250);
  fs.writeFileSync(path.join(out,'rules.png'),(await page.capturePage()).toPNG());
  assert.equal(await js('document.querySelectorAll(".inventory-settings input").length'),12);
  await press('s',['control']);assert.equal((await api('inventoryRules',{itemId:item})).saleDefault,1000);
  console.log('PASS inventory feature switches, keyboard entry, discounts, BOGO, hidden batch fields and saved stock. Screenshots: '+out);app.exit(0);
 }catch(error){console.error(error);app.exit(1);}
});
