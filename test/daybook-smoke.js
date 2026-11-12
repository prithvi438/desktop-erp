'use strict';
const {app,BrowserWindow}=require('electron'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const out=fs.mkdtempSync(path.join(os.tmpdir(),'speedoone-daybook-'));process.env.SPEEDOONE_DATA_DIR=out;require('../main');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
app.whenReady().then(async()=>{
 await require('./wait-for-window')();const win=BrowserWindow.getAllWindows()[0],page=win.webContents;win.show();win.focus();page.focus();
 const js=code=>page.executeJavaScript(code),api=(name,args={})=>js(`window.books.call(${JSON.stringify(name)},${JSON.stringify(args)})`);
 async function press(keyCode,modifiers=[]){page.sendInputEvent({type:'keyDown',keyCode,modifiers});page.sendInputEvent({type:'keyUp',keyCode,modifiers});await sleep(160);}
 async function replace(value){await press('a',['control']);await page.insertText(value);}
 const status=()=>js('document.querySelector(".daybook > .tip").textContent');
 try{
  const groups=await api('groups'),party=(await api('saveLedger',{name:'Daybook Supplier',groupId:groups.find(g=>g.name==='Sundry Creditors').id})).id;
  const cash=(await api('ledgers')).find(l=>l.name==='Cash').id;
  const now=await js(`(async()=> (await import('./ui.js')).today())()`);
  const current=(await api('financialYearState')).selected,old=await api('createFinancialYear',{from:'1999-04-01',to:'2000-03-31'});
  for(const date of ['2000-01-01','2000-01-02','2000-01-03',now]){await api('selectFinancialYear',{id:date===now?current:old.id});await api('saveVoucher',{type:'Payment',date,narration:'Payment '+date,lines:[{ledgerId:party,amount:1000},{ledgerId:cash,amount:-1000}]});}
  assert.equal(await js(`[...document.querySelectorAll('#nav .workspace-nav strong')].map(n=>n.textContent).join('|').includes('Create Vouchers|Daybook')`),true);
  await js(`[...document.querySelectorAll('#nav .workspace-nav')].find(n=>n.querySelector('strong').textContent==='Daybook').click()`);await sleep(200);
  assert.match(await status(),/^1 transactions/);
  await press('F2');await replace('02-01-2000');await press('Enter');assert.match(await status(),/^1 transactions.*02-01-2000/);
  assert.match(await js('document.querySelector(".daybook tbody").textContent'),/Payment 2000-01-02/);
  await press('F2',['alt']);await replace('01-01-2000');await press('Tab');await replace('03-01-2000');await press('Enter');
  assert.match(await status(),/^3 transactions.*01-01-2000 to 03-01-2000/);
  await press('F2',['alt']);await replace('04-01-2000');await press('Enter');assert.match(await status(),/^3 transactions/);
  await press('F2',['alt']);await replace('01-01-2000');await press('Enter');
  await press('Enter');assert.equal(await js('document.querySelector("#title").textContent'),'Alter voucher: Payment');
  if(await js('!!document.querySelector(".choice-panel:not([hidden])")'))await press('Escape');await press('Escape');
  assert.match(await status(),/^3 transactions/);
  await press('F2');await replace('05-01-2000');await press('Enter');assert.match(await status(),/^0 transactions/);
  for(const height of [640,800]){win.setSize(1100,height);await sleep(150);assert.deepEqual(await js(`[...document.querySelectorAll('.daybook,#nav')].filter(el=>el.scrollHeight>el.clientHeight+2||el.scrollWidth>el.clientWidth+2).map(el=>el.className)`),[]);}
  fs.writeFileSync(path.join(out,'daybook.png'),(await page.capturePage()).toPNG());
  console.log('DAYBOOK SMOKE OK: sidebar, single date, inclusive range, invalid dates, empty dates and voucher opening. '+out);app.exit(0);
 }catch(error){console.error(error.stack);app.exit(1);}
});
