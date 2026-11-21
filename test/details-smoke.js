'use strict';
const {app,BrowserWindow,dialog}=require('electron');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {openBooks}=require('../src/books');
const out=fs.mkdtempSync(path.join(os.tmpdir(),'desktop-erp-rich-'));
process.env.DESKTOP_ERP_DATA_DIR=out;
const photo=path.join(out,'proof.png');
fs.writeFileSync(photo,Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aF9sAAAAASUVORK5CYII=','base64'));
// Exercise the production file handler with deterministic native-picker results.
dialog.showOpenDialog=async()=>({canceled:false,filePaths:[photo]});
dialog.showSaveDialog=async()=>({canceled:false,filePath:path.join(out,'exported.png')});
const seed=openBooks(path.join(out,'books.db'));
const group=name=>seed.api.groups().find(g=>g.name===name).id;
seed.api.saveLedger({name:'Vendor',groupId:group('Sundry Creditors')});
seed.api.saveLedger({name:'Freight',groupId:group('Indirect Expenses')});
seed.api.saveItem({name:'Widget',unit:'PCS',gstRate:1800,purchaseRate:10000,details:{sku:'WGT-001'}});seed.close();
require('../main');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
app.whenReady().then(async()=>{
  await require('./wait-for-window')();const win=BrowserWindow.getAllWindows()[0],page=win.webContents;page.setBackgroundThrottling(false);win.focus();page.focus();
  const js=code=>page.executeJavaScript(code);
  const api=(method,args)=>js(`window.books.call(${JSON.stringify(method)},${JSON.stringify(args||{})})`);
  async function press(keyCode,modifiers=[]){page.sendInputEvent({type:'keyDown',keyCode,modifiers});page.sendInputEvent({type:'keyUp',keyCode,modifiers});await sleep(150);}
  async function type(text){await page.insertText(text);await sleep(80);}
  async function enter(text){await type(text);await press('Enter');}
  async function go(name){await press('k',['control']);await enter(name);await sleep(150);}
  async function replace(text){await press('a',['control']);await type(text);}
  const title=()=>js('document.querySelector("#title").textContent');
  const text=()=>js('document.querySelector("main").innerText');
  async function shot(name){win.show();win.focus();await sleep(350);fs.writeFileSync(path.join(out,`${name}.png`),(await page.capturePage()).toPNG());}
  try{
    await go('Additional fields');await press('c',['alt']);await type('Delivery gate');
    await press('Tab');await press('Down');await press('Down');await press('Down');
    await press('Tab');await press('Space');await press('Tab');await press('Tab');await type('Gate A\nGate B');await press('s',['control']);
    const fields=await api('customFields');assert.equal(fields[0].kind,'select');assert.equal(fields[0].required,1);
    await go('Forms & feature settings');
    for(let i=0;i<5;i++)await press('Tab');await replace('10');await press('Tab');await type('Payment within ten days');await press('s',['control']);
    assert.equal((await api('settings')).defaultCreditDays,10);await shot('settings');
    await go('Create Vouchers');await press('F9');assert.equal(await title(),'Purchase bill');
    await press('F2');await replace('01-11-2026');await press('Enter');
    await enter('Vendor');await enter('WGT-001');await enter('B1');await enter('01-2030');await enter('2');
    await replace('100');await press('Tab');await type('10');await press('Tab');await replace('18');await press('Enter');
    await press('s',['control']);assert.match(await js('document.querySelector("#toast").textContent'),/Delivery gate is required/);
    assert.equal((await api('dayBook')).length,0);
    await press('e',['alt']);await type('SUP-42');await press('Tab');await type('PO-42');await press('Tab');await type('Goods inward');await press('Tab');
    await replace('15-11-2026');await press('Tab');await type('Check seals');await press('Tab');await press('Tab');await type('0.50');await press('Tab');await press('Down');
    await press('l',['alt']);await enter('Freight');await enter('5');await press('Enter');
    await press('a',['alt']);await sleep(200);assert.equal(await js('document.querySelectorAll(".attachment-card img").length'),1);
    assert.ok(await js('document.querySelector(".attachment-card img").naturalWidth > 0'));
    await shot('purchase-details');await press('s',['control']);
    const docs=await api('dayBook');assert.equal(docs.length,1);
    const doc=await api('invoice',{id:docs[0].id});assert.equal(doc.details.billNumber,'SUP-42');assert.equal(doc.details.custom[fields[0].id],'Gate A');assert.equal(doc.items[0].discountPct,1000);assert.equal(doc.details.attachments.length,1);
    assert.equal((await api('voucher',{id:doc.id})).lines.filter(l=>l.amount<0).reduce((s,l)=>s-l.amount,0),21790);
    await press('h',['control']);await go('Bills');await press('Enter');assert.match(await title(),/Purchase bill/);
    await press('e',['alt']);assert.equal(await js('document.querySelector(".entry-page input").value'),'SUP-42');
    await press('PageDown');await press('PageDown');assert.match(await text(),/Delivery gate/);await press('PageDown');
    await js('[...document.querySelectorAll(".attachment-card button")].find(b=>b.textContent==="Save a copy").click()');await sleep(200);assert.deepEqual(fs.readFileSync(path.join(out,'exported.png')),fs.readFileSync(photo));
    await shot('saved-purchase');await press('h',['control']);
    await go('Masters');await press('F3');await press('c',['alt']);await type('Photo item');await press('a',['alt']);await press('s',['control']);
    const item=(await api('items')).find(i=>i.name==='Photo item');assert.ok(item);assert.equal((await api('recordDetails',{scope:'item',id:item.id})).attachments.length,1);
    await press('h',['control']);await go('Create Vouchers');await press('F5');
    await enter('Cash');await enter('Vendor');await enter('10');await press('Enter');
    await press('e',['alt']);await type('Payment reference');await press('Tab');await type('Local receipt proof');await press('Tab');await press('Down');await press('s',['control']);
    const payment=(await api('dayBook')).find(d=>d.type==='Payment');assert.ok(payment);
    assert.equal((await api('voucher',{id:payment.id})).details.reference,'Payment reference');
    console.log(`DETAILS SMOKE OK. Screenshots: ${out}`);app.exit(0);
  }catch(e){await shot('failure');console.error(`DETAILS SMOKE FAILED: ${e.stack}\nTitle: ${await title()}\nScreenshots: ${out}`);app.exit(1);}
});
