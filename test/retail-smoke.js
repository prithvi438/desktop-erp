'use strict';
const {app,BrowserWindow,dialog,ipcMain}=require('electron');
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {openBooks}=require('../src/books');
const out=fs.mkdtempSync(path.join(os.tmpdir(),'desktop-erp-retail-'));process.env.DESKTOP_ERP_DATA_DIR=out;
const backupFile=path.join(out,'test-backup.speedobook');
dialog.showSaveDialog=async()=>({canceled:false,filePath:backupFile});
dialog.showOpenDialog=async()=>({canceled:false,filePaths:[backupFile]});
dialog.showMessageBox=async()=>({response:1});
const seed=openBooks(path.join(out,'books.db')),a=seed.api,group=name=>a.groups().find(r=>r.name===name).id;
const pricebook=a.savePricebook({name:'Trade',mode:'MARKDOWN',pct:1000}).id;
const customer=a.saveLedger({name:'Buyer',groupId:group('Sundry Debtors'),policy:{creditLimit:1000000,pricebookId:pricebook}}).id;
const supplier=a.saveLedger({name:'Supplier',groupId:group('Sundry Creditors')}).id;
const cash=a.ledgers().find(r=>r.name==='Cash').id;
const item=a.saveItem({name:'Widget',unit:'PCS',saleRate:10000,purchaseRate:5000,reorderLevel:50000}).id;
a.saveInvoice({type:'Purchase',date:'2026-11-01',partyId:supplier,items:[{itemId:item,qty:30000,rate:5000,batch:'B1',expiry:'2030-12'}]});
for(let i=0;i<12;i++)a.saveInvoice({type:'Sales',date:'2026-11-02',partyId:customer,items:[{itemId:item,qty:1000,rate:10000,batch:'B1',expiry:'2030-12'}]});
const payment=a.saveVoucher({type:'Receipt',date:'2026-11-03',lines:[{ledgerId:cash,amount:25000},{ledgerId:customer,amount:-25000}]}).id;
seed.close();require('../main');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
app.whenReady().then(async()=>{
 await require('./wait-for-window')();const win=BrowserWindow.getAllWindows()[0],page=win.webContents;win.setSize(1100,720);win.show();win.focus();page.focus();page.setBackgroundThrottling(false);
 const js=s=>page.executeJavaScript(s),api=(method,args={})=>js(`window.books.call(${JSON.stringify(method)},${JSON.stringify(args)})`),title=()=>js('document.querySelector("#title").textContent');
 async function press(keyCode,modifiers=[]){page.sendInputEvent({type:'keyDown',keyCode,modifiers});page.sendInputEvent({type:'keyUp',keyCode,modifiers});await sleep(140);}
 async function type(text){await page.insertText(text);await sleep(100);}
 async function go(name){await press('k',['control']);await type(name);await press('Enter');await sleep(200);}
 async function shot(name){fs.writeFileSync(path.join(out,`${name}.png`),(await page.capturePage()).toPNG());}
 async function fits(){for(const height of [640,720]){win.setSize(1100,height);await sleep(160);const overflow=await js(`[...document.querySelectorAll('#nav,.browse-rail,.browse-option-rows,.retail-screen,.retail-list,.retail-list .manage-results,.allocation-form,.sync-form,.sync-group,.paged-master')].filter(e=>e.getClientRects().length&&(e.scrollHeight>e.clientHeight+2||e.scrollWidth>e.clientWidth+2)).map(e=>({class:e.className,height:[e.clientHeight,e.scrollHeight],width:[e.clientWidth,e.scrollWidth]}))`);assert.deepEqual(overflow,[]);}}
 try{
   await go('Outstanding bills');assert.equal(await title(),'Outstanding bills');await press('p',['alt']);await type('Buyer');await press('Down');await press('Enter');await fits();await shot('outstanding');
   await press('t',['alt']);await press('Enter');assert.equal(await title(),'Allocate bills');await press('a',['alt']);await fits();await shot('allocations');await press('s',['control']);
   let balance=await api('outstandingBills',{partyId:customer,asOf:'2026-11-09'});assert.equal(balance.pending,95000);assert.equal(balance.onAccount,0);
   await press('Enter');await press('c',['alt']);await press('s',['control']);balance=await api('outstandingBills',{partyId:customer,asOf:'2026-11-09'});assert.equal(balance.onAccount,25000);
   await go('Purchase planning');await fits();await shot('planning');await press('o',['alt']);await type('Supplier');await press('Down');await press('Enter');assert.equal(await title(),'Purchase order');
   assert.equal(await js('document.querySelector(".lines tbody input[aria-label^=qty]").value'),'32');await press('s',['control']);assert.equal((await api('dayBook',{types:['Purchase Order']})).length,1);
   await go('Sales analysis');await fits();await shot('analysis');await press('x',['alt']);assert.match(fs.readFileSync(`${backupFile}.csv`,'utf8'),/Widget/);
   await go('Retail controls');await type('01-11-2026');await press('Tab');await press('Space');await fits();await press('s',['control']);assert.deepEqual(await api('retailControls'),{lockedThrough:'2026-11-01',blockExpiredSales:true});
   await go('Manage Records');await press('l',['control']);await type('Buyer');await press('Enter');await press('PageDown');await press('PageDown');await fits();await shot('customer-controls');await press('Escape');
   await go('Create Vouchers');await type('Buyer');await press('Enter');await type('Widget');await press('Enter');await type('1');
   assert.equal(await js('document.querySelector(".lines tbody input[aria-label^=rate]").value'),'90.00');await press('s',['control']);
   await go('Backup & restore');await press('b',['alt']);await sleep(150);assert.equal(fs.existsSync(backupFile),true);
   const oldCompany=await api('company');await api('setCompany',{name:'Change after backup'});await press('r',['alt']);await sleep(700);
   assert.equal((await api('company')).name,oldCompany.name);assert.equal(await title(),'Dashboard');assert.ok(fs.readdirSync(out).some(name=>name.startsWith('before-restore-')));
   console.log(`RETAIL SMOKE OK. Screenshots: ${out}`);app.exit(0);
 }catch(error){await shot('failure');console.error(`${error.stack}\nTitle: ${await title()}\nScreenshots: ${out}`);app.exit(1);}
});
