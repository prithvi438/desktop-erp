'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {openBooks}=require('../src/books'),{companyWorkspace,fiscal}=require('../src/company-workspace');
test('company switching preserves legacy books and isolates masters, entries and fiscal selection across restart',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'companies-test-')),open=dir=>openBooks(path.join(dir,'books.db'));let workspace=companyWorkspace(root,open);t.after(()=>workspace.books.close());
 const first=workspace.books.api;first.setCompany({name:'Original books'});first.saveItem({name:'Private original stock',unit:'pc'});
 const second=workspace.create({name:'Second business'});assert.equal(workspace.list().active,'legacy');
 if(workspace.books.database.dialect==='postgres'){const locked=open(path.join(root,'companies',second.id));try{assert.throws(()=>workspace.select(second),/already open/);assert.equal(workspace.list().active,'legacy');assert.equal(workspace.books.api.items()[0].name,'Private original stock');}finally{locked.close();}}
 workspace.select(second);assert.equal(workspace.books.api.items().length,0);assert.equal(workspace.books.api.company().name,'Second business');
 const years=fiscal(workspace.books.api,workspace.books.database),created=years.createFinancialYear({name:'Old year',from:'2020-04-01',to:'2021-03-31'});years.selectFinancialYear(created);
 years.setReportingPeriod({from:'2020-05-01',to:'2020-06-30'});
 workspace.select({id:'legacy'});assert.equal(workspace.books.api.items()[0].name,'Private original stock');assert.equal(workspace.books.api.company().name,'Original books');assert.notEqual(fiscal(workspace.books.api,workspace.books.database).financialYearState().selected,created.id);
 workspace.select(second);workspace.books.close();workspace=companyWorkspace(root,open);assert.equal(workspace.list().active,second.id);assert.equal(fiscal(workspace.books.api,workspace.books.database).financialYearState().selected,created.id);
 assert.deepEqual(fiscal(workspace.books.api,workspace.books.database).financialYearState().period,{from:'2020-05-01',to:'2020-06-30'});
 assert.throws(()=>workspace.select({id:'../../outside'}),/Company not found/);assert.equal(workspace.list().active,second.id);
});
test('financial years reject overlaps and invalid periods; arbitrary P&L periods include only matching income',t=>{
 const b=openBooks(':memory:');t.after(()=>b.close());const a=b.api,f=fiscal(a,b.database),g=name=>a.groups().find(r=>r.name===name).id,cash=a.ledgers().find(r=>r.name==='Cash').id,sales=a.ledgers().find(r=>r.name==='Sales').id;
 const year=f.createFinancialYear({from:'2020-04-01',to:'2021-03-31'});assert.throws(()=>f.createFinancialYear({from:'2020-10-01',to:'2021-04-01'}),/overlaps/);assert.throws(()=>f.createFinancialYear({from:'bad',to:'2021-03-31'}),/valid/);assert.throws(()=>f.selectFinancialYear({id:'missing'}),/not found/);
 a.saveVoucher({type:'Receipt',date:'2020-04-10',lines:[{ledgerId:cash,amount:10000},{ledgerId:sales,amount:-10000}]});a.saveVoucher({type:'Receipt',date:'2020-07-10',lines:[{ledgerId:cash,amount:25000},{ledgerId:sales,amount:-25000}]});
 f.selectFinancialYear(year);const pl=a.financialReport({type:'profitLoss',from:'2020-07-01',asOf:'2020-07-31'});assert.equal(pl.from,'2020-07-01');assert.equal(pl.rows.find(r=>r.name==='Profit / (loss) for the period').amount,25000);assert.equal(a.statements({asOf:'2021-04-30'}).ledgers.find(l=>l.ledgerId===cash).balance,35000);
 const bank=a.bankBook({ledgerId:cash,from:'2020-06-01',to:'2020-06-30'});assert.equal(bank.rows.length,0);assert.equal(bank.books,10000);
 f.setReportingPeriod({from:'2019-01-01',to:'2021-12-31'});f.selectFinancialYear(year);assert.equal(f.financialYearState().period,undefined);
});
