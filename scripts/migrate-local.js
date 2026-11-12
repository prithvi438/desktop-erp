'use strict';
// Run with Electron so the local PostgreSQL credentials use the same OS vault as the app.
const {app,safeStorage}=require('electron');
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {startLocalPostgres}=require('../src/local-postgres');
const {openDesktopBooks}=require('../src/desktop-books');
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const directory=process.env.SPEEDOONE_DATA_DIR||path.join(app.getPath('appData'),'speedoone-pos');
app.setName('speedoone-pos');
app.setPath('userData',directory);
app.whenReady().then(async()=>{
  const source=path.join(directory,'books.db');
  let server,books,code=0;
  try{
    const before=fs.existsSync(source)?hash(source):null;
    if(!await safeStorage.isAsyncEncryptionAvailable())throw Error('Secure credential storage is unavailable');
    server=await startLocalPostgres(directory,{encrypt:value=>safeStorage.encryptStringAsync(value),decrypt:async value=>(await safeStorage.decryptStringAsync(value)).result});
    process.env.SPEEDOONE_PG_URL=server.connectionString;
    books=openDesktopBooks(directory);server.takeOwnership();
    if(before&&hash(source)!==before)throw Error('The SQLite source changed during migration');
    const summary={backend:books.database.dialect,sqliteUnchanged:before?true:null,
      counts:Object.fromEntries(['groups','ledgers','items','vouchers','entries','local_files'].map(table=>[table,books.database.query(`SELECT COUNT(*) AS n FROM ${table}`).rows[0].n]))};
    if(summary.backend!=='postgres')throw Error('PostgreSQL verification failed');
    console.log(JSON.stringify(summary,null,2));
  }catch(error){console.error(error.message);code=1;}
  finally{books?.close();try{await server?.stop();}catch(error){console.error(error.message);code=1;}app.exit(code);}
});
