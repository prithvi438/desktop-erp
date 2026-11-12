import {reportDate} from './ui.js';
import {focusPeriod} from './ui.js';
import {financialStatement} from './financial-reports.js';
import {activePeriod} from './ui.js';
import {accountBooks} from './account-books.js';
import {transactionRegister} from './daybook.js';
import {dateModes} from './date-modes.js';
// Registers and reports. All of them are one kind of screen: a list loaded for a date or period.
import { h, call, createList, money, signed, drcr, plain, parseMoney, showQty, showExpiry, ask, picker, parseDate, showDate, today, toast, confirmBox } from './ui.js';
import { push, chrome } from './router.js';
import { voucherEntry } from './voucher.js';
import { invoiceEntry } from './invoice.js';
import { ledgerForm, groupForm } from './ledgers.js';

// Opens a voucher for altering on the screen it was entered on.
const openVoucher = (id, document) => push(document ? invoiceEntry({ id }) : voucherEntry({ id }));

const fyStart = (date) => {
  const [year, month] = date.split('-').map(Number);
  return `${month >= 4 ? year : year - 1}-04-01`;
};
const keyName = (event) => (event.altKey ? `Alt+${event.code.replace('Key', '')}` : event.key);
const sum = (rows, field = 'amount') => rows.reduce((total, row) => total + (row[field] || 0), 0);

// A list screen. load({ from, to, asOf }) returns its rows.
//   dated: F2 changes the date the report is drawn up to.
//   ranged: Alt+F2 focuses the period; otherwise F2 changes the as-of date.
//   keys: { 'Alt+C': ({ row, reload }) => ... } extra actions. onEnter(row, reload).
function report({ title, columns, load, dated = true, ranged = false, filter = false, latest = false, empty, onEnter, keys = {}, hints = [], notes='',period=null }) {
  let to = period?.to || reportDate();
  let from = period?.from || activePeriod().from;
  let first = true;
  const reload = async () => {
    const business=await call('company');companyHeading.textContent=business.name||'Company';
    list.setRows(await load({ from, to, asOf: to }), first && latest ? 'last' : undefined);
    periodLabel.textContent=!dated&&!ranged?'':ranged?`${showDate(from)} to ${showDate(to)}`:`As of ${showDate(to)}`;
    first = false;
  };
  const list = createList({ columns, filter, empty, onEnter: (row) => (onEnter ? onEnter(row, reload) : row.ledgerId && push(ledgerStatement(row.ledgerId))) });
  const companyHeading=h('strong',{class:'report-company'});
  const periodLabel=h('span',{class:'tip'});
  const heading=h('div',{class:'expanded-report-heading'},companyHeading,h('h2',{},typeof title==='function'?title():title),periodLabel);
  list.el.classList.add('expanded-report');
  const fromInput=h('input', { 'data-date':true, value:showDate(from),'aria-label':'From date'}),toInput=h('input', { 'data-date':true, value:showDate(to),'aria-label':'To date'});
  async function applyPeriod(){const start=parseDate(fromInput.value),end=parseDate(toInput.value);if(!start||!end||start>end)return toast('Enter valid dates, with From on or before To.','error');from=start;to=end;await reload();chrome();list.focus();}
  if(ranged)list.el.prepend(h('div',{class:'daybook-filters'},dateModes(fromInput,toInput,applyPeriod,{all:false}),h('label',{},'From ',fromInput),h('label',{},'To ',toInput),h('button',{onclick:applyPeriod},'Apply')));
  if(notes)list.el.prepend(h('p',{class:'report-warning'},notes));
  list.el.prepend(heading);
  list.setExportContext(()=>({title:typeof title==='function'?title():title,subtitle:periodLabel.textContent,units:'Amounts in INR; quantities and ratios as labelled',notes}));

  async function changeDate(start) {
    const answer = await ask(`${start ? 'From' : ranged ? 'To' : 'As of'} date (dd-mm-yyyy)`, showDate(start ? from : to));
    if (answer === null) return;
    const date = parseDate(answer);
    if (!date) return toast('Date is not valid. Use dd-mm-yyyy.', 'error');
    if (start) from = date;
    else to = date;
    if (!ranged || from > to) from = fyStart(to);
    fromInput.value=showDate(from);toInput.value=showDate(to);
    await reload();
    chrome();
  }

  return {
    get title() {
      const name = typeof title === 'function' ? title() : title;
      return !dated ? name : ranged ? `${name}: ${showDate(from)} to ${showDate(to)}` : `${name} as of ${showDate(to)}`;
    },
    hints: [...hints, ...(dated ? [['F2', ranged ? 'To date' : 'Date']] : []), ...(ranged ? [['Alt+F2', 'Period']] : []), ['Alt+E','Excel / PDF'], ['Esc', 'Back']],
    el: list.el,
    async onShow() {
      await reload();
      list.focus();
      chrome();
    },
    onKey(event) {
      if(event.altKey&&event.code==='KeyE')return list.onKey(event);
      if(ranged&&event.altKey&&event.key==='F2'){event.preventDefault();focusPeriod(fromInput);return true;}
      if(ranged&&[fromInput,toInput].includes(event.target)){if(event.key==='Enter'){event.preventDefault();if(event.target===fromInput){toInput.focus();toInput.select();}else applyPeriod();return true;}return false;}
      const action = keys[keyName(event)];
      if (action) action({ row: list.current(), reload });
      else if (dated && event.key === 'F2') changeDate(false);
      else return list.onKey(event);
      event.preventDefault();
      return true;
    },
  };
}

const OPEN_LEDGER = [['Enter', 'Ledger statement']];
const text = (label, field, cls) => ({ label, cls, get: (row) => row[field] });
// A zero is left blank on detail lines and printed on headings and totals.
const amount = (label, field = 'amount') => ({
  label,
  cls: 'num',format:'money',exportGet:row=>row[field]==null?'':row[field]/100,
  get: (row) => (row[field] == null || (row[field] === 0 && !/head|total/.test(row.kind || '')) ? '' : signed(row[field])),
});
const nameColumn = text('Particulars', 'name');

// ---- financial statements ----

const line = (kind, name, value) => ({ kind, name, amount: value });

// Gross profit: sales and direct income plus stock left, less opening stock, purchases and direct costs.
function trading(s) {
  const of = (primary) => s.byPrimary[primary] || 0;
  const revenue = -of('Sales Accounts') - of('Direct Incomes') + s.closingStock;
  const costs = s.openingStock + of('Purchase Accounts') + of('Direct Expenses');
  return { of, sales: -of('Sales Accounts'), revenue, costs, gross: revenue - costs };
}

function ratioRows(s) {
  const t = trading(s);
  const currentAssets = t.of('Current Assets') + s.closingStock;
  const currentLiabilities = -t.of('Current Liabilities');
  const ownFunds = -t.of('Capital Account') + s.broughtForward + s.netProfit;
  const times = (a, b) => (b ? (a / b).toFixed(2) : 'n/a');
  const percent = (a, b) => (b ? `${((a / b) * 100).toFixed(1)}%` : 'n/a');
  return [
    ['Working capital', signed(currentAssets - currentLiabilities), 'Current assets less current liabilities'],
    ['Current ratio', times(currentAssets, currentLiabilities), 'Current assets for each rupee of current liabilities'],
    ['Quick ratio', times(currentAssets - s.closingStock, currentLiabilities), 'The same, leaving out stock'],
    ['Gross profit margin', percent(t.gross, t.sales), 'Gross profit as a share of sales'],
    ['Net profit margin', percent(s.netProfit, t.sales), 'Net profit as a share of sales'],
    ['Debt to equity', times(-t.of('Loans (Liability)'), ownFunds), 'Loans for each rupee of own funds'],
    ['Return on capital', percent(s.netProfit, ownFunds), 'Net profit as a share of own funds'],
  ].map(([name, value, note]) => ({ name, value, note }));
}

const statement = (title, build, columns = [nameColumn, amount('Amount')]) => () => report({
  title, columns, hints: OPEN_LEDGER, load: async ({ asOf }) => build(await call('statements', { asOf })),
});

export const trialBalance = ()=>financialStatement('trialBalance');
export const tradingAccount = ()=>financialStatement('trading');
export const profitLoss = ()=>financialStatement('profitLoss');
export const balanceSheet = ()=>financialStatement('balanceSheet');
export const ratios = statement('Ratios', ratioRows, [text('Ratio', 'name'), text('Value', 'value', 'num'), text('What it shows', 'note')]);

export const cashFlowSummary = () => report({
  title: 'Cash flow by activity',
  notes:'Book-derived cash movement summary. Review classifications and non-cash adjustments before using it as an AS 3 / Ind AS 7 cash-flow statement.',
  ranged: true,
  columns: [nameColumn, amount('Amount')],
  async load({ from, to }) {
    const flow = await call('cashFlow', { from, to }),groups=await call('groups');
    const tree=new Map(groups.map(g=>[g.id,g]));const root=name=>{let g=groups.find(g=>g.name===name);while(g?.parentId)g=tree.get(g.parentId);return g?.name;};
    const category=row=>['Fixed Assets','Investments'].includes(root(row.name))?'Investing':['Capital Account','Loans (Liability)'].includes(root(row.name))?'Financing':'Operating';
    const sections=['Operating','Investing','Financing'].flatMap(name=>{const rows=flow.rows.filter(row=>category(row)===name);return [line('section',name+' activities'),...rows.map(row=>line('sub',row.name,row.amount)),line('total','Net cash from / (used in) '+name.toLowerCase()+' activities',sum(rows))];});
    return [
      line('head', 'Opening cash and bank', flow.opening),
      ...sections,
      line('total', 'Net movement', flow.closing - flow.opening),
      line('total', 'Closing cash and bank', flow.closing),
    ];
  },
});

export const cashFlow = () => report({
 title:'Cash flow',ranged:true,hints:[['Enter','Month vouchers']],
 notes:'Cash and bank movements, netted within each voucher. Transfers between cash and bank accounts are excluded. This is a cash book summary, not a statutory AS 3 / Ind AS 7 statement.',
 columns:[text('Month','name'),amount('Opening','opening'),amount('Inflow','inflow'),amount('Outflow','outflow'),amount('Net flow','net'),amount('Closing','closing')],
 async load(period){const data=await call('cashMovement',period);return [...data.rows,{kind:'total',name:'Period total',opening:data.opening,inflow:sum(data.rows,'inflow'),outflow:sum(data.rows,'outflow'),net:data.closing-data.opening,closing:data.closing}];},
 onEnter:row=>row.from&&push(cashMonth(row)),
});
const cashMonth=period=>report({title:`Cash flow: ${period.name}`,ranged:true,period,hints:[['Enter','Open voucher']],
 columns:[{label:'Date',get:r=>r.date?showDate(r.date):''},text('Type','type'),text('Number','number'),text('Narration','narration'),amount('Inflow','inflow'),amount('Outflow','outflow')],
 async load(p){return (await call('cashMovement',p)).entries.map(r=>({...r,inflow:Math.max(0,r.amount),outflow:Math.max(0,-r.amount)}));},onEnter:r=>r.voucherId&&openVoucher(r.voucherId,r.document)});

export const fundsFlow=()=>report({title:'Funds flow',ranged:true,hints:[['Enter','Working capital changes']],
 notes:'Monthly movement of working capital (current assets less current liabilities), using account groups and inventory cost. Review group classification and non-cash transactions before preparing a full sources and applications statement.',
 columns:[text('Month','name'),amount('Opening working capital','opening'),amount('Increase','increase'),amount('Decrease','decrease'),amount('Closing working capital','closing')],
 async load(p){const {rows}=await call('fundsFlow',p);return [...rows,{kind:'total',name:'Period total',opening:rows[0]?.opening,closing:rows.at(-1)?.closing,increase:sum(rows,'increase'),decrease:sum(rows,'decrease')}];},
 onEnter:r=>r.from&&push(fundsSources(r)),
});
const fundsSources=period=>report({title:'Funds flow: sources and applications',ranged:true,period,hints:OPEN_LEDGER,
 notes:'Net balance movements in non-current accounts and retained profit. Includes non-cash changes; review these before using as a formal funds-flow statement. Differences caused by incomplete opening balances are not concealed.',
 columns:[nameColumn,amount('Sources','source'),amount('Applications','application')],async load(p){const rows=await call('fundsSources',p);return [...rows,{kind:'total',name:'Total',source:sum(rows,'source'),application:sum(rows,'application')}];},
});
export const workingCapitalChanges=(period=null)=>report({title:'Changes in working capital',ranged:true,period,hints:OPEN_LEDGER,
 notes:'Signed balances: assets are positive; liabilities are negative. Increase/decrease columns show the effect on working capital.',
 columns:[nameColumn,text('Classification','group'),amount('Opening','opening'),amount('Closing','closing'),amount('Increase','increase'),amount('Decrease','decrease')],
 async load(p){const rows=await call('workingCapitalSchedule',p);return [...rows,{kind:'total',name:'Working capital',opening:sum(rows,'opening'),closing:sum(rows,'closing'),increase:sum(rows,'increase'),decrease:sum(rows,'decrease')}];},
});

export const cashBankBook=()=>report({title:'Cash / bank book',filter:true,hints:OPEN_LEDGER,
 columns:[nameColumn,text('Group','groupName'),amount('Balance (Dr positive)','balance')],
 async load({asOf}){const [s,groups]=await Promise.all([call('statements',{asOf}),call('groups')]);const tree=new Map(groups.map(g=>[g.id,g]));return s.ledgers.filter(l=>{let g=tree.get(l.groupId);while(g){if(['Cash-in-Hand','Bank Accounts'].includes(g.name))return true;g=tree.get(g.parentId);}return false;});},
});
export const groupSummary=()=>report({title:'Group summary',filter:true,hints:[['Enter','Group ledgers']],
 columns:[nameColumn,amount('Debit','debit'),amount('Credit','credit')],
 async load({asOf}){const rows=new Map();for(const l of (await call('statements',{asOf})).ledgers){const r=rows.get(l.groupId)||{groupId:l.groupId,name:l.groupName,debit:0,credit:0,asOf};r.debit+=Math.max(0,l.balance);r.credit+=Math.max(0,-l.balance);rows.set(l.groupId,r);}return [...rows.values()];},
 onEnter:r=>push(report({title:r.name,period:{to:r.asOf},filter:true,hints:OPEN_LEDGER,columns:[nameColumn,amount('Debit','debit'),amount('Credit','credit')],async load({asOf}){return (await call('statements',{asOf})).ledgers.filter(l=>l.groupId===r.groupId).map(l=>({...l,debit:Math.max(0,l.balance),credit:Math.max(0,-l.balance)}));}})),
});

// ---- parties ----

const ageingReport = (title, group) => () => report({
  title,
  hints: OPEN_LEDGER,
  empty: 'Nothing outstanding.',
  columns: [text('Party', 'name'), text('Phone', 'phone'), amount('Outstanding', 'total'), amount('Not due / unaged', 'current'), amount('1-30 overdue', 'days30'), amount('31-60 overdue', 'days60'), amount('Over 60 overdue', 'days90'), amount('Credits / advance', 'advance')],
  async load({ asOf }) {
    const parties=(await call('ledgers')).filter(p=>p.accountGroup===group),rows=[];
    for(const p of parties){const result=await call('referenceOutstanding',{partyId:p.id,asOf});if(!result.due&&!result.credit)continue;const row={ledgerId:p.id,name:p.name,phone:p.phone,total:result.due,advance:result.credit,current:0,days30:0,days60:0,days90:0};for(const r of result.rows.filter(r=>r.signed>0&&r.remaining>0))row[r.overdue===0?'current':r.overdue<=30?'days30':r.overdue<=60?'days60':'days90']+=r.remaining;rows.push(row);}
    if (!rows.length) return [];
    const total = { kind: 'total', name: 'Total' };
    for (const field of ['total', 'current', 'days30', 'days60', 'days90', 'advance']) total[field] = sum(rows, field);
    return [...rows.map((row) => ({ ...row, advance: row.advance || null })), total];
  },
});
export const debtors = ageingReport('Debtors: bills receivable by age', 'Sundry Debtors');
export const creditors = ageingReport('Creditors: bills payable by age', 'Sundry Creditors');

export function ledgerStatement(ledgerId) { return accountBooks({mode:'accounts',selectedId:ledgerId,dedicated:true}); }

// Asks for a ledger (of one group, or any), then shows its statement.
export async function chooseStatement(groups = null) {
  const all = groups ? (await Promise.all(groups.map((group) => call('ledgers', { group })))).flat() : await call('ledgers');
  const choice = await picker('Ledger statement', all.map((row) => ({ id: row.id, label: row.name, hint: row.groupName })));
  if (choice) push(ledgerStatement(choice.id));
}

// The statement of a ledger the books keep for one purpose (bad debts, suspense),
// created the first time it is opened.
export const purposeLedger = (name, group) => async () => {
  let found = (await call('ledgers')).find((row) => row.name.toLowerCase() === name.toLowerCase());
  if (!found) found = await call('saveLedger', { name, groupId: (await call('groups')).find((row) => row.name === group).id });
  push(ledgerStatement(found.id));
};

// Budget for the year against the year so far. Enter sets the selected ledger's budget.
export const budgets = () => report({
  title: 'Budgets',
  hints: [['Enter', 'Set budget']],
  columns: [text('Ledger', 'name'), text('Under', 'groupName'), amount('Budget', 'budget'), amount('Actual', 'actual'), amount('Left', 'left'), text('Used', 'used', 'num')],
  async onEnter(row, reload) {
    const answer = await ask(`Budget for ${row.name} this year (0 removes it)`, row.budget ? plain(row.budget) : '');
    if (answer === null) return;
    const value = answer.trim() ? parseMoney(answer) : 0;
    if (value === null) return toast('That is not a valid amount', 'error');
    await call('setBudget', { ledgerId: row.ledgerId, amount: value });
    await reload();
  },
  load: async ({ asOf }) => (await call('budgets', { asOf })).map((row) => ({
    ...row,
    budget: row.budget || null,
    left: row.budget ? row.budget - row.actual : null,
    used: row.budget ? `${Math.round((row.actual / row.budget) * 100)}%` : '',
    kind: row.budget && row.actual > row.budget ? 'bad' : '',
  })),
});

// One line per financial year. Profit is carried forward on its own, so no year needs closing.
export const financialYears = () => report({
  title: 'Financial years',
  dated: false,
  columns: [text('Year', 'name'), amount('Income', 'income'), amount('Expenses', 'expense'), amount('Net profit', 'net')],
  async load() {
    const first = (await call('dayBook', {}))[0]?.date ?? today();
    const rows = [];
    for (let year = Number(fyStart(first).slice(0, 4)); year <= Number(fyStart(today()).slice(0, 4)); year++) {
      const end = `${year + 1}-03-31`;
      const s = await call('statements', { asOf: end > today() ? today() : end });
      rows.push({ kind: 'head', name: `${year}-${String(year + 1).slice(2)}${end > today() ? ' (current)' : ''}`, income: s.income, expense: s.expense, net: s.netProfit });
    }
    return rows;
  },
});

// ---- registers ----

// Vouchers of some types, newest selected. create: the screen Alt+C opens for a new one.
export const register = options => () => transactionRegister({...options,allDates:true});
export { dayBook } from './daybook.js';

// ---- stock ----

const qty = (label, field = 'qty') => ({ label, cls: 'num', get: (row) => (row[field] == null ? '' : `${showQty(row[field])} ${row.unit || ''}`) });
const thisMonth = () => today().slice(0, 7);
function expiryState(expiry,days=90,asOf=today()) {
  if (!expiry) return null;
  const soon=new Date(Date.parse(asOf+'T00:00:00Z')+days*86400000).toISOString().slice(0,7);
  return expiry < asOf.slice(0,7) ? ['bad', 'Expired'] : expiry <= soon ? ['warn', 'Expires soon'] : null;
}

export const stockSummary = () => report({
  title: 'Stock on hand',
  hints: [['Enter','Stock ledger']],
  onEnter:r=>r.itemId&&push(accountBooks({mode:'stock',selectedId:r.itemId,dedicated:true})),
  empty: 'No stock yet. Enter a purchase bill, or bring opening stock in with a stock journal.',
  columns: [text('Item', 'name'), text('Category', 'category'), text('Batch', 'batch'), { label: 'Expiry', get: (row) => showExpiry(row.expiry) },{label:'Stock / equivalent units',get:row=>row.units?row.units.map(unit=>`${showQty(unit.qty)} ${unit.symbol}`).join(' = '):''}, amount('Value at cost', 'value')],
  async load({ asOf }) {
    const stock = await call('stockSummary', { asOf });
    return stock.rows.length ? [...stock.rows, { kind: 'total', name: 'Total stock value', value: stock.value }] : [];
  },
});

export const batchExpiry = () => report({
  title: 'Batches & expiry',
  empty: 'No batches with an expiry in stock.',
  columns: [{ label: 'Expiry', get: (row) => showExpiry(row.expiry) }, text('Item', 'name'), text('Batch', 'batch'), qty('Qty'), text('Status', 'status')],
  async load({asOf}) {
    const { rows } = await call('stockSummary', {asOf}),settings=await call('settings');
    return rows.filter((row) => row.expiry).sort((a, b) => a.expiry.localeCompare(b.expiry))
      .map((row) => ({ ...row, kind: expiryState(row.expiry,settings.nearExpiryDays,asOf)?.[0], status: expiryState(row.expiry,settings.nearExpiryDays,asOf)?.[1] ?? 'In date' }));
  },
});

export const stockAlerts = () => report({
  title: 'Stock alerts',
  empty: 'Nothing needs attention: no item is below its reorder level and no batch is near expiry.',
  columns: [text('Item', 'name'), text('Alert', 'status'), text('Detail', 'detail')],
  async load({asOf}) {
    const [items, stock,settings] = await Promise.all([call('items'), call('stockSummary', {asOf}),call('settings')]);
    for(const item of items)item.stock=stock.rows.filter(r=>r.itemId===item.id).reduce((n,r)=>n+r.qty,0);
    const low = items.filter((item) => item.reorderLevel > 0 && item.stock <= item.reorderLevel)
      .map((item) => ({ kind: 'warn', name: item.name, status: 'Low stock', detail: `${showQty(item.stock)} ${item.unit} left, reorder at ${showQty(item.reorderLevel)}` }));
    const ageing = stock.rows.filter((row) => expiryState(row.expiry,settings.nearExpiryDays,asOf))
      .map((row) => ({ kind: expiryState(row.expiry,settings.nearExpiryDays,asOf)[0], name: row.name, status: expiryState(row.expiry,settings.nearExpiryDays,asOf)[1], detail: `Batch ${row.batch || '(none)'}, ${showQty(row.qty)} ${row.unit}, expiry ${showExpiry(row.expiry)}` }));
    return [...low, ...ageing];
  },
});

export function stockLedger() { return accountBooks({mode:'stock',pickerOnly:true}); }

export const movementAnalysis=()=>report({title:'Stock movement analysis',ranged:true,filter:true,hints:[['Enter','Stock ledger']],
 columns:[nameColumn,text('Category','category'),qty('Opening','opening'),qty('Inward','inward'),qty('Outward','outward'),qty('Closing','closing')],
 load:p=>call('inventoryMovement',p),onEnter:r=>push(accountBooks({mode:'stock',selectedId:r.itemId,dedicated:true})),
});
export const categorySummary=()=>report({title:'Stock category summary',filter:true,
 columns:[nameColumn,text('Items','count','num'),amount('Value at cost','value')],load:p=>call('inventoryCategory',p),
});
export const stockAgeing=()=>report({title:'Stock ageing analysis',filter:true,hints:[['Enter','Stock ledger']],
 notes:'Receipt-age estimate using FIFO within each item, batch and expiry. Returns start a new receipt age; this does not change stock valuation. Negative stock is shown separately.',
 columns:[nameColumn,text('Batch','batch'),qty('0–30 days','days30'),qty('31–60','days60'),qty('61–90','days90'),qty('Over 90','older'),qty('Negative','negative'),qty('Total','qty')],load:p=>call('stockAgeing',p),onEnter:r=>push(accountBooks({mode:'stock',selectedId:r.itemId,dedicated:true})),
});
export async function stockMonthly(){const items=await call('items'),choice=await picker('Stock item monthly summary',items.map(i=>({id:i.id,label:i.name,hint:i.unit})));if(!choice)return;const item=items.find(i=>i.id===choice.id);return report({title:`Stock item monthly summary: ${item.name}`,ranged:true,hints:[['Enter','Month stock entries']],onEnter:r=>push(accountBooks({mode:'stock',selectedId:item.id,period:r})),
 columns:[text('Month','month'),qty('Opening','opening'),qty('Inward','inward'),qty('Outward','outward'),qty('Closing','closing')],async load(p){return (await call('stockMonthly',{...p,itemId:item.id})).map(r=>({...r,month:new Date(r.from+'T00:00:00Z').toLocaleDateString('en-IN',{month:'long',year:'numeric',timeZone:'UTC'})}));},
});}

// Items counted by something they share: category, brand, unit, or HSN and tax rate.
export const itemGroups = (title, heads, pick) => () => report({
  title,
  dated: false,
  empty: 'No items yet.',
  columns: [...heads.map((label, at) => ({ label, get: (row) => row.cells[at] || '(not set)' })), text('Items', 'count', 'num')],
  async load() {
    const found = new Map();
    for (const item of await call('items')) {
      const cells = pick(item);
      const row = found.get(cells.join('|')) || { cells, count: 0 };
      row.count += 1;
      found.set(cells.join('|'), row);
    }
    return [...found.values()].sort((a, b) => a.cells.join('|').localeCompare(b.cells.join('|')));
  },
});
export const taxRates = itemGroups('Taxes & HSN', ['HSN code', 'GST %'], (item) => [item.hsn, plain(item.gstRate)]);

// ---- GST ----

const TAX_COLUMNS = [amount('Taxable', 'taxable'), amount('CGST', 'cgst'), amount('SGST', 'sgst'), amount('IGST', 'igst')];

export const taxRegister = (title, types) => () => report({
  title,
  ranged: true,
  hints: [['Enter', 'Open document']],
  empty: 'No documents in this period.',
  columns: [{ label: 'Date', get: (row) => (row.date ? showDate(row.date) : '') }, text('Type', 'type'), text('No.', 'number', 'num'), text('Party', 'party'), text('GSTIN', 'gstin'), ...TAX_COLUMNS, amount('Total', 'total')],
  onEnter: (row) => row.voucherId && openVoucher(row.voucherId, true),
  async load({ from, to }) {
    const { rows, totals } = await call('taxRegister', { from, to, types });
    return rows.length ? [...rows, { kind: 'total', party: 'Total', ...totals }] : [];
  },
});

export const gstReturns = () => report({
  title: 'GST returns',
  ranged: true,
  columns: [nameColumn, ...TAX_COLUMNS, amount('Total tax', 'tax')],
  async load({ from, to }) {
    const gst = await call('gstSummary', { from, to });
    const heads = (kind, name, row) => ({ kind, name, taxable: row.taxable, cgst: row.cgst, sgst: row.sgst, igst: row.igst, tax: row.cgst + row.sgst + row.igst });
    const rated = (name, row) => ({ kind: 'sub', name, taxable: row.taxable, tax: row.tax });
    return [
      line('section', 'GSTR-3B: tax for the period'),
      heads('sub', 'Outward supplies (sales less returns)', gst.outward),
      heads('sub', 'Input tax credit (purchases less returns)', gst.inward),
      heads('total', 'Net tax payable', gst.payable),
      line('section', 'GSTR-1: invoices to registered parties (B2B)'),
      ...gst.b2b.map((row) => heads('sub', `${showDate(row.date)}  ${row.type} ${row.number}  ${row.party}  ${row.gstin}`, row)),
      line('section', 'GSTR-1: sales to unregistered parties (B2C) by rate'),
      ...gst.b2c.map((row) => rated(`GST ${plain(row.gstRate)}%`, row)),
      line('section', 'GSTR-1: HSN summary'),
      ...gst.hsn.map((row) => rated(`HSN ${row.hsn || '(not set)'} at ${plain(row.gstRate)}%: ${showQty(row.qty)} ${row.unit}`, row)),
    ];
  },
});

// ---- banking ----

export async function bankReconciliation() {
  const banks = await call('ledgers', { group: 'Bank Accounts' });
  if (!banks.length) return toast('Create a ledger under Bank Accounts first', 'error');
  const choice = await picker('Reconcile which bank account?', banks.map((row) => ({ id: row.id, label: row.name, hint: drcr(row.balance) })));
  if (!choice) return;
  const mark = (row, date) => call('setCleared', { voucherId: row.voucherId, ledgerId: choice.id, date });
  push(report({
    title: `Bank reconciliation: ${choice.label}`,
    dated: false,
    ranged: true,
    latest: true,
    hints: [['Enter', 'Cleared / not cleared'], ['F2', 'Cleared on a date']],
    columns: [
      { label: 'Date', get: (row) => (row.date ? showDate(row.date) : '') }, text('Particulars', 'particulars'), text('Type', 'type'), text('No.', 'number', 'num'),
      { label: 'Deposit', cls: 'num', get: (row) => (row.amount > 0 ? money(row.amount) : '') },
      { label: 'Withdrawal', cls: 'num', get: (row) => (row.amount < 0 ? money(row.amount) : '') },
      { label: 'Cleared on', get: (row) => (row.cleared ? showDate(row.cleared) : '') },
    ],
    async onEnter(row, reload) {
      if (!row.voucherId) return;
      await mark(row, row.cleared ? null : row.date);
      await reload();
    },
    keys: {
      async F2({ row, reload }) {
        if (!row?.voucherId) return;
        const answer = await ask('Cleared the bank on (dd-mm-yyyy)', showDate(row.cleared || row.date));
        const date = answer && parseDate(answer);
        if (answer && !date) return toast('Date is not valid. Use dd-mm-yyyy.', 'error');
        if (date) await mark(row, date);
        await reload();
      },
    },
    async load({from,to}) {
      const book = await call('bankBook', { ledgerId: choice.id,from,to });
      const summary = (particulars, value) => ({ kind: 'total', particulars, amount: value });
      return [...book.rows, summary('As of period end: balance as per books', book.books), summary('As of period end: not yet cleared by the bank', book.uncleared), summary('As of period end: balance as per bank', book.bank)];
    },
  }));
}

// ---- chart of accounts ----

export const chartOfAccounts = () => report({
  title: 'Chart of accounts',
  dated: false,
  filter: true,
  hints: [['Enter', 'Open'], ['Alt+C', 'New ledger'], ['Alt+G', 'New group'], ['Alt+A', 'Alter ledger']],
  columns: [text('Account', 'name'), { label: 'Balance', cls: 'num', get: (row) => drcr(row.balance) }],
  onEnter: (row) => push(row.ledger ? ledgerStatement(row.ledger.id) : groupForm(row.group)),
  keys: {
    'Alt+C': ({ row }) => push(ledgerForm(null, row?.group?.name ?? row?.ledger?.groupName ?? null)),
    'Alt+G': () => push(groupForm()),
    'Alt+A': ({ row }) => row?.ledger && push(ledgerForm(row.ledger)),
  },
  async load() {
    const [groups, ledgers] = await Promise.all([call('groups'), call('ledgers')]);
    groups.sort((a, b) => a.id - b.id);
    const rows = [];
    const walk = (parentId, depth) => {
      for (const group of groups.filter((row) => row.parentId === parentId)) {
        const head = { kind: `head lv${depth}`, group, name: group.name };
        const at = rows.push(head);
        for (const ledger of ledgers.filter((row) => row.groupId === group.id)) rows.push({ kind: `lv${depth + 1}`, ledger, name: ledger.name, balance: ledger.balance });
        walk(group.id, depth + 1);
        head.balance = rows.slice(at).reduce((total, row) => total + (row.ledger ? row.balance : 0), 0);
      }
    };
    walk(null, 0);
    return rows;
  },
});
