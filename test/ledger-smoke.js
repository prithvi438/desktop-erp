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
  async function chooseGroup(text){
    for(let n=0;n<20;n++){
      if(await js('document.activeElement.closest("label")?.querySelector("span")?.textContent === "Under group *"'))break;
      await press('Tab',['shift']);
    }
    assert.equal(await js('document.activeElement.closest("label")?.querySelector("span")?.textContent'),'Under group *');
    await replace(text);await press('Enter');
  }
  const kind=()=>js('document.querySelector(".ledger-compact").dataset.ledgerKind');
  try{
    const debtor=(await api('groups')).find(g=>g.name==='Sundry Debtors');
    await api('saveGroup',{name:'Local debtors',parentId:debtor.id});
    await press('k',['control']);await type('Masters');await press('Enter');
    assert.deepEqual(await js('[...document.querySelectorAll(".manage-rail > button span")].map(e=>e.textContent).slice(0,4)'),['Ledgers','Account groups','Items','Pricebooks']);
    await press('c',['alt']);assert.equal(await title(),'Create ledger');
    await type('Unified customer');await press('Enter');await type('Local debtors');await press('Enter');assert.equal(await kind(),'customer');
    await type('125');await press('Tab');await press('c');await press('Tab');await type('12 Market Street');await press('Tab');await type('accounts@example.test');await press('Tab');await type('9876543210');await press('Tab');await type('27AAAAA0000A1Z5');await press('Tab');await type('Maharashtra');
    await press('b',['alt']);await type('30');await press('Tab');await type('5000');await press('s',['control']);assert.equal(await title(),'Masters');
    const customer=(await api('ledgers')).find(r=>r.name==='Unified customer');assert.equal(customer.opening,-12500);assert.equal(customer.creditDays,30);assert.equal(customer.creditLimit,500000);
    let details=await api('recordDetails',{scope:'ledger',id:customer.id});assert.equal(details.address,'12 Market Street');assert.equal(details.email,'accounts@example.test');
    await search('Unified customer');await press('Enter');assert.equal(await kind(),'customer');
    await press('Enter');await replace('Sundry Creditors');await press('Enter');assert.equal(await kind(),'supplier');
    assert.equal(await js('document.querySelector(".ledger-customer-controls").hidden'),true);
    await chooseGroup('Cash-in-Hand');assert.equal(await kind(),'cash');assert.equal(await js('document.querySelector(".ledger-party").hidden'),true);
    await chooseGroup('Local debtors');assert.equal(await js('document.querySelector(".ledger-party input").value'),'12 Market Street');
    await press('s',['control']);
    await press('c',['alt']);await type('Unified bank');await press('Enter');await type('Bank Accounts');await press('Enter');assert.equal(await kind(),'bank');
    await press('Tab');await press('Tab');await type('Example Bank');await press('Tab');await type('Speedo Traders');await press('Tab');await type('001234567890');await press('Tab');await type('Central Branch');await press('Tab');await type('TEST0000123');
    await shot('bank-ledger');await press('s',['control']);
    const bank=(await api('ledgers')).find(r=>r.name==='Unified bank');details=await api('recordDetails',{scope:'ledger',id:bank.id});assert.equal(details.accountNumber,'001234567890');assert.equal(details.ifsc,'TEST0000123');assert.equal(details.branch,'Central Branch');
    await search('Unified bank');await press('Enter');assert.equal(await kind(),'bank');assert.equal(await js('document.querySelectorAll(".ledger-bank input")[2].value'),'001234567890');
    await press('Enter');await replace('Cash-in-Hand');await press('Enter');await press('s',['control']);
    assert.equal((await api('recordDetails',{scope:'ledger',id:bank.id})).accountNumber,'001234567890');
    await search('Unified bank');await press('Enter');assert.equal(await kind(),'cash');await shot('cash-ledger');await press('Escape');
    await search('Unified customer');await press('Enter');await shot('customer-ledger');
    for(const [width,height] of [[1100,640],[1400,860]]){win.setSize(width,height);await sleep(200);assert.equal(await js('document.querySelector(".ledger-compact").scrollWidth<=document.querySelector(".ledger-compact").clientWidth+2'),true);await shot(`unified-${width}`);}
    await press('e',['alt']);assert.equal(await js('document.querySelectorAll(".entry-page input").length'),0); // Inline contact fields are not duplicated in Details.
    console.log(`LEDGER SMOKE OK. Screenshots: ${out}`);app.exit(0);
  }catch(error){await shot('failure');console.error(`${error.stack}\nTitle: ${await title()}\nScreenshots: ${out}`);app.exit(1);}
});
