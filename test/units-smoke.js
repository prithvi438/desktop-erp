'use strict';
const {app,BrowserWindow}=require('electron'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const out=fs.mkdtempSync(path.join(os.tmpdir(),'desktop-erp-units-ui-'));process.env.DESKTOP_ERP_DATA_DIR=out;require('../main');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
app.whenReady().then(async()=>{
 await require('./wait-for-window')();const win=BrowserWindow.getAllWindows()[0],page=win.webContents;win.setSize(1200,760);win.show();win.focus();page.focus();
 const js=code=>page.executeJavaScript(code),api=(method,args={})=>js(`window.books.call(${JSON.stringify(method)},${JSON.stringify(args)})`);
 async function press(keyCode,modifiers=[]){page.sendInputEvent({type:'keyDown',keyCode,modifiers});page.sendInputEvent({type:'keyUp',keyCode,modifiers});await sleep(170);}
 async function type(text){await page.insertText(text);await sleep(70);}
 async function replace(text){await press('a',['control']);await type(text);}
 async function go(text){await press('k',['control']);await type(text);await press('Enter');}
 const title=()=>js('document.querySelector("#title").textContent');
 async function shot(name){fs.writeFileSync(path.join(out,name+'.png'),(await page.capturePage()).toPNG());}
 try{
  await go('Masters');await press('F7');await press('c',['alt']);await type('Gram');await press('Tab');await replace('g');await press('Tab');await type('Base weight');await press('s',['control']);
  await press('c',['alt']);await type('Kilogram');await press('Tab');await replace('kg');await press('Tab');await type('Bulk weight');await press('Tab');await type('Gram');await press('Enter');await press('Tab');await replace('1000');await shot('unit-create');await press('s',['control']);assert.equal(await title(),'Masters');
  const units=await api('catalogMasters',{kind:'unit'}),g=units.find(u=>u.symbol==='g'),kg=units.find(u=>u.symbol==='kg');assert.equal(kg.relatedId,g.id);assert.equal(kg.conversion,'1000');
  await press('F3');await press('c',['alt']);await type('Rice');await press('Enter');await replace('g');await press('Enter');await shot('item-create');await press('s',['control']);assert.equal(await title(),'Masters');
  const item=(await api('items')).find(i=>i.name==='Rice');assert.equal(item.unitId,g.id);
  const groups=await api('groups');const party=(await api('saveLedger',{name:'Buyer',groupId:groups.find(g=>g.name==='Sundry Debtors').id})).id;
  await api('saveInvoice',{type:'Stock In',date:'2026-11-11',items:[{itemId:item.id,qty:10000,unitId:kg.id,rate:5000}]});
  await go('Create Vouchers');await type('Buyer');await press('Enter');await type('Rice');await press('Enter');await sleep(250);
  await js(`document.querySelector('input[aria-label="qty for item 1"]').focus()`);await replace('2');await press('Enter');
  assert.equal(await js('document.activeElement.getAttribute("aria-label")'),'unit for item 1');await replace('kg');await press('Enter');await press('Enter');await replace('100');await shot('sale-kg');await press('s',['control']);
  assert.equal((await api('items')).find(i=>i.id===item.id).stock,8000000);
  console.log('UNITS SMOKE OK. Screenshots: '+out);app.exit(0);
 }catch(error){await shot('failure');console.error(error.stack,await title(),'Screenshots: '+out);app.exit(1);}
});
