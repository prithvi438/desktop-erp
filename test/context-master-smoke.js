'use strict';
const {app,BrowserWindow}=require('electron'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
process.env.SPEEDOONE_DATA_DIR=fs.mkdtempSync(path.join(os.tmpdir(),'speedoone-context-master-'));require('../main');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
app.whenReady().then(async()=>{await require('./wait-for-window')();const win=BrowserWindow.getAllWindows()[0],page=win.webContents;win.show();win.focus();page.focus();
 const js=code=>page.executeJavaScript(code),title=()=>js('document.querySelector("#title").textContent');
 const api=(method,args={})=>js(`window.books.call(${JSON.stringify(method)},${JSON.stringify(args)})`);
 async function press(keyCode,modifiers=[]){page.sendInputEvent({type:'keyDown',keyCode,modifiers});page.sendInputEvent({type:'keyUp',keyCode,modifiers});await sleep(220);}
 async function text(value){await page.insertText(value);}
 async function field(label){await js(`(()=>{const input=[...document.querySelectorAll('label')].find(el=>el.querySelector('span')?.textContent===${JSON.stringify(label)}).querySelector('input,select');input.focus();})()`);}
 try{
  await js(`(async()=>{await (await import('./router.js')).push((await import('./invoice.js')).invoiceEntry({type:'Sales'}));})()`);
  await press('c',['alt']);assert.equal(await title(),'Create ledger');await text('Context customer');await press('s',['control']);
  assert.equal(await title(),'Sales invoice');assert.equal(await js('document.activeElement.value'),'Context customer');
  await press('Enter',['control']);assert.equal(await title(),'Alter ledger');await press('a',['control']);await text('Renamed customer');await press('s',['control']);assert.equal(await js('document.activeElement.value'),'Renamed customer');
  await press('Enter');await press('c',['alt']);assert.equal(await title(),'Create item');await text('Context item');
  await field('Category');await press('c',['alt']);assert.equal(await title(),'Create item category');await text('Context category');await press('s',['control']);assert.equal(await js('document.activeElement.value'),'Context category');
  await press('Enter',['control']);assert.equal(await title(),'Alter item category');await press('a',['control']);await text('Renamed category');await press('s',['control']);assert.equal(await js('document.activeElement.value'),'Renamed category');
  await press('s',['control']);assert.equal(await title(),'Sales invoice');assert.equal(await js('document.activeElement.value'),'Context item');
  await js(`document.querySelector('[aria-label="qty for item 1"]').value='2';document.querySelector('[aria-label="rate for item 1"]').value='123';`);
  await press('Enter',['control']);assert.equal(await title(),'Alter item');await press('a',['control']);await text('Renamed item');await press('s',['control']);assert.equal(await js('document.activeElement.value'),'Renamed item');
  assert.deepEqual(await js(`[document.querySelector('[aria-label="qty for item 1"]').value,document.querySelector('[aria-label="rate for item 1"]').value]`),['2','123']);
  await press('c',['alt']);assert.equal(await title(),'Create item');await press('Escape');assert.equal(await title(),'Sales invoice');assert.equal(await js('document.activeElement.value'),'Renamed item');
  await press('l',['alt']);await press('c',['alt']);assert.equal(await title(),'Create ledger');await text('Context charge');await press('s',['control']);assert.equal(await js('document.activeElement.value'),'Context charge');
  await press('Enter',['control']);assert.equal(await title(),'Alter ledger');await press('Escape');assert.equal(await title(),'Sales invoice');
  assert.equal((await api('items')).find(row=>row.name==='Renamed item').category,'Renamed category');
  await js(`(async()=>{await (await import('./router.js')).push((await import('./voucher.js')).voucherEntry({type:'Payment'}));})()`);
  await js('document.querySelector("[aria-label=\\"Cash or bank account\\"]").focus()');
  await press('c',['alt']);assert.equal(await title(),'Create ledger');await text('Context bank');await press('s',['control']);assert.equal(await js('document.activeElement.value'),'Context bank');
  await press('Enter',['control']);assert.equal(await title(),'Alter ledger');await press('Escape');await press('Enter');
  await text('Renamed customer');await press('Enter');
  await js('document.querySelector("[aria-label=\\"Allocation ledger\\"]").focus()');
  await press('Enter',['control']);assert.equal(await title(),'Alter ledger');await press('Escape');
  console.log('CONTEXT MASTER SMOKE OK: focused create/edit, nested category, autofill, cancellation and draft quantity/rate retained');app.exit(0);
 }catch(e){console.error(e.stack,await title());app.exit(1);}
});
