// Creation workspaces reuse the existing local forms and their validation.
import { h, confirmBox, toast } from './ui.js';
import { chrome, pop } from './router.js';
import { invoiceEntry } from './invoice.js';
import { voucherEntry } from './voucher.js';
import { ledgerForm, groupForm } from './ledgers.js';
import { itemForm } from './items.js';
import { bookForm } from './pricebooks.js';

const document = type => () => invoiceEntry({ type });
const journal = type => () => voucherEntry({ type });
const VOUCHERS = [
  ['F1', 'Sales Order', 'Sales order', document('Sales Order')],
  ['F2', 'date', 'Change date', null],
  ['F3', 'Quotation', 'Quotation', document('Quotation')],
  ['F4', 'Contra', 'Contra', journal('Contra')],
  ['F5', 'Payment', 'Payment', journal('Payment')],
  ['F6', 'Receipt', 'Receipt', journal('Receipt')],
  ['F7', 'Journal', 'Journal', journal('Journal')],
  ['F8', 'Sales', 'Sales invoice', document('Sales')],
  ['F9', 'Purchase', 'Purchase bill', document('Purchase')],
  ['F10', 'Credit Note', 'Credit note', document('Credit Note')],
  ['F11', 'Debit Note', 'Debit note', document('Debit Note')],
  ['F12', 'Purchase Order', 'Purchase order', document('Purchase Order')],
  ['Alt+F7', 'Stock In', 'Stock in', document('Stock In')],
  ['Alt+F8', 'Stock Out', 'Stock out', document('Stock Out')],
];
export const DASHBOARD_VOUCHERS=['Sales','Purchase','Receipt','Payment'].map(type=>{const [key,id,label]=VOUCHERS.find(row=>row[1]===type);return {key,type:id,label};});
const MASTERS = [
  ['F1', 'ledger', 'Ledger', saved => ledgerForm(null, null, saved)],
  ['F2', 'group', 'Account group', saved => groupForm(null, saved)],
  ['F3', 'bank', 'Bank account', saved => ledgerForm(null, 'Bank Accounts', saved)],
  ['F4', 'cash', 'Cash account', saved => ledgerForm(null, 'Cash-in-Hand', saved)],
  ['F5', 'supplier', 'Supplier', saved => ledgerForm(null, 'Sundry Creditors', saved)],
  ['F6', 'item', 'Item', saved => itemForm(null, saved)],
  ['F7', 'customer', 'Customer', saved => ledgerForm(null, 'Sundry Debtors', saved)],
  ['F8', 'pricebook', 'Pricebook', saved => bookForm(null, saved)],
];

export const createVouchers = (type = 'Sales') => workspace('Create Vouchers', VOUCHERS, type);
export const createMasters = () => workspace('Masters', MASTERS, 'ledger');

function workspace(label, choices, initial) {
  let selected = choices.find(row => row[1] === initial) || choices[0];
  let child;
  let dirty = false;
  let switching = false;
  const editor = h('div', { class: 'creation-editor' });
  const rail = h('aside', { class: 'creation-rail workspace-menu-card' });
  const masterActions=h('div',{class:'master-actions'},h('span',{},'Enter / Tab: next field · Shift+Tab: previous'),h('button',{onclick:()=>child?.onKey?.({ctrlKey:true,code:'KeyS',preventDefault(){}})},'Save & create next · Ctrl+S'));
  masterActions.hidden=label!=='Masters';
  rail.setAttribute('aria-label', `${label} shortcuts`);
  const el = h('section', { class: 'creation-workspace' },
    h('div', { class: 'creation-body' },
      h('div', { class: 'creation-heading' }, h('span', {}, label), h('small', {}, 'Local books · Ctrl+S to save')),
      editor,masterActions), rail);
  el.addEventListener('input', () => { dirty = true; });
  el.addEventListener('change', () => { dirty = true; });

  const canLeave = () => switching ? false : child?.canLeave ? child.canLeave() : !dirty || confirmBox('Leave without saving this master?');
  function drawRail() {
    rail.replaceChildren(h('h2', {}, label === 'Create Vouchers' ? 'Voucher type' : 'Master type'),
      h('p', {class:'master-section-title'}, label === 'Create Vouchers' ? 'Voucher creation' : 'Masters'),
      ...choices.map(([key, id, name]) => {
        const button = h('button', { class: id === selected[1] ? 'active' : '', onclick: () => choose(id) }, h('kbd', {}, key), h('span', {}, name));
        button.setAttribute('aria-pressed', String(id === selected[1]));
        return button;
      }), h('div', { class: 'creation-rail-note' }, 'Ctrl+B  Left sidebar', h('br'), 'Esc  Back'));
  }
  async function mount() {
    child = selected[3](async () => { dirty = false; await mount(); });
    editor.replaceChildren(child.el);
    drawRail();
    chrome();
    await child.onShow?.(false);
    dirty = false;
  }
  async function choose(id) {
    if (switching) return;
    if (id === 'date') {
      child.onKey?.({ key: 'F2', preventDefault() {} });
      return;
    }
    if (id === selected[1]) return;
    // Lock before awaiting confirmation so repeated keys cannot stack dialogs.
    const permitted = child?.canLeave ? () => child.canLeave() : () => !dirty || confirmBox('Leave without saving this master?');
    switching = true;
    try {
      if (!await permitted()) return;
      selected = choices.find(row => row[1] === id);
      await mount();
    } catch (error) { toast(error.message, 'error'); }
    finally { switching = false; }
  }
  function functionKey(event) {
    if (event.ctrlKey || event.metaKey || event.shiftKey) return false;
    const key = `${event.altKey ? 'Alt+' : ''}${event.key}`;
    const choice = choices.find(row => row[0] === key);
    if (!choice) return false;
    event.preventDefault();
    choose(choice[1]);
    return true;
  }
  return {
    get title() { return child?.title || label; },
    get hints() { return (child?.hints || []).filter(([key]) => !/F[0-9]/.test(key)); },
    el, canLeave, functionKey,
    async onShow(returning) {
      if (!child) await mount();
      else await child.onShow?.(returning);
    },
    onKey(event) {
      if (functionKey(event)) return true;
      // The workspace owns function keys. Do not let a child form's older
      // type shortcuts change the form without updating the selected rail row.
      if (/^F\d+$/.test(event.key)) { event.preventDefault(); return true; }
      if (event.key === 'Escape') {
        event.preventDefault();
        Promise.resolve(canLeave()).then(ok => { if (ok) pop(); });
        return true;
      }
      if (switching) { event.preventDefault(); return true; }
      return child?.onKey?.(event);
    },
  };
}
