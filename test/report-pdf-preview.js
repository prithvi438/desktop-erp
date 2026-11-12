'use strict';
const {app,BrowserWindow}=require('electron'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
app.setPath('userData',fs.mkdtempSync(path.join(os.tmpdir(),'speedoone-pdf-preview-')));
app.whenReady().then(async()=>{
 try{
  const pdf=process.argv[2],win=new BrowserWindow({show:false,width:1100,height:1100,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});
  await win.loadFile(pdf);await new Promise(resolve=>setTimeout(resolve,1800));
  fs.writeFileSync(path.join(path.dirname(pdf),'pdf-preview.png'),(await win.webContents.capturePage()).toPNG());
  console.log('PDF preview captured');win.destroy();app.exit(0);
 }catch(e){console.error(e);app.exit(1);}
});
