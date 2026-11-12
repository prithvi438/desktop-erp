'use strict';
const {app,BrowserWindow}=require('electron');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {openBooks}=require('../src/books');
const out=fs.mkdtempSync(path.join(os.tmpdir(),'speedoone-manage-'));
process.env.SPEEDOONE_DATA_DIR=out;
const seed=openBooks(path.join(out,'books.db')),a=seed.api;
const group=name=>a.groups().find(row=>row.name===name).id;
const buyer=a.saveLedger({name:'Buyer',groupId:group('Sundry Debtors')}).id;
const supplier=a.saveLedger({name:'Supplier',groupId:group('Sundry Creditors')}).id;
const unused=a.saveLedger({name:'Unused ledger',groupId:group('Indirect Expenses')}).id;
for(let i=0;i<30;i++)a.saveLedger({name:`Customer ${String(i).padStart(2,'0')}`,groupId:group('Sundry Debtors')});
const item=a.saveItem({name:'Stock item',unit:'PCS',saleRate:10000}).id;
const spare=a.saveItem({name:'Unused item',unit:'PCS'}).id;
const custom=a.saveGroup({name:'Custom group',parentId:group('Sundry Debtors')}).id;
const pricebook=a.savePricebook({name:'Retail'}).id;
const purchase=a.saveInvoice({type:'Purchase',date:'2026-11-01',partyId:supplier,items:[{itemId:item,qty:10000,rate:8000}]}).id;
const sale=a.saveInvoice({type:'Sales',date:'2026-11-02',partyId:buyer,items:[{itemId:item,qty:1000,rate:10000}]}).id;
const quote=a.saveInvoice({type:'Quotation',date:'2026-11-03',partyId:buyer,items:[{itemId:item,qty:1000,rate:10000}]}).id;
const cash=a.ledgers().find(row=>row.name==='Cash').id;
const payment=a.saveVoucher({type:'Payment',date:'2026-11-04',narration:'Supplier payment',lines:[{ledgerId:supplier,amount:1000},{ledgerId:cash,amount:-1000}]}).id;
for(let i=0;i<25;i++)a.saveVoucher({type:'Journal',date:'2026-11-01',narration:`Opening adjustment ${i}`,lines:[{ledgerId:buyer,amount:100},{ledgerId:cash,amount:-100}]});
seed.close();require('../main');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
app.whenReady().then(async()=>{
  await require('./wait-for-window')();const win=BrowserWindow.getAllWindows()[0],page=win.webContents;
  win.setSize(1100,720);page.setBackgroundThrottling(false);win.show();win.focus();page.focus();
  const js=code=>page.executeJavaScript(code);
  const api=(name,args={})=>js(`window.books.call(${JSON.stringify(name)},${JSON.stringify(args)})`);
  const title=()=>js('document.querySelector("#title").textContent');
  const selected=()=>js('document.querySelector(".manage-results tr.on")?.textContent');
  async function press(keyCode,modifiers=[]){page.sendInputEvent({type:'keyDown',keyCode,modifiers});page.sendInputEvent({type:'keyUp',keyCode,modifiers});await sleep(140);}
  async function type(text){await page.insertText(text);await sleep(70);}
  async function search(text){await press('l',['control']);await type(text);}
  async function replace(text){await press('a',['control']);await type(text);}
  async function shot(name){await sleep(150);fs.writeFileSync(path.join(out,`${name}.png`),(await page.capturePage()).toPNG());}
  async function fits(){
    for(const height of [640,720,900]){
      win.setSize(1100,height);await sleep(160);
      const overflow=await js(`[...document.querySelectorAll('#nav,.manage-workspace,.manage-body,.manage-rail,.manage-results')].filter(el=>el.getClientRects().length&&(el.scrollHeight>el.clientHeight+2||el.scrollWidth>el.clientWidth+2)).map(el=>({class:el.className,height:[el.clientHeight,el.scrollHeight],width:[el.clientWidth,el.scrollWidth]}))`);
      assert.deepEqual(overflow,[],'Management content must fit without scrolling or clipping');
      assert.equal(await js('document.querySelector(".manage-workspace").getBoundingClientRect().right<=innerWidth'),true);
    }
    win.setSize(1100,720);await sleep(150);
  }
  async function remove(confirm='y'){await press('d',['alt']);assert.equal(await js('!!document.querySelector(".dialog")'),true);await press(confirm);}
  try{
    await press('k',['control']);await type('Manage Records');await press('Enter');
    assert.equal(await title(),'Manage Records');
    assert.equal(await js('document.querySelector("#nav [aria-current] strong").textContent'),'Manage Records');
    await fits();await shot('ledgers');
    const first=await selected();await press('PageDown');assert.notEqual(await selected(),first);await press('PageUp');assert.equal(await selected(),first);
    await search('Unused ledger');await press('Enter');assert.equal(await title(),'Alter ledger');
    await type('Unused ledger edited');await press('s',['control']);assert.equal(await title(),'Manage Records');
    assert.equal((await api('ledgers')).find(row=>row.id===unused).name,'Unused ledger edited');
    assert.match(await selected(),/Unused ledger edited/);await remove('n');assert.ok((await api('ledgers')).some(row=>row.id===unused));
    await remove();assert.equal((await api('ledgers')).some(row=>row.id===unused),false);
    await search('Buyer');await remove();assert.match(await js('document.querySelector("#toast").textContent'),/has vouchers/);
    await press('F2');await search('Unused item');await press('Enter');assert.match(await title(),/Alter item/);
    await type('Unused item edited');await press('s',['control']);assert.equal((await api('items')).find(row=>row.id===spare).name,'Unused item edited');
    await remove();assert.equal((await api('items')).some(row=>row.id===spare),false);
    await search('Stock item');await remove();assert.match(await js('document.querySelector("#toast").textContent'),/has documents/);await fits();
    await press('F3');await search('Sundry Debtors');await press('Down');assert.equal(await js('document.querySelector(".danger-action").disabled'),true);
    await press('Enter');assert.equal(await title(),'Manage Records');
    await search('Custom group');await press('Enter');assert.equal(await title(),'Alter group');await type('Custom group edited');
    await press('Escape');assert.equal(await js('!!document.querySelector(".dialog")'),true);await press('n');await press('s',['control']);
    assert.equal((await api('groups')).find(row=>row.id===custom).name,'Custom group edited');await remove();assert.equal((await api('groups')).some(row=>row.id===custom),false);
    await search('');await fits();await shot('groups');
    await press('F4');await press('Enter');assert.equal(await title(),'Edit pricebook');await replace('Retail edited');await press('s',['control']);
    assert.equal((await api('pricebooks')).find(row=>row.id===pricebook).name,'Retail edited');
    await press('p',['alt']);assert.equal(await title(),'Prices: Retail edited');await press('Escape');assert.equal(await title(),'Manage Records');await remove();
    await press('F5');await fits();await shot('vouchers');
    await search('Quotation');await press('Enter');assert.match(await title(),/Quotation/);
    // Re-saving a document exercises the same editor used by voucher creation.
    await press('s',['control']);assert.equal(await title(),'Manage Records');assert.equal((await api('invoice',{id:quote})).items.length,1);
    await remove('n');assert.ok((await api('dayBook')).some(row=>row.id===quote));await remove();assert.equal((await api('dayBook')).some(row=>row.id===quote),false);
    await search('Supplier payment');await press('Enter');assert.match(await title(),/Payment/);await press('s',['control']);assert.equal(await title(),'Manage Records');
    assert.equal((await api('voucher',{id:payment})).lines.length,2);
    await search('Purchase');await remove();assert.match(await js('document.querySelector("#toast").textContent'),/negative stock/);
    await search('Sales');await remove();assert.equal((await api('dayBook')).some(row=>row.id===sale),false);
    await search('Purchase');await remove();assert.equal((await api('dayBook')).some(row=>row.id===purchase),false);
    await search('');await press('Tab');assert.equal(await js('document.activeElement.getAttribute("aria-label")'),'Record type');
    await press('Down');await press('Down');await press('Down');await press('Enter');
    assert.equal(await js('document.querySelector(".manage-filters select").value'),'Payment');
    for(const label of ['Single date','Date range','All dates']){await press('Tab');assert.equal(await js('document.activeElement.textContent'),label);}
    await press('Tab');assert.equal(await js('document.activeElement.getAttribute("aria-label")'),'From date');
    await type('05-11-2026');assert.equal(await js('document.querySelectorAll(".manage-results tbody tr").length'),0);
    await replace('01-11-2026');assert.equal(await js('document.querySelectorAll(".manage-results tbody tr").length'),1);
    await press('Tab',['shift']);await press('Tab',['shift']);await press('Tab',['shift']);await press('Enter');
    await replace('04-11-2026');assert.equal(await js('document.querySelectorAll(".manage-results tbody tr").length'),1);
    assert.equal(await js(`document.querySelector('[aria-label="To date"]').value`),'04-11-2026');
    await replace('05-11-2026');assert.equal(await js('document.querySelectorAll(".manage-results tbody tr").length'),0);
    await press('F1');assert.match(await selected(),/Buyer/); // Per-category search is retained.
    await press('c',['alt']);assert.equal(await title(),'Create ledger');await type('Do not save');await press('Escape');await press('n');assert.equal(await title(),'Create ledger');
    await press('Escape');await press('y');assert.equal(await title(),'Manage Records');
    assert.equal((await api('ledgers')).some(row=>row.name==='Do not save'),false);
    await press('F6');assert.match(await selected(),/Buyer/);
    await press('b',['control']);assert.equal(await js('!!document.activeElement.closest("#nav")'),true);
    await press('h',['control']);assert.equal(await title(),'Dashboard');
    console.log(`MANAGE SMOKE OK. Screenshots: ${out}`);app.exit(0);
  }catch(error){await shot('failure');console.error(`${error.stack}\nTitle: ${await title()}\nScreenshots: ${out}`);app.exit(1);}
});
