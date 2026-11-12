import {chrome} from './router.js';
import {h,mod} from './ui.js';
import {transactionRegister} from './daybook.js';
import {createVouchers} from './create.js';
import {accountBooks} from './account-books.js';

export const REGISTER_TYPES=[
  ['Payment register','Payment'],['Receipt register','Receipt'],['Contra register','Contra'],['Journal register','Journal'],
  ['Sales register','Sales'],['Purchase register','Purchase'],['Sales return register','Credit Note'],['Purchase return register','Debit Note'],
  ['Quotation register','Quotation'],['Sales order register','Sales Order'],['Purchase order register','Purchase Order'],['Stock journal register','Stock Journal'],
  ['Ledger Register','accounts'],['Stock Register','stock'],
];
export function registersWorkspace(initial=null){
  let index=Math.max(0,REGISTER_TYPES.findIndex(([name])=>name===initial)),active=null,revision=0;
  const cache=new Map(),content=h('div',{class:'register-content'});
  const buttons=REGISTER_TYPES.map(([name],at)=>h('button',{onclick:()=>open(at,true)},name));
  const rail=h('aside',{class:'register-rail workspace-menu-card','aria-label':'Register types'},h('h2',{},'Registers'),h('p',{class:'tip'},'↑ ↓ / Tab: switch · Enter: entries'),h('h4',{class:'master-section-title'},'Voucher registers'),...buttons.flatMap((button,i)=>i===12?[h('h4',{class:'master-section-title'},'Account & inventory'),button]:[button]));
  const el=h('section',{class:'registers-workspace'},rail,content);
  async function open(at,focusEntries=false){
    index=(at+buttons.length)%buttons.length;const token=++revision;
    buttons.forEach((button,i)=>{button.setAttribute('aria-pressed',String(i===index));button.tabIndex=i===index?0:-1;});
    const [title,type]=REGISTER_TYPES[index];
    if(!cache.has(index))cache.set(index,['accounts','stock'].includes(type)?accountBooks({mode:type,pickerOnly:true}):transactionRegister({title,types:[type],allDates:true,create:()=>createVouchers(type==='Stock Journal'?'Stock In':type)}));
    active=cache.get(index);content.replaceChildren(active.el);chrome();
    await active.onShow();if(token!==revision)return;if(focusEntries)active.focus();else buttons[index].focus();
  }
  rail.addEventListener('keydown',event=>{
    if(event.altKey||mod(event))return;
    const step=['ArrowDown','ArrowRight'].includes(event.key)||event.key==='Tab'&&!event.shiftKey?1:['ArrowUp','ArrowLeft'].includes(event.key)||event.key==='Tab'&&event.shiftKey?-1:0;
    if(step){event.preventDefault();event.stopPropagation();open(index+step);}
    else if(event.key==='Enter'){event.preventDefault();event.stopPropagation();active?.focus();}
  });
  return {title:'Registers',el,get hints(){return [...(active?.hints||[]).filter(([key])=>key!=='Alt+L'),['Alt+M','Register types'],['Alt+L','Entries']];},
    async onShow(returning){if(returning&&active)await active.onShow();else await open(index);},
    onKey(event){
      if(event.key==='Escape'){
        if(rail.contains(event.target))return false;
        event.preventDefault();buttons[index].focus();return true;
      }
      if(event.altKey&&event.code==='KeyM'){buttons[index].focus();event.preventDefault();return true;}if(event.altKey&&event.code==='KeyL'){active?.focus();event.preventDefault();return true;}return active?.onKey(event);}};
}
