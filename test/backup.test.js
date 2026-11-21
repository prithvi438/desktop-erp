'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {openBooks}=require('../src/books'),backup=require('../src/backup');
test('CSV exports preserve commas and quotes without executing spreadsheet formulas',()=>{
  const {tableCsv}=require('../src/csv');
  const value=tableCsv({columns:['Name','Amount'],rows:[['A, "quoted" name',100],['=HYPERLINK("evil")',10],['  @SUM(A1)',20]]});
  assert.ok(value.startsWith('\uFEFF'));assert.match(value,/A, ""quoted"" name/);assert.match(value,/'=HYPERLINK/);assert.match(value,/'  @SUM/);
  assert.throws(()=>tableCsv({columns:['Name'],rows:[['too','many']]}),/Invalid report/);
});
test('backup captures committed WAL data and attachments; restored books lose their cloud link',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'desktop-erp-backup-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const current=path.join(dir,'books.db'),copy=path.join(dir,'backup.db'),book=openBooks(current,{driver:'sqlite'});
  const group=book.api.groups().find(r=>r.name==='Sundry Debtors').id;
  book.api.setCompany({name:'Backup Company'});
  book.api.saveLedger({name:'Customer',groupId:group,policy:{creditLimit:10000}});
  const bytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aF9sAAAAASUVORK5CYII=','base64');
  const file=book.files.importFile({name:'image.png',bytes});
  book.api.saveItem({name:'Backed up item',unit:'PCS',details:{attachments:[file.id]}});
  book.support.setState('connection','existing');book.support.setState('enabled','1');
  book.backup(copy);const version=book.schemaVersion;book.close();
  const info=backup.inspect(copy,version);assert.equal(info.company,'Backup Company');
  const staged=backup.prepareRestore(copy,current,version),restored=openBooks(staged,{driver:'sqlite'});
  assert.equal(restored.api.ledgers().find(r=>r.name==='Customer').creditLimit,10000);
  assert.equal(restored.support.getState('connection'),'');assert.equal(restored.support.getState('enabled'),'');
  assert.deepEqual(Buffer.from(restored.files.fileBytes(file.id).bytes),bytes);restored.close();
  assert.throws(()=>backup.inspect(copy,version-1),/different version/);
  const invalid=path.join(dir,'invalid.db');fs.writeFileSync(invalid,'Not SQLite');assert.throws(()=>backup.inspect(invalid,version));
});
