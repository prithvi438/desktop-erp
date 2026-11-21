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
 assert.equal(await js('document.querySelector("#hints").textContent'),'');
 await press('c',['control','shift']);assert.equal(await js('!!document.querySelector(".floating-calculator")'),false);
 await press('k',['control']);await page.insertText('Forms & feature settings');await press('Enter');
 await press('y');await press('s',['control']);assert.equal((await api('settings')).useCalculator,true);await press('Escape');await press('h',['control']);
 assert.equal(await js('document.querySelector("#hints").textContent'),'Ctrl+Shift+CCalculator');
 await js("window.promptResult=import('./ui.js').then(u=>u.ask('Keep this draft','Draft text'));void 0");await sleep(100);
 await press('c',['control','shift']);assert.equal(await js('!!document.querySelector(".floating-calculator")'),true);
 await page.insertText('(1250+350)*18%');await press('Enter');assert.equal(await js('document.querySelector(".calculator-result").textContent'),'288');
 const left=await js('document.querySelector(".floating-calculator").getBoundingClientRect().left');await press('Left',['alt']);assert.equal(await js('document.querySelector(".floating-calculator").getBoundingClientRect().left'),left-20);
 await js("(()=>{const buttons=[...document.querySelectorAll('.calculator-keys button')];const click=s=>buttons.find(b=>b.textContent===s).click();click('C');click('6');click(String.fromCharCode(215));click('7');click('=');})()");assert.equal(await js('document.querySelector(".calculator-result").textContent'),'42');
 await press('a',['control']);await page.insertText('1/0');await press('Enter');assert.match(await js('document.querySelector(".calculator-result").textContent'),/zero/);
 const r=await js('(()=>{const r=document.querySelector(".calculator-drag").getBoundingClientRect();return {x:Math.round(r.left+30),y:Math.round(r.top+12)};})()');
 page.sendInputEvent({type:'mouseDown',x:r.x,y:r.y,button:'left',clickCount:1});page.sendInputEvent({type:'mouseMove',x:r.x-60,y:r.y+25,button:'left'});page.sendInputEvent({type:'mouseUp',x:r.x-60,y:r.y+25,button:'left',clickCount:1});await sleep(100);
 assert.equal(await js('document.querySelector(".floating-calculator").getBoundingClientRect().left'),left-80);
 fs.writeFileSync(path.join(out,'calculator.png'),(await page.capturePage()).toPNG());
 await press('Escape');assert.equal(await js('document.activeElement.value'),'Draft text');await press('Escape');
 const result=await js("import('./calculator-math.mjs').then(m=>['2+3*4','(2+3)*4','2^3^2','-2^2','sqrt(81)','0.1+0.2','1000*18%'].map(m.calculate))");assert.deepEqual(result,['14','20','512','-4','9','0.3','180']);
 await api('saveSettings',{useCalculator:false});await press('c',['control','shift']);assert.equal(await js('!!document.querySelector(".floating-calculator")'),false);
 console.log('CALCULATOR SMOKE OK: setting gate, modal shortcut, arithmetic, drag, keyboard move, errors and draft focus restored. '+out);app.exit(0);
 }catch(error){console.error(error.stack);app.exit(1);}
});