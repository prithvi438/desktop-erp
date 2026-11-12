import {reportDate} from './ui.js';
import {h,call,createList,mod,today,showDate,parseDate,money,toast,confirmBox} from './ui.js';
import {activePeriod} from './ui.js';
import {push} from './router.js';
import {invoiceEntry} from './invoice.js';
import {voucherEntry} from './voucher.js';

export const dayBook=()=>transactionRegister();
export function transactionRegister({title='Daybook',types=null,touches=null,create=()=>voucherEntry(),allDates=false}={}){
  let ranged=allDates,request=0,applied=allDates?{from:activePeriod().from,to:reportDate()}:{from:today(),to:today()};
  const from=h('input', { 'data-date':true, value:showDate(today()),'aria-label':'Daybook date',placeholder:'dd-mm-yyyy'});
  const to=h('input', { 'data-date':true, value:showDate(today()),'aria-label':'Daybook to date',placeholder:'dd-mm-yyyy'});
  if(allDates){from.value=showDate(activePeriod().from);to.value=showDate(reportDate());}
  const fromLabel=h('span',{},allDates?'From':'Date'),toField=h('label',{hidden:!ranged},h('span',{},'To'),to);
  const status=h('p',{class:'tip',role:'status'});
  const single=h('button',{onclick:()=>mode(false),'aria-pressed':String(!ranged)},'Single date');
  const range=h('button',{onclick:()=>mode(true),'aria-pressed':String(ranged)},'Date range');
  const list=createList({filter:true,empty:'No transactions in this period.',columns:[
    {label:'Date',get:r=>showDate(r.date)},
    {label:'Type',get:r=>r.type},{label:'No.',get:r=>r.number,cls:'num'},
    {label:'Particulars',get:r=>r.particulars},{label:'Narration',get:r=>r.narration},
    {label:'Amount',get:r=>money(r.amount),cls:'num',format:'money',exportGet:r=>r.amount/100},
  ],onEnter:r=>push(r.document?invoiceEntry({id:r.id}):voucherEntry({id:r.id}))});
  list.setExportContext(()=>({title,subtitle:status.textContent,units:'Amounts in INR'}));
  list.el.querySelector('input').setAttribute('aria-label',`Search ${title.toLowerCase()} transactions`);
  const filters=h('div',{class:'daybook-filters'},h('div',{class:'daybook-modes'},single,range,h('button',{onclick:()=>{mode(true);from.value=to.value='';apply();}},'All dates')),h('label',{},fromLabel,from),toField,h('button',{onclick:()=>apply()},'Apply · Enter'));
  const el=h('section',{class:'daybook transaction-register'},title==='Daybook'?null:h('h2',{},title),filters,status,list.el);
  function mode(value){ranged=value;toField.hidden=!ranged;fromLabel.textContent=ranged?'From':'Date';if(!ranged&&!from.value)from.value=showDate(today());from.setAttribute('aria-label',ranged?'Daybook from date':'Daybook date');single.setAttribute('aria-pressed',String(!ranged));range.setAttribute('aria-pressed',String(ranged));from.focus();from.select();}
  async function reload(){const token=++request;try{const selected=list.current()?.id;const rows=await call('dayBook',{...applied,types,touches});if(token!==request)return;const selectedIndex=rows.findIndex(row=>row.id===selected);list.setRows(rows,selectedIndex>=0?selectedIndex:allDates?'last':0);status.textContent=`${rows.length} transactions · ${!applied.from&&!applied.to?'All dates':applied.from===applied.to?showDate(applied.from):`${applied.from?showDate(applied.from):'First entry'} to ${applied.to?showDate(applied.to):'Last entry'}`}`;}catch(error){if(token===request){status.textContent='Unable to load transactions. Press Ctrl+R to retry.';toast(error.message,'error');}}}
  async function apply(){const start=from.value.trim()?parseDate(from.value):undefined,end=ranged?(to.value.trim()?parseDate(to.value):undefined):start;
    if(start===null||end===null||(!ranged&&!start)||(start&&end&&start>end)){toast('Enter valid dates (dd-mm-yyyy), with From on or before To.','error');(!start?from:to).focus();return;}
    if(start)from.value=showDate(start);if(end)to.value=showDate(end);applied={...(start?{from:start}:{}),...(end?{to:end}:{})};await reload();list.focus();
  }
  async function remove(){const row=list.current();if(!row||!await confirmBox(`Delete ${row.type} No. ${row.number}?`))return;try{await call('deleteVoucher',{id:row.id});await reload();}catch(error){toast(error.message,'error');}}
  return {title,el,focus:()=>list.focus(),hints:[['F2','Single date'],['Alt+F2','Date range'],['Ctrl+R','Refresh'],['Enter','Open voucher'],...(create?[['Alt+C','New voucher']]:[]),['Alt+D','Delete'],['Alt+E','Excel / PDF'],['Esc','Back']],
    async onShow(){await reload();list.focus();},
    onKey(event){if(event.altKey&&event.code==='KeyE')return list.onKey(event);if(event.altKey&&event.key==='F2')mode(true);else if(event.key==='F2')mode(false);
      else if(mod(event)&&event.code==='KeyR')apply();
      else if(event.key==='Enter'&&(event.target===from||event.target===to))apply();
      else if(event.altKey&&event.code==='KeyC'&&create)push(create());
      else if(event.altKey&&event.code==='KeyD')remove();
      else if(filters.contains(event.target))return false;
      else return list.onKey(event);
      event.preventDefault();return true;
    }};
}
