'use strict';
// Exact rational conversions; quantities remain integer thousandths of the item unit.
module.exports=({db,list,get,fail})=>{
  const q=sql=>db.prepare(sql),scale=1000000n;
  function factor(value){
    const text=String(value??'1').trim();
    if(!/^\d{1,9}(\.\d{1,6})?$/.test(text))fail('Conversion must be positive, with up to 6 decimal places');
    const [whole,decimal='']=text.split('.'),n=BigInt(whole)*scale+BigInt(decimal.padEnd(6,'0'));
    if(n<=0n)fail('Conversion must be greater than zero');return n;
  }
  function path(id){let n=1n,d=1n,root=id;const seen=new Set();
    while(id){if(seen.has(id))fail('Units cannot inherit from themselves');if(seen.size>=20)fail('Use at most 20 levels of related units');seen.add(id);const row=get(id);if(row.kind!=='unit')fail('Choose a valid unit');root=id;if(row.relatedId){n*=factor(row.conversion||'1');d*=scale;}id=row.relatedId;}
    return {root,n,d};
  }
  function ratio(from,to){const a=path(from),b=path(to);if(a.root!==b.root)fail('Choose a unit related to the item stock unit');return {n:a.n*b.d,d:a.d*b.n};}
  function options(itemId){const link=q('SELECT unit_id FROM item_master_links WHERE item_id=?').get(itemId),item=q('SELECT unit FROM items WHERE id=?').get(itemId);
    if(!item)fail('Item not found');if(!link?.unit_id)return [{id:null,name:item.unit,symbol:item.unit,multiplier:1}];
    const base=path(link.unit_id);
    return list({kind:'unit'}).filter(unit=>path(unit.id).root===base.root).map(unit=>{const r=ratio(unit.id,link.unit_id);return {id:unit.id,name:unit.name,symbol:unit.symbol||unit.name,multiplier:Number(r.n)/Number(r.d)};});
  }
  function convert(itemId,unitId,qty){
    const base=q('SELECT unit_id FROM item_master_links WHERE item_id=?').get(itemId)?.unit_id;
    if(!unitId||unitId===base)return {qty,multiplier:1};
    if(!base)fail('Map a stock unit to this item before using alternate units');
    const {n,d}=ratio(unitId,base),result=BigInt(qty)*n;
    if(result%d)fail('This quantity is smaller than the stock precision (0.001 of the item unit)');
    const converted=Number(result/d);if(!Number.isSafeInteger(converted)||converted<=0)fail('Converted quantity is outside the supported range');
    return {qty:converted,multiplier:Number(n)/Number(d)};
  }
  function used(id){
    const root=path(id).root,ids=list({kind:'unit'}).filter(unit=>path(unit.id).root===root).map(unit=>unit.id);
    return ids.some(unitId=>q('SELECT l.item_id FROM item_master_links l WHERE l.unit_id=? AND (EXISTS(SELECT 1 FROM stock_moves m WHERE m.item_id=l.item_id) OR EXISTS(SELECT 1 FROM order_lines o WHERE o.item_id=l.item_id))').get(unitId));
  }
  return {factor,path,ratio,options,convert,used};
};
