'use strict';
const {app,BrowserWindow}=require('electron');
const {spawn}=require('node:child_process');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const out=fs.mkdtempSync(path.join(os.tmpdir(),'desktop-erp-startup-'));
process.env.DESKTOP_ERP_DATA_DIR=out;
require('../main');
app.whenReady().then(async()=>{
  await require('./wait-for-window')();
  try{
    const win=BrowserWindow.getAllWindows()[0];let second=false;
    app.once('second-instance',()=>{second=true;});
    win.hide();
    const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;delete env.DESKTOP_ERP_PG_URL;
    const output=await new Promise((resolve,reject)=>{
      const child=spawn(process.execPath,['.'],{cwd:path.join(__dirname,'..'),env,windowsHide:true});
      let log='';child.stdout.on('data',data=>{log+=data;});child.stderr.on('data',data=>{log+=data;});
      const timer=setTimeout(()=>{child.kill();reject(Error('Second launch did not exit'));},15000);
      child.on('error',reject);child.on('exit',code=>{clearTimeout(timer);resolve({code,log});});
    });
    assert.equal(output.code,0,output.log);assert.equal(second,true);
    assert.equal(win.isVisible(),true);assert.equal(BrowserWindow.getAllWindows().length,1);
    assert.doesNotMatch(output.log,/Database startup failed|Unable to move the cache|deprecated/);
    const result=await win.webContents.executeJavaScript('window.books.call("groups").then(rows=>rows.length)');
    assert.equal(result,28);
    console.log('STARTUP SMOKE OK: duplicate launch exits cleanly, restores the existing window and leaves PostgreSQL usable.');
    app.exit(0);
  }catch(error){console.error(error.stack);app.exit(1);}
});
