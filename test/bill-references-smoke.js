'use strict';
const {app,BrowserWindow}=require('electron'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const out=fs.mkdtempSync(path.join(os.tmpdir(),'desktop-erp-reference-ui-'));process.env.DESKTOP_ERP_DATA_DIR=out;require('../main');const sleep=ms=>new Promise(r=>setTimeout(r,ms));
app.whenReady().then(async()=>{await require('./wait-for-window')();const win=BrowserWindow.getAllWindows()[0],page=win.webContents;win.show();win.focus();page.focus();const js=c=>page.executeJavaScript(c),api=(m,a={})=>js(`window.books.call(${JSON.stringify(m)},${JSON.stringify(a)})`);
 async function press(keyCode,modifiers=[]){page.sendInputEvent({type:'keyDown',keyCode,modifiers});page.sendInputEvent({type:'keyUp',keyCode,modifiers});await sleep(180);}
 try{const groups=await api('groups'),p=(await api('saveLedger',{name:'Reference customer',groupId:groups.find(g=>g.name==='Sundry Debtors').id})).id,cash=(await api('ledgers')).find(l=>l.name==='Cash').id,sales=(await api('ledgers')).find(l=>l.name==='Sales').id;
 const sale=await api('saveVoucher',{type:'Sales',date:'2026-11-01',lines:[{ledgerId:p,amount:10000},{ledgerId:sales,amount:-10000}]});const receipt=await api('saveVoucher',{type:'Receipt',date:'2026-11-02',lines:[{ledgerId:cash,amount:8000},{ledgerId:p,amount:-8000}]});
 await js(`(async()=>{const {push}=await import('./router.js');const {voucherEntry}=await import('./voucher.js');await push(voucherEntry({id:${receipt.id}}));})()`);await press('b',['alt']);
 assert.equal(await js('!!document.querySelector(".bill-reference-editor")'),true);
 await js(`(()=>{const s=document.querySelector('.bill-reference-editor select');s.value='against';s.dispatchEvent(new Event('change',{bubbles:true}));})()`);
 if(await js('!!document.querySelector(".side-picker")'))await press('Escape');
 await js(`document.querySelector('.bill-reference-editor tbody button').click()`);await press('Enter');assert.equal(await js('!!document.querySelector(".bill-reference-editor")'),true);
 fs.writeFileSync(path.join(out,'references.png'),(await page.capturePage()).toPNG());await press('s',['control']);assert.equal(await js('!!document.querySelector(".bill-reference-editor")'),false);await press('s',['control']);
 assert.equal((await api('referenceOutstanding',{partyId:p,asOf:'2026-11-12'})).due,2000);
 await press('k',['control']);await page.insertText('Outstanding bills');await press('Enter');await sleep(250);await page.insertText('Reference customer');await press('Enter');assert.equal(await js('document.querySelector("#title").textContent'),'Party outstanding references');
 await press('b',['alt']);await press('Enter');await press('Enter');await press('a',['control']);await page.insertText('10.00');await press('Enter');await press('s',['control']);await press('Enter');
 assert.equal((await api('referenceOutstanding',{partyId:p,asOf:'2026-11-12'})).due,1000);
 await press('t',['alt']);await press('t',['alt']);await press('t',['alt']);assert.match(await js('document.querySelector(".report-directory tbody").textContent'),/Against/);
 await press('u',['alt']);await press('Enter');await press('Enter');
 const undone=await api('referenceOutstanding',{partyId:p,asOf:'2026-11-12'});assert.equal(undone.net,1000);assert.ok(undone.credit>0);assert.equal((await api('referenceAudit',{partyId:p})).length,1);
 fs.writeFileSync(path.join(out,'outstanding.png'),(await page.capturePage()).toPNG());
 const item=(await api('saveItem',{name:'Reference stock',unit:'pc'})).id;await api('saveInvoice',{type:'Stock In',date:'2026-11-01',items:[{itemId:item,qty:2000,rate:1000}]});const inv=await api('saveInvoice',{type:'Sales',date:'2026-11-02',partyId:p,items:[{itemId:item,qty:1000,rate:1000}]});await js(`(async()=>{const {push}=await import('./router.js');const {invoiceEntry}=await import('./invoice.js');await push(invoiceEntry({id:${inv.id}}));})()`);await press('b',['alt']);assert.equal(await js('!!document.querySelector(".bill-reference-editor")'),true);await press('Escape');
 console.log('BILL REFERENCES SMOKE OK: voucher allocation, nested picker, partial settlement, history and invoice reference dialog. '+out);app.exit(0);
 }catch(e){console.error(e.stack);fs.writeFileSync(path.join(out,'failure.png'),(await page.capturePage()).toPNG());console.error(out);app.exit(1);}
});
