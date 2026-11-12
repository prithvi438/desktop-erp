'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {openBooks}=require('../src/books');
function setup(t){const books=openBooks(':memory:');t.after(()=>books.close());return books.api;}
test('catalog mappings drive item identity, tax and pricebooks atomically',t=>{
  const a=setup(t),make=(kind,name,extra={})=>a.saveCatalogMaster({kind,name,...extra}).id;
  const categoryId=make('category','Hardware'),itemGroupId=make('itemGroup','Tools'),unitId=make('unit','pcs');
  const gstSlabId=make('gstSlab','Test rate',{rate:1200}),hsnId=make('hsn','1234',{relatedId:gstSlabId});
  const bookId=a.savePricebook({name:'Retail'}).id;
  const id=a.saveItem({name:'Hammer',categoryId,itemGroupId,unitId,hsnId,gstRate:999,saleRate:10000,pricebookEntry:{bookId,price:9500}}).id;
  let item=a.items().find(r=>r.id===id);
  assert.deepEqual([item.category,item.itemGroup,item.unit,item.hsn,item.gstRate,item.gstSlabId],['Hardware','Tools','PCS','1234',1200,gstSlabId]);
  assert.equal(a.resolvePrice({itemId:id,bookId}).price,9500);
  assert.throws(()=>make('category','hardware'),/already exists/);
  assert.throws(()=>a.deleteCatalogMaster({id:hsnId}),/in use/);
  assert.throws(()=>a.deleteCatalogMaster({id:gstSlabId}),/in use/);
  assert.throws(()=>a.saveItem({name:'Invalid',categoryId:unitId}),/valid category/);
  assert.throws(()=>a.saveItem({name:'Rollback',unit:'PCS',pricebookEntry:{bookId,price:-1}}),/Price/);
  assert.equal(a.items().some(r=>r.name==='Rollback'),false);
  a.saveCatalogMaster({id:gstSlabId,kind:'gstSlab',name:'Test rate revised',rate:1800});
  a.saveCatalogMaster({id:categoryId,kind:'category',name:'Equipment'});
  item=a.items().find(r=>r.id===id);assert.equal(item.gstRate,1800);assert.equal(item.category,'Equipment');
  a.deleteItem({id});a.deleteCatalogMaster({id:hsnId});a.deleteCatalogMaster({id:gstSlabId});
});
test('company GST defaults and optional item dropdowns retain protected values',t=>{
  const a=setup(t),registration={kind:'gstRegistration',name:'Office',gstin:'27ABCDE1234F1Z5',state:'Maharashtra',legalName:'Example',address:'Office address',isDefault:true};
  const first=a.saveCatalogMaster(registration).id;
  assert.throws(()=>a.deleteCatalogMaster({id:first}),/default/);
  assert.throws(()=>a.saveCatalogMaster({...registration,id:first,isDefault:false}),/default/);
  const second=a.saveCatalogMaster({...registration,name:'Branch'}).id;
  assert.equal(a.catalogMasters({kind:'gstRegistration'}).find(r=>r.id===first).isDefault,false);
  a.deleteCatalogMaster({id:first});assert.equal(a.catalogMasters({kind:'gstRegistration'})[0].id,second);
  assert.equal(a.settings().dropdownMasters,false);a.saveSettings({...a.settings(),dropdownMasters:true});assert.equal(a.settings().dropdownMasters,true);
  const field=a.saveCustomField({scope:'item',kind:'select',label:'Colour',options:['Red','Blue']});
  assert.equal(a.customFields({scope:'item'}).length,1);a.deleteCustomField(field);assert.equal(a.customFields({scope:'item'}).length,0);
});
