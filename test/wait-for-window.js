'use strict';
const {app,BrowserWindow}=require('electron');
const exit=app.exit.bind(app);
app.exit=code=>require('../main').shutdown().then(()=>exit(code),error=>{console.error(error.message);exit(1);});
module.exports=async()=>{
  const until=Date.now()+60000;
  while(Date.now()<until){
    const window=BrowserWindow.getAllWindows()[0];
    if(window&&!window.webContents.isLoading()&&window.webContents.getURL()){
      await new Promise(resolve=>setTimeout(resolve,500));return;
    }
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  throw Error('Desktop startup did not complete within 60 seconds');
};
