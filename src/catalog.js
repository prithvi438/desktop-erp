'use strict';
module.exports=({db,BooksError,tx})=>{
  const q=sql=>db.prepare(sql),fail=message=>{throw new BooksError(message);};
  const kinds=['category','itemGroup','unit','gstSlab','hsn','gstRegistration'];
  const mapping={categoryId:['category_id','category'],itemGroupId:['item_group_id','itemGroup'],unitId:['unit_id','unit'],hsnId:['hsn_id','hsn'],gstSlabId:['gst_slab_id','gstSlab']};
  const get=id=>{const row=q('SELECT * FROM catalog_masters WHERE id=?').get(id);if(!row)fail('Master not found');return {...row,...JSON.parse(row.data),relatedId:row.related_id};};
  const typed=(id,kind)=>{const row=get(id);if(row.kind!==kind)fail(`Choose a valid ${kind} master`);return row;};
  const list=({kind}={})=>{if(!kinds.includes(kind))fail('Unknown master type');return q('SELECT id FROM catalog_masters WHERE kind=? ORDER BY lower(name)').all(kind).map(r=>get(r.id));};
  const units=require('./units')({db,list,get,fail});
  function save({id=null,kind,name,symbol,conversion='1',rate=0,relatedId=null,description='',gstin='',state='',address='',legalName='',isDefault=false}){
    if(!kinds.includes(kind))fail('Unknown master type');name=String(name||'').trim();
    if(!name||name.length>100)fail('Enter a name up to 100 characters');
    if(id&&get(id).kind!==kind)fail('A master cannot change type');
    if(kind==='category'&&name.length>40)fail('Category must be up to 40 characters');
    if(q('SELECT id FROM catalog_masters WHERE kind=? AND lower(name)=lower(?) AND id IS NOT ?').get(kind,name,id))fail('A master with this name already exists');
    const data={description:String(description).slice(0,500)};
    if(kind==='unit'){
      symbol=String(symbol??(id?get(id).symbol||get(id).name:name.toUpperCase())).trim();
      if(!symbol||symbol.length>10)fail('Enter a unit symbol up to 10 characters');
      if(list({kind}).some(row=>row.id!==id&&(row.symbol||row.name).toLowerCase()===symbol.toLowerCase()))fail('A unit with this symbol already exists');
      if(relatedId){typed(relatedId,'unit');let next=relatedId;while(next){if(next===id)fail('Units cannot inherit from themselves');next=get(next).relatedId;}}
      conversion=relatedId?String(conversion).trim():'1';units.factor(conversion);
      if(id){const old=get(id);if((old.relatedId!==relatedId||units.factor(old.conversion||'1')!==units.factor(conversion))&&units.used(id))fail('This unit family has documents. Create a new unit instead of changing its conversion');}
      Object.assign(data,{symbol,conversion});
    }
    if(kind==='gstSlab'){if(!Number.isInteger(rate)||rate<0||rate>10000)fail('GST percentage must be between 0 and 100');data.rate=rate;}
    if(kind==='hsn'){if(!/^\d{4,8}$/.test(name))fail('Enter an HSN / SAC code of 4 to 8 digits');typed(relatedId,'gstSlab');}else if(kind!=='unit')relatedId=null;
    if(kind==='gstRegistration'){
      if(id&&get(id).isDefault&&!isDefault)fail('Select another default GST registration first');
      gstin=String(gstin).trim().toUpperCase();if(!/^[0-9]{2}[A-Z0-9]{13}$/.test(gstin))fail('Enter a 15-character GSTIN');
      if(!String(state).trim()||!String(legalName).trim())fail('Legal name and state are required');
      Object.assign(data,{gstin,state:String(state).trim(),address:String(address).slice(0,5000),legalName:String(legalName).trim(),isDefault:Boolean(isDefault)});
    }
    return tx(()=>{
      if(id)q('UPDATE catalog_masters SET name=?,data=?,related_id=? WHERE id=?').run(name,JSON.stringify(data),relatedId,id);
      else id=Number(q('INSERT INTO catalog_masters(kind,name,data,related_id) VALUES(?,?,?,?)').run(kind,name,JSON.stringify(data),relatedId).lastInsertRowid);
      if(kind==='unit')units.path(id);
      if(kind==='gstRegistration'&&isDefault){
        for(const other of list({kind}).filter(r=>r.id!==id&&r.isDefault)){const d=JSON.parse(other.data);d.isDefault=false;q('UPDATE catalog_masters SET data=? WHERE id=?').run(JSON.stringify(d),other.id);}
        for(const [key,value] of [['gstin',gstin],['state',data.state],['address',data.address]])q('INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(`company_${key}`,value);
      }
      const column=Object.values(mapping).find(([,type])=>type===kind)?.[0];
      if(column)for(const row of q(`SELECT item_id FROM item_master_links WHERE ${column}=?`).all(id))refreshItem(row.item_id);
      return {id};
    });
  }
  function links(itemId){
    const row=q('SELECT * FROM item_master_links WHERE item_id=?').get(itemId)||{};
    const result=Object.fromEntries(Object.entries(mapping).map(([key,[column]])=>[key,row[column]||null]));
    result.itemGroup=result.itemGroupId?get(result.itemGroupId).name:'';return result;
  }
  function mapItem(args){
    const previous=args.id?links(args.id):{};
    const next={...args};
    for(const [key,[,kind]] of Object.entries(mapping)){
      next[key]=Object.hasOwn(args,key)?args[key]||null:previous[key]||null;
      if(next[key])typed(next[key],kind);
    }
    if(next.categoryId)next.category=get(next.categoryId).name;
    if(next.unitId)next.unit=get(next.unitId).symbol||get(next.unitId).name;
    if(args.id){const old=q('SELECT unit FROM items WHERE id=?').get(args.id);const hasDocs=q('SELECT 1 FROM stock_moves WHERE item_id=?1 UNION ALL SELECT 1 FROM order_lines WHERE item_id=?1 LIMIT 1').get(args.id);
      if(hasDocs&&((previous.unitId&&next.unitId!==previous.unitId)||(!previous.unitId&&String(next.unit||'').toUpperCase()!==old.unit.toUpperCase())))fail('Stock unit cannot change after an item has documents');}
    if(next.hsnId){const hsn=get(next.hsnId);next.hsn=hsn.name;next.gstSlabId=hsn.relatedId;}
    if(next.gstSlabId)next.gstRate=get(next.gstSlabId).rate;
    return next;
  }
  function saveLinks(itemId,args){
    const keys=Object.keys(mapping),columns=Object.values(mapping).map(([column])=>column);
    q(`INSERT INTO item_master_links(item_id,${columns.join(',')}) VALUES(?,?,?,?,?,?) ON CONFLICT(item_id) DO UPDATE SET ${columns.map(c=>`${c}=excluded.${c}`).join(',')}`).run(itemId,...keys.map(key=>args[key]||null));
  }
  function refreshItem(itemId){
    const item=q('SELECT * FROM items WHERE id=?').get(itemId),next=mapItem({id:itemId,category:item.category,unit:item.unit,hsn:item.hsn,gstRate:item.gst_rate});
    q('UPDATE items SET category=?,unit=?,hsn=?,gst_rate=? WHERE id=?').run(next.category,next.unit,next.hsn,next.gstRate,itemId);saveLinks(itemId,next);
  }
  function remove({id}){
    const row=get(id);
    if(row.kind==='unit'&&q("SELECT value FROM record_details WHERE scope='document'").all().some(record=>JSON.parse(record.value).unitLines?.some(unit=>unit.unitId===id)))fail('This unit has documents and cannot be deleted');
    if(row.kind==='gstRegistration'&&row.isDefault)fail('Select another default GST registration before deleting this one');
    if(q('SELECT id FROM catalog_masters WHERE related_id=?').get(id)||q('SELECT item_id FROM item_master_links WHERE category_id=?1 OR item_group_id=?1 OR unit_id=?1 OR hsn_id=?1 OR gst_slab_id=?1').get(id))fail('This master is in use and cannot be deleted');
    q('DELETE FROM catalog_masters WHERE id=?').run(id);return {id};
  }
  return {links,mapItem,saveLinks,units,api:{catalogMasters:list,saveCatalogMaster:save,deleteCatalogMaster:remove,itemUnits:({itemId})=>units.options(itemId)}};
};
