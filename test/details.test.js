'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {openBooks}=require('../src/books');
const {voucherXml}=require('../src/sync');
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aF9sAAAAASUVORK5CYII=','base64');

test('ledger-only documents balance, reopen and appear in registers; party restrictions include subgroups',()=>{
  const book=openBooks(':memory:');const a=book.api;
  try {
    const group=name=>a.groups().find(g=>g.name===name).id;
    const subgroup=a.saveGroup({name:'Local customers',parentId:group('Sundry Debtors')}).id;
    const party=a.saveLedger({name:'Customer',groupId:subgroup}).id;
    const expense=a.saveLedger({name:'Consulting',groupId:group('Indirect Expenses')}).id;
    const gst=a.saveLedger({name:'Input GST test',groupId:group('Duties & Taxes')}).id;
    const cash=a.ledgers().find(l=>l.name==='Cash').id;
    assert.equal(a.ledgers().find(l=>l.id===party).accountGroup,'Sundry Debtors');
    const input={type:'Purchase',date:'2020-01-01',partyId:party,items:[],details:{charges:[{ledgerId:expense,amount:12000}]}};
    const saved=a.saveInvoice(input);assert.equal(saved.total,12000);
    assert.deepEqual(a.voucher(saved).lines.map(l=>[l.ledgerId,l.amount]),[[party,-12000],[expense,12000]]);
    assert.equal(a.invoice(saved).items.length,0);assert.equal(a.dayBook()[0].document,1);
    assert.equal(a.ledgerStatement({ledgerId:party}).rows[0].document,1);
    assert.equal(a.taxRegister({types:['Purchase']}).totals.total,12000);
    assert.equal(a.stockSummary({asOf:'2020-12-31'}).rows.length,0);
    a.saveInvoice({...input,id:saved.id,partyId:cash});assert.equal(a.invoice(saved).partyId,cash);
    for(const invalid of [gst,expense])assert.throws(()=>a.saveInvoice({...input,partyId:invalid}),/customer, supplier, cash or bank/);
    const taxGroup=a.saveGroup({name:'Tax subcategory',parentId:group('Duties & Taxes')}).id;
    const tax=a.saveLedger({name:'Tax subgroup ledger',groupId:taxGroup}).id;
    assert.throws(()=>a.saveInvoice({...input,details:{charges:[{ledgerId:tax,amount:100}]}}),/expense, income or adjustment/);
    assert.throws(()=>a.saveInvoice({...input,details:{charges:[]}}),/at least one item or a ledger/);
    const banks=a.saveGroup({name:'Collection banks',parentId:group('Bank Accounts')}).id;
    const bank=a.saveLedger({name:'Collection bank',groupId:banks}).id;
    a.saveVoucher({type:'Receipt',date:'2020-01-02',lines:[{ledgerId:bank,amount:5000},{ledgerId:party,amount:-5000}]});
    assert.equal(a.cashFlow({from:'2020-01-02',to:'2020-01-02'}).rows.reduce((sum,row)=>sum+row.amount,0),5000);
    const xml=voucherXml(book.support.vouchers({from:'2020-01-01',to:'2020-01-01'})[0]);assert.match(xml,/Consulting/);
  }finally{book.close();}
});

test('custom fields validate typed values and roll back rejected master saves',()=>{
  const book=openBooks(':memory:');const a=book.api;
  try{
    const field=a.saveCustomField({scope:'item',label:'Pack code',required:true}).id;
    assert.throws(()=>a.saveItem({name:'Rejected',unit:'PCS'}),/Pack code is required/);
    assert.equal(a.items().length,0);
    const number=a.saveCustomField({scope:'item',label:'Weight',kind:'number'}).id;
    const yesno=a.saveCustomField({scope:'item',label:'Fragile',kind:'boolean'}).id;
    const custom={[field]:'PK-01',[number]:0,[yesno]:false};
    const item=a.saveItem({name:'Box',unit:'PCS',details:{sku:'BOX-01',custom}});
    assert.deepEqual(a.recordDetails({scope:'item',id:item.id}).custom,custom);
    assert.equal(a.items()[0].sku,'BOX-01');
    assert.throws(()=>a.saveItem({name:'Duplicate SKU',unit:'PCS',details:{sku:'box-01',custom}}),/already uses this SKU/);
    assert.throws(()=>a.saveItem({...item,name:'Broken update',unit:'PCS',details:{custom:{[number]:'bad'}}}),/Weight must be a number/);
    assert.equal(a.items()[0].name,'Box');
    a.saveCustomField({id:field,scope:'item',label:'Pack code',kind:'text',active:false});
    a.saveItem({...item,name:'Box updated',unit:'PCS'});
    assert.equal(a.recordDetails({scope:'item',id:item.id}).custom[field],'PK-01');
    assert.throws(()=>a.saveCustomField({id:field,scope:'ledger',label:'Changed',kind:'text'}),/cannot change/);
    assert.throws(()=>a.saveSettings({defaultCreditDays:-1}),/Credit days/);
  }finally{book.close();}
});

test('failed stock posting leaves selected files unbound, and cloud deletion removes owned files',()=>{
  const book=openBooks(':memory:');const a=book.api;
  try{
    const party=a.saveLedger({name:'Buyer',groupId:a.groups().find(g=>g.name==='Sundry Debtors').id}).id;
    const item=a.saveItem({name:'Empty stock',unit:'PCS'}).id;
    const file=book.files.importFile({name:'proof.png',bytes:png});
    assert.throws(()=>a.saveInvoice({type:'Sales',date:'2020-01-01',partyId:party,items:[{itemId:item,qty:1000,rate:100}],details:{attachments:[file.id]}}),/Not enough stock/);
    assert.equal(a.dayBook().length,0);
    const quote=a.saveInvoice({type:'Quotation',date:'2020-01-01',partyId:party,items:[{itemId:item,qty:1000,rate:100}],details:{attachments:[file.id]}});
    assert.equal(a.invoice(quote).details.attachments.length,1);
    const uuid=book.support.vouchers({from:'2020-01-01',to:'2020-01-01'})[0].uuid;
    book.support.removeVoucher({uuid});assert.throws(()=>a.fileInfo(file),/File not found/);
    const draft=book.files.importFile({name:'draft.png',bytes:png});a.discardFiles({ids:[draft.id]});assert.throws(()=>a.fileInfo(draft),/File not found/);
  }finally{book.close();}
});

test('discount, extra ledger charge and round off post exactly and preserve document metadata',()=>{
  const book=openBooks(':memory:');const a=book.api;
  try{
    const group=name=>a.groups().find(g=>g.name===name).id;
    const supplier=a.saveLedger({name:'Vendor',groupId:group('Sundry Creditors')}).id;
    const freight=a.saveLedger({name:'Freight',groupId:group('Indirect Expenses')}).id;
    const item=a.saveItem({name:'Goods',unit:'PCS',gstRate:1800}).id;
    const file=book.files.importFile({name:'bill.png',bytes:png});
    const saved=a.saveInvoice({type:'Purchase',date:'2020-01-01',partyId:supplier,items:[{itemId:item,qty:2000,rate:10001,gstRate:1800,discountPct:1000,description:'Purchase lot'}],details:{billNumber:'V-123',dueDate:'2020-01-31',reference:'PO-1',notes:'Check seal',terms:'30 days',charges:[{ledgerId:freight,amount:500}],roundOff:58,attachments:[file.id]}});
    assert.deepEqual([saved.taxable,saved.tax,saved.total],[18002,3240,21800]);
    assert.equal(a.voucher(saved).lines.reduce((n,l)=>n+l.amount,0),0);
    assert.equal(a.ledgerStatement({ledgerId:supplier}).closing,-21800);
    assert.equal(a.ledgerStatement({ledgerId:freight}).closing,500);
    assert.equal(a.stockSummary({asOf:'2020-12-31'}).value,18002);
    assert.equal(a.taxRegister({types:['Purchase']}).totals.total,21800);
    const doc=a.invoice(saved);assert.equal(doc.items[0].discountPct,1000);assert.equal(doc.items[0].description,'Purchase lot');assert.equal(doc.details.billNumber,'V-123');
    const xml=voucherXml(book.support.vouchers({from:'2020-01-01',to:'2020-01-01'})[0]);
    assert.match(xml,/<RATE>90.01\/PCS<\/RATE>/);
    assert.match(xml,/<AMOUNT>-180.02<\/AMOUNT>/);
    assert.throws(()=>a.saveInvoice({...doc,type:'Purchase',partyId:supplier,details:{...doc.details,roundOff:101}}),/Round off/);
    assert.equal(a.invoice(saved).details.roundOff,58);
    a.deleteVoucher(saved);assert.throws(()=>a.fileInfo(file),/File not found/);
  }finally{book.close();}
});

test('offline file bytes and settings survive reopening; attachments cannot be stolen or discarded after save',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'books-details-'));const filePath=path.join(dir,'books.db');let book=openBooks(filePath);
  try{
    const file=book.files.importFile({name:'photo.png',bytes:png});
    const saved=book.api.saveItem({name:'Photo item',unit:'PCS',details:{attachments:[file.id]}});
    book.api.saveSettings({defaultTerms:'Local terms',lineDiscount:false});
    assert.throws(()=>book.api.saveItem({name:'Wrong owner',unit:'PCS',details:{attachments:[file.id]}}),/another record/);
    assert.equal(book.api.items().length,1);
    book.api.discardFiles({ids:[file.id]});assert.ok(book.api.fileInfo(file).preview.startsWith('data:image/png;base64,'));
    assert.throws(()=>book.files.importFile({name:'unsafe.svg',bytes:Buffer.from('<svg/>')}),/Choose a PNG/);
    assert.throws(()=>book.files.importFile({name:'big.png',bytes:Buffer.alloc(10*1024*1024+1)}),/10 MB/);
    book.close();book=openBooks(filePath);
    assert.equal(book.api.settings().defaultTerms,'Local terms');assert.equal(book.api.settings().lineDiscount,false);
    assert.deepEqual(Buffer.from(book.files.fileBytes(file.id).bytes),png);
    assert.deepEqual(book.api.recordDetails({scope:'item',id:saved.id}).attachments,[file.id]);
    book.api.deleteItem(saved);assert.throws(()=>book.api.fileInfo(file),/File not found/);
  }finally{book.close();fs.rmSync(dir,{recursive:true,force:true});}
});
