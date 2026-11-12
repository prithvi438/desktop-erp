'use strict';
const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'speedoone-browse-'));
process.env.SPEEDOONE_DATA_DIR = out;
require('../main');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
app.whenReady().then(async () => {
  await require('./wait-for-window')();
  const win = BrowserWindow.getAllWindows()[0], page = win.webContents;
  page.setBackgroundThrottling(false); win.show(); win.focus(); page.focus();
  const js = code => page.executeJavaScript(code);
  const title = () => js('document.querySelector("#title").textContent');
  async function press(keyCode, modifiers = []) {
    page.sendInputEvent({ type:'keyDown',keyCode,modifiers });
    page.sendInputEvent({ type:'keyUp',keyCode,modifiers });
    await sleep(180);
  }
  async function go(name) { await press('k',['control']); await page.insertText(name); await press('Enter'); await sleep(200); }
  async function find(name) { await press('l',['control']); await page.insertText(name); await press('Down'); await press('Enter'); }
  async function shot(name) { await sleep(200); fs.writeFileSync(path.join(out,`${name}.png`),(await page.capturePage()).toPNG()); }
  try {
    assert.deepEqual(await js('[...document.querySelectorAll("#nav .item strong")].map(x=>x.textContent)'),['Masters','Create Vouchers','Daybook','Registers','Reports','Settings']);
    await go('Registers'); assert.equal(await title(),'Registers');
    await shot('registers');
    await js(`[...document.querySelectorAll('.register-rail button')].find(b=>b.textContent==='Sales register').click()`);await sleep(200);
    await press('c',['alt']); assert.equal(await title(),'Sales invoice');
    if(await js('!!document.querySelector(".choice-panel:not([hidden])")'))await press('Escape');
    await press('Escape'); assert.equal(await title(),'Registers');
    await press('Escape'); assert.equal(await title(),'Registers');
    assert.equal(await js('!!document.activeElement.closest(".register-rail")'),true);
    await press('Escape'); assert.equal(await title(),'Dashboard');
    await go('Reports'); assert.equal(await title(),'Reports');
    await shot('reports');
    await find('Trial balance'); assert.match(await title(),/^Trial balance/);
    await shot('trial-balance');
    await press('F2');
    assert.equal(await js('!!document.querySelector(".dialog")'),true);await press('Escape');await press('Escape');
    assert.equal(await title(),'Reports');
    await find('Sales register'); assert.match(await title(),/^Sales register/);
    await go('Customers');assert.equal(await title(),'Customers');
    for(const [name,menu] of [['Balance sheet','Reports'],['Company','Settings']]) {
      await go(name); assert.ok((await title()).startsWith(name));
      assert.equal(await js('document.querySelector("#nav [aria-current] strong").textContent'),menu);
    }
    await go('Reports'); win.setSize(1100,720); await shot('reports-compact');
    assert.equal(await js('document.querySelector(".report-directory").getBoundingClientRect().right <= innerWidth'),true);
    await press('b',['control']); assert.equal(await js('!!document.activeElement.closest("#nav")'),true);
    await press('h',['control']); assert.equal(await title(),'Dashboard');
    console.log(`BROWSE SMOKE OK. Screenshots: ${out}`); app.exit(0);
  } catch(error) { await shot('failure'); console.error(`${error.stack}\nScreenshots: ${out}`); app.exit(1); }
});
