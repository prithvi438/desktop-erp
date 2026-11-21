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
 const groups=await api('groups'),party=(await api('saveLedger',{name:'Flow Supplier',groupId:groups.find(g=>g.name==='Sundry Creditors').id})).id;
 const item=(await api('saveItem',{name:'Flow Item',unit:'PCS',purchaseRate:10000})).id;
 await open({type:'Purchase',draft:{partyId:party,items:[{itemId:item,qty:1000,rate:10000}]}});
 assert.equal(await js('!!document.querySelector(".bill-reference-action")'),false);
 assert.equal(await js('!!document.querySelector("input[placeholder^=Optional]")'),false);
 const alignment=await js('(()=>{const a=document.querySelector(".voucher-number").getBoundingClientRect(),b=document.querySelector(".vhead input.date").getBoundingClientRect();return Math.abs((a.top+a.bottom)/2-(b.top+b.bottom)/2)})()');assert.ok(alignment<2);
 await js('document.querySelector(".trade-invoice>label.narration input").focus()');await press('Enter');assert.ok(await js('!!document.querySelector(".bill-reference-editor")'));
 await press('Escape');assert.equal((await api('dayBook',{types:['Purchase']})).length,0);
 await press('Enter');for(let i=0;i<4;i++)await press('Enter');
 const saved=(await api('dayBook',{types:['Purchase']})).at(-1);assert.ok(saved,'Enter completes bill allocation and saves');
 const cash=(await api('ledgers')).find(l=>l.name==='Cash').id;
 const payment=(await api('saveVoucher',{type:'Payment',date:'2026-11-12',lines:[{ledgerId:party,amount:1000},{ledgerId:cash,amount:-1000}]})).id;
 await js(`Promise.all([import('./router.js'),import('./voucher.js')]).then(([r,v])=>r.push(v.voucherEntry({id:${payment}})))`);
 await js('document.querySelector("label.narration input").focus()');await press('Enter');assert.ok(await js('!!document.querySelector(".bill-reference-editor")'));await press('Escape');
 console.log('REFERENCE ENTER FLOW OK: aligned header, hidden optional reference, allocation opens on Enter, cancel retains draft, Enter saves, payment flow');app.exit(0);
 }catch(error){console.error(error.stack);app.exit(1);}
});