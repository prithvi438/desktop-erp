'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { openBooks, BooksError } = require('../src/books');

// Every date-dependent call passes its date, so the tests do not depend on the clock.
const YEAR_END = '2027-03-31';

test('received cheques move through holding, bank clearance and reconciliation exactly once', () => {
  const books = openBooks(':memory:'); const { api } = books;
  try {
    const group = name => api.groups().find(g => g.name === name).id;
    const partyId = api.saveLedger({ name: 'Buyer', groupId: group('Sundry Debtors') }).id;
    const bankId = api.saveLedger({ name: 'Bank', groupId: group('Bank Accounts') }).id;
    const id = api.saveCheque({ number: '123456', direction: 'IN', partyId, bankId, amount: 12000, date: '2020-01-01', entryDate: '2020-01-01' }).id;
    const balance = ledgerId => api.ledgerStatement({ ledgerId }).closing;
    const holding = api.ledgers().find(l => l.name === 'Cheques in Hand').id;
    assert.equal(balance(holding), 12000); assert.equal(balance(bankId), 0); assert.equal(balance(partyId), -12000);
    assert.throws(() => api.chequeAction({ id, action: 'clear', date: '2020-01-02' }), /Cannot clear/);
    api.chequeAction({ id, action: 'deposit', date: '2020-01-02' });
    api.chequeAction({ id, action: 'clear', date: '2020-01-03' });
    assert.equal(balance(holding), 0); assert.equal(balance(bankId), 12000);
    assert.equal(api.cheques()[0].status, 'CLEARED');
    assert.throws(() => api.chequeAction({ id, action: 'clear', date: '2020-01-04' }), /Cannot clear/);
    const receipt = api.dayBook({ types: ['Receipt'] })[0];
    assert.throws(() => api.deleteVoucher({ id: receipt.id }), /cheque register/);
    assert.throws(() => api.deleteCheque({ id }), /cannot be deleted/);
    const bank = api.bankBook({ ledgerId: bankId, to: '2020-12-31' });
    assert.equal(bank.uncleared, 0);
  } finally { books.close(); }
});

test('post-dated cheques do not post early and bounce reverses issued payment', () => {
  const books = openBooks(':memory:'); const { api } = books;
  try {
    const group = name => api.groups().find(g => g.name === name).id;
    const partyId = api.saveLedger({ name: 'Supplier', groupId: group('Sundry Creditors') }).id;
    const bankId = api.saveLedger({ name: 'Bank', groupId: group('Bank Accounts') }).id;
    const input = { number: '001', direction: 'OUT', partyId, bankId, amount: 10000, date: '2020-02-01', entryDate: '2020-01-01' };
    const { id } = api.saveCheque(input);
    assert.equal(api.dayBook().length, 0);
    assert.throws(() => api.saveCheque(input), /already recorded/);
    assert.throws(() => api.chequeAction({ id, action: 'mature', date: '2020-01-10' }), /before its cheque date/);
    api.chequeAction({ id, action: 'mature', date: '2020-02-01' });
    assert.equal(api.ledgerStatement({ ledgerId: bankId }).closing, -10000);
    api.chequeAction({ id, action: 'bounce', date: '2020-02-02' });
    assert.equal(api.ledgerStatement({ ledgerId: bankId }).closing, 0);
    assert.equal(api.ledgerStatement({ ledgerId: partyId }).closing, 0);
    const future = api.saveCheque({ ...input, number: '002', date: '2099-01-01' });
    api.deleteCheque(future);
    assert.equal(api.cheques().length, 1);
  } finally { books.close(); }
});

test('pricebooks resolve percentage, flat and volume prices without changing saved documents', () => {
  const books = openBooks(':memory:');
  const { api } = books;
  try {
    const itemId = api.saveItem({ name: 'Widget', unit: 'PCS', saleRate: 10000 }).id;
    const bookId = api.savePricebook({ name: 'Trade', mode: 'MARKDOWN', pct: 1000, isDefault: true }).id;
    assert.equal(api.resolvePrice({ itemId }).price, 9000);
    api.setPricebookEntry({ bookId, itemId, price: 8500 });
    api.setPricebookEntry({ bookId, itemId, minQty: 10000, price: 7500 });
    assert.equal(api.resolvePrice({ itemId, qty: 9999 }).price, 8500);
    assert.equal(api.resolvePrice({ itemId, qty: 10000 }).price, 7500);
    const partyId = api.saveLedger({ name: 'Buyer', groupId: api.groups().find(g => g.name === 'Sundry Debtors').id }).id;
    const quote = api.saveInvoice({ type: 'Quotation', date: '2026-11-09', partyId, pricebookId: bookId, items: [{ itemId, qty: 10000, rate: 7500 }] });
    assert.equal(api.invoice({ id: quote.id }).pricebookId, bookId);
    assert.throws(() => api.savePricebook({ name: 'Trade' }), /already exists/);
    assert.throws(() => api.setPricebookEntry({ bookId, itemId, price: -1 }), /non-negative/);
    assert.throws(() => api.savePricebook({ name: 'Bad', mode: 'MARKDOWN', pct: 10001 }), /too large/);
    api.deletePricebook({ id: bookId });
    assert.equal(api.invoice({ id: quote.id }).items[0].rate, 7500);
    assert.equal(api.invoice({ id: quote.id }).pricebookId, null);
    assert.equal(api.resolvePrice({ itemId }).price, 10000);
    const a = api.savePricebook({ name: 'A', mode: 'MARKUP', pct: 2000, isDefault: true }).id;
    assert.equal(api.resolvePrice({ itemId }).price, 12000);
    api.savePricebook({ name: 'B', isDefault: true });
    assert.equal(api.pricebooks().filter(b => b.is_default).length, 1);
    api.savePricebook({ id: a, name: 'A', active: false });
    assert.equal(api.resolvePrice({ bookId: a, itemId }).price, 10000);
  } finally { books.close(); }
});

function fresh() {
  const { api } = openBooks(':memory:');
  const ledger = (name) => api.ledgers().find((row) => row.name === name);
  const group = (name) => api.groups().find((row) => row.name === name).id;
  const pay = (date, debit, credit, amount, type = 'Journal') => api.saveVoucher({ type, date, lines: [{ ledgerId: debit, amount }, { ledgerId: credit, amount: -amount }] });
  return { api, ledger, group, pay };
}

// A trading set-up: a supplier, a customer and one item bought in two batches.
function trading() {
  const book = fresh();
  const { api, group } = book;
  const supplier = api.saveLedger({ name: 'Medico Supplies', groupId: group('Sundry Creditors'), gstin: '27abcde1234f1z5' }).id;
  const customer = api.saveLedger({ name: 'City Chemist', groupId: group('Sundry Debtors') }).id;
  const item = api.saveItem({ name: 'Paracetamol 500', unit: 'strip', hsn: '3004', gstRate: 1200, saleRate: 3000, purchaseRate: 2000, reorderLevel: 20000 }).id;
  const line = (batch, expiry, qty, rate) => ({ itemId: item, batch, expiry, qty, rate, gstRate: 1200 });
  const bought = api.saveInvoice({ type: 'Purchase', date: '2026-11-01', partyId: supplier, items: [line('B1', '2027-03', 40000, 2000), line('B2', '2028-01', 60000, 2000)] });
  return { ...book, supplier, customer, item, line, bought };
}

test('a new book has default groups and ledgers', () => {
  const { api } = fresh();
  assert.equal(api.groups().length, 28);
  assert.equal(api.groups().filter(row=>!row.parentId).length,15);
  assert.ok(api.groups().every(row=>row.builtIn));
  assert.deepEqual(api.ledgers().map((row) => row.name), ['Cash', 'Profit & Loss A/c', 'Purchase', 'Sales']);
  assert.match(api.company().fyStart, /^\d{4}-04-01$/);
});

test('standard masters upgrade preserves custom groups, balances and repeat opens', () => {
  const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
  const {DatabaseSync}=require('node:sqlite');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'masters-upgrade-')),file=path.join(dir,'books.db');
  let books=openBooks(file,{driver:'sqlite'});books.close();
  const db=new DatabaseSync(file);
  db.exec("DELETE FROM ledgers WHERE name='Profit & Loss A/c'; DELETE FROM groups WHERE id>20; DELETE FROM meta WHERE key IN ('builtin_group_ids','standard_masters_v1'); INSERT INTO groups(id,name,parent_id,nature) VALUES(21,'My custom group',1,'liability'); INSERT INTO ledgers(name,group_id,opening) VALUES('Existing capital',21,-12500);");
  db.close();
  try {
    books=openBooks(file,{driver:'sqlite'});
    const custom=books.api.groups().find(row=>row.id===21);
    assert.equal(custom.builtIn,false);
    assert.equal(books.api.groups().length,29);
    assert.equal(books.api.ledgers().find(row=>row.name==='Existing capital').opening,-12500);
    books.api.saveGroup({id:21,name:'Renamed custom group',parentId:1});
    assert.throws(()=>books.api.deleteGroup({id:books.api.groups().find(row=>row.name==='Secured Loans').id}),/Built-in/);
    const snapshot=books.api.groups();books.close();books=openBooks(file,{driver:'sqlite'});
    assert.deepEqual(books.api.groups(),snapshot);
    assert.equal(books.api.ledgers().filter(row=>row.name==='Profit & Loss A/c').length,1);
  } finally {books.close();fs.rmSync(dir,{recursive:true,force:true});}
});

test('company details are kept and a name is required', () => {
  const { api } = fresh();
  assert.throws(() => api.setCompany({ name: ' ' }), /name is required/);
  api.setCompany({ name: 'Speedo Traders', state: 'Maharashtra', gstin: '27AAAAA0000A1Z5' });
  assert.deepEqual([api.company().name, api.company().state, api.company().address], ['Speedo Traders', 'Maharashtra', '']);
});

test('ledger names are unique without regard to case', () => {
  const { api, group } = fresh();
  assert.throws(() => api.saveLedger({ name: 'cash', groupId: group('Cash-in-Hand') }), BooksError);
  assert.throws(() => api.saveLedger({ name: '  ', groupId: group('Cash-in-Hand') }), /name is required/);
  assert.throws(() => api.saveLedger({ name: 'Rent', groupId: 9999 }), /Choose a group/);
});

test('groups nest under a parent and take its nature', () => {
  const { api, group } = fresh();
  const north = api.saveGroup({ name: 'Debtors North', parentId: group('Sundry Debtors') }).id;
  assert.equal(api.groups().find((row) => row.id === north).nature, 'asset');
  assert.throws(() => api.saveGroup({ name: 'Orphan' }), /comes under/);
  assert.throws(() => api.saveGroup({ id: group('Current Assets'), name: 'Renamed', parentId: group('Fixed Assets') }), /primary groups cannot be changed/);
  const party = api.saveLedger({ name: 'Northern Stores', groupId: north }).id;
  assert.throws(() => api.deleteGroup({ id: north }), /still has ledgers/);
  api.deleteLedger({ id: party });
  api.deleteGroup({ id: north });
  assert.throws(() => api.deleteGroup({ id: group('Current Assets') }), /primary groups cannot be deleted/);
});

test('manage groups protects built-ins, rejects cycles and updates descendant nature',()=>{
  const {api,group}=fresh();
  assert.equal(api.groups().every(row=>row.builtIn),true);
  assert.throws(()=>api.saveGroup({id:group('Sundry Debtors'),name:'Renamed',parentId:group('Current Assets')}),/Built-in groups/);
  assert.throws(()=>api.deleteGroup({id:group('Stock-in-Hand')}),/Built-in groups/);
  const parent=api.saveGroup({name:'Custom parent',parentId:group('Sundry Debtors')}).id;
  const child=api.saveGroup({name:'Custom child',parentId:parent}).id;
  assert.equal(api.groups().find(row=>row.id===child).builtIn,false);
  assert.throws(()=>api.saveGroup({id:parent,name:'Custom parent',parentId:child}),/own subgroups/);
  api.saveGroup({id:parent,name:'Custom parent',parentId:group('Sundry Creditors')});
  assert.equal(api.groups().find(row=>row.id===child).nature,'liability');
  assert.throws(()=>api.deleteGroup({id:parent}),/still has ledgers or groups/);
  api.deleteGroup({id:child});api.deleteGroup({id:parent});
});

test('altering or deleting consumed purchases fails atomically; unused purchases can be deleted',()=>{
  const {api,bought,item,customer,supplier,line,ledger}=trading();
  const sale=api.saveInvoice({type:'Sales',date:'2026-11-02',partyId:customer,items:[line('B1','2027-03',10000,3000)]});
  const before=api.invoice({id:bought.id}),stock=api.items().find(row=>row.id===item).stock;
  assert.throws(()=>api.deleteVoucher({id:bought.id}),/negative stock/);
  assert.throws(()=>api.saveInvoice({id:bought.id,type:'Purchase',date:'2026-11-01',partyId:supplier,items:[line('B1','2027-03',5000,2000)]}),/negative stock/);
  assert.throws(()=>api.saveInvoice({id:bought.id,type:'Purchase',date:'2026-11-01',partyId:supplier,items:[line('OTHER','2027-03',40000,2000)]}),/negative stock/);
  assert.throws(()=>api.saveVoucher({id:bought.id,type:'Purchase',date:'2026-11-01',lines:[{ledgerId:supplier,amount:-100},{ledgerId:ledger('Purchase').id,amount:100}]}),/negative stock/);
  assert.deepEqual(api.invoice({id:bought.id}),before);
  assert.equal(api.items().find(row=>row.id===item).stock,stock);
  api.deleteVoucher({id:sale.id});api.deleteVoucher({id:bought.id});
  assert.equal(api.items().find(row=>row.id===item).stock,0);
  assert.equal(api.dayBook().length,0);
});

test('a ledger used only by an unposted document cannot be deleted',()=>{
  const {api,group}=fresh();
  const partyId=api.saveLedger({name:'Prospect',groupId:group('Sundry Debtors')}).id;
  const itemId=api.saveItem({name:'Quoted item',unit:'PCS'}).id;
  const quote=api.saveInvoice({type:'Quotation',date:'2026-11-01',partyId,items:[{itemId,qty:1000,rate:1000}]});
  assert.throws(()=>api.deleteLedger({id:partyId}),/used by a document or cheque/);
  api.deleteVoucher(quote);api.deleteLedger({id:partyId});
  assert.equal(api.ledgers().some(row=>row.id===partyId),false);
});

test('a voucher must balance and have two valid lines', () => {
  const { api, ledger } = fresh();
  const cash = ledger('Cash').id;
  const sales = ledger('Sales').id;
  const base = { type: 'Receipt', date: '2026-11-06' };
  assert.throws(() => api.saveVoucher({ ...base, lines: [{ ledgerId: cash, amount: 100 }] }), /at least two lines/);
  assert.throws(() => api.saveVoucher({ ...base, lines: [{ ledgerId: cash, amount: 100 }, { ledgerId: sales, amount: -90 }] }), /differ by 0\.10/);
  assert.throws(() => api.saveVoucher({ ...base, lines: [{ ledgerId: cash, amount: 100 }, { ledgerId: 777, amount: -100 }] }), /needs a ledger/);
  assert.throws(() => api.saveVoucher({ ...base, lines: [{ ledgerId: cash, amount: 0 }, { ledgerId: sales, amount: 0 }] }), /needs an amount/);
  assert.throws(() => api.saveVoucher({ ...base, date: '2026-02-30', lines: [{ ledgerId: cash, amount: 100 }, { ledgerId: sales, amount: -100 }] }), /date is not valid/);
  assert.throws(() => api.saveVoucher({ ...base, type: 'Gift', lines: [{ ledgerId: cash, amount: 100 }, { ledgerId: sales, amount: -100 }] }), /Unknown voucher type/);
  assert.equal(api.dayBook().length, 0);
});

test('vouchers number per type and keep their number when altered', () => {
  const { api, ledger } = fresh();
  const lines = [{ ledgerId: ledger('Cash').id, amount: 50000 }, { ledgerId: ledger('Sales').id, amount: -50000 }];
  const first = api.saveVoucher({ type: 'Receipt', date: '2026-11-01', lines });
  const second = api.saveVoucher({ type: 'Receipt', date: '2026-11-02', lines });
  const sale = api.saveVoucher({ type: 'Sales', date: '2026-11-02', lines });
  assert.deepEqual([first.number, second.number, sale.number], [1, 2, 1]);

  const altered = api.saveVoucher({ id: first.id, type: 'Receipt', date: '2026-11-03', narration: 'changed', lines });
  assert.equal(altered.number, 1);
  const read = api.voucher({ id: first.id });
  assert.equal(read.date, '2026-11-03');
  assert.equal(read.narration, 'changed');
  assert.deepEqual(read.lines.map((line) => [line.ledgerName, line.amount]), [['Cash', 50000], ['Sales', -50000]]);
  assert.equal(ledger('Cash').balance, 150000);
  assert.deepEqual(api.dayBook({ types: ['Sales'] }).map((row) => row.id), [sale.id]);
  assert.equal(api.dayBook({ touches: 'income' }).length, 3);
  assert.equal(api.dayBook({ touches: 'Bank Accounts' }).length, 0);
});

test('the balance sheet agrees with the profit and loss account', () => {
  const { api, ledger, group, pay } = fresh();
  const cash = ledger('Cash').id;
  api.saveLedger({ name: 'Capital', groupId: group('Capital Account'), opening: -1000000 });
  api.saveLedger({ name: 'Bank', groupId: group('Bank Accounts'), opening: 900000 });
  const rent = api.saveLedger({ name: 'Rent', groupId: group('Indirect Expenses') }).id;
  pay('2026-11-01', cash, ledger('Sales').id, 250000, 'Receipt');
  pay('2026-11-02', rent, cash, 60000, 'Payment');
  pay('2026-12-15', rent, cash, 60000, 'Payment');

  const november = api.statements({ asOf: '2026-11-30' });
  assert.deepEqual([november.income, november.expense, november.netProfit], [250000, 60000, 190000]);
  // Openings were entered 1,000.00 short on the debit side.
  assert.equal(november.openingDifference, -100000);
  assert.equal(november.assets, 900000 + 190000);
  assert.equal(november.assets, november.liabilities + november.netProfit + november.openingDifference);
  assert.equal(november.debit - november.credit, november.openingDifference);
  assert.equal(november.byPrimary['Sales Accounts'], -250000);
  assert.equal(api.statements({ asOf: YEAR_END }).netProfit, 130000);
});

test('a new financial year starts its profit at zero and carries the old one forward', () => {
  const { api, ledger, group, pay } = fresh();
  const cash = ledger('Cash').id;
  const rent = api.saveLedger({ name: 'Rent', groupId: group('Indirect Expenses') }).id;
  pay('2026-11-01', cash, ledger('Sales').id, 250000, 'Receipt');
  pay('2027-04-10', rent, cash, 40000, 'Payment');

  const next = api.statements({ asOf: '2027-04-30' });
  assert.equal(next.from, '2027-04-01');
  assert.deepEqual([next.income, next.expense, next.netProfit, next.broughtForward], [0, 40000, -40000, 250000]);
  assert.equal(next.assets, next.liabilities + next.broughtForward + next.netProfit + next.openingDifference);
  assert.equal(next.ledgers.find((row) => row.name === 'Sales').period, 0);
});

test('a ledger statement carries the opening balance into the period', () => {
  const { api, ledger, pay } = fresh();
  const cash = ledger('Cash').id;
  const sales = ledger('Sales').id;
  api.saveLedger({ id: cash, name: 'Cash', groupId: ledger('Cash').groupId, opening: 10000 });
  pay('2026-10-10', cash, sales, 5000, 'Receipt');
  const later = pay('2026-11-05', cash, sales, 7000, 'Receipt');

  const statement = api.ledgerStatement({ ledgerId: cash, from: '2026-11-01', to: '2026-11-30' });
  assert.equal(statement.opening, 15000);
  assert.deepEqual(statement.rows.map((row) => [row.voucherId, row.particulars, row.amount]), [[later.id, 'Sales', 7000]]);
  assert.equal(statement.closing, 22000);
});

test('cash flow groups cash movements by the other account', () => {
  const { api, ledger, group, pay } = fresh();
  const cash = ledger('Cash').id;
  const bank = api.saveLedger({ name: 'Bank', groupId: group('Bank Accounts'), opening: 100000 }).id;
  const rent = api.saveLedger({ name: 'Rent', groupId: group('Indirect Expenses') }).id;
  pay('2026-11-01', cash, ledger('Sales').id, 250000, 'Receipt');
  pay('2026-11-02', rent, bank, 60000, 'Payment');
  pay('2026-11-03', bank, cash, 50000, 'Contra'); // cash to bank: not a flow

  const flow = api.cashFlow({ from: '2026-11-01', to: '2026-11-30' });
  assert.equal(flow.opening, 100000);
  assert.deepEqual(flow.rows.map((row) => [row.name, row.amount]), [['Sales Accounts', 250000], ['Indirect Expenses', -60000]]);
  assert.equal(flow.closing, 290000);
});

test('ageing settles the oldest bills first', () => {
  const { api, ledger, group, pay } = fresh();
  const customer = api.saveLedger({ name: 'City Chemist', groupId: group('Sundry Debtors'), opening: 10000 }).id;
  const sales = ledger('Sales').id;
  pay('2026-07-01', customer, sales, 30000);
  pay('2026-10-20', customer, sales, 20000);
  pay('2026-10-25', ledger('Cash').id, customer, 25000, 'Receipt');

  // 250.00 received clears the 100.00 opening and half of the July bill.
  const [row] = api.ageing({ asOf: '2026-11-06', group: 'Sundry Debtors' }).rows;
  assert.deepEqual([row.total, row.current, row.days30, row.days60, row.days90, row.advance], [35000, 20000, 0, 0, 15000, 0]);
  assert.deepEqual(api.ageing({ asOf: '2026-11-06', group: 'Sundry Creditors' }).rows, []);
});

test('bank entries can be marked cleared', () => {
  const { api, ledger, group, pay } = fresh();
  const bank = api.saveLedger({ name: 'Bank', groupId: group('Bank Accounts'), opening: 100000 }).id;
  const deposit = pay('2026-11-01', bank, ledger('Sales').id, 50000, 'Receipt');
  pay('2026-11-02', ledger('Purchase').id, bank, 20000, 'Payment');
  api.setCleared({ voucherId: deposit.id, ledgerId: bank, date: '2026-11-03' });

  let book = api.bankBook({ ledgerId: bank });
  assert.deepEqual([book.books, book.uncleared, book.bank], [130000, -20000, 150000]);
  api.setCleared({ voucherId: deposit.id, ledgerId: bank, date: null });
  book = api.bankBook({ ledgerId: bank });
  assert.equal(book.bank, 100000);
  assert.throws(() => api.setCleared({ voucherId: deposit.id, ledgerId: bank, date: 'soon' }), /not valid/);
});

test('item documents post their own entries and move stock by batch', () => {
  const { api, ledger, customer, item, line, bought } = trading();
  assert.throws(() => api.saveItem({ name: 'paracetamol 500', unit: 'STRIP' }), /already exists/);

  // 100 strips at 20.00: taxable 2,000.00 + 12% GST 240.00, split evenly within the state.
  assert.deepEqual([bought.taxable, bought.tax, bought.total], [200000, 24000, 224000]);
  assert.equal(ledger('Medico Supplies').balance, -224000);
  assert.equal(ledger('Purchase').balance, 200000);
  assert.deepEqual([ledger('Input CGST').balance, ledger('Input SGST').balance], [12000, 12000]);
  assert.deepEqual(api.batches({ itemId: item }).map((row) => [row.batch, row.expiry, row.qty]), [['B1', '2027-03', 40000], ['B2', '2028-01', 60000]]);

  // Sell 10 strips of B1 at 30.00: taxable 300.00 + GST 36.00.
  const sale = { type: 'Sales', date: '2026-11-02', partyId: customer, items: [line('B1', '2027-03', 10000, 3000)] };
  const sold = api.saveInvoice(sale);
  assert.equal(sold.total, 33600);
  assert.equal(ledger('City Chemist').balance, 33600);
  assert.equal(ledger('Output CGST').balance, -1800);
  assert.equal(api.items()[0].stock, 90000);
  assert.equal(api.dayBook().every((row) => row.document === 1), true);

  // More than the batch holds is refused and leaves nothing behind.
  assert.throws(() => api.saveInvoice({ ...sale, items: [line('B1', '2027-03', 31000, 3000)] }), /Not enough stock of Paracetamol 500 batch B1: short by 1/);
  assert.equal(api.dayBook().length, 2);

  // Altering the sale replaces its stock move instead of adding to it.
  api.saveInvoice({ ...sale, id: sold.id, items: [line('B1', '2027-03', 40000, 3000)] });
  assert.deepEqual(api.batches({ itemId: item }).map((row) => row.batch), ['B2']);
  assert.deepEqual(api.batches({ itemId: item, exceptVoucherId: sold.id }).map((row) => row.batch), ['B1', 'B2']);
  assert.equal(api.invoice({ id: sold.id }).items[0].qty, 40000);

  // 60 strips left at an average cost of 20.00, and the balance sheet still agrees.
  const stock = api.stockSummary({ asOf: YEAR_END });
  assert.deepEqual(stock.rows.map((row) => [row.batch, row.qty, row.value]), [['B2', 60000, 120000]]);
  const all = api.statements({ asOf: YEAR_END });
  assert.equal(all.closingStock, 120000);
  assert.equal(all.netProfit, 120000 + 120000 - 200000);
  assert.equal(all.assets, all.liabilities + all.netProfit + all.openingDifference);
  assert.deepEqual(api.stockLedger({ itemId: item }).rows.map((row) => [row.type, row.batch, row.qty, row.party]),
    [['Purchase', 'B1', 40000, 'Medico Supplies'], ['Purchase', 'B2', 60000, 'Medico Supplies'], ['Sales', 'B1', -40000, 'City Chemist']]);
  assert.throws(() => api.deleteItem({ id: item }), /has documents/);
});

test('returns reverse the sale or purchase and its stock', () => {
  const { api, ledger, supplier, customer, item, line } = trading();
  api.saveInvoice({ type: 'Sales', date: '2026-11-02', partyId: customer, items: [line('B1', '2027-03', 10000, 3000)] });
  const back = api.saveInvoice({ type: 'Credit Note', date: '2026-11-03', partyId: customer, items: [line('B1', '2027-03', 4000, 3000)] });
  assert.equal(back.number, 1);
  assert.equal(ledger('City Chemist').balance, 33600 - 13440);
  assert.equal(ledger('Sales').balance, -30000 + 12000);
  api.saveInvoice({ type: 'Debit Note', date: '2026-11-04', partyId: supplier, items: [line('B2', '2028-01', 10000, 2000)] });
  assert.equal(ledger('Purchase').balance, 200000 - 20000);
  assert.deepEqual(api.batches({ itemId: item }).map((row) => [row.batch, row.qty]), [['B1', 34000], ['B2', 50000]]);
  // A sales return comes back at cost, not at the selling rate.
  assert.equal(api.stockSummary({ asOf: YEAR_END }).value, 84 * 2000);
});

test('a stock journal brings stock in without touching the accounts', () => {
  const { api, item, line } = trading();
  const moved = api.saveInvoice({ type: 'Stock In', date: '2026-03-31', items: [line('OP', '', 10000, 1000)] });
  assert.equal(api.invoice({ id: moved.id }).type, 'Stock In');
  assert.equal(api.voucher({ id: moved.id }).lines.length, 0);
  assert.equal(api.dayBook({ types: ['Stock Journal'] })[0].particulars, 'Paracetamol 500');
  assert.throws(() => api.saveInvoice({ type: 'Stock Out', date: '2026-11-05', items: [line('OP', '', 11000, 0)] }), /Not enough stock/);
  api.saveInvoice({ type: 'Stock Out', date: '2026-11-05', items: [line('OP', '', 10000, 0)] });
  assert.deepEqual(api.batches({ itemId: item }).map((row) => row.batch), ['B1', 'B2']);

  // Stock held before the year began is opening stock, not this year's profit.
  const year = api.statements({ asOf: YEAR_END });
  assert.equal(year.openingStock, 10000);
  assert.equal(year.assets, year.liabilities + year.broughtForward + year.netProfit + year.openingDifference);
});

test('GST is split by state and summarised for returns', () => {
  const { api, ledger, group, customer, item, line } = trading();
  api.setCompany({ name: 'Speedo Traders', state: 'Maharashtra' });
  const away = api.saveLedger({ name: 'Delhi Medicals', groupId: group('Sundry Debtors'), state: 'Delhi', gstin: '07ABCDE1234F1Z5' }).id;
  api.saveInvoice({ type: 'Sales', date: '2026-11-02', partyId: customer, items: [line('B1', '2027-03', 10000, 3000)] });
  api.saveInvoice({ type: 'Sales', date: '2026-11-03', partyId: away, items: [line('B2', '2028-01', 20000, 3000)] });
  assert.equal(ledger('Output IGST').balance, -7200);

  const sales = api.taxRegister({ from: '2026-11-01', to: '2026-11-30', types: ['Sales', 'Credit Note'] });
  assert.deepEqual(sales.rows.map((row) => [row.party, row.taxable, row.cgst, row.sgst, row.igst, row.total]),
    [['City Chemist', 30000, 1800, 1800, 0, 33600], ['Delhi Medicals', 60000, 0, 0, 7200, 67200]]);

  const gst = api.gstSummary({ from: '2026-11-01', to: '2026-11-30' });
  assert.deepEqual(gst.outward, { taxable: 90000, cgst: 1800, sgst: 1800, igst: 7200, total: 100800 });
  assert.deepEqual(gst.payable, { cgst: 1800 - 12000, sgst: 1800 - 12000, igst: 7200 });
  assert.deepEqual(gst.b2b.map((row) => row.party), ['Delhi Medicals']);
  assert.deepEqual(gst.b2c, [{ gstRate: 1200, qty: 10000, taxable: 30000, tax: 3600 }]);
  assert.deepEqual(gst.hsn, [{ hsn: '3004', unit: 'STRIP', gstRate: 1200, qty: 30000, taxable: 90000, tax: 10800 }]);
  assert.equal(api.items().find((row) => row.id === item).reorderLevel, 20000);
});

test('orders name a party and items but move no stock and post nothing', () => {
  const { api, ledger, customer, item, line } = trading();
  const order = api.saveInvoice({ type: 'Sales Order', date: '2026-11-02', partyId: customer, items: [line('', '', 500000, 3000)] });
  assert.deepEqual([order.number, order.total], [1, 1680000]);
  assert.equal(ledger('City Chemist').balance, 0);
  assert.equal(api.items()[0].stock, 100000);
  const read = api.invoice({ id: order.id });
  assert.deepEqual([read.type, read.partyName, read.items[0].qty], ['Sales Order', 'City Chemist', 500000]);
  const [row] = api.dayBook({ types: ['Sales Order'] });
  assert.deepEqual([row.document, row.particulars, row.amount], [1, 'City Chemist', 1500000]);
  assert.throws(() => api.saveInvoice({ type: 'Quotation', date: '2026-11-02', items: [line('', '', 1000, 3000)] }), /Choose the party/);
  assert.throws(() => api.saveVoucher({ type: 'Quotation', date: '2026-11-02', lines: [] }), /Unknown voucher type/);
  assert.throws(() => api.deleteItem({ id: item }), /has documents/);
});

test('budgets compare with the year so far', () => {
  const { api, ledger, group, pay } = fresh();
  const rent = api.saveLedger({ name: 'Rent', groupId: group('Indirect Expenses') }).id;
  pay('2026-11-02', rent, ledger('Cash').id, 60000, 'Payment');
  pay('2026-11-03', ledger('Cash').id, ledger('Sales').id, 250000, 'Receipt');
  api.setBudget({ ledgerId: rent, amount: 100000 });
  const rows = api.budgets({ asOf: '2026-11-30' });
  assert.deepEqual(rows.map((row) => [row.name, row.budget, row.actual]), [['Sales', 0, 250000], ['Purchase', 0, 0], ['Rent', 100000, 60000]]);
  api.setBudget({ ledgerId: rent, amount: 0 });
  assert.equal(api.budgets({ asOf: '2026-11-30' }).find((row) => row.name === 'Rent').budget, 0);
});

test('a ledger with vouchers cannot be deleted until they are gone', () => {
  const { api, ledger, pay } = fresh();
  const cash = ledger('Cash').id;
  const saved = pay('2026-11-05', cash, ledger('Sales').id, 7000, 'Receipt');
  assert.throws(() => api.deleteLedger({ id: cash }), /has vouchers/);
  api.deleteVoucher({ id: saved.id });
  assert.equal(ledger('Cash').balance, 0);
  api.deleteLedger({ id: cash });
  assert.equal(ledger('Cash'), undefined);
});
