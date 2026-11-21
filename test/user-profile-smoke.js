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
  assert.equal(await js("document.body.textContent.includes('Offline books')||document.body.textContent.includes('Local PostgreSQL books')||document.body.textContent.includes('Your business, at a glance')||document.body.textContent.includes('Work locally. Connect')"),false);
  await press('k',['control']);await page.insertText('User profile');await press('Enter');assert.equal(await title(),'User profile');
  await page.insertText('Alex');await press('Enter');await page.insertText('15081995');assert.equal(await js('document.activeElement.value'),'15-08-1995');await press('s',['control']);
  assert.equal((await api('userProfile')).name,'Alex');assert.equal((await api('userProfile')).dateOfBirth,'1995-08-15');
  await press('h',['control']);assert.match(await js("document.querySelector('.dashboard-greeting').textContent"),/Good (morning|afternoon|evening), Alex/);
  assert.deepEqual(await js("import('./user-profile.js').then(m=>[8,14,19].map(h=>m.greetingText('Alex',new Date(2026,10,12,h))))"),['Good morning, Alex','Good afternoon, Alex','Good evening, Alex']);
  await assert.rejects(api('saveUserProfile',{name:'Alex',dateOfBirth:'2099-01-01'}),/date of birth/);
  await js('location.reload()');await sleep(1000);assert.match(await js("document.querySelector('.dashboard-greeting').textContent"),/Alex/);
  fs.writeFileSync(path.join(out,'greeting.png'),(await page.capturePage()).toPNG());
  console.log('USER PROFILE SMOKE OK: keyboard create, formatted DOB, validation, persistence, time-based greeting and removed labels. '+out);app.exit(0);
 }catch(error){console.error(error.stack);fs.writeFileSync(path.join(out,'failure.png'),(await page.capturePage()).toPNG());console.error(out);app.exit(1);}
});
