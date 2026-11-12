import { typeToSearch,h,call,focus,mod,money,drcr,plain,showQty,showDate,parseDate,toast,confirmBox } from './ui.js';
import { push } from './router.js';
import { ledgerForm,groupForm } from './ledgers.js';
import { itemForm } from './items.js';
import { bookForm,priceEntries } from './pricebooks.js';
import { invoiceEntry } from './invoice.js';
import { voucherEntry } from './voucher.js';
import { createVouchers } from './create.js';
import {catalogKinds,catalogForm} from './catalog.js';
import {fieldForm} from './settings.js';
import {accountBooks} from './account-books.js';
import {dateModes} from './date-modes.js';

const moneyColumn=(label,get)=>({label,get,number:true});
const column=(label,get)=>({label,get});
const types=['Sales','Purchase','Payment','Receipt','Contra','Journal','Credit Note','Debit Note','Stock Journal','Quotation','Sales Order','Purchase Order'];
const choices=[
  {name:'Ledgers',noun:'ledger',load:()=>call('ledgers'),edit:ledgerForm,create:()=>ledgerForm(),remove:'deleteLedger',
    filters:[['','All ledgers'],['Sundry Debtors','Customers'],['Sundry Creditors','Suppliers'],['money','Cash & bank']],
    match:(row,value)=>!value||(value==='money'?['Cash-in-Hand','Bank Accounts'].includes(row.accountGroup):row.accountGroup===value),
    columns:[column('Ledger',row=>row.name),column('Under group',row=>row.groupName),column('Phone',row=>row.phone),moneyColumn('Balance',row=>drcr(row.balance))]},
  {name:'Items',noun:'item',load:()=>call('items'),edit:itemForm,create:()=>itemForm(),remove:'deleteItem',
    filters:[['','All items'],['stock','In stock'],['empty','Out of stock']],match:(row,value)=>!value||(value==='stock'?row.stock>0:row.stock<=0),
    columns:[column('Item',row=>row.name),column('SKU / category',row=>[row.sku,row.category].filter(Boolean).join(' · ')),moneyColumn('Sale rate',row=>money(row.saleRate)),moneyColumn('Stock',row=>`${showQty(row.stock)} ${row.unit}`)]},
  {name:'Account groups',noun:'group',load:async()=>{const rows=await call('groups'),names=new Map(rows.map(row=>[row.id,row.name]));return rows.map(row=>({...row,parentName:names.get(row.parentId)||'Primary group'}));},edit:groupForm,create:()=>groupForm(),remove:'deleteGroup',
    filters:[['','All groups'],['custom','Created groups'],['system','Built-in groups']],match:(row,value)=>!value||(value==='system'?row.builtIn:!row.builtIn),protected:row=>row.builtIn,
    columns:[column('Group',row=>row.name),column('Under',row=>row.parentName),column('Nature',row=>row.nature),column('Origin',row=>row.builtIn?'Built-in':'Created')]},
  {name:'Pricebooks',noun:'pricebook',load:()=>call('pricebooks'),edit:bookForm,create:()=>bookForm(),remove:'deletePricebook',
    filters:[['','All pricebooks'],['active','Active'],['inactive','Inactive']],match:(row,value)=>!value||(value==='active'?!!row.active:!row.active),
    columns:[column('Pricebook',row=>row.name),column('Mode',row=>row.mode),moneyColumn('Percent',row=>plain(row.pct)),column('Status',row=>!row.active?'Inactive':row.is_default?'Default':'Active')]},
  {name:'Vouchers',noun:'voucher',load:()=>call('dayBook'),edit:row=>row.document?invoiceEntry({id:row.id}):voucherEntry({id:row.id}),create:()=>createVouchers(),remove:'deleteVoucher',
    filters:[['','All voucher types'],...types.map(type=>[type,type])],match:(row,value)=>!value||row.type===value,
    columns:[column('Date',row=>showDate(row.date)),column('Type / number',row=>`${row.type} ${row.number}`),column('Particulars',row=>row.particulars||row.narration),moneyColumn('Amount',row=>money(row.amount))]},
];

export async function mastersWorkspace(){
  const definitions=[choices[0],choices[2],choices[1],choices[3],...catalogKinds.map(([kind,name])=>({
    name,noun:kind,load:async()=>{const rows=await call('catalogMasters',{kind});return kind==='unit'?rows.map(row=>({...row,parentSymbol:rows.find(parent=>parent.id===row.relatedId)?.symbol||rows.find(parent=>parent.id===row.relatedId)?.name})):rows;},create:()=>catalogForm(kind),edit:row=>catalogForm(kind,row),remove:'deleteCatalogMaster',
    filters:[['',`All ${name.toLowerCase()}`]],match:()=>true,
    columns:kind==='unit'?[column('Unit name',row=>row.name),column('Symbol',row=>row.symbol||row.name),column('Description',row=>row.description),column('Conversion',row=>row.relatedId?`1 ${row.symbol||row.name} = ${row.conversion} ${row.parentSymbol}`:'Independent')]:[column('Name / code',row=>row.name),column('Details',row=>kind==='gstSlab'?`${plain(row.rate)}%`:kind==='gstRegistration'?row.gstin:row.description),column('Status',row=>row.isDefault?'Company default':'')],
  }))];
  if((await call('settings')).dropdownMasters)definitions.push({name:'Dropdowns',noun:'dropdown',load:async()=>(await call('customFields',{scope:'item'})).filter(row=>row.kind==='select').map(row=>({...row,name:row.label})),create:()=>fieldForm(null,{scope:'item',kind:'select'}),edit:row=>fieldForm(row),remove:'deleteCustomField',filters:[['','All item dropdowns']],match:()=>true,columns:[column('Field',row=>row.label),column('Choices',row=>row.options.join(', ')),column('Status',row=>row.active?'Active':'Inactive')]});
  return manageRecords({masters:true,definitions});
}

export function manageRecords({masters=false,definitions=choices}={}){
  const choices=definitions;
  const masterKeys=['F1','F2','F3','F4','F5','F6','F7','F8','F11','F12'];
  let category=0,all=[],visible=[],index=0,busy=false,request=0;
  const saved=choices.map(()=>({query:'',filter:'',from:'',to:'',id:null,index:0}));
  const name=h('h2'),subtitle=h('p',{class:'tip'}),search=h('input',{placeholder:'Search by name, group, reference or number…'});
  search.setAttribute('aria-label','Search records');
  const filter=h('select');filter.setAttribute('aria-label','Record type');
  const from=h('input',{placeholder:'From · dd-mm-yyyy'}),to=h('input',{placeholder:'To · dd-mm-yyyy'});
  from.setAttribute('aria-label','From date');to.setAttribute('aria-label','To date');
  const dateRange=h('div',{class:'manage-dates'},from,to);
  dateRange.prepend(dateModes(from,to,()=>applyFilters()));
  const head=h('thead'),body=h('tbody'),empty=h('p',{class:'empty'});
  const table=h('table',{},head,body);
  const results=h('div',{class:'manage-results',tabIndex:0},table,empty);
  results.setAttribute('aria-label','Records. Use arrow keys to select and Enter to edit.');
  const create=h('button',{onclick:()=>open(true)},'Create · Alt+C');
  const edit=h('button',{onclick:()=>open()},'Edit · Enter');
  const remove=h('button',{class:'danger-action',onclick:()=>removeRecord()},'Delete · Alt+D');
  const prices=h('button',{onclick:()=>openPrices()},'Item prices · Alt+P');
  const statement=h('button',{onclick:()=>openStatement()},'Ledger · Alt+L');
  const pageText=h('span'),previous=h('button',{onclick:()=>select(index-pageSize())},'PgUp'),next=h('button',{onclick:()=>select(index+pageSize())},'PgDn');
  const selection=h('div',{class:'manage-selection'});
  const categoryButtons=choices.map((choice,at)=>h('button',{onclick:()=>switchCategory(at)},h('kbd',{},masters?masterKeys[at]||'↕':`F${at+1}`),h('span',{},choice.name)));
  const masterSections=[['Accounting',[0,1]],['Inventory',[2,3,4,5,6,10]],['GST & Taxes',[7,8,9]]];
  const navigationOrder=masters?masterSections.flatMap(([,indices])=>indices.filter(index=>index<choices.length)):choices.map((_,index)=>index);
  const railContent=masters?masterSections.flatMap(([title,indices])=>[h('h4',{class:'master-section-title'},title),...indices.filter(index=>index<choices.length).map(index=>categoryButtons[index])]):categoryButtons;
  const rail=h('aside',{class:'manage-rail workspace-menu-card'},h('h3',{},masters?'Masters':'Manage records'),...railContent,selection,
    h('p',{class:'tip'},'↑ ↓ Select · Enter Edit',h('br'),'Ctrl+L Search · F6 Refresh',h('br'),'Deletion asks for confirmation.'));
  const el=h('section',{class:masters?'manage-workspace masters-workspace':'manage-workspace'},h('div',{class:'manage-body'},
    h('div',{class:'manage-heading'},h('p',{class:'eyebrow'},masters?'MASTERS':'ALTER & MAINTAIN'),name,subtitle),
    h('div',{class:'manage-filters'},search,filter),dateRange,
    h('div',{class:'manage-actions'},create,edit,remove,prices,statement),results,
    h('div',{class:'manage-pagination'},pageText,previous,next)),rail);
  const current=()=>visible[index],definition=()=>choices[category];
  if(masters){
    el.prepend(rail);
    rail.setAttribute('aria-label','Master types');
    rail.querySelector('.tip').textContent='F11: GST slabs · F12: HSN / SAC · Alt+M: master types · F9: refresh';
    el.addEventListener('keydown',event=>{
      if(event.altKey||mod(event))return;
      if(rail.contains(event.target)){
        const step=['ArrowDown','PageDown'].includes(event.key)?1:['ArrowUp','PageUp'].includes(event.key)?-1:0;
        if(step){
          event.preventDefault();event.stopPropagation();
          if(!busy)switchCategory(navigationOrder[(navigationOrder.indexOf(category)+step+navigationOrder.length)%navigationOrder.length],true);
        }else if(event.key==='Tab'&&!event.shiftKey){event.preventDefault();event.stopPropagation();results.focus();}
      }else if(event.target===results&&event.key==='Tab'&&event.shiftKey){
        event.preventDefault();event.stopPropagation();categoryButtons[category].focus();
      }
    });
  }
  const label=row=>definition().noun==='voucher'?`${row.type} No. ${row.number} (${showDate(row.date)})`:row.name;
  const pageSize=()=>{
    const height=parseFloat(getComputedStyle(results).getPropertyValue('--record-row-height'))||40;
    return Math.max(1,Math.floor((results.clientHeight-height-2)/height));
  };
  function remember(){saved[category]={query:search.value,filter:filter.value,from:from.value,to:to.value,id:current()?.id,index};}
  function draw(){
    const size=pageSize(),start=Math.floor(index/size)*size,row=current(),protectedRow=row&&definition().protected?.(row);
    body.replaceChildren(...visible.slice(start,start+size).map((record,offset)=>{
      const node=h('tr',{class:start+offset===index?'on':'',onclick:()=>{select(start+offset);results.focus();},ondblclick:()=>open()},
        ...definition().columns.map(col=>h('td',{class:col.number?'num':'',title:String(col.get(record)??'')},col.get(record)??'')));
      node.setAttribute('aria-selected',String(start+offset===index));return node;
    }));
    edit.disabled=remove.disabled=busy||!row||!!protectedRow;create.disabled=busy;prices.disabled=busy||!row;
    previous.disabled=busy||index<size;next.disabled=busy||start+size>=visible.length;
    pageText.textContent=`${visible.length} records · ${visible.length?start+1:0}–${Math.min(start+size,visible.length)} shown`;
    table.hidden=!visible.length;empty.hidden=!!visible.length;
    selection.replaceChildren(h('p',{class:'eyebrow'},'SELECTED'),h('strong',{},row?label(row):'No record selected'),h('p',{},protectedRow?'Built-in groups are read-only.':row?'Enter to edit this record.':'Change the search or filter, or create a record.'));
    if(row)selection.title=label(row);
  }
  function applyFilters(preserve=false){
    const old=current()?.id,query=search.value.trim().toLowerCase();
    const fromDate=from.value.trim()?parseDate(from.value):null,toDate=to.value.trim()?parseDate(to.value):null;
    const invalid=definition().noun==='voucher'&&((from.value.trim()&&!fromDate)||(to.value.trim()&&!toDate)||(fromDate&&toDate&&fromDate>toDate));
    visible=invalid?[]:all.filter(row=>definition().match(row,filter.value)&&
      (definition().noun!=='voucher'||(!fromDate||row.date>=fromDate)&&(!toDate||row.date<=toDate))&&
      (!query||[...definition().columns.map(col=>col.get(row)),row.narration,row.sku,row.brand,row.hsn].join(' ').toLowerCase().includes(query)));
    index=preserve?Math.max(0,visible.findIndex(row=>row.id===old)):0;
    empty.textContent=invalid?'Enter valid dates; From must be on or before To.':all.length?'No matching records. Clear the search or change the filter.':'No records yet. Press Alt+C to create one.';
    draw();
  }
  function select(at){if(busy)return;index=Math.max(0,Math.min(visible.length-1,at));draw();}
  async function reload(preserve=true){
    const token=++request,selectedId=preserve?(current()?.id??saved[category].id):null,selectedIndex=preserve?index:0;
    busy=true;draw();
    try{
      const records=await definition().load();if(token!==request)return;
      all=definition().noun==='voucher'?records.slice().reverse():records;
      applyFilters();const found=visible.findIndex(row=>row.id===selectedId);index=found>=0?found:Math.max(0,Math.min(visible.length-1,selectedIndex));
    }catch(error){if(token===request){all=[];visible=[];toast(error.message,'error');empty.textContent=`Could not load records. Press ${masters?'F9':'F6'} to retry.`;}}
    finally{if(token===request){busy=false;draw();}}
  }
  async function switchCategory(at,keepRail=false){
    if(busy)return;remember();category=at;all=[];visible=[];index=saved[at].index;
    const choice=definition();name.textContent=choice.name;subtitle.textContent='Browse, create, edit or delete records in your local books.';
    search.value=saved[at].query;filter.replaceChildren(...choice.filters.map(([value,text])=>h('option',{value},text)));filter.value=saved[at].filter;
    from.value=saved[at].from;to.value=saved[at].to;dateRange.hidden=definition().noun!=='voucher';prices.hidden=definition().noun!=='pricebook';statement.hidden=!['ledger','item'].includes(definition().noun);
    head.replaceChildren(h('tr',{},...choice.columns.map(col=>h('th',{class:col.number?'num':''},col.label))));
    categoryButtons.forEach((button,i)=>{button.classList.toggle('active',i===category);button.setAttribute('aria-pressed',String(i===category));if(masters)button.tabIndex=i===category?0:-1;});
    await reload();if(keepRail){categoryButtons[category].focus();categoryButtons[category].scrollIntoView({block:'nearest'});}else if(masters)results.focus();else search.focus();
  }
  async function open(isNew=false){
    if(busy)return;const row=current();if(!isNew&&(!row||definition().protected?.(row)))return;
    remember();try{await push(isNew?definition().create():definition().edit(row));}catch(error){toast(error.message,'error');}
  }
  function openPrices(){if(!busy&&definition().noun==='pricebook'&&current()){remember();push(priceEntries(current()));}}
  function openStatement(){if(!busy&&current()&&['ledger','item'].includes(definition().noun))push(accountBooks({mode:definition().noun==='ledger'?'accounts':'stock',selectedId:current().id}));}
  async function removeRecord(){
    const row=current();if(busy||!row||definition().protected?.(row))return;
    const descriptor=label(row),choice=definition();busy=true;draw();
    try{
      const extra=definition().noun==='voucher'?' Accounting and stock postings for this voucher will also be removed.':'';
      if(!await confirmBox(`Delete ${choice.noun} “${descriptor}”?${extra}`))return;
      await call(choice.remove,{id:row.id});toast(`${descriptor} deleted`);
      busy=false;await reload();
    }catch(error){toast(/FOREIGN KEY/i.test(error.message)?'This record is used by another record and cannot be deleted.':error.message,'error');}
    finally{busy=false;draw();results.focus();}
  }
  search.addEventListener('input',()=>applyFilters());filter.addEventListener('change',()=>applyFilters());
  for(const input of [from,to])input.addEventListener('input',()=>applyFilters());
  let resize;
  const screen={title:masters?'Masters':'Manage Records',el,hints:[[masters?'F1–F8 / F11 / F12':'F1–F5','Record type'],['↑ / ↓','Select'],['PgUp / PgDn','Page'],['Enter / Alt+E','Edit'],['Alt+D','Delete'],['Alt+C','Create'],['Ctrl+L','Search'],['Esc','Back']],
    async onShow(returning){
      if(!resize){resize=new ResizeObserver(()=>draw());resize.observe(results);}
      if(returning){await reload();if(masters)results.focus();else search.focus();}else await switchCategory(category);
    },onClose(){resize?.disconnect();},
    functionKey(event){
      if(mod(event)||event.altKey||event.shiftKey)return false;
      if(masters&&masterKeys.includes(event.key)){event.preventDefault();switchCategory(masterKeys.indexOf(event.key));return true;}
      if((masters?/^F[1-8]$/:/^F[1-5]$/).test(event.key)){event.preventDefault();switchCategory(Number(event.key.slice(1))-1);return true;}
      if(event.key===(masters?'F9':'F6')){event.preventDefault();if(!busy)reload();return true;}return false;
    },
    onKey(event){
      if(screen.functionKey(event))return true;
      if(masters&&event.altKey&&event.code==='KeyM'){event.preventDefault();categoryButtons[category].focus();return true;}
      if(mod(event)&&event.code==='KeyL'){event.preventDefault();focus(search);return true;}
      if(busy){event.preventDefault();return true;}
      if(typeToSearch(event,search))return true;
      if(event.altKey&&event.code==='KeyC')open(true);
      else if(event.altKey&&event.code==='KeyE')open();
      else if(event.altKey&&event.code==='KeyD')removeRecord();
      else if(event.altKey&&event.code==='KeyP')openPrices();
      else if(event.altKey&&event.code==='KeyL')openStatement();
      else if(event.target===filter)return false;
      else if(event.key==='ArrowDown')select(index+1);
      else if(event.key==='ArrowUp')select(index-1);
      else if(event.key==='PageDown')select(index+pageSize());
      else if(event.key==='PageUp')select(index-pageSize());
      else if(event.key==='Enter')open();
      else return false;
      event.preventDefault();return true;
    },
  };return screen;
}
