// A compact left menu opens a directory; its right rail stays with each list/report.
import { h, toast, mod, typeToSearch } from './ui.js';
import { chrome, top, pop } from './router.js';

export function browseWorkspace(title, groups, initial = null) {
  let category = Math.max(0, groups.findIndex(([,entries]) => entries.some(e => e.label === initial)));
  let selected = null, child = null, busy = false, started = false;
  const content = h('div', { class:'browse-content' });
  const heading = h('div', { class:'browse-heading' });
  const search = h('input', { placeholder:'Find in this workspace…', class:'browse-search' });
  search.setAttribute('aria-label',`Search ${title.toLowerCase()}`);
  const categories = h('div', { class:'browse-categories' });
  const options = h('div', { class:'browse-options' });
  const rail = h('aside', { class:'browse-rail' },h('h2',{},title),search,categories,options);
  rail.setAttribute('aria-label',`${title} navigation`);
  const el = h('section', { class:'browse-workspace' },h('div',{class:'browse-body'},heading,content),rail);
  let visible = [], cursor = 0,railResize;
  const optionRows=h('div',{class:'browse-option-rows'}),optionCount=h('span');
  const railPrevious=h('button',{onclick:()=>focusOption(cursor-optionSize()),title:'Previous options'},'‹'),railNext=h('button',{onclick:()=>focusOption(cursor+optionSize()),title:'Next options'},'›');
  const optionSize=()=>Math.max(1,Math.floor(optionRows.clientHeight/34));
  function pageOptions(){
    const size=optionSize(),start=Math.floor(cursor/size)*size;
    [...optionRows.children].forEach((button,i)=>{button.hidden=i<start||i>=start+size;});
    optionCount.textContent=`${visible.length?start+1:0}–${Math.min(start+size,visible.length)} of ${visible.length}`;
    railPrevious.disabled=start===0;railNext.disabled=start+size>=visible.length;
  }

  function focusOption(index) {
    if(!visible.length)return;
    cursor=(index+visible.length)%visible.length;
    pageOptions();optionRows.children[cursor]?.focus();
  }
  function drawRail() {
    categories.replaceChildren(...groups.map(([name],index)=>{
      const button=h('button',{class:index===category?'active':'',onclick:()=>changeCategory(index)},h('span',{},name),h('kbd',{},`F${index+1}`));
      button.setAttribute('aria-pressed',String(index===category));return button;
    }));
    const query=search.value.trim().toLowerCase();
    visible=(query?groups.flatMap(([,entries])=>entries):groups[category][1]).filter(e=>`${e.label} ${e.section}`.toLowerCase().includes(query));
    cursor=Math.max(0,visible.findIndex(entry=>entry===selected));
    optionRows.replaceChildren(...visible.map((entry,index)=>{
      const button=h('button',{class:`browse-option${entry.label===selected?.label?' active':''}`,title:entry.label,onclick:()=>open(entry),onfocus:()=>{cursor=index;}},entry.label);
      if(entry.label===selected?.label)button.setAttribute('aria-current','page');return button;
    }));
    options.replaceChildren(h('div',{class:'browse-option-pager'},optionCount,railPrevious,railNext),optionRows,...(!visible.length?[h('p',{class:'tip'},'No matching screens.')]:[]));pageOptions();
  }
  function directory() {
    const [name,entries]=groups[category];
    content.replaceChildren(h('div',{class:'browse-directory'},
      h('p',{class:'eyebrow'},title.toUpperCase()),h('h2',{},name),
      h('p',{class:'tip'},title==='Reports'?'Review balances, stock and business performance.':title==='Settings'?'Manage company preferences, form options and your cloud connection.':'Browse saved records, review entries and open them to edit.'),
      h('div',{class:'browse-cards'},...entries.map(entry=>h('button',{onclick:()=>open(entry)},h('strong',{},entry.label),h('span',{},title==='Reports'?'View report →':title==='Settings'?'Open →':'Open list →'))))));
  }
  function redrawHeading() {
    heading.replaceChildren(h('button',{onclick:back},title),h('span',{},' / ',groups[category][0]),...(selected?[h('strong',{},' / ',selected.label)]:[]));
  }
  const mayLeave=async()=>!busy&&(!child?.canLeave||await child.canLeave());
  async function back() {
    if(!await mayLeave())return;
    child?.onClose?.();child=null;selected=null;search.value='';directory();drawRail();redrawHeading();chrome();focusOption(0);
  }
  async function changeCategory(index) {
    if(!await mayLeave())return;
    child?.onClose?.();category=index;child=null;selected=null;search.value='';directory();drawRail();redrawHeading();chrome();focusOption(0);
  }
  async function open(entry) {
    if(!await mayLeave())return;
    busy=true;
    try {
      const screen=await entry.open();
      child?.onClose?.();
      category=groups.findIndex(([,entries])=>entries.includes(entry));
      selected=screen?.el?entry:null;child=screen?.el?screen:null;
      if(child)content.replaceChildren(child.el);else directory();
      drawRail();redrawHeading();
      // Some choices open a ledger picker and push their own detail screen.
      if(top()===workspace)chrome();
      await child?.onShow?.(false);
    }catch(error){toast(error.message,'error');}
    finally{busy=false;}
  }
  search.addEventListener('input',drawRail);
  el.addEventListener('keydown',event=>{
    if(event.key!=='Tab'||event.ctrlKey||event.altKey||event.metaKey)return;
    // A directory is a keyboard menu. Once a list is open, its own Tab order remains intact.
    if(options.contains(event.target)||(!child&&event.target!==search)){
      event.preventDefault();event.stopPropagation();focusOption(cursor+(event.shiftKey?-1:1));
    }else if(event.target===search){event.preventDefault();event.stopPropagation();focusOption(event.shiftKey?visible.length-1:0);}
  });
  rail.addEventListener('keydown',event=>{
    if(event.altKey||event.ctrlKey||event.metaKey)return;
    if(event.key==='PageDown'||event.key==='PageUp'){event.preventDefault();event.stopPropagation();focusOption(cursor+(event.key==='PageDown'?optionSize():-optionSize()));return;}
    if(event.key==='ArrowDown'||event.key==='ArrowUp'){
      event.preventDefault();event.stopPropagation();focusOption(event.target===search?(event.key==='ArrowDown'?0:visible.length-1):cursor+(event.key==='ArrowDown'?1:-1));
    }else if(event.key==='Enter'&&event.target===search){event.preventDefault();event.stopPropagation();if(visible[0])open(visible[0]);}
  });
  const workspace={
    get title(){return child?.title||title;},
    get hints(){return [...(child?.hints||[['Enter','Open'],['Esc','Back']]).map(([key,label])=>[/^F[23]$/.test(key)?`Shift+${key}`:key,label]),['Ctrl+L','Find here'],[`F1–F${groups.length}`,'Category'],['Tab / Shift+Tab','Options']];},
    el,canLeave:mayLeave,onClose(){child?.onClose?.();railResize?.disconnect();},
    functionKey(event){
      if(event.altKey||mod(event))return false;
      if(event.shiftKey&&['F2','F3'].includes(event.key))return child?.onKey?.({key:event.key,preventDefault:()=>event.preventDefault()})||false;
      const number=!event.shiftKey&&/^F[1-9]$/.test(event.key)?Number(event.key.slice(1))-1:-1;
      if(number<0||number>=groups.length)return false;
      event.preventDefault();changeCategory(number);return true;
    },
    async onShow(returning){
      if(!railResize){railResize=new ResizeObserver(pageOptions);railResize.observe(optionRows);}
      if(!started){started=true;directory();drawRail();redrawHeading();const entry=groups.flatMap(([,entries])=>entries).find(e=>e.label===initial);if(entry)await open(entry);else focusOption(0);}
      else if(child)await child.onShow?.(returning);
    },
    onKey(event){
      if(mod(event)&&event.code==='KeyL'){event.preventDefault();search.focus();search.select();return true;}
      if(workspace.functionKey(event))return true;
      if(event.key==='Escape'){event.preventDefault();if(child)back();else if(!busy)pop();return true;}
      if(busy){event.preventDefault();return true;}
      if((!child||rail.contains(event.target))&&typeToSearch(event,search))return true;
      if(rail.contains(event.target)&&!event.altKey&&!mod(event)&&!/^F\d+$/.test(event.key))return false;
      return child?.onKey?.(event);
    },
  };
  return workspace;
}
