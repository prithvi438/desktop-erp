'use strict';
const {app,BrowserWindow}=require('electron'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
process.env.DESKTOP_ERP_DATA_DIR=fs.mkdtempSync(path.join(os.tmpdir(),'desktop-erp-inline-'));
require('../main');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
app.whenReady().then(async()=>{
  await require('./wait-for-window')();const win=BrowserWindow.getAllWindows()[0],page=win.webContents;
  win.show();win.focus();page.focus();
  const js=code=>page.executeJavaScript(code),api=(method,args={})=>js(`window.books.call(${JSON.stringify(method)},${JSON.stringify(args)})`);
  async function press(keyCode,modifiers=[]){page.sendInputEvent({type:'keyDown',keyCode,modifiers});page.sendInputEvent({type:'keyUp',keyCode,modifiers});await sleep(220);}
  async function type(text){await page.insertText(text);await sleep(80);}
  const title=()=>js('document.querySelector("#title").textContent');
  async function field(label){await js(`(()=>{const input=[...document.querySelectorAll('label')].find(el=>el.querySelector('span')?.textContent===${JSON.stringify(label)}).querySelector('input,select');for(let parent=input.parentElement;parent;parent=parent.parentElement)parent.revealEntry?.(input);input.focus();})()`);}
  try{
    await press('k',['control']);await type('Masters');await press('Enter');await press('F3');await press('c',['alt']);await type('Retained item draft');
    await field('Item group');await press('c',['alt']);assert.equal(await title(),'Create item group');await type('Inline group');await press('s',['control']);
    assert.equal(await title(),'Create item');assert.equal(await js('document.activeElement.value'),'Inline group');
    await field('HSN code');await press('c',['alt']);assert.equal(await title(),'HSN / SAC');await type('1234');await press('Tab');await press('c',['alt']);assert.equal(await title(),'GST slabs');
    await type('Inline tax');await press('Tab');await type('12');await press('s',['control']);assert.equal(await title(),'HSN / SAC');assert.equal(await js('document.activeElement.value'),'Inline tax');
    await press('s',['control']);assert.equal(await title(),'Create item');assert.equal(await js('document.activeElement.value'),'1234');
    await field('Category');await press('c',['alt']);await press('Escape');assert.equal(await title(),'Create item');
    await field('Pricebook (optional)');await press('c',['alt']);assert.equal(await title(),'Create pricebook');await type('Inline retail');await press('s',['control']);assert.equal(await title(),'Create item');assert.equal(await js('document.activeElement.value'),'Inline retail');
    await field('Price in this book');await press('a',['control']);await type('125');
    await press('s',['control']);const item=(await api('items')).find(r=>r.name==='Retained item draft');assert.ok(item);assert.equal(item.itemGroup,'Inline group');assert.equal(item.hsn,'1234');assert.equal(item.gstRate,1200);
    const book=(await api('pricebooks')).find(r=>r.name==='Inline retail');assert.equal((await api('pricebookEntries',{bookId:book.id}))[0].price,12500);
    await press('F1');await press('c',['alt']);await type('Nested ledger');await press('Enter');await press('c',['alt']);assert.equal(await title(),'Create group');await type('Nested account group');await press('Tab');await type('Sundry Debtors');await press('Enter');await press('s',['control']);assert.equal(await title(),'Create ledger');
    await press('s',['control']);assert.equal((await api('ledgers')).find(r=>r.name==='Nested ledger').groupName,'Nested account group');
    console.log('INLINE MASTER SMOKE OK');app.exit(0);
  }catch(error){console.error(error.stack,await title());app.exit(1);}
});
