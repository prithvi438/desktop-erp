// Handle before modal key traps so F2 dialogs and ordinary forms behave alike.
const dateParsers=new WeakMap();
window.addEventListener('keydown',event=>{
 const input=event.target,parse=dateParsers.get(input);
 if(!parse||input.disabled||input.readOnly||event.altKey||event.ctrlKey||event.metaKey||event.shiftKey||!['ArrowUp','ArrowDown'].includes(event.key))return;
 event.preventDefault();event.stopImmediatePropagation();
 const iso=parse(input.value);if(!iso)return;
 const date=new Date(iso+'T00:00:00Z');date.setUTCDate(date.getUTCDate()+(event.key==='ArrowUp'?-1:1));
 if(date.getUTCFullYear()<1900||date.getUTCFullYear()>9999)return;
 input.value=date.toISOString().slice(0,10).split('-').reverse().join('-');
 input.dispatchEvent(new Event('input',{bubbles:true}));
 input.dispatchEvent(new Event('change',{bubbles:true}));input.select();
},true);
// Shared DD-MM-YYYY entry. Formatting never validates or silently changes a date.
export function dateInput(input,parse){
 if(input.dataset.dateInput)return;input.dataset.dateInput='true';input.inputMode='numeric';
 dateParsers.set(input,parse);
 input.classList.add('date-entry');
 if(!input.placeholder)input.placeholder='dd-mm-yyyy';
 input.title=[input.title,'DD-MM-YYYY | Up: previous day | Down: next day'].filter(Boolean).join(' | ');
 input.addEventListener('input',event=>{
  if(event.isComposing)return;
  const raw=input.value,pos=input.selectionStart??raw.length;
  // Preserve deliberately entered short dates (e.g. 6/11/26) for parseDate.
  if(/[/\. ]/.test(raw)||/^\d-/.test(raw))return;
  const digits=raw.replace(/\D/g,'').slice(0,8),before=raw.slice(0,pos).replace(/\D/g,'').length;
  const deleting=event.inputType?.startsWith('delete');
  let formatted=digits.slice(0,2);
  if(digits.length>2||digits.length===2&&!deleting)formatted+='-'+digits.slice(2,4);
  if(digits.length>4||digits.length===4&&!deleting)formatted+='-'+digits.slice(4);
  if(raw===formatted)return;
  input.value=formatted;
  let caret=0,count=0;while(caret<formatted.length&&count<before){if(/\d/.test(formatted[caret]))count++;caret++;}
  if(!deleting)while(formatted[caret]==='-')caret++;
  input.setSelectionRange(caret,caret);
 },true);
}
