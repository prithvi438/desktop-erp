'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {openBooks}=require('../src/books');
function setup(t){
  const books=openBooks(':memory:');t.after(()=>books.close());const a=books.api;
  const group=name=>a.groups().find(r=>r.name===name).id;
  const customer=a.saveLedger({name:'Buyer',groupId:group('Sundry Debtors')}).id,supplier=a.saveLedger({name:'Supplier',groupId:group('Sundry Creditors')}).id;
  const item=a.saveItem({name:'Widget',unit:'PCS',saleRate:10000,purchaseRate:5000,reorderLevel:10000}).id;
  const cash=a.ledgers().find(r=>r.name==='Cash').id;
  const line=(qty=1000,more={})=>({itemId:item,qty,rate:10000,batch:'B1',expiry:'2026-12',...more});
  a.saveInvoice({type:'Purchase',date:'2026-11-01',partyId:supplier,items:[line(20000,{rate:5000})]});
  const sale=(more={})=>a.saveInvoice({type:'Sales',date:'2026-11-02',partyId:customer,items:[line()],...more});
  const policy=values=>a.saveLedger({...a.ledgers().find(r=>r.id===customer),policy:values});
  return {a,books,customer,supplier,item,cash,line,sale,policy};
}
test('customer credit limits include balance and avoid double-counting the edited bill',t=>{
  const {a,customer,cash,sale,policy}=setup(t);policy({creditLimit:15000});const bill=sale();
  assert.throws(()=>sale(),/Credit limit exceeded/);sale({id:bill.id});
  a.saveVoucher({type:'Receipt',date:'2026-11-03',lines:[{ledgerId:cash,amount:10000},{ledgerId:customer,amount:-10000}]});sale();
  policy({stopSales:true});assert.throws(()=>sale(),/Billing is stopped/);
  assert.throws(()=>a.saveVoucher({type:'Sales',date:'2026-11-03',lines:[{ledgerId:customer,amount:10000},{ledgerId:a.ledgers().find(r=>r.name==='Sales').id,amount:-10000}]}),/Billing is stopped/);
});
test('item controls reject split-line quantity bypasses, discounts and expired batch substitutions',t=>{
  const {a,item,line,sale}=setup(t);
  a.saveItem({...a.items().find(r=>r.id===item),policy:{maxDiscount:1000,maxQty:2000,rack:'A1'}});
  assert.throws(()=>sale({items:[line(1000,{discountPct:1001})]}),/Discount exceeds/);
  assert.throws(()=>sale({items:[line(1500),line(1500)]}),/Bill quantity exceeds/);
  a.saveRetailControls({blockExpiredSales:true});assert.throws(()=>sale({date:'2027-01-01',items:[line(1000,{expiry:'2030-12'})]}),/Expired batch/);
  a.saveItem({...a.items().find(r=>r.id===item),policy:{stopSales:true}});assert.throws(()=>sale(),/Billing is stopped/);
});
test('period locking checks both old and new dates and blocks deletes and incoming changes',t=>{
  const {a,books,sale}=setup(t);const bill=sale();a.saveRetailControls({lockedThrough:'2026-11-30'});
  assert.throws(()=>sale({id:bill.id,date:'2026-12-01'}),/locked/);assert.throws(()=>a.deleteVoucher(bill),/locked/);
  const remote=books.support.vouchers({from:'2026-11-02',to:'2026-11-02'})[0];assert.throws(()=>books.support.removeVoucher({uuid:remote.uuid}),/locked/);
  a.saveRetailControls({lockedThrough:''});a.deleteVoucher(bill);
});
test('bill matching retains on-account amounts and rejects invalid edits/deletions atomically',t=>{
  const {a,customer,cash,sale}=setup(t);const bill=sale(),second=sale({date:'2026-11-03'});
  const payment=a.saveVoucher({type:'Receipt',date:'2026-11-04',lines:[{ledgerId:cash,amount:15000},{ledgerId:customer,amount:-15000}]});
  const args={paymentId:payment.id,partyId:customer};
  a.saveAllocations({...args,allocations:[{billId:bill.id,amount:10000},{billId:second.id,amount:2000}]});
  const balance=a.outstandingBills({partyId:customer,asOf:'2026-11-05'});
  assert.deepEqual([balance.pending,balance.onAccount,balance.net],[8000,3000,5000]);
  assert.equal(a.outstandingBills({partyId:customer,asOf:'2026-11-03'}).pending,20000);
  assert.throws(()=>a.saveAllocations({...args,allocations:[{billId:bill.id,amount:10001}]}),/exceeds/);
  assert.throws(()=>a.saveAllocations({...args,allocations:[{billId:bill.id,amount:10000},{billId:second.id,amount:10000}]}),/exceeds the payment/);
  assert.throws(()=>sale({id:bill.id,items:[{itemId:a.items()[0].id,qty:500,rate:10000,batch:'B1'}]}),/invalidate bill settlements/);
  assert.throws(()=>a.deleteVoucher(payment),/bill settlements/);
  assert.throws(()=>a.saveLedger({...a.ledgers().find(row=>row.id===customer),groupId:a.groups().find(row=>row.name==='Sundry Creditors').id}),/Clear bill settlements/);
  assert.equal(a.voucher({id:bill.id}).lines[0].amount,10000);
  a.saveAllocations({...args,allocations:[]});a.deleteVoucher(payment);
});
test('supplier payments match purchase bills and due dates come from document details',t=>{
  const {a,supplier,cash}=setup(t);const bill=a.dayBook({types:['Purchase']})[0];
  const payment=a.saveVoucher({type:'Payment',date:'2026-11-04',lines:[{ledgerId:cash,amount:-5000},{ledgerId:supplier,amount:5000}]});
  a.saveAllocations({paymentId:payment.id,partyId:supplier,allocations:[{billId:bill.id,amount:5000}]});
  assert.equal(a.outstandingBills({partyId:supplier,asOf:'2026-11-05'}).pending,95000);
});
test('purchase planning and net sales analysis include returns and preserve quantities',t=>{
  const {a,item,customer,line,sale}=setup(t);sale({items:[line(15000)]});
  a.saveInvoice({type:'Credit Note',date:'2026-11-03',partyId:customer,items:[line(1000)]});
  const plan=a.purchasePlan({days:30,asOf:'2026-11-04'}).find(r=>r.id===item);
  assert.deepEqual([plan.stock,plan.sold,plan.target,plan.suggested,plan.cost],[6000,14000,14000,8000,40000]);
  const row=a.salesAnalysis({from:'2026-11-01',to:'2026-11-04'})[0];assert.deepEqual([row.sales,row.returns,row.net,row.qty],[150000,10000,140000,14000]);
});
