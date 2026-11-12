import {dateInput} from './date-input.js';
// Small DOM, formatting and keyboard widgets shared by every screen.

export const call = (method, args) => window.books.call(method, args);
const fiscalContext=await call('financialYearState');
export const activePeriod=()=>({...fiscalContext.active,...(fiscalContext.period||{to:today()})});
export const reportDate=()=>activePeriod().to;
export function focusPeriod(input){input.dispatchEvent(new Event('choose-period'));input.focus();input.select();}

// The shortcut modifier: Ctrl on Windows, Cmd on macOS.
export const mod = (event) => event.ctrlKey || event.metaKey;

export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value == null || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key.startsWith('aria-') || key.startsWith('data-')) el.setAttribute(key,String(value));
    else if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
    else el[key] = value;
  }
  el.append(...children.flat().filter((child) => child != null && child !== false));
  if(tag==='input'&&(props['data-date']||el.classList.contains('date')||/dd-mm-yyyy/i.test(el.placeholder)||/\bdate\b/i.test(el.getAttribute('aria-label')||'')))dateInput(el,parseDate);
  if(tag==='select') sideSelect(el);
  return el;
}

// ---- money (integer paise) and dates (ISO yyyy-mm-dd, shown dd-mm-yyyy) ----

const inr = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const money = (paise) => inr.format(Math.abs(paise) / 100);
export const signed = (paise) => (paise < 0 ? '-' : '') + money(paise);
export const drcr = (paise) => (paise ? `${money(paise)} ${paise > 0 ? 'Dr' : 'Cr'}` : '');
export const plain = (paise) => (Math.abs(paise) / 100).toFixed(2);

export function parseMoney(text) {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(String(text).replace(/,/g, '').trim());
  return match ? Number(match[1]) * 100 + Number((match[2] || '').padEnd(2, '0')) : null;
}

const pad = (n) => String(n).padStart(2, '0');
export function today() {
  const now = new Date();
  const date=`${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  return date<fiscalContext.active.from?fiscalContext.active.from:date>fiscalContext.active.to?fiscalContext.active.to:date;
}
export const showDate = (iso) => iso.split('-').reverse().join('-');

// Accepts "6", "6-11", "6/11/26" or "06-11-2026". Missing parts come from today.
export function parseDate(text) {
  let value=String(text).trim().replace(/[-/. ]+$/,'');
  if(/^\d{4}(?:\d{2}|\d{4})?$/.test(value))value=value.slice(0,2)+'-'+value.slice(2,4)+(value.length>4?'-'+value.slice(4):'');
  const parts = value.split(/[-/. ]+/);
  if (!parts[0] || parts.length > 3 || parts.some((part) => !/^\d+$/.test(part))) return null;
  const [year, month] = today().split('-').map(Number);
  const d = Number(parts[0]);
  const m = parts[1] ? Number(parts[1]) : month;
  const y = parts[2] ? (parts[2].length <= 2 ? 2000 + Number(parts[2]) : Number(parts[2])) : year;
  const date = new Date(Date.UTC(y, m - 1, d));
  const real = date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
  return real && y >= 1900 && y <= 9999 ? `${y}-${pad(m)}-${pad(d)}` : null;
}

// Quantities are integer thousandths of a unit.
export function parseQty(text) {
  const match = /^(\d+)(?:\.(\d{1,3}))?$/.exec(String(text).trim());
  return match ? Number(match[1]) * 1000 + Number((match[2] || '').padEnd(3, '0')) : null;
}
export const showQty = (thousandths) => String(thousandths / 1000);

// Expiry is a month, stored yyyy-mm and typed "3-27" or "03/2027".
export function parseExpiry(text) {
  const match = /^(\d{1,2})[-/. ](\d{2}|\d{4})$/.exec(String(text).trim());
  if (!match || Number(match[1]) < 1 || Number(match[1]) > 12) return null;
  return `${match[2].length === 2 ? 2000 + Number(match[2]) : match[2]}-${pad(Number(match[1]))}`;
}
export const showExpiry = (iso) => (iso ? iso.split('-').reverse().join('-') : '');

// ---- form helpers ----

export const focus = (input) => {
  if(!input)return;
  for(let parent=input.parentElement;parent;parent=parent.parentElement)parent.revealEntry?.(input);
  input.focus(); input.select?.();
};

export const enterKey = (input, action) => input.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter') return;
  event.preventDefault();
  action();
});

export const labelled = (text, ...inputs) => h('label', {}, h('span', {}, text), h('div', { class: inputs.length > 1 ? 'field pair' : 'field' }, inputs));

// Key handler for a simple form: Enter moves to the next field and saves on the last.
export function formKeys(fields, save) {
  return (event) => {
    const at = fields.indexOf(event.target);
    if (mod(event) && event.code === 'KeyS') save();
    else if (event.key === 'Enter' && at === fields.length - 1) save();
    else if (event.key === 'Enter' && at >= 0) focus(fields[at + 1]);
    else return false;
    event.preventDefault();
    return true;
  };
}

// ---- toast ----

let toastTimer;
export function toast(message, kind = 'ok') {
  const el = document.getElementById('toast');
  el.textContent = message;
  el.className = kind;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, kind === 'error' ? 4000 : 2000);
}

// ---- option menus: the dropdown under a field and the list inside a picker ----

const choicePageSize=()=>Math.max(3,Math.floor((innerHeight-230)/46));
let choicePanel,choiceTitle,choiceBody,choiceOwner,choiceClose;
function showChoices(input,ul,close){
  if(!choicePanel){
    choiceTitle=h('h2');choiceBody=h('div',{class:'choice-body'});
    choicePanel=h('aside',{class:'choice-panel',hidden:true,'aria-label':'Selection list'},
      choiceTitle,h('p',{},'Type to filter · ↑ ↓ to choose'),choiceBody,
      h('p',{class:'choice-help'},'PgUp / PgDn: page · Enter: select · Esc: close'));
    document.body.append(choicePanel);
    window.addEventListener('resize',()=>choiceBody.firstElementChild?.refreshChoices?.());
    new MutationObserver(()=>{if(choiceOwner&&!choiceOwner.isConnected)choiceClose?.();}).observe(document.getElementById('main'),{childList:true,subtree:true});
  }
  if(choiceOwner!==input)choiceClose?.();
  choiceOwner=input;choiceClose=close;
  choicePanel.querySelector('.choice-help').textContent='PgUp / PgDn: page · Enter: select · Esc: close'+(input.dataset.inlineCreate?' · Alt+C: create / Ctrl+Enter: edit':'');
  choiceTitle.textContent=input.getAttribute('aria-label')||input.closest('label')?.querySelector('span')?.textContent?.replace(/\s*\*$/,'')||input.placeholder||'Select an option';
  choiceBody.replaceChildren(ul);choicePanel.hidden=false;
  ul.refreshChoices?.();
  input.setAttribute('aria-expanded','true');
}
function hideChoices(input){
  input.setAttribute('aria-expanded','false');
  input.removeAttribute('aria-activedescendant');
  if(choiceOwner!==input)return;
  choicePanel.hidden=true;choiceBody.replaceChildren();choiceOwner=null;choiceClose=null;
}

function createChoice(input){input.dispatchEvent(new KeyboardEvent('keydown',{key:'c',code:'KeyC',altKey:true,bubbles:true,cancelable:true}));}
function optionMenu(ul, onChoose) {
  let items = [];
  let index = -1;
  function page(){
    const size=ul.closest('.choice-body')?Math.max(1,Math.floor((ul.closest('.choice-body').clientHeight-32)/46)):choicePageSize(),start=Math.floor(Math.max(0,index)/size)*size;
    ul.choicePageSize=size;
    [...ul.children].forEach((node,at)=>{node.hidden=at<start||at>=start+size;});
    ul.dataset.page=items.length?`${start+1}–${Math.min(start+size,items.length)} of ${items.length}`:'No matching options';
    [...ul.children].forEach((node,at)=>node.setAttribute('aria-selected',String(at===index)));
  }
  ul.refreshChoices=page;
  return {
    set(next, start) {
      const create=ul.choiceInput?.dataset.inlineCreate==='true';
      items = create?[{label:'Create new',hint:'Alt+C',create:true},...next]:next;
      index = items.length ? (start<0?start:start+(create?1:0)) : -1;
      ul.replaceChildren(...items.map((item, i) => h('li', {
        class: i === index ? 'on' : '',
        role:'option',title:item.label,'data-create':item.create?'true':null,
        onmousedown: (event) => { event.preventDefault(); (item.create?createChoice(ul.choiceInput):onChoose(item)); },
      }, h('span', {}, item.label), item.hint ? h('small', {}, item.hint) : null)));
      page();
    },
    move(step) {
      if (!items.length) return;
      ul.children[index]?.classList.remove('on');
      index = index < 0 ? (step > 0 ? 0 : items.length - 1) : (index + step % items.length + items.length) % items.length;
      ul.children[index].classList.add('on');
      page();
    },
    current: () => items[index],
  };
}

function matching(items, text, limit) {
  const query = text.trim().toLowerCase();
  if (!query) return items.slice(0, limit);
  const starts = [];
  const contains = [];
  for (const item of items) {
    const at = item.label.toLowerCase().indexOf(query);
    if (at === 0) starts.push(item);
    else if (at > 0 || String(item.search || '').toLowerCase().includes(query)) contains.push(item);
  }
  return [...starts, ...contains].slice(0, limit);
}

// Type-ahead on a text field. The chosen item's id is kept in input.dataset.id.
// Choices appear in the shared right rail while focus stays in the field.
export function suggest(input, { items, onPick, onCreate, onEdit=onCreate?.edit }) {
  const ul = h('ul', { class: 'suggest', hidden: true,role:'listbox' });
  ul.choiceInput=input;
  input.setAttribute('aria-autocomplete','list');
  let moved = false;
  const close=()=>{ul.hidden=true;hideChoices(input);};

  const choose = async (item,editing=false) => {
    if(item.create){createChoice(input);return;}
    input.value = item.label;
    input.dataset.id = item.id;
    close();
    input.dispatchEvent(new Event('change',{bubbles:true}));
    await onPick?.(item,editing);
  };
  const menu = optionMenu(ul, choose);
  if(onCreate||onEdit){
    input.title='Alt+C: create / Ctrl+Enter: edit selected master';
    input.dataset.inlineEdit=onEdit?'true':'';
    input.dataset.inlineCreate='true';
    input.addEventListener('keydown',event=>{
      const creating=event.altKey&&event.code==='KeyC'&&!mod(event)&&!event.shiftKey;
      const editing=mod(event)&&event.key==='Enter'&&!event.altKey;
      if(creating&&onCreate||editing&&onEdit){
        event.preventDefault();event.stopImmediatePropagation();close();
        const selected=(moved&&!menu.current()?.create?menu.current():null)||items().find(row=>String(row.id)===input.dataset.id)||(menu.current()?.create?null:menu.current());
        if(editing&&!selected){toast('Select a master to edit first','error');return;}
        const done=async row=>{await choose(row,editing);input.focus();};
        Promise.resolve(editing?onEdit(selected,done):onCreate(done)).catch(error=>toast(error.message,'error'));
      }
    },true);
  }
  const open = () => {
    const found = matching(items(), input.dataset.id?'':input.value, Infinity);
    // Nothing is highlighted on an empty field, so Enter there means "no ledger".
    menu.set(found, input.dataset.id?found.findIndex(item=>String(item.id)===input.dataset.id):input.value.trim()?0:-1);
    moved = false;
    ul.hidden = false;
    showChoices(input,ul,close);
  };

  input.addEventListener('focus', open);
  input.addEventListener('input', () => { delete input.dataset.id; open(); });
  input.addEventListener('blur', () => {
    close();
    if (input.dataset.id) return;
    const text = input.value.trim().toLowerCase();
    const exact = text && items().find((item) => item.label.toLowerCase() === text || String(item.search || '').toLowerCase() === text);
    if (exact) choose(exact);
  });
  input.addEventListener('keydown', (event) => {
    if(event.altKey||mod(event))return;
    if (['ArrowDown','ArrowUp','PageDown','PageUp'].includes(event.key)) {
      if (ul.hidden) open();
      menu.move(({ArrowDown:1,ArrowUp:-1,PageDown:ul.choicePageSize||choicePageSize(),PageUp:-(ul.choicePageSize||choicePageSize())})[event.key]);
      moved = true;
    } else if (event.key === 'Enter' && !ul.hidden && menu.current() && (moved || !input.dataset.id)) {
      choose(menu.current());
    } else if(event.key==='Escape'&&!ul.hidden){close();
    } else {
      return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
  });
  return { chooseCurrent() {
    if(ul.hidden||!menu.current()||(!moved&&!input.value.trim()))return false;
    choose(menu.current());return true;
  } };
}

// Keep the select's value/change contract for existing forms and filters,
// but route its choices to the same rail instead of the operating-system popup.
function sideSelect(input){
  const ul=h('ul',{class:'suggest',role:'listbox'});
  ul.choiceInput=input;
  let query='',opened=false;
  const close=()=>{opened=false;query='';delete input.dataset.choiceQuery;hideChoices(input);};
  const choose=item=>{
    if(item.create){createChoice(input);return;}
    input.value=item.id;input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));close();
  };
  const menu=optionMenu(ul,choose);
  const open=()=>{
    input.dataset.choiceQuery=query;
    const options=[...input.options].filter(option=>!option.disabled&&!option.hidden).map(option=>({id:option.value,label:option.textContent}));
    const found=matching(options,query,Infinity);
    menu.set(found,query?0:found.findIndex(option=>option.id===input.value));opened=true;showChoices(input,ul,close);
  };
  input.addEventListener('focus',open);
  input.addEventListener('blur',close);
  input.addEventListener('mousedown',event=>{event.preventDefault();input.focus();open();});
  input.addEventListener('keydown',event=>{
    if(event.key==='F4'||event.altKey&&event.key==='ArrowDown'){
      event.preventDefault();event.stopImmediatePropagation();open();return;
    }
    if(mod(event)||event.altKey)return;
    if(['ArrowDown','ArrowUp','PageDown','PageUp'].includes(event.key)){
      if(!opened)open();menu.move(({ArrowDown:1,ArrowUp:-1,PageDown:ul.choicePageSize||choicePageSize(),PageUp:-(ul.choicePageSize||choicePageSize())})[event.key]);
      const item=menu.current();if(item&&!item.create){input.value=item.id;input.dispatchEvent(new Event('change',{bubbles:true}));}
    }else if(event.key==='Escape'&&opened)close();
    else if(event.key==='Enter'&&opened){const item=menu.current();if(item?.create){event.preventDefault();event.stopImmediatePropagation();}if(item)choose(item);return;}
    else if(event.key===' '&&!opened)open();
    else if(event.key==='Backspace'||event.key.length===1){query=event.key==='Backspace'?query.slice(0,-1):query+event.key;open();}
    else return;
    event.preventDefault();event.stopImmediatePropagation();
  });
}

// A Dr/Cr field: D or C sets it, Space flips it.
export function sideInput(value = 'Dr') {
  const input = h('input', { class: 'side', readOnly: true, value });
  input.addEventListener('keydown', (event) => {
    if (event.ctrlKey || event.altKey) return;
    const key = event.key.toLowerCase();
    const next = key === 'd' ? 'Dr' : key === 'c' ? 'Cr' : key === ' ' ? (input.value === 'Dr' ? 'Cr' : 'Dr') : null;
    if (!next) return;
    event.preventDefault();
    if (next !== input.value) {
      input.value = next;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }
  });
  return input;
}

// ---- modal dialogs: they take every key until closed ----

export function modal(content, onKey, side=false) {
  const previous = document.activeElement;
  const overlay = h('div', { class: side?'overlay side-picker':'overlay' }, h('div', { class: 'dialog' }, content));
  const handler = (event) => { if([...document.querySelectorAll('body > .overlay')].at(-1)!==overlay)return;event.stopPropagation(); onKey(event); };
  document.body.append(overlay);
  window.addEventListener('keydown', handler, true);
  return () => {
    window.removeEventListener('keydown', handler, true);
    overlay.remove();
    previous?.focus?.();
  };
}

export function confirmBox(message) {
  return new Promise((resolve) => {
    let selected=0;
    const finish=value=>{close();resolve(value);};
    const buttons=[true,false].map((value,index)=>h('button',{type:'button',onclick:()=>finish(value),onfocus:()=>select(index,false)},h('kbd',{},value?'Y':'N'),value?'Yes':'No'));
    function select(index,moveFocus=true){
      selected=index;
      buttons.forEach((button,at)=>{button.classList.toggle('selected',at===selected);button.setAttribute('aria-pressed',String(at===selected));button.tabIndex=at===selected?0:-1;});
      if(moveFocus)buttons[selected].focus();
    }
    const choices=h('div',{class:'confirm-choices',role:'group','aria-label':'Confirmation choice'},buttons);
    const close = modal([h('h3', {}, message), choices,h('p',{class:'tip confirm-help'},'← / → Choose · Enter Select · Y Yes · N / Esc No')], (event) => {
      event.preventDefault();
      const key = event.key.toLowerCase();
      if(key==='arrowleft'||key==='arrowright'||key==='tab')select(1-selected);
      else if(key==='enter'||key===' ')finish(selected===0);
      else if(key==='y')finish(true);
      else if(key==='n'||key==='escape')finish(false);
    });
    select(0);
  });
}

export function ask(title, value = '') {
  return new Promise((resolve) => {
    const input = h('input', { class: 'wide', value, 'data-date':/dd-mm-yyyy/i.test(title) });
    const close = modal([h('h3', {}, title), input], (event) => {
      if (event.key !== 'Enter' && event.key !== 'Escape') return;
      event.preventDefault();
      close();
      resolve(event.key === 'Enter' ? input.value.trim() : null);
    });
    input.focus();
    input.select();
  });
}

export function picker(title, items, typed = '') {
  return new Promise((resolve) => {
    const input = h('input', { class: 'wide', placeholder: 'Type to search', value: typed });
    const ul = h('ul', { class: 'pick' });
    const done = (item) => { close(); resolve(item); };
    const menu = optionMenu(ul, done);
    const render = () => menu.set(matching(items, input.value, Infinity), 0);
    const close = modal([h('h3', {}, title), input, ul], (event) => {
      if (['ArrowDown','ArrowUp','PageDown','PageUp'].includes(event.key)) menu.move(({ArrowDown:1,ArrowUp:-1,PageDown:choicePageSize(),PageUp:-choicePageSize()})[event.key]);
      else if (event.key === 'Enter') { if (menu.current()) done(menu.current()); }
      else if (event.key === 'Escape') done(null);
      else return;
      event.preventDefault();
    },true);
    input.addEventListener('input', render);
    render();
    input.focus();
  });
}

// ---- list: a table with a selected row, moved by the arrow keys ----
// Columns are { label, cls, get(row) }. A row's `kind` becomes its CSS class.

export function typeToSearch(event,input){
  if(!input||input.disabled||input.readOnly||!input.getClientRects().length||event.defaultPrevented||event.isComposing||mod(event)||event.altKey||event.key.length!==1||event.key===' ')return false;
  if(event.target?.closest?.('input,textarea,select')||event.target?.isContentEditable)return false;
  event.preventDefault();input.value=event.key;input.dispatchEvent(new Event('input',{bubbles:true}));input.focus();input.setSelectionRange(input.value.length,input.value.length);return true;
}

export async function exportReport(data){
  try{const choice=await picker('Export report',[{id:'xlsx',label:'Excel workbook (.xlsx)',hint:'Formatted workbook with numeric amounts'},{id:'pdf',label:'PDF document (.pdf)',hint:'Print-ready report with page numbers'}]);if(!choice)return;
    const result=await window.files.call('exportReport',{...data,format:choice.id});if(result.saved)toast('Report exported');
  }catch(error){toast(error.message,'error');}
}
export function reportCell(value,numeric){
  if(typeof value==='number')return value;
  if(numeric&&typeof value==='string'&&/^-?[0-9,]+(?:\.[0-9]+)?$/.test(value))return Number(value.replaceAll(',',''));
  return value??'';
}
export function createList({ columns, onEnter, filter = false, empty = 'Nothing to show yet' }) {
  let exportContext=()=>({title:document.querySelector('#title')?.textContent||'Report'});
  let rows = [];
  let shown = [];
  let index = 0;
  const tbody = h('tbody');
  const input = filter ? h('input', { class: 'filter', placeholder: 'Type to search' }) : null;
  const note = h('p', { class: 'empty', hidden: true }, empty);
  const head = h('thead', {}, h('tr', {}, columns.map((column) => h('th', { class: column.cls }, column.label))));
  const scroll = h('div', { class: 'scroll', tabIndex: -1 }, h('table', {}, head, tbody), note);
  const el = h('section', { class: 'list' }, input, scroll);

  function select(next) {
    tbody.children[index]?.classList.remove('on');
    index = Math.max(0, Math.min(shown.length - 1, next));
    const tr = tbody.children[index];
    if (!tr) return;
    tr.classList.add('on');
    tr.scrollIntoView({ block: 'nearest' });
  }

  function render(start) {
    const query = input ? input.value.trim().toLowerCase() : '';
    shown = query ? rows.filter((item) => item.text.includes(query)) : rows;
    tbody.replaceChildren(...shown.map((item, i) => h('tr', {
      class: item.row.kind || '',
      onclick: () => select(i),
      ondblclick: () => onEnter?.(item.row),
    }, item.cells.map((text, c) => h('td', { class: columns[c].cls }, text)))));
    note.hidden = shown.length > 0;
    index = 0;
    select(start);
  }

  input?.addEventListener('input', () => render(0));

  const api={
    el,
    setRows(next, start = index) {
      rows = next.map((row) => {
        const cells = columns.map((column) => column.get(row) ?? '');
        return { row, cells, text: cells.join(' ').toLowerCase() };
      });
      render(start === 'last' ? rows.length - 1 : start);
    },
    setExportContext(value){exportContext=typeof value==='function'?value:()=>value;},
    exportReport:()=>exportReport({...exportContext(),columns:columns.map(c=>c.label),formats:columns.map(c=>c.format||'text'),rows:shown.map(item=>columns.map((c,index)=>c.exportGet?c.exportGet(item.row):reportCell(item.cells[index],c.cls==='num'))),kinds:shown.map(item=>item.row.kind||''),...(input?.value?{subtitle:[exportContext().subtitle,'Filter: '+input.value].filter(Boolean).join(' | ')}:{})}),
    current: () => shown[index]?.row,
    focus: () => (input || scroll).focus(),
    onKey(event) {
      if(typeToSearch(event,input))return true;
      const steps = { ArrowDown: 1, ArrowUp: -1, PageDown: 15, PageUp: -15 };
      if(event.altKey&&event.code==='KeyE'){api.exportReport();}
      else if(event.altKey&&event.code==='KeyX')window.files.call('exportTable',{columns:columns.map(c=>c.label),rows:shown.map(item=>item.cells)}).then(result=>{if(result.saved)toast('Report exported');}).catch(error=>toast(error.message,'error'));
      else if (event.key in steps) select(index + steps[event.key]);
      else if (event.key === 'Enter' && shown[index]) onEnter?.(shown[index].row);
      else return false;
      event.preventDefault();
      return true;
    },
  };
  return api;
}

// Preserve text deletion; an empty field (or a non-text control) goes back.
window.addEventListener('keydown',event=>{
 if(event.key!=='Backspace'||event.altKey||mod(event)||event.shiftKey)return;
 const target=event.target;
 if(!target.closest?.('#main,.dialog')||target.isContentEditable)return;
 if((target.matches('input,textarea')&&!target.readOnly&&target.value)||target.tagName==='SELECT'&&target.dataset.choiceQuery)return;
 event.preventDefault();event.stopImmediatePropagation();
 const tab=new KeyboardEvent('keydown',{key:'Tab',code:'Tab',shiftKey:true,bubbles:true,cancelable:true});
 if(!target.dispatchEvent(tab))return;
 const scope=target.closest('.dialog')||document.getElementById('main');
 const fields=[...scope.querySelectorAll('input,select,textarea,button,[tabindex]')].filter(el=>!el.disabled&&el.tabIndex>=0&&el.getClientRects().length);
 const at=fields.indexOf(target);if(at>0)focus(fields[at-1]);
},true);
