import {reportDate} from './ui.js';
import {focusPeriod} from './ui.js';
import {typeToSearch,h,call,createList,money,drcr,showQty,showDate,parseDate,toast,mod} from './ui.js';
import {push} from './router.js';
import {invoiceEntry} from './invoice.js';
import {voucherEntry} from './voucher.js';
import {dateModes} from './date-modes.js';
import {activePeriod,today} from './ui.js';

export function accountBooks({mode='accounts',selectedId=null,pickerOnly=false,period=null}={}){
  period=period||{from:activePeriod().from,to:reportDate()};
  pickerOnly=pickerOnly||selectedId===null;
  const dedicated=!pickerOnly;
  let records=[],selected=null,detail=null,request=0,loadRequest=0;
  const direct=selectedId!==null;
  const from=h('input',{'aria-label':'From date',placeholder:'First entry'}),to=h('input',{'aria-label':'To date',placeholder:'Last entry'});
  if(period?.from)from.value=showDate(period.from);
  if(period?.to)to.value=showDate(period.to);
  const heading=h('h2'),subheading=h('p',{class:'tip'}),cards=h('div',{class:'account-totals'}),content=h('div',{class:'account-entries'}),status=h('p',{class:'tip account-status'});
  const list=createList({filter:true,empty:'No matching accounts or items.',columns:[{label:mode==='accounts'?'Ledger':'Stock item',get:row=>row.name},{label:mode==='accounts'?'Balance':'Stock',cls:'num',get:row=>mode==='accounts'?drcr(row.balance)||'0.00':`${showQty(row.stock)} ${row.unit}`}],onEnter:row=>{if(pickerOnly){selectedId=row.id;push(accountBooks({mode,selectedId:row.id,dedicated:true}));}else open(row,true);}});
  list.el.querySelector('input').setAttribute('aria-label','Search accounts or stock');
  const rail=h('aside',{class:'account-picker'},h('h2',{},mode==='accounts'?'Ledger Register':'Stock Register'),list.el,h('p',{class:'tip'},'Type to search · ↑ ↓ Select · Enter Open'));
  const body=h('div',{class:'account-book-body'},h('div',{class:'account-book-heading'},h('div',{},heading,subheading),h('div',{class:'account-period'},h('label',{},h('span',{},'From'),from),h('label',{},h('span',{},'To'),to),h('button',{onclick:()=>reload()},'Apply · Ctrl+R'))),cards,content,status);
  const el=h('section',{class:pickerOnly?'account-books register-master-list':'account-books dedicated-ledger'},dedicated?null:rail,pickerOnly?null:body);
  body.querySelector('.account-period').prepend(dateModes(from,to,()=>reload()));
  function card(label,value){return h('div',{},h('span',{},label),h('strong',{},value));}
  function dates(){const start=from.value.trim()?parseDate(from.value):undefined,end=to.value.trim()?parseDate(to.value):undefined;if(start===null||end===null||(start&&end&&start>end))throw Error('Choose a valid date range (dd-mm-yyyy), with From on or before To. Leave dates blank for all entries.');return {...(start?{from:start}:{}),...(end?{to:end}:{})};}
  async function open(row,focusEntries=false){
    if(!row)return;const previous=selected?.id===row.id?detail?.current():null;const token=++request;selected=row;selectedId=row.id;
    heading.textContent=row.name;subheading.textContent=mode==='accounts'?row.groupName:`Stock ledger · Base unit: ${row.unit}`;
    content.replaceChildren(h('p',{class:'empty'},'Loading entries…'));cards.replaceChildren();detail=null;
    try{
      const range=dates(),data=await call(mode==='accounts'?'ledgerStatement':'stockLedger',{...range,...(mode==='accounts'?{ledgerId:row.id}:{itemId:row.id})});
      if(token!==request)return;
      let running=data.opening;const isStock=mode==='stock',value=entry=>isStock?entry.qty:entry.amount;
      const debit=data.rows.reduce((sum,entry)=>sum+Math.max(0,value(entry)),0),credit=data.rows.reduce((sum,entry)=>sum+Math.max(0,-value(entry)),0);
      const format=number=>isStock?`${showQty(number)} ${data.item.unit}`:drcr(number)||'0.00';
      cards.replaceChildren(card('Opening balance',format(data.opening)),card(isStock?'Stock in':'Total debit',isStock?format(debit):money(debit)),card(isStock?'Stock out':'Total credit',isStock?format(credit):money(credit)),card('Closing balance',format(data.closing)));
      const columns=[{label:'Date',get:r=>r.date?showDate(r.date):''},{label:'Voucher',get:r=>r.voucherId?`${r.type} ${r.number}`:''},
        {label:isStock?'Party / particulars':'Particulars',get:r=>r.label||(isStock?[r.party,r.batch&&`Batch ${r.batch}`,r.description||r.narration].filter(Boolean).join(' · '):[r.particulars,r.narration].filter(Boolean).join(' · '))||''},
        ...(isStock?[{label:'Quantity @ rate',get:r=>r.voucherId?`${showQty(r.enteredQty)} ${r.enteredUnit} @ ${money(r.enteredRate)}`:''}]:[]),
        {label:isStock?'Stock in':'Debit',cls:'num',format:isStock?'text':'money',exportGet:r=>r.in==null?'':r.in/(isStock?1000:100),get:r=>r.in?isStock?showQty(r.in):money(r.in):''},
        {label:isStock?'Stock out':'Credit',cls:'num',format:isStock?'text':'money',exportGet:r=>r.out==null?'':r.out/(isStock?1000:100),get:r=>r.out?isStock?showQty(r.out):money(r.out):''},
        {label:'Balance',cls:'num',get:r=>format(r.running)}];
      detail=createList({columns,filter:dedicated,empty:'No entries in this period.',onEnter:entry=>{if(entry.voucherId)push(isStock||entry.document?invoiceEntry({id:entry.voucherId}):voucherEntry({id:entry.voucherId}));}});
      if(dedicated){const search=detail.el.querySelector('input');search.placeholder='Search entries by date, voucher or particulars';search.setAttribute('aria-label',isStock?'Search stock entries':'Search ledger entries');detail.el.querySelector('.scroll').tabIndex=0;}
      const rows=[{kind:'head',label:'Opening balance',running},...data.rows.map(entry=>({...entry,in:Math.max(0,value(entry)),out:Math.max(0,-value(entry)),running:(running+=value(entry))})),{kind:'total',label:'Closing balance',running:data.closing}];
      content.replaceChildren(detail.el);const previousIndex=previous?.voucherId?rows.findIndex(entry=>entry.voucherId===previous.voucherId&&entry.line===previous.line):-1;detail.setRows(rows,previousIndex>=0?previousIndex:data.rows.length?1:0);
      const period=!range.from&&!range.to?'All dates':`${range.from?showDate(range.from):'First entry'} to ${range.to?showDate(range.to):'Last entry'}`;
      detail.setExportContext(()=>({title:(isStock?'Stock ledger: ':'Ledger account: ')+row.name,subtitle:period,units:isStock?'Quantities in '+data.item.unit+'; rates in INR':'Amounts in INR; Dr = debit, Cr = credit'}));
      status.textContent=`${data.rows.length} entries · ${period} · Enter: open voucher`+(isStock?' · Equivalent closing stock: '+data.units.map(unit=>`${showQty(data.closing/unit.multiplier)} ${unit.symbol}`).join(' = '):' · Dr = debit balance, Cr = credit balance');
      if(focusEntries)detail.focus();
    }catch(error){if(token!==request)return;content.replaceChildren(h('p',{class:'empty'},error.message));status.textContent='Correct the dates or press Ctrl+R to retry.';toast(error.message,'error');}
  }
  async function reload(){if(selected)await open(selected);}
  async function loadRecords(){
    const token=++loadRequest,next=await call(mode==='accounts'?'ledgers':'items');if(token!==loadRequest)return;
    records=next;list.setRows(records,Math.max(0,records.findIndex(row=>row.id===selectedId)));
    if(pickerOnly)return;
    const row=records.find(r=>r.id===selectedId)||(!dedicated&&records[0]);
    if(row)await open(row);else{selected=null;selectedId=null;heading.textContent=mode==='accounts'?'Account ledgers':'Stock ledgers';subheading.textContent='Create masters to begin.';cards.replaceChildren();content.replaceChildren(h('p',{class:'empty'},'No records yet.'));status.textContent='';detail=null;}
  }
  const screen={title:pickerOnly?(mode==='accounts'?'Ledger Register':'Stock Register'):(mode==='accounts'?'Ledger account':'Stock ledger'),el,focus:()=>list.focus(),hints:[...(!pickerOnly?[['Alt+F2','Period'],['F2','To date']]:[]),['Ctrl+L',dedicated?'Search entries':'Find account / item'],['Alt+L','Entries'],['↑ ↓ / PgUp PgDn','Navigate'],['Enter',pickerOnly?'Open statement':'Open voucher'],['Alt+E','Excel / PDF'],['Esc','Back']],
    async onShow(returning){await loadRecords();if((returning||direct)&&detail){detail.focus();if(returning)screen.focused=detail.el.querySelector('.scroll');}else list.focus();},
    onKey(event){
      if(pickerOnly){if(mod(event)&&event.code==='KeyL'){event.preventDefault();list.focus();return true;}return list.onKey(event);}
      if(event.altKey&&event.key==='F2'){focusPeriod(from);}else if(event.key==='F2'){to.focus();to.select();}
      else if(mod(event)&&event.code==='KeyL'){if(dedicated)detail?.focus();else list.focus();}else if(mod(event)&&event.code==='KeyR')reload();
      else if(event.altKey&&event.code==='KeyL')detail?.el.querySelector('.scroll').focus();else if(event.altKey&&['KeyX','KeyE'].includes(event.code)){if(detail)return detail.onKey(event);}
      else if(event.target===from||event.target===to){if(event.key==='Enter')reload();else return false;}
      else if(rail.contains(event.target)){if(event.key==='Tab'&&!event.shiftKey){event.preventDefault();detail?.focus();return true;}return list.onKey(event);}
      else if(content.contains(event.target)){if(!dedicated&&event.key==='Tab'){event.preventDefault();list.focus();return true;}if(!dedicated&&typeToSearch(event,list.el.querySelector('input')))return true;return detail?.onKey(event)||false;}
      else return false;
      event.preventDefault();return true;
    }};
  return screen;
}
