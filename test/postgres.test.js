'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {openBooks}=require('../src/books');
const {openDesktopBooks}=require('../src/desktop-books');
const backup=require('../src/postgres-backup');
const digest=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aF9sAAAAASUVORK5CYII=','base64');

test('SQLite migrates once into PostgreSQL with IDs, money, details and file bytes preserved',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'speedoone-migrate-')),source=path.join(dir,'books.db');
  let old=openBooks(source,{driver:'sqlite'}),book;
  try{
    const groups=old.api.groups(),debtor=groups.find(g=>g.name==='Sundry Debtors').id;
    const party=old.api.saveLedger({name:'Migration customer',groupId:debtor,opening:12500,details:{address:'Existing address'},policy:{creditLimit:250000}}).id;
    const file=old.files.importFile({name:'photo.png',bytes:png});
    const item=old.api.saveItem({name:'Migration item',unit:'PCS',details:{attachments:[file.id]}}).id;
    old.api.saveInvoice({type:'Purchase',date:'2026-11-01',partyId:party,items:[{itemId:item,qty:10000,rate:10000}]});
    old.support.setState('connection','keep-existing-pairing');
    const before={groups:old.api.groups(),ledgers:old.api.ledgers(),items:old.api.items(),dayBook:old.api.dayBook(),statements:old.api.statements({asOf:'2026-11-30'})};
    old.close();old=null;const original=digest(source);
    book=openDesktopBooks(dir);assert.equal(book.database.dialect,'postgres');
    assert.deepEqual(JSON.parse(JSON.stringify({groups:book.api.groups(),ledgers:book.api.ledgers(),items:book.api.items(),dayBook:book.api.dayBook(),statements:book.api.statements({asOf:'2026-11-30'})})),JSON.parse(JSON.stringify(before)));
    assert.deepEqual(Buffer.from(book.files.fileBytes(file.id).bytes),png);
    assert.equal(book.api.recordDetails({scope:'ledger',id:party}).address,'Existing address');
    assert.equal(book.support.getState('connection'),'keep-existing-pairing');
    assert.equal(digest(source),original);
    const added=book.api.saveLedger({name:'Created in PostgreSQL',groupId:debtor}).id;assert.ok(added>party);
    book.close();book=openDesktopBooks(dir);
    assert.equal(book.api.ledgers().filter(row=>row.id===added).length,1);assert.equal(digest(source),original);
  }finally{old?.close();book?.close();}
});

test('PostgreSQL backup restores transactionally, verifies contents and clears cloud pairing',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'speedoone-pg-backup-'));
  const book=openBooks(path.join(dir,'books.db')),file=path.join(dir,'copy.speedobook');
  try{
    const group=book.api.groups().find(row=>row.name==='Sundry Debtors').id;
    book.api.saveLedger({name:'Original customer',groupId:group});
    const image=book.files.importFile({name:'photo.png',bytes:png});book.api.saveItem({name:'Image item',unit:'PCS',details:{attachments:[image.id]}});
    const categoryId=book.api.saveCatalogMaster({kind:'category',name:'Archived category'}).id;
    book.api.saveItem({name:'Mapped archive item',unit:'PCS',categoryId});
    book.support.setState('connection','paired');book.backup(file);
    book.api.saveLedger({name:'After backup',groupId:group});
    backup.restore(book.database,file,book.schemaVersion);
    assert.equal(book.api.ledgers().some(row=>row.name==='After backup'),false);assert.equal(book.support.getState('connection'),'');
    assert.deepEqual(Buffer.from(book.files.fileBytes(image.id).bytes),png);
    assert.equal(book.api.items().find(row=>row.name==='Mapped archive item').categoryId,categoryId);
    const corrupt=path.join(dir,'corrupt.speedobook');fs.writeFileSync(corrupt,fs.readFileSync(file,'utf8').replace('Original customer','Changed customer'));
    assert.throws(()=>backup.restore(book.database,corrupt,book.schemaVersion),/checksum/);
    const rows=fs.readFileSync(file,'utf8').trimEnd().split('\n').map(line=>JSON.parse(line));rows.pop();
    const columns=rows[0].tables.find(row=>row.name==='ledgers').columns;
    rows.find(row=>row.table==='ledgers').values[columns.indexOf('group_id')]=999999;
    const text=rows.map(row=>JSON.stringify(row)+'\n').join('');fs.writeFileSync(corrupt,text+JSON.stringify({sha256:crypto.createHash('sha256').update(text).digest('hex')})+'\n');
    assert.throws(()=>backup.restore(book.database,corrupt,book.schemaVersion),/foreign key/);
    assert.ok(book.api.ledgers().some(row=>row.name==='Original customer'));
    assert.ok(book.api.saveLedger({name:'After rollback',groupId:group}).id);
    const legacy=path.join(dir,'previous-version.speedobook');
    const previous=fs.readFileSync(file,'utf8').trimEnd().split('\n').map(JSON.parse);previous.pop();
    previous[0].version=8;previous[0].tables=previous[0].tables.filter(t=>!['catalog_masters','item_master_links'].includes(t.name));
    const oldText=previous.filter(row=>!['catalog_masters','item_master_links'].includes(row.table)).map(row=>JSON.stringify(row)+'\n').join('');
    fs.writeFileSync(legacy,oldText+JSON.stringify({sha256:crypto.createHash('sha256').update(oldText).digest('hex')})+'\n');
    backup.restore(book.database,legacy,book.schemaVersion);
    assert.equal(book.api.catalogMasters({kind:'category'}).length,0);
    assert.equal(book.api.items().find(row=>row.name==='Mapped archive item').category,'Archived category');
  }finally{book.close();}
});

test('same books cannot be opened concurrently',()=>{
  const file=path.join(fs.mkdtempSync(path.join(os.tmpdir(),'speedoone-pg-owner-')),'books.db');
  const book=openBooks(file);try{assert.throws(()=>openBooks(file),/already open/);}finally{book.close();}
  openBooks(file).close();
});
