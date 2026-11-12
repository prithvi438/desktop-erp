import {inlineMaster,bindInlineMaster} from './inline-master.js';
import {bookForm} from './pricebooks.js';
import { h, call, drcr, plain, parseMoney, suggest, sideInput, toast, formKeys, labelled, confirmBox, mod, focus } from './ui.js';
import { recordExtras } from './details.js';
import { pageMasterForm } from './keyboard-pages.js';
import { pop, push } from './router.js';
import {accountBooks} from './account-books.js';
import { masterList } from './masters.js';

const asOptions = (groups) => groups.map((row) => ({ id: row.id, label: row.name, hint: row.nature }));

// group: list only the ledgers directly under that group (customers, suppliers, bank accounts).
export const ledgerList = ({ title = 'Ledgers', group = null } = {}) => masterList({
  title,
  noun: 'ledger',
  empty: 'Nothing here yet. Press Alt+C to create one.',
  columns: [
    { label: 'Name', get: (row) => row.name },
    group ? { label: 'Phone', get: (row) => row.phone } : { label: 'Under', get: (row) => row.groupName },
    { label: 'GSTIN', get: (row) => row.gstin },
    { label: 'Balance', cls: 'num', get: (row) => drcr(row.balance) },
  ],
  load: () => call('ledgers', { group }),
  form: (row) => ledgerForm(row, group),
  remove: (row) => call('deleteLedger', { id: row.id }),
});

// underGroup: the group a new ledger starts under.
export function ledgerForm(ledger = null, underGroup = null, onSaved = null) {
  let dirty=false,openingRows=[],sideChosen=Boolean(ledger);
  let groups = [];
  let groupRows=[];
  const input = (cls, value = '', maxLength = 100) => h('input', { class: cls, value, maxLength });
  const name = input('wide', ledger?.name);
  const group = input('wide', ledger?.groupName);
  if (ledger) group.dataset.id = ledger.groupId;
  const opening = input('num', ledger?.opening ? plain(ledger.opening) : '');
  const side = sideInput(ledger && ledger.opening < 0 ? 'Cr' : 'Dr');
  side.addEventListener('change',()=>{sideChosen=true;});
  const openingStatus=h('p',{class:'tip opening-status',role:'status'});
  function previewOpening(){const amount=parseMoney(opening.value)||0,total=openingRows.filter(r=>r.id!==ledger?.id).reduce((n,r)=>n+r.opening,0)+(side.value==='Cr'?-amount:amount);openingStatus.textContent=total?'Opening balances after this change: '+drcr(total)+' unmatched. Enter the corresponding opening balance in its ledger.':'Opening debit and credit balances agree.';}
  opening.addEventListener('input',previewOpening);side.addEventListener('input',previewOpening);side.addEventListener('change',previewOpening);
  const gstin = input('wide', ledger?.gstin, 15);
  const state = input('wide', ledger?.state, 40);
  const phone = input('wide', ledger?.phone, 20);
  const creditDays = input('num', ledger?.creditDays ? String(ledger.creditDays) : '', 4);
  const creditLimit=input('num',ledger?.creditLimit?plain(ledger.creditLimit):'');
  const stopSales=h('input',{type:'checkbox',checked:Boolean(ledger?.stopSales)}),blockOverdue=h('input',{type:'checkbox',checked:Boolean(ledger?.blockOverdue)});
  const pricebook=h('select',{},h('option',{value:''},'Default prices'));
  const bookActions=inlineMaster((done,row)=>bookForm(row,done),()=>call('pricebooks'));
  const pickBook=row=>{let option=[...pricebook.options].find(option=>option.value===String(row.id));if(!option){option=h('option',{value:row.id});pricebook.append(option);}option.textContent=row.name;pricebook.value=String(row.id);pricebook.dispatchEvent(new Event('change',{bubbles:true}));pricebook.focus();};
  bindInlineMaster(pricebook,()=>bookActions(pickBook),async()=>{const row=(await call('pricebooks')).find(row=>row.id===Number(pricebook.value));if(row)bookActions.edit(row,pickBook);else toast('Select a pricebook to edit first','error');});
  const address=input('wide','',5000),email=input('wide','',254);
  const bankName=input('wide'),accountNumber=input('wide'),accountHolder=input('wide'),branch=input('wide'),ifsc=input('wide','',20);
  const extras=recordExtras('ledger',()=>{dirty=true;},{fields:{address,email,bankName,accountNumber,accountHolder,branch,ifsc}});

  const customerControls=h('div',{class:'ledger-customer-controls'},labelled('Credit limit',creditLimit),labelled('Stop sales',stopSales),labelled('Stop sales when bills are overdue',blockOverdue),labelled('Pricebook',pricebook));
  const billing=h('details',{class:'ledger-billing'},h('summary',{},'Credit & billing options · Alt+B'),
    h('div',{class:'ledger-billing-fields'},labelled('Credit days',creditDays),customerControls));
  const partyLegend=h('legend');
  const partyFields=h('fieldset',{class:'master-group ledger-party'},partyLegend,labelled('Address',address),labelled('Email',email),labelled('Phone',phone),labelled('GSTIN',gstin),labelled('State',state));
  const bankFields=h('fieldset',{class:'master-group ledger-bank'},h('legend',{},'Bank details'),labelled('Bank name',bankName),labelled('Account holder',accountHolder),labelled('Account number',accountNumber),labelled('Branch',branch),labelled('IFSC',ifsc));
  const kindHint=h('p',{class:'tip ledger-kind'});
  const el = h('section', { class: 'form master-form ledger-compact' },
    h('div',{class:'ledger-heading'},h('h2',{},`${ledger?'Alter':'Create'} ledger`),h('span',{},'Enter / Tab: next · Shift+Tab: previous')),
    h('div',{class:'ledger-columns'},
      h('fieldset',{class:'master-group'},h('legend',{},'Account'),labelled('Name *', name), labelled('Under group *', group), labelled('Opening balance', opening, side),openingStatus,kindHint),partyFields,bankFields),billing,
    h('div',{class:'ledger-footer'},h('span',{},'Only name and group are required.'),h('button',{onclick:save},'Save · Ctrl+S'),ledger?h('button',{onclick:()=>push(accountBooks({selectedId:ledger.id,dedicated:true}))},'Account entries · F1'):null,h('button',{onclick:()=>canLeave().then(ok=>{if(ok)pop();})},'Cancel · Esc')));
  function updateGroup(){
    if(!sideChosen&&!opening.value){const selected=groupRows.find(r=>String(r.id)===group.dataset.id);side.value=['liability','income'].includes(selected?.nature)?'Cr':'Dr';}previewOpening();
    let row=groupRows.find(row=>String(row.id)===group.dataset.id),kind='general';
    const seen=new Set();
    while(row&&!seen.has(row.id)){
      seen.add(row.id);
      if(row.name==='Sundry Debtors'){kind='customer';break;}
      if(row.name==='Sundry Creditors'){kind='supplier';break;}
      if(['Bank Accounts','Bank OD A/c'].includes(row.name)){kind='bank';break;}
      if(row.name==='Cash-in-Hand'){kind='cash';break;}
      row=groupRows.find(parent=>parent.id===row.parentId);
    }
    const party=['customer','supplier'].includes(kind);
    partyFields.hidden=!party;bankFields.hidden=kind!=='bank';billing.hidden=!party;customerControls.hidden=kind!=='customer';
    partyLegend.textContent=kind==='supplier'?'Supplier · contact & tax':'Customer · contact & tax';
    kindHint.textContent=({customer:'Customer / debtor account',supplier:'Supplier / creditor account',bank:'Bank account',cash:'Cash account · enter cash in hand as opening balance',general:'Choose a group to set the ledger type.'})[kind];
    el.dataset.ledgerKind=kind;
    el.querySelector('.ledger-columns').classList.toggle('ledger-single',!party&&kind!=='bank');
  }
  suggest(group, { items: () => groups, onCreate:inlineMaster((done,row)=>groupForm(row,done),()=>call('groups')), onPick: () => {updateGroup();opening.focus();} });
  group.addEventListener('input',updateGroup);group.addEventListener('change',updateGroup);group.addEventListener('blur',updateGroup);
  updateGroup();
  el.append(extras.el);el.addEventListener('input',()=>{dirty=true;});el.addEventListener('change',()=>{dirty=true;});

  async function save() {
    const amount = opening.value.trim() ? parseMoney(opening.value) : 0;
    if (amount === null) {
      toast('Opening balance is not a valid amount', 'error');
      return opening.focus();
    }
    try {
      const nextOpening=side.value==='Dr'?amount:-amount;
      if(nextOpening!==(ledger?.opening||0)){const current=await call('ledgers'),difference=current.filter(r=>r.id!==ledger?.id).reduce((n,r)=>n+r.opening,0)+nextOpening;if(difference&&!await confirmBox('Opening balances will differ by '+drcr(difference)+'. Save this ledger while you complete the corresponding opening balances?'))return;}
      const result=await call('saveLedger', {
        ...(ledger ? { id: ledger.id } : {}),
        name: name.value,
        groupId: Number(group.dataset.id) || null,
        opening: side.value === 'Dr' ? amount : -amount,
        gstin: gstin.value, state: state.value, phone: phone.value,
        creditDays: Number(creditDays.value.trim() || 0),
        policy:{creditLimit:creditLimit.value.trim()?parseMoney(creditLimit.value):0,stopSales:stopSales.checked,blockOverdue:blockOverdue.checked,pricebookId:Number(pricebook.value)||null},
        details:extras.read(),
      });
      toast(`${name.value.trim()} saved`);
      dirty=false;extras.committed();
      if (onSaved) await onSaved(result); else pop();
    } catch (error) {
      toast(error.message, 'error');
    }
  }

  const canLeave=async()=>{if(dirty&&!await confirmBox('Leave without saving this ledger?'))return false;await extras.discard();return true;};
  const fields=[name,group,opening,side,address,email,phone,gstin,state,bankName,accountHolder,accountNumber,branch,ifsc,creditDays,creditLimit,stopSales,blockOverdue,pricebook];
  const visibleFields=()=>fields.filter(field=>field.getClientRects().length);
  return {
    title: `${ledger ? 'Alter' : 'Create'} ledger`,
    hints: [...(ledger?[['F1','Account entries']]:[]),['Enter / Tab', 'Next field'], ['Alt+B','Billing options'], ['Alt+E','Details'], ['Alt+A','Attachments'], ['Ctrl+S', 'Save'], ['Esc', 'Back']],
    el,canLeave,
    async onShow(returning) {
      if(!returning)await extras.load(ledger?.id);
      if(!returning){pricebook.replaceChildren(h('option',{value:''},'Default prices'),...(await call('pricebooks')).map(book=>h('option',{value:book.id},`${book.name}${book.active?'':' (inactive)'}`)));pricebook.value=String(ledger?.pricebookId||'');}
      openingRows=await call('ledgers');
      groupRows=await call('groups');groups = asOptions(groupRows);
      const start = !returning&&!ledger && groups.find((row) => row.label === underGroup);
      if (start) {
        group.value = start.label;
        group.dataset.id = start.id;
      }
      updateGroup();
      name.focus();
      name.select();
    },
    onKey(e){
      if(e.key==='F1'&&!e.altKey&&!mod(e)&&!e.shiftKey&&ledger){e.preventDefault();push(accountBooks({selectedId:ledger.id,dedicated:true}));return true;}
      if(extras.onKey(e))return true;
      if(e.altKey&&e.code==='KeyB'){e.preventDefault();if(!billing.hidden){billing.open=!billing.open;focus(billing.open?creditDays:name);}return true;}
      if(e.key==='Escape'){e.preventDefault();canLeave().then(ok=>{if(ok)pop();});return true;}
      const visible=visibleFields(),at=visible.indexOf(e.target);
      if(!mod(e)&&!e.altKey&&at>=0&&e.target!==group&&e.target.tagName!=='SELECT'&&['ArrowUp','ArrowDown'].includes(e.key)){
        e.preventDefault();focus(visible[Math.max(0,Math.min(visible.length-1,at+(e.key==='ArrowDown'?1:-1)))]);return true;
      }
      return formKeys(visible,save)(e);
    },
  };
}

export function groupForm(group = null, onSaved = null) {
  let dirty=false;
  let groups = [];
  const name = h('input', { class: 'wide', maxLength: 100, value: group?.name ?? '' });
  const parent = h('input', { class: 'wide' });
  const el = h('section', { class: 'form master-form' },h('div',{class:'master-intro'},h('p',{class:'eyebrow'},'ACCOUNT GROUP'),h('h2',{},group?'Edit account group':'Create account group'),h('p',{class:'tip'},'Organise related ledgers beneath a parent group.')),h('fieldset',{class:'master-group'},h('legend',{},'Group details'), labelled('Group name *', name), labelled('Under', parent)));
  pageMasterForm(el);
  el.addEventListener('input',()=>{dirty=true;});el.addEventListener('change',()=>{dirty=true;});
  suggest(parent, { items: () => groups,onCreate:inlineMaster((done,row)=>groupForm(row,done),()=>call('groups')) });

  async function save() {
    try {
      const result=await call('saveGroup', { ...(group ? { id: group.id } : {}), name: name.value, parentId: Number(parent.dataset.id) || null });
      toast(`Group ${name.value.trim()} saved`);
      dirty=false;
      if (onSaved) await onSaved(result); else pop();
    } catch (error) {
      toast(error.message, 'error');
    }
  }

  const canLeave=()=>!dirty||confirmBox('Leave without saving this group?');
  const keys=formKeys([name,parent],save);
  return {
    title: group ? 'Alter group' : 'Create group',
    hints: [['Enter', 'Next field'], ['Ctrl+S', 'Save'], ['Esc', 'Back']],
    el,canLeave,
    async onShow(returning) {
      groups = asOptions(await call('groups')).filter((row) => row.id !== group?.id);
      const under = groups.find((row) => row.id === group?.parentId);
      if (under&&!returning) {
        parent.value = under.label;
        parent.dataset.id = under.id;
      }
      name.focus();
      name.select();
    },
    onKey(e){if(e.key==='Escape'){e.preventDefault();Promise.resolve(canLeave()).then(ok=>{if(ok)pop();});return true;}return keys(e);},
  };
}
