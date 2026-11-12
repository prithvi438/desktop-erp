import { h, focus, mod } from './ui.js';
import { push, pop, top } from './router.js';

// A single observer must not keep discarded voucher screens alive.
const resizeTargets=new Set();
let mainResize;
function watchSize(refresh){
  resizeTargets.add(new WeakRef(refresh));
  if(mainResize)return;
  mainResize=new ResizeObserver(()=>{
    for(const target of resizeTargets){const update=target.deref();if(update)update();else resizeTargets.delete(target);}
  });
  mainResize.observe(document.getElementById('main'));
}

// Inputs stay alive while their containing page changes; no draft is serialised or lost.
export function entryPage(title, sections, {onKey, onDone, onClosed, onReturn}={}) {
  const owner=top(),anchors=[];
  let index=0;
  for(const section of sections)for(const node of section.nodes){
    const anchor=document.createComment('entry-page');node.before(anchor);anchors.push([anchor,node]);
  }
  const name=h('strong'),count=h('span'),content=h('div',{class:'entry-page-content'});
  const previous=h('button',{onclick:()=>show(index-1)},'Page Up · Previous');
  const next=h('button',{onclick:()=>show(index+1)},'Page Down · Next');
  previous.hidden=next.hidden=sections.length===1;
  const done=h('button',{onclick:()=>close(onDone)},'Done · Ctrl+Enter');
  const el=h('section',{class:'entry-page'},
    h('div',{class:'entry-page-heading'},name,count),content,
    h('div',{class:'entry-page-footer'},previous,next,h('span',{},'Changes stay in the current draft.'),done));
  const controls=()=>[...content.querySelectorAll('input,textarea,select,button')].filter(node=>!node.disabled&&node.getClientRects().length);
  function show(at,backwards=false){
    index=Math.max(0,Math.min(at,sections.length-1));
    content.replaceChildren(...sections[index].nodes);
    name.textContent=sections[index].title||title;count.textContent=sections.length>1?`Page ${index+1} of ${sections.length}`:'';
    previous.disabled=index===0;next.disabled=index===sections.length-1;
    focus(backwards?controls().at(-1)||done:controls()[0]||done);
  }
  function close(after){page.afterClose=after;pop();}
  el.addEventListener('keydown',event=>{
    if(event.key==='Tab'&&!mod(event)&&!event.altKey){
      const fields=controls(),at=fields.indexOf(event.target);
      if(at>=0&&event.shiftKey&&at===0&&index>0){event.preventDefault();show(index-1,true);}
      else if(at===fields.length-1&&!event.shiftKey&&index<sections.length-1){event.preventDefault();show(index+1);}
    }
  });
  const page={title,el,hints:[['PgUp / PgDn','Page'],['Tab','Next field'],['Ctrl+Enter / Esc','Return'],['Ctrl+S','Save record']],
    async onShow(returning){if(!returning)show(0);else await onReturn?.();},
    onClose(){for(const [anchor,node] of anchors)anchor.replaceWith(node);onClosed?.();},
    onKey(event){
      if(onKey?.(event))return true;
      if(event.key==='PageDown'||event.key==='PageUp'){event.preventDefault();show(index+(event.key==='PageDown'?1:-1));return true;}
      if(event.key==='Escape'||mod(event)&&event.key==='Enter'){event.preventDefault();close(onDone);return true;}
      if(mod(event)&&event.code==='KeyS'){event.preventDefault();close(()=>owner.onKey?.(event));return true;}
      if(event.altKey&&event.code==='KeyL'){event.preventDefault();close(()=>owner.onKey?.(event));return true;}
      if(event.key==='Enter'&&['INPUT','SELECT'].includes(event.target.tagName)&&(event.target.closest('.entry-field-grid')||event.target.classList.contains('line-description'))){
        event.preventDefault();const fields=controls(),at=fields.indexOf(event.target);
        if(fields[at+1])focus(fields[at+1]);else if(index<sections.length-1)show(index+1);else close(onDone);return true;
      }
      return false;
    },
  };
  push(page);return {close,page,show};
}

export function rowPages(container, {size=4,label='Rows'}={}) {
  let index=0;
  const count=h('span'),previous=h('button',{onclick:()=>move(-1)},'PgUp'),next=h('button',{onclick:()=>move(1)},'PgDn');
  const el=h('div',{class:'row-pages'},previous,count,next);
  const rows=()=>[...container.children];
  const capacity=()=>typeof size==='function'?size():size;
  function refresh(target){
    const all=rows(),limit=capacity();
    const active=target||all.find(row=>row.contains(document.activeElement));
    if(active&&all.includes(active))index=Math.floor(all.indexOf(active)/limit);
    index=Math.max(0,Math.min(index,Math.ceil(all.length/limit)-1));
    all.forEach((row,at)=>{row.hidden=Math.floor(at/limit)!==index;});
    count.textContent=`${label} ${all.length?index*limit+1:0}–${Math.min(all.length,(index+1)*limit)} of ${all.length}`;
    previous.disabled=index===0;next.disabled=(index+1)*limit>=all.length;
  }
  function move(step){
    const all=rows(),at=Math.max(0,Math.min(all.length-1,(index+step)*capacity()));
    if(!all[at])return;refresh(all[at]);focus(all[at].querySelector('input,button,select'));
  }
  container.revealEntry=node=>{const row=rows().find(row=>row.contains(node));if(row)refresh(row);};
  const observer=new MutationObserver(()=>refresh());observer.observe(container,{childList:true});
  watchSize(refresh);
  container.addEventListener('keydown',event=>{
    if(event.key==='PageDown'||event.key==='PageUp'){event.preventDefault();event.stopPropagation();move(event.key==='PageDown'?1:-1);}
    if(event.key==='Tab'&&!event.altKey&&!mod(event)){
      const all=rows(),row=all.find(row=>row.contains(event.target));if(!row)return;
      const fields=[...row.querySelectorAll('input,textarea,select,button')].filter(field=>field.getClientRects().length&&!field.disabled);
      const adjacent=all[all.indexOf(row)+(event.shiftKey?-1:1)];
      if(adjacent?.hidden&&event.target===(event.shiftKey?fields[0]:fields.at(-1))){
        event.preventDefault();refresh(adjacent);
        const next=[...adjacent.querySelectorAll('input,textarea,select,button')].filter(field=>field.getClientRects().length&&!field.disabled);
        focus(event.shiftKey?next.at(-1):next[0]);
      }
    }
  });
  refresh();return {el,refresh,move};
}

export function pageMasterForm(el){
  const groups=[...el.querySelectorAll(':scope > fieldset')];if(!groups.length)return;
  const container=h('div',{class:'master-sections'});groups[0].before(container);container.append(...groups);
  const pager=rowPages(container,{size:1,label:'Sections'});container.after(pager.el);
  if(groups.length===1)pager.el.hidden=true;
  el.classList.add('paged-master');
  return pager;
}
