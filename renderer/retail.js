import {reportDate} from './ui.js';
import {focusPeriod} from './ui.js';
import {activePeriod} from './ui.js';
import {yesNo} from './yes-no.js';
import {exportReport,reportCell,typeToSearch,h,call,money,plain,signed,showQty,showDate,today,parseDate,parseMoney,mod,focus,labelled,toast,confirmBox,picker} from './ui.js';
import {push,pop} from './router.js';
import {rowPages,pageMasterForm} from './keyboard-pages.js';
import {invoiceEntry} from './invoice.js';
import {dateModes} from './date-modes.js';

// Paginated lists share the maintenance table styles and fit the available pane.
function pagedList(columns,onEnter){
  let rows=[],shown=[],index=0,resize,exportContext={};
  const search=h('input',{placeholder:'Search records'}),body=h('tbody'),empty=h('p',{class:'empty'},'No records match this view.');
  const result=h('div',{class:'manage-results',tabIndex:0},h('table',{},h('thead',{},h('tr',{},...columns.map(c=>h('th',{},c.label)))),body),empty);
  const count=h('span'),prev=h('button',{onclick:()=>select(index-size())},'PgUp'),next=h('button',{onclick:()=>select(index+size())},'PgDn');
  const exportRows=()=>safe(async()=>{await exportReport({title:document.querySelector('#title')?.textContent||'Report',subtitle:(exportContext.subtitle||'')+' | '+[...document.querySelectorAll('.retail-summary')].map(el=>el.textContent).join(' | ')+(search.value?' | Filter: '+search.value:''),columns:columns.map(c=>c.label),formats:columns.map(c=>c.num?'money':'text'),rows:shown.map(r=>columns.map(c=>reportCell(c.get(r),c.num))),kinds:shown.map(r=>r.kind||'')});});
  const el=h('div',{class:'retail-list'},search,result,h('div',{class:'manage-pagination'},count,h('button',{onclick:exportRows},'Export · Alt+E'),prev,next));
  const size=()=>Math.max(1,Math.floor((result.clientHeight-36)/34));
  function draw(){const n=size(),start=Math.floor(index/n)*n;
    body.replaceChildren(...shown.slice(start,start+n).map((row,at)=>h('tr',{class:start+at===index?'on':'',onclick:()=>{select(start+at);result.focus();},ondblclick:()=>onEnter?.(row)},...columns.map(c=>{const text=String(c.get(row)??'');return h('td',{title:text,class:c.num?'num':''},text);})))) ;
    empty.hidden=!!shown.length;result.querySelector('table').hidden=!shown.length;
    count.textContent=`${shown.length} records · ${shown.length?start+1:0}–${Math.min(start+n,shown.length)}`;
    prev.disabled=start===0;next.disabled=start+n>=shown.length;
  }
  function select(at){index=Math.max(0,Math.min(shown.length-1,at));draw();}
  function filter(){const text=search.value.toLowerCase();shown=rows.filter(row=>columns.map(c=>c.get(row)).join(' ').toLowerCase().includes(text));select(0);}
  search.addEventListener('input',filter);
  return {el,setExportContext(value){exportContext=value;},setRows(value){const old=shown[index]?.id;rows=value;filter();const at=shown.findIndex(r=>r.id===old);if(at>=0)select(at);},current:()=>shown[index],
    show(){if(!resize){resize=new ResizeObserver(draw);resize.observe(result);}draw();search.focus();},close(){resize?.disconnect();resize=null;},
    onKey(e){if(typeToSearch(e,search))return true;if(e.altKey&&['KeyE','KeyX'].includes(e.code)){e.preventDefault();exportRows();return true;}if(mod(e)&&e.code==='KeyF'){e.preventDefault();focus(search);return true;}
      const step={ArrowDown:1,ArrowUp:-1,PageDown:size(),PageUp:-size()}[e.key];
      if(step)select(index+step);else if(e.key==='Enter'&&shown[index])onEnter?.(shown[index]);else return false;e.preventDefault();return true;}}
}
const number=(label,key)=>({label,num:true,get:r=>signed(r[key])});
const date=(label,key)=>({label,get:r=>showDate(r[key])});
const field=(label,key)=>({label,get:r=>r[key]});
const safe=async work=>{try{return await work();}catch(e){toast(e.message,'error');}};

export function retailControls(){
  let original='',loaded=false;
  const lock=h('input',{placeholder:'Blank = unlocked','data-date':true}),expiry=yesNo();
  const values=()=>({lockedThrough:lock.value.trim()?parseDate(lock.value):'',blockExpiredSales:expiry.checked});
  const el=h('section',{class:'form master-form'},h('h2',{},'Retail controls'),
    h('fieldset',{class:'master-group'},h('legend',{},'Period & stock protection'),labelled('Lock transactions through (dd-mm-yyyy)',lock),labelled('Block sales of expired batches',expiry),h('p',{class:'tip'},'A locked period blocks creating, changing or deleting vouchers and bill settlements, including incoming sync changes. Empty lock date leaves all periods open.')),
    h('button',{onclick:()=>save()},'Save controls · Ctrl+S'));
  pageMasterForm(el);
  async function save(){await safe(async()=>{if(lock.value.trim()&&!values().lockedThrough)throw Error('Enter a valid lock date');const data=values();await call('saveRetailControls',data);original=JSON.stringify(data);toast('Retail controls saved');});}
  const canLeave=()=>JSON.stringify(values())===original||confirmBox('Leave without saving retail controls?');
  return {title:'Retail controls',el,canLeave,hints:[['Ctrl+S','Save'],['Tab','Next field'],['Esc','Back']],
    async onShow(){if(!loaded){const data=await call('retailControls');lock.value=data.lockedThrough?showDate(data.lockedThrough):'';expiry.checked=data.blockExpiredSales;original=JSON.stringify(values());loaded=true;}lock.focus();},
    onKey(e){if(mod(e)&&e.code==='KeyS')save();else if(e.key==='Escape')Promise.resolve(canLeave()).then(ok=>{if(ok)pop();});else return false;e.preventDefault();return true;}};
}

export function backupScreen(){
  let busy=false;const result=h('p',{class:'tip'});
  const save=h('button',{onclick:()=>run(false)},'Back up local books · Alt+B'),restore=h('button',{onclick:()=>run(true)},'Restore backup · Alt+R');
  const el=h('section',{class:'retail-screen'},h('h2',{},'Backup & restore'),h('p',{},'Back up the selected company: all financial years, books, settings, pricing, settlements and attachments. Other companies are backed up separately.'),h('div',{class:'retail-toolbar'},save,restore),h('p',{class:'tip'},'Restore replaces current books after confirmation and creates a safety backup first. Sync credentials are not included; restored books must be linked again.'),result);
  async function run(isRestore){if(busy)return;busy=true;save.disabled=restore.disabled=true;try{const out=await window.files.call(isRestore?'restore':'backup');if(out.restored){location.reload();return;}result.textContent=out.saved?`Backup saved: ${out.file}`:'Cancelled.';}catch(error){toast(error.message,'error');}finally{busy=false;save.disabled=restore.disabled=false;}}
  return {title:'Backup & restore',el,canLeave:()=>!busy,hints:[['Alt+B','Back up'],['Alt+R','Restore'],['Esc','Back']],onShow(){save.focus();},onKey(e){if(e.altKey&&e.code==='KeyB')run(false);else if(e.altKey&&e.code==='KeyR')run(true);else return false;e.preventDefault();return true;}};
}

export function outstandingScreen(){
  let party=null,credit=false,report=null;
  const from=h('input',{placeholder:'First voucher','aria-label':'Voucher from date'}),to=h('input',{placeholder:'Last voucher','aria-label':'Voucher to date'});
  const asOf=h('input', { 'data-date':true, value:showDate(reportDate()),'aria-label':'As of date'}),summary=h('p',{class:'retail-summary'});
  const pick=h('button',{onclick:()=>choose()},'Choose party · Alt+P'),mode=h('button',{onclick:()=>toggle()},'Show receipts / payments · Alt+T');
  const list=pagedList([field('Voucher','reference'),date('Due / date','displayDate'),number('Amount','amount'),number('Unmatched','remaining')],row=>{if(credit)push(allocationForm(row.id,party.id));else toast('Switch to receipts / payments (Alt+T) to allocate a payment against bills.');});
  const el=h('section',{class:'retail-screen'},h('div',{class:'retail-toolbar'},pick,mode,asOf,h('button',{onclick:()=>refresh()},'Refresh · Alt+R')),summary,list.el);
  list.el.before(h('div',{class:'daybook-filters'},dateModes(from,to,refresh),h('label',{},'Voucher from ',from),h('label',{},'To ',to),h('button',{onclick:refresh},'Apply')));
  async function choose(){await safe(async()=>{const rows=(await call('ledgers')).filter(r=>['Sundry Debtors','Sundry Creditors'].includes(r.accountGroup));const selected=await picker('Choose customer or supplier',rows.map(r=>({...r,label:r.name,hint:r.accountGroup})));if(selected){party=selected;await refresh();}});}
  async function refresh(){await safe(async()=>{if(!party){summary.textContent='Choose a customer or supplier to view bills and match receipts/payments.';list.setRows([]);return;}const date=parseDate(asOf.value);if(!date)throw Error('Enter a valid as-of date');report=await call('outstandingBills',{partyId:party.id,asOf:date});
    pick.textContent=`${party.name} · Alt+P`;
    summary.textContent=`Bills ${money(report.pending)} · Unmatched credits ${money(report.onAccount)} · Opening ${signed(report.opening)} · Net ${signed(report.net)}`;
    const start=from.value.trim()?parseDate(from.value):undefined,end=to.value.trim()?parseDate(to.value):undefined;
    if(start===null||end===null||(start&&end&&start>end))throw Error('Enter valid voucher dates, with From on or before To.');
    list.setRows((credit?report.credits:report.bills).filter(row=>(!start||row.date>=start)&&(!end||row.date<=end)).map(row=>({...row,reference:`${row.type} ${row.number}`,displayDate:credit?row.date:row.dueDate})));
    list.setExportContext({subtitle:party.name+' | As at '+showDate(date)+' | Voucher dates: '+(start?showDate(start):'First entry')+' to '+(end?showDate(end):'Last entry')});
    summary.textContent+=' · Party balances as of '+showDate(date)+'; list filtered by voucher date';
    mode.textContent=credit?'Show bills · Alt+T':'Show receipts / payments · Alt+T';});}
  async function toggle(){credit=!credit;await refresh();list.show();}
  return {title:'Outstanding bills',el,hints:[['F2','As of date'],['Alt+F2','Voucher period'],['Alt+P','Party'],['Alt+T','Bills / payments'],['Enter','Allocate payment'],['Alt+R','Refresh'],['Ctrl+F','Filter'],['PgUp / PgDn','Page'],['Alt+E','Excel / PDF']],
    async onShow(){await refresh();list.show();},onClose:list.close,
    onKey(e){if(e.altKey&&e.key==='F2'){e.preventDefault();focusPeriod(from);return true;}if(e.key==='F2'){e.preventDefault();focus(asOf);return true;}if(e.altKey&&e.code==='KeyE')return list.onKey(e);if(e.altKey&&e.code==='KeyP')choose();else if(e.altKey&&e.code==='KeyT')toggle();else if(e.altKey&&e.code==='KeyR')refresh();else if([asOf,from,to].includes(e.target)){if(e.key==='Enter')refresh();else return false;}else return list.onKey(e);e.preventDefault();return true;}};
}

export function allocationForm(paymentId,partyId){
  let rows=[],dirty=false,loaded=false,data;
  const body=h('tbody'),total=h('p',{class:'retail-summary'}),name=h('h2');
  const pages=rowPages(body,{size:()=>innerHeight<660?3:5,label:'Bills'});
  const el=h('section',{class:'retail-screen allocation-form'},name,h('p',{class:'tip'},'Enter amounts against bills. Unallocated payment remains on account. Allocations stay local and do not create duplicate postings.'),
    h('table',{},h('thead',{},h('tr',{},...['Bill','Due date','Available','Allocate'].map(text=>h('th',{},text)))),body),pages.el,total,
    h('div',{class:'retail-toolbar'},h('button',{onclick:auto},'Oldest bills first · Alt+A'),h('button',{onclick:clear},'Clear · Alt+C'),h('button',{onclick:save},'Save · Ctrl+S')));
  function recalc(){const sum=rows.reduce((s,r)=>s+(parseMoney(r.input.value)||0),0);total.textContent=`Payment ${money(data.payment.amount)} · Allocated ${money(sum)} · On account ${signed(data.payment.amount-sum)}`;}
  function auto(){let left=data.payment.amount;for(const r of rows){const value=Math.min(left,r.available);r.input.value=value?plain(value):'';left-=value;}dirty=true;recalc();}
  function clear(){rows.forEach(r=>r.input.value='');dirty=true;recalc();}
  async function save(){await safe(async()=>{const allocations=rows.filter(r=>r.input.value.trim()).map(r=>({billId:r.id,amount:parseMoney(r.input.value)}));await call('saveAllocations',{paymentId,partyId,allocations});dirty=false;toast('Bill settlements saved');pop();});}
  const canLeave=()=>!dirty||confirmBox('Leave without saving bill settlements?');
  return {title:'Allocate bills',el,canLeave,hints:[['Tab / Enter','Next bill'],['Alt+A','Oldest first'],['Alt+C','Clear'],['PgUp / PgDn','Page'],['Alt+E','Excel / PDF'],['Ctrl+S','Save'],['Esc','Back']],
    async onShow(){if(!loaded){data=await call('allocationOptions',{paymentId,partyId});name.textContent=`${data.party.name} · ${data.payment.type} ${data.payment.number}`;
      rows=data.bills.map(b=>{const input=h('input',{class:'num',value:b.allocated?plain(b.allocated):'','aria-label':`${b.type} ${b.number} allocation`});return {...b,available:b.remaining+b.allocated,input};});
      body.replaceChildren(...rows.map(r=>h('tr',{},h('td',{},`${r.type} ${r.number}`),h('td',{},showDate(r.dueDate)),h('td',{class:'num'},money(r.available)),h('td',{},r.input))));
      body.addEventListener('input',()=>{dirty=true;recalc();});loaded=true;recalc();pages.refresh();}focus(rows[0]?.input||el.querySelector('button'));},
    onKey(e){if(mod(e)&&e.code==='KeyS')save();else if(e.altKey&&e.code==='KeyA')auto();else if(e.altKey&&e.code==='KeyC')clear();else if(e.key==='Escape')Promise.resolve(canLeave()).then(ok=>{if(ok)pop();});else if(e.key==='Enter'){const at=rows.findIndex(r=>r.input===e.target);if(rows[at+1])focus(rows[at+1].input);else save();}else return false;e.preventDefault();return true;}};
}

export function purchasePlanning(){
  let rows=[];
  const from=h('input', { 'data-date':true, value:showDate(activePeriod().from),'aria-label':'Planning from date'}),to=h('input', { 'data-date':true, value:showDate(reportDate()),'aria-label':'Planning to date'}),summary=h('p',{class:'retail-summary'});
  const list=pagedList([field('Item','name'),{label:'Stock',get:r=>showQty(r.stock)},{label:'Suggested',get:r=>showQty(r.suggested)},number('Est. cost','cost')],()=>draftOrder(false));
  const el=h('section',{class:'retail-screen'},h('div',{class:'retail-toolbar'},labelled('From',from),labelled('To',to),h('button',{onclick:refresh},'Refresh · Alt+R'),h('button',{onclick:()=>draftOrder(true)},'Draft all shortages · Alt+O')),h('p',{class:'tip'},'Target = higher of reorder level and net units sold during the period. Review pending orders before saving a new order.'),summary,list.el);
  async function refresh(){await safe(async()=>{const start=parseDate(from.value),end=parseDate(to.value);if(!start||!end||start>end)throw Error('Enter a valid planning period');rows=(await call('purchasePlan',{from:start,asOf:end})).filter(r=>r.suggested>0);list.setExportContext({subtitle:'Demand window: '+showDate(start)+' to '+showDate(end)});list.setRows(rows);summary.textContent=`${rows.length} shortages · Estimated purchase cost ${money(rows.reduce((s,r)=>s+r.cost,0))}`;});}
  async function draftOrder(all){await safe(async()=>{const selected=all?rows:[list.current()].filter(Boolean);if(!selected.length)return;const suppliers=(await call('ledgers')).filter(r=>r.accountGroup==='Sundry Creditors');const supplier=await picker('Choose supplier for this purchase order',suppliers.map(r=>({...r,label:r.name})));if(supplier)await push(invoiceEntry({type:'Purchase Order',draft:{partyId:supplier.id,items:selected.map(r=>({itemId:r.id,qty:r.suggested,rate:r.purchaseRate}))}}));});}
  return {title:'Purchase planning',el,hints:[['F2','To date'],['Alt+F2','Period'],['Enter','Draft selected item'],['Alt+O','Draft all shortages'],['Alt+R','Refresh'],['Ctrl+F','Filter'],['PgUp / PgDn','Page'],['Alt+E','Excel / PDF']],async onShow(){await refresh();list.show();},onClose:list.close,
    onKey(e){if(e.altKey&&e.code==='KeyE')return list.onKey(e);if(e.altKey&&e.key==='F2'){focusPeriod(from);}else if(e.key==='F2'){focus(to);}else if(e.altKey&&e.code==='KeyO')draftOrder(true);else if(e.altKey&&e.code==='KeyR')refresh();else if(e.target===from||e.target===to){if(e.key==='Enter')refresh();else return false;}else return list.onKey(e);e.preventDefault();return true;}};
}

export function salesAnalysis(){
  const end=reportDate(),from=h('input', { 'data-date':true, value:showDate(activePeriod().from),'aria-label':'From date'}),to=h('input', { 'data-date':true, value:showDate(end),'aria-label':'To date'});
  const by=h('select',{},...['item','party','month','category','brand'].map(value=>h('option',{value},value[0].toUpperCase()+value.slice(1))));
  const list=pagedList([field('Group','name'),number('Sales','sales'),number('Returns','returns'),number('Net value','net'),number('Discount','discount')]);
  const el=h('section',{class:'retail-screen'},h('div',{class:'retail-toolbar'},from,to,by,h('button',{onclick:refresh},'Refresh · Alt+R')),h('p',{class:'tip'},'Item values before GST and extra ledger charges. Returns reduce net sales. Ledger-only invoices are not included.'),list.el);
  el.querySelector('.retail-toolbar').prepend(dateModes(from,to,refresh,{all:false}));
  async function refresh(){await safe(async()=>{const start=parseDate(from.value),end=parseDate(to.value),grouping=by.value;list.setRows(await call('salesAnalysis',{from:start,to:end,by:grouping}));list.setExportContext({subtitle:showDate(start)+' to '+showDate(end)+' | Grouped by '+grouping});});}
  by.addEventListener('change',refresh);
  return {title:'Sales analysis',el,hints:[['F2','To date'],['Alt+F2','Period'],['Alt+R','Refresh'],['Tab','Dates / grouping'],['Ctrl+F','Filter'],['PgUp / PgDn','Page'],['Alt+E','Excel / PDF']],async onShow(){await refresh();list.show();},onClose:list.close,
    onKey(e){if(e.altKey&&e.key==='F2'){e.preventDefault();focusPeriod(from);return true;}if(e.key==='F2'){e.preventDefault();focus(to);return true;}if(e.altKey&&e.code==='KeyE')return list.onKey(e);if(e.altKey&&e.code==='KeyR')refresh();else if([from,to,by].includes(e.target)){if(e.key==='Enter')refresh();else return false;}else return list.onKey(e);e.preventDefault();return true;}};
}
