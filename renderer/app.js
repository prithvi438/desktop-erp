import './calculator.js';
import {userProfileForm,greetingText} from './user-profile.js';
import {dashboardCharts} from './dashboard-charts.js';
import {outstandingManagement} from './outstandings.js';
import {reportDate} from './ui.js';
import {reportingSettings} from './financial-reports.js';
import {companies,financialYears as companyYears} from './companies.js';
import {inventorySettings,inventoryRuleList} from './inventory-settings.js';
// The shell: sidebar menu, dashboard (home), command palette and global keys.
import { h, call, mod, money, signed, showDate, today, toast, confirmBox, picker, formKeys, labelled, activePeriod } from './ui.js';
import { push, pop, top, atHome, goHome, chrome } from './router.js';
import { ledgerList } from './ledgers.js';
import { itemList } from './items.js';
import * as reports from './reports.js';
import { pricebookList } from './pricebooks.js';
import { chequeRegister } from './cheques.js';
import { createVouchers, DASHBOARD_VOUCHERS } from './create.js';
import { formSettings,customFieldList } from './settings.js';
import { browseWorkspace } from './browse.js';
import { manageRecords, mastersWorkspace as createMasters } from './manage.js';
import { retailControls,backupScreen,outstandingScreen,purchasePlanning,salesAnalysis } from './retail.js';
import {registersWorkspace,REGISTER_TYPES} from './registers.js';
import {reportDirectory} from './report-directory.js';

const { register, itemGroups } = reports;
const doc = (type) => () => createVouchers(type);
const voucher = (type) => () => createVouchers(type);
const parties = (title, group) => () => ledgerList({ title, group });

// [section, [[label, open], ...]]. `open` returns a screen, or shows one itself after asking a question.
const CATALOG = [
  ['Create', [
    ['Masters', createMasters],
    ['Create Vouchers', () => createVouchers()],
  ]],
  ['Sales', [
    ['Invoices', register({ title: 'Invoices', types: ['Sales'], create: doc('Sales') })],
    ['Customers', parties('Customers', 'Sundry Debtors')],
    ['Quotations', register({ title: 'Quotations', types: ['Quotation'], create: doc('Quotation') })],
    ['Sales orders', register({ title: 'Sales orders', types: ['Sales Order'], create: doc('Sales Order') })],
    ['Payments received', register({ title: 'Payments received', types: ['Receipt'], create: voucher('Receipt') })],
    ['Credit notes & sales returns', register({ title: 'Credit notes & sales returns', types: ['Credit Note'], create: doc('Credit Note') })],
  ]],
  ['Purchases', [
    ['Bills', register({ title: 'Bills', types: ['Purchase'], create: doc('Purchase') })],
    ['Suppliers', parties('Suppliers', 'Sundry Creditors')],
    ['Purchase orders', register({ title: 'Purchase orders', types: ['Purchase Order'], create: doc('Purchase Order') })],
    ['Payments made', register({ title: 'Payments made', types: ['Payment'], touches: 'Sundry Creditors', create: voucher('Payment') })],
    ['Expenses', register({ title: 'Expenses', types: ['Payment', 'Journal'], touches: 'expense', create: voucher('Payment') })],
    ['Debit notes & purchase returns', register({ title: 'Debit notes & purchase returns', types: ['Debit Note'], create: doc('Debit Note') })],
  ]],
  ['Items & stock', [
    ['Items', itemList],
    ['Categories', itemGroups('Categories', ['Category'], (item) => [item.category])],
    ['Manufacturers / brands', itemGroups('Manufacturers / brands', ['Brand'], (item) => [item.brand])],
    ['Units of measure', itemGroups('Units of measure', ['Unit'], (item) => [item.unit])],
    ['Taxes & HSN', reports.taxRates],
    ['Stock on hand', reports.stockSummary],
    ['Stock ledger', reports.stockLedger],
    ['Stock journals', register({ title: 'Stock journals', types: ['Stock Journal'], create: doc('Stock In') })],
    ['Batches & expiry', reports.batchExpiry],
    ['Stock alerts', reports.stockAlerts],
  ]],
  ['Banking', [
    ['Cheques', chequeRegister],
    ['Bank accounts', parties('Bank accounts', 'Bank Accounts')],
    ['Cash accounts', parties('Cash accounts', 'Cash-in-Hand')],
    ['Bank transactions', register({ title: 'Bank transactions', touches: 'Bank Accounts', create: voucher('Contra') })],
    ['Bank reconciliation', reports.bankReconciliation],
  ]],
  ['Receivables & payables', [
    ['Outstanding bills',outstandingManagement],
    ['Party ledgers', () => reports.chooseStatement(['Sundry Debtors', 'Sundry Creditors'])],
    ['Debtors', reports.debtors],
    ['Creditors', reports.creditors],
    ['Bad debts', reports.purposeLedger('Bad Debts', 'Indirect Expenses')],
    ['Suspense account', reports.purposeLedger('Suspense A/c', 'Current Liabilities')],
    ['Commission', reports.purposeLedger('Commission', 'Indirect Expenses')],
  ]],
  ['GST', [
    ['GST returns', reports.gstReturns],
    ['Sales register', reports.taxRegister('Sales register', ['Sales', 'Credit Note'])],
    ['Purchase register', reports.taxRegister('Purchase register', ['Purchase', 'Debit Note'])],
  ]],
  ['Accountant', [
    ['Chart of accounts', reports.chartOfAccounts],
    ['Ledgers', () => ledgerList()],
    ['Ledger statement', () => reports.chooseStatement()],
    ['Budgets', reports.budgets],
    ['Financial years', companyYears],
    ['Companies & financial years', companies],
  ]],
  ['Reports', [
    ['Purchase planning',purchasePlanning],
    ['Sales analysis',salesAnalysis],
    ['Day book', reports.dayBook],
    ['Trial balance', reports.trialBalance],
    ['Trading account', reports.tradingAccount],
    ['Profit & loss', reports.profitLoss],
    ['Balance sheet', reports.balanceSheet],
    ['Cash flow', reports.cashFlow],
    ['Cash flow by activity', reports.cashFlowSummary],
    ['Funds flow', reports.fundsFlow],
    ['Changes in working capital', () => reports.workingCapitalChanges()],
    ['Cash / bank book', reports.cashBankBook],
    ['Group summary', reports.groupSummary],
    ['Stock movement analysis', reports.movementAnalysis],
    ['Stock category summary', reports.categorySummary],
    ['Stock ageing analysis', reports.stockAgeing],
    ['Stock item monthly summary', reports.stockMonthly],
    ['Journal register', register({title:'Journal register',types:['Journal']})],
    ['Contra register', register({title:'Contra register',types:['Contra']})],
    ['Payment register', register({title:'Payment register',types:['Payment']})],
    ['Receipt register', register({title:'Receipt register',types:['Receipt']})],
    ['Sales return register', register({title:'Sales return register',types:['Credit Note']})],
    ['Purchase return register', register({title:'Purchase return register',types:['Debit Note']})],
    ['Ratios', reports.ratios],
  ]],
  ['Settings', [
    ['Inventory features',inventorySettings],
    ['Item discount & offer rules',inventoryRuleList],
    ['Retail controls',retailControls],
    ['Financial reporting',reportingSettings],
    ['Backup & restore',backupScreen],
    ['Forms & feature settings',formSettings],
    ['Additional fields',customFieldList],
    ['Company', companyForm],
    ['User profile',userProfileForm],
    ['Quit', quit],
  ]],
];
// Match the web Books hierarchy; keep catalog setup separate from daily stock work.
const stock = CATALOG.find(([name]) => name === 'Items & stock');
stock[0] = 'Items';
CATALOG.push(['Stock', stock[1].splice(5)]);
stock[1].push(['Pricebooks', pricebookList]);
const sectionOrder = ['Create', 'Sales', 'Purchases', 'Items', 'Stock', 'Banking', 'Receivables & payables', 'GST', 'Accountant', 'Reports', 'Settings'];
CATALOG.sort((a, b) => sectionOrder.indexOf(a[0]) - sectionOrder.indexOf(b[0]));
const ENTRIES = CATALOG.flatMap(([section, items]) => items.map(([label, open]) => ({ section, label, open })));
const group = (name,labels) => [name,labels.map(label=>ENTRIES.find(entry=>entry.label===label))];
const ENTRY_GROUPS = [
  group('Sales',['Invoices','Quotations','Sales orders','Payments received','Credit notes & sales returns']),
  group('Purchases',['Bills','Purchase orders','Payments made','Expenses','Debit notes & purchase returns']),
  group('Masters & parties',['Items','Customers','Suppliers','Ledgers','Pricebooks','Categories','Manufacturers / brands','Units of measure']),
  group('Banking & stock',['Cheques','Bank accounts','Cash accounts','Bank transactions','Stock journals']),
];
const REPORT_GROUPS = [
  group('Financial statements',['Day book','Trial balance','Trading account','Profit & loss','Balance sheet','Cash flow','Funds flow','Changes in working capital','Cash flow by activity','Ratios']),
  group('Account books',['Cash / bank book','Ledger statement','Group summary','Sales register','Purchase register','Journal register','Contra register','Payment register','Receipt register','Sales return register','Purchase return register']),
  group('Statements of accounts',['Party ledgers','Debtors','Creditors','Outstanding bills','Budgets','Bad debts','Suspense account','Commission']),
  group('Inventory books',['Stock on hand','Stock ledger','Stock item monthly summary','Stock journals','Stock category summary','Batches & expiry']),
  group('Statements of inventory',['Stock movement analysis','Stock ageing analysis','Sales analysis','Stock alerts','Purchase planning','Sales orders','Purchase orders']),
  group('Statutory summaries',['GST returns','Taxes & HSN']),
  group('Banking & setup',['Bank reconciliation','Cheques','Chart of accounts','Financial years']),
];
const SETTINGS_GROUPS=[group('Inventory & pricing',['Inventory features','Item discount & offer rules','Retail controls']),group('Forms & company',['Financial reporting','Forms & feature settings','Additional fields','Company','User profile']),group('Data & backup',['Backup & restore','Quit'])];
const MENUS = [
  {label:'Masters',hint:'Items, parties & accounts',open:createMasters},
  {label:'Create Vouchers',hint:'Sales, purchases & journals',open:()=>createVouchers()},
  {label:'Daybook',hint:'Transactions by date or period',open:reports.dayBook},
  {label:'Registers',hint:'Voucher types & entries',open:()=>registersWorkspace()},
  {label:'Reports',hint:'Review your business',groups:REPORT_GROUPS},
  {label:'Settings',hint:'Preferences & local data',groups:SETTINGS_GROUPS},
];
for(const menu of MENUS)if(menu.groups)menu.open=()=>reportDirectory(menu.groups,null,menu.label);
const menuFor = entry => MENUS.findIndex(menu=>menu.label===entry.label||menu.groups?.some(([,entries])=>entries.includes(entry)));
// Creation aliases stay searchable without taking up left-sidebar rows.
const CREATE_ALIASES = [
  ['New sales invoice', 'Sales'], ['New purchase bill', 'Purchase'],
  ['New credit note', 'Credit Note'], ['New debit note', 'Debit Note'],
  ['Voucher entry', 'Payment'], ['Stock journal', 'Stock In'],
];
async function openCreate(type) {
  if (!await goHome()) return;
  select(MENUS.findIndex(menu => menu.label === 'Create Vouchers'));
  nodes[index].classList.replace('on', 'here');
  nodes[index].setAttribute('aria-current', 'page');
  push(createVouchers(type));
}

// ---- sidebar ----

const nodes = [];
let index = 0;

function drawNav() {
  const nav = document.getElementById('nav');
  nodes.length = 0;
  const search = h('button', { class: 'nav-search', onclick: () => palette() }, 'Find a screen', h('kbd', {}, 'Ctrl K'));
  nav.replaceChildren(search,...MENUS.map((menu,at)=>{
    const node=h('button',{class:'item workspace-nav',onclick:()=>openMenu(at)},h('strong',{},menu.label),h('small',{},menu.hint));
    nodes.push(node);return node;
  }));
}

function select(next) {
  nodes[index]?.classList.remove('on');
  index = (next + nodes.length) % nodes.length;
  nodes[index].classList.add('on');
  nodes[index].scrollIntoView({ block: 'nearest' });
}

// First entry of the next or previous section.
function jumpSection(step) {
  select(index+step);
}

async function openMenu(at, initial=null) {
  if (!(await goHome())) return;
  select(at);
  const menu=MENUS[at];
  const screen = menu.groups?reportDirectory(menu.groups,initial,menu.label):await menu.open();
  if (!screen?.el) return;
  nodes[at].classList.replace('on', 'here');
  nodes.forEach((node, i) => i === at ? node.setAttribute('aria-current', 'page') : node.removeAttribute('aria-current'));
  push(screen);
}
const openEntry = async at => { const entry=ENTRIES[at],menu=menuFor(entry);if(menu>=0)return openMenu(menu,entry.label);if(!await goHome())return;const screen=await entry.open();if(screen?.el)push(screen); };

// ---- home ----

function dashboard() {
  let calculatorEnabled=false;
  const cards = h('div', { class: 'cards' });
  const greeting=h('h2',{class:'dashboard-greeting'});let profile={};const updateGreeting=()=>{greeting.textContent=greetingText(profile.name);};setInterval(updateGreeting,60000);
  const latest = h('div', { class: 'panel' });
  const analytics=h('div',{class:'dashboard-analytics-host',tabIndex:0,'aria-label':'Dashboard charts and figures'});
  const workspace=h('aside',{class:'dashboard-company-panel manage-rail workspace-menu-card','aria-label':'Company workspace'},h('h3',{},'Company workspace'),h('p',{class:'master-section-title'},'Business & books'),h('button',{onclick:()=>push(companies())},h('span',{},'Companies & years'),h('kbd',{},'F3')),h('p',{class:'master-section-title'},'Voucher creation'),...DASHBOARD_VOUCHERS.map(({key,type,label})=>h('button',{onclick:()=>openCreate(type)},h('span',{},label),h('kbd',{},key))));
  workspace.addEventListener('keydown',e=>{if(['ArrowUp','ArrowDown'].includes(e.key)){e.preventDefault();const buttons=[...workspace.querySelectorAll('button')],i=buttons.indexOf(document.activeElement);buttons[(i+(e.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length]?.focus();}});
  const el = h('section', { class: 'dash' },
    h('div', { class: 'dash-intro' },greeting),
    h('div',{class:'dashboard-layout'},h('div',{class:'dashboard-main'},cards, analytics, latest),workspace));

  return {
    title: 'Dashboard',
    get hints(){return calculatorEnabled?[['Ctrl+Shift+C','Calculator']]:[];},
    showGlobalHints: false,
    el,
    async onShow() {
      document.activeElement?.blur?.();
      nodes.forEach((node) => node.classList.remove('here'));
      nodes.forEach((node) => node.removeAttribute('aria-current'));
      select(index);
      refreshLedgers();
      profile=await call('userProfile');updateGreeting();
      calculatorEnabled=Boolean((await call('settings')).useCalculator);chrome();
      const [s, vouchers,groups] = await Promise.all([call('statements', {asOf:reportDate(),from:activePeriod().from}), call('dayBook', {from:activePeriod().from,to:reportDate()}),call('groups')]);
      const belongs=(id,name)=>{const seen=new Set();while(id&&!seen.has(id)){seen.add(id);const g=groups.find(g=>g.id===id);if(g?.name===name)return true;id=g?.parentId;}return false;};
      const of = (group) => s.ledgers.filter((ledger) => belongs(ledger.groupId,group)).reduce((total, ledger) => total + ledger.balance, 0);
      const card = (label, value, tone = '') => h('div', { class: `card ${tone}` }, h('span', {}, label), h('strong', {}, signed(value)));
      cards.replaceChildren(
        card('Cash & bank', of('Cash-in-Hand') + of('Bank Accounts')),
        card('Receivable from customers', of('Sundry Debtors'), 'warn'),
        card('Payable to suppliers', -of('Sundry Creditors'), 'warn'),
        card('Stock at cost', s.closingStock),
        card('Sales in selected period', -(s.byPrimary['Sales Accounts'] || 0), 'good'),
        card(s.netProfit < 0 ? 'Net loss in selected period' : 'Net profit in selected period', Math.abs(s.netProfit), s.netProfit < 0 ? 'bad' : 'good'));
      try{const cash=await call('cashMovement',{from:activePeriod().from,to:reportDate()});const periods=await Promise.all(cash.rows.map(m=>call('statements',{from:m.from,asOf:m.to})));const months=cash.rows.map((m,i)=>({...m,sales:-(periods[i].byPrimary['Sales Accounts']||0),purchases:periods[i].byPrimary['Purchase Accounts']||0}));analytics.replaceChildren(dashboardCharts({months,statements:s,from:activePeriod().from,to:reportDate(),openReport:name=>openEntry(ENTRIES.findIndex(e=>e.label===name))}));}catch(error){analytics.replaceChildren(h('p',{class:'report-warning'},'Charts could not load: '+error.message));}
      const rows = vouchers.slice(-7).reverse().map((row) => h('tr', {},
        h('td', {}, showDate(row.date)), h('td', {}, `${row.type} ${row.number}`), h('td', {}, row.particulars || ''), h('td', { class: 'num' }, money(row.amount))));
      latest.replaceChildren(h('h2', {}, 'Latest vouchers'), rows.length ? h('table', {}, h('tbody', {}, rows)) : h('p', { class: 'empty' }, 'No vouchers yet. Start with a purchase bill or a sales invoice.'));
    },
    onKey(event) {
      const voucherAction=!event.altKey&&!event.ctrlKey&&!event.metaKey&&!event.shiftKey&&DASHBOARD_VOUCHERS.find(v=>v.key===event.key);if(voucherAction){event.preventDefault();openCreate(voucherAction.type);return true;}
      if(event.altKey&&event.code==='KeyD'){event.preventDefault();analytics.focus();analytics.scrollIntoView({block:'start'});return true;}
      if(event.target===analytics&&['ArrowDown','ArrowUp','PageDown','PageUp','Home','End'].includes(event.key)){event.preventDefault();if(event.key==='Home')el.scrollTop=0;else if(event.key==='End')el.scrollTop=el.scrollHeight;else el.scrollBy({top:({ArrowDown:60,ArrowUp:-60,PageDown:el.clientHeight*.8,PageUp:-el.clientHeight*.8})[event.key]});return true;}
      if(event.key==='F3'&&!event.altKey&&!event.ctrlKey){event.preventDefault();push(companies());return true;}
      if (event.target.closest('button, summary, input')) return false;
      if (event.ctrlKey || event.altKey || event.metaKey) return false;
      if (event.key === 'ArrowDown') select(index + 1);
      else if (event.key === 'ArrowUp') select(index - 1);
      else if (event.key === 'PageDown') jumpSection(1);
      else if (event.key === 'PageUp') jumpSection(-1);
      else if (event.key === 'Enter') openMenu(index);
      else if (event.key.length === 1 && event.key !== ' ') palette(event.key);
      else return false;
      event.preventDefault();
      return true;
    },
  };
}

// ---- settings ----

async function showCompany() {
  const [company,years]=await Promise.all([call('company'),call('financialYearState')]);
  const sidebarCompany=document.getElementById('sidebar-company');sidebarCompany.textContent=company.name;sidebarCompany.title=company.name;sidebarCompany.classList.toggle('long-name',company.name.length>28);
  document.getElementById('company').textContent = `${company.name} · FY ${years.active.name}`;
}

function companyForm() {
  const fields = { name: 'Company name', address: 'Address', state: 'State', gstin: 'GSTIN', phone: 'Phone' };
  const inputs = Object.fromEntries(Object.keys(fields).map((key) => [key, h('input', { class: 'wide', maxLength: 200 })]));

  async function save() {
    try {
      await call('setCompany', Object.fromEntries(Object.entries(inputs).map(([key, input]) => [key, input.value])));
      await showCompany();
      toast('Company details saved');
      pop();
    } catch (error) {
      toast(error.message, 'error');
    }
  }

  return {
    title: 'Company',
    hints: [['Enter', 'Next field'], ['Ctrl+S', 'Save'], ['Esc', 'Back']],
    el: h('section', { class: 'form' }, Object.entries(fields).map(([key, label]) => labelled(label, inputs[key])),
      h('p', { class: 'tip' }, 'The state decides the tax on a document: CGST and SGST for a party in the same state, IGST for another state.')),
    async onShow() {
      const company = await call('company');
      for (const [key, input] of Object.entries(inputs)) input.value = company[key];
      inputs.name.focus();
      inputs.name.select();
    },
    onKey: formKeys(Object.values(inputs), save),
  };
}

async function quit() {
  if (await confirmBox('Quit Desktop ERP?')) window.books.quit();
}

// Ctrl+K, or typing on the dashboard: jump to any screen, or to any ledger's statement.
// It opens at once from the ledgers last read, so keys typed quickly all land in it.
let ledgers = [];
const refreshLedgers = async () => { ledgers = await call('ledgers'); };

async function palette(typed = '') {
  const choice = await picker('Go to', [
    ...MENUS.filter(menu=>menu.groups||['Manage Records','Registers','Daybook'].includes(menu.label)).map(menu=>({label:menu.label,hint:'Workspace',run:()=>openMenu(MENUS.indexOf(menu))})),
    ...REGISTER_TYPES.map(([label])=>({label,hint:'Registers',run:()=>push(registersWorkspace(label))})),
    {label:'Manage Records',hint:'Records',run:()=>push(manageRecords())},
    ...ENTRIES.map((entry, at) => ({ label: entry.label, hint: entry.section, run: () => openEntry(at) })),
    ...CREATE_ALIASES.map(([label, type]) => ({ label, hint: 'Create Vouchers', run: () => openCreate(type) })),
    ...ledgers.map((row) => ({ label: row.name, hint: 'Ledger statement', run: () => push(reports.ledgerStatement(row.id)) })),
  ], typed);
  choice?.run();
}

window.addEventListener('keydown', (event) => {
  if (top()?.functionKey?.(event)) return;
  if (mod(event) && event.code === 'KeyH') {
    event.preventDefault();
    goHome();
  } else if (event.key === 'F10' || (mod(event) && event.code === 'KeyB')) {
    event.preventDefault();
    select(index);
    nodes[index].focus();
  } else if (event.target.closest('#nav') && ['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp'].includes(event.key)) {
    event.preventDefault();
    if (event.key === 'PageDown') jumpSection(1);
    else if (event.key === 'PageUp') jumpSection(-1);
    else select(index + (event.key === 'ArrowDown' ? 1 : -1));
    nodes[index].focus();
  } else if (mod(event) && event.code === 'KeyK') {
    event.preventDefault();
    refreshLedgers().then(() => palette());
  } else if (event.target.closest('button') && event.key === 'Enter') {
    event.preventDefault();
    event.target.closest('button').click();
  } else if (event.target.closest('button, summary') && ['Enter', ' '].includes(event.key)) {
    // Native buttons must activate themselves, even when a register is open.
    return;
  } else if (!top().onKey?.(event) && event.key === 'Escape') {
    event.preventDefault();
    if (!pop() && atHome()) quit();
  }
});

document.getElementById('today').textContent = showDate(today());
drawNav();
showCompany();
push(dashboard());
