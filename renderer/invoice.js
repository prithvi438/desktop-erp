import {catalogForm} from './catalog.js';
import {inlineMaster} from './inline-master.js';
import {voucherReferences} from './bill-references.js';
import {masterActions} from './inline-master.js';
// Documents entered item by item: sales, purchases, their returns, and stock journals.
// The engine derives the accounting entries and the stock moves from the lines.
import { h, call, mod, suggest, focus, enterKey, money, drcr, plain, parseMoney, parseQty, showQty, parseExpiry, showExpiry, parseDate, showDate, today, toast, confirmBox, picker } from './ui.js';
import { push, pop, chrome } from './router.js';
import { ledgerForm } from './ledgers.js';
import { itemForm } from './items.js';
import { recordExtras } from './details.js';
import { rowPages,entryPage } from './keyboard-pages.js';

// out: stock leaves, so the batch is picked from stock. rate: which item rate is offered.
// plain: an order, with no batch. makes: the document Alt+V turns it into.
const TYPES = {
  Sales: { title: 'Sales invoice', out: true, rate: 'saleRate', party: 'Customer' },
  Purchase: { title: 'Purchase bill', out: false, rate: 'purchaseRate', party: 'Supplier' },
  'Credit Note': { title: 'Credit note (sales return)', out: false, rate: 'saleRate', party: 'Customer' },
  'Debit Note': { title: 'Debit note (purchase return)', out: true, rate: 'purchaseRate', party: 'Supplier' },
  'Stock In': { title: 'Stock journal: stock in', out: false, rate: 'purchaseRate', party: null },
  'Stock Out': { title: 'Stock journal: stock out', out: true, rate: 'purchaseRate', party: null },
  Quotation: { title: 'Quotation', plain: true, rate: 'saleRate', party: 'Customer', makes: 'Sales' },
  'Sales Order': { title: 'Sales order', plain: true, rate: 'saleRate', party: 'Customer', makes: 'Sales' },
  'Purchase Order': { title: 'Purchase order', plain: true, rate: 'purchaseRate', party: 'Supplier', makes: 'Purchase' },
};
// F8 and F9 switch between the two types of a pair.
const PAIRS = [['Sales', 'Purchase'], ['Credit Note', 'Debit Note'], ['Stock In', 'Stock Out'], ['Quotation', 'Sales Order'], ['Purchase Order']];
const COLUMNS = ['Item / description', 'Batch', 'Expiry', 'Qty / unit', 'Rate', 'Disc %', 'GST %', 'Amount'];

let lastDate = today();

// from: the id of an order to copy the party and lines from, into a new document.
export function invoiceEntry({ id = null, type = 'Sales', from = null,draft=null } = {}) {
  let original = null; // the stored document, when altering
  let nextNumber = 0;
  let ledgers = [];
  let items = [],gstSlabs=[];
  let dirty = false;
  let pricebook = null;
  let manualPricebook=false,priceRevision=0;
  let prices = [];
  let settings={lineDiscount:true};
  const trading=()=>['Sales','Purchase','Credit Note','Debit Note'].includes(type);
  const inlineFields={};
  const reference=h('input',{maxLength:500,placeholder:'Optional reference','aria-label':'Document reference'});
  const billNumber=h('input',{maxLength:500,placeholder:'Supplier invoice number','aria-label':'Supplier bill number'});
  const billField=h('label',{},h('span',{},'Supplier bill no.'),billNumber);
  const referenceFields=h('div',{class:'invoice-references'},billField);
  function configureReferences(){delete inlineFields.reference;delete inlineFields.billNumber;if(trading()){inlineFields.reference=reference;inlineFields.billNumber=billNumber;}}
  const extras=recordExtras('document',()=>{dirty=true;recalc();},{fields:inlineFields,inlineCharges:trading,documentType:()=>type,separateCharges:true,onChargesDone:()=>narration.focus(),onKey:event=>{
    return false;
  }});
  const rows = [];
  let activeRow = null;
  const kind = () => TYPES[type];
  // Sales use an existing batch; quotations and orders do not track batches.
  const quick = () => Boolean(kind().out || kind().plain);
  const batchVisible=()=>!kind().plain&&(settings.batchTracking||original?.items?.some(line=>line.batch));
  const expiryVisible=()=>!kind().plain&&(settings.expiryTracking||original?.items?.some(line=>line.expiry));
  function offerQuantity(row){
    const item=items.find(item=>item.id===Number(row.item.dataset.id)),rule=item?.inventoryRules;
    if(!rule||['Credit Note','Debit Note'].includes(type))return;
    const side=['Sales','Sales Order','Quotation'].includes(type)?'sale':['Purchase','Purchase Order'].includes(type)?'purchase':null;
    const date=parseDate(dateInput.value)||today();
    const active=side&&settings.freeOffers&&rule.buyQty&&rule[side==='sale'?'offerSales':'offerPurchases']&&(!rule.starts||date>=rule.starts)&&(!rule.ends||date<=rule.ends);
    const qty=active?Math.round(Math.floor((parseQty(row.qty.value)||0)*(row.unitMultiplier||1)/rule.buyQty)*rule.freeQty/(row.unitMultiplier||1)):0;
    row.free.value=showQty(qty);
  }

  const typeBar = h('div', { class: 'types' });
  const numberEl = h('strong');
  const gstSupply=h('select',{'aria-label':'GST supply type'},...['auto','intrastate','interstate'].map((value,i)=>h('option',{value},['Automatic (party state)','Intrastate - CGST + SGST','Interstate - IGST'][i])));
  const gstSupplyField=h('label',{class:'gst-supply-field'},h('span',{},'GST supply'),gstSupply);
  gstSupply.addEventListener('change',()=>{dirty=true;});
  const documentTitle = h('h2');
  const documentCaption = h('p', {class:'tip'});
  const movement=h('span',{class:'invoice-movement'}),partyInfo=h('p',{class:'invoice-party-info'});
  const selectedItemInfo=h('p',{class:'invoice-item-info'},'Select an item to see available stock and HSN.');
  const lineCount = h('span', {class:'line-count'});
  const documentTotal=h('strong',{class:'document-grand-total'});
  const breakdown=h('small',{class:'document-breakdown'});
  const totalLabel=h('span',{},'Invoice total');
  const saveButton=h('button',{onclick:save},'Save voucher · Ctrl+S');
  const pricebookButton = h('button', { class: 'pricebook-button', onclick: choosePricebook }, 'Base prices (Alt+P)');
  const dateInput = h('input', { class: 'date' });
  const party = h('input', { class: 'wide' });
  const partyLabel = h('span');
  const partyRow = h('label', { class: 'narration' }, partyLabel, h('div', { class: 'field' }, party));
  const narration = h('input', { class: 'wide', maxLength: 200 });
  const narrationLabel=h('span',{},'Narration');
  const tbody = h('tbody');
  const itemPages=rowPages(tbody,{size:()=>trading()?(innerHeight<780?2:4):innerHeight<660?2:innerHeight<780?4:6,label:'Items'});
  const totals = { taxable: h('td', { class: 'num' }), tax: h('td', { class: 'num' }), adjustments:h('td',{class:'num'}), total: h('td', { class: 'num' }) };
  const totalRow = (label, cell) => h('tr', {}, h('td', { colSpan: COLUMNS.length - 1 }, label), cell);

  const el = h('section', { class: 'voucher invoice keyboard-voucher' },
    typeBar,
    h('div',{class:'document-banner'},h('div',{},h('p',{class:'eyebrow'},'VOUCHER ENTRY'),documentTitle,documentCaption),movement,h('div', { class: 'vhead' }, h('span', {class:'voucher-number'}, h('small',{},'Voucher no.'), numberEl), h('label', {}, 'Date ', dateInput))),
    h('div',{class:'invoice-party-panel'},h('div',{class:'invoice-party-main'},partyRow,partyInfo),referenceFields),
    h('div',{class:'invoice-lines-area'},h('table', { class: 'lines' },
      h('thead', {}, h('tr', {}, COLUMNS.map((label, at) => h('th', { class: at > 2 ? 'num' : '' }, label)))),
      tbody,
      h('tfoot', {}, totalRow('Taxable value', totals.taxable), totalRow('GST', totals.tax),totalRow('Charges / round off',totals.adjustments), totalRow('Total', totals.total))),
    h('div',{class:'line-actions'},itemPages.el,lineCount),
    selectedItemInfo,
    h('p',{class:'entry-guidance'},'Enter or Tab: next field · Ctrl+Enter: edit selected master · Alt+D: description · Empty item + Enter: ledger entries')),
    extras.chargesEl,
    h('label', { class: 'narration' }, narrationLabel, narration),
    h('div',{class:'document-tools'},h('button',{onclick:()=>extras.focus()},'Details · Alt+E'),h('button',{onclick:()=>openCharges()},'Charges · Alt+L'),h('button',{onclick:()=>extras.attach()},'Files · Alt+A'),pricebookButton),
    h('div',{class:'document-save'},h('div',{},breakdown,h('span',{class:'invoice-total'},totalLabel,documentTotal)),saveButton));
  function updatePartyInfo(){const chosen=ledgers.find(row=>row.id===Number(party.dataset.id));partyInfo.textContent=chosen?[chosen.gstin&&`GSTIN ${chosen.gstin}`,chosen.state,`Balance ${drcr(chosen.balance)||'0.00'}`].filter(Boolean).join(' · '):'Select a party · Alt+C creates a ledger';}
  party.addEventListener('input',updatePartyInfo);
  enterKey(reference,()=>focus((rows[0]||addRow()).item));
  enterKey(billNumber,()=>focus(gstSupply));
  el.addEventListener('input', () => { dirty = true; });
  el.addEventListener('keydown',event=>{
    const row=rows.find(r=>r.node.contains(event.target));
    if(!row)return;
    if(mod(event)&&event.key==='Enter'&&!event.target.dataset.inlineEdit){
      event.preventDefault();event.stopPropagation();lineDone(row);return;
    }
    if(event.key!=='Tab'||event.altKey||mod(event))return;
    if(event.target===row.item&&!event.shiftKey&&!row.item.dataset.id&&row.item.value.trim()){
      event.preventDefault();event.stopPropagation();
      if(!row.suggestion.chooseCurrent())toast('Choose an item, or press Alt+C to create it','error');
      return;
    }
    const fields=lineFields(row),at=fields.indexOf(event.target);
    if(at<0)return;
    event.preventDefault();event.stopPropagation();
    if(event.shiftKey){
      if(at>0)focus(fields[at-1]);
      else {const previous=rows[rows.indexOf(row)-1];focus(previous?lineFields(previous).at(-1):partyRow.hidden?dateInput:party);}
    }else if(at<fields.length-1)focus(fields[at+1]);
    else lineDone(row);
  },true);

  // Same rounding as the engine, so the screen shows what will be posted.
  let referenceDraft=null;
  async function editReferences(){try{if(!['Sales','Purchase','Credit Note','Debit Note'].includes(type))return true;recalc();const amount=parseMoney(totals.total.textContent),date=parseDate(dateInput.value),partyId=Number(party.dataset.id);if(!amount||!partyId||!date)return toast('Choose the party, date and items first','error');const result=await voucherReferences({lines:[{ledgerId:partyId,amount:amount*(['Sales','Debit Note'].includes(type)?1:-1)}],date,voucherId:id,draft:referenceDraft,silent:true});if(result){referenceDraft=result;dirty=true;return true;}return false;}catch(e){toast(e.message,'error');}}
  referenceFields.append(gstSupplyField);
  function recalc() {
    let taxable = 0;
    let tax = 0;
    for (const row of rows) {
      const gross = Math.round(((parseQty(row.qty.value) || 0) * (parseMoney(row.rate.value) || 0)) / 1000);
      const amount=gross-Math.round(gross*(parseMoney(row.discount.value)||0)/10000);
      row.amount.textContent = amount ? money(amount) : '';
      taxable += amount;
      tax += Math.round((amount * (parseMoney(row.gst.value) || 0)) / 10000);
    }
    totals.taxable.textContent = money(taxable);
    totals.tax.textContent = money(tax);
    let adjustment=0,roundOff=0;
    try{const info=extras.read();adjustment=(info.charges||[]).reduce((sum,c)=>sum+(c.amount||0),0);roundOff=info.roundOff??(settings.roundOff&&kind().party?Math.round((taxable+tax+adjustment)/100)*100-(taxable+tax+adjustment):0);}catch{/* Invalid optional fields are reported on save. */}
    totals.adjustments.textContent=`${adjustment+roundOff<0?'-':''}${money(adjustment+roundOff)}`;
    totals.total.textContent = money(taxable + tax+adjustment+roundOff);
    documentTotal.textContent=totals.total.textContent;
    breakdown.replaceChildren(...[['Taxable value',money(taxable)],['GST',money(tax)],['Charges / round off',`${adjustment+roundOff<0?'-':''}${money(adjustment+roundOff)}`]].map(([label,value])=>h('span',{},h('span',{},label),h('strong',{},value))));
    lineCount.textContent = `${rows.filter(row=>row.item.dataset.id).length} items`;
  }

  const filled = (row) => row.item.dataset.id && parseQty(row.qty.value);
  const firstField = () => (kind().party ? party : (rows[0]||addRow()).item);
  function openCharges(){if(kind().party)extras.focusCharge();else narration.focus();}
  function finishItems(row){
    if(row.qty.value.trim()||row.description.value.trim()||row.rate.value.trim())return toast('Complete or remove this item line','error');
    rows.splice(rows.indexOf(row),1);row.node.remove();activeRow=null;
    el.querySelector('table.lines').hidden=!rows.length;
    if(kind().party)openCharges();else {if(!rows.length)addRow();narration.focus();}
  }

  function applyPrice(row) {
    if (kind().rate !== 'saleRate' || row.manualRate || !pricebook?.active) return;
    const item = items.find(i => i.id === Number(row.item.dataset.id));
    if (!item) return;
    const qty = (parseQty(row.qty.value) || 0)*(row.unitMultiplier||1);
    const tier = prices.filter(p => p.itemId === item.id && p.minQty <= qty).sort((a, b) => b.minQty - a.minQty)[0];
    const factor = pricebook.mode === 'MARKUP' ? 10000 + pricebook.pct : pricebook.mode === 'MARKDOWN' ? 10000 - pricebook.pct : 10000;
    row.rate.value = plain(Math.round((tier ? tier.price : item.saleRate * factor / 10000)*(row.unitMultiplier||1)));
  }

  async function loadPricebook(book) {
    const revision=++priceRevision;
    const entries = book ? await call('pricebookEntries', { bookId: book.id }) : [];
    if(revision!==priceRevision)return false;
    pricebook = book; prices = entries;
    pricebookButton.textContent = `${book ? `Pricebook: ${book.name}` : 'Base prices'} (Alt+P)`;
    return true;
  }

  async function choosePricebook() {
    if (kind().rate !== 'saleRate') return;
    try {
      const books = (await call('pricebooks')).filter(b => b.active);
      const choice = await picker('Choose pricebook', [{ id: 0, label: 'Base item prices' }, ...books.map(b => ({ ...b, label: b.name, hint: b.mode }))]);
      if (!choice) return;
      if (rows.some(filled) && !await confirmBox('Reprice the current lines using this pricebook?')) return;
      manualPricebook=true;
      await loadPricebook(choice.id ? choice : null);
      for (const row of rows) {
        row.manualRate = false;
        const item = items.find(i => i.id === Number(row.item.dataset.id));
        if (item) row.rate.value = plain(Math.round(item.saleRate*(row.unitMultiplier||1)));
        applyPrice(row);
      }
      dirty = true; recalc(); focus(firstField());
    } catch (e) { toast(e.message, 'error'); }
  }

  async function pickItem(row, item, editing=false) {
    if(editing){dirty=true;updateLineMeta(row,item);return;}
    dirty = true;
    setUnit(row,item);
    row.gst.value = kind().party ? plain(item.gstRate) : '';
    row.gst.dataset.id=gstSlabs.find(s=>s.rate===item.gstRate)?.id||'';
    row.rate.value = plain(item[kind().rate]);
    row.manualRate = false;
    const side=['Sales','Sales Order','Quotation'].includes(type)?'sale':['Purchase','Purchase Order'].includes(type)?'purchase':null;
    row.discount.value=settings.discountRules&&side?plain(item.inventoryRules?.[side+'Default']||0):'';
    offerQuantity(row);
    updateLineMeta(row,item);
    applyPrice(row);
    recalc();
    if (kind().plain) return focus(row.qty);
    if (!kind().out) return focus(batchVisible()?row.batch:expiryVisible()?row.expiry:row.qty);
    await offerBatch(row, item.id, item.name);
    focus(row.qty);
  }

  // Stock going out takes the batch that expires first unless another is chosen.
  async function offerBatch(row, itemId, name) {
    const found = await call('batches', { itemId, exceptVoucherId: id });
    row.batches = found.map((batch) => ({
      id: 'batch',
      label: batch.batch || '(no batch)',
      hint: `${batch.expiry ? `exp ${showExpiry(batch.expiry)}, ` : ''}${showQty(batch.qty)} in stock`,
      batch: batch.batch,
      expiry: batch.expiry,
    }));
    if (!found.length) toast(`${name} is out of stock`, 'error');
    setBatch(row, found[0]);
  }

  function setBatch(row, batch) {
    row.batch.value = batch?.batch ?? '';
    row.expiry.value = showExpiry(batch?.expiry ?? '');
    if(batch?.expiry){const date=parseDate(dateInput.value)||today(),soon=new Date(Date.parse(date+'T00:00:00Z')+settings.nearExpiryDays*86400000).toISOString().slice(0,7);if(batch.expiry<date.slice(0,7))toast('This batch has expired','error');else if(batch.expiry<=soon)toast('This batch is within the near-expiry window');}
    if (batch) row.batch.dataset.id = 'batch';
    else delete row.batch.dataset.id;
  }

  function lineDone(row) {
    if(!row.item.dataset.id){toast('Choose an item first','error');return focus(row.item);}
    if (!parseQty(row.qty.value)) {
      toast('Enter a quantity', 'error');
      return focus(row.qty);
    }
    focus((rows[rows.indexOf(row) + 1] || addRow()).item);
  }

  function addLine() { focus((rows.find(row=>!row.item.value.trim()&&!row.qty.value.trim())||addRow()).item); }
  async function removeLine() {
    const row=activeRow||rows.at(-1);
    if(!row)return;
    if((row.item.value||row.qty.value)&&!await confirmBox('Remove this item line?'))return;
    const index=rows.indexOf(row);if(index<0)return;
    rows.splice(index,1);row.node.remove();dirty=true;
    rows.forEach((entry,index)=>{
      entry.serial.textContent=String(index+1).padStart(2,'0');
      for(const [name,input] of Object.entries(entry))if(input?.tagName==='INPUT')input.setAttribute('aria-label',`${name} for item ${index+1}`);
    });
    focus((rows[Math.min(index,rows.length-1)]||addRow()).item);recalc();
  }
  function lineFields(row) {
    return [row.item,...(batchVisible()?[row.batch]:[]),...(!quick()&&expiryVisible()?[row.expiry]:[]),row.qty,...(!row.free.hidden&&!row.free.readOnly?[row.free]:[]),...(row.unitOptions?.length>1?[row.unit]:[]),row.rate,...(!row.discount.closest('td').hidden?[row.discount]:[]),...(kind().party?[row.gst]:[])];
  }
  function setUnit(row,item,unitId=null){
    row.unitOptions=item?.units||[];
    const selected=row.unitOptions.find(unit=>unit.id===(unitId||item?.unitId))||row.unitOptions[0];
    row.unit.value=selected?.symbol||item?.unit||'';row.unit.dataset.id=selected?.id||'';row.unitMultiplier=selected?.multiplier||1;
    row.unit.readOnly=row.unitOptions.length<2;row.unit.tabIndex=row.unit.readOnly?-1:0;
  }
  function pickUnit(row,unit){
    const item=items.find(item=>item.id===Number(row.item.dataset.id));
    const perBase=(parseMoney(row.rate.value)||0)/(row.unitMultiplier||1);
    row.unitMultiplier=unit.multiplier;row.rate.value=plain(Math.round((row.manualRate?perBase:item?.[kind().rate]||0)*unit.multiplier));
    applyPrice(row);offerQuantity(row);dirty=true;recalc();updateLineMeta(row);
  }
  function updateLineMeta(row,item=items.find(item=>item.id===Number(row.item.dataset.id))) {
    row.meta.textContent=item?`Available ${(item.units||[{stock:item.stock,symbol:item.unit}]).map(unit=>`${showQty(unit.stock||0)} ${unit.symbol}`).join(' = ')}${item.hsn?' · HSN '+item.hsn:''}`:'Type an item name or barcode · Alt+C creates an item';
    if(activeRow===row)selectedItemInfo.textContent=row.meta.textContent;
  }

  function lockCells(row) {
    row.expiry.readOnly = quick();
    row.batch.readOnly = Boolean(kind().plain);
    row.gst.readOnly = !kind().party;
  }

  function addRow(line) {
    el.querySelector('table.lines').hidden=false;
    const input = (cls) => h('input', { class: cls });
    const row = { manualRate: Boolean(line), batches: [], item: input('wide'), description:h('input',{class:'line-description',placeholder:'Description (optional)',maxLength:1000}), batch: input('wide'), expiry: input('wide'), qty: input('num'),free:input('num free-quantity'),unit:input('line-unit'), rate: input('num'),discount:input('num'), gst: input('num'), amount: h('td', { class: 'num' }) };
    row.free.value=showQty(line?.freeQty||0);row.free.placeholder='Free qty';row.free.title='Additional free quantity';
    row.free.hidden=!settings.freeOffers&&!line?.freeQty;row.free.readOnly=!['Credit Note','Debit Note'].includes(type);row.free.tabIndex=row.free.readOnly?-1:0;
    row.serial=h('span',{class:'line-serial'},String(rows.length+1).padStart(2,'0'));
    row.meta=h('small',{class:'line-meta'});
    row.item.placeholder='Select item / scan barcode';
    row.discount.value=line?.discountPct?plain(line.discountPct):'';
    row.description.value=line?.description||'';
    row.description.addEventListener('input',()=>{dirty=true;});
    row.description.hidden=false;
    lockCells(row);
    if (line) {
      row.item.value = line.itemName;
      row.item.dataset.id = line.itemId;
      row.batch.value = line.batch;
      row.batch.dataset.id = 'batch';
      row.expiry.value = showExpiry(line.expiry);
      row.qty.value = showQty(line.qty);
      row.rate.value = plain(line.rate);
      row.gst.value = kind().party ? plain(line.gstRate) : '';
    }
    setUnit(row,items.find(item=>item.id===Number(row.item.dataset.id)),line?.unitId);
    updateLineMeta(row);
    row.node=h('tr', {},
      h('td', { class: 'field' },row.serial, row.item,row.meta,row.description), h('td', { class: 'field' }, row.batch), h('td', {}, row.expiry),
      h('td', { class: 'num' },h('div',{class:'qty-unit'},row.qty,row.unit),h('small',{class:'free-quantity-label',hidden:row.free.hidden},'Free'),row.free), h('td', { class: 'num' }, row.rate),h('td',{class:'num discount-cell',hidden:!settings.lineDiscount&&!settings.discountRules&&!line?.discountPct},row.discount), h('td', { class: 'num' }, row.gst), row.amount);
    row.node.children[1].hidden=!batchVisible();row.node.children[2].hidden=!expiryVisible();
    tbody.append(row.node);
    row.node.addEventListener('focusin',()=>{activeRow=row;selectedItemInfo.textContent=row.meta.textContent;rows.forEach(entry=>entry.node.classList.toggle('active-line',entry===row));});
    rows.push(row);
    for(const [name,input] of Object.entries(row))if(input?.tagName==='INPUT')input.setAttribute('aria-label',`${name} for item ${rows.length}`);

    row.suggestion=suggest(row.item, { items: () => items,onCreate:masterActions('item'), onPick: (item,editing) => pickItem(row, item,editing) });
    suggest(row.unit,{items:()=>(row.unitOptions||[]).map(unit=>({...unit,label:unit.symbol,hint:`${unit.name} · 1 = ${unit.multiplier} stock units`})),onPick:unit=>pickUnit(row,unit)});
    row.gst.dataset.id=gstSlabs.find(s=>s.rate===parseMoney(row.gst.value))?.id||'';
    suggest(row.gst,{items:()=>kind().party?gstSlabs.map(s=>({...s,label:plain(s.rate),hint:s.name})):[],onCreate:inlineMaster((done,record)=>catalogForm('gstSlab',record,done),async()=>{gstSlabs=await call('catalogMasters',{kind:'gstSlab'});return gstSlabs.map(s=>({...s,label:plain(s.rate)}));}),onPick:()=>{dirty=true;recalc();}});
    suggest(row.batch, { items: () => row.batches, onPick: (batch) => { dirty = true; setBatch(row, batch); focus(row.qty); } });

    enterKey(row.item, () => {
      if (row.item.dataset.id) focus(quick()?row.qty:batchVisible()?row.batch:expiryVisible()?row.expiry:row.qty);
      else if (row.item.value.trim()) toast('No item by that name. Alt+C creates one.', 'error');
      else finishItems(row);
    });
    enterKey(row.batch, () => focus(kind().out||!expiryVisible()?row.qty:row.expiry));
    enterKey(row.expiry, () => focus(row.qty));
    enterKey(row.qty, () => focus(!row.free.hidden&&!row.free.readOnly?row.free:row.unitOptions?.length>1?row.unit:row.rate));
    enterKey(row.free,()=>focus(row.unitOptions?.length>1?row.unit:row.rate));
    enterKey(row.unit, () => focus(row.rate));
    enterKey(row.rate, () => !row.discount.closest('td').hidden?focus(row.discount):kind().party?focus(row.gst):lineDone(row));
    enterKey(row.discount,()=>kind().party?focus(row.gst):lineDone(row));
    enterKey(row.description,()=>focus(quick()?row.qty:batchVisible()?row.batch:expiryVisible()?row.expiry:row.qty));
    enterKey(row.gst, () => lineDone(row));
    for (const cell of [row.qty, row.rate,row.discount, row.gst]) cell.addEventListener('input', recalc);
    row.rate.addEventListener('input', () => { row.manualRate = true; });
    row.qty.addEventListener('input', () => { applyPrice(row); offerQuantity(row); recalc(); });
    return row;
  }

  async function setType(next) {
    if (!next) return;
    if (next !== type && rows.some((row) => row.item.dataset.id)) return toast('Remove the items before changing the type', 'error');
    type = next;
    const returning=type==='Credit Note'||type==='Debit Note';
    el.classList.toggle('trade-invoice',trading());el.classList.toggle('return-invoice',returning);el.dataset.documentType=type;
    documentTitle.textContent=type==='Credit Note'?'Sales return · Credit note':type==='Debit Note'?'Purchase return · Debit note':kind().title;
    movement.hidden=!trading();movement.textContent=kind().out?'Stock out':'Stock in';
    referenceFields.hidden=!trading();billField.hidden=type!=='Purchase';
    reference.placeholder=returning?'Original invoice / bill number':'Optional reference';
    narrationLabel.textContent=returning?'Return reason':'Narration';
    narration.placeholder=returning?'Reason for return / notes (optional)':'Notes for this voucher (optional)';
    totalLabel.textContent=type==='Credit Note'?'Credit total':type==='Debit Note'?'Debit total':type==='Purchase'?'Bill total':'Invoice total';
    saveButton.textContent=`${returning?'Save return':trading()?'Save invoice':'Save voucher'} · Ctrl+S`;
    updatePartyInfo();
    documentCaption.textContent=kind().plain?'Itemised pricing, descriptions and terms for your customer or supplier.':'Enter items in sequence. Review quantities, prices and taxes before saving.';
    el.classList.toggle('plain-document',Boolean(kind().plain));
    el.querySelectorAll('tfoot td[colspan]').forEach(cell=>{cell.colSpan=COLUMNS.length-1-(!batchVisible()?1:0)-(!expiryVisible()?1:0)-(!settings.lineDiscount&&!settings.discountRules&&!original?.items?.some(row=>row.discountPct)?1:0);});
    if (!id) nextNumber = await call('nextNumber', { type });
    numberEl.textContent = !id ? nextNumber : type === original.type ? original.number : 'new';
    const pair = PAIRS.find((names) => names.includes(type));
    typeBar.replaceChildren(...pair.map((name, at) => h('span', { class: name === type ? 'on' : '' }, h('kbd', {}, at ? 'F9' : 'F8'), TYPES[name].title)));
    partyRow.hidden = !kind().party;
    pricebookButton.hidden = kind().rate !== 'saleRate';
    gstSupplyField.hidden=!kind().party;
    partyLabel.textContent = kind().party || '';
    rows.forEach(lockCells);
    chrome();
  }

  async function start() {
    referenceDraft=null;gstSupply.value='auto';
    const hasDraft=Boolean(draft);
    manualPricebook=false;
    settings=await call('settings');
    const availableBooks = await call('pricebooks');
    rows.length = 0;
    activeRow=null;
    tbody.replaceChildren();
    narration.value = '';
    party.value = '';
    delete party.dataset.id;
    if (id || from) {
      original = await call('invoice', { id: id ?? from });
      if (id) {type = original.type;gstSupply.value=original.interstate?'interstate':'intrastate';}
      configureReferences();
      await extras.load(id,from?{...original.details,attachments:[]}:original.details,original.date);
      await loadPricebook(availableBooks.find(b => b.id === original.pricebookId) || null);
      dateInput.value = showDate(id ? original.date : lastDate);
      if (original.partyId) {
        party.value = original.partyName;
        party.dataset.id = original.partyId;
      }
      narration.value = id ? original.narration : `Against ${original.type} No. ${original.number}`;
      for (const line of original.items) addRow(line);
      el.querySelector('table.lines').hidden=!rows.length;
      if (from && kind().out) for (const row of rows) await offerBatch(row, Number(row.item.dataset.id), row.item.value);
    } else {
      configureReferences();
      await extras.load(null,null,lastDate);
      await loadPricebook(availableBooks.find(b => b.is_default && b.active) || null);
      dateInput.value = showDate(lastDate);
      addRow();
    }
    await setType(type);
    if(from)rows.forEach(offerQuantity);
    if(draft){
      const prepared=draft;draft=null;
      const chosen=ledgers.find(row=>row.id===prepared.partyId);
      if(chosen){party.value=chosen.label;party.dataset.id=chosen.id;}
      rows.length=0;tbody.replaceChildren();
      for(const line of prepared.items||[]){const item=items.find(row=>row.id===line.itemId);if(item)addRow({...line,itemName:item.name,batch:'',expiry:'',gstRate:item.gstRate,rate:line.rate??item.purchaseRate});}
      if(!rows.length)addRow();
      rows.forEach(offerQuantity);
      dirty=true;
    }
    el.querySelectorAll('thead th')[1].hidden=!batchVisible();el.querySelectorAll('thead th')[2].hidden=!expiryVisible();
    el.querySelectorAll('thead th')[5].hidden=!settings.lineDiscount&&!settings.discountRules&&!original?.items?.some(row=>row.discountPct);
    recalc();
    selectedItemInfo.textContent='Select an item to see available stock and HSN.';
    updatePartyInfo();
    dirty = hasDraft||Boolean(from);
    from = null; // the next new document starts empty
    focus(firstField());
  }

  async function save() {
    const fail = (message, input) => { toast(message, 'error'); focus(input); };
    const date = parseDate(dateInput.value);
    if (!date) return fail('Date is not valid. Use dd-mm-yyyy.', dateInput);
    if (kind().party && !party.dataset.id) return fail(`Choose the ${kind().party.toLowerCase()}`, party);
    const lines = [];
    for (const row of rows) {
      if (!row.item.value.trim() && !row.qty.value.trim()) continue;
      const qty = parseQty(row.qty.value);
      const rate = row.rate.value.trim() ? parseMoney(row.rate.value) : 0;
      const gstRate = row.gst.value.trim() ? parseMoney(row.gst.value) : 0;
      const discountPct=row.discount.value.trim()?parseMoney(row.discount.value):0;
      const expiry = row.expiry.value.trim() ? parseExpiry(row.expiry.value) : '';
      if (!row.item.dataset.id) return fail('Pick an item on every line', row.item);
      if (!qty) return fail('Enter a quantity on every line', row.qty);
      if (rate === null) return fail('The rate is not a valid amount', row.rate);
      if (gstRate === null) return fail('Select a GST slab', row.gst);
      const itemTax=items.find(item=>item.id===Number(row.item.dataset.id))?.gstRate;
      const savedTax=original?.items?.find(line=>line.itemId===Number(row.item.dataset.id))?.gstRate;
      if(kind().party&&!gstSlabs.some(s=>s.rate===gstRate)&&gstRate!==itemTax&&gstRate!==savedTax)return fail('Select a GST rate from the saved slabs. Alt+C creates a slab.',row.gst);
      if(discountPct===null||discountPct>10000)return fail('Discount must be between 0 and 100 percent',row.discount);
      if (expiry === null) return fail('Expiry is a month and year, like 03-2027', row.expiry);
      if(row.unitOptions?.length>1&&!row.unit.dataset.id)return fail('Select a unit from the list',row.unit);
      lines.push({ itemId: Number(row.item.dataset.id),unitId:Number(row.unit.dataset.id)||null, batch: row.batch.value.trim(), expiry, qty, freeQty:parseQty(row.free.value||'0'), rate, gstRate,discountPct,description:row.description.value });
    }
    try {
      const saved = await call('saveInvoice', { ...(id ? { id } : {}), type, date, gstSupply:gstSupply.value, partyId: Number(party.dataset.id) || null, pricebookId: kind().rate === 'saleRate' ? pricebook?.id || null : null, narration: narration.value.trim(), items: lines,details:extras.read(),...(referenceDraft?{billReferences:referenceDraft}:{}) });
      toast(`${kind().title} No. ${saved.number} saved, total ${money(saved.total)}`);
      dirty = false;
      extras.committed();
      if (id) return pop();
      lastDate = date;
      await start();
    } catch (error) {
      toast(error.message, 'error');
    }
  }

  const canLeave = async () => {if(dirty&&!await confirmBox('Leave without saving this document?'))return false;await extras.discard();return true;};
  const leave = async () => { if (await canLeave()) pop(); };

  suggest(party, { items: () => ledgers,onCreate:masterActions('ledger',()=>kind().party==='Customer'?'Sundry Debtors':'Sundry Creditors'), onPick: async (chosen) => {
    updatePartyInfo();
    dirty = true;extras.suggestDue(chosen.creditDays,parseDate(dateInput.value));
    if(!id&&!manualPricebook&&kind().rate==='saleRate'){
      const available=await call('pricebooks'),book=available.find(row=>row.id===chosen.pricebookId&&row.active)||available.find(row=>row.is_default&&row.active)||null;
      if(manualPricebook||Number(party.dataset.id)!==chosen.id)return;
      if(!await loadPricebook(book))return;
      for(const row of rows)if(!row.manualRate){const item=items.find(i=>i.id===Number(row.item.dataset.id));if(item)row.rate.value=plain(Math.round(item.saleRate*(row.unitMultiplier||1)));applyPrice(row);}
      recalc();
    }
    focus((rows[0]||addRow()).item);
  } });
  enterKey(party, () => (party.dataset.id ? focus((rows[0]||addRow()).item) : toast(`Choose the ${kind().party.toLowerCase()}`, 'error')));
  enterKey(dateInput, () => {
    const date = parseDate(dateInput.value);
    if (!date) return toast('Date is not valid. Use dd-mm-yyyy.', 'error');
    dateInput.value = showDate(date);
    if(!id||date!==original?.date)rows.forEach(offerQuantity);recalc();
    focus(firstField());
  });
  let allocating=false;
  enterKey(narration,async()=>{if(allocating)return;allocating=true;try{if(await editReferences())await save();}finally{allocating=false;}});

  return {
    get title() { return `${id ? 'Alter: ' : ''}${kind().title}`; },
    hints: [['Enter / Tab', 'Next field'], ['Ctrl+Enter','Edit focused master'], ['F2', 'Date'], ['F8 / F9', 'Type'], ['Alt+C', 'Create focused master'], ['Ctrl+S', 'Save'], ['Esc', 'Back']],
    el,
    canLeave,
    async onShow(returning) {
      ledgers = (await call('ledgers')).filter(row=>['Sundry Debtors','Sundry Creditors','Cash-in-Hand','Bank Accounts'].includes(row.accountGroup||row.groupName)).map((row) => ({ ...row,label: row.name, hint: row.groupName }));
      gstSlabs=await call('catalogMasters',{kind:'gstSlab'});
      items = (await call('items')).map((row) => ({ ...row, label: row.name, search:row.sku, hint: `${row.sku?row.sku+' · ':''}${showQty(row.stock)} ${row.unit}` }));
      if (!returning) await start();
      else {await extras.refreshChargeLedgers();updatePartyInfo();}
    },
    onKey(event) {
      if(extras.onKey(event))return true;
      const pair = PAIRS.find((names) => names.includes(type));
      if (event.key === 'F8' || event.key === 'F9') setType(pair[event.key === 'F8' ? 0 : 1]);
      else if (event.key === 'F2') focus(dateInput);
      else if (mod(event) && event.code === 'KeyS') save();
      else if (mod(event) && event.key === 'Delete') removeLine();
      else if (event.altKey && event.code === 'KeyN') addLine();
      else if (event.altKey && event.code === 'KeyD') {
        const row=activeRow||rows[0]||addRow();
        entryPage('Item description',[{title:row.item.value||'Item description',nodes:[row.meta,row.description]}],{onDone:()=>focus(row.qty)});
      }
      else if (event.altKey && event.code === 'KeyL') openCharges();
      else if (event.altKey && event.code === 'KeyP') choosePricebook();
      else if (event.altKey && event.code === 'KeyV') {
        if (id && kind().makes) push(invoiceEntry({ type: kind().makes, from: id }));
        else toast('Open a saved quotation or order first', 'error');
      }
      else if (event.key === 'Escape') leave();
      else return false;
      event.preventDefault();
      return true;
    },
  };
}
