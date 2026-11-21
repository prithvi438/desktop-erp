'use strict';
const {app,BrowserWindow}=require('electron'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const out=fs.mkdtempSync(path.join(os.tmpdir(),'desktop-erp-user-profile-'));process.env.DESKTOP_ERP_DATA_DIR=out;require('../main');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
app.whenReady().then(async()=>{
 await require('./wait-for-window')();const win=BrowserWindow.getAllWindows()[0],page=win.webContents;win.show();win.focus();page.focus();
 const js=code=>page.executeJavaScript(code),api=(method,args={})=>js(`window.books.call(${JSON.stringify(method)},${JSON.stringify(args)})`);
 async function press(keyCode,modifiers=[]){page.sendInputEvent({type:'keyDown',keyCode,modifiers});page.sendInputEvent({type:'keyUp',keyCode,modifiers});await sleep(170);}
 const title=()=>js('document.querySelector("#title").textContent');

 try{
 assert.equal(await js('document.title'),'Desktop ERP');assert.equal(await js('typeof window.sync'),'undefined');
 assert.equal(await js('/speedo.?one/i.test(document.body.textContent)'),false);
 await press('k',['control']);await page.insertText('Settings');await press('Enter');
 assert.equal(await js('/sync/i.test(document.querySelector("#main").textContent)'),false);
 const legacyRoot=fs.mkdtempSync(path.join(os.tmpdir(),'erp-profile-check-'));const compat=require('../src/legacy-compat');
 assert.equal(compat.profileDirectory(legacyRoot),path.join(legacyRoot,'desktop-erp'));
 const old=path.join(legacyRoot,'speedoone-pos');fs.mkdirSync(old);fs.writeFileSync(path.join(old,'marker'),'preserved');assert.equal(compat.profileDirectory(legacyRoot),old);assert.equal(fs.readFileSync(path.join(old,'marker'),'utf8'),'preserved');
 assert.equal(fs.existsSync(path.join(__dirname,'../build/icon.png')),false);
 console.log('REBRAND SMOKE OK: neutral title, no sync screen/API, existing profile preserved, branded icon removed');app.exit(0);
 }catch(error){console.error(error.stack);app.exit(1);}
});