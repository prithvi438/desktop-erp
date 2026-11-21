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
 const party=(await api('saveLedger',{name:'GST Supplier',groupId:groups.find(g=>g.name==='Sundry Creditors').id,state:'Maharashtra'})).id;
 const slab=(await api('saveCatalogMaster',{kind:'gstSlab',name:'Standard 18',rate:1800})).id;
 await api('saveCatalogMaster',{kind:'gstSlab',name:'Reduced 5',rate:500});
 const item=(await api('saveItem',{name:'GST item',unit:'PCS',gstSlabId:slab,purchaseRate:10000})).id;
 assert.equal((await api('items')).find(i=>i.id===item).gstRate,1800);
 for(const mode of ['interstate','intrastate']){
 await open({type:'Purchase',draft:{partyId:party,items:[{itemId:item,qty:1000,rate:10000}]}});
 assert.equal(await js('document.querySelector("input[aria-label^=gst]").value'),'18.00');
 assert.equal(await js('document.querySelectorAll(".line-actions>button").length'),0);
 await js('document.querySelector("input[aria-label^=gst]").focus()');
 assert.match(await js('document.querySelector(".choice-panel").textContent'),/Reduced 5/);
 await press('a',['control']);await page.insertText('5');await press('Enter');
 assert.equal(await js('document.querySelector("input[aria-label^=gst]").value'),'5.00');
 await js(`var supply=document.querySelector('.gst-supply-field select');supply.value=${JSON.stringify(mode)};supply.dispatchEvent(new Event('change',{bubbles:true}));`);
 await press('s',['control']);const saved=(await api('dayBook',{types:['Purchase']})).at(-1);assert.ok(saved);
 const doc=await api('invoice',{id:saved.id});assert.equal(Boolean(doc.interstate),mode==='interstate');assert.equal(doc.items[0].gstRate,500);
 const tax=(await api('taxRegister',{types:['Purchase']})).rows.find(r=>r.voucherId===saved.id);
 assert.equal(tax.igst,mode==='interstate'?500:0);assert.equal(tax.cgst,mode==='intrastate'?250:0);assert.equal(tax.sgst,mode==='intrastate'?250:0);
 await open({id:saved.id});assert.equal(await js('document.querySelector(".gst-supply-field select").value'),mode);
 }
 await js("Promise.all([import('./router.js'),import('./catalog.js')]).then(([r,c])=>r.push(c.catalogForm('hsn')))");assert.ok(await js('document.querySelector(".catalog-save button kbd")'));
 console.log('GST ENTRY SMOKE OK: item slab autofill, slab selection, supply posting and reopen, tidy actions and HSN save');app.exit(0);
 }catch(error){console.error(error.stack);app.exit(1);}
});