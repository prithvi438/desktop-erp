'use strict';
const {app,BrowserWindow}=require('electron'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
process.env.DESKTOP_ERP_DATA_DIR=fs.mkdtempSync(path.join(os.tmpdir(),'desktop-erp-type-search-'));require('../main');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
app.whenReady().then(async()=>{
 await require('./wait-for-window')();const win=BrowserWindow.getAllWindows()[0],page=win.webContents;win.show();win.focus();page.focus();
 const js=code=>page.executeJavaScript(code),api=(method,args={})=>js(`window.books.call(${JSON.stringify(method)},${JSON.stringify(args)})`);
 async function press(keyCode,modifiers=[]){page.sendInputEvent({type:'keyDown',keyCode,modifiers});page.sendInputEvent({type:'keyUp',keyCode,modifiers});await sleep(130);}
 async function type(text){await page.insertText(text);await sleep(70);}
 try{
  await api('saveItem',{name:'Rice',unit:'KG',reorderLevel:1000});await api('saveItem',{name:'Wheat',unit:'KG'});
  await api('saveCatalogMaster',{kind:'unit',name:'Gram',symbol:'g'});const slab=(await api('saveCatalogMaster',{kind:'gstSlab',name:'Tax twelve',rate:1200})).id;
  await api('saveCatalogMaster',{kind:'hsn',name:'1234',relatedId:slab});
  await press('k',['control']);await type('Masters');await press('Enter');
  for(const [key,first,rest,expected] of [['F3','r','ice','Rice'],['F7','g','ram','Gram'],['F11','t','ax','Tax twelve'],['F12','1','234','1234']]){
   await press(key);await press(first);await type(rest);assert.equal(await js('document.activeElement.getAttribute("aria-label")'),'Search records');assert.equal(await js('document.activeElement.value'),first+rest);assert.match(await js('document.querySelector(".manage-results tr.on").textContent'),new RegExp(expected));
  }
  await js(`(async()=>{const {itemList}=await import('./items.js');const {push}=await import('./router.js');await push(itemList());document.querySelector('#main .scroll').focus();})()`);
  await press('w');await type('heat');assert.equal(await js('document.activeElement.value'),'wheat');assert.equal(await js('document.querySelectorAll("#main tbody tr").length'),1);assert.match(await js('document.querySelector("#main tbody").textContent'),/Wheat/);
  await press('Escape');await press('k',['control']);await type('Purchase planning');await press('Enter');
  await js('document.querySelector(".retail-list .manage-results").focus()');await press('r');await type('ice');assert.equal(await js('document.activeElement.value'),'rice');
  await js(`document.querySelector('input[aria-label="Demand days"]').focus()`);await press('a',['control']);await type('45');assert.equal(await js('document.activeElement.value'),'45');assert.equal(await js('document.querySelector(".retail-list > input").value'),'rice');
  await press('k',['control']);await type('Entries');await press('Enter');await press('i');await type('nvoices');assert.equal(await js('document.activeElement.className'),'browse-search');assert.equal(await js('document.activeElement.value'),'invoices');
  console.log('TYPE SEARCH SMOKE OK');app.exit(0);
 }catch(error){console.error(error.stack);app.exit(1);}
});
