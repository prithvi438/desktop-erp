'use strict';
const {app,BrowserWindow}=require('electron');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {openBooks}=require('../src/books');
const out=fs.mkdtempSync(path.join(os.tmpdir(),'speedoone-manage-'));
process.env.SPEEDOONE_DATA_DIR=out;
const seed=openBooks(path.join(out,'books.db')),a=seed.api;
const group=name=>a.groups().find(row=>row.name===name).id;
const buyer=a.saveLedger({name:'Buyer',groupId:group('Sundry Debtors')}).id;
const supplier=a.saveLedger({name:'Supplier',groupId:group('Sundry Creditors')}).id;
const unused=a.saveLedger({name:'Unused ledger',groupId:group('Indirect Expenses')}).id;
for(let i=0;i<30;i++)a.saveLedger({name:`Customer ${String(i).padStart(2,'0')}`,groupId:group('Sundry Debtors')});
const item=a.saveItem({name:'Stock item',unit:'PCS',saleRate:10000}).id;
const spare=a.saveItem({name:'Unused item',unit:'PCS'}).id;
const custom=a.saveGroup({name:'Custom group',parentId:group('Sundry Debtors')}).id;
const pricebook=a.savePricebook({name:'Retail'}).id;
const purchase=a.saveInvoice({type:'Purchase',date:'2026-11-01',partyId:supplier,items:[{itemId:item,qty:10000,rate:8000}]}).id;
const sale=a.saveInvoice({type:'Sales',date:'2026-11-02',partyId:buyer,items:[{itemId:item,qty:1000,rate:10000}]}).id;
const quote=a.saveInvoice({type:'Quotation',date:'2026-11-03',partyId:buyer,items:[{itemId:item,qty:1000,rate:10000}]}).id;
const cash=a.ledgers().find(row=>row.name==='Cash').id;
const payment=a.saveVoucher({type:'Payment',date:'2026-11-04',narration:'Supplier payment',lines:[{ledgerId:supplier,amount:1000},{ledgerId:cash,amount:-1000}]}).id;
for(let i=0;i<25;i++)a.saveVoucher({type:'Journal',date:'2026-11-01',narration:`Opening adjustment ${i}`,lines:[{ledgerId:buyer,amount:100},{ledgerId:cash,amount:-100}]});
seed.close();require('../main');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
app.whenReady().then(async()=>{
  await require('./wait-for-window')();const win=BrowserWindow.getAllWindows()[0],page=win.webContents;
  win.setSize(1100,720);page.setBackgroundThrottling(false);win.show();win.focus();page.focus();
  const js=code=>page.executeJavaScript(code);
  const api=(name,args={})=>js(`window.books.call(${JSON.stringify(name)},${JSON.stringify(args)})`);
  const title=()=>js('document.querySelector("#title").textContent');
  const selected=()=>js('document.querySelector(".manage-results tr.on")?.textContent');
  async function press(keyCode,modifiers=[]){page.sendInputEvent({type:'keyDown',keyCode,modifiers});page.sendInputEvent({type:'keyUp',keyCode,modifiers});await sleep(140);}
  async function type(text){await page.insertText(text);await sleep(70);}
  async function search(text){await press('l',['control']);await type(text);}
  async function replace(text){await press('a',['control']);await type(text);}
  async function shot(name){await sleep(150);fs.writeFileSync(path.join(out,`${name}.png`),(await page.capturePage()).toPNG());}
  async function fits(){
    for(const height of [640,720,900]){
      win.setSize(1100,height);await sleep(160);
      const overflow=await js(`[...document.querySelectorAll('#nav,.manage-workspace,.manage-body,.manage-rail,.manage-results')].filter(el=>el.getClientRects().length&&(el.scrollHeight>el.clientHeight+2||el.scrollWidth>el.clientWidth+2)).map(el=>({class:el.className,height:[el.clientHeight,el.scrollHeight],width:[el.clientWidth,el.scrollWidth]}))`);
      assert.deepEqual(overflow,[],'Management content must fit without scrolling or clipping');
      assert.equal(await js('document.querySelector(".manage-workspace").getBoundingClientRect().right<=innerWidth'),true);
    }
    win.setSize(1100,720);await sleep(150);
  }
  async function remove(confirm='y'){await press('d',['alt']);assert.equal(await js('!!document.querySelector(".dialog")'),true);await press(confirm);}
  try{
    for(let i=0;i<70;i++)await api('saveGroup',{name:`Extra group ${String(i).padStart(2,'0')}`,parentId:(await api('groups')).find(row=>row.name==='Sundry Debtors').id});
    await press('k',['control']);await type('Masters');await press('Enter');await press('c',['alt']);
    await type('Right panel ledger');await press('Enter');
    assert.equal(await js('document.querySelector(".choice-panel").hidden'),false);
    assert.equal(await js('document.querySelector(".choice-panel h2").textContent'),'Under group');
    assert.ok(await js('document.querySelectorAll(".choice-panel li").length>70'));
    await press('Down');const before=await js('document.querySelector(".choice-panel li.on").textContent');
    await press('PageDown');assert.notEqual(await js('document.querySelector(".choice-panel li.on").textContent'),before);
    await press('PageUp');assert.equal(await js('document.querySelector(".choice-panel li.on").textContent'),before);
    for(const [width,height] of [[1100,640],[1400,860]]){
      win.setSize(width,height);await sleep(200);
      assert.equal(await js('document.querySelector("#main").getBoundingClientRect().right<=document.querySelector(".choice-panel").getBoundingClientRect().left'),true);
      assert.equal(await js('document.querySelector(".choice-panel").scrollHeight<=document.querySelector(".choice-panel").clientHeight+2'),true);
      await shot(`choices-${width}`);
    }
    await type('Extra group 69');assert.equal(await js('document.querySelectorAll(".choice-panel li").length'),1);await press('Enter');
    assert.equal(await js('document.querySelector(".choice-panel").hidden'),true);
    await press('s',['control']);assert.equal((await api('ledgers')).find(row=>row.name==='Right panel ledger').groupName,'Extra group 69');
    await press('F2');await press('c',['alt']);await type('Panel subgroup');await press('Enter');await type('No such group');
    assert.equal(await js('document.querySelector(".choice-panel ul").dataset.page'),'No matching options');
    await replace('Extra group 69');await press('Enter');await press('s',['control']);assert.equal(await title(),'Masters');
    await press('F1');await press('l',['control']);await press('Tab');
    assert.equal(await js('document.activeElement.tagName'),'SELECT');assert.equal(await js('document.querySelector(".choice-panel").hidden'),false);
    await press('Down');assert.equal(await js('document.querySelector(".manage-filters select").value'),'Sundry Debtors');
    await press('Enter');assert.equal(await js('document.querySelector(".choice-panel").hidden'),true);
    await press('Up');await press('Escape');assert.equal(await title(),'Masters');
    await press('h',['control']);assert.equal(await js('document.querySelector(".choice-panel").hidden'),true);
    console.log(`CHOICES SMOKE OK. Screenshots: ${out}`);app.exit(0);
  }catch(error){await shot('failure');console.error(`${error.stack}\nTitle: ${await title()}\nScreenshots: ${out}`);app.exit(1);}
});