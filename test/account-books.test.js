'use strict';
const test=require('node:test'),assert=require('node:assert/strict');const {openBooks}=require('../src/books');
test('account and stock ledgers carry period openings and show each movement once',t=>{
 const books=openBooks(':memory:');t.after(()=>books.close());const a=books.api;
 const party=a.saveLedger({name:'Ledger buyer',groupId:a.groups().find(g=>g.name==='Sundry Debtors').id,opening:1000}).id;
 const g=a.saveCatalogMaster({kind:'unit',name:'Gram',symbol:'g'}).id,kg=a.saveCatalogMaster({kind:'unit',name:'Kilogram',symbol:'kg',relatedId:g,conversion:'1000'}).id;
 const item=a.saveItem({name:'Rice',unitId:g}).id;
 a.saveInvoice({type:'Stock In',date:'2026-10-31',items:[{itemId:item,unitId:kg,qty:10000,rate:5000}]});
 const sale=a.saveInvoice({type:'Sales',date:'2026-11-02',partyId:party,narration:'November sale',items:[{itemId:item,unitId:kg,qty:2000,rate:10000}]});
 const cash=a.ledgers().find(l=>l.name==='Cash').id;
 a.saveVoucher({type:'Receipt',date:'2026-11-03',lines:[{ledgerId:party,amount:-5000},{ledgerId:cash,amount:5000}]});
 const account=a.ledgerStatement({ledgerId:party,from:'2026-11-01',to:'2026-11-30'});
 assert.equal(account.opening,1000);assert.equal(account.closing,16000);assert.deepEqual(account.rows.map(r=>r.amount),[20000,-5000]);assert.equal(account.rows[0].document,1);assert.equal(account.rows[0].narration,'November sale');
 const stock=a.stockLedger({itemId:item,from:'2026-11-01',to:'2026-11-30'});
 assert.equal(stock.opening,10000000);assert.equal(stock.closing,8000000);assert.equal(stock.rows.length,1);assert.equal(stock.rows[0].voucherId,sale.id);assert.equal(stock.rows[0].enteredUnit,'kg');assert.equal(stock.rows[0].enteredQty,2000);assert.equal(stock.rows[0].enteredRate,10000);
 const empty=a.stockLedger({itemId:item,from:'2026-12-01',to:'2026-12-31'});assert.equal(empty.rows.length,0);assert.equal(empty.opening,8000000);assert.equal(empty.closing,8000000);
 assert.throws(()=>a.stockLedger({itemId:item,from:'2026-12-01',to:'2026-11-01'}),/valid/);
});
