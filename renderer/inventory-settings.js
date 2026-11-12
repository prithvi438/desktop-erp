import {h,call,labelled,toast,mod,confirmBox,createList,plain,parseMoney,parseQty,showQty,parseDate,showDate,formKeys} from './ui.js';
import {push,pop} from './router.js';
import {yesNo} from './yes-no.js';

export function inventorySettings() {
  let saved='',loaded=false;
  const labels={discountRules:'Apply item discount defaults and limits',freeOffers:'Enable buy / get offers and free quantities',batchTracking:'Maintain batches',expiryTracking:'Maintain expiry dates'};
  const flags=Object.fromEntries(Object.keys(labels).map(key=>[key,yesNo()]));
  const sort=h('select',{},...[['expiry','Earliest expiry first (FEFO)'],['oldest','Oldest received batch first'],['name','Batch name']].map(([value,label])=>h('option',{value},label)));
  const days=h('input',{type:'number',min:0,max:3650});
  const values=()=>({...Object.fromEntries(Object.entries(flags).map(([key,input])=>[key,input.checked])),batchSort:sort.value,nearExpiryDays:Number(days.value)});
  const el=h('section',{class:'form master-form inventory-settings'},h('div',{class:'ledger-heading'},h('h2',{},'Inventory features'),h('span',{},'Y / N · ← / → · Tab / Enter')),
    h('fieldset',{class:'master-group'},h('legend',{},'Discounts & schemes'),...['discountRules','freeOffers'].map(key=>labelled(labels[key],flags[key])),h('button',{onclick:()=>push(inventoryRuleList())},'Item discount & offer rules')),
    h('fieldset',{class:'master-group'},h('legend',{},'Batch & expiry'),...['batchTracking','expiryTracking'].map(key=>labelled(labels[key],flags[key])),labelled('Suggest batches in this order',sort),labelled('Near-expiry warning window (days)',days),h('p',{class:'tip'},'Existing batch and expiry history is retained. Named batch stock must be cleared before switching batches off. Expiry protection is configured under Retail controls.')),
    h('div',{class:'ledger-footer'},h('button',{onclick:save},'Save features · Ctrl+S')));
  async function save(){try{const data=values();await call('saveSettings',data);saved=JSON.stringify(data);toast('Inventory features saved');}catch(e){toast(e.message,'error');}}
  const canLeave=()=>JSON.stringify(values())===saved||confirmBox('Leave without saving inventory features?');
  const fields=[...Object.values(flags),sort,days];
  return {title:'Inventory features',el,canLeave,hints:[['Y / N','Yes / No'],['← / →','Toggle'],['Enter / Tab','Next'],['Ctrl+S','Save'],['Esc','Back']],async onShow(){if(!loaded){const data=await call('settings');for(const [key,input]of Object.entries(flags))input.checked=data[key];sort.value=data.batchSort;days.value=data.nearExpiryDays;saved=JSON.stringify(values());loaded=true;}fields[0].focus();},onKey(e){if(e.key==='Escape'){e.preventDefault();Promise.resolve(canLeave()).then(ok=>{if(ok)pop();});return true;}return formKeys(fields,save)(e);}};
}

export function inventoryRuleList(){
  const list=createList({filter:true,empty:'Create an item in Masters first.',columns:[{label:'Item',get:r=>r.name},{label:'Stock unit',get:r=>r.unit},{label:'Sales discount %',get:r=>plain(r.inventoryRules.saleDefault)},{label:'Buy / free',get:r=>r.inventoryRules.buyQty?`${showQty(r.inventoryRules.buyQty)} / ${showQty(r.inventoryRules.freeQty)}`:'—'}],onEnter:item=>push(inventoryRuleForm(item))});
  return {title:'Item discount & offer rules',el:list.el,hints:[['Type','Search'],['↑ / ↓','Item'],['Enter','Edit rules'],['Esc','Back']],async onShow(){list.setRows(await call('items'));list.focus();},onKey:list.onKey};
}

export function inventoryRuleForm(item){
  let saved='',loaded=false;
  const discounts=Object.fromEntries(['saleMin','saleDefault','saleMax','purchaseMin','purchaseDefault','purchaseMax'].map(key=>[key,h('input',{class:'num'})]));
  const buy=h('input',{class:'num'}),free=h('input',{class:'num'}),sales=yesNo(),purchases=yesNo(),starts=h('input',{placeholder:'dd-mm-yyyy; blank = any'}),ends=h('input',{placeholder:'dd-mm-yyyy; blank = any'});
  const values=()=>({itemId:item.id,...Object.fromEntries(Object.entries(discounts).map(([key,input])=>[key,parseMoney(input.value)])),buyQty:parseQty(buy.value||'0'),freeQty:parseQty(free.value||'0'),offerSales:sales.checked,offerPurchases:purchases.checked,starts:starts.value.trim()?parseDate(starts.value):'',ends:ends.value.trim()?parseDate(ends.value):''});
  const el=h('section',{class:'form master-form inventory-settings'},h('div',{class:'ledger-heading'},h('h2',{},item.name),h('span',{},`Discounts & offers · Stock unit: ${item.unit}`)),
    h('div',{class:'ledger-columns'},...['sale','purchase'].map(side=>h('fieldset',{class:'master-group'},h('legend',{},side==='sale'?'Sales discounts':'Purchase discounts'),...['Min','Default','Max'].map((suffix,index)=>labelled(['Minimum %','Default %','Maximum %'][index],discounts[side+suffix]))))),
    h('fieldset',{class:'master-group'},h('legend',{},'Same-item buy / get offer'),labelled(`Buy quantity (${item.unit})`,buy),labelled(`Free quantity (${item.unit})`,free),labelled('Apply on sales / sales orders',sales),labelled('Apply on purchases / purchase orders',purchases),labelled('Valid from',starts),labelled('Valid through',ends),h('p',{class:'tip'},'Enter 1 buy + 1 free for BOGO. Each complete buy quantity on a line earns the free quantity. Free stock is additional to billed quantity, at no extra charge. Returns accept the free quantity actually returned. Set both quantities to 0 to remove the offer.')),
    h('p',{class:'tip'},'Enable discounts and offers in Inventory features. The existing item maximum discount also applies to sales. Historical voucher lines retain their saved discounts and free quantities.'),h('div',{class:'ledger-footer'},h('button',{onclick:save},'Save rules · Ctrl+S')));
  const fields=[...Object.values(discounts),buy,free,sales,purchases,starts,ends];
  async function save(){try{if(starts.value.trim()&&!parseDate(starts.value)||ends.value.trim()&&!parseDate(ends.value))throw Error('Enter valid offer dates');const data=values();await call('saveInventoryRules',data);saved=JSON.stringify(data);toast('Item rules saved');pop();}catch(e){toast(e.message,'error');}}
  const canLeave=()=>saved===JSON.stringify(values())||confirmBox('Leave without saving item rules?');
  return {title:`Rules: ${item.name}`,el,canLeave,hints:[['Enter / Tab','Next'],['Y / N','Yes / No'],['Ctrl+S','Save'],['Esc','Back']],async onShow(){if(!loaded){const data=await call('inventoryRules',{itemId:item.id});for(const [key,input]of Object.entries(discounts))input.value=plain(data[key]);buy.value=showQty(data.buyQty);free.value=showQty(data.freeQty);sales.checked=data.offerSales;purchases.checked=data.offerPurchases;starts.value=showDate(data.starts);ends.value=showDate(data.ends);saved=JSON.stringify(values());loaded=true;}fields[0].focus();},onKey(e){if(e.key==='Escape'){e.preventDefault();Promise.resolve(canLeave()).then(ok=>{if(ok)pop();});return true;}return formKeys(fields,save)(e);}};
}
