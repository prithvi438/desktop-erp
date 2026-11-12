import {h,call,labelled,formKeys,suggest,plain,parseMoney,toast,confirmBox} from './ui.js';
import {pop} from './router.js';
import {inlineMaster} from './inline-master.js';
export const catalogKinds=[['category','Item categories'],['itemGroup','Item groups'],['unit','Units'],['gstRegistration','Company GST'],['gstSlab','GST slabs'],['hsn','HSN / SAC']];
export function catalogForm(kind,row=null,onSaved=null){
  if(kind==='unit')return unitForm(row,onSaved);
  if(kind==='category'||kind==='itemGroup')return itemClassificationForm(kind,row,onSaved);
  let dirty=false,slabs=[];
  const input=(value='',maxLength=100)=>h('input',{value,maxLength});
  const name=input(row?.name),description=input(row?.description||'',500),rate=input(row?plain(row.rate||0):''),slab=input();
  if(row?.relatedId)slab.dataset.id=row.relatedId;
  const legalName=input(row?.legalName),gstin=input(row?.gstin,'15'),state=input(row?.state),address=input(row?.address||'',5000),isDefault=h('input',{type:'checkbox',checked:Boolean(row?.isDefault)});
  const fields=[name];const body=h('div',{class:'catalog-fields'},labelled(kind==='hsn'?'HSN / SAC code *':'Name *',name));
  if(kind==='gstSlab'){body.append(labelled('GST percentage *',rate));fields.push(rate);}
  if(kind==='hsn'){body.append(labelled('GST slab *',slab));fields.push(slab);suggest(slab,{items:()=>slabs,onCreate:inlineMaster((done,row)=>catalogForm('gstSlab',row,done),()=>call('catalogMasters',{kind:'gstSlab'}))});}
  if(kind==='gstRegistration'){
    for(const [label,field] of [['Legal business name *',legalName],['GSTIN *',gstin],['State *',state],['Address',address],['Use for this company',isDefault]]){body.append(labelled(label,field));fields.push(field);}
  }
  body.append(labelled('Description',description));fields.push(description);
  const title=catalogKinds.find(([key])=>key===kind)[1];
  const el=h('section',{class:'form catalog-form'},h('h2',{},`${row?'Edit':'Create'} · ${title}`),body,
    h('p',{class:'tip'},kind==='gstRegistration'?'The default registration supplies GSTIN, state and address to company billing.':kind==='hsn'?'Select the slab that applies to this code. Saved vouchers retain their original tax amounts.':'Enter your business master details. GST rates and classifications are configured by you.'),h('div',{class:'master-actions catalog-save'},h('button',{type:'button',onclick:save},h('span',{},row?'Save changes':'Save master'),h('kbd',{},'Ctrl+S'))));
  el.addEventListener('input',()=>{dirty=true;});el.addEventListener('change',()=>{dirty=true;});
  async function save(){try{const result=await call('saveCatalogMaster',{id:row?.id,kind,name:name.value,description:description.value,rate:kind==='gstSlab'?parseMoney(rate.value):0,relatedId:Number(slab.dataset.id)||null,legalName:legalName.value,gstin:gstin.value,state:state.value,address:address.value,isDefault:isDefault.checked});dirty=false;toast('Master saved');if(onSaved)await onSaved(result);else pop();}catch(error){toast(error.message,'error');}}
  const canLeave=()=>!dirty||confirmBox('Leave without saving this master?');
  return {title,el,canLeave,hints:[['Enter / Tab','Next field'],['Ctrl+S','Save'],['Esc','Back']],async onShow(){if(kind==='hsn'){slabs=(await call('catalogMasters',{kind:'gstSlab'})).map(r=>({...r,label:r.name,hint:`${plain(r.rate)}%`}));slab.value=slabs.find(r=>r.id===Number(slab.dataset.id))?.name||'';}name.focus();},onKey(event){if(event.key==='Escape'){event.preventDefault();Promise.resolve(canLeave()).then(ok=>{if(ok)pop();});return true;}return formKeys(fields,save)(event);}};
}

function itemClassificationForm(kind,row,onSaved){
  let dirty=false,saving=false;
  const category=kind==='category',label=category?'item category':'item group';
  const name=h('input',{value:row?.name||'',maxLength:category?40:100,placeholder:category?'e.g. Beverages':'e.g. Soft drinks'});
  const description=h('input',{value:row?.description||'',maxLength:500,placeholder:'Optional notes about the items included'});
  const saveButton=h('button',{onclick:save},`Save ${category?'category':'group'} · Ctrl+S`);
  const canLeave=()=>!dirty||confirmBox(`Leave without saving this ${label}?`);
  const cancel=()=>Promise.resolve(canLeave()).then(ok=>{if(ok)pop();});
  const title=`${row?'Alter':'Create'} ${label}`;
  const el=h('section',{class:'form master-form ledger-compact classification-form'},
    h('div',{class:'ledger-heading'},h('h2',{},title),h('span',{},'Inventory masters')),
    h('div',{class:'ledger-columns ledger-single'},h('fieldset',{class:'master-group'},h('legend',{},category?'Category details':'Group details'),
      labelled('Name *',name),labelled('Description',description),
      h('p',{class:'tip'},`Select this ${category?'category':'group'} when creating or editing an item to organise your inventory.`))),
    h('div',{class:'ledger-footer'},h('span',{},'Only name is required.'),saveButton,h('button',{onclick:cancel},'Cancel · Esc')));
  el.addEventListener('input',()=>{dirty=true;});
  async function save(){
    if(saving)return;
    if(!name.value.trim()){toast(`Enter an ${label} name`,'error');name.focus();return;}
    saving=true;saveButton.disabled=true;
    try{const result=await call('saveCatalogMaster',{id:row?.id,kind,name:name.value,description:description.value});dirty=false;toast(category?'Item category saved':'Item group saved');if(onSaved)await onSaved(result);else pop();}
    catch(error){toast(error.message,'error');}finally{saving=false;saveButton.disabled=false;}
  }
  return {title,el,canLeave,hints:[['Enter / Tab','Next field'],['Ctrl+S','Save'],['Esc','Back']],onShow(){name.focus();},onKey(event){if(event.key==='Escape'){event.preventDefault();cancel();return true;}return formKeys([name,description],save)(event);}};
}

function unitForm(row,onSaved){
  let dirty=false,saving=false,units=[];
  const name=h('input',{value:row?.name||'',maxLength:100}),symbol=h('input',{value:row?.symbol||row?.name||'',maxLength:10});
  const description=h('input',{value:row?.description||'',maxLength:500}),parent=h('input',{placeholder:'None — independent unit'}),conversion=h('input',{value:row?.conversion||'1',inputMode:'decimal'});
  if(row?.relatedId)parent.dataset.id=row.relatedId;
  const preview=h('p',{class:'tip unit-equation'}),saveButton=h('button',{onclick:save},'Save unit · Ctrl+S');
  const cancel=()=>Promise.resolve(canLeave()).then(ok=>{if(ok)pop();});
  const el=h('section',{class:'form master-form ledger-compact unit-form'},
    h('div',{class:'ledger-heading'},h('h2',{},row?'Alter unit':'Create unit'),h('span',{},'Alt+C creates a related unit')),
    h('div',{class:'ledger-columns'},
      h('fieldset',{class:'master-group'},h('legend',{},'Unit details'),labelled('Name *',name),labelled('Symbol *',symbol),labelled('Description',description)),
      h('fieldset',{class:'master-group'},h('legend',{},'Related unit / inheritance'),labelled('Inherit from',parent),labelled('Equivalent quantity',conversion),preview,
        h('p',{class:'tip'},'Example: Kilogram (kg), inherit from Gram (g), equivalent quantity 1000. Leave inheritance blank for an independent unit.'))),
    h('div',{class:'ledger-footer'},h('span',{},'One stock balance, expressed in related units.'),saveButton,h('button',{onclick:cancel},'Cancel · Esc')));
  function update(){conversion.disabled=!parent.dataset.id;const base=units.find(unit=>unit.id===Number(parent.dataset.id));preview.textContent=base?`1 ${symbol.value||name.value||'unit'} = ${conversion.value||'?'} ${base.symbol||base.name}`:'Independent stock unit';}
  suggest(parent,{items:()=>units.filter(unit=>unit.id!==row?.id).map(unit=>({...unit,label:unit.name,hint:unit.symbol||unit.name})),onPick:update,onCreate:inlineMaster((done,row)=>unitForm(row,done),()=>call('catalogMasters',{kind:'unit'}))});
  name.addEventListener('blur',()=>{if(!symbol.value.trim())symbol.value=name.value.trim().slice(0,10);update();});
  el.addEventListener('input',()=>{dirty=true;update();});el.addEventListener('change',()=>{dirty=true;update();});
  const canLeave=()=>!dirty||confirmBox('Leave without saving this unit?');
  async function save(){if(saving)return;if(parent.value.trim()&&!parent.dataset.id){toast('Select a related unit from the list','error');parent.focus();return;}saving=true;saveButton.disabled=true;
    try{const result=await call('saveCatalogMaster',{id:row?.id,kind:'unit',name:name.value,symbol:symbol.value.trim()||name.value.trim(),description:description.value,relatedId:Number(parent.dataset.id)||null,conversion:conversion.value});dirty=false;toast('Unit saved');if(onSaved)await onSaved(result);else pop();}
    catch(error){toast(error.message,'error');}finally{saving=false;saveButton.disabled=false;}}
  return {title:'Units',el,canLeave,hints:[['Enter / Tab','Next field'],['Alt+C','Create related unit'],['Ctrl+S','Save'],['Esc','Back']],async onShow(){units=await call('catalogMasters',{kind:'unit'});parent.value=units.find(unit=>unit.id===Number(parent.dataset.id))?.name||parent.value;update();name.focus();},onKey(event){if(event.key==='Escape'){event.preventDefault();cancel();return true;}return formKeys([name,symbol,description,parent,conversion].filter(field=>!field.disabled),save)(event);}};
}
