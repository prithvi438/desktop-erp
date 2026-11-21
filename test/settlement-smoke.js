'use strict';
const {app,BrowserWindow}=require('electron');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {openBooks}=require('../src/books');
const out=fs.mkdtempSync(path.join(os.tmpdir(),'desktop-erp-settlement-'));
process.env.DESKTOP_ERP_DATA_DIR=out;
const seed=openBooks(path.join(out,'books.db')),a=seed.api;
const group=name=>a.groups().find(row=>row.name===name).id;
const child=a.saveGroup({name:'Branch banks',parentId:group('Bank Accounts')}).id;
const bank=a.saveLedger({name:'Branch bank',groupId:child}).id;
const vendor=a.saveLedger({name:'Vendor',groupId:group('Sundry Creditors')}).id;
const customer=a.saveLedger({name:'Customer',groupId:group('Sundry Debtors')}).id;
const expense=a.saveLedger({name:'Freight',groupId:group('Indirect Expenses')}).id;
const income=a.saveLedger({name:'Consulting income',groupId:group('Indirect Incomes')}).id;
a.saveLedger({name:'Input GST example',groupId:group('Duties & Taxes')});
const item=a.saveItem({name:'Widget',unit:'PCS',saleRate:10000,purchaseRate:5000}).id;
a.saveInvoice({type:'Purchase',date:'2020-01-01',partyId:vendor,items:[{itemId:item,qty:10000,rate:5000}]});
seed.close();require('../main');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
app.whenReady().then(async()=>{
  await require('./wait-for-window')();const win=BrowserWindow.getAllWindows()[0],page=win.webContents;
  page.setBackgroundThrottling(false);win.show();win.focus();page.focus();
  const js=code=>page.executeJavaScript(code);
  const api=(name,args={})=>js(`window.books.call(${JSON.stringify(name)},${JSON.stringify(args)})`);
  const title=()=>js('document.querySelector("#title").textContent');
  async function press(keyCode,modifiers=[]){page.sendInputEvent({type:'keyDown',keyCode,modifiers});page.sendInputEvent({type:'keyUp',keyCode,modifiers});await sleep(150);}
  async function type(text){await page.insertText(text);await sleep(60);}
  async function enter(text){await type(text);await press('Enter');}
  async function go(name){await press('k',['control']);await enter(name);await sleep(150);}
  async function shot(name){await sleep(300);fs.writeFileSync(path.join(out,`${name}.png`),(await page.capturePage()).toPNG());}
  try {
    await go('Create Vouchers');await press('F5');
    const sources=await js('document.querySelector(".choice-panel .suggest").textContent');
    assert.match(sources,/Branch bank/);assert.match(sources,/Cash/);assert.doesNotMatch(sources,/Vendor|Freight|GST/);
    await enter('Branch bank');
    const recipients=await js('document.querySelector(".choice-panel .suggest").textContent');
    assert.match(recipients,/Vendor/);assert.match(recipients,/Freight/);assert.doesNotMatch(recipients,/Branch bank|Cash/);
    await enter('Vendor');await enter('100');await enter('Freight');await enter('20');await press('Enter');
    await type('Split payment');await shot('payment');await press('s',['control']);
    const payment=(await api('dayBook',{types:['Payment']}))[0];assert.ok(payment);
    assert.deepEqual((await api('voucher',{id:payment.id})).lines.map(row=>[row.ledgerId,row.amount]),[[bank,-12000],[vendor,10000],[expense,2000]]);
    await press('F6');await enter('Branch bank');await enter('Customer');await enter('150');await press('Enter');await press('s',['control']);
    const receipt=(await api('dayBook',{types:['Receipt']}))[0];
    assert.deepEqual((await api('voucher',{id:receipt.id})).lines.map(row=>[row.ledgerId,row.amount]),[[bank,15000],[customer,-15000]]);
    await go('Payments made');await press('Enter');assert.match(await title(),/Alter voucher: Payment/);
    assert.equal(await js('document.querySelector(".settlement-source input").value'),'Branch bank');
    assert.equal(await js('document.querySelectorAll(".settlement-allocations tbody tr").length'),2);
    await press('s',['control']);
    await go('Create Vouchers');
    const parties=await js('document.querySelector(".choice-panel .suggest").textContent');
    assert.match(parties,/Customer/);assert.match(parties,/Vendor/);assert.match(parties,/Branch bank/);assert.match(parties,/Cash/);assert.doesNotMatch(parties,/GST|Freight|Consulting/);
    await enter('Customer');await enter('Widget');await type('2');await press('Enter',['control']);await press('Enter');
    assert.equal(await title(),'Sales invoice');
    assert.equal(await js('document.activeElement.placeholder'),'Expense / adjustment ledger');
    await enter('Freight');await type('15');await press('Delete',['control']);
    assert.equal(await title(),'Sales invoice');
    await enter('Freight');await enter('15');await press('Enter');await press('s',['control']);
    const sale=(await api('dayBook',{types:['Sales']}))[0];assert.ok(sale);
    const savedSale=await api('invoice',{id:sale.id});assert.equal(savedSale.items.length,1);assert.equal(savedSale.details.charges[0].amount,1500);
    assert.equal((await api('voucher',{id:sale.id})).lines.reduce((sum,row)=>sum+row.amount,0),0);
    // No item: switch directly to ledger amounts, then reopen the same document editor.
    await enter('Customer');await press('Enter');await enter('Consulting');await enter('250');await press('Enter');
    await shot('ledger-only');await press('s',['control']);
    const ledgerOnly=(await api('dayBook',{types:['Sales']})).at(-1);assert.equal(ledgerOnly.amount,25000);
    assert.equal((await api('invoice',{id:ledgerOnly.id})).items.length,0);
    assert.deepEqual((await api('voucher',{id:ledgerOnly.id})).lines.map(row=>[row.ledgerId,row.amount]),[[customer,25000],[income,-25000]]);
    await go('Invoices');await press('Enter');assert.match(await title(),/Alter: Sales invoice/);
    assert.equal(await js('document.querySelector(".ledger-charges input").value'),'Consulting income');
    await press('h',['control']);await go('Create Vouchers');await press('F9');await enter('Vendor');await press('Enter');await enter('Freight');await enter('35');await press('Enter');await press('s',['control']);
    const purchase=(await api('dayBook',{types:['Purchase']})).at(-1);assert.equal(purchase.amount,3500);
    assert.equal((await api('invoice',{id:purchase.id})).items.length,0);
    // Historic payments containing two source banks remain editable without loss.
    const cash=(await api('ledgers')).find(row=>row.name==='Cash').id;
    const legacy=await api('saveVoucher',{type:'Payment',date:'2026-11-09',lines:[{ledgerId:bank,amount:-300},{ledgerId:cash,amount:-200},{ledgerId:vendor,amount:500}]});
    await go('Payments made');await press('Enter');assert.match(await title(),/Payment/);
    assert.equal(await js('document.querySelector(".settlement").hidden'),false);
    assert.equal(await js('document.querySelector(".voucher > table.lines").hidden'),true);
    await press('s',['control']);assert.equal((await api('voucher',{id:legacy.id})).lines.length,3);
    console.log(`SETTLEMENT SMOKE OK. Screenshots: ${out}`);app.exit(0);
  }catch(error){await shot('failure');console.error(`${error.stack}\nTitle: ${await title()}\nScreenshots: ${out}`);app.exit(1);}
});
