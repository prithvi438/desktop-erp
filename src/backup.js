'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {DatabaseSync}=require('node:sqlite');

// Validate a selected copy without upgrading or executing its schema.
function inspect(file,maxVersion){
  let db;
  try{
    if(fs.existsSync(`${file}-wal`)&&fs.statSync(`${file}-wal`).size)throw Error('Choose a completed backup, not a database currently in use by another application.');
    db=new DatabaseSync(file,{readOnly:true});
    const version=db.prepare('PRAGMA user_version').get().user_version;
    if(!version||version>maxVersion)throw Error('This backup needs a different version of Speedo One.');
    const tables=new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r=>r.name));
    if(!['meta','groups','ledgers','items','vouchers','entries'].every(name=>tables.has(name)))throw Error('This file is not a Speedo One books backup.');
    if(db.prepare('PRAGMA integrity_check').get().integrity_check!=='ok'||db.prepare('PRAGMA foreign_key_check').all().length)throw Error('This backup failed its integrity checks.');
    return {company:db.prepare("SELECT value FROM meta WHERE key='company_name'").get()?.value||'Unnamed company',version,vouchers:db.prepare('SELECT COUNT(*) AS n FROM vouchers').get().n};
  }finally{db?.close();}
}

function createBackup(db,destination){
  // SQLite produces a consistent snapshot, including WAL changes and embedded files.
  // Write beside the selected path, then rename so a failed copy cannot replace it.
  const staged=path.join(path.dirname(destination),`.speedoone-${crypto.randomUUID()}.db`);
  try{db.prepare('VACUUM INTO ?').run(staged);fs.renameSync(staged,destination);}
  finally{if(fs.existsSync(staged))fs.unlinkSync(staged);}
  return {saved:true,file:destination};
}

function prepareRestore(source,destination,maxVersion){
  inspect(source,maxVersion);
  const staged=path.join(path.dirname(destination),`.restore-${crypto.randomUUID()}.db`);
  try{
    fs.copyFileSync(source,staged);inspect(staged,maxVersion);
    const db=new DatabaseSync(staged);
    try{
      // Restored books must be explicitly paired again before any cloud transfer.
      db.exec("DELETE FROM meta WHERE key LIKE 'sync_%';");
    }finally{db.close();}
    return staged;
  }catch(error){if(fs.existsSync(staged))fs.unlinkSync(staged);throw error;}
}
module.exports={inspect,createBackup,prepareRestore};
