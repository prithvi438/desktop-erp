'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {openBooks}=require('../src/books');
function setup(t){const books=openBooks(':memory:');t.after(()=>books.close());const a=books.api;
  const make=(name,symbol,relatedId=null,conversion='1')=>a.saveCatalogMaster({kind:'unit',name,symbol,relatedId,conversion}).id;
  const g=make('Gram','g'),kg=make('Kilogram','kg',g,'1000'),mg=make('Milligram','mg',g,'0.001');
  const item=a.saveItem({name:'Rice',unitId:g,saleRate:10,purchaseRate:5}).id;
  const party=a.saveLedger({name:'Trading party',groupId:a.groups().find(r=>r.name==='Sundry Debtors').id}).id;
  const save=(type,qty,unitId,rate=10000,extra={})=>a.saveInvoice({type,date:'2026-11-11',partyId:party,items:[{itemId:item,qty,unitId,rate}],...extra});
  return {a,books,make,g,kg,mg,item,party,save};}
test('related units post one stock balance, preserve entered prices and survive edits and returns',t=>{
  const {a,g,kg,item,save}=setup(t);
  const purchase=save('Purchase',10000,kg,5000); // 10 kg, 50 per kg
  const sale=save('Sales',2000,kg,10000); // 2 kg, 100 per kg
  assert.equal(sale.taxable,20000);
  let stock=a.items().find(r=>r.id===item);assert.equal(stock.stock,8000000);assert.equal(stock.units.find(u=>u.id===kg).stock,8000);
  const opened=a.invoice({id:sale.id});assert.equal(opened.items[0].qty,2000);assert.equal(opened.items[0].rate,10000);assert.equal(opened.items[0].unitId,kg);
  a.saveInvoice({...opened,items:[{...opened.items[0],qty:3000}]});assert.equal(a.items()[0].stock,7000000);
  save('Credit Note',500,kg);assert.equal(a.items()[0].stock,7500000);
  assert.throws(()=>save('Sales',8000,kg),/Not enough stock/);assert.equal(a.items()[0].stock,7500000);
  assert.throws(()=>a.saveCatalogMaster({id:kg,kind:'unit',name:'Kilogram',symbol:'kg',relatedId:g,conversion:'100'}),/has documents/);
  assert.throws(()=>a.deleteCatalogMaster({id:kg}),/documents/);
  assert.throws(()=>a.saveItem({...a.items()[0],unitId:kg}),/cannot change/);
  assert.equal(a.stockSummary({}).rows[0].units.find(u=>u.id===kg).qty,7500);
  assert.throws(()=>a.deleteVoucher(purchase),/stock/);
});
test('unit inheritance rejects cycles, unrelated dimensions, invalid factors and precision loss',t=>{
  const {a,make,g,kg,mg,item,save}=setup(t);const metre=make('Metre','m');
  assert.throws(()=>a.saveCatalogMaster({id:g,kind:'unit',name:'Gram',symbol:'g',relatedId:kg,conversion:'1'}),/themselves/);
  assert.throws(()=>make('Bad','bad',g,'0'),/greater than zero/);
  assert.throws(()=>make('Duplicate','KG'),/symbol/);
  assert.throws(()=>save('Purchase',1000,metre),/related/);
  assert.throws(()=>save('Purchase',1,mg),/precision/);
  save('Stock In',1000,mg,0);assert.equal(a.items().find(r=>r.id===item).stock,1);
  const cm=make('Centimetre','cm',metre,'0.01'),km=make('Kilometre','km',metre,'1000');
  const cable=a.saveItem({name:'Cable',unitId:cm}).id;
  a.saveInvoice({type:'Stock In',date:'2026-11-11',items:[{itemId:cable,qty:2000,unitId:km,rate:0}]});
  assert.equal(a.items().find(r=>r.id===cable).stock,200000000);
  const spare=make('Unused','old');a.saveCatalogMaster({id:spare,kind:'unit',name:'Unused edited',symbol:'new',description:'Edited unit'});
  assert.equal(a.catalogMasters({kind:'unit'}).find(r=>r.id===spare).description,'Edited unit');a.deleteCatalogMaster({id:spare});
});

test('orders and base-unit purchases retain base quantities; backups retain entered units',t=>{
  const {a,books,g,kg,item,save}=setup(t);
  const order=save('Sales Order',2000,kg,12345);assert.equal(a.items()[0].stock,0);assert.equal(a.invoice(order).items[0].qty,2000);
  save('Purchase',5000000,g,5);const bill=save('Sales',2000,kg,12345);
  assert.equal(bill.total,24690);assert.equal(a.items()[0].stock,3000000);
  assert.equal(a.salesAnalysis({from:'2026-11-11',to:'2026-11-11',by:'item'})[0].discount,0);
  if(books.database.dialect==='postgres'){
    const fs=require('node:fs'),path=require('node:path'),os=require('node:os');const file=path.join(fs.mkdtempSync(path.join(os.tmpdir(),'unit-backup-')),'books.speedobook');
    books.backup(file);a.deleteVoucher(bill);require('../src/postgres-backup').restore(books.database,file,books.schemaVersion);
    const restored=a.invoice(bill);assert.equal(restored.items[0].unitId,kg);assert.equal(restored.items[0].qty,2000);assert.equal(restored.items[0].rate,12345);assert.equal(a.items().find(r=>r.id===item).stock,3000000);
  }
});

test('incoming voucher units convert to base stock and refresh saved unit snapshots',t=>{
  const {a,books,item,kg}=setup(t);const uuid=require('node:crypto').randomUUID();
  const imported=books.support.importVoucher({uuid,type:'Stock Journal',date:'2026-11-11',entries:[],lines:[{item:'Rice',unit:'kg',qty:2000,rate:12345,gstRate:0,amount:24690}]});
  assert.equal(a.items()[0].stock,2000000);assert.equal(a.invoice(imported).items[0].unitId,kg);
  books.support.importVoucher({uuid,type:'Stock Journal',date:'2026-11-11',entries:[],lines:[{item:'Rice',unit:'g',qty:3000000,rate:12,gstRate:0,amount:36000}]});
  assert.equal(a.items()[0].stock,3000000);assert.equal(a.invoice(imported).items[0].qty,3000000);
  assert.throws(()=>books.support.importVoucher({uuid,type:'Stock Journal',date:'2026-11-11',entries:[],lines:[{item:'Rice',unit:'m',qty:1000,rate:1,gstRate:0,amount:1}]}),/not related/);
  assert.equal(a.items().find(row=>row.id===item).stock,3000000);
});
