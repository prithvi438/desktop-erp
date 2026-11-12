'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {openBooks}=require('../src/books');
function setup(t){const books=openBooks(':memory:');t.after(()=>books.close());const a=books.api,group=name=>a.groups().find(r=>r.name===name).id;
 const cash=a.ledgers().find(r=>r.name==='Cash').id,capital=a.saveLedger({name:'Owner capital',groupId:group('Capital Account'),opening:-100000}).id;
 a.saveLedger({...a.ledgers().find(r=>r.id===cash),opening:100000});
 const revenue=a.ledgers().find(r=>r.name==='Sales').id,debtor=a.saveLedger({name:'Customer',groupId:group('Sundry Debtors')}).id;
 a.saveVoucher({type:'Journal',date:'2025-06-01',lines:[{ledgerId:debtor,amount:30000},{ledgerId:revenue,amount:-30000}]});
 a.saveVoucher({type:'Journal',date:'2026-06-01',lines:[{ledgerId:debtor,amount:50000},{ledgerId:revenue,amount:-50000}]});
 return {a,books,cash,capital,revenue,debtor,group};}
test('all reporting frameworks have comparative balances and reconcile without fabricated entries',t=>{
 const {a}=setup(t);for(const framework of ['noncompany','llp','division1','division2']){
  const report=a.financialReport({type:'balanceSheet',asOf:'2026-11-12',framework});
  assert.equal(report.priorAsOf,'2026-03-31');assert.equal(report.rows.find(r=>r.name==='TOTAL ASSETS').amount,180000);assert.equal(report.rows.find(r=>r.name==='TOTAL EQUITY AND LIABILITIES').amount,180000);
  assert.equal(report.rows.find(r=>r.name==='TOTAL ASSETS').previous,130000);
  assert.equal(report.rows[0].name,framework==='division2'?'ASSETS':'EQUITY AND LIABILITIES');
  const pl=a.financialReport({type:'profitLoss',asOf:'2026-11-12',framework});const profit=pl.rows.find(r=>r.name==='Profit / (loss) for the period');assert.equal(profit.amount,50000);assert.equal(profit.previous,30000);
 }
});
test('trial balance exposes opening errors with actual totals, and balance sheet does not disguise them',t=>{
 const {a,group}=setup(t);a.saveLedger({name:'Unbalanced opening',groupId:group('Fixed Assets'),opening:1000});
 const trial=a.financialReport({type:'trialBalance',asOf:'2026-11-12'}),total=trial.rows.find(r=>r.kind==='total');assert.equal(total.debit-total.credit,1000);assert.equal(trial.rows.at(-1).amount,1000);assert.ok(trial.warnings.some(w=>w.includes('Unbalanced opening INR 10.00 Dr')));
 const bs=a.financialReport({type:'balanceSheet',asOf:'2026-11-12'});assert.equal(bs.rows.find(r=>r.kind==='bad').amount,1000);assert.equal(bs.rows.find(r=>r.name==='TOTAL ASSETS').amount-bs.rows.find(r=>r.name==='TOTAL EQUITY AND LIABILITIES').amount,1000);
});
test('reviewed mappings persist and keep ledger drill-down while preventing profit-to-asset reclassification',t=>{
 const {a,group,cash}=setup(t);const wages=a.saveLedger({name:'Wages',groupId:group('Indirect Expenses')}).id;
 a.saveVoucher({type:'Payment',date:'2026-10-01',lines:[{ledgerId:wages,amount:12000},{ledgerId:cash,amount:-12000}]});
 a.saveReportingSettings({framework:'division1',unit:'lakhs',mappings:{[wages]:'employee'},notes:'Historical cost basis.'});
 const result=a.financialReport({type:'profitLoss',asOf:'2026-11-12'});assert.equal(result.rows.find(r=>r.name==='Employee benefits expense').amount,12000);assert.equal(result.rows.find(r=>r.ledgerId===wages).amount,12000);assert.match(result.notes,/Historical cost/);
 assert.throws(()=>a.saveReportingSettings({mappings:{[wages]:'ppe'}}),/cannot be mapped/);
 assert.equal(a.financialReport({type:'profitLoss',asOf:'2024-02-29'}).priorAsOf,'2023-02-28');
});
test('xlsx exports contain numeric amounts, literal labels, repeatable headers and styled totals',async()=>{
 const ExcelJS=require('exceljs'),exporter=require('../src/report-export');
 const data={company:{name:'Test & Co'},title:'Trial balance',subtitle:'As at 31-03-2026',columns:['Particulars','Debit','Credit'],formats:['text','money','money'],rows:[['=HYPERLINK("bad")',123456.78,0],['Total',123456.78,0]],kinds:['sub','total'],notes:'Review <script> is text.'};
 const bytes=await exporter.workbook(data),book=new ExcelJS.Workbook();await book.xlsx.load(bytes);const sheet=book.worksheets[0];assert.equal(sheet.getCell('B6').value,123456.78);assert.equal(sheet.getCell('A6').value,'=HYPERLINK("bad")');assert.equal(sheet.getCell('A6').type,ExcelJS.ValueType.String);assert.equal(sheet.getCell('B7').border.bottom.style,'double');assert.equal(sheet.pageSetup.printTitlesRow,'1:5');
 const html=exporter.html(data);assert.match(html,/Test &amp; Co/);assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<script>/);
});
