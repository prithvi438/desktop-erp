import {masterActions} from './inline-master.js';
import { h, suggest, focus, parseMoney, plain, money, toast, confirmBox } from './ui.js';
import { rowPages } from './keyboard-pages.js';

const cashBank = ledger => ['Cash-in-Hand','Bank Accounts','Bank OD A/c'].includes(ledger.accountGroup||ledger.groupName);

// Payment/receipt vocabulary over the same balanced accounting entries.
export function settlementEditor({getLedgers,onChange,onDone}) {
  let type='Payment',rows=[],adjustments=false,originalSourceId=null;
  const source=h('input',{class:'wide',placeholder:'Choose cash or bank account'});
  source.setAttribute('aria-label','Cash or bank account');
  const sourceLabel=h('h3'),heading=h('h3'),total=h('strong'),body=h('tbody'),directionHead=h('th',{},'Direction');
  const adjustmentNote=h('p',{class:'tip',hidden:true},'This voucher includes offsets or additional payment accounts. Their directions and amounts are retained; the main account receives the balancing total.');
  const pages=rowPages(body,{size:()=>innerHeight<660?2:innerHeight<780?3:4,label:'Allocations'});
  const sourceInfo=h('p',{class:'tip'});
  const el=h('div',{class:'settlement'},
    h('div',{class:'settlement-source'},h('p',{class:'eyebrow'},'01 · CASH / BANK'),sourceLabel,h('div',{class:'field'},source),sourceInfo),
    h('div',{class:'settlement-allocations'},h('p',{class:'eyebrow'},'02 · ALLOCATIONS'),heading,
      adjustmentNote,h('table',{class:'lines'},h('thead',{},h('tr',{},h('th',{},'Ledger / particulars'),directionHead,h('th',{class:'num'},'Amount'),h('th',{},''))),body),
      pages.el,h('div',{class:'settlement-total'},h('button',{onclick:()=>addBlank()},'Add allocation · Alt+N'),h('span',{},'Total ',total)),
      h('p',{class:'tip'},'Enter: ledger, amount, next allocation. Enter on an empty ledger continues to narration.')));
  const sourcePick=suggest(source,{onCreate:masterActions('ledger','Bank Accounts'),items:()=>getLedgers().filter(row=>cashBank(row)||row.id===originalSourceId),onPick:()=>{onChange();describeSource();focus((rows[0]||addRow()).ledger);}});
  function describeSource(){const selected=getLedgers().find(row=>row.id===Number(source.dataset.id));sourceInfo.textContent=selected?`${selected.groupName} · ${type==='Payment'?'Payment leaves this account':'Receipt enters this account'}`:'Only cash and bank ledgers are available here.';}
  source.addEventListener('keydown',event=>{
    if(event.key==='Enter'||event.key==='Tab'&&!event.shiftKey){event.preventDefault();
      if(source.dataset.id)focus((rows[0]||addRow()).ledger);
      else if(!sourcePick.chooseCurrent())toast('Choose a cash or bank account','error');
    }
  });
  source.addEventListener('input',()=>{onChange();describeSource();});
  function recalc(){total.textContent=money(rows.reduce((sum,row)=>sum+(parseMoney(row.amount.value)||0)*Number(row.direction.value),0));}
  function addBlank(){focus((rows.find(row=>!row.ledger.value&&!row.amount.value)||addRow()).ledger);}
  function addRow(line){
    const ledger=h('input',{class:'wide',placeholder:type==='Payment'?'Pay to / expense ledger':'Received from / income ledger',value:line?.ledgerName||''});
    const amount=h('input',{class:'num',value:line?plain(line.amount):''});
    const sign=type==='Payment'?1:-1;
    const direction=h('select',{'aria-label':'Allocation direction'},h('option',{value:'1'},type==='Payment'?'Pay / expense':'Receive / income'),h('option',{value:'-1'},'Offset / other account'));
    direction.value=line&&line.amount*sign<0?'-1':'1';
    ledger.setAttribute('aria-label','Allocation ledger');amount.setAttribute('aria-label','Allocation amount');
    if(line)ledger.dataset.id=line.ledgerId;
    const row={ledger,amount,direction};
    const node=h('tr',{},h('td',{class:'field'},ledger),h('td',{hidden:!adjustments},direction),h('td',{},amount),h('td',{},h('button',{onclick:async()=>{
      if((ledger.value||amount.value)&&!await confirmBox('Remove this allocation?'))return;
      rows=rows.filter(entry=>entry!==row);node.remove();onChange();recalc();addBlank();
    }},'Remove')));
    row.node=node;rows.push(row);body.append(node);
    const pick=suggest(ledger,{onCreate:masterActions('ledger'),items:()=>getLedgers().filter(entry=>adjustments||!cashBank(entry)),onPick:()=>{onChange();focus(amount);}});
    direction.addEventListener('change',()=>{onChange();recalc();});
    ledger.addEventListener('keydown',event=>{
      if(event.key!=='Enter'&&(event.key!=='Tab'||event.shiftKey))return;
      event.preventDefault();
      if(ledger.dataset.id)focus(amount);
      else if(ledger.value.trim()){if(!pick.chooseCurrent())toast('Choose a ledger. Alt+C creates one.','error');}
      else if(amount.value.trim())toast('Choose the ledger for this amount','error');
      else if(rows.some(entry=>entry.ledger.dataset.id&&parseMoney(entry.amount.value))){rows=rows.filter(entry=>entry!==row);node.remove();onDone();}
      else toast('Enter at least one allocation','error');
    });
    amount.addEventListener('keydown',event=>{
      if(event.key!=='Enter')return;event.preventDefault();
      if(!parseMoney(amount.value))return toast('Enter a positive amount','error');
      amount.value=plain(parseMoney(amount.value));focus((rows[rows.indexOf(row)+1]||addRow()).ledger);
    });
    node.addEventListener('input',()=>{onChange();recalc();});return row;
  }
  return {el,source,focus:()=>focus(source),addBlank,
    load(next,lines=[]){
      type=next;rows=[];adjustments=false;originalSourceId=null;body.replaceChildren();source.value='';delete source.dataset.id;
      if(!['Payment','Receipt'].includes(type))return false;
      const sourceSign=type==='Payment'?-1:1;
      const sources=lines.filter(line=>cashBank(getLedgers().find(row=>row.id===line.ledgerId)||{}));
      const primary=sources.find(line=>line.amount*sourceSign>0)||lines.find(line=>line.amount*sourceSign>0);
      originalSourceId=primary?.ledgerId||null;
      adjustments=Boolean(lines.length&&(sources.length!==1||primary!==sources[0]||lines.some(line=>line!==primary&&line.amount*sourceSign>=0)));
      directionHead.hidden=adjustmentNote.hidden=!adjustments;
      sourceLabel.textContent=type==='Payment'?'Pay from':'Receive into';
      heading.textContent=type==='Payment'?'Pay to / expense allocations':'Received from / income allocations';
      if(primary){source.value=primary.ledgerName;source.dataset.id=primary.ledgerId;}
      lines.filter(line=>line!==primary).forEach(addRow);
      if(!rows.length)addRow();recalc();describeSource();return true;
    },
    read(){
      const fail=(message,input)=>{focus(input);throw Error(message);};
      const account=getLedgers().find(row=>row.id===Number(source.dataset.id));
      if(!account||(!cashBank(account)&&account.id!==originalSourceId))fail('Choose a cash or bank account',source);
      const sign=type==='Payment'?1:-1,entries=[];
      for(const row of rows){
        if(!row.ledger.value&&!row.amount.value)continue;
        const ledger=getLedgers().find(entry=>entry.id===Number(row.ledger.dataset.id));
        if(!ledger||(!adjustments&&cashBank(ledger)))fail('Choose a valid allocation ledger',row.ledger);
        const amount=parseMoney(row.amount.value);
        if(!Number.isSafeInteger(amount)||amount<=0)fail('Enter a positive allocation amount',row.amount);
        entries.push({ledgerId:ledger.id,amount:sign*amount*Number(row.direction.value)});
      }
      if(!entries.length)fail('Add at least one allocation',rows[0]?.ledger||source);
      if(entries.reduce((sum,line)=>sum+line.amount*sign,0)<=0)fail('Allocations must exceed offsets so the main account has a positive total',source);
      return [{ledgerId:account.id,amount:-entries.reduce((sum,line)=>sum+line.amount,0)},...entries];
    },
  };
}
