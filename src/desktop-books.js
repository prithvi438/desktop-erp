'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {DatabaseSync}=require('node:sqlite');
const {openBooks}=require('./books');

function openDesktopBooks(dataDir){
  if(!process.env.SPEEDOONE_PG_URL)throw Error('Local PostgreSQL must be running before opening the books');
  const source=path.join(dataDir,'books.db');
  let books=openBooks(source);
  try{
    if(books.database.prepare("SELECT value FROM meta WHERE key='database_backend'").get()?.value==='postgres')return books;
    if(fs.existsSync(source)){
      const stage=path.join(dataDir,`.sqlite-migration-${crypto.randomUUID()}.db`),archive=path.join(dataDir,`sqlite-migration-${Date.now()}.speedobook`);
      let sqlite,staged;
      try{
        sqlite=new DatabaseSync(source,{readOnly:true});
        const version=sqlite.prepare('PRAGMA user_version').get().user_version;
        if(!version||version>books.schemaVersion)throw Error('These SQLite books need a different version of Speedo One');
        const tables=new Set(sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row=>row.name));
        if(!['meta','groups','ledgers','items','vouchers','entries'].every(name=>tables.has(name)))throw Error('The existing file is not a Speedo One books database');
        if(sqlite.prepare('PRAGMA integrity_check').get().integrity_check!=='ok'||sqlite.prepare('PRAGMA foreign_key_check').all().length)throw Error('Existing SQLite books failed integrity checks. Migration was not performed.');
        // VACUUM INTO captures committed WAL data; the source is never upgraded or modified.
        sqlite.prepare('VACUUM INTO ?').run(stage);sqlite.close();sqlite=null;
        staged=openBooks(stage,{driver:'sqlite'});
        require('./postgres-backup').createBackup(staged.database,archive,staged.schemaVersion);
        staged.close();staged=null;
        require('./postgres-backup').restore(books.database,archive,books.schemaVersion,{unlinkSync:false});
      }finally{sqlite?.close();staged?.close();fs.rmSync(stage,{force:true});}
      books.close();books=openBooks(source);
    }else books.database.prepare("INSERT INTO meta(key,value) VALUES('database_backend','postgres') ON CONFLICT(key) DO UPDATE SET value=excluded.value").run();
    return books;
  }catch(error){books.close();throw error;}
}
module.exports={openDesktopBooks};
