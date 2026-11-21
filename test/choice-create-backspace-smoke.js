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
 assert.equal(await js('!!document.querySelector("#nav .nav-home")'),false);
 await js(`(async()=>{const {h,suggest}=await import('./ui.js');const main=document.querySelector('#main');main.replaceChildren();const a=h('input',{value:'Keep me'}),b=h('input'),c=h('select',{},h('option',{value:'a'},'Alpha'));main.append(a,b,c);window.created=0;suggest(b,{items:()=>[{id:1,label:'Existing'}],onCreate:done=>{window.created++;done({id:2,label:'New item'});}});window.testFields={a,b,c};b.focus();})()`);
 assert.match(await js('document.querySelector(".choice-panel li:first-child").textContent'),/Create new/);
 await press('Down');await press('Enter');
 assert.equal(await js('window.created'),1);assert.equal(await js('window.testFields.b.value'),'New item');
 await press('Backspace');assert.equal(await js('document.activeElement===window.testFields.b'),true);
 await js('window.testFields.b.value=""');await press('Backspace');assert.equal(await js('document.activeElement===window.testFields.a'),true);
 await js('window.testFields.c.focus()');assert.equal(await js('!!document.querySelector(".choice-panel li[data-create]")'),false);
 await js(`(async()=>{const {bindInlineMaster}=await import('./inline-master.js');bindInlineMaster(window.testFields.c,()=>window.created++);window.testFields.a.focus();window.testFields.c.focus();})()`);
 await press('Up');await press('Enter');assert.equal(await js('window.created'),2);assert.equal(await js('window.testFields.c.value'),'a');
 console.log('CHOICE CREATE / BACKSPACE SMOKE OK');app.exit(0);
 }catch(error){console.error(error.stack);app.exit(1);}
});
