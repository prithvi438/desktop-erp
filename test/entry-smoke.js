'use strict';
const {app,BrowserWindow}=require('electron');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {openBooks}=require('../src/books');
const out=fs.mkdtempSync(path.join(os.tmpdir(),'desktop-erp-entry-'));
process.env.DESKTOP_ERP_DATA_DIR=out;
const seed=openBooks(path.join(out,'books.db'));
const group=name=>seed.api.groups().find(row=>row.name===name).id;
seed.api.saveLedger({name:'Acme Customer',groupId:group('Sundry Debtors')});
seed.api.saveItem({name:'Desk Lamp',unit:'PCS',gstRate:1800,saleRate:10000,purchaseRate:8000});
seed.close();require('../main');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
app.whenReady().then(async()=>{
  await require('./wait-for-window')();const win=BrowserWindow.getAllWindows()[0],page=win.webContents;
  page.setBackgroundThrottling(false);win.show();win.focus();page.focus();
  const js=code=>page.executeJavaScript(code);
  const api=(name,args={})=>js(`window.books.call(${JSON.stringify(name)},${JSON.stringify(args)})`);
  const title=()=>js('document.querySelector("#title").textContent');
  const focused=()=>js('document.activeElement.textContent');
  async function press(keyCode,modifiers=[]){page.sendInputEvent({type:'keyDown',keyCode,modifiers});page.sendInputEvent({type:'keyUp',keyCode,modifiers});await sleep(150);}
  async function type(text){await page.insertText(text);await sleep(60);}
  async function enter(text){await type(text);await press('Enter');}
  async function replace(text){await press('a',['control']);await type(text);}
  async function go(name){await press('k',['control']);await enter(name);await sleep(150);}
  async function shot(name){await sleep(300);fs.writeFileSync(path.join(out,`${name}.png`),(await page.capturePage()).toPNG());}
  try{
    await go('Registers');assert.equal(await focused(),'Payment register');
    for(const label of ['Receipt register','Contra register','Journal register','Sales register','Purchase register']){
      await press('Tab');assert.equal(await focused(),label);
    }
    await press('Tab',['shift']);assert.equal(await focused(),'Sales register');
    await press('Enter');assert.equal(await title(),'Registers');
    await go('Trial balance');await press('F2',['shift']);assert.equal(await js('!!document.querySelector(".overlay")'),true);await press('Escape');
    await go('Create Vouchers');await press('F3');assert.equal(await title(),'Quotation');
    await enter('Acme');await type('Desk');await press('Tab'); // Tab accepts the highlighted item.
    assert.equal(await js('document.activeElement.getAttribute("aria-label")'),'qty for item 1');
    await enter('2');assert.equal(await js('document.activeElement.getAttribute("aria-label")'),'rate for item 1');
    await replace('120');await press('Enter');await enter('10');await press('Enter');
    assert.equal(await js('document.activeElement.getAttribute("aria-label")'),'item for item 2');
    await press('Tab',['shift']);assert.equal(await js('document.activeElement.getAttribute("aria-label")'),'gst for item 1');
    await press('d',['alt']);await type('Warm white, brass finish');await press('Enter');
    await press('n',['alt']);await press('i',['alt']);await type('Installation');await press('s',['control']);
    assert.equal(await title(),'Quotation');await enter('Installation');await type('1');await press('Tab');await replace('50');await press('Enter',['control']);
    await press('Delete',['control']); // remove unused trailing line without a prompt
    assert.equal(await js('document.querySelectorAll(".lines tbody tr").length'),2);
    await press('Delete',['control']);await press('n');assert.equal(await js('document.querySelectorAll(".lines tbody tr").length'),2);
    await press('e',['alt']);
    assert.equal(await js('document.activeElement.closest("label").querySelector("span").textContent'),'Enquiry / customer reference');
    await type('ENQ-18');await press('Tab');await type('Quote reference');await press('Tab');await replace('30-11-2026');
    await press('Tab');await type('Delivery within seven days');await press('Tab');await type('Prices valid until the date shown.');
    await shot('quotation');win.setSize(1100,720);await shot('quotation-compact');win.setSize(1400,860);
    await press('s',['control']);
    const documents=await api('dayBook');const saved=documents.find(row=>row.type==='Quotation');assert.ok(saved);
    const quote=await api('invoice',{id:saved.id});assert.equal(quote.items.length,2);assert.equal(quote.items[0].rate,12000);assert.equal(quote.items[0].discountPct,1000);
    assert.equal(quote.items[0].description,'Warm white, brass finish');assert.equal(quote.details.dueDate,'2026-11-30');assert.equal(quote.details.orderNumber,'ENQ-18');
    assert.equal(quote.details.terms,'Prices valid until the date shown.');assert.equal((await api('items')).find(row=>row.name==='Desk Lamp').stock,0);
    await go('Quotations');await press('Enter');assert.match(await title(),/^Alter: Quotation/);
    await press('e',['alt']);assert.match(await js('document.querySelector(".entry-page").textContent'),/Quotation valid until/);await press('Escape');
    assert.equal(await js('document.querySelector(".line-description").value'),'Warm white, brass finish');
    await press('Delete',['control']);await press('y');assert.equal(await js('document.querySelectorAll(".lines tbody tr").length'),1);
    await press('h',['control']);await press('n');assert.match(await title(),/^Alter: Quotation/);
    await press('h',['control']);await press('y');
    await go('Masters');await press('F3');await press('c',['alt']);await type('Keyboard master');await press('s',['control']);
    assert.equal(await js('document.querySelector("#title").textContent'),'Masters');
    assert.ok((await api('items')).some(row=>row.name==='Keyboard master'));await shot('masters');
    console.log(`ENTRY SMOKE OK. Screenshots: ${out}`);app.exit(0);
  }catch(error){await shot('failure');console.error(`${error.stack}\nTitle: ${await title()}\nScreenshots: ${out}`);app.exit(1);}
});
