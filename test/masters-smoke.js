'use strict';
const {app,BrowserWindow}=require('electron');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {openBooks}=require('../src/books');
const out=fs.mkdtempSync(path.join(os.tmpdir(),'desktop-erp-manage-'));
process.env.DESKTOP_ERP_DATA_DIR=out;
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
    await press('k',['control']);await type('Masters');await press('Enter');
    assert.equal(await title(),'Masters');
    assert.equal(await js('document.querySelector("#nav [aria-current] strong").textContent'),'Masters');
    assert.equal(await js('document.querySelector(".manage-rail").getBoundingClientRect().right < document.querySelector(".manage-body").getBoundingClientRect().left'),true);
    await fits();await shot('masters-ledgers');
    // Typing from the focused ledger rows starts searching, including the first letter.
    await press('u');await type('nu');
    assert.equal(await js('document.activeElement.getAttribute("aria-label")'),'Search records');
    assert.equal(await js('document.activeElement.value'),'unu');
    assert.match(await selected(),/Unused ledger/);
    await press('Backspace');assert.equal(await js('document.activeElement.value'),'un');
    await press('Enter');assert.equal(await title(),'Alter ledger');await press('Escape');
    await press('F1');await press('b');await type('u');assert.match(await selected(),/Buyer/);
    await search('');await press('F1');
    const first=await selected();await press('PageDown');assert.notEqual(await selected(),first);await press('PageUp');assert.equal(await selected(),first);
    await press('m',['alt']);await press('Down');assert.equal(await js('document.activeElement.textContent'),'F2Account groups');
    await press('PageDown');assert.equal(await js('document.activeElement.textContent'),'F3Items');
    await press('PageUp');await press('Up');assert.equal(await js('document.activeElement.textContent'),'F1Ledgers');
    await press('Tab');assert.equal(await js('document.activeElement.className'),'manage-results');
    await press('Tab',['shift']);assert.equal(await js('document.activeElement.textContent'),'F1Ledgers');
    await press('Tab');await search('Unused ledger');await press('Enter');assert.equal(await title(),'Alter ledger');
    await type('Unused ledger edited');await press('s',['control']);assert.equal(await title(),'Masters');
    assert.equal((await api('ledgers')).find(row=>row.id===unused).name,'Unused ledger edited');
    await remove('n');assert.ok((await api('ledgers')).some(row=>row.id===unused));await remove();assert.equal((await api('ledgers')).some(row=>row.id===unused),false);
    await search('Buyer');await remove();assert.match(await js('document.querySelector("#toast").textContent'),/has vouchers/);
    await press('F1');await press('c',['alt']);assert.equal(await title(),'Create ledger');await type('New keyboard customer');await press('Enter');await type('Sundry Debtors');await press('Enter');await press('s',['control']);assert.equal(await title(),'Masters');
    await search('New keyboard customer');assert.match(await selected(),/New keyboard customer/);await remove();
    await press('F3');await search('Unused item');await press('Enter');assert.match(await title(),/Alter item/);await type('Renamed item');await press('s',['control']);await search('Renamed item');await remove();
    assert.equal((await api('items')).some(row=>row.id===spare),false);
    await press('F2');await search('Sundry Debtors');await press('Down');assert.equal(await js('document.querySelector(".danger-action").disabled'),true);
    await search('Custom group');await press('Enter');await type('Renamed group');await press('s',['control']);await search('Renamed group');await remove();
    assert.equal((await api('groups')).some(row=>row.id===custom),false);
    await press('F4');await press('Enter');assert.equal(await title(),'Edit pricebook');await replace('Retail edited');await press('s',['control']);await remove();
    assert.equal((await api('pricebooks')).some(row=>row.id===pricebook),false);
    await press('F1');await search('');await press('F9');await fits();await shot('masters-final');
    await press('c',['alt']);await type('Unsaved');await press('Escape');await press('n');assert.equal(await title(),'Create ledger');await press('Escape');await press('y');assert.equal(await title(),'Masters');
    await press('F5');await press('c',['alt']);await type('Keyboard category');await press('s',['control']);
    assert.equal((await api('catalogMasters',{kind:'category'}))[0].name,'Keyboard category');
    await press('F7');await press('c',['alt']);await type('BOX');await press('s',['control']);
    const slab=(await api('saveCatalogMaster',{kind:'gstSlab',name:'Test slab',rate:1200})).id;
    await api('saveCatalogMaster',{kind:'hsn',name:'1234',relatedId:slab});
    await press('F3');await press('c',['alt']);await type('Mapped keyboard item');await press('Enter');await replace('BOX');await press('Enter');await press('Enter');await press('Enter');await type('Keyboard category');await press('Enter');await press('Enter');await press('Enter');await press('Enter');await type('1234');await press('Enter');await press('s',['control']);
    const mapped=(await api('items')).find(row=>row.name==='Mapped keyboard item');
    assert.ok(mapped);assert.equal(mapped.unit,'BOX');assert.equal(mapped.hsn,'1234');assert.equal(mapped.gstRate,1200);assert.equal(mapped.category,'Keyboard category');
    await api('saveSettings',{...(await api('settings')),dropdownMasters:true});
    await press('Escape');await press('k',['control']);await type('Masters');await press('Enter');
    assert.equal(await js('[...document.querySelectorAll(".manage-rail > button")].some(el=>el.textContent.includes("Dropdowns"))'),true);
    await fits();await shot('catalog-masters');
    await press('F11');assert.equal(await js('document.querySelector(".manage-heading h2").textContent'),'GST slabs');
    await press('F12');assert.equal(await js('document.querySelector(".manage-heading h2").textContent'),'HSN / SAC');
    assert.equal(await js('document.querySelector(".manage-rail > button.active kbd").textContent'),'F12');
    await press('F9');assert.equal(await js('document.querySelector(".manage-heading h2").textContent'),'HSN / SAC');
    console.log(`MASTERS SMOKE OK. Screenshots: ${out}`);app.exit(0);
  }catch(error){await shot('failure');console.error(`${error.stack}\nTitle: ${await title()}\nScreenshots: ${out}`);app.exit(1);}
});
