'use strict';
const {app,BrowserWindow}=require('electron'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
process.env.DESKTOP_ERP_DATA_DIR=fs.mkdtempSync(path.join(os.tmpdir(),'desktop-erp-confirm-'));require('../main');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
app.whenReady().then(async()=>{
 await require('./wait-for-window')();const win=BrowserWindow.getAllWindows()[0],page=win.webContents;win.show();win.focus();page.focus();
 const js=code=>page.executeJavaScript(code);
 async function press(keyCode){page.sendInputEvent({type:'keyDown',keyCode});page.sendInputEvent({type:'keyUp',keyCode});await sleep(100);}
 async function open(){await js(`(async()=>{window.confirmResult=null;const {confirmBox}=await import('./ui.js');confirmBox('Confirm this test action?').then(value=>window.confirmResult=value);})()`);}
 try{
  await js(`const input=document.createElement('input');input.id='confirm-focus-test';document.body.append(input);input.focus();`);
  await open();assert.equal(await js('document.activeElement.textContent'),'YYes');await press('Right');assert.equal(await js('document.activeElement.textContent'),'NNo');await press('Enter');assert.equal(await js('window.confirmResult'),false);assert.equal(await js('document.activeElement.id'),'confirm-focus-test');
  await open();await press('Right');await press('Left');await press('Enter');assert.equal(await js('window.confirmResult'),true);
  await open();await press('Tab');await press('Enter');assert.equal(await js('window.confirmResult'),false);
  for(const [key,result] of [['y',true],['n',false],['Escape',false],['Enter',true]]){await open();await press(key);assert.equal(await js('window.confirmResult'),result);assert.equal(await js('!!document.querySelector(".overlay")'),false);}
  console.log('CONFIRM SMOKE OK');app.exit(0);
 }catch(error){console.error(error.stack);app.exit(1);}
});
