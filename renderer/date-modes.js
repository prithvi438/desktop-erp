import {h,today,showDate} from './ui.js';

// Use the same single-day / period controls wherever a list already has date bounds.
export function dateModes(from,to,onApply,{all=true}={}){
  let single=false;
  const day=h('button',{type:'button',onclick:()=>choose(true),'aria-pressed':'false'},'Single date');
  const range=h('button',{type:'button',onclick:()=>choose(false),'aria-pressed':'true'},'Date range');
  function choose(value){single=value;day.setAttribute('aria-pressed',String(single));range.setAttribute('aria-pressed',String(!single));to.disabled=single;
    if(single){if(!from.value.trim())from.value=showDate(today());to.value=from.value;from.dispatchEvent(new Event('input',{bubbles:true}));}from.focus();from.select();}
  from.addEventListener('input',()=>{if(single){to.value=from.value;to.dispatchEvent(new Event('input',{bubbles:true}));}});
  from.addEventListener('choose-period',()=>choose(false));
  return h('div',{class:'daybook-modes date-modes'},day,range,all?h('button',{type:'button',onclick:()=>{choose(false);from.value=to.value='';onApply?.();}},'All dates'):null);
}
