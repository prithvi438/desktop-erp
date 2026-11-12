import {h} from './ui.js';

export function yesNo(value=false) {
  const input=h('input',{type:'text',readOnly:true,class:'yes-no',role:'switch','aria-checked':String(Boolean(value))});
  let checked=Boolean(value);
  const paint=()=>{input.value=checked?'Yes':'No';input.setAttribute('aria-checked',String(checked));};
  Object.defineProperty(input,'checked',{get:()=>checked,set:value=>{checked=Boolean(value);paint();}});
  const set=value=>{checked=value;paint();input.dispatchEvent(new Event('change',{bubbles:true}));};
  input.addEventListener('keydown',event=>{
    const key=event.key.toLowerCase();
    if(!['y','n','arrowleft','arrowright',' '].includes(key)||event.altKey||event.ctrlKey||event.metaKey)return;
    event.preventDefault();event.stopPropagation();set(key==='y'?true:key==='n'?false:!checked);
  });
  input.addEventListener('click',()=>set(!checked));paint();return input;
}
