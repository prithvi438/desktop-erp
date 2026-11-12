'use strict';
const {workerData}=require('node:worker_threads');
const {Client,types}=require('pg');
const {port,signal,config}=workerData;
const flag=new Int32Array(signal);
const number=value=>{const n=Number(value);if(!Number.isSafeInteger(n))throw Error('Database integer exceeds the safe accounting range');return n;};
types.setTypeParser(20,number);types.setTypeParser(1700,Number);types.setTypeParser(16,value=>value==='t'?1:0);
const client=new Client({...config,connectionTimeoutMillis:10000,statement_timeout:30000});
let ready;
function reply(value){port.postMessage(value);Atomics.store(flag,0,1);Atomics.notify(flag,0);}
client.on('error',()=>{});
ready=client.connect();
ready.catch(()=>{});
port.on('message',async request=>{
  try{
    await ready;
    if(request.close){await client.end();reply({ok:true});port.close();return;}
    const values=request.values?.map(value=>value instanceof Uint8Array?Buffer.from(value):value);
    const result=await client.query(request.sql,values);
    reply({ok:true,rows:result.rows||[],changes:result.rowCount||0});
  }catch(error){reply({ok:false,error:{message:error.message,code:error.code}});}
});
