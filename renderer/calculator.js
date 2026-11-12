import {h,call,toast} from './ui.js';
import {calculate} from './calculator-math.mjs';
let panel,previous,expression,result,history,busy=false;
function close(){if(!panel)return;panel.remove();panel=null;previous?.isConnected&&previous.focus();}
function position(x,y){const r=panel.getBoundingClientRect();panel.style.left=Math.max(0,Math.min(x,innerWidth-r.width))+'px';panel.style.top=Math.max(0,Math.min(y,innerHeight-r.height))+'px';}
function evaluate(){try{const value=calculate(expression.value);history.textContent=expression.value+' =';result.textContent=value;expression.value=value;expression.select();}catch(error){result.textContent=error.message;}}
function insert(value){expression.focus();expression.setRangeText(value,expression.selectionStart??expression.value.length,expression.selectionEnd??expression.value.length,'end');}
async function toggle(){
 if(panel){close();return;}if(busy)return;busy=true;
 try{
  if(!(await call('settings')).useCalculator){toast('Enable Use calculator in Settings > Forms & feature settings.');return;}
  previous=document.activeElement;
  expression=h('input',{class:'calculator-expression','aria-label':'Calculation',placeholder:'e.g. (1250 + 350) * 18%',maxLength:500,spellcheck:false});
  history=h('div',{class:'calculator-history'});result=h('output',{class:'calculator-result','aria-live':'polite'},'0');
  const header=h('div',{class:'calculator-drag'},h('div',{},h('strong',{},'Calculator'),h('small',{},'Ctrl+Shift+C')),h('button',{type:'button','aria-label':'Close calculator',onclick:close},'\u00d7'));
  const keys=h('div',{class:'calculator-keys'});
  for(const key of ['C','(',')','Back','7','8','9','\u00f7','4','5','6','\u00d7','1','2','3','-','0','.','%','+','sqrt','^','Copy','=']){
   keys.append(h('button',{type:'button',class:key==='='?'calculator-equals':'','aria-label':({'Back':'Backspace','C':'Clear','sqrt':'Square root','Copy':'Copy result'})[key]||key,onclick:()=>{
    if(key==='C'){expression.value='';history.textContent='';result.textContent='0';}
    else if(key==='=')evaluate();
    else if(key==='Copy'){navigator.clipboard.writeText(result.textContent).then(()=>toast('Result copied')).catch(()=>toast('Could not copy result','error'));}
    else if(key==='Back'){const start=expression.selectionStart??0,end=expression.selectionEnd??start;expression.setRangeText('',start===end?Math.max(0,start-1):start,end,'end');}
    else insert(key==='sqrt'?'sqrt(':key==='-'?'-':key);
    expression.focus();
   }},key));
  }
  panel=h('section',{class:'floating-calculator',role:'dialog','aria-modal':'true','aria-label':'Calculator'},header,history,expression,result,keys,h('p',{class:'calculator-help'},'Enter = calculate \u00b7 Esc = close \u00b7 Alt+arrows = move'),h('small',{class:'calculator-help'},'% divides by 100. Example: 1000 \u00d7 18% = 180.'));
  document.body.append(panel);position(innerWidth-panel.offsetWidth-24,90);expression.focus();
  let drag;
  header.addEventListener('pointerdown',event=>{if(event.target.closest('button')||event.button!==0)return;const r=panel.getBoundingClientRect();drag={x:event.clientX-r.left,y:event.clientY-r.top};header.setPointerCapture(event.pointerId);event.preventDefault();});
  header.addEventListener('pointermove',event=>{if(drag)position(event.clientX-drag.x,event.clientY-drag.y);});
  header.addEventListener('pointerup',()=>{drag=null;});header.addEventListener('pointercancel',()=>{drag=null;});
 }catch(error){toast(error.message,'error');}finally{busy=false;}
}
window.addEventListener('resize',()=>{if(panel){const r=panel.getBoundingClientRect();position(r.left,r.top);}});
window.addEventListener('keydown',event=>{
 if((event.ctrlKey||event.metaKey)&&event.shiftKey&&event.code==='KeyC'){event.preventDefault();event.stopImmediatePropagation();if(!event.repeat)toggle();return;}
 if(!panel)return;
 event.stopImmediatePropagation();
 if(event.key==='Escape'){event.preventDefault();close();}
 else if(event.altKey&&event.key.startsWith('Arrow')){event.preventDefault();const r=panel.getBoundingClientRect();position(r.left+(event.key==='ArrowLeft'?-20:event.key==='ArrowRight'?20:0),r.top+(event.key==='ArrowUp'?-20:event.key==='ArrowDown'?20:0));}
 else if(event.key==='Enter'||event.key==='='){event.preventDefault();if(event.target.tagName==='BUTTON'&&event.key==='Enter')event.target.click();else evaluate();}
 else if(event.key==='Tab'){event.preventDefault();const fields=[...panel.querySelectorAll('input,button')],at=fields.indexOf(document.activeElement);fields[(at+(event.shiftKey?-1:1)+fields.length)%fields.length].focus();}
 else if((event.ctrlKey||event.metaKey)&&!['KeyA','KeyC','KeyV','KeyX','KeyZ','KeyY'].includes(event.code))event.preventDefault();
 else if(document.activeElement!==expression&&!event.ctrlKey&&!event.metaKey&&!event.altKey&&/^[0-9.+*/()%^-]$/.test(event.key)){event.preventDefault();insert(event.key);}
},true);
// Keep the underlying draft or dialog untouched while the calculator is open.
document.addEventListener('pointerdown',event=>{if(panel&&!panel.contains(event.target)){event.preventDefault();event.stopImmediatePropagation();expression.focus();}},true);
