'use strict';
const {app,BrowserWindow}=require('electron'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const out=fs.mkdtempSync(path.join(os.tmpdir(),'speedoone-user-profile-'));process.env.SPEEDOONE_DATA_DIR=out;require('../main');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
app.whenReady().then(async()=>{
 await require('./wait-for-window')();const win=BrowserWindow.getAllWindows()[0],page=win.webContents;win.show();win.focus();page.focus();
 const js=code=>page.executeJavaScript(code),api=(method,args={})=>js(`window.books.call(${JSON.stringify(method)},${JSON.stringify(args)})`);
 async function press(keyCode,modifiers=[]){page.sendInputEvent({type:'keyDown',keyCode,modifiers});page.sendInputEvent({type:'keyUp',keyCode,modifiers});await sleep(170);}
 const title=()=>js('document.querySelector("#title").textContent');

 try{
 const cash=(await api('ledgers')).find(l=>l.name==='Cash').id;
 const party=(await api('saveLedger',{name:'Drill Customer',groupId:(await api('groups')).find(g=>g.name==='Sundry Debtors').id})).id;
 await api('saveVoucher',{type:'Journal',date:'2026-11-01',lines:[{ledgerId:cash,amount:-10000},{ledgerId:party,amount:10000}]});
 await js("Promise.all([import('./router.js'),import('./financial-reports.js')]).then(([r,f])=>r.push(f.financialStatement('balanceSheet')))");
 async function enterRow(name){await js(`[...document.querySelectorAll('.financial-statement tbody tr')].find(r=>r.cells[0].textContent.trim().replace(/^[\\u25b8\\u25be] /,'')===${JSON.stringify(name)}).click()`);await press('Enter');}
 assert.equal(await js("document.querySelector('.financial-statement').textContent.includes('Drill Customer')"),false);
 await enterRow('ASSETS');await enterRow('Current assets');await enterRow('Trade receivables');
 assert.equal(await js("document.querySelector('.financial-statement').textContent.includes('Drill Customer')"),true);
 await enterRow('Drill Customer');assert.equal(await title(),'Ledger account');
 await press('Escape');assert.match(await js("document.querySelector('.financial-statement tr.on').textContent"),/Drill Customer/);
 await enterRow('Trade receivables');assert.equal(await js("document.querySelector('.financial-statement').textContent.includes('Drill Customer')"),false);
 console.log('BALANCE SHEET DRILL SMOKE OK: heads, subheads, ledger entries, collapse and restored selection');app.exit(0);
 }catch(error){console.error(error.stack);app.exit(1);}
});
