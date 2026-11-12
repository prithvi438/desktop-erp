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
 await press('k',['control']);await page.insertText('Reports');await press('Enter');
 assert.equal(await title(),'Reports');
 assert.equal(await js('!!document.querySelector(".reports-workspace .register-rail")'),true);
 assert.equal(await js('!!document.querySelector(".report-category-grid")'),false);
 assert.equal(await js('document.activeElement.textContent.includes("Financial statements")'),true);
 assert.equal(await js('document.querySelector(".reports-workspace").dataset.focusArea'),'headings');
 const first=await js('document.querySelector(".report-head-content h2").textContent');
 await press('Down');assert.notEqual(await js('document.querySelector(".report-head-content h2").textContent'),first);
 await press('Up');await press('Enter');assert.equal(await js('document.querySelector(".reports-workspace").dataset.focusArea'),'reports');await page.insertText('Trial');
 assert.equal(await js('document.querySelectorAll(".report-list-host tbody tr").length'),1);
 await press('Enter');assert.match(await title(),/Trial balance/i);
 await press('Escape');assert.equal(await title(),'Reports');
 assert.equal(await js('document.querySelector(".report-list-host input").value'),'Trial');
 await press('Escape');assert.equal(await js('!!document.activeElement.closest(".register-rail")'),true);assert.equal(await js('document.querySelector(".reports-workspace").dataset.focusArea'),'headings');
 await press('Tab');await press('Enter');await press('Escape');await press('Up');await press('Enter');assert.equal(await js('document.querySelector(".report-list-host input").value'),'Trial');
 for(const [w,h] of [[1100,640],[1384,850]]){win.setSize(w,h);await sleep(150);assert.equal(await js('document.querySelector(".reports-workspace").scrollWidth<=document.querySelector(".reports-workspace").clientWidth+2'),true);}
 fs.writeFileSync(path.join(out,'report-heads.png'),(await page.capturePage()).toPNG());
 await press('Escape');await press('Escape');assert.equal(await title(),'Dashboard');
 console.log('REPORT HEADS SMOKE OK: heading navigation, filtered reports, open/return, Escape levels and layout. '+out);app.exit(0);
 }catch(error){console.error(error.stack);app.exit(1);}
});