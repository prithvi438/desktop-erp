'use strict';
const {app,BrowserWindow}=require('electron'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const out=fs.mkdtempSync(path.join(os.tmpdir(),'speedoone-settlement-reopen-'));
process.env.SPEEDOONE_DATA_DIR=out;require('../main');
app.whenReady().then(async()=>{
 await require('./wait-for-window')();const page=BrowserWindow.getAllWindows()[0].webContents;
 const js=code=>page.executeJavaScript(code),api=(method,args={})=>js(`window.books.call(${JSON.stringify(method)},${JSON.stringify(args)})`);
 const normalize=lines=>lines.map(({ledgerId,amount})=>[ledgerId,amount]).sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
 try{
  const groups=await api('groups');
  const ledger=async(name,group)=>(await api('saveLedger',{name,groupId:groups.find(g=>g.name===group).id})).id;
  const cash=(await api('ledgers')).find(l=>l.name==='Cash').id;
  const bank=await ledger('Main bank','Bank Accounts'),od=await ledger('Overdraft','Bank OD A/c'),party=await ledger('Party','Sundry Debtors'),expense=await ledger('Expense','Indirect Expenses');
  const cases=[[[bank,-500],[party,500]],[[bank,-300],[cash,-200],[party,500]],[[cash,500],[party,-500]],[[party,-500],[expense,500]],[[od,-500],[expense,500]],[[bank,-500],[party,600],[expense,-100]]];
  for(const type of ['Payment','Receipt'])for(const [index,values] of cases.entries()){
   const lines=values.map(([ledgerId,amount])=>({ledgerId,amount:amount*(type==='Receipt'?-1:1)}));
   const saved=await api('saveVoucher',{type,date:'2026-11-11',narration:`${type} case ${index}`,lines});
   await js(`(async()=>{const {push}=await import('./router.js');const {voucherEntry}=await import('./voucher.js');await push(voucherEntry({id:${saved.id}}));})()`);
   assert.equal(await js('document.querySelector(".settlement").hidden'),false);
   assert.equal(await js('document.querySelector(".voucher > table.lines").hidden'),true);
   if(index===1){await new Promise(resolve=>setTimeout(resolve,300));fs.writeFileSync(path.join(out,`${type}.png`),(await page.capturePage()).toPNG());}
   await js(`(async()=>{const {top}=await import('./router.js');top().onKey({key:'s',code:'KeyS',ctrlKey:true,preventDefault(){}});})()`);
   for(let attempt=0;attempt<50&&await js('document.querySelector("#title").textContent.includes("Alter voucher")');attempt++)await new Promise(resolve=>setTimeout(resolve,100));
   const after=await api('voucher',{id:saved.id});
   assert.deepEqual(normalize(after.lines),normalize(lines),`${type} case ${index}`);
   assert.equal(after.narration,`${type} case ${index}`);
   assert.equal(await js('document.querySelector("#title").textContent.includes("Alter voucher")'),false,'Save must close the editor');
  }
  console.log('SETTLEMENT REOPEN SMOKE OK: 12 round trips. Screenshots: '+out);app.exit(0);
 }catch(error){console.error(error.stack);app.exit(1);}
});
