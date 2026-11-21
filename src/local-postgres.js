'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),net=require('node:net');
const {spawn}=require('node:child_process');
// PostgreSQL is a background process: inherited output pipes must not keep
// pg_ctl's caller waiting after the server is ready.
const run=(binary,args)=>new Promise((resolve,reject)=>{
  const child=spawn(binary,args,{windowsHide:true,stdio:'ignore'});
  const timer=setTimeout(()=>{child.kill();reject(new Error(`PostgreSQL ${path.basename(binary)} timed out`));},45000);
  child.on('error',error=>{clearTimeout(timer);reject(error);});
  child.on('exit',code=>{clearTimeout(timer);code===0?resolve():reject(new Error(`PostgreSQL ${path.basename(binary)} failed (${code}). Check postgres.log in the app data folder.`));});
});
const freePort=()=>new Promise((resolve,reject)=>{const server=net.createServer();server.on('error',reject);server.listen(0,'127.0.0.1',()=>{const port=server.address().port;server.close(()=>resolve(port));});});
async function startLocalPostgres(dataDir,{encrypt=value=>Buffer.from(value),decrypt=value=>value.toString()}={}){
  fs.mkdirSync(dataDir,{recursive:true});
  const platform=process.platform==='win32'?'windows':process.platform;
  const binaries=await import(`@embedded-postgres/${platform}-${process.arch}`);
  const directory=path.join(dataDir,'postgres'),credentials=path.join(dataDir,'postgres.credentials');
  let config;
  if(fs.existsSync(credentials))config=JSON.parse(await decrypt(fs.readFileSync(credentials)));
  else{
    if(fs.existsSync(path.join(directory,'PG_VERSION')))throw Error('PostgreSQL credentials are missing. Restore postgres.credentials before opening these books.');
    config={user:'desktop-erp',password:crypto.randomBytes(32).toString('hex'),port:await freePort()};
    fs.writeFileSync(credentials,await encrypt(JSON.stringify(config)),{mode:0o600,flag:'wx'});
  }
  if(!fs.existsSync(path.join(directory,'PG_VERSION'))){
    const passwordFile=path.join(dataDir,`.pg-password-${crypto.randomUUID()}`);
    try{
      fs.writeFileSync(passwordFile,config.password,{mode:0o600,flag:'wx'});
      await run(binaries.initdb,['-D',directory,'-U',config.user,'--pwfile',passwordFile,'--auth=scram-sha-256','--encoding=UTF8','--locale=C']);
    }finally{fs.rmSync(passwordFile,{force:true});}
  }
  let running=false;
  try{await run(binaries.pg_ctl,['-D',directory,'status']);running=true;}catch{}
  if(!running)await run(binaries.pg_ctl,['-D',directory,'-l',path.join(dataDir,'postgres.log'),'-o',`-h 127.0.0.1 -p ${config.port}`,'-w','-t','30','start']);
  const connectionString=`postgresql://${config.user}:${config.password}@127.0.0.1:${config.port}/postgres`;
  let stopped=false,owned=!running;
  return {connectionString,directory,takeOwnership(){owned=true;},async stop(){if(stopped||!owned)return;stopped=true;await run(binaries.pg_ctl,['-D',directory,'-m','fast','-w','-t','30','stop']);}};
}
module.exports={startLocalPostgres};
