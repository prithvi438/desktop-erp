'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {openBooks}=require('../src/books');
function setup(t){const books=openBooks(':memory:');t.after(()=>books.close());const a=books.api;
 const party=a.saveLedger({name:'Trade party',groupId:a.groups().find(g=>g.name==='Sundry Debtors').id}).id;
 const item=a.saveItem({name:'Offer item',unit:'PCS',saleRate:10000}).id;
 const line=(qty,more={})=>({itemId:item,qty,rate:10000,...more});
 const bill=(type,rows,more={})=>a.saveInvoice({type,date:'2026-11-12',partyId:party,items:rows,...more});
 bill('Stock In',[line(100000)]);return {a,item,line,bill};}
test('discount defaults and limits are enforced on both purchases and sales',t=>{
 const {a,item,line,bill}=setup(t);a.saveSettings({discountRules:true});
 a.saveInventoryRules({itemId:item,saleMin:500,saleDefault:1000,saleMax:2000,purchaseMin:100,purchaseDefault:300,purchaseMax:500});
 assert.equal(bill('Sales',[line(1000)]).total,9000);
 assert.equal(bill('Purchase',[line(1000)]).total,9700);
 assert.throws(()=>bill('Sales',[line(1000,{discountPct:400})]),/between 5% and 20%/);
 assert.throws(()=>bill('Purchase',[line(1000,{discountPct:600})]),/between 1% and 5%/);
 assert.throws(()=>a.saveInventoryRules({itemId:item,saleMin:2000}),/Minimum discount/);
 a.saveSettings({discountRules:false});assert.equal(bill('Sales',[line(1000)]).total,10000);
});
test('BOGO moves free stock, preserves billed amount, and survives reopening and rule changes',t=>{
 const {a,item,line,bill}=setup(t);a.saveSettings({freeOffers:true});a.saveInventoryRules({itemId:item,buyQty:1000,freeQty:1000,offerPurchases:true});
 const sale=bill('Sales',[line(2000)]);assert.equal(sale.total,20000);assert.equal(a.items().find(r=>r.id===item).stock,96000);
 const saved=a.invoice({id:sale.id});assert.equal(saved.items[0].qty,2000);assert.equal(saved.items[0].freeQty,2000);
 a.saveSettings({freeOffers:false});assert.equal(a.saveInvoice({...saved,narration:'Retained history'}).total,20000);
 assert.equal(a.items().find(r=>r.id===item).stock,96000);
 assert.throws(()=>a.saveInvoice({...saved,items:[{...saved.items[0],qty:3000}]}),/Free quantity/);
 a.saveSettings({freeOffers:true});const purchase=bill('Purchase',[line(3000)]);assert.equal(purchase.total,30000);assert.equal(a.items().find(r=>r.id===item).stock,102000);
 bill('Credit Note',[line(1000,{freeQty:1000})]);assert.equal(a.items().find(r=>r.id===item).stock,104000);
 assert.equal(a.salesAnalysis({from:'2026-11-01',to:'2026-11-30'})[0].discount,0);
 assert.throws(()=>bill('Sales',[line(100000)]),/Not enough stock/);
});
test('offer dates and purchase opt-in apply; partial buy quantities do not earn a full offer',t=>{
 const {a,item,line,bill}=setup(t);a.saveSettings({freeOffers:true});a.saveInventoryRules({itemId:item,buyQty:2000,freeQty:1000,starts:'2026-11-10',ends:'2026-11-20'});
 assert.equal(a.invoice({id:bill('Sales',[line(3000)]).id}).items[0].freeQty,1000);
 assert.equal(a.invoice({id:bill('Purchase',[line(3000)]).id}).items[0].freeQty,undefined);
 assert.equal(a.invoice({id:bill('Sales',[line(3000)],{date:'2026-11-21'}).id}).items[0].freeQty,undefined);
 assert.throws(()=>bill('Sales',[line(3000,{freeQty:2000})]),/active offer/);
});
test('optional batch entry preserves history, prevents unsafe disabling, and respects sorting',t=>{
 const {a,item,line,bill}=setup(t);a.saveSettings({batchTracking:false,expiryTracking:false});
 assert.throws(()=>bill('Purchase',[line(1000,{batch:'A'})]),/Enable batch tracking/);
 assert.throws(()=>bill('Purchase',[line(1000,{expiry:'2027-01'})]),/Enable expiry tracking/);
 a.saveSettings({batchTracking:true,expiryTracking:true});
 bill('Purchase',[line(1000,{batch:'Z',expiry:'2027-01'})],{date:'2026-11-01'});
 bill('Purchase',[line(1000,{batch:'A',expiry:'2026-12'})],{date:'2026-11-02'});
 assert.throws(()=>a.saveSettings({batchTracking:false}),/Named batches still hold stock/);
 assert.equal(a.batches({itemId:item})[0].batch,'A');
 a.saveSettings({batchSort:'oldest'});assert.equal(a.batches({itemId:item})[0].batch,'Z');
 a.saveSettings({batchSort:'name'});assert.equal(a.batches({itemId:item})[1].batch,'A');
 a.saveRetailControls({blockExpiredSales:true});assert.throws(()=>bill('Sales',[line(1000,{batch:'A',expiry:'2026-12'})],{date:'2027-01-01'}),/Expired batch/);
 a.saveSettings({expiryTracking:false});bill('Sales',[line(1000,{batch:'A',expiry:'2026-12'})]);
});

test('offers use the stock unit across related voucher units and preserve unit snapshots',t=>{
 const {a,party}=(()=>{const data=setup(t);return {...data,party:data.a.ledgers().find(r=>r.name==='Trade party').id};})();
 const g=a.saveCatalogMaster({kind:'unit',name:'Gram',symbol:'g'}).id;
 const kg=a.saveCatalogMaster({kind:'unit',name:'Kilogram',symbol:'kg',relatedId:g,conversion:'1000'}).id;
 const item=a.saveItem({name:'Rice',unitId:g}).id;
 a.saveSettings({freeOffers:true});a.saveInventoryRules({itemId:item,buyQty:1000000,freeQty:100000});
 a.saveInvoice({type:'Stock In',date:'2026-11-12',items:[{itemId:item,qty:10000,unitId:kg,rate:5000}]});
 const saved=a.saveInvoice({type:'Sales',date:'2026-11-12',partyId:party,items:[{itemId:item,qty:2000,unitId:kg,rate:10000}]});
 const doc=a.invoice(saved);assert.equal(doc.items[0].qty,2000);assert.equal(doc.items[0].freeQty,200);assert.equal(saved.total,20000);
 assert.equal(a.items().find(r=>r.id===item).stock,7800000);a.saveInvoice(doc);assert.equal(a.items().find(r=>r.id===item).stock,7800000);
 assert.equal(a.stockLedger({itemId:item}).rows.at(-1).enteredQty,2200);
 a.saveInventoryRules({itemId:item,freeQty:1});a.saveInvoice(doc);assert.throws(()=>a.saveInvoice({...doc,items:[{...doc.items[0],qty:3000}]}),/smaller related unit/);
});
