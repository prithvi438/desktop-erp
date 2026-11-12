'use strict';

// All quantities are thousandths of the item's stock unit; percentages are basis points.
module.exports = function inventory({db, BooksError, settings, isDate}) {
  const q=sql=>db.prepare(sql), fail=message=>{throw new BooksError(message);};
  const defaults={saleMin:0,saleDefault:0,saleMax:10000,purchaseMin:0,purchaseDefault:0,purchaseMax:10000,buyQty:0,freeQty:0,offerSales:true,offerPurchases:false,starts:'',ends:''};
  function rules({itemId}) {return {...defaults,...JSON.parse(q('SELECT value FROM meta WHERE key=?').get(`inventory_item_${itemId}`)?.value||'{}')};}
  function saveRules({itemId,...values}) {
    if(!q('SELECT id FROM items WHERE id=?').get(itemId))fail('Item not found');
    const next={...rules({itemId}),...Object.fromEntries(Object.keys(defaults).filter(key=>Object.hasOwn(values,key)).map(key=>[key,values[key]]))};
    for(const side of ['sale','purchase']) {
      for(const suffix of ['Min','Default','Max']) {const n=next[side+suffix];if(!Number.isInteger(n)||n<0||n>10000)fail('Discount percentages must be between 0 and 100');}
      if(next[side+'Min']>next[side+'Default']||next[side+'Default']>next[side+'Max'])fail('Minimum discount must be at or below default, and default at or below maximum');
    }
    for(const key of ['buyQty','freeQty'])if(!Number.isSafeInteger(next[key])||next[key]<0)fail('Offer quantities must be non-negative');
    if(Boolean(next.buyQty)!==Boolean(next.freeQty))fail('Enter both buy and free quantities, or set both to zero');
    for(const key of ['offerSales','offerPurchases'])if(typeof next[key]!=='boolean')fail('Offer switches must be Yes or No');
    for(const key of ['starts','ends'])if(typeof next[key]!=='string'||next[key]&&!isDate(next[key]))fail('Enter valid offer dates');
    if(next.starts&&next.ends&&next.starts>next.ends)fail('Offer end date must follow its start date');
    q('INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(`inventory_item_${itemId}`,JSON.stringify(next));
    return next;
  }
  function quote({itemId,type,date,qty,multiplier=1}) {
    const config=settings(),rule=rules({itemId});
    const side=['Sales','Sales Order','Quotation'].includes(type)?'sale':['Purchase','Purchase Order'].includes(type)?'purchase':null;
    const active=side&&config.freeOffers&&rule.buyQty&&(!rule.starts||date>=rule.starts)&&(!rule.ends||date<=rule.ends)&&rule[side==='sale'?'offerSales':'offerPurchases'];
    const freeQty=active?Math.round(Math.floor((qty*multiplier)/rule.buyQty)*rule.freeQty/multiplier):0;
    if(!Number.isSafeInteger(freeQty)||active&&Math.abs(freeQty*multiplier-Math.floor((qty*multiplier)/rule.buyQty)*rule.freeQty)>0.00001)fail('The free offer cannot be represented in this unit. Choose a smaller related unit.');
    return {discountPct:side&&config.discountRules?rule[side+'Default']:0,min:side&&config.discountRules?rule[side+'Min']:0,max:side&&config.discountRules?rule[side+'Max']:10000,freeQty};
  }
  return {rules,saveRules,quote,api:{inventoryRules:rules,saveInventoryRules:saveRules,inventoryQuote:quote}};
};
