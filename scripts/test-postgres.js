'use strict';
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawn}=require('node:child_process');
const {startLocalPostgres}=require('../src/local-postgres');
(async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'desktop-erp-pg-test-'));
  let server;
  try{
    server=await startLocalPostgres(dir);
    const files=process.argv.slice(2);
    const args=files.length?files:['test/books.test.js','test/sync.test.js','test/details.test.js','test/retail.test.js','test/backup.test.js','test/postgres.test.js','test/catalog.test.js','test/units.test.js','test/account-books.test.js','test/inventory.test.js','test/reporting.test.js','test/report-books.test.js','test/company-workspace.test.js','test/bill-references.test.js'];
    process.exitCode=await new Promise(resolve=>{
      const child=spawn(process.execPath,['--test',...args],{stdio:'inherit',windowsHide:true,env:{...process.env,DESKTOP_ERP_PG_URL:server.connectionString}});
      child.on('exit',code=>resolve(code??1));child.on('error',()=>resolve(1));
    });
  }finally{if(server)await server.stop();}
})().catch(error=>{console.error(error.message);process.exitCode=1;});
