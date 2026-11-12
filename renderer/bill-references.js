import {h,call,modal,picker,money,plain,parseMoney,showDate,parseDate,toast,mod} from './ui.js';

export async function editBillReferences({partyId,amount,date,voucherId=null,draft=null}){
 const data=await call('referenceOptions',{partyId,amount,date,voucherId});
 return new Promise(resolve=>{
  const rows=[],body=h('tbody'),summary=h('p',{class:'retail-summary'});let close;
  function recalc(){const allocated=rows.reduce((n,r)=>n+(parseMoney(r.amount.value)||0),0);summary.textContent=`Voucher amount ${money(amount)} · Allocated ${money(allocated)} · Remaining ${money(Math.abs(amount)-allocated)}${allocated>Math.abs(amount)?' (over allocated)':''}`;}
  function add(value={}){const row={id:value.id||crypto.randomUUID(),targetId:value.targetId};
   row.mode=h('select',{'aria-label':'Reference type'},...Object.entries({new:'New Ref',against:'Adjust / Against Ref',advance:'Advance',onAccount:'On Account'}).map(([value,label])=>h('option',{value},label)));row.mode.value=value.mode||'new';
   row.name=h('input',{value:value.name||'','aria-label':'Reference name'});row.due=h('input',{value:value.dueDate?showDate(value.dueDate):'','aria-label':'Due date',placeholder:'dd-mm-yyyy'});row.amount=h('input',{class:'num',value:value.amount?plain(value.amount):'','aria-label':'Reference amount'});
   row.target=h('button',{type:'button',onclick:()=>choose(row)},'Select pending reference');
   row.tr=h('tr',{},h('td',{},row.mode),h('td',{},row.name,row.target),h('td',{},row.due),h('td',{},row.amount),h('td',{},h('button',{type:'button',onclick:()=>remove(row)},'Remove')));rows.push(row);body.append(row.tr);
   function changed(){const against=row.mode.value==='against';row.name.hidden=against;row.target.hidden=!against;row.due.disabled=against||row.mode.value==='onAccount';row.name.disabled=row.mode.value==='onAccount';const target=data.pending.find(p=>p.id===row.targetId);row.target.textContent=target?`${target.name} · Pending ${money(target.remaining)}`:'Select pending reference';}
   row.mode.addEventListener('change',changed);row.amount.addEventListener('input',recalc);changed();recalc();return row;
  }
  async function choose(row){const selected=await picker('Pending references',data.pending.map(p=>({id:p.id,label:p.name,hint:`${p.type} ${p.number} · ${p.date?showDate(p.date):'Opening'} · Pending ${money(p.remaining)}`})));if(!selected)return;row.targetId=selected.id;const found=data.pending.find(p=>p.id===selected.id);row.due.value=found.dueDate?showDate(found.dueDate):'';row.target.textContent=`${found.name} · Pending ${money(found.remaining)}`;if(!row.amount.value)row.amount.value=plain(Math.min(found.remaining,Math.max(0,Math.abs(amount)-rows.filter(r=>r!==row).reduce((n,r)=>n+(parseMoney(r.amount.value)||0),0))));recalc();row.amount.focus();row.amount.select();}
  function remove(row){rows.splice(rows.indexOf(row),1);row.tr.remove();recalc();}
  function accept(){const result=[];for(const r of rows){const n=parseMoney(r.amount.value),dueDate=r.due.value.trim()?parseDate(r.due.value):'';if(!n)return toast('Enter a positive amount for every reference','error');if(dueDate===null)return toast('Enter a valid due date','error');if(['new','advance'].includes(r.mode.value)&&!r.name.value.trim())return toast('Enter the reference name','error');if(r.mode.value==='against'&&!r.targetId)return toast('Select the pending reference','error');result.push({id:r.id,mode:r.mode.value,name:r.name.value.trim(),dueDate:r.mode.value==='against'?'':dueDate,amount:n,...(r.mode.value==='against'?{targetId:r.targetId}:{})});}if(result.reduce((n,r)=>n+r.amount,0)!==Math.abs(amount))return toast('Reference amounts must equal the voucher amount','error');close();resolve(result);}
  const initial=draft||data.rows;
  const content=h('section',{class:'bill-reference-editor'},h('h2',{},`Bill references · ${data.party.name}`),h('p',{class:'tip'},'Split the amount across bills, advances or on-account entries. Changes are applied when the voucher is saved.'),summary,h('div',{class:'reference-scroll'},h('table',{},h('thead',{},h('tr',{},...['Type of reference','Name / pending bill','Due date','Amount',''].map(t=>h('th',{},t)))),body)),h('div',{class:'retail-toolbar'},h('button',{onclick:()=>add().mode.focus()},'Add row · Alt+N'),h('button',{onclick:accept},'Done - Ctrl+S'),h('button',{onclick:()=>{close();resolve(null);}},'Cancel · Esc')));
  close=modal([content],e=>{if(e.key==='Enter'&&!mod(e)&&!e.altKey){
   e.preventDefault();
   if(e.target.tagName==='BUTTON'){e.target.click();return;}
   const row=rows.find(r=>r.tr.contains(e.target));if(!row)return;
   const fields=[row.mode,row.name,row.target,row.due,row.amount].filter(field=>!field.hidden&&!field.disabled);
   const next=fields[fields.indexOf(e.target)+1];
   if(next){next.focus();next.select?.();}else{const following=rows[rows.indexOf(row)+1];if(following)following.mode.focus();else accept();}return;
  }if(mod(e)&&e.code==='KeyS'){e.preventDefault();accept();}else if(e.altKey&&e.code==='KeyN'){e.preventDefault();add().mode.focus();}else if(e.key==='Escape'){e.preventDefault();close();resolve(null);}});
  if(initial.length)initial.forEach(add);else add({mode:amount*data.party.sign>0?'new':'onAccount',amount:Math.abs(amount),name:`${date}-${Date.now().toString().slice(-5)}`});rows[0]?.mode.focus();
 });
}
export async function voucherReferences({lines,date,voucherId,draft,silent=false}){
 const parties=(await call('ledgers')).filter(l=>['Sundry Debtors','Sundry Creditors'].includes(l.accountGroup));const result=[];
 for(const p of parties){const amount=lines.filter(l=>l.ledgerId===p.id).reduce((n,l)=>n+l.amount,0);if(!amount)continue;const rows=await editBillReferences({partyId:p.id,amount,date,voucherId,draft:draft?.find(d=>d.partyId===p.id)?.rows});if(!rows)return null;result.push({partyId:p.id,rows});}if(!result.length&&!silent)toast('Select a customer or supplier and enter its amount first');return result;
}
