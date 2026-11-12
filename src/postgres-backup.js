'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const TABLES=['meta','groups','ledgers','vouchers','entries','items','invoices','stock_moves','cleared','budgets','order_lines','pricebooks','pricebook_entries','cheques','cheque_vouchers','custom_fields','record_details','local_files','ledger_policy','item_policy','bill_allocations','catalog_masters','item_master_links'];
const identifier=name=>{if(!/^[a-z_][a-z_0-9]*$/.test(name))throw Error('Invalid backup identifier');return `"${name}"`;};
const encode=value=>value instanceof Uint8Array?{binary:Buffer.from(value).toString('base64')}:value;
const decode=value=>value&&typeof value==='object'&&Object.keys(value).length===1&&typeof value.binary==='string'?Buffer.from(value.binary,'base64'):value;
function* lines(file){
  const fd=fs.openSync(file,'r'),buffer=Buffer.alloc(65536);let pending='';
  const {StringDecoder}=require('node:string_decoder'),decoder=new StringDecoder('utf8');
  try{let count;while((count=fs.readSync(fd,buffer,0,buffer.length,null))){pending+=decoder.write(buffer.subarray(0,count));let index;while((index=pending.indexOf('\n'))>=0){yield pending.slice(0,index);pending=pending.slice(index+1);}if(pending.length>32*1024*1024)throw Error('Backup record exceeds size limit');}pending+=decoder.end();if(pending)throw Error('Backup is incomplete');}finally{fs.closeSync(fd);}
}
function columns(db,table){return db.dialect==='postgres'?db.query('SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2 ORDER BY ordinal_position',[db.schema,table]).rows.map(r=>r.column_name):db.prepare(`PRAGMA table_info(${identifier(table)})`).all().map(r=>r.name);}
function createBackup(db,destination,version){
  const temp=path.join(path.dirname(destination),`.speedoone-${crypto.randomUUID()}.tmp`),fd=fs.openSync(temp,'wx',0o600),hash=crypto.createHash('sha256');let transaction=false;
  const write=value=>{const line=JSON.stringify(value)+'\n';fs.writeSync(fd,line);hash.update(line);};
  try{
    db.exec(db.dialect==='postgres'?'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY':'BEGIN');transaction=true;
    const tables=TABLES.map(name=>({name,columns:columns(db,name),count:db.prepare(`SELECT COUNT(*) AS n FROM ${identifier(name)}`).get().n}));
    const header={format:'speedoone-postgres-backup',version,company:db.prepare("SELECT value FROM meta WHERE key='company_name'").get()?.value||'Unnamed company',tables};write(header);
    for(const table of tables){
      if(db.dialect==='postgres'){
        db.query(`DECLARE backup_rows NO SCROLL CURSOR FOR SELECT * FROM ${identifier(table.name)}`);
        for(;;){const rows=db.query('FETCH 100 FROM backup_rows').rows;if(!rows.length)break;for(const row of rows)write({table:table.name,values:table.columns.map(column=>encode(row[column]))});}
        db.query('CLOSE backup_rows');
      }else{
        for(const row of db.prepare(`SELECT * FROM ${identifier(table.name)}`).iterate())write({table:table.name,values:table.columns.map(column=>encode(row[column]))});
      }
    }
    fs.writeSync(fd,JSON.stringify({sha256:hash.digest('hex')})+'\n');fs.fsyncSync(fd);
    db.exec('COMMIT');transaction=false;fs.closeSync(fd);fs.renameSync(temp,destination);return {saved:true,file:destination};
  }catch(error){if(transaction)db.exec('ROLLBACK');try{fs.closeSync(fd);}catch{}fs.rmSync(temp,{force:true});throw error;}
}
function inspect(file,maxVersion){
  const hash=crypto.createHash('sha256'),counts=new Map();let header,ended=false;
  for(const line of lines(file)){
    if(ended)throw Error('Unexpected data after backup checksum');
    const value=JSON.parse(line);
    if(!header){
      header=value;if(header.format!=='speedoone-postgres-backup'||!Number.isInteger(header.version)||(header.version<8||header.version>maxVersion))throw Error('This backup needs a different version of Speedo One');
      if(!Array.isArray(header.tables)||header.tables.length!==(header.version<9?TABLES.length-2:TABLES.length))throw Error('Invalid backup tables');
      const expectedTables=header.version<9?TABLES.slice(0,-2):TABLES;
      for(const table of header.tables){if(!expectedTables.includes(table.name)||counts.has(table.name)||!Array.isArray(table.columns)||!table.columns.length||!Number.isSafeInteger(table.count)||table.count<0)throw Error('Invalid backup table');table.columns.forEach(identifier);counts.set(table.name,0);}
    }else if(value.sha256){if(hash.digest('hex')!==value.sha256)throw Error('Backup checksum does not match');ended=true;continue;}
    else {const table=header.tables.find(t=>t.name===value.table);if(!table||!Array.isArray(value.values)||value.values.length!==table.columns.length)throw Error('Invalid backup record');counts.set(value.table,counts.get(value.table)+1);}
    hash.update(line+'\n');
  }
  if(!ended||header.tables.some(t=>counts.get(t.name)!==t.count))throw Error('Backup is incomplete');
  return {...header,vouchers:counts.get('vouchers')};
}
function restore(db,file,version,{unlinkSync=true}={}){
  const info=inspect(file,version);
  for(const table of info.tables){if(JSON.stringify(columns(db,table.name))!==JSON.stringify(table.columns))throw Error(`Backup columns do not match ${table.name}`);}
  db.exec('BEGIN');
  try{
    const constraints=db.query("SELECT c.conname,t.relname FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname=$1 AND c.contype='f'",[db.schema]).rows;
    for(const c of constraints)db.query(`ALTER TABLE ${identifier(c.relname)} ALTER CONSTRAINT ${identifier(c.conname)} DEFERRABLE INITIALLY DEFERRED`);
    db.query(`TRUNCATE ${TABLES.map(identifier).join(',')} RESTART IDENTITY`);
    const hash=crypto.createHash('sha256');let first=true,ended=false;
    for(const line of lines(file)){
      const value=JSON.parse(line);
      if(value.sha256){if(hash.digest('hex')!==value.sha256)throw Error('Backup changed during restore');ended=true;continue;}
      if(ended)throw Error('Unexpected backup data');hash.update(line+'\n');if(first){first=false;continue;}
      const table=info.tables.find(t=>t.name===value.table);if(!table)throw Error('Invalid backup table');
      const row=db.query(`INSERT INTO ${identifier(table.name)} (${table.columns.map(identifier).join(',')}) VALUES (${table.columns.map((_,i)=>`$${i+1}`).join(',')}) RETURNING *`,value.values.map(decode)).rows[0];
      if(JSON.stringify(table.columns.map(column=>encode(row[column])))!==JSON.stringify(value.values))throw Error(`Verification failed for ${table.name}`);
    }
    if(!ended)throw Error('Backup is incomplete');
    for(const table of info.tables){
      if(db.query(`SELECT COUNT(*) AS n FROM ${identifier(table.name)}`).rows[0].n!==table.count)throw Error(`Row count verification failed for ${table.name}`);
      const sequence=table.columns.includes('id')?db.query('SELECT pg_get_serial_sequence($1, $2) AS seq',[`${db.schema}.${table.name}`,'id']).rows[0]?.seq:null;
      if(sequence)db.query(`SELECT setval($1,COALESCE((SELECT MAX(id) FROM ${identifier(table.name)}),1),EXISTS(SELECT 1 FROM ${identifier(table.name)}))`,[sequence]);
    }
    if(unlinkSync)db.query("DELETE FROM meta WHERE key LIKE 'sync_%'");
    db.query("INSERT INTO meta(key,value) VALUES('database_backend','postgres') ON CONFLICT(key) DO UPDATE SET value=excluded.value");
    db.exec('COMMIT');return info;
  }catch(error){db.exec('ROLLBACK');throw error;}
}
module.exports={createBackup,inspect,restore,TABLES};
