'use strict';
// Accounting and inventory engine over local PostgreSQL (SQLite for legacy import/tests).
// Money is integer paise. Entry amounts are signed: positive = debit, negative = credit.
// Quantities are integer thousandths of a unit. GST rates are hundredths of a percent.
// The financial year starts on 1 April.
const { DatabaseSync } = require('node:sqlite');
const { randomUUID } = require('node:crypto');

const VOUCHER_TYPES = ['Contra', 'Payment', 'Receipt', 'Journal', 'Sales', 'Purchase', 'Credit Note', 'Debit Note', 'Stock Journal', 'Quotation', 'Sales Order', 'Purchase Order'];
// Types that exist only as item documents and are never entered as plain vouchers.
const DOCUMENT_ONLY = ['Stock Journal', 'Quotation', 'Sales Order', 'Purchase Order'];

// Documents entered item by item. stock: +1 brings stock in, -1 takes it out.
// Those with a ledger also post to the party, that ledger and the GST ledgers.
// Orders (order: true) name a party and items but move no stock and post nothing.
const DOCUMENTS = {
  Sales: { voucher: 'Sales', stock: -1, ledger: 'Sales', group: 'Sales Accounts', tax: 'Output' },
  'Credit Note': { voucher: 'Credit Note', stock: 1, ledger: 'Sales', group: 'Sales Accounts', tax: 'Output' },
  Purchase: { voucher: 'Purchase', stock: 1, ledger: 'Purchase', group: 'Purchase Accounts', tax: 'Input' },
  'Debit Note': { voucher: 'Debit Note', stock: -1, ledger: 'Purchase', group: 'Purchase Accounts', tax: 'Input' },
  'Stock In': { voucher: 'Stock Journal', stock: 1 },
  'Stock Out': { voucher: 'Stock Journal', stock: -1 },
  Quotation: { voucher: 'Quotation', order: true },
  'Sales Order': { voucher: 'Sales Order', order: true },
  'Purchase Order': { voucher: 'Purchase Order', order: true },
};

// One entry per schema version; a books file is brought up to date on open.
const MIGRATIONS = [`
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS groups (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  parent_id INTEGER REFERENCES groups(id),
  nature TEXT NOT NULL CHECK (nature IN ('asset', 'liability', 'income', 'expense'))
);
CREATE TABLE IF NOT EXISTS ledgers (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  group_id INTEGER NOT NULL REFERENCES groups(id),
  opening INTEGER NOT NULL DEFAULT 0
);
-- uuid and updated_at exist so vouchers can later sync to the SpeedoOne server.
CREATE TABLE IF NOT EXISTS vouchers (
  id INTEGER PRIMARY KEY,
  uuid TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL,
  number INTEGER NOT NULL,
  date TEXT NOT NULL,
  narration TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL,
  UNIQUE (type, number)
);
CREATE TABLE IF NOT EXISTS entries (
  id INTEGER PRIMARY KEY,
  voucher_id INTEGER NOT NULL REFERENCES vouchers(id) ON DELETE CASCADE,
  line INTEGER NOT NULL,
  ledger_id INTEGER NOT NULL REFERENCES ledgers(id),
  amount INTEGER NOT NULL CHECK (amount <> 0)
);
CREATE TABLE IF NOT EXISTS items (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  unit TEXT NOT NULL,
  hsn TEXT NOT NULL DEFAULT '',
  gst_rate INTEGER NOT NULL DEFAULT 0,
  sale_rate INTEGER NOT NULL DEFAULT 0,
  purchase_rate INTEGER NOT NULL DEFAULT 0
);
-- A voucher that is a party document: its entries are derived from its stock moves.
CREATE TABLE IF NOT EXISTS invoices (
  voucher_id INTEGER PRIMARY KEY REFERENCES vouchers(id) ON DELETE CASCADE,
  party_id INTEGER NOT NULL REFERENCES ledgers(id)
);
-- qty is positive for stock coming in. expiry is yyyy-mm or empty.
CREATE TABLE IF NOT EXISTS stock_moves (
  id INTEGER PRIMARY KEY,
  voucher_id INTEGER NOT NULL REFERENCES vouchers(id) ON DELETE CASCADE,
  line INTEGER NOT NULL,
  item_id INTEGER NOT NULL REFERENCES items(id),
  batch TEXT NOT NULL DEFAULT '',
  expiry TEXT NOT NULL DEFAULT '',
  qty INTEGER NOT NULL CHECK (qty <> 0),
  rate INTEGER NOT NULL,
  gst_rate INTEGER NOT NULL,
  amount INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS stock_moves_item ON stock_moves (item_id);
CREATE INDEX IF NOT EXISTS stock_moves_voucher ON stock_moves (voucher_id);
CREATE INDEX IF NOT EXISTS entries_ledger ON entries (ledger_id);
CREATE INDEX IF NOT EXISTS entries_voucher ON entries (voucher_id);
CREATE INDEX IF NOT EXISTS vouchers_date ON vouchers (date);
`, `
ALTER TABLE ledgers ADD COLUMN gstin TEXT NOT NULL DEFAULT '';
ALTER TABLE ledgers ADD COLUMN state TEXT NOT NULL DEFAULT '';
ALTER TABLE ledgers ADD COLUMN phone TEXT NOT NULL DEFAULT '';
ALTER TABLE ledgers ADD COLUMN credit_days INTEGER NOT NULL DEFAULT 0;
ALTER TABLE items ADD COLUMN category TEXT NOT NULL DEFAULT '';
ALTER TABLE items ADD COLUMN brand TEXT NOT NULL DEFAULT '';
ALTER TABLE items ADD COLUMN reorder_level INTEGER NOT NULL DEFAULT 0;
-- Set when the party's state differs from the company's: the document carries IGST.
ALTER TABLE invoices ADD COLUMN interstate INTEGER NOT NULL DEFAULT 0;
-- Bank reconciliation: the date a voucher's entry on a bank ledger cleared the bank.
CREATE TABLE cleared (
  voucher_id INTEGER NOT NULL REFERENCES vouchers(id) ON DELETE CASCADE,
  ledger_id INTEGER NOT NULL REFERENCES ledgers(id),
  date TEXT NOT NULL,
  PRIMARY KEY (voucher_id, ledger_id)
);
`, `
-- A ledger's budget for the financial year.
CREATE TABLE budgets (
  ledger_id INTEGER PRIMARY KEY REFERENCES ledgers(id) ON DELETE CASCADE,
  amount INTEGER NOT NULL
);
-- Lines of quotations and orders: like stock moves, but they move no stock.
CREATE TABLE order_lines (
  id INTEGER PRIMARY KEY,
  voucher_id INTEGER NOT NULL REFERENCES vouchers(id) ON DELETE CASCADE,
  line INTEGER NOT NULL,
  item_id INTEGER NOT NULL REFERENCES items(id),
  qty INTEGER NOT NULL,
  rate INTEGER NOT NULL,
  gst_rate INTEGER NOT NULL,
  amount INTEGER NOT NULL
);
CREATE INDEX order_lines_voucher ON order_lines (voucher_id);
`, `
-- rev goes up on every local change; the server is told it so it can see an edit.
ALTER TABLE vouchers ADD COLUMN rev INTEGER NOT NULL DEFAULT 1;
-- The number a voucher carries on the Speedo One server, when it came from there.
ALTER TABLE vouchers ADD COLUMN ref TEXT NOT NULL DEFAULT '';
`, `
CREATE TABLE pricebooks (
 id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE COLLATE NOCASE,
 mode TEXT NOT NULL CHECK(mode IN ('FLAT','MARKUP','MARKDOWN')),
 pct INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1,
 is_default INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE pricebook_entries (
 book_id INTEGER NOT NULL REFERENCES pricebooks(id) ON DELETE CASCADE,
 item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
 min_qty INTEGER NOT NULL DEFAULT 0, price INTEGER NOT NULL,
 PRIMARY KEY(book_id, item_id, min_qty)
);
ALTER TABLE invoices ADD COLUMN pricebook_id INTEGER REFERENCES pricebooks(id) ON DELETE SET NULL;
`, `
CREATE TABLE cheques (
 id INTEGER PRIMARY KEY, number TEXT NOT NULL,
 direction TEXT NOT NULL CHECK(direction IN ('IN','OUT')),
 party_id INTEGER NOT NULL REFERENCES ledgers(id), bank_id INTEGER NOT NULL REFERENCES ledgers(id),
 amount INTEGER NOT NULL, date TEXT NOT NULL, entry_date TEXT NOT NULL,
 status TEXT NOT NULL, action_date TEXT NOT NULL, narration TEXT NOT NULL DEFAULT '',
 UNIQUE(bank_id, direction, number)
);
CREATE TABLE cheque_vouchers (
 cheque_id INTEGER NOT NULL REFERENCES cheques(id),
 voucher_id INTEGER NOT NULL UNIQUE REFERENCES vouchers(id),
 PRIMARY KEY(cheque_id, voucher_id)
);
`, `
CREATE TABLE custom_fields(id INTEGER PRIMARY KEY,scope TEXT NOT NULL,label TEXT NOT NULL,kind TEXT NOT NULL,
 required INTEGER NOT NULL DEFAULT 0,active INTEGER NOT NULL DEFAULT 1,options TEXT NOT NULL DEFAULT '[]',position INTEGER NOT NULL DEFAULT 0);
CREATE TABLE record_details(scope TEXT NOT NULL,record_id INTEGER NOT NULL,value TEXT NOT NULL,PRIMARY KEY(scope,record_id));
CREATE TABLE local_files(id TEXT PRIMARY KEY,name TEXT NOT NULL,mime TEXT NOT NULL,bytes BLOB NOT NULL,
 scope TEXT,record_id INTEGER,created_at TEXT NOT NULL);
ALTER TABLE stock_moves ADD COLUMN discount_pct INTEGER NOT NULL DEFAULT 0;
ALTER TABLE stock_moves ADD COLUMN description TEXT NOT NULL DEFAULT '';
ALTER TABLE order_lines ADD COLUMN discount_pct INTEGER NOT NULL DEFAULT 0;
ALTER TABLE order_lines ADD COLUMN description TEXT NOT NULL DEFAULT '';
`, `
CREATE TABLE ledger_policy(ledger_id INTEGER PRIMARY KEY REFERENCES ledgers(id) ON DELETE CASCADE,credit_limit INTEGER NOT NULL DEFAULT 0,stop_sales INTEGER NOT NULL DEFAULT 0,pricebook_id INTEGER REFERENCES pricebooks(id) ON DELETE SET NULL);
CREATE TABLE item_policy(item_id INTEGER PRIMARY KEY REFERENCES items(id) ON DELETE CASCADE,max_discount INTEGER NOT NULL DEFAULT 10000,max_qty INTEGER NOT NULL DEFAULT 0,stop_sales INTEGER NOT NULL DEFAULT 0,rack TEXT NOT NULL DEFAULT '');
CREATE TABLE bill_allocations(payment_id INTEGER NOT NULL REFERENCES vouchers(id),bill_id INTEGER NOT NULL REFERENCES vouchers(id),party_id INTEGER NOT NULL REFERENCES ledgers(id),amount INTEGER NOT NULL CHECK(amount>0),PRIMARY KEY(payment_id,bill_id,party_id),CHECK(payment_id<>bill_id));
CREATE INDEX bill_allocations_bill ON bill_allocations(bill_id,party_id);
`, `
CREATE TABLE catalog_masters(id INTEGER PRIMARY KEY,kind TEXT NOT NULL,name TEXT NOT NULL,data TEXT NOT NULL DEFAULT '{}',related_id INTEGER REFERENCES catalog_masters(id));
CREATE UNIQUE INDEX catalog_master_name ON catalog_masters(kind,lower(name));
CREATE TABLE item_master_links(item_id INTEGER PRIMARY KEY REFERENCES items(id) ON DELETE CASCADE,category_id INTEGER REFERENCES catalog_masters(id),item_group_id INTEGER REFERENCES catalog_masters(id),unit_id INTEGER REFERENCES catalog_masters(id),hsn_id INTEGER REFERENCES catalog_masters(id),gst_slab_id INTEGER REFERENCES catalog_masters(id));
`];

// [name, parent, nature]. Children follow their parent so the parent id exists.
const DEFAULT_GROUPS = [
  ['Capital Account', null, 'liability'],
  ['Loans (Liability)', null, 'liability'],
  ['Current Liabilities', null, 'liability'],
  ['Sundry Creditors', 'Current Liabilities', 'liability'],
  ['Duties & Taxes', 'Current Liabilities', 'liability'],
  ['Provisions', 'Current Liabilities', 'liability'],
  ['Fixed Assets', null, 'asset'],
  ['Investments', null, 'asset'],
  ['Current Assets', null, 'asset'],
  ['Cash-in-Hand', 'Current Assets', 'asset'],
  ['Bank Accounts', 'Current Assets', 'asset'],
  ['Sundry Debtors', 'Current Assets', 'asset'],
  ['Stock-in-Hand', 'Current Assets', 'asset'],
  ['Loans & Advances (Asset)', 'Current Assets', 'asset'],
  ['Sales Accounts', null, 'income'],
  ['Direct Incomes', null, 'income'],
  ['Indirect Incomes', null, 'income'],
  ['Purchase Accounts', null, 'expense'],
  ['Direct Expenses', null, 'expense'],
  ['Indirect Expenses', null, 'expense'],
  ['Reserves & Surplus', 'Capital Account', 'liability'],
  ['Bank OD A/c', 'Loans (Liability)', 'liability'],
  ['Secured Loans', 'Loans (Liability)', 'liability'],
  ['Unsecured Loans', 'Loans (Liability)', 'liability'],
  ['Deposits (Asset)', 'Current Assets', 'asset'],
  ['Branch/Divisions', null, 'asset'],
  ['Misc. Expenses (ASSET)', null, 'asset'],
  ['Suspense A/c', null, 'asset'],
];

const DEFAULT_LEDGERS = [
  ['Cash', 'Cash-in-Hand'],
  ['Sales', 'Sales Accounts'],
  ['Purchase', 'Purchase Accounts'],
  ['Profit & Loss A/c', 'Reserves & Surplus'],
];

const COMPANY_FIELDS = ['name', 'address', 'state', 'gstin', 'phone'];
const ALL_DATES = ['0000-01-01', '9999-12-31'];

// A message safe to show the user as-is.
class BooksError extends Error {}

function isDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

const pad = (n) => String(n).padStart(2, '0');
function today() {
  const now = new Date();
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}
// First day of the financial year (1 April) that a date falls in.
function financialYearStart(date) {
  const [year, month] = date.split('-').map(Number);
  return `${month >= 4 ? year : year - 1}-04-01`;
}
const dayBefore = (date) => new Date(Date.parse(`${date}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);
const daysBetween = (from, to) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);
const rupees = (paise) => (Math.abs(paise) / 100).toFixed(2);
const sameText = (a, b) => a.trim().toLowerCase() === b.trim().toLowerCase();

// Splits a document's GST into the heads it is posted and reported under.
function splitTax(tax, interstate) {
  const half = interstate ? 0 : Math.round(tax / 2);
  return { cgst: half, sgst: interstate ? 0 : tax - half, igst: interstate ? tax : 0 };
}

function openBooks(file,{driver}={}) {
  const db = driver!=='sqlite'&&process.env.SPEEDOONE_PG_URL ? new (require('./postgres').PostgresDatabase)(file) : new DatabaseSync(file);
  try {
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  for (let version = db.prepare('PRAGMA user_version').get().user_version; version < MIGRATIONS.length; version++) {
    db.exec(`BEGIN; ${MIGRATIONS[version]} PRAGMA user_version = ${version + 1}; COMMIT;`);
  }

  const cache = new Map();
  const stmt = (sql) => {
    if (!cache.has(sql)) cache.set(sql, db.prepare(sql));
    return cache.get(sql);
  };
  let transactionDepth=0;
  const tx = (work) => {
    const savepoint=transactionDepth?`books_nested_${transactionDepth}`:null;
    db.exec(savepoint?`SAVEPOINT ${savepoint}`:'BEGIN IMMEDIATE');
    transactionDepth++;
    try {
      const result = work();
      db.exec(savepoint?`RELEASE ${savepoint}`:'COMMIT');
      return result;
    } catch (error) {
      if(savepoint){db.exec(`ROLLBACK TO ${savepoint}`);db.exec(`RELEASE ${savepoint}`);}else db.exec('ROLLBACK');
      throw error;
    }finally{transactionDepth--;}
  };
  const inserted = (result) => Number(result.lastInsertRowid);
  const details = require('./details')({ db, BooksError, isDate });
  const retail=require('./retail')({db,BooksError,tx,isDate,ledgers,items,today});
  const references=require('./bill-references')({db,BooksError,tx,isDate,ledgers,today,checkDates:retail.checkDates});
  retail.setReferenceProvider(references.api.referenceOutstanding);
  const inventory=require('./inventory')({db,BooksError,settings:details.settings,isDate});
  const catalog=require('./catalog')({db,BooksError,tx});
  const meta = (key) => stmt('SELECT value FROM meta WHERE key = ?').get(key)?.value ?? '';
  const setMeta = (key, value) => stmt('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value').run(key, value);

  if (stmt('SELECT COUNT(*) AS n FROM groups').get().n === 0) {
    tx(() => {
      const ids = new Map();
      for (const [name, parent, nature] of DEFAULT_GROUPS) ids.set(name, inserted(stmt('INSERT INTO groups (name, parent_id, nature) VALUES (?, ?, ?)').run(name, parent ? ids.get(parent) : null, nature)));
      for (const [name, group] of DEFAULT_LEDGERS) stmt('INSERT INTO ledgers (name, group_id) VALUES (?, ?)').run(name, ids.get(group));
      setMeta('builtin_group_ids', JSON.stringify([...ids.values()]));
      setMeta('company_name', 'My Company');
    });
  }

  // Add defaults once. Never reclassify an existing group or recreate a deleted ledger.
  if (!meta('standard_masters_v1')) tx(() => {
    const builtIn = meta('builtin_group_ids') ? JSON.parse(meta('builtin_group_ids')) :
      DEFAULT_GROUPS.slice(0,20).flatMap(([name],index) => {
        const row=stmt('SELECT id FROM groups WHERE id = ? AND name = ?').get(index+1,name);
        return row ? [row.id] : [];
      });
    for (const [name,parent,nature] of DEFAULT_GROUPS) {
      if (stmt('SELECT id FROM groups WHERE name = ?').get(name)) continue;
      const parentId=parent?stmt('SELECT id FROM groups WHERE name = ?').get(parent)?.id:null;
      builtIn.push(inserted(stmt('INSERT INTO groups (name,parent_id,nature) VALUES (?,?,?)').run(name,parentId,nature)));
    }
    const retained=stmt('SELECT id FROM groups WHERE name = ?').get('Reserves & Surplus');
    if (!stmt('SELECT id FROM ledgers WHERE name = ?').get('Profit & Loss A/c'))
      stmt('INSERT INTO ledgers (name,group_id) VALUES (?,?)').run('Profit & Loss A/c',retained.id);
    setMeta('builtin_group_ids',JSON.stringify(builtIn));
    setMeta('standard_masters_v1','1');
  });
  const builtInGroupIds=new Set(JSON.parse(meta('builtin_group_ids')));

  // ---- company ----

  function company() {
    const fields = Object.fromEntries(COMPANY_FIELDS.map((field) => [field, meta(`company_${field}`)]));
    return { ...fields, fyStart: financialYearStart(today()) };
  }

  function setCompany(values) {
    if (!String(values.name || '').trim()) throw new BooksError('Company name is required');
    tx(() => COMPANY_FIELDS.forEach((field) => setMeta(`company_${field}`, String(values[field] ?? '').trim())));
    return company();
  }

  function userProfile(){return JSON.parse(meta('user_profile')||'{}');}
  function saveUserProfile(values={}){
    const result={};for(const [key,max] of Object.entries({name:120,dateOfBirth:10,email:254,phone:40,designation:120})){
      result[key]=String(values[key]||'').trim();if(result[key].length>max)throw new BooksError(key+' is too long');
    }
    if(!result.name)throw new BooksError('Your name is required');
    if(result.dateOfBirth&&(!isDate(result.dateOfBirth)||result.dateOfBirth>today()))throw new BooksError('Enter a valid date of birth that is not in the future');
    if(result.email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result.email))throw new BooksError('Enter a valid email address');
    setMeta('user_profile',JSON.stringify(result));return result;
  }

  // ---- groups and ledgers ----

  function groups() {
    return stmt('SELECT id, name, parent_id AS parentId, nature FROM groups ORDER BY name COLLATE NOCASE').all().map(row=>({...row,builtIn:builtInGroupIds.has(row.id)}));
  }

  function saveGroup({ id, name, parentId }) {
    const clean = String(name || '').trim();
    if (!clean) throw new BooksError('Group name is required');
    const parent = Number.isInteger(parentId) && stmt('SELECT id, nature FROM groups WHERE id = ?').get(parentId);
    if (!parent) throw new BooksError('Choose the group this one comes under');
    const clash = stmt('SELECT id FROM groups WHERE name = ?').get(clean);
    if (clash && clash.id !== id) throw new BooksError(`A group named "${clean}" already exists`);
    if (!id) return { id: inserted(stmt('INSERT INTO groups (name, parent_id, nature) VALUES (?, ?, ?)').run(clean, parent.id, parent.nature)) };
    if (id === parent.id) throw new BooksError('A group cannot come under itself');
    if (!stmt('SELECT parent_id FROM groups WHERE id = ?').get(id)?.parent_id) throw new BooksError('The primary groups cannot be changed');
    if (builtInGroupIds.has(id)) throw new BooksError('Built-in groups cannot be changed');
    const descendants=stmt('WITH RECURSIVE tree(id) AS (SELECT CAST(? AS INTEGER) UNION SELECT g.id FROM groups g JOIN tree t ON g.parent_id=t.id) SELECT id FROM tree').all(id);
    if(descendants.some(row=>row.id===parent.id))throw new BooksError('A group cannot come under one of its own subgroups');
    tx(()=>{
      stmt('UPDATE groups SET name = ?, parent_id = ?, nature = ? WHERE id = ?').run(clean, parent.id, parent.nature, id);
      for(const row of descendants)stmt('UPDATE groups SET nature = ? WHERE id = ?').run(parent.nature,row.id);
      retail.validateAllocations();
    });
    return { id };
  }

  function deleteGroup({ id }) {
    const group = stmt('SELECT parent_id FROM groups WHERE id = ?').get(id);
    if (!group?.parent_id) throw new BooksError('The primary groups cannot be deleted');
    if (builtInGroupIds.has(id)) throw new BooksError('Built-in groups cannot be deleted');
    if (stmt('SELECT 1 FROM ledgers WHERE group_id = ? UNION SELECT 1 FROM groups WHERE parent_id = ?').get(id, id)) throw new BooksError('This group still has ledgers or groups under it');
    stmt('DELETE FROM groups WHERE id = ?').run(id);
    return { id };
  }

  // group: only the ledgers directly under the group of that name.
  function ledgers({ group = null } = {}) {
    const tree = new Map(groups().map(row => [row.id,row]));
    const standard=new Set(DEFAULT_GROUPS.map(([name])=>name));
    const primary = id => { const seen=new Set();while(tree.get(id)?.parentId&&!standard.has(tree.get(id).name)&&!seen.has(id)){seen.add(id);id=tree.get(id).parentId;}return tree.get(id)?.name; };
    return stmt(`
      SELECT l.id, l.name, l.group_id AS groupId, g.name AS groupName, g.nature, l.opening,
        l.gstin, l.state, l.phone, l.credit_days AS creditDays,
        l.opening + COALESCE((SELECT SUM(e.amount) FROM entries e WHERE e.ledger_id = l.id), 0) AS balance
      FROM ledgers l JOIN groups g ON g.id = l.group_id
      WHERE ?1 IS NULL OR g.name = ?1
      ORDER BY l.name COLLATE NOCASE`).all(group).map(row=>({...row,accountGroup:primary(row.groupId),...retail.ledgerPolicy(row.id)}));
  }

  function saveLedger({ id, name, groupId, opening = 0, gstin = '', state = '', phone = '', creditDays = 0 }) {
    const clean = String(name || '').trim();
    if (!clean) throw new BooksError('Ledger name is required');
    if (!Number.isInteger(groupId) || !stmt('SELECT 1 FROM groups WHERE id = ?').get(groupId)) throw new BooksError('Choose a group for the ledger');
    if (!Number.isSafeInteger(opening)) throw new BooksError('Opening balance is not a valid amount');
    if (!Number.isInteger(creditDays) || creditDays < 0) throw new BooksError('Credit days must be a whole number');
    const clash = stmt('SELECT id FROM ledgers WHERE name = ?').get(clean);
    if (clash && clash.id !== id) throw new BooksError(`A ledger named "${clean}" already exists`);
    const values = [clean, groupId, opening, String(gstin).trim().toUpperCase(), String(state).trim(), String(phone).trim(), creditDays];
    if (id) {
      const { changes } = stmt('UPDATE ledgers SET name = ?, group_id = ?, opening = ?, gstin = ?, state = ?, phone = ?, credit_days = ? WHERE id = ?').run(...values, id);
      if (!changes) throw new BooksError('Ledger not found');
      retail.validateAllocations();
      return { id };
    }
    return { id: inserted(stmt('INSERT INTO ledgers (name, group_id, opening, gstin, state, phone, credit_days) VALUES (?, ?, ?, ?, ?, ?, ?)').run(...values)) };
  }

  function deleteLedger({ id }) {
    if (stmt('SELECT 1 FROM entries WHERE ledger_id = ? LIMIT 1').get(id)) throw new BooksError('This ledger has vouchers. Delete those vouchers first.');
    if (stmt('SELECT 1 FROM invoices WHERE party_id=?1 UNION ALL SELECT 1 FROM cheques WHERE party_id=?1 OR bank_id=?1 LIMIT 1').get(id)) throw new BooksError('This ledger is used by a document or cheque and cannot be deleted.');
    stmt('DELETE FROM ledgers WHERE id = ?').run(id);
    return { id };
  }

  const ledgerById = (id) => (Number.isInteger(id) ? stmt('SELECT l.id,l.name,l.state,g.name AS groupName FROM ledgers l JOIN groups g ON g.id=l.group_id WHERE l.id = ?').get(id) : undefined);

  // The ledger a document posts to automatically, created the first time it is needed.
  function postingLedger(name, groupName) {
    const found = stmt('SELECT id FROM ledgers WHERE name = ?').get(name);
    if (found) return found.id;
    return inserted(stmt('INSERT INTO ledgers (name, group_id) VALUES (?, (SELECT id FROM groups WHERE name = ?))').run(name, groupName));
  }

  // ---- vouchers ----

  function nextNumber({ type }) {
    return stmt('SELECT COALESCE(MAX(number), 0) + 1 AS n FROM vouchers WHERE type = ?').get(DOCUMENTS[type]?.voucher ?? type).n;
  }

  // Remembers the earliest voucher date changed here since the last upload to the server.
  function touch(...dates) {
    setMeta('sync_dirty_from', [meta('sync_dirty_from'), ...dates].filter(Boolean).sort()[0]);
  }

  // Stores a voucher and its entries, replacing any earlier version of it,
  // including the document details an earlier version had. Call inside tx().
  // local: false stores the server's copy (given uuid and ref) without marking it changed here.
  function writeVoucher({ id, type, date, narration, lines, uuid = randomUUID(), ref = '', local = true }) {
    retail.checkDates(date,id?stmt('SELECT date FROM vouchers WHERE id=?').get(id)?.date:null);
    if (id && stmt('SELECT 1 FROM cheque_vouchers WHERE voucher_id=?').get(id)) throw new BooksError('Manage this voucher through the cheque register');
    const now = new Date().toISOString();
    let voucherId = id;
    let number;
    if (id) {
      const old = stmt('SELECT type, number, date FROM vouchers WHERE id = ?').get(id);
      if (!old) throw new BooksError('Voucher not found');
      if (local) touch(old.date);
      number = old.type === type ? old.number : nextNumber({ type });
      stmt('UPDATE vouchers SET type = ?, number = ?, date = ?, narration = ?, updated_at = ?, rev = rev + ? WHERE id = ?').run(type, number, date, String(narration), now, local ? 1 : 0, id);
      for (const table of ['entries', 'stock_moves', 'order_lines', 'invoices']) stmt(`DELETE FROM ${table} WHERE voucher_id = ?`).run(id);
    } else {
      number = nextNumber({ type });
      voucherId = inserted(stmt('INSERT INTO vouchers (uuid, ref, type, number, date, narration, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(uuid, ref, type, number, date, String(narration), now));
    }
    if (local) touch(date);
    lines.forEach((line, index) => stmt('INSERT INTO entries (voucher_id, line, ledger_id, amount) VALUES (?, ?, ?, ?)').run(voucherId, index, line.ledgerId, line.amount));
    retail.validateAllocations();
    return { id: voucherId, number };
  }

  function saveVoucher({ id, type, date, narration = '', lines, details:extra }) {
    if (!VOUCHER_TYPES.includes(type) || DOCUMENT_ONLY.includes(type)) throw new BooksError('Unknown voucher type');
    if (!isDate(date)) throw new BooksError('Voucher date is not valid');
    if (!Array.isArray(lines) || lines.length < 2) throw new BooksError('A voucher needs at least two lines');
    let sum = 0;
    for (const line of lines) {
      if (!ledgerById(line.ledgerId)) throw new BooksError('Every line needs a ledger');
      if (!Number.isSafeInteger(line.amount) || line.amount === 0) throw new BooksError('Every line needs an amount');
      sum += line.amount;
    }
    if (sum !== 0) throw new BooksError(`Debit and credit totals differ by ${rupees(sum)}`);
    return tx(() => {
      if(type==='Sales')for(const party of ledgers().filter(row=>['Sundry Debtors','Sundry Creditors','Cash-in-Hand','Bank Accounts'].includes(row.accountGroup))){
        const total=lines.filter(line=>line.ledgerId===party.id).reduce((sum,line)=>sum+line.amount,0);
        if(total>0)retail.checkSale({id,type,partyId:party.id,total,rows:[],date});
      }
      const affected=stockKeys(id),saved=writeVoucher({ id, type, date, narration, lines });
      checkStock(affected);details.save('document',saved.id,extra||{});return saved;
    });
  }

  function voucher({ id }) {
    const head = stmt('SELECT id, type, number, date, narration FROM vouchers WHERE id = ?').get(id);
    if (!head) throw new BooksError('Voucher not found');
    const lines = stmt(`
      SELECT e.ledger_id AS ledgerId, l.name AS ledgerName, e.amount
      FROM entries e JOIN ledgers l ON l.id = e.ledger_id
      WHERE e.voucher_id = ? ORDER BY e.line`).all(id);
    return { ...head, lines,details:details.recordDetails({scope:'document',id}) };
  }

  function deleteVoucher({ id }) {
    references.checkDelete(id);
    retail.checkDelete(id);
    retail.checkDates(stmt('SELECT date FROM vouchers WHERE id=?').get(id)?.date);
    if (stmt('SELECT 1 FROM cheque_vouchers WHERE voucher_id=?').get(id)) throw new BooksError('Manage this voucher through the cheque register');
    const old = stmt('SELECT date FROM vouchers WHERE id = ?').get(id);
    if (old) touch(old.date);
    const affected=stockKeys(id);
    stmt('DELETE FROM vouchers WHERE id = ?').run(id);
    checkStock(affected);
    return { id };
  }

  // Called inside the write transaction so rejected alterations restore every posting.
  function stockKeys(id){return id?stmt('SELECT DISTINCT item_id AS itemId,batch FROM stock_moves WHERE voucher_id=?').all(id):[];}
  function checkStock(keys){
    for(const key of keys){
      const row=stmt('SELECT i.name,COALESCE(SUM(m.qty),0) AS qty FROM items i LEFT JOIN stock_moves m ON m.item_id=i.id AND m.batch=? WHERE i.id=? GROUP BY i.id').get(key.batch,key.itemId);
      if(row?.qty<0)throw new BooksError(`Not enough stock of ${row.name}${key.batch?` batch ${key.batch}`:''}: this change would leave negative stock. Adjust the related outgoing vouchers first.`);
    }
  }

  // Vouchers in date order. types: only those voucher types. touches: only vouchers
  // with an entry on a ledger whose group has that name or that nature.
  function dayBook({ from = ALL_DATES[0], to = ALL_DATES[1], types = null, touches = null } = {}) {
    const where = ['v.date BETWEEN ? AND ?'];
    const params = [from, to];
    if (types?.length) {
      where.push(`v.type IN (${types.map(() => '?').join(', ')})`);
      params.push(...types);
    }
    if (touches) {
      where.push('EXISTS (SELECT 1 FROM entries e JOIN ledgers l ON l.id = e.ledger_id JOIN groups g ON g.id = l.group_id WHERE e.voucher_id = v.id AND (g.name = ? OR g.nature = ?))');
      params.push(touches, touches);
    }
    return stmt(`
      SELECT v.id, v.date, v.type, v.number, v.narration,
        EXISTS (SELECT 1 FROM stock_moves m WHERE m.voucher_id = v.id UNION ALL SELECT 1 FROM order_lines o WHERE o.voucher_id = v.id UNION ALL SELECT 1 FROM invoices i WHERE i.voucher_id=v.id) AS document,
        COALESCE(
          (SELECT l.name FROM entries e JOIN ledgers l ON l.id = e.ledger_id WHERE e.voucher_id = v.id ORDER BY e.line LIMIT 1),
          (SELECT l.name FROM invoices i JOIN ledgers l ON l.id = i.party_id WHERE i.voucher_id = v.id),
          (SELECT i.name FROM stock_moves m JOIN items i ON i.id = m.item_id WHERE m.voucher_id = v.id ORDER BY m.line LIMIT 1)) AS particulars,
        COALESCE(
          (SELECT SUM(e.amount) FROM entries e WHERE e.voucher_id = v.id AND e.amount > 0),
          (SELECT SUM(m.amount) FROM stock_moves m WHERE m.voucher_id = v.id),
          (SELECT SUM(o.amount) FROM order_lines o WHERE o.voucher_id = v.id), 0) AS amount
      FROM vouchers v WHERE ${where.join(' AND ')} ORDER BY v.date, v.id`).all(...params);
  }

  function ledgerStatement({ ledgerId, from = ALL_DATES[0], to = ALL_DATES[1] }) {
    const ledger = stmt('SELECT l.id, l.name, l.opening, g.name AS groupName FROM ledgers l JOIN groups g ON g.id = l.group_id WHERE l.id = ?').get(ledgerId);
    if (!ledger) throw new BooksError('Ledger not found');
    const before = stmt('SELECT COALESCE(SUM(e.amount), 0) AS n FROM entries e JOIN vouchers v ON v.id = e.voucher_id WHERE e.ledger_id = ? AND v.date < ?').get(ledgerId, from).n;
    const rows = stmt(`
      SELECT v.id AS voucherId, v.date, v.type, v.number, v.narration, SUM(e.amount) AS amount,
        EXISTS (SELECT 1 FROM stock_moves m WHERE m.voucher_id = v.id UNION ALL SELECT 1 FROM invoices i WHERE i.voucher_id=v.id) AS document,
        (SELECT l.name FROM entries o JOIN ledgers l ON l.id = o.ledger_id WHERE o.voucher_id = v.id AND o.ledger_id <> ? ORDER BY o.line LIMIT 1) AS particulars
      FROM entries e JOIN vouchers v ON v.id = e.voucher_id
      WHERE e.ledger_id = ? AND v.date BETWEEN ? AND ?
      GROUP BY v.id ORDER BY v.date, v.id`).all(ledgerId, ledgerId, from, to);
    const opening = ledger.opening + before;
    const closing = rows.reduce((total, row) => total + row.amount, opening);
    return { ledger: { id: ledger.id, name: ledger.name, groupName: ledger.groupName }, opening, rows, closing };
  }

  // ---- financial statements ----

  // Every ledger's balance as of a date, and the totals behind the trial balance, trading
  // and profit and loss accounts and the balance sheet for the financial year the date is in.
  // Each row carries `period`: the year's movement for income and expense, else the balance.
  function statements({ asOf = today(), from = financialYearStart(asOf) } = {}) {
    if(!isDate(from)||!isDate(asOf)||from>asOf)throw new BooksError('Choose a valid statement period');
    const tree = new Map(stmt('SELECT id, name, parent_id AS parentId FROM groups').all().map((group) => [group.id, group]));
    const primaryOf = (id) => (tree.get(id).parentId ? primaryOf(tree.get(id).parentId) : tree.get(id).name);
    const upTo = '(SELECT SUM(e.amount) FROM entries e JOIN vouchers v ON v.id = e.voucher_id WHERE e.ledger_id = l.id AND v.date';
    const all = stmt(`
      SELECT l.id AS ledgerId, l.name, g.id AS groupId, g.name AS groupName, g.nature,
        l.opening + COALESCE(${upTo} <= ?), 0) AS balance,
        l.opening + COALESCE(${upTo} < ?), 0) AS before
      FROM ledgers l JOIN groups g ON g.id = l.group_id
      ORDER BY g.id, l.name COLLATE NOCASE`).all(asOf, from);

    const sums = { asset: 0, liability: 0, income: 0, expense: 0, earlier: 0, debit: 0, credit: 0 };
    const byPrimary = {};
    for (const row of all) {
      const yearly = row.nature === 'income' || row.nature === 'expense';
      row.primary = primaryOf(row.groupId);
      row.period = yearly ? row.balance - row.before : row.balance;
      sums[row.nature] += row.period;
      if (yearly) sums.earlier -= row.before;
      byPrimary[row.primary] = (byPrimary[row.primary] || 0) + row.period;
      if (row.balance > 0) sums.debit += row.balance;
      else sums.credit -= row.balance;
    }
    // Purchases are expensed in full, so unsold stock is carried as an asset:
    // the year's profit takes the rise in stock, earlier years keep the opening stock.
    const closingStock = stockSummary({ asOf }).value;
    const openingStock = stockSummary({ asOf: dayBefore(from) }).value;
    const income = 0 - sums.income;
    return {
      asOf,
      from,
      ledgers: all.filter((row) => row.balance !== 0 || row.period !== 0),
      byPrimary,
      debit: sums.debit,
      credit: sums.credit,
      income,
      expense: sums.expense,
      openingStock,
      closingStock,
      netProfit: income - sums.expense + closingStock - openingStock,
      broughtForward: sums.earlier + openingStock,
      assets: sums.asset + closingStock,
      liabilities: -sums.liability,
      // Debit excess of opening balances. Zero when the openings were entered in full.
      openingDifference: stmt('SELECT COALESCE(SUM(opening), 0) AS n FROM ledgers').get().n,
    };
  }

  // Movement of cash and bank over a period, by the group of the account on the other side.
  function cashFlow({ from = financialYearStart(today()), to = today() } = {}) {
    const cash = "(WITH RECURSIVE cash_groups(id) AS (SELECT id FROM groups WHERE name IN ('Cash-in-Hand', 'Bank Accounts') UNION ALL SELECT g.id FROM groups g JOIN cash_groups p ON g.parent_id=p.id) SELECT id FROM ledgers WHERE group_id IN (SELECT id FROM cash_groups))";
    const opening = stmt(`
      SELECT COALESCE(SUM(l.opening), 0) + COALESCE((SELECT SUM(e.amount) FROM entries e JOIN vouchers v ON v.id = e.voucher_id WHERE e.ledger_id IN ${cash} AND v.date < ?), 0) AS n
      FROM ledgers l WHERE l.id IN ${cash}`).get(from).n;
    const rows = stmt(`
      SELECT g.name AS name, -SUM(e.amount) AS amount
      FROM entries e JOIN vouchers v ON v.id = e.voucher_id JOIN ledgers l ON l.id = e.ledger_id JOIN groups g ON g.id = l.group_id
      WHERE v.date BETWEEN ? AND ? AND e.ledger_id NOT IN ${cash}
        AND EXISTS (SELECT 1 FROM entries c WHERE c.voucher_id = v.id AND c.ledger_id IN ${cash})
      GROUP BY g.id HAVING SUM(e.amount) <> 0 ORDER BY g.id`).all(from, to);
    return { from, to, opening, rows, closing: rows.reduce((total, row) => total + row.amount, opening) };
  }

  // What each party owes (group 'Sundry Debtors') or is owed ('Sundry Creditors'), by age.
  // Payments settle the oldest bills first; what is left is aged from the bill date.
  function ageing({ asOf = today(), group = 'Sundry Debtors' } = {}) {
    const sign = group === 'Sundry Creditors' ? -1 : 1;
    const moves = new Map();
    for (const row of stmt(`
      SELECT e.ledger_id AS id, v.date, SUM(e.amount) AS amount
      FROM entries e JOIN vouchers v ON v.id = e.voucher_id JOIN ledgers l ON l.id = e.ledger_id JOIN groups g ON g.id = l.group_id
      WHERE g.name = ? AND v.date <= ? GROUP BY e.ledger_id, v.id ORDER BY v.date, v.id`).all(group, asOf)) {
      if (!moves.has(row.id)) moves.set(row.id, []);
      moves.get(row.id).push(row);
    }
    const rows = [];
    for (const party of ledgers({ group })) {
      // An opening balance is the oldest bill of all.
      const all = [{ date: null, amount: party.opening }, ...(moves.get(party.id) || [])].map((move) => ({ date: move.date, amount: move.amount * sign }));
      let paid = all.reduce((total, move) => (move.amount < 0 ? total - move.amount : total), 0);
      const row = { ledgerId: party.id, name: party.name, phone: party.phone, total: 0, current: 0, days30: 0, days60: 0, days90: 0, advance: 0 };
      for (const bill of all.filter((move) => move.amount > 0)) {
        const settled = Math.min(paid, bill.amount);
        paid -= settled;
        const due = bill.amount - settled;
        const age = bill.date ? daysBetween(bill.date, asOf) : Infinity;
        row[age <= 30 ? 'current' : age <= 60 ? 'days30' : age <= 90 ? 'days60' : 'days90'] += due;
        row.total += due;
      }
      row.advance = paid;
      row.total -= paid;
      if (row.total !== 0) rows.push(row);
    }
    return { asOf, group, rows };
  }

  // Budget against actual for every income and expense ledger, for the financial year of a date.
  function budgets({ asOf = today() } = {}) {
    const actual = new Map(statements({ asOf }).ledgers.map((row) => [row.ledgerId, row.period]));
    return stmt(`
      SELECT l.id AS ledgerId, l.name, g.name AS groupName, g.nature, COALESCE(b.amount, 0) AS budget
      FROM ledgers l JOIN groups g ON g.id = l.group_id LEFT JOIN budgets b ON b.ledger_id = l.id
      WHERE g.nature IN ('income', 'expense') ORDER BY g.nature DESC, g.id, l.name COLLATE NOCASE`).all()
      .map((row) => ({ ...row, actual: (actual.get(row.ledgerId) || 0) * (row.nature === 'income' ? -1 : 1) }));
  }

  // amount 0 removes the budget.
  function setBudget({ ledgerId, amount }) {
    if (!ledgerById(ledgerId)) throw new BooksError('Ledger not found');
    if (!Number.isSafeInteger(amount) || amount < 0) throw new BooksError('Budget is not a valid amount');
    if (amount === 0) stmt('DELETE FROM budgets WHERE ledger_id = ?').run(ledgerId);
    else stmt('INSERT INTO budgets (ledger_id, amount) VALUES (?, ?) ON CONFLICT (ledger_id) DO UPDATE SET amount = excluded.amount').run(ledgerId, amount);
    return { ledgerId, amount };
  }

  // ---- bank reconciliation ----

  function bankBook({ ledgerId,from=ALL_DATES[0],to=ALL_DATES[1] }) {
    if(from>to||(from!==ALL_DATES[0]&&!isDate(from))||(to!==ALL_DATES[1]&&!isDate(to)))throw new BooksError('Choose a valid bank report period');
    const ledger = stmt('SELECT id, name, opening FROM ledgers WHERE id = ?').get(ledgerId);
    if (!ledger) throw new BooksError('Ledger not found');
    const rows = stmt(`
      SELECT v.id AS voucherId, v.date, v.type, v.number, v.narration, SUM(e.amount) AS amount, c.date AS cleared,
        (SELECT l.name FROM entries o JOIN ledgers l ON l.id = o.ledger_id WHERE o.voucher_id = v.id AND o.ledger_id <> e.ledger_id ORDER BY o.line LIMIT 1) AS particulars
      FROM entries e JOIN vouchers v ON v.id = e.voucher_id
      LEFT JOIN cleared c ON c.voucher_id = v.id AND c.ledger_id = e.ledger_id
      WHERE e.ledger_id = ? AND v.date<=? GROUP BY v.id, c.date, e.ledger_id ORDER BY v.date, v.id`).all(ledgerId,to);
    const books = rows.reduce((total, row) => total + row.amount, ledger.opening);
    const uncleared = rows.reduce((total, row) => (row.cleared&&row.cleared<=to ? total : total + row.amount), 0);
    return { ledger, rows:rows.filter(row=>row.date>=from), books, uncleared, bank: books - uncleared };
  }

  // date: when the entry cleared the bank, or null to mark it uncleared again.
  function setCleared({ voucherId, ledgerId, date }) {
    if (date === null) stmt('DELETE FROM cleared WHERE voucher_id = ? AND ledger_id = ?').run(voucherId, ledgerId);
    else if (!isDate(date)) throw new BooksError('Cleared date is not valid');
    else stmt('INSERT INTO cleared (voucher_id, ledger_id, date) VALUES (?, ?, ?) ON CONFLICT (voucher_id, ledger_id) DO UPDATE SET date = excluded.date').run(voucherId, ledgerId, date);
    return { voucherId, ledgerId, date };
  }

  // ---- items and stock ----

  function items() {
    return stmt(`
      SELECT i.id, i.name, i.unit, i.hsn, i.category, i.brand, i.gst_rate AS gstRate, i.sale_rate AS saleRate,
        i.purchase_rate AS purchaseRate, i.reorder_level AS reorderLevel, COALESCE(json_extract(d.value,'$.sku'),'') AS sku,
        COALESCE((SELECT SUM(m.qty) FROM stock_moves m WHERE m.item_id = i.id), 0) AS stock
      FROM items i LEFT JOIN record_details d ON d.scope='item' AND d.record_id=i.id ORDER BY i.name COLLATE NOCASE`).all().map(row=>({...row,...retail.itemPolicy(row.id),inventoryRules:inventory.rules({itemId:row.id}),...catalog.links(row.id),units:catalog.units.options(row.id).map(unit=>({...unit,stock:row.stock/unit.multiplier}))}));
  }

  function saveItem({ id, name, unit, unitId=null, hsn = '', category = '', brand = '', gstRate = 0, saleRate = 0, purchaseRate = 0, reorderLevel = 0 }) {
    const clean = String(name || '').trim();
    const cleanUnit = unitId?String(unit||'').trim():String(unit || '').trim().toUpperCase();
    if (!clean) throw new BooksError('Item name is required');
    if (!cleanUnit) throw new BooksError('Unit is required, for example PCS or STRIP');
    if (!Number.isInteger(gstRate) || gstRate < 0 || gstRate > 10000) throw new BooksError('GST rate must be between 0 and 100');
    if (![saleRate, purchaseRate, reorderLevel].every((value) => Number.isSafeInteger(value) && value >= 0)) throw new BooksError('Rates and reorder level must be valid numbers');
    const clash = stmt('SELECT id FROM items WHERE name = ?').get(clean);
    if (clash && clash.id !== id) throw new BooksError(`An item named "${clean}" already exists`);
    const values = [clean, cleanUnit, String(hsn).trim(), String(category).trim(), String(brand).trim(), gstRate, saleRate, purchaseRate, reorderLevel];
    if (id) {
      const { changes } = stmt('UPDATE items SET name = ?, unit = ?, hsn = ?, category = ?, brand = ?, gst_rate = ?, sale_rate = ?, purchase_rate = ?, reorder_level = ? WHERE id = ?').run(...values, id);
      if (!changes) throw new BooksError('Item not found');
      return { id };
    }
    return { id: inserted(stmt('INSERT INTO items (name, unit, hsn, category, brand, gst_rate, sale_rate, purchase_rate, reorder_level) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(...values)) };
  }

  function deleteItem({ id }) {
    if (stmt('SELECT 1 FROM stock_moves WHERE item_id = ?1 UNION ALL SELECT 1 FROM order_lines WHERE item_id = ?1 LIMIT 1').get(id)) throw new BooksError('This item has documents. Delete those first.');
    stmt('DELETE FROM items WHERE id = ?').run(id);
    return { id };
  }

  // Batches of an item that still have stock, earliest expiry first.
  // exceptVoucherId leaves out one document's own moves, for altering it.
  function batches({ itemId, exceptVoucherId = null }) {
    const order={expiry:"expiry = '', expiry, batch",oldest:'MIN(v.date), batch',name:'batch, expiry'}[details.settings().batchSort]||"expiry = '', expiry, batch";
    return stmt('SELECT m.batch,m.expiry,SUM(m.qty) AS qty FROM stock_moves m JOIN vouchers v ON v.id=m.voucher_id WHERE m.item_id=? AND m.voucher_id IS NOT ? GROUP BY m.batch,m.expiry HAVING SUM(m.qty)>0 ORDER BY '+order).all(itemId,exceptVoucherId);
  }

  // Saves a sale, purchase, credit note, debit note or stock journal entered item by item.
  function saveInvoice({ id, type, date, partyId, narration = '', items: rows, pricebookId = null, details: extra, gstSupply = 'auto' }) {
    const doc = DOCUMENTS[type];
    if (!doc) throw new BooksError('Unknown document type');
    if (!isDate(date)) throw new BooksError('Date is not valid');
    const withParty = Boolean(doc.ledger || doc.order);
    const party = withParty ? ledgerById(partyId) : null;
    if (withParty && !party) throw new BooksError('Choose the party');
    const partyGroups=['Sundry Debtors','Sundry Creditors','Cash-in-Hand','Bank Accounts'];
    const ledgerGroups=new Map(ledgers().map(row=>[row.id,row.accountGroup]));
    if(withParty&&!partyGroups.includes(ledgerGroups.get(partyId)))throw new BooksError('Choose a customer, supplier, cash or bank ledger as the party');
    if (pricebookId && !stmt('SELECT id FROM pricebooks WHERE id = ?').get(pricebookId)) throw new BooksError('Pricebook not found');
    if (!Array.isArray(rows)) throw new BooksError('Provide the item lines');
    const previous = id ? details.recordDetails({ scope:'document',id }) : {};
    const info = { ...previous, ...(extra || {}) };
    if (info.dueDate && (!isDate(info.dueDate) || info.dueDate < date)) throw new BooksError('Due date must be on or after the document date');
    const charges = info.charges || [];
    if (!Array.isArray(charges) || charges.length > 20) throw new BooksError('Use up to 20 additional charges');
    if(!rows.length&&(!doc.ledger||!charges.length))throw new BooksError('Add at least one item or a ledger amount for a sale or purchase');
    let adjustment = 0;
    for (const charge of charges) {
      const ledger = ledgerById(charge.ledgerId);
      if (!ledger || ledger.id === partyId || ['Bank Accounts','Cash-in-Hand','Sundry Creditors','Sundry Debtors','Duties & Taxes'].includes(ledgerGroups.get(charge.ledgerId))) throw new BooksError('Choose an expense, income or adjustment ledger for each charge');
      if (!Number.isSafeInteger(charge.amount) || !charge.amount) throw new BooksError('Each charge needs a non-zero amount');
      adjustment += charge.amount;
    }
    if (!withParty && charges.length) throw new BooksError('Additional charges are not available on stock journals');

    let taxable = 0;
    let tax = 0;
    const unitLines=[],offerLines=[];
    const config=details.settings(),oldDocument=id?invoice({id}):null;
    const moves = rows.map((row,index) => {
      const item = Number.isInteger(row.itemId) && stmt('SELECT id, name FROM items WHERE id = ?').get(row.itemId);
      if (!item) throw new BooksError('Every line needs an item');
      if (!Number.isSafeInteger(row.qty) || row.qty <= 0) throw new BooksError(`Enter a quantity for ${item.name}`);
      if (!Number.isSafeInteger(row.rate) || row.rate < 0) throw new BooksError(`Enter a rate for ${item.name}`);
      const old=oldDocument?.items[index];
      const unchanged=oldDocument?.type===type&&oldDocument?.date===date&&old&&['itemId','qty','rate','unitId','discountPct','batch','expiry','freeQty'].every(key=>(old[key]||0)===(row[key]||0));
      const paid=catalog.units.convert(item.id,row.unitId||null,row.qty);
      const quote=unchanged?{min:0,max:10000,discountPct:old.discountPct||0,freeQty:old.freeQty||0}:inventory.quote({itemId:item.id,type,date,qty:row.qty,multiplier:paid.multiplier});
      const freeQty=row.freeQty??(unchanged?(old.freeQty||0):quote.freeQty);
      if(!Number.isSafeInteger(freeQty)||freeQty<0)throw new BooksError('Free quantity must be non-negative');
      if(!unchanged&&!['Credit Note','Debit Note'].includes(type)&&freeQty!==quote.freeQty)throw new BooksError('Free quantity must match the active offer ('+quote.freeQty/1000+')');
      if(!unchanged&&!config.freeOffers&&freeQty)throw new BooksError('Enable buy / get offers before entering free quantities');
      if(!unchanged&&!config.batchTracking&&row.batch)throw new BooksError('Enable batch tracking before entering a batch');
      if(!unchanged&&!config.expiryTracking&&row.expiry&&!stmt('SELECT 1 FROM stock_moves WHERE item_id=? AND batch=? AND expiry=? LIMIT 1').get(item.id,row.batch||'',row.expiry))throw new BooksError('Enable expiry tracking before entering expiry dates');
      const converted=catalog.units.convert(item.id,row.unitId||null,row.qty+freeQty);
      if(freeQty)offerLines.push({line:index,itemId:item.id,qty:row.qty,freeQty,rate:row.rate});
      if(!Number.isSafeInteger(Math.round(row.rate/converted.multiplier)))throw new BooksError('Rate per stock unit is outside the supported range');
      if(row.unitId){const chosen=catalog.units.options(item.id).find(unit=>unit.id===row.unitId);if(!chosen)throw new BooksError('Choose a unit related to the item stock unit');
        unitLines.push({line:index,itemId:item.id,unitId:chosen.id,unitSymbol:chosen.symbol,qty:row.qty,rate:row.rate,baseQty:converted.qty});}
      const gstRate = withParty ? row.gstRate ?? 0 : 0;
      if (!Number.isInteger(gstRate) || gstRate < 0 || gstRate > 10000) throw new BooksError(`GST rate for ${item.name} must be between 0 and 100`);
      const expiry = String(row.expiry || '');
      if (expiry && !/^\d{4}-(0[1-9]|1[0-2])$/.test(expiry)) throw new BooksError(`Expiry for ${item.name} must be a month and year`);
      const discountPct = row.discountPct ?? quote.discountPct;
      if(!unchanged&&(discountPct<quote.min||discountPct>quote.max))throw new BooksError('Discount for '+item.name+' must be between '+quote.min/100+'% and '+quote.max/100+'%');
      if (!Number.isInteger(discountPct) || discountPct < 0 || discountPct > 10000) throw new BooksError('Discount must be between 0 and 100 percent');
      const gross = Math.round((row.qty * row.rate) / 1000);
      const amount = gross - Math.round(gross * discountPct / 10000);
      if (!Number.isSafeInteger(gross) || !Number.isSafeInteger(amount)) throw new BooksError('Line amount is too large');
      taxable += amount;
      tax += Math.round((amount * gstRate) / 10000);
      return { itemId: item.id, name: item.name, batch: String(row.batch || '').trim(), expiry, qty: converted.qty, rate: Math.round(row.rate/converted.multiplier), gstRate, amount, discountPct, description: String(row.description || '').slice(0,1000) };
    });
    if (withParty && taxable+adjustment <= 0) throw new BooksError('The total must be more than zero');
    const baseTotal = taxable + tax + adjustment;
    const roundOff = info.roundOff == null ? (details.settings().roundOff && withParty ? Math.round(baseTotal/100)*100-baseTotal : 0) : info.roundOff;
    if (!Number.isSafeInteger(roundOff) || Math.abs(roundOff) > 100) throw new BooksError('Round off must be within one rupee');
    if (!withParty && roundOff) throw new BooksError('Round off is not available on stock journals');
    const total = baseTotal + roundOff;
    if (!Number.isSafeInteger(total) || (withParty && total <= 0)) throw new BooksError('Document total must be positive and within the supported range');
    info.roundOff = roundOff;
    info.unitLines=unitLines;
    info.offerLines=offerLines;
    return tx(() => {
      retail.checkSale({id,type,partyId,total,rows:moves,date});
      const lines = [];
      const home = meta('company_state');
      if(!['auto','interstate','intrastate'].includes(gstSupply))throw new BooksError('Select a valid GST supply type');
      const interstate = gstSupply==='interstate'||gstSupply==='auto'&&Boolean(party && home && party.state)&&!sameText(home,party.state);
      if (doc.ledger) {
        // doc.stock is also the side the goods ledger and tax sit on: a sale (stock out)
        // credits them and debits the party; a purchase (stock in) is the mirror image.
        lines.push({ ledgerId: party.id, amount: -doc.stock * total });
        if(taxable)lines.push({ ledgerId: postingLedger(doc.ledger, doc.group), amount: doc.stock * taxable });
        for (const [head, amount] of Object.entries(splitTax(tax, interstate))) {
          if (amount) lines.push({ ledgerId: postingLedger(`${doc.tax} ${head.toUpperCase()}`, 'Duties & Taxes'), amount: doc.stock * amount });
        }
        for (const charge of charges) lines.push({ ledgerId:charge.ledgerId,amount:doc.stock*charge.amount });
        if (roundOff) lines.push({ ledgerId:postingLedger('Round Off','Indirect Expenses'),amount:doc.stock*roundOff });
      }
      const affected=stockKeys(id);
      const saved = writeVoucher({ id, type: doc.voucher, date, narration, lines });
      details.save('document',saved.id,info);
      if (party) stmt('INSERT INTO invoices (voucher_id, party_id, interstate, pricebook_id) VALUES (?, ?, ?, ?)').run(saved.id, party.id, interstate ? 1 : 0, pricebookId);
      if (doc.order) {
        moves.forEach((move, index) => stmt('INSERT INTO order_lines (voucher_id, line, item_id, qty, rate, gst_rate, amount, discount_pct, description) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
          .run(saved.id, index, move.itemId, move.qty, move.rate, move.gstRate, move.amount, move.discountPct, move.description));
        checkStock(affected);
        return { ...saved, taxable, tax, total };
      }
      moves.forEach((move, index) => {
        stmt('INSERT INTO stock_moves (voucher_id, line, item_id, batch, expiry, qty, rate, gst_rate, amount, discount_pct, description) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
          .run(saved.id, index, move.itemId, move.batch, move.expiry, doc.stock * move.qty, move.rate, move.gstRate, move.amount, move.discountPct, move.description);
        const left = stmt('SELECT COALESCE(SUM(qty), 0) AS n FROM stock_moves WHERE item_id = ? AND batch = ?').get(move.itemId, move.batch).n;
        if (doc.stock < 0 && left < 0) throw new BooksError(`Not enough stock of ${move.name}${move.batch ? ` batch ${move.batch}` : ''}: short by ${-left / 1000}`);
      });
      checkStock(affected);
      return { ...saved, taxable, tax, total };
    });
  }

  function invoice({ id }) {
    const head = stmt(`
      SELECT v.id, v.type, v.number, v.date, v.narration, i.party_id AS partyId, i.pricebook_id AS pricebookId, i.interstate, l.name AS partyName
      FROM vouchers v LEFT JOIN invoices i ON i.voucher_id = v.id LEFT JOIN ledgers l ON l.id = i.party_id WHERE v.id = ?`).get(id);
    const rows = stmt(`
      SELECT m.item_id AS itemId, i.name AS itemName, m.batch, m.expiry, m.qty, m.rate, m.gst_rate AS gstRate, m.line, m.discount_pct AS discountPct, m.description
      FROM stock_moves m JOIN items i ON i.id = m.item_id WHERE m.voucher_id = ?1
      UNION ALL
      SELECT o.item_id, i.name, '', '', o.qty, o.rate, o.gst_rate, o.line, o.discount_pct, o.description
      FROM order_lines o JOIN items i ON i.id = o.item_id WHERE o.voucher_id = ?1
      ORDER BY line`).all(id);
    if (!head || (!rows.length&&!head.partyId)) throw new BooksError('Document not found');
    if (head.type === 'Stock Journal') head.type = rows[0].qty > 0 ? 'Stock In' : 'Stock Out';
    const info=details.recordDetails({scope:'document',id});
    return { ...head, details:info, items: rows.map((row) => {const selected=info.unitLines?.find(unit=>unit.line===row.line&&unit.itemId===row.itemId);const offer=info.offerLines?.find(entry=>entry.line===row.line&&entry.itemId===row.itemId);return {...row,qty:Math.abs(row.qty),...(offer?{qty:offer.qty,freeQty:offer.freeQty,rate:offer.rate,baseQty:Math.abs(row.qty)}:{}),...(selected?{qty:selected.qty,rate:selected.rate,unitId:selected.unitId,unitSymbol:selected.unitSymbol,baseQty:Math.abs(row.qty)}:{})};}) };
  }

  // Stock on hand per item batch as of a date, valued at the item's average cost of
  // purchases and stock brought in by journal.
  function stockSummary({ asOf = today() } = {}) {
    const cost = new Map(stmt(`
      SELECT m.item_id AS id, SUM(m.amount) AS amount, SUM(m.qty) AS qty
      FROM stock_moves m JOIN vouchers v ON v.id = m.voucher_id
      WHERE m.qty > 0 AND v.type IN ('Purchase', 'Stock Journal') AND v.date <= ? GROUP BY m.item_id`).all(asOf).map((row) => [row.id, row]));
    const rows = stmt(`
      SELECT i.id AS itemId, i.name, i.unit, i.category, i.brand, m.batch, m.expiry, SUM(m.qty) AS qty
      FROM stock_moves m JOIN vouchers v ON v.id = m.voucher_id JOIN items i ON i.id = m.item_id
      WHERE v.date <= ? GROUP BY i.id, m.batch, m.expiry HAVING SUM(m.qty) <> 0
      ORDER BY i.name COLLATE NOCASE, m.expiry = '', m.expiry, m.batch`).all(asOf);
    for (const row of rows) {
      const bought = cost.get(row.itemId);
      row.value = bought ? Math.round((row.qty * bought.amount) / bought.qty) : 0;
      row.units=catalog.units.options(row.itemId).map(unit=>({...unit,qty:row.qty/unit.multiplier}));
    }
    return { asOf, rows, value: rows.reduce((total, row) => total + row.value, 0) };
  }

  function stockLedger({ itemId, from=ALL_DATES[0], to=ALL_DATES[1] }) {
    if((from!==ALL_DATES[0]&&!isDate(from))||(to!==ALL_DATES[1]&&!isDate(to))||from>to)throw new BooksError('Choose a valid stock ledger date range');
    const item = stmt('SELECT id, name, unit FROM items WHERE id = ?').get(itemId);
    if (!item) throw new BooksError('Item not found');
    const rows = stmt(`
      SELECT v.id AS voucherId, v.date, v.type, v.number, v.narration, m.line, m.batch, m.expiry, m.qty, m.rate, m.amount, m.description,
        (SELECT l.name FROM invoices i JOIN ledgers l ON l.id = i.party_id WHERE i.voucher_id = v.id) AS party
      FROM stock_moves m JOIN vouchers v ON v.id = m.voucher_id
      WHERE m.item_id = ? AND v.date BETWEEN ? AND ? ORDER BY v.date, v.id, m.line`).all(itemId,from,to);
    const opening=stmt('SELECT COALESCE(SUM(m.qty),0) AS n FROM stock_moves m JOIN vouchers v ON v.id=m.voucher_id WHERE m.item_id=? AND v.date<?').get(itemId,from).n;
    const closing=rows.reduce((total,row)=>total+row.qty,opening);
    const snapshots=new Map();
    for(const row of rows){
      if(!snapshots.has(row.voucherId))snapshots.set(row.voucherId,details.recordDetails({scope:'document',id:row.voucherId}).unitLines||[]);
      const original=snapshots.get(row.voucherId).find(line=>line.line===row.line&&line.itemId===itemId);
      const offer=details.recordDetails({scope:'document',id:row.voucherId}).offerLines?.find(line=>line.line===row.line&&line.itemId===itemId);
      row.freeQty=offer?.freeQty||0;row.enteredQty=original?original.qty+row.freeQty:Math.abs(row.qty);row.enteredUnit=original?.unitSymbol||item.unit;row.enteredRate=original?.rate??row.rate;
    }
    return { item, rows, opening, closing, units:catalog.units.options(itemId) };
  }

  // ---- GST ----

  // One row per party document with its taxable value and tax by head.
  // Credit and debit notes count as negative, so the totals are net of returns.
  function taxRegister({ from = ALL_DATES[0], to = ALL_DATES[1], types }) {
    const rows = stmt(`
      SELECT v.id AS voucherId, v.date, v.type, v.number, l.name AS party, l.gstin, i.interstate,
        (SELECT ABS(SUM(e.amount)) FROM entries e WHERE e.voucher_id=v.id AND e.ledger_id=i.party_id) AS documentTotal,
        COALESCE(SUM(m.amount),0) AS taxable, COALESCE(CAST(SUM(ROUND(m.amount * m.gst_rate / 10000.0)) AS INTEGER),0) AS tax
      FROM vouchers v JOIN invoices i ON i.voucher_id = v.id JOIN ledgers l ON l.id = i.party_id LEFT JOIN stock_moves m ON m.voucher_id = v.id
      WHERE v.date BETWEEN ? AND ? AND v.type IN (${types.map(() => '?').join(', ')})
      GROUP BY v.id, l.id, i.voucher_id ORDER BY v.date, v.id`).all(from, to, ...types);
    const totals = { taxable: 0, cgst: 0, sgst: 0, igst: 0, total: 0 };
    for (const row of rows) {
      const sign = row.type.endsWith('Note') ? -1 : 1;
      const split = splitTax(row.tax, row.interstate);
      Object.assign(row, { taxable: sign * row.taxable, cgst: sign * split.cgst, sgst: sign * split.sgst, igst: sign * split.igst, total: sign * (row.documentTotal ?? row.taxable + row.tax) });
      for (const key of Object.keys(totals)) totals[key] += row[key];
    }
    return { from, to, rows, totals };
  }

  // The figures behind GSTR-1 (outward supplies) and GSTR-3B (tax payable) for a period.
  function gstSummary({ from = financialYearStart(today()), to = today() } = {}) {
    const outward = taxRegister({ from, to, types: ['Sales', 'Credit Note'] });
    const inward = taxRegister({ from, to, types: ['Purchase', 'Debit Note'] });
    const byRate = new Map();
    const byHsn = new Map();
    const add = (map, key, base, line) => {
      if (!map.has(key)) map.set(key, { ...base, qty: 0, taxable: 0, tax: 0 });
      const row = map.get(key);
      row.qty += line.qty;
      row.taxable += line.amount;
      row.tax += line.tax;
    };
    for (const line of stmt(`
      SELECT v.type, l.gstin <> '' AS registered, it.hsn, it.unit, m.gst_rate AS gstRate, ABS(m.qty) AS qty, m.amount,
        CAST(ROUND(m.amount * m.gst_rate / 10000.0) AS INTEGER) AS tax
      FROM stock_moves m JOIN vouchers v ON v.id = m.voucher_id JOIN invoices i ON i.voucher_id = v.id
        JOIN ledgers l ON l.id = i.party_id JOIN items it ON it.id = m.item_id
      WHERE v.date BETWEEN ? AND ? AND v.type IN ('Sales', 'Credit Note')`).all(from, to)) {
      if (line.type === 'Credit Note') Object.assign(line, { qty: -line.qty, amount: -line.amount, tax: -line.tax });
      add(byHsn, `${line.hsn}|${line.gstRate}`, { hsn: line.hsn, unit: line.unit, gstRate: line.gstRate }, line);
      if (!line.registered) add(byRate, line.gstRate, { gstRate: line.gstRate }, line);
    }
    const payable = Object.fromEntries(['cgst', 'sgst', 'igst'].map((head) => [head, outward.totals[head] - inward.totals[head]]));
    return { from, to, outward: outward.totals, inward: inward.totals, payable, b2b: outward.rows.filter((row) => row.gstin), b2c: [...byRate.values()], hsn: [...byHsn.values()] };
  }

  // ---- support for src/sync.js; not reachable from the window ----

  const plainName = (name) => String(name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  // Tally's primary groups that these books fold into a broader one.
  const GROUP_ALIASES = {
    bankodac: 'Loans (Liability)', bankoccac: 'Loans (Liability)', securedloans: 'Loans (Liability)', unsecuredloans: 'Loans (Liability)',
    reservessurplus: 'Capital Account', depositsasset: 'Current Assets', miscexpensesasset: 'Current Assets',
    suspenseac: 'Current Liabilities', branchdivisions: 'Current Assets',
  };
  // The server spells names its own way (upper case, 'CASH IN HAND'), so match loosely.
  function findGroup(name) {
    const all = stmt('SELECT id, name, nature FROM groups').all();
    return all.find((group) => plainName(group.name) === plainName(name)) || all.find((group) => group.name === GROUP_ALIASES[plainName(name)]);
  }
  function findLedger(name) {
    const all = stmt('SELECT l.id, l.name, g.name AS groupName FROM ledgers l JOIN groups g ON g.id = l.group_id ORDER BY l.id').all();
    const found = all.find((ledger) => plainName(ledger.name) === plainName(name));
    // Every cash ledger is one account on the server, sent back as CASH IN HAND.
    return found || (/^cash(inhand|ac|account|book)?$/.test(plainName(name)) ? all.find((ledger) => ledger.groupName === 'Cash-in-Hand') : undefined);
  }
  const findItem = (name) => stmt('SELECT id, name FROM items WHERE name = ?').get(String(name || '').trim());

  const support = {
    atomic:tx,
    getState: (key) => meta(`sync_${key}`),
    setState: (key, value) => setMeta(`sync_${key}`, String(value ?? '')),
    companyName: () => meta('company_name'),
    range: () => stmt('SELECT MIN(date) AS first, MAX(date) AS last FROM vouchers').get(),

    // Groups beyond the standard ones, every ledger and every item.
    masters() {
      return {
        groups: stmt('SELECT g.id, g.name, p.name AS parent FROM groups g JOIN groups p ON p.id = g.parent_id ORDER BY g.id').all().filter(row=>!builtInGroupIds.has(row.id)).map(({name,parent})=>({name,parent})),
        ledgers: stmt('SELECT l.name, g.name AS parent, l.opening, l.gstin, l.state, l.phone, l.credit_days AS creditDays FROM ledgers l JOIN groups g ON g.id = l.group_id ORDER BY l.id').all(),
        items: stmt('SELECT name, unit, hsn, category, gst_rate AS gstRate FROM items ORDER BY id').all(),
      };
    },

    // Every voucher dated in the range, with its entries and item lines by name.
    vouchers({ from, to }) {
      const head = stmt(`
        SELECT v.id, v.uuid, v.rev, v.type, v.number, v.ref, v.date, v.narration,
          (SELECT l.name FROM invoices i JOIN ledgers l ON l.id = i.party_id WHERE i.voucher_id = v.id) AS party
        FROM vouchers v WHERE v.date BETWEEN ? AND ? ORDER BY v.date, v.id`).all(from, to);
      return head.map((row) => ({
        ...row,
        entries: stmt('SELECT l.name AS ledger, e.amount FROM entries e JOIN ledgers l ON l.id = e.ledger_id WHERE e.voucher_id = ? ORDER BY e.line').all(row.id),
        lines: stmt(`
          SELECT i.name AS item, i.unit, m.batch, m.expiry, m.qty, m.rate, m.gst_rate AS gstRate, m.amount, m.line, m.discount_pct AS discountPct
          FROM stock_moves m JOIN items i ON i.id = m.item_id WHERE m.voucher_id = ?1
          UNION ALL
          SELECT i.name, i.unit, '', '', o.qty, o.rate, o.gst_rate, o.amount, o.line, o.discount_pct
          FROM order_lines o JOIN items i ON i.id = o.item_id WHERE o.voucher_id = ?1 ORDER BY line`).all(row.id),
      }));
    },

    dirtyFrom: () => meta('sync_dirty_from'),
    setDirtyFrom: (date) => setMeta('sync_dirty_from', date || ''),

    upsertGroup({ name, parent }) {
      const found = findGroup(name);
      if (found) return found.id;
      const under = findGroup(parent);
      if (!under) throw new BooksError(`Group "${parent}" is not in these books`);
      return inserted(stmt('INSERT INTO groups (name, parent_id, nature) VALUES (?, ?, ?)').run(String(name).trim(), under.id, under.nature));
    },

    // Creates the ledger, or fills in the details the server sent for one that exists.
    upsertLedger({ name, parent, gstin = '', state = '', phone = '', creditDays = 0 }) {
      const found = findLedger(name);
      if (found) {
        stmt(`UPDATE ledgers SET gstin = COALESCE(NULLIF(?, ''), gstin), state = COALESCE(NULLIF(?, ''), state),
          phone = COALESCE(NULLIF(?, ''), phone), credit_days = COALESCE(NULLIF(?, 0), credit_days) WHERE id = ?`).run(gstin, state, phone, creditDays, found.id);
        return found.id;
      }
      const under = findGroup(parent);
      if (!under) throw new BooksError(`Group "${parent}" is not in these books`);
      return inserted(stmt('INSERT INTO ledgers (name, group_id, gstin, state, phone, credit_days) VALUES (?, ?, ?, ?, ?, ?)').run(String(name).trim(), under.id, gstin, state, phone, creditDays));
    },

    setOpening({ name, opening }) {
      const found = findLedger(name);
      if (found) stmt('UPDATE ledgers SET opening = ? WHERE id = ?').run(opening, found.id);
      return Boolean(found);
    },

    upsertItem({ name, unit = 'PCS', hsn = '', category = '', gstRate = 0 }) {
      const found = findItem(name);
      if (found) {
        stmt("UPDATE items SET hsn = COALESCE(NULLIF(?, ''), hsn), gst_rate = COALESCE(NULLIF(?, 0), gst_rate) WHERE id = ?").run(hsn, gstRate, found.id);
        return found.id;
      }
      return inserted(stmt('INSERT INTO items (name, unit, hsn, category, gst_rate) VALUES (?, ?, ?, ?, ?)').run(String(name).trim(), String(unit || 'PCS').toUpperCase(), hsn, category, gstRate));
    },

    // Stores a voucher as the server has it: its entries and item lines are taken as given,
    // not worked out again here. A ledger or item it names that is missing is created.
    importVoucher({ uuid, ref = '', type, date, narration = '', party = '', entries, lines = [] }) {
      if (!VOUCHER_TYPES.includes(type)) throw new BooksError(`Unknown voucher type ${type}`);
      if (!isDate(date)) throw new BooksError('Voucher date is not valid');
      if (entries.reduce((total, entry) => total + entry.amount, 0) !== 0) throw new BooksError('Debit and credit totals differ');
      const ledgerFor = (name) => findLedger(name)?.id ?? support.upsertLedger({ name, parent: 'Current Liabilities' });
      return tx(() => {
        const old = stmt('SELECT id FROM vouchers WHERE uuid = ?').get(uuid);
        const saved = writeVoucher({
          id: old?.id, type, date, narration, uuid, ref, local: false,
          lines: entries.filter((entry) => entry.amount).map((entry) => ({ ledgerId: ledgerFor(entry.ledger), amount: entry.amount })),
        });
        if (party && lines.length) stmt('INSERT INTO invoices (voucher_id, party_id) VALUES (?, ?)').run(saved.id, ledgerFor(party));
        const unitLines=[];
        lines.forEach((line, index) => {
          const itemId = support.upsertItem({ name: line.item, unit: line.unit, gstRate: line.gstRate });
          const options=catalog.units.options(itemId),chosen=line.unit?options.find(unit=>unit.symbol.toLowerCase()===line.unit.toLowerCase()):options.find(unit=>unit.multiplier===1);
          if(!chosen)throw new BooksError(`Unit ${line.unit} is not related to the stock unit for ${line.item}`);
          const converted=catalog.units.convert(itemId,chosen.id,Math.abs(line.qty)),quantity=Math.sign(line.qty)*converted.qty,rate=Math.round(line.rate/converted.multiplier);
          if(!Number.isSafeInteger(rate))throw new BooksError('Imported rate is outside the supported range');
          if(chosen.id)unitLines.push({line:index,itemId,unitId:chosen.id,unitSymbol:chosen.symbol,qty:Math.abs(line.qty),rate:line.rate,baseQty:converted.qty});
          if (DOCUMENTS[type]?.order) {
            stmt('INSERT INTO order_lines (voucher_id, line, item_id, qty, rate, gst_rate, amount) VALUES (?, ?, ?, ?, ?, ?, ?)').run(saved.id, index, itemId, Math.abs(quantity), rate, line.gstRate, line.amount);
          } else {
            stmt('INSERT INTO stock_moves (voucher_id, line, item_id, batch, expiry, qty, rate, gst_rate, amount) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
              .run(saved.id, index, itemId, line.batch || '', '', quantity, rate, line.gstRate, line.amount);
          }
        });
        const info=details.recordDetails({scope:'document',id:saved.id});
        if(unitLines.length||info.unitLines?.length||info.offerLines?.length)stmt("INSERT INTO record_details(scope,record_id,value) VALUES('document',?,?) ON CONFLICT(scope,record_id) DO UPDATE SET value=excluded.value").run(saved.id,JSON.stringify({...info,unitLines,offerLines:[]}));
        references.validate();return saved;
      });
    },

    removeVoucher: ({ uuid }) => tx(() => { const row=stmt('SELECT id,date FROM vouchers WHERE uuid=?').get(uuid);if(row){references.checkDelete(row.id);retail.checkDelete(row.id);retail.checkDates(row.date);details.remove('document',row.id);references.remove(row.id);}return stmt('DELETE FROM vouchers WHERE uuid=?').run(uuid).changes; }),
  };

  return {
    database:db,
    close: () => db.close(),
    backup: destination=>db.dialect==='postgres'?require('./postgres-backup').createBackup(db,destination,MIGRATIONS.length):require('./backup').createBackup(db,destination),
    schemaVersion:MIGRATIONS.length,
    files: { importFile:details.importFile, fileBytes:details.fileBytes },
    support,
    api: {
      company, setCompany, userProfile, saveUserProfile, groups, saveGroup, deleteGroup, ledgers, saveLedger, deleteLedger,
      nextNumber, saveVoucher, voucher, deleteVoucher, dayBook, ledgerStatement,
      statements, cashFlow, ageing, budgets, setBudget, bankBook, setCleared,
      ...require('./report-books')({db,BooksError,isDate,statements,stockSummary}),
      items, saveItem, deleteItem, batches, saveInvoice, invoice, stockSummary, stockLedger,
      taxRegister, gstSummary,
      ...require('./reporting')({db,BooksError,statements,ledgers,groups,company,isDate}),
      ...require('./pricebooks')(db, BooksError),
      ...retail.api,
      ...references.api,
    ...inventory.api,
      ...catalog.api,
      ...require('./cheques')({ db, BooksError, tx, writeVoucher, postingLedger, isDate, today }),
      settings:details.settings, saveSettings:details.saveSettings, customFields:details.fields, saveCustomField:details.saveField,
      deleteCustomField:details.deleteField,
      recordDetails:details.recordDetails, fileInfo:details.fileInfo, discardFiles:details.discardFiles,
      saveItem: args => tx(() => { const mapped=catalog.mapItem(args);const result = saveItem(mapped);catalog.saveLinks(result.id,mapped);details.save('item',result.id,args.details || {});if(args.policy)retail.saveItemPolicy(result.id,args.policy);if(args.pricebookEntry)require('./pricebooks')(db,BooksError).setPricebookEntry({...args.pricebookEntry,itemId:result.id}); return result; }),
      saveLedger: args => tx(() => { const result = saveLedger(args); details.save('ledger',result.id,args.details || {});if(args.policy)retail.saveLedgerPolicy(result.id,args.policy);references.validate(); return result; }),
      saveGroup: args=>tx(()=>{const result=saveGroup(args);references.validate();return result;}),
      saveVoucher: args=>tx(()=>{if(args.billReferences)for(const p of args.billReferences)references.migrate(p.partyId);const result=saveVoucher(args);if(args.billReferences)references.save({voucherId:result.id,parties:args.billReferences});references.validate();return result;}),
      saveInvoice: args=>tx(()=>{if(args.billReferences)for(const p of args.billReferences)references.migrate(p.partyId);const result=saveInvoice(args);if(args.billReferences)references.save({voucherId:result.id,parties:args.billReferences});references.validate();return result;}),
      saveAllocations: args=>tx(()=>{if(references.stored(args.paymentId)[args.partyId]||(args.allocations||[]).some(r=>references.stored(r.billId)[args.partyId]))throw new BooksError('Use Bill references to adjust this reference-managed voucher');const result=retail.api.saveAllocations(args);references.validate();return result;}),
      settleReferences: args=>tx(()=>{const p=ledgers().find(l=>l.id===args.partyId),account=ledgers().find(l=>l.id===args.accountId);if(!p||!['Sundry Debtors','Sundry Creditors'].includes(p.accountGroup)||!account||!['Cash-in-Hand','Bank Accounts'].includes(account.accountGroup))throw new BooksError('Choose a customer/supplier and cash/bank account');const amount=args.rows?.reduce((n,r)=>n+r.amount,0);if(!Number.isSafeInteger(amount)||amount<=0)throw new BooksError('Enter a valid settlement amount');const sign=p.accountGroup==='Sundry Creditors'?1:-1;const result=saveVoucher({type:sign===1?'Payment':'Receipt',date:args.date,narration:args.narration||'Bill settlement',lines:[{ledgerId:p.id,amount:sign*amount},{ledgerId:account.id,amount:-sign*amount}]});references.save({voucherId:result.id,parties:[{partyId:p.id,rows:args.rows}]});return result;}),
      deleteItem: args => tx(() => { const result = deleteItem(args); details.remove('item',args.id);stmt('DELETE FROM meta WHERE key=?').run('inventory_item_'+args.id); return result; }),
      deleteLedger: args => tx(() => { const result = deleteLedger(args); details.remove('ledger',args.id); return result; }),
      deleteVoucher: args => tx(() => { const result = deleteVoucher(args); details.remove('document',args.id);references.remove(args.id);references.validate(); return result; }),
    },
  };
  }catch(error){db.close();throw error;}
}

module.exports = { openBooks, BooksError, VOUCHER_TYPES };
