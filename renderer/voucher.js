import {voucherReferences} from './bill-references.js';
import {masterActions} from './inline-master.js';
import { h, call, mod, suggest, sideInput, money, plain, parseMoney, parseDate, showDate, today, toast, confirmBox,focus } from './ui.js';
import { rowPages } from './keyboard-pages.js';
import { push, pop, chrome } from './router.js';
import { ledgerForm } from './ledgers.js';
import { recordExtras } from './details.js';
import { settlementEditor } from './settlement.js';

const TYPE_KEYS = { F4: 'Contra', F5: 'Payment', F6: 'Receipt', F7: 'Journal', F8: 'Sales', F9: 'Purchase' };

// The date of the last saved voucher is offered again for the next one.
let lastDate = today();

export function voucherEntry({ id = null, type = 'Payment' } = {}) {
  let referenceDraft=null;
  let original = null; // the stored voucher, when altering
  let nextNumber = 0;
  let ledgers = [];
  let dirty = false;
  let guided = false;
  const extras=recordExtras('document',()=>{dirty=true;},{manual:true});
  const rows = [];

  const typeBar = h('div', { class: 'types' });
  const numberEl = h('strong');
  const dateInput = h('input', { class: 'date' });
  const narration = h('input', { class: 'wide', maxLength: 200 });
  const tbody = h('tbody');
  const pages=rowPages(tbody,{size:()=>innerHeight<660?3:innerHeight<780?4:6,label:'Ledger lines'});
  const drTotal = h('td', { class: 'num' });
  const crTotal = h('td', { class: 'num' });
  const gap = h('p', { class: 'gap' });
  const settlement=settlementEditor({getLedgers:()=>ledgers,onChange:()=>{dirty=true;},onDone:()=>narration.focus()});

  const el = h('section', { class: 'voucher keyboard-voucher' },
    typeBar,
    h('div', { class: 'vhead' }, h('span', {}, 'No. ', numberEl), h('label', {}, 'Date ', dateInput)),
    settlement.el,
    h('table', { class: 'lines' },
      h('thead', {}, h('tr', {}, h('th', { class: 'side' }, 'Dr/Cr'), h('th', {}, 'Particulars'), h('th', { class: 'num' }, 'Debit'), h('th', { class: 'num' }, 'Credit'))),
      tbody,
      h('tfoot', {}, h('tr', {}, h('td'), h('td', {}, 'Total'), drTotal, crTotal))),
    pages.el,gap,
    h('label', { class: 'narration' }, h('span', {}, 'Narration'), narration),extras.el);
  async function editReferences(){try{const date=parseDate(dateInput.value);if(!date)return toast('Enter a valid date first','error');const lines=guided?settlement.read():rows.filter(r=>r.ledger.dataset.id&&parseMoney(r.amount.value)).map(r=>({ledgerId:Number(r.ledger.dataset.id),amount:(r.side.value==='Dr'?1:-1)*parseMoney(r.amount.value)}));const result=await voucherReferences({lines,date,voucherId:id,draft:referenceDraft,silent:true});if(result){referenceDraft=result;dirty=true;return true;}return false;}catch(e){toast(e.message,'error');}}
  el.addEventListener('input', () => { dirty = true; });
  el.addEventListener('change', () => { dirty = true; });

  // Debit total minus credit total; also refreshes the footer.
  function difference() {
    let dr = 0;
    let cr = 0;
    for (const row of rows) {
      const amount = parseMoney(row.amount.value) || 0;
      if (row.side.value === 'Dr') dr += amount;
      else cr += amount;
    }
    drTotal.textContent = money(dr);
    crTotal.textContent = money(cr);
    const diff = dr - cr;
    gap.textContent = diff ? `${money(diff)} still to ${diff > 0 ? 'credit' : 'debit'}` : '';
    return diff;
  }

  const filled = (row) => row.ledger.dataset.id && parseMoney(row.amount.value);
  const complete = () => difference() === 0 && rows.filter(filled).length >= 2;

  function addRow(side, line) {
    const row = {
      side: sideInput(side),
      ledger: h('input', { class: 'wide' }),
      amount: h('input', { class: 'num' }),
      dr: h('td', { class: 'num' }),
      cr: h('td', { class: 'num' }),
    };
    const place = () => (row.side.value === 'Dr' ? row.dr : row.cr).append(row.amount);
    if (line) {
      row.ledger.value = line.ledgerName;
      row.ledger.dataset.id = line.ledgerId;
      row.amount.value = plain(line.amount);
    }
    place();
    tbody.append(h('tr', {}, h('td', { class: 'side' }, row.side), h('td', { class: 'field' }, row.ledger), row.dr, row.cr));
    rows.push(row);

    suggest(row.ledger, {
      items: () => ledgers,onCreate:masterActions('ledger'),
      onPick() {
        dirty = true;
        // Offer the amount that balances the voucher when this line is on the short side.
        const diff = difference();
        if (!row.amount.value && diff && (diff > 0) === (row.side.value === 'Cr')) row.amount.value = plain(diff);
        difference();
        focus(row.amount);
        row.amount.select();
      },
    });
    row.side.addEventListener('change', () => { place(); difference(); });
    row.amount.addEventListener('input', difference);
    row.side.addEventListener('keydown', (event) => onEnter(event, () => focus(row.ledger)));
    row.ledger.addEventListener('keydown', (event) => onEnter(event, () => {
      if (row.ledger.dataset.id) { focus(row.amount); }
      else if (row.ledger.value.trim()) toast('No ledger by that name. Alt+C creates one.', 'error');
      else if (complete()) narration.focus();
      else toast('Pick a ledger', 'error');
    }));
    row.amount.addEventListener('keydown', (event) => onEnter(event, () => {
      const amount = parseMoney(row.amount.value);
      if (!amount) return toast('Enter an amount', 'error');
      row.amount.value = plain(amount);
      if (complete()) return narration.focus();
      const next = rows[rows.indexOf(row) + 1] || addRow(difference() > 0 ? 'Cr' : 'Dr');
      focus(next.ledger);
    }));
    return row;
  }

  function onEnter(event, action) {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    action();
  }

  async function setType(next) {
    type = next;
    if (!id) nextNumber = await call('nextNumber', { type });
    numberEl.textContent = !id ? nextNumber : type === original.type ? original.number : 'new';
    typeBar.replaceChildren(...Object.entries(TYPE_KEYS).map(([key, name]) => h('span', { class: name === type ? 'on' : '' }, h('kbd', {}, key), name)));
    // A receipt starts with the account credited; every other type starts with a debit.
    if (rows.length === 1 && !rows[0].ledger.value) {
      rows[0].side.value = type === 'Receipt' ? 'Cr' : 'Dr';
      rows[0].side.dispatchEvent(new Event('change'));
    }
    chrome();
  }

  async function start() {
    referenceDraft=null;
    rows.length = 0;
    tbody.replaceChildren();
    narration.value = '';
    if (id) {
      original = await call('voucher', { id });
      type=original.type;
      await extras.load(id,original.details,original.date);
      dateInput.value = showDate(original.date);
      narration.value = original.narration;
      for (const line of original.lines) addRow(line.amount > 0 ? 'Dr' : 'Cr', line);
      await setType(original.type);
    } else {
      await extras.load(null,null,lastDate);
      dateInput.value = showDate(lastDate);
      addRow('Dr');
      await setType(type);
    }
    guided=settlement.load(type,original?.lines||[]);
    settlement.el.hidden=!guided;
    el.querySelector(':scope > table').hidden=guided;
    gap.hidden=guided;
    pages.el.hidden=guided;
    chrome();
    difference();
    dirty = false;
    if(guided)settlement.focus();else focus(rows[0].ledger);
  }

  async function save() {
    const date = parseDate(dateInput.value);
    if (!date) {
      toast('Date is not valid. Use dd-mm-yyyy.', 'error');
      return dateInput.focus();
    }
    let lines = [];
    if(guided){try{lines=settlement.read();}catch(error){toast(error.message,'error');return;}}
    for (const row of guided?[]:rows) {
      if (!row.ledger.value.trim() && !row.amount.value.trim()) continue;
      const amount = parseMoney(row.amount.value);
      if (!row.ledger.dataset.id) { toast('Pick a ledger on every line', 'error'); return focus(row.ledger); }
      if (!amount) { toast('Enter an amount on every line', 'error'); return focus(row.amount); }
      lines.push({ ledgerId: Number(row.ledger.dataset.id), amount: row.side.value === 'Dr' ? amount : -amount });
    }
    try {
      const saved = await call('saveVoucher', { ...(id ? { id } : {}), type, date, narration: narration.value.trim(), lines,details:extras.read(),...(referenceDraft?{billReferences:referenceDraft}:{}) });
      toast(`${type} No. ${saved.number} saved`);
      dirty = false;
      extras.committed();
      if (id) return pop();
      lastDate = date;
      await start();
    } catch (error) {
      toast(error.message, 'error');
    }
  }

  const canLeave = async () => {if(dirty&&!await confirmBox('Leave without saving this voucher?'))return false;await extras.discard();return true;};
  const leave = async () => { if (await canLeave()) pop(); };

  dateInput.addEventListener('keydown', (event) => onEnter(event, () => {
    const date = parseDate(dateInput.value);
    if (!date) return toast('Date is not valid. Use dd-mm-yyyy.', 'error');
    dateInput.value = showDate(date);
    if(guided)settlement.focus();else focus(rows[0].ledger);
  }));
  let allocating=false;
  narration.addEventListener('keydown',event=>onEnter(event,async()=>{if(allocating)return;allocating=true;try{if(await editReferences())await save();}finally{allocating=false;}}));

  return {
    get title() { return `${id ? 'Alter voucher' : 'Voucher entry'}: ${type}`; },
    get hints(){return [['Enter', 'Next'], ['F2', 'Date'], ['Shift+Tab', 'Back a field'], ...(guided?[['Alt+N','Add allocation']]:[['D / C','Debit or credit']]), ['Alt+C', 'Create ledger'], ['Ctrl+S', 'Save'], ['Esc', 'Back']];},
    el,
    canLeave,
    async onShow(returning) {
      ledgers = (await call('ledgers')).map((row) => ({ ...row, label: row.name, hint: row.groupName }));
      if (!returning) await start();
    },
    onKey(event) {
      if(extras.onKey(event))return true;
      if (TYPE_KEYS[event.key]) {
        const next=TYPE_KEYS[event.key];
        if(next!==type)Promise.resolve(canLeave()).then(async ok=>{
          if(!ok)return;
          id=null;original=null;type=next;await start();
        });
      }
      else if (event.key === 'F2') { dateInput.focus(); dateInput.select(); }
      else if (mod(event) && event.code === 'KeyS') save();
      else if (event.altKey && event.code === 'KeyN' && guided) settlement.addBlank();
      else if (event.key === 'Escape') leave();
      else return false;
      event.preventDefault();
      return true;
    },
  };
}
