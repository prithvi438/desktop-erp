'use strict';
const {app,BrowserWindow}=require('electron'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const out=fs.mkdtempSync(path.join(os.tmpdir(),'desktop-erp-company-ui-'));process.env.DESKTOP_ERP_DATA_DIR=out;require('../main');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
app.whenReady().then(async()=>{await require('./wait-for-window')();const win=BrowserWindow.getAllWindows()[0],page=win.webContents;win.show();win.focus();page.focus();
 const js=code=>page.executeJavaScript(code),api=(m,a={})=>js(`window.books.call(${JSON.stringify(m)},${JSON.stringify(a)})`);
 async function press(keyCode,modifiers=[]){page.sendInputEvent({type:'keyDown',keyCode,modifiers});page.sendInputEvent({type:'keyUp',keyCode,modifiers});await sleep(180);}
 async function ready(){for(let i=0;i<70;i++){await sleep(100);try{if(await js('!!document.querySelector("#nav button")'))return;}catch{}}throw Error('Renderer did not reload');}
 async function reload(){page.reload();await new Promise(r=>page.once('did-finish-load',r));await ready();}
 async function screen(name){await press('k',['control']);await page.insertText(name);await press('Enter');}
 try{
  const original=(await api('companyList')).active;
  await api('saveItem',{name:'Original-only item',unit:'pc'});
  await press('F3');await sleep(200);
  assert.equal(await js('document.querySelector("#title").textContent'),'Companies & financial years');
  await press('c',['alt']);await page.insertText('Second UI company');await press('Enter');await ready();await sleep(400);
  assert.equal((await api('company')).name,'Second UI company');assert.equal((await api('items')).length,0);
  const created=await api('createFinancialYear',{name:'2020–2021',from:'2020-04-01',to:'2021-03-31'});await api('selectFinancialYear',created);await reload();
  assert.match(await js('document.querySelector("#company").textContent'),/2020/);
  const cash=(await api('ledgers')).find(l=>l.name==='Cash').id,sales=(await api('ledgers')).find(l=>l.name==='Sales').id;
  await assert.rejects(api('saveVoucher',{type:'Receipt',date:'2026-05-01',lines:[{ledgerId:cash,amount:10000},{ledgerId:sales,amount:-10000}]}),/selected financial year/);
  await api('saveVoucher',{type:'Receipt',date:'2020-05-01',lines:[{ledgerId:cash,amount:10000},{ledgerId:sales,amount:-10000}]});
  await screen('Profit & loss');await press('F2',['alt']);assert.equal(await js('document.activeElement.getAttribute("aria-label")'),'Reporting from date');await press('a',['control']);await page.insertText('01-05-2020');await press('Enter');await press('a',['control']);await page.insertText('31-05-2020');await press('Enter');assert.match(await js('document.querySelector(".financial-heading").textContent'),/01-05-2020 to 31-05-2020/);
  await api('setReportingPeriod',{from:'2020-05-01',to:'2020-05-31'});await reload();
  await screen('Sales register');await press('F2',['alt']);assert.match(await js('document.activeElement.getAttribute("aria-label")'),/from date/i);assert.equal(await js('document.activeElement.value'),'01-05-2020');
  await screen('Balance sheet');await press('F2');assert.equal(await js('document.activeElement.getAttribute("aria-label")'),'Reporting date');
  await api('selectCompany',{id:original});await reload();assert.equal((await api('items'))[0].name,'Original-only item');assert.notEqual((await api('financialYearState')).selected,created.id);
  console.log('COMPANY WORKSPACE SMOKE OK: create/switch, isolation, fiscal persistence, voucher guard, P&L period and F2/Alt+F2. '+out);app.exit(0);
 }catch(e){console.error(e.stack);fs.writeFileSync(path.join(out,'failure.png'),(await page.capturePage()).toPNG());console.error(out);app.exit(1);}
});
