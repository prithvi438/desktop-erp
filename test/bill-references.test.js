'use strict';
const test=require('node:test'),assert=require('node:assert/strict');const {openBooks}=require('../src/books');
function setup(t,creditor=false){const b=openBooks(':memory:');t.after(()=>b.close());const a=b.api,g=n=>a.groups().find(r=>r.name===n).id,p=a.saveLedger({name:'Party',groupId:g(creditor?'Sundry Creditors':'Sundry Debtors')}).id,cash=a.ledgers().find(r=>r.name==='Cash').id,sales=a.ledgers().find(r=>r.name=== (creditor?'Purchase':'Sales')).id,sign=creditor?-1:1;
 const post=(amount,date='2026-04-01',rows)=>a.saveVoucher({type:amount>0?(creditor?'Purchase':'Sales'):(creditor?'Payment':'Receipt'),date,lines:[{ledgerId:p,amount:amount*sign},{ledgerId:amount>0?sales:cash,amount:-amount*sign}],...(rows?{billReferences:[{partyId:p,rows}]}:{})});return {a,b,p,cash,post};}
test('split new references, partial payments and advances reconcile with the ledger and as-of dates',t=>{const {a,p,post}=setup(t);
 const sale=post(10000,'2026-04-01',[{id:'one',mode:'new',name:'INV-A',amount:6000,dueDate:'2026-04-10'},{id:'two',mode:'new',name:'INV-B',amount:4000,dueDate:'2026-04-20'}]);
 const receipt=post(-7000,'2026-04-12',[{mode:'against',targetId:'one',amount:5000},{id:'adv',mode:'advance',name:'ADV-A',amount:2000}]);
 let out=a.referenceOutstanding({partyId:p,asOf:'2026-04-15'});assert.equal(out.due,5000);assert.equal(out.credit,2000);assert.equal(out.net,3000);assert.equal(out.overdue,1000);assert.equal(a.referenceOutstanding({partyId:p,asOf:'2026-04-05'}).due,10000);
 post(3000,'2026-05-01',[{mode:'against',targetId:'adv',amount:2000},{mode:'new',name:'INV-C',amount:1000}]);out=a.referenceOutstanding({partyId:p,asOf:'2026-05-02'});assert.equal(out.credit,0);assert.equal(out.net,6000);
 assert.throws(()=>post(-2000,'2026-05-02',[{mode:'against',targetId:'one',amount:2000}]),/exceeds/);assert.equal(a.referenceOutstanding({partyId:p,asOf:'2026-05-02'}).net,6000);
 assert.throws(()=>a.deleteVoucher(sale),/settlements/);assert.throws(()=>a.saveVoucher({...a.voucher(sale),lines:[{ledgerId:p,amount:1000},{ledgerId:a.ledgers().find(l=>l.name==='Sales').id,amount:-1000}]}),/references|settlements/);
});
test('supplier allocations, opening references and legacy matching conversion reconcile',t=>{const {a,p,post}=setup(t,true);const bill=post(10000),pay=post(-3000);a.saveAllocations({partyId:p,paymentId:pay.id,allocations:[{billId:bill.id,amount:3000}]});assert.equal(a.referenceOutstanding({partyId:p,asOf:'2026-04-30'}).due,7000);
 const opts=a.referenceOptions({partyId:p,voucherId:pay.id,amount:3000});assert.equal(opts.rows[0].mode,'against');a.saveBillReferences({voucherId:pay.id,parties:[{partyId:p,rows:opts.rows}]});assert.equal(a.referenceOutstanding({partyId:p,asOf:'2026-04-30'}).due,7000);
 const other=a.saveLedger({name:'Other supplier',groupId:a.groups().find(g=>g.name==='Sundry Creditors').id,opening:-5000}).id,cash=a.ledgers().find(l=>l.name==='Cash').id;
 a.saveVoucher({type:'Payment',date:'2026-04-02',lines:[{ledgerId:other,amount:2000},{ledgerId:cash,amount:-2000}],billReferences:[{partyId:other,rows:[{mode:'against',targetId:`opening:${other}`,amount:2000}]}]});assert.equal(a.referenceOutstanding({partyId:other,asOf:'2026-04-30'}).due,3000);
 assert.throws(()=>a.saveBillReferences({voucherId:pay.id,parties:[{partyId:p,rows:[{mode:'against',targetId:`opening:${other}`,amount:3000}]}]}),/opposite-side/);
});
test('credit controls, future bill adjustments, payment creation and backup preserve reference accounting',t=>{const {a,b,p,cash,post}=setup(t);post(10000,'2026-06-01',[{id:'future',mode:'new',name:'Future bill',amount:10000,dueDate:'2026-06-10'}]);
 a.settleReferences({partyId:p,accountId:cash,date:'2026-05-01',rows:[{mode:'against',targetId:'future',amount:4000}]});assert.equal(a.referenceOutstanding({partyId:p,asOf:'2026-05-15'}).net,-4000);assert.equal(a.referenceOutstanding({partyId:p,asOf:'2026-06-15'}).net,6000);
 a.saveLedger({...a.ledgers().find(l=>l.id===p),policy:{blockOverdue:true,creditLimit:20000,stopSales:false}});assert.throws(()=>post(1000,'2026-06-20'),/Overdue bills/);
 a.settleReferences({partyId:p,accountId:cash,date:'2026-06-20',rows:[{mode:'against',targetId:'future',amount:6000}]});post(1000,'2026-06-20');
 if(b.database.dialect==='postgres'){const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),file=path.join(fs.mkdtempSync(path.join(os.tmpdir(),'refs-backup-')),'books.speedobook');b.backup(file);require('../src/postgres-backup').restore(b.database,file,b.schemaVersion);assert.equal(a.referenceOutstanding({partyId:p,asOf:'2026-06-21'}).net,1000);}
});
test('one payment settles selected amounts across ten bills without touching the others',t=>{const {a,p,cash,post}=setup(t,true);for(let i=1;i<=10;i++)post(10000,'2026-04-01',[{id:'bill-'+i,mode:'new',name:'BILL-'+i,amount:10000}]);
 a.settleReferences({partyId:p,accountId:cash,date:'2026-04-02',rows:[{mode:'against',targetId:'bill-2',amount:10000},{mode:'against',targetId:'bill-5',amount:3000},{mode:'against',targetId:'bill-9',amount:7000}]});const r=a.referenceOutstanding({partyId:p,asOf:'2026-04-03'});assert.equal(r.due,80000);assert.equal(r.rows.find(x=>x.id==='bill-2').remaining,0);assert.equal(r.rows.find(x=>x.id==='bill-5').remaining,7000);assert.equal(r.rows.find(x=>x.id==='bill-9').remaining,3000);assert.equal(r.rows.find(x=>x.id==='bill-1').remaining,10000);
});

for(const creditor of [false,true])test(`${creditor?'supplier':'customer'} clear reference settles bills; undo preserves money and supports re-adjustment`,t=>{
 const {a,p,cash,post}=setup(t,creditor);post(10000,'2026-04-01',[{id:'bill',mode:'new',name:'B1',amount:10000}]);
 const get=()=>a.referenceOutstanding({partyId:p,asOf:'2026-04-30'});
 assert.equal(get().rows[0].status,'Pending');
 a.settleReferences({partyId:p,accountId:cash,date:'2026-04-02',rows:[{mode:'against',targetId:'bill',amount:4000}]});assert.equal(get().rows[0].status,'Partly adjusted');
 a.settleReferences({partyId:p,accountId:cash,date:'2026-04-03',rows:[{mode:'against',targetId:'bill',amount:6000}]});assert.equal(get().rows[0].status,'Done');assert.equal(get().net,0);
 const before=get(),edge=before.adjustments[0];a.clearReferenceAdjustment({partyId:p,voucherId:edge.voucherId,adjustmentId:edge.id});
 const after=get();assert.equal(after.net,0);assert.equal(after.due,4000);assert.equal(after.credit,4000);assert.deepEqual(after.entries,before.entries);assert.equal(after.rows.find(r=>r.id==='bill').status,'Partly adjusted');assert.equal(a.referenceAudit({partyId:p}).length,1);
 assert.throws(()=>a.clearReferenceAdjustment({partyId:p,voucherId:edge.voucherId,adjustmentId:edge.id}),/existing adjustment/);
 a.saveBillReferences({voucherId:edge.voucherId,parties:[{partyId:p,rows:[{mode:'against',targetId:'bill',amount:4000}]}]});assert.equal(get().due,0);assert.equal(get().credit,0);assert.equal(get().rows[0].status,'Done');
});
test('undo legacy adjustment migrates matching without changing the voucher',t=>{
 const {a,p,post}=setup(t,true),bill=post(5000),pay=post(-5000);a.saveAllocations({partyId:p,paymentId:pay.id,allocations:[{billId:bill.id,amount:5000}]});
 const before=a.referenceOutstanding({partyId:p,asOf:'2026-04-30'}),edge=before.adjustments[0];a.clearReferenceAdjustment({partyId:p,voucherId:pay.id,adjustmentId:edge.id});
 const after=a.referenceOutstanding({partyId:p,asOf:'2026-04-30'});assert.equal(after.due,5000);assert.equal(after.credit,5000);assert.equal(after.net,0);assert.deepEqual(after.entries,before.entries);
});
