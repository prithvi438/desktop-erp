import {inlineMaster,masterActions} from './inline-master.js';
import {itemForm} from './items.js';
import { h, call, labelled, formKeys, toast, money, plain, parseMoney, parseQty, showQty, suggest, createList, confirmBox } from './ui.js';
import { push, pop } from './router.js';
import { pageMasterForm } from './keyboard-pages.js';

export function pricebookList() {
  const list = createList({ filter: true, empty: 'No pricebooks. Alt+C creates one.',
    columns: [
      { label: 'Pricebook', get: r => r.name }, { label: 'Mode', get: r => r.mode },
      { label: 'Percent', get: r => plain(r.pct) }, { label: 'Items', get: r => r.entryCount },
      { label: 'Status', get: r => !r.active ? 'Inactive' : r.is_default ? 'Default' : 'Active' },
    ], onEnter: row => push(priceEntries(row)),
  });
  const reload = async () => { list.setRows(await call('pricebooks')); list.focus(); };
  async function remove() {
    const row = list.current();
    if (!row || !await confirmBox(`Delete pricebook ${row.name}? Saved invoice amounts will stay unchanged.`)) return;
    try { await call('deletePricebook', { id: row.id }); await reload(); }
    catch (e) { toast(e.message, 'error'); }
  }
  return { title: 'Pricebooks', el: list.el, onShow: reload,
    hints: [['Enter', 'Item prices'], ['Alt+C', 'Create'], ['Alt+E', 'Edit'], ['Alt+D', 'Delete'], ['Esc', 'Back']],
    onKey(e) {
      if (e.altKey && e.code === 'KeyC') push(bookForm());
      else if (e.altKey && e.code === 'KeyE' && list.current()) push(bookForm(list.current()));
      else if (e.altKey && e.code === 'KeyD') remove();
      else return list.onKey(e);
      e.preventDefault(); return true;
    },
  };
}

export function bookForm(book, onSaved = null) {
  let dirty=false;
  const name = h('input', { value: book?.name || '', maxLength: 100 });
  const mode = h('input', { value: book?.mode || 'FLAT' });
  const pct = h('input', { value: plain(book?.pct || 0) });
  const active = h('input', { value: book?.active === 0 ? 'No' : 'Yes' });
  const defaultBook = h('input', { value: book?.is_default ? 'Yes' : 'No' });
  const fields = [name, mode, pct, active, defaultBook];
  const el = h('section', { class: 'form master-form' },
    h('div',{class:'master-intro'},h('p',{class:'eyebrow'},'PRICEBOOK MASTER'),h('h2',{},book?'Edit pricebook':'Create pricebook')),
    h('fieldset',{class:'master-group'},h('legend',{},'Pricing rules'),...['Name *', 'Mode', 'Percentage', 'Active (Yes / No)', 'Default (Yes / No)'].map((label, i) => labelled(label, fields[i]))),
    h('p', { class: 'tip' }, 'Item prices and quantity tiers override the percentage. Markup and markdown use the item sale rate. Pricebook definitions are stored locally.'));
  pageMasterForm(el);
  el.addEventListener('input',()=>{dirty=true;});el.addEventListener('change',()=>{dirty=true;});
  suggest(mode, { items: () => ['FLAT', 'MARKUP', 'MARKDOWN'].map(label => ({ id: label, label })) });
  for (const input of [active, defaultBook]) suggest(input, { items: () => ['Yes', 'No'].map(label => ({ id: label, label })) });
  async function save() {
    try {
      if (![active, defaultBook].every(input => /^(yes|no)$/i.test(input.value))) throw Error('Enter Yes or No');
      const result=await call('savePricebook', { id: book?.id, name: name.value, mode: mode.value.toUpperCase(), pct: parseMoney(pct.value), active: /^yes$/i.test(active.value), isDefault: /^yes$/i.test(defaultBook.value) });
      dirty=false;toast('Pricebook saved'); if (onSaved) await onSaved(result); else pop();
    } catch (e) { toast(e.message, 'error'); }
  }
  const canLeave=()=>!dirty||confirmBox('Leave without saving this pricebook?');
  const keys=formKeys(fields,save);
  return { title: book ? 'Edit pricebook' : 'Create pricebook', el,canLeave,
    hints: [['Enter', 'Next field'], ['Ctrl+S', 'Save'], ['Esc', 'Back']], onShow() { name.focus(); },
    onKey(e){if(e.key==='Escape'){e.preventDefault();Promise.resolve(canLeave()).then(ok=>{if(ok)pop();});return true;}return keys(e);} };
}

export function priceEntries(book) {
  const list = createList({ filter: true, empty: 'No item overrides. Base sale rate or pricebook percentage applies.',
    columns: [{ label: 'Item', get: r => r.name }, { label: 'Minimum quantity', get: r => `${showQty(r.minQty)} ${r.unit}` }, { label: 'Price', cls: 'num', get: r => money(r.price) }],
    onEnter: row => push(entryForm(book, row)),
  });
  const reload = async () => { list.setRows(await call('pricebookEntries', { bookId: book.id })); list.focus(); };
  async function remove() {
    const row = list.current();
    if (!row || !await confirmBox(`Remove this price tier for ${row.name}?`)) return;
    try { await call('deletePricebookEntry', { bookId: book.id, itemId: row.itemId, minQty: row.minQty }); await reload(); }
    catch (e) { toast(e.message, 'error'); }
  }
  return { title: `Prices: ${book.name}`, el: list.el, onShow: reload,
    hints: [['Enter', 'Edit price'], ['Alt+C', 'Add item / tier'], ['Alt+D', 'Remove tier'], ['Esc', 'Back']],
    onKey(e) {
      if (e.altKey && e.code === 'KeyC') push(entryForm(book));
      else if (e.altKey && e.code === 'KeyD') remove();
      else return list.onKey(e);
      e.preventDefault(); return true;
    },
  };
}

function entryForm(book, row) {
  let items = [];
  const item = h('input', { value: row?.name || '', readOnly: Boolean(row) });
  if (row) item.dataset.id = row.itemId;
  const qty = h('input', { value: showQty(row?.minQty || 0), readOnly: Boolean(row) });
  const price = h('input', { value: row ? plain(row.price) : '' });
  const el = h('section', { class: 'form' }, labelled('Item', item), labelled('Minimum quantity', qty), labelled('Unit price', price), h('p', { class: 'tip' }, 'Use minimum quantity 0 for the base price. Add another tier for a volume price.'));
  if (!row) suggest(item, { items: () => items,onCreate:masterActions('item') });
  async function save() {
    try {
      await call('setPricebookEntry', { bookId: book.id, itemId: Number(item.dataset.id), minQty: parseQty(qty.value), price: parseMoney(price.value) });
      toast('Price saved'); pop();
    } catch (e) { toast(e.message, 'error'); }
  }
  return { title: `Item price: ${book.name}`, hints: [['Enter', 'Next field'], ['Ctrl+S', 'Save'], ['Esc', 'Back']],
    el,
    async onShow() { items = (await call('items')).map(r => ({ id: r.id, label: r.name })); (row ? price : item).focus(); },
    onKey: formKeys([item, qty, price], save),
  };
}
