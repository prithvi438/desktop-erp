import {inventoryRuleForm} from './inventory-settings.js';
import {inlineMaster} from './inline-master.js';
import {catalogForm} from './catalog.js';
import {bookForm} from './pricebooks.js';
import { h, call, money, plain, parseMoney, parseQty, showQty, suggest, toast, formKeys, labelled, confirmBox } from './ui.js';
import { recordExtras } from './details.js';
import { push, pop } from './router.js';
import { masterList } from './masters.js';

export const itemList = () => masterList({
  title: 'Items',
  noun: 'item',
  empty: 'No items yet. Press Alt+C to create one.',
  columns: [
    { label: 'Item', get: (row) => row.name },
    { label: 'SKU / barcode', get: (row) => row.sku },
    { label: 'Category', get: (row) => row.category },
    { label: 'Brand', get: (row) => row.brand },
    { label: 'HSN', get: (row) => row.hsn },
    { label: 'GST %', cls: 'num', get: (row) => plain(row.gstRate) },
    { label: 'Sale rate', cls: 'num', get: (row) => money(row.saleRate) },
    { label: 'In stock', cls: 'num', get: (row) => `${showQty(row.stock)} ${row.unit}` },
  ],
  load: () => call('items'),
  form: itemForm,
  remove: (row) => call('deleteItem', { id: row.id }),
});

export function itemForm(item = null, onSaved = null) {
  let dirty=false;
  const extras=recordExtras('item',()=>{dirty=true;});
  // Categories, brands and units already in use are offered while typing.
  const used = { category: [], brand: [], unit: [] };
  let catalog=[],slabs=[],books=[];
  const createCatalog=kind=>inlineMaster((done,row)=>catalogForm(kind,row,done),async()=>(await call('catalogMasters',{kind})).map(row=>({...row,label:kind==='unit'?(row.symbol||row.name):row.name})));
  const input = (cls, value = '', maxLength = 100) => h('input', { class: cls, value, maxLength });
  const name = input('wide', item?.name);
  const unit = input('wide', item?.unit ?? 'PCS', 100);
  const hsn = input('wide', item?.hsn, 10);
  const category = input('wide', item?.category, 40);
  const brand = input('wide', item?.brand, 40);
  const itemGroup=input('wide',item?.itemGroup),slab=input('wide'),book=input('wide'),bookPrice=input('num');
  for(const [box,key] of [[unit,'unitId'],[category,'categoryId'],[hsn,'hsnId'],[itemGroup,'itemGroupId'],[slab,'gstSlabId']])if(item?.[key])box.dataset.id=item[key];
  const gst = input('num', item ? plain(item.gstRate) : '');
  const saleRate = input('num', item ? plain(item.saleRate) : '');
  const purchaseRate = input('num', item ? plain(item.purchaseRate) : '');
  const reorder = input('num', item?.reorderLevel ? showQty(item.reorderLevel) : '');
  const maxDiscount=input('num',plain(item?.maxDiscount??10000)),maxQty=input('num',item?.maxQty?showQty(item.maxQty):'');
  const stopSales=h('input',{type:'checkbox',checked:Boolean(item?.stopSales)}),rack=input('wide',item?.rack||'',80);

  const advanced=h('details',{class:'ledger-billing'},h('summary',{},'Pricebooks, limits & location · Alt+B'),
    h('div',{class:'ledger-billing-fields'},labelled('Pricebook (optional)',book),labelled('Price in this book',bookPrice),labelled('Maximum discount %',maxDiscount),labelled('Maximum bill quantity (0 = unlimited)',maxQty),labelled('Stop sales / sales orders',stopSales),labelled('Rack / shelf',rack)));
  const unitHint=h('p',{class:'tip'},'Stock and default prices use this unit. Related units are available in vouchers.');
  const el = h('section', { class: 'form master-form ledger-compact item-compact' },
    h('div',{class:'ledger-heading'},h('h2',{},item?'Alter item':'Create item'),h('span',{},'Enter / Tab: next · Alt+C: create master')),
    h('div',{class:'ledger-columns'},
      h('fieldset',{class:'master-group'},h('legend',{},'Item details'),labelled('Name *',name),labelled('Unit',unit),labelled('Item group',itemGroup),labelled('Category',category),labelled('Manufacturer / brand',brand),labelled('Reorder level',reorder),unitHint),
      h('fieldset',{class:'master-group'},h('legend',{},'Pricing & GST'),labelled('HSN code',hsn),labelled('GST slab',slab),labelled('GST %',gst),labelled('Sale rate',saleRate),labelled('Purchase rate',purchaseRate),h('p',{class:'tip'},'Prices are per stock unit. Selecting an HSN fills its GST slab and rate.'))),advanced,
    h('div',{class:'ledger-footer'},h('span',{},'Alt+E: additional details and custom fields'),h('button',{onclick:save},'Save item · Ctrl+S'),h('button',{onclick:()=>canLeave().then(ok=>{if(ok)pop();})},'Cancel · Esc')));
  el.revealEntry=field=>{if(advanced.contains(field))advanced.open=true;};
  for (const [field, box] of [['unit', unit], ['category', category], ['brand', brand]]) suggest(box, { items: () => used[field],onCreate:field==='brand'?undefined:createCatalog(field) });
  suggest(itemGroup,{onCreate:createCatalog('itemGroup'),items:()=>catalog.filter(row=>row.kind==='itemGroup').map(row=>({...row,label:row.name}))});
  const syncTax=()=>{slab.disabled=Boolean(hsn.dataset.id);gst.readOnly=Boolean(hsn.dataset.id||slab.dataset.id);};
  suggest(hsn,{onCreate:createCatalog('hsn'),items:()=>catalog.filter(row=>row.kind==='hsn').map(row=>({...row,label:row.name,hint:`${plain(slabs.find(s=>s.id===row.relatedId)?.rate||0)}% · ${row.description||''}`})),onPick:row=>{const tax=slabs.find(s=>s.id===row.relatedId);slab.value=tax?.name||'';slab.dataset.id=row.relatedId;gst.value=plain(tax?.rate||0);syncTax();}});
  suggest(slab,{onCreate:createCatalog('gstSlab'),items:()=>slabs.map(row=>({...row,label:row.name,hint:`${plain(row.rate)}%`})),onPick:row=>{gst.value=plain(row.rate);syncTax();}});
  hsn.addEventListener('input',syncTax);slab.addEventListener('input',syncTax);
  suggest(book,{onCreate:inlineMaster((done,row)=>bookForm(row,done),()=>call('pricebooks')),items:()=>books.map(row=>({...row,label:row.name})),onPick:async row=>{const prices=await call('pricebookEntries',{bookId:row.id});if(Number(book.dataset.id)===row.id)bookPrice.value=plain(prices.find(r=>r.itemId===item?.id&&r.minQty===0)?.price??parseMoney(saleRate.value||'0')??0);}});
  el.append(extras.el);
  if(item)advanced.append(h('button',{onclick:()=>push(inventoryRuleForm(item))},'Discount & offer rules ? Alt+O'));

  el.addEventListener('input',()=>{dirty=true;});
  el.addEventListener('change',()=>{dirty=true;});

  async function save() {
    for(const [box,label] of [[itemGroup,'item group'],[book,'pricebook'],[slab,'GST slab']])if(box.value.trim()&&!box.dataset.id){toast(`Select a ${label} from the list`,'error');box.focus();return;}
    // Percentages parse like money: "12" is 12.00%.
    const boxes = [gst, saleRate, purchaseRate, reorder];
    const numbers = boxes.map((box) => (box.value.trim() ? (box === reorder ? parseQty : parseMoney)(box.value) : 0));
    if (numbers.includes(null)) {
      toast('That is not a valid number', 'error');
      return boxes[numbers.indexOf(null)].focus();
    }
    try {
      const result=await call('saveItem', {
        ...(item ? { id: item.id } : {}),
        name: name.value, unit: unit.value, hsn: hsn.value, category: category.value, brand: brand.value,details:extras.read(),
        gstRate: numbers[0], saleRate: numbers[1], purchaseRate: numbers[2], reorderLevel: numbers[3],
        categoryId:Number(category.dataset.id)||null,itemGroupId:Number(itemGroup.dataset.id)||null,unitId:Number(unit.dataset.id)||null,hsnId:Number(hsn.dataset.id)||null,gstSlabId:Number(slab.dataset.id)||null,
        ...(book.dataset.id?{pricebookEntry:{bookId:Number(book.dataset.id),minQty:0,price:parseMoney(bookPrice.value)}}:{}),
        policy:{maxDiscount:parseMoney(maxDiscount.value),maxQty:maxQty.value.trim()?parseQty(maxQty.value):0,stopSales:stopSales.checked,rack:rack.value},
      });
      toast(`Item ${name.value.trim()} saved`);
      dirty=false;extras.committed();
      if (onSaved) await onSaved(result); else pop();
    } catch (error) {
      toast(error.message, 'error');
    }
  }

  const canLeave=async()=>{if(dirty&&!await confirmBox('Leave without saving this item?'))return false;await extras.discard();return true;};
  const fields=[name,unit,itemGroup,category,brand,reorder,hsn,slab,gst,saleRate,purchaseRate,book,bookPrice,maxDiscount,maxQty,stopSales,rack];
  return {
    title: item ? 'Alter item' : 'Create item',
    hints: [['Enter', 'Next field'], ['Alt+B','Billing options'], ['Alt+E','Details'], ['Alt+A','Attach files'], ['Ctrl+S', 'Save'], ['Esc', 'Back']],
    el,canLeave,
    async onShow(returning) {
      if(!returning)await extras.load(item?.id);
      const all = await call('items');
      for (const field of Object.keys(used)) used[field] = [...new Set(all.map((row) => row[field]).filter(Boolean))].sort().map((value) => ({ id: '', label: value }));
      catalog=(await Promise.all(['category','itemGroup','unit','hsn','gstSlab'].map(kind=>call('catalogMasters',{kind})))).flat();
      slabs=catalog.filter(row=>row.kind==='gstSlab');books=await call('pricebooks');
      for(const field of ['category','unit']){const defined=catalog.filter(row=>row.kind===field).map(row=>({...row,label:field==='unit'?(row.symbol||row.name):row.name,hint:field==='unit'?row.name:''}));used[field]=[...defined,...used[field].filter(row=>!defined.some(d=>d.label.toLowerCase()===row.label.toLowerCase()))];}
      slab.value=slabs.find(row=>row.id===Number(slab.dataset.id))?.name||slab.value;syncTax();
      name.focus();
      name.select();
    },
    onKey(e){if(item&&e.altKey&&e.code==='KeyO'){e.preventDefault();push(inventoryRuleForm(item));return true;}if(extras.onKey(e))return true;if(e.altKey&&e.code==='KeyB'){e.preventDefault();advanced.open=!advanced.open;if(advanced.open)book.focus();return true;}if(e.key==='Escape'){e.preventDefault();canLeave().then(ok=>{if(ok)pop();});return true;}return formKeys(fields.filter(field=>!field.disabled&&field.getClientRects().length),save)(e);},
  };
}
