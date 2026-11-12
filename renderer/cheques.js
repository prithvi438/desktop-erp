import {reportDate} from './ui.js';
import {focusPeriod} from './ui.js';
import {masterActions} from './inline-master.js';
import { h, call, labelled, formKeys, toast, money, parseMoney, showDate, parseDate, today, suggest, createList, confirmBox, ask } from './ui.js';
import { push, pop } from './router.js';
import {dateModes} from './date-modes.js';
import {activePeriod} from './ui.js';

export function chequeRegister() {
  const actions = h('div', { class: 'register-actions' });
  const summary = h('p', { class: 'register-summary' });
  const from=h('input',{'aria-label':'From date',placeholder:'First cheque'}),to=h('input',{'aria-label':'To date',placeholder:'Last cheque'});
  from.value=showDate(activePeriod().from);to.value=showDate(reportDate());
  const list = createList({ filter: true, empty: 'No cheques. Alt+C records a received or issued cheque.',
    columns: [
      { label: 'Cheque', get: r => r.number }, { label: 'Date', get: r => showDate(r.date) },
      { label: 'Direction', get: r => r.direction === 'IN' ? 'Received' : 'Issued' },
      { label: 'Party', get: r => r.party }, { label: 'Bank', get: r => r.bank },
      { label: 'Amount', cls: 'num', get: r => money(r.amount) }, { label: 'Status', get: r => r.status },
    ], onEnter: row => toast(`${row.number}: ${row.status}. Use the action buttons or keyboard shortcuts.`),
  });
  list.el.prepend(summary, actions);
  list.el.prepend(h('div',{class:'daybook-filters'},dateModes(from,to,reload),h('label',{},'From ',from),h('label',{},'To ',to),h('button',{onclick:reload},'Apply')));
  const operations = [['M', 'mature', 'Mature'], ['D', 'deposit', 'Deposit'], ['L', 'clear', 'Clear'], ['B', 'bounce', 'Bounce'], ['X', 'cancel', 'Cancel']];
  actions.append(h('button', { onclick: () => push(chequeForm()) }, 'New (Alt+C)'),
    ...operations.map(([key, action, label]) => h('button', { onclick: () => act(action) }, `${label} (Alt+${key})`)));
  async function reload() {
    const start=from.value.trim()?parseDate(from.value):undefined,end=to.value.trim()?parseDate(to.value):undefined;
    if(start===null||end===null||(start&&end&&start>end))return toast('Enter valid dates, with From on or before To.','error');
    const rows = (await call('cheques')).filter(row=>(!start||row.date>=start)&&(!end||row.date<=end));
    list.setRows(rows);
    const pending = rows.filter(r => ['PDC','PENDING','DEPOSITED'].includes(r.status));
    const sum = dir => pending.filter(r => r.direction === dir).reduce((n,r) => n+r.amount,0);
    summary.textContent = `Pending received: ${money(sum('IN'))}  ·  Pending issued: ${money(sum('OUT'))}  ·  ${rows.length} cheques`;
    list.focus();
  }
  async function act(action) {
    const row = list.current();
    if (!row) return;
    const entered = await ask(`${action.toUpperCase()} cheque ${row.number}: action date (dd-mm-yyyy)`, showDate(today()));
    if (entered === null) return;
    const date = parseDate(entered);
    if (!date) return toast('Enter a valid date', 'error');
    if (!await confirmBox(`${action.toUpperCase()} cheque ${row.number} for ${money(row.amount)}? Any accounting entries will be posted locally.`)) return;
    try { await call('chequeAction', { id: row.id, action, date }); await reload(); toast('Cheque updated'); }
    catch (e) { toast(e.message, 'error'); }
  }
  async function remove() {
    const row = list.current();
    if (!row || !await confirmBox(`Delete unposted cheque ${row.number}?`)) return;
    try { await call('deleteCheque', { id: row.id }); await reload(); }
    catch (e) { toast(e.message, 'error'); }
  }
  return { title: 'Cheques', el: list.el, onShow: reload,
    hints: [['Alt+C', 'Create'], ['Alt+M', 'Mature'], ['Alt+D', 'Deposit'], ['Alt+L', 'Clear'], ['Alt+B', 'Bounce'], ['Alt+X', 'Cancel'], ['Ctrl+Delete', 'Delete unposted'], ['Esc', 'Back']],
    onKey(e) {
      if(e.altKey&&e.key==='F2'){e.preventDefault();focusPeriod(from);return true;}
      if(e.key==='F2'){e.preventDefault();to.focus();to.select();return true;}
      if([from,to].includes(e.target)){if(e.key==='Enter'){e.preventDefault();reload();return true;}return false;}
      const operation = operations.find(([key]) => e.code === `Key${key}`);
      if (e.altKey && e.code === 'KeyC') push(chequeForm());
      else if (e.altKey && operation) act(operation[1]);
      else if ((e.ctrlKey || e.metaKey) && e.key === 'Delete') remove();
      else return list.onKey(e);
      e.preventDefault(); return true;
    },
  };
}

function chequeForm() {
  let parties = [], banks = [];
  const direction = h('input', { value: 'IN' });
  const number = h('input', { maxLength: 40 });
  const party = h('input');
  const bank = h('input');
  const amount = h('input');
  const date = h('input', { 'data-date':true, value:showDate(today()) });
  const entryDate = h('input', { 'data-date':true, value:showDate(today()) });
  const narration = h('input', { maxLength: 500 });
  const fields = [direction, number, party, bank, amount, date, entryDate, narration];
  const el = h('section', { class: 'form' }, ...['Direction (IN / OUT)', 'Cheque number', 'Party', 'Our bank', 'Amount', 'Cheque date', 'Entry date', 'Narration'].map((label,i) => labelled(label,fields[i])),
    h('p', { class: 'tip' }, 'Post-dated cheques remain unposted until matured. Received cheques use Cheques in Hand until cleared. Issued cheques credit the bank when posted.'));
  suggest(direction, { items: () => [{ id: 'IN', label: 'IN', hint: 'Received' }, { id: 'OUT', label: 'OUT', hint: 'Issued' }] });
  suggest(party, { items: () => parties,onCreate:masterActions('ledger','Sundry Debtors') }); suggest(bank, { items: () => banks,onCreate:masterActions('ledger','Bank Accounts') });
  async function save() {
    try {
      await call('saveCheque', { direction: direction.value.toUpperCase(), number: number.value,
        partyId: Number(party.dataset.id), bankId: Number(bank.dataset.id), amount: parseMoney(amount.value),
        date: parseDate(date.value), entryDate: parseDate(entryDate.value), narration: narration.value });
      toast('Cheque recorded'); pop();
    } catch (e) { toast(e.message, 'error'); }
  }
  return { title: 'Record cheque', hints: [['Enter', 'Next field'], ['Ctrl+S', 'Save'], ['Esc', 'Back']],
    el,
    async onShow() {
      const ledgers = (await call('ledgers')).map(r => ({ ...r, label: r.name }));
      banks = ledgers.filter(r => r.groupName === 'Bank Accounts'); parties = ledgers.filter(r => !['Bank Accounts','Cash-in-Hand'].includes(r.groupName));
      direction.focus();
    }, onKey: formKeys(fields,save),
  };
}
