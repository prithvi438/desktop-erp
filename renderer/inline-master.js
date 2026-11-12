import {push,pop} from './router.js';

// Lazy imports avoid cycles between master forms and voucher detail editors.
export function masterActions(kind,group=null){
  const open=async(selected,choose)=>{
    const {call}=await import('./ui.js');
    const module=await import(kind==='item'?'./items.js':'./ledgers.js');
    const load=()=>call(kind==='item'?'items':'ledgers');
    const current=selected?(await load()).find(row=>row.id===selected.id):null;
    if(selected&&!current)throw Error('This master no longer exists');
    return inlineMaster(done=>kind==='item'?module.itemForm(current,done):module.ledgerForm(current,typeof group==='function'?group():group,done),load)(choose);
  };
  const create=choose=>open(null,choose);create.edit=(selected,choose)=>open(selected,choose);return create;
}

// Return only after the parent's options have reloaded. Its live DOM is the draft.
export function inlineMaster(factory,load){
  const open=(selected,choose)=>{
    const screen=factory(async result=>{
      screen.afterClose=async()=>{const row=(await load()).find(row=>row.id===result.id);if(row)await choose({...row,label:row.label||row.name});};
      pop();
    },selected);
    return push(screen);
  };
  const create=choose=>open(null,choose);create.edit=(selected,choose)=>open(selected,choose);return create;
}

export function bindInlineMaster(input,create,edit){
  input.dataset.inlineCreate='true';
  input.title='Alt+C: create ? Ctrl+Enter: edit selected master';
  input.dataset.inlineEdit=edit?'true':'';
  input.addEventListener('keydown',event=>{
    if(edit&&(event.ctrlKey||event.metaKey)&&event.key==='Enter'){event.preventDefault();event.stopImmediatePropagation();edit();return;}
    if(!event.ctrlKey&&!event.metaKey&&!event.shiftKey&&(event.altKey&&event.code==='KeyC')){
      event.preventDefault();event.stopImmediatePropagation();create();
    }
  },true);
}
