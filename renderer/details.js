import {masterActions} from './inline-master.js';
import { h,call,labelled,toast,parseMoney,plain,showDate,parseDate,suggest,focus,mod } from './ui.js';
import { entryPage,rowPages } from './keyboard-pages.js';

export function recordExtras(scope,onChange=()=>{},options={}) {
  let original={},fields=[],controls=new Map(),files=[],pending=new Set(),settings={},chargeRows=[],ledgers=[];
  let detailPage=null,chargePage=null,panels=[],filesPageIndex=-1;
  const base={},body=h('div',{class:'extra-body'});
  const el=h('div',{class:'record-extras'},h('button',{onclick:()=>openDetails()},'Details & additional fields · Alt+E'),h('button',{onclick:()=>openDetails(true)},'Images & attachments · Alt+A'));
  body.addEventListener('input',onChange);body.addEventListener('change',onChange);
  const attachmentList=h('div',{class:'attachment-list'});
  const filePages=rowPages(attachmentList,{size:2,label:'Files'});
  function drawFiles(){attachmentList.replaceChildren(...files.map(file=>h('div',{class:'attachment-card'},
    file.preview?h('img',{src:file.preview,alt:file.name}):h('span',{class:'pdf-file'},'PDF'),
    h('span',{},file.name),h('small',{},`${Math.ceil(file.size/1024)} KB · local`),
    h('button',{onclick:()=>window.files.call('export',{id:file.id}).catch(e=>toast(e.message,'error'))},'Save a copy'),
    h('button',{onclick:async()=>{files=files.filter(f=>f.id!==file.id);if(pending.has(file.id)){await call('discardFiles',{ids:[file.id]});pending.delete(file.id);}drawFiles();onChange();}},'Remove'))));}
  async function attach(){
    try {
      if(!settings.attachments)throw Error('Enable attachments in Forms & feature settings first');
      const added=await window.files.call('pick');
      if(files.length+added.length>10){await call('discardFiles',{ids:added.map(f=>f.id)});throw Error('Attach up to 10 files per record');}
      for(const file of added){files.push(file);pending.add(file.id);}drawFiles();if(added.length)onChange();
      if(!detailPage)openDetails(true);else if(filesPageIndex>=0)detailPage.show(filesPageIndex);
    }catch(e){toast(e.message,'error');}
  }
  const chargeList=h('div',{class:'charge-list'});
  const inlineCharges=()=>typeof options.inlineCharges==='function'?options.inlineCharges():Boolean(options.inlineCharges);
  const chargePages=rowPages(chargeList,{size:()=>inlineCharges()?2:innerHeight<660?3:5,label:'Ledger entries'});
  const chargesEl=h('section',{class:'ledger-charges',hidden:Boolean(options.separateCharges)},h('h3',{},'Ledger / expense entries'),h('p',{class:'tip'},'Additional ledger amounts (+ additions / − deductions). No automatic GST on these amounts. Enter on an empty ledger continues to narration.'),chargeList,h('button',{onclick:()=>{addCharge();onChange();}},'Add ledger entry'));
  chargesEl.append(chargePages.el);
  chargesEl.append(h('button',{class:'charges-done',onclick:finishCharges},'Done · Ctrl+Enter'));
  function finishCharges(){
    for(const row of [...chargeRows])if(!row.account.value.trim()&&!row.amount.value.trim()){chargeRows=chargeRows.filter(entry=>entry!==row);row.node.remove();}
    if(inlineCharges()){chargesEl.hidden=!chargeRows.length;options.onChargesDone?.();}
    else chargePage?.close(options.onChargesDone);
  }
  const refreshChargeLedgers=async()=>{ledgers=(await call('ledgers')).filter(l=>!['Bank Accounts','Cash-in-Hand','Sundry Debtors','Sundry Creditors','Duties & Taxes'].includes(l.accountGroup||l.groupName)).map(l=>({...l,label:l.name,hint:l.groupName}));};
  function addCharge(value={}) {
    const account=h('input',{placeholder:'Expense / adjustment ledger',value:value.ledgerId?ledgers.find(l=>l.id===value.ledgerId)?.label||'':''});
    if(value.ledgerId)account.dataset.id=value.ledgerId;
    const amount=h('input',{class:'num',placeholder:'Amount (+ / -)',value:value.amount?`${value.amount<0?'-':''}${plain(value.amount)}`:''});
    const row={account,amount};
    account.setAttribute('aria-label','Charge ledger');amount.setAttribute('aria-label','Charge amount');
    const node=h('div',{class:'charge-row'},h('div',{class:'field'},account),amount,h('button',{onclick:()=>{chargeRows=chargeRows.filter(r=>r!==row);node.remove();onChange();}},'Remove'));
    row.node=node;chargeRows.push(row);chargeList.append(node);
    const picked=suggest(account,{onCreate:masterActions('ledger',()=>options.documentType?.()==='Purchase'?'Indirect Expenses':'Indirect Incomes'),items:()=>ledgers,onPick:()=>{onChange();focus(amount);}});
    account.addEventListener('keydown',event=>{
      if(event.key!=='Enter')return;event.preventDefault();
      if(account.dataset.id)focus(amount);
      else if(account.value.trim()){if(!picked.chooseCurrent())toast('Choose an expense, income or adjustment ledger','error');}
      else if(amount.value.trim())toast('Choose the ledger for this amount','error');
      else finishCharges();
    });
    amount.addEventListener('keydown',event=>{
      if(event.key!=='Enter')return;event.preventDefault();
      if(!signedAmount(amount))return toast('Enter a non-zero ledger amount','error');
      if(!account.dataset.id)return focus(account);
      focusCharge();
    });
    node.addEventListener('input',onChange);
    if(!value.ledgerId)focus(account);
  }
  function focusCharge(){
    chargesEl.hidden=false;
    chargesEl.classList.toggle('inline-charges',inlineCharges());
    if(!inlineCharges()&&!chargePage)chargePage=entryPage('Ledger / expense entries',[{title:'Additional ledger amounts',nodes:[chargesEl]}],{onDone:options.onChargesDone,onReturn:refreshChargeLedgers,onClosed:()=>{chargePage=null;chargesEl.hidden=true;},onKey:event=>{
      if(mod(event)&&event.key==='Delete'&&chargesEl.contains(event.target)){event.preventDefault();event.target.closest('.charge-row')?.querySelector('button').click();focusCharge();return true;}
      return options.onKey?.(event);
    }});
    focus((chargeRows.find(row=>!row.account.value&&!row.amount.value)||addChargeRow()).account);
  }
  function addChargeRow(){addCharge();return chargeRows.at(-1);}
  function signedAmount(input){const s=input.value.trim();const n=parseMoney(s.replace(/^[-+]/,''));return n===null?null:(s.startsWith('-')?-n:n);}
  function read() {
    const custom={...original.custom};
    for(const f of fields){const input=controls.get(f.id);if(!input)continue;const v=input.value.trim();if(f.kind==='date'&&v&&!parseDate(v))throw Error(`${f.label}: enter a valid date`);custom[f.id]=f.kind==='boolean'?(v===''?'':v==='true'):f.kind==='number'?(v===''?'':Number(v)):f.kind==='date'?(v?parseDate(v):''):v;}
    const values={...original,custom,attachments:files.map(f=>f.id)};
    if(base.dueDate?.value.trim()&&!parseDate(base.dueDate.value))throw Error('Enter a valid due date');
    if(base.roundOff?.value.trim()&&signedAmount(base.roundOff)===null)throw Error('Enter a valid round-off amount');
    for(const [key,input] of Object.entries(base))values[key]=key==='dueDate'?(input.value.trim()?parseDate(input.value):''):key==='roundOff'?(input.value.trim()?signedAmount(input):null):input.value;
    if(scope==='document'&&!options.manual)values.charges=chargeRows.filter(r=>r.account.value||r.amount.value).map(r=>({ledgerId:Number(r.account.dataset.id),amount:signedAmount(r.amount)}));
    return values;
  }
  async function load(id,initial,documentDate) {
    [settings,fields,original]=await Promise.all([call('settings'),call('customFields',{scope}),initial?Promise.resolve(initial):id?call('recordDetails',{scope,id}):Promise.resolve({custom:{},attachments:[]})]);
    controls=new Map();for(const key of Object.keys(base))delete base[key];body.replaceChildren();chargeRows=[];chargeList.replaceChildren();pending=new Set();panels=[];
    const defaults=scope==='document'?{terms:settings.defaultTerms}:{};original={...defaults,...original};
    const names=scope==='document'?(options.manual?{reference:'Reference',notes:'Notes'}:{billNumber:'Supplier bill number',orderNumber:'Customer / purchase order reference',reference:'Reference',dueDate:'Due / expected date',notes:'Notes',terms:'Terms & conditions',roundOff:'Round off (+ / -, max 1.00)'}):scope==='item'?{sku:'SKU / barcode',description:'Item description'}:{email:'Email',address:'Billing address'};
    const standard=h('div',{class:'extra-grid'});
    for(const [key,input] of Object.entries(options.fields||{})){base[key]=input;input.value=original[key]??'';}
    for(const [key,label] of Object.entries(names)){
      if(options.fields?.[key])continue;
      const textarea=['notes','terms','description','address'].includes(key);
      const value=original[key]??'';
      base[key]=h(textarea?'textarea':'input',{'data-date':key==='dueDate',rows:textarea?3:undefined,maxLength:5000,value:key==='dueDate'&&value?showDate(value):key==='roundOff'&&value!==''?`${value<0?'-':''}${plain(value)}`:value});
      const quotation=options.documentType?.()==='Quotation';
      const field=labelled(quotation&&key==='dueDate'?'Quotation valid until':quotation&&key==='orderNumber'?'Enquiry / customer reference':quotation&&key==='terms'?'Quotation terms & conditions':label,base[key]);
      if(quotation&&key==='billNumber'&&!value)field.hidden=true;
      standard.append(field);
    }
    standard.hidden=scope==='document'&&!settings.documentDetails&&!Object.keys(names).some(k=>original[k]);
    body.append(standard);
    addPanels(scope==='document'?'Document details':scope==='item'?'Item details':'Ledger details',standard);
    if(scope==='document'&&!options.manual){
      await refreshChargeLedgers();
      chargesEl.hidden=true;
      for(const charge of original.charges||[])addCharge(charge);
      chargesEl.classList.toggle('inline-charges',inlineCharges());
      chargesEl.hidden=!inlineCharges()||!chargeRows.length;
      if(!base.dueDate.value&&settings.defaultCreditDays&&documentDate)suggestDue(settings.defaultCreditDays,documentDate);
    }
    const custom=h('div',{class:'extra-grid'});
    for(const f of fields){
      if(!f.active)continue;
      let input;
      if(f.kind==='select'||f.kind==='boolean'){
        const opts=f.kind==='boolean'?[['true','Yes'],['false','No']]:f.options.map(v=>[v,v]);
        if(f.kind==='select'&&original.custom?.[f.id]&&!f.options.includes(original.custom[f.id]))opts.push([original.custom[f.id],original.custom[f.id]+' (saved)']);
        input=h('select',{},h('option',{value:''},'Choose…'),...opts.map(([value,label])=>h('option',{value},label)));
      }else input=h('input',{maxLength:2000,placeholder:f.kind==='date'?'dd-mm-yyyy':f.kind==='number'?'Number':''});
      const value=original.custom?.[f.id]??'';input.value=f.kind==='date'&&value?showDate(value):String(value);
      controls.set(f.id,input);custom.append(labelled(`${f.label}${f.required?' *':''}`,input));
    }
    custom.hidden=!settings.customFields&&!fields.some(f=>f.active&&f.required)&&!Object.values(original.custom||{}).some(v=>v!==''&&v!=null);
    if(controls.size)body.append(h('h3',{},'Additional fields'),custom);
    addPanels('Additional fields',custom);
    files=await Promise.all((original.attachments||[]).map(id=>call('fileInfo',{id})));
    const attachmentBox=h('div',{class:'attachment-page'},h('h3',{},scope==='item'?'Item images & files':'Images & attachments'),h('p',{class:'tip'},'Stored locally with this record. PNG, JPEG, WebP or PDF · 10 MB per file.'),h('button',{onclick:attach},'Choose files (Alt+A)'),attachmentList,filePages.el);
    attachmentBox.hidden=!settings.attachments&&!files.length;body.append(attachmentBox);drawFiles();
    if(!attachmentBox.hidden)panels.push({title:'Images & attachments',nodes:[attachmentBox],files:true});
  }
  function addPanels(title,grid){
    if(grid.hidden)return;
    const labels=[...grid.children].filter(node=>!node.hidden);
    for(let at=0;at<labels.length;at+=4){
      const panel=h('div',{class:'extra-grid entry-field-grid'},...labels.slice(at,at+4));body.append(panel);
      panel.addEventListener('input',onChange);panel.addEventListener('change',onChange);
      panels.push({title,nodes:[panel]});
    }
  }
  function openDetails(filesOnly=false){
    if(detailPage)return;
    const sections=filesOnly?panels.filter(panel=>panel.files):panels;
    if(!sections.length)return toast('No additional fields are enabled');
    filesPageIndex=sections.findIndex(panel=>panel.files);
    detailPage=entryPage(filesOnly?'Images & attachments':'Record details',sections,{onClosed:()=>{detailPage=null;},onKey:event=>{
      if(event.altKey&&event.code==='KeyA'){event.preventDefault();attach();return true;}return false;
    }});
  }
  function suggestDue(days,date){if(!base.dueDate||base.dueDate.value||!date||!days)return;const d=new Date(`${date}T00:00:00Z`);d.setUTCDate(d.getUTCDate()+days);base.dueDate.value=showDate(d.toISOString().slice(0,10));}
  return {el,load,read,attach,suggestDue,chargesEl,focusCharge,refreshChargeLedgers,
    committed(){pending.clear();},
    async discard(){if(pending.size)await call('discardFiles',{ids:[...pending]});pending.clear();},
    focus(){openDetails();},
    onKey(e){
      if(inlineCharges()&&mod(e)&&e.key==='Enter'&&chargesEl.contains(e.target)){e.preventDefault();finishCharges();return true;}
      if(mod(e)&&e.key==='Delete'&&chargesEl.contains(e.target)){
        const row=e.target.closest('.charge-row');if(!row)return false;
        e.preventDefault();row.querySelector('button').click();focusCharge();return true;
      }
      if(e.altKey&&e.code==='KeyA'){e.preventDefault();attach();return true;}if(e.altKey&&e.code==='KeyE'){e.preventDefault();this.focus();return true;}return false;
    },
  };
}
