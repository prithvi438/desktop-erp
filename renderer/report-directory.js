import {h,createList,mod,toast} from './ui.js';
import {push,chrome} from './router.js';

export function reportDirectory(groups,initial=null,title='Reports'){
  if(title==='Reports')return groupedReports(groups,initial,title);
  const entries=groups.flatMap(([category,rows])=>rows.map(row=>({...row,category})));
  let started=false,busy=false;
  const list=createList({filter:true,empty:`No matching ${title.toLowerCase()}.`,columns:[{label:title==='Reports'?'Report':'Setting',get:row=>row.label},{label:'Category',get:row=>row.category}],onEnter:open});
  const search=list.el.querySelector('input');search.placeholder=`Type to find ${title.toLowerCase()}`;search.setAttribute('aria-label',`Search ${title.toLowerCase()}`);
  const el=h('section',{class:'report-directory'},h('div',{class:'report-directory-heading'},h('h2',{},title),h('p',{class:'tip'},'Select with Up / Down, then press Enter to open.')),list.el);
  async function open(entry){if(!entry||busy)return;busy=true;try{const screen=await entry.open();if(screen?.el)await push(screen);}catch(error){toast(error.message,'error');}finally{busy=false;}}
  return {title,el,hints:[['↑ / ↓','Choose'],['PgUp / PgDn','Page'],['Enter','Open'],['Ctrl+L','Search'],['Esc','Back']],
    async onShow(){if(!started){started=true;list.setRows(entries);list.focus();if(initial)await open(entries.find(entry=>entry.label===initial));}else list.focus();},
    onKey(event){if(mod(event)&&event.code==='KeyL'){event.preventDefault();list.focus();search.select();return true;}return list.onKey(event);}};
}

function groupedReports(groups,initial,title){
 let index=Math.max(0,groups.findIndex(([,rows])=>rows.some(row=>row.label===initial))),started=false,busy=false;
 const cache=new Map(),heading=h('h2'),description=h('p',{class:'tip'}),body=h('div',{class:'report-list-host'});
 const content=h('div',{class:'register-content report-head-content'},h('div',{class:'report-directory-heading'},heading,description),body);
 const buttons=groups.map(([name],at)=>h('button',{onclick:()=>select(at,true)},h('span',{},name),h('small',{},String(groups[at][1].length))));
 const rail=h('aside',{class:'register-rail workspace-menu-card','aria-label':'Report headings'},h('h2',{},'Reports'),h('p',{class:'tip'},'Choose a heading, then Enter for reports.'),...buttons);
 const el=h('section',{class:'registers-workspace reports-workspace','data-focus-area':'headings'},rail,content);
 function indicateFocus(area){
  el.dataset.focusArea=area;
  description.textContent=area==='headings'?'Preview - press Enter to navigate these reports.':'Up / Down chooses a report. Enter opens it. Escape returns to headings.';
  chrome();
 }
 el.addEventListener('focusin',event=>indicateFocus(rail.contains(event.target)?'headings':'reports'));
 content.addEventListener('pointerdown',event=>{if(!event.target.closest('input,button,select,textarea'))active?.focus();});
 let active;
 async function open(entry){if(!entry||busy)return;busy=true;try{const screen=await entry.open();if(screen?.el)await push(screen);}catch(error){toast(error.message,'error');}finally{busy=false;}}
 function select(at,focusReports=false){
  index=(at+groups.length)%groups.length;
  buttons.forEach((button,i)=>{button.setAttribute('aria-pressed',String(i===index));button.tabIndex=i===index?0:-1;});
  const [name,entries]=groups[index];heading.textContent=name;description.textContent='Select a report and press Enter to open. Escape returns to headings.';
  if(!cache.has(index)){
   const list=createList({filter:true,columns:[{label:'Report',get:row=>row.label}],empty:'No matching reports in this heading.',onEnter:open});
   const search=list.el.querySelector('input');search.placeholder='Type to find a report';search.setAttribute('aria-label','Search '+name);list.setRows(entries);cache.set(index,list);
  }
  active=cache.get(index);body.replaceChildren(active.el);
  if(focusReports)active.focus();else{buttons[index].focus();buttons[index].scrollIntoView({block:'nearest'});}
 }
 rail.addEventListener('keydown',event=>{
  if(event.altKey||mod(event))return;
  const step=['ArrowDown','ArrowRight'].includes(event.key)||event.key==='Tab'&&!event.shiftKey?1:['ArrowUp','ArrowLeft'].includes(event.key)||event.key==='Tab'&&event.shiftKey?-1:0;
  if(step){event.preventDefault();event.stopPropagation();select(index+step);}
  else if(event.key==='Home'||event.key==='End'){event.preventDefault();event.stopPropagation();select(event.key==='Home'?0:groups.length-1);}
  else if(event.key==='Enter'){event.preventDefault();event.stopPropagation();active.focus();}
 });
 return {title,el,get hints(){const headings=el.dataset.focusArea==='headings';return [[headings?'Up / Down / Tab':'Up / Down',headings?'Choose heading':'Choose report'],['Enter',headings?'Report list':'Open report'],['Alt+M','Headings'],['Alt+L','Report list'],['Ctrl+L','Search'],['Esc',headings?'Back':'Headings']];},
  async onShow(returning){if(!started){started=true;select(index);if(initial)await open(groups[index][1].find(row=>row.label===initial));}else if(returning)active.focus();},
  onKey(event){
   if(event.key==='Escape'){if(rail.contains(event.target))return false;event.preventDefault();buttons[index].focus();return true;}
   if(event.altKey&&event.code==='KeyM'){event.preventDefault();buttons[index].focus();return true;}
   if(event.altKey&&event.code==='KeyL'||mod(event)&&event.code==='KeyL'){event.preventDefault();active.focus();active.el.querySelector('input').select();return true;}
   if(rail.contains(event.target)&&!event.altKey&&!mod(event)&&event.key.length===1){active.focus();}
   return active.onKey(event);
  }
 };
}
