'use strict';
const {app,BrowserWindow,dialog}=require('electron');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {openBooks}=require('../src/books');
const out=fs.mkdtempSync(path.join(os.tmpdir(),'speedoone-pages-'));
process.env.SPEEDOONE_DATA_DIR=out;
const paths=Array.from({length:3},(_,i)=>path.join(out,`proof-${i}.png`));
for(const file of paths)fs.writeFileSync(file,Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aF9sAAAAASUVORK5CYII=','base64'));
dialog.showOpenDialog=async()=>({canceled:false,filePaths:paths});
const seed=openBooks(path.join(out,'books.db')),a=seed.api;
const group=name=>a.groups().find(row=>row.name===name).id;
a.saveLedger({name:'Customer',groupId:group('Sundry Debtors')});
a.saveLedger({name:'Freight',groupId:group('Indirect Expenses')});
a.saveItem({name:'Widget',unit:'PCS',saleRate:10000});
for(let i=1;i<=12;i++)a.saveCustomField({scope:'document',label:`Extra ${i}`,kind:'text',position:i});
seed.close();require('../main');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
app.whenReady().then(async()=>{
  await require('./wait-for-window')();const win=BrowserWindow.getAllWindows()[0],page=win.webContents;
  win.setSize(1100,720);page.setBackgroundThrottling(false);win.show();win.focus();page.focus();
  const js=code=>page.executeJavaScript(code);
  const api=(name,args={})=>js(`window.books.call(${JSON.stringify(name)},${JSON.stringify(args)})`);
  const title=()=>js('document.querySelector("#title").textContent');
  async function press(keyCode,modifiers=[]){page.sendInputEvent({type:'keyDown',keyCode,modifiers});page.sendInputEvent({type:'keyUp',keyCode,modifiers});await sleep(120);}
  async function type(text){await page.insertText(text);await sleep(50);}
  async function enter(text){await type(text);await press('Enter');}
  async function go(name){await press('k',['control']);await enter(name);await sleep(150);}
  async function shot(name){await sleep(200);fs.writeFileSync(path.join(out,`${name}.png`),(await page.capturePage()).toPNG());}
  async function fits(){
    for(const height of [640,720]){
    win.setSize(1100,height);
    await sleep(150);
    const overflow=await js(`[...document.querySelectorAll('#nav,.creation-editor,.creation-rail,.keyboard-voucher,.entry-page,.entry-page-content,.paged-master')].filter(el=>el.getClientRects().length&&(el.scrollHeight>el.clientHeight+2||el.scrollWidth>el.clientWidth+2)).map(el=>({class:el.className,height:[el.clientHeight,el.scrollHeight],width:[el.clientWidth,el.scrollWidth]}))`);
    assert.deepEqual(overflow,[],'Entry content must fit, not be clipped behind hidden scrollbars');
    }
  }
  try{
    await go('Create Vouchers');await press('F3');await enter('Customer');
    for(let i=0;i<8;i++){await enter('Widget');await type('1');await press('Enter',['control']);}
    assert.equal(await js('document.querySelectorAll(".lines tbody tr:not([hidden])").length'),1);
    await fits();await shot('items');
    // Choice fields own PgUp; voucher rows page from a quantity field.
    await js(`document.querySelector('.lines tbody tr:not([hidden]) input[aria-label^="qty for"]').focus()`);
    await press('PageUp');assert.match(await js('document.querySelector(".line-actions .row-pages span").textContent'),/Items 5–8 of 9/);await fits();
    await press('n',['alt']);await press('Enter');assert.equal(await title(),'Ledger / expense entries');
    await press('c',['alt']);await type('Keyboard charge');await press('s',['control']);assert.equal(await title(),'Ledger / expense entries');
    await enter('Keyboard charge');await enter('1');
    for(let i=0;i<10;i++){await enter('Freight');await enter('1');}
    assert.equal(await js('document.querySelectorAll(".charge-row:not([hidden])").length'),2);
    await fits();await shot('charges');assert.equal(await js('document.activeElement.placeholder'),'Expense / adjustment ledger');await press('Enter');assert.equal(await title(),'Quotation');
    await press('e',['alt']);assert.equal(await title(),'Record details');
    await type('ENQ-PAGES');await press('PageDown');await press('PageDown');
    for(let i=1;i<=12;i++){await type(`Value ${i}`);if(i<12)await press('Tab');}
    await fits();await shot('custom-fields');
    await press('a',['alt']);await sleep(200);assert.equal(await js('document.querySelectorAll(".attachment-card:not([hidden])").length'),2);
    await press('Tab');await press('PageDown');assert.equal(await js('document.querySelectorAll(".attachment-card:not([hidden])").length'),1);
    await fits();await shot('attachments');
    await press('h',['control']);await press('n');assert.equal(await title(),'Quotation');await fits();
    await press('e',['alt']);assert.equal(await js('document.querySelector(".entry-page input").value'),'ENQ-PAGES');
    await press('s',['control']);
    const saved=(await api('dayBook',{types:['Quotation']}))[0];assert.ok(saved);
    const doc=await api('invoice',{id:saved.id});assert.equal(doc.items.length,8);assert.equal(doc.details.charges.length,11);assert.equal(doc.details.attachments.length,3);
    assert.deepEqual(Object.values(doc.details.custom),Array.from({length:12},(_,i)=>`Value ${i+1}`));
    await go('Create Vouchers');await press('F5');await enter('Cash');
    for(let i=0;i<10;i++){await enter('Freight');await enter('2');}
    await fits();await shot('allocations');await press('Enter');await press('s',['control']);
    assert.equal((await api('dayBook',{types:['Payment']}))[0].amount,2000);
    await go('Masters');await press('F3');await press('c',['alt']);await type('Paged master');await fits();await press('PageDown');await fits();await shot('master-prices');
    await press('s',['control']);assert.ok((await api('items')).some(row=>row.name==='Paged master'));
    for(const key of ['F1','F2','F8']){await press(key);await fits();}
    console.log(`PAGES SMOKE OK. Screenshots: ${out}`);app.exit(0);
  }catch(error){await shot('failure');console.error(`${error.stack}\nTitle: ${await title()}\nScreenshots: ${out}`);app.exit(1);}
});
