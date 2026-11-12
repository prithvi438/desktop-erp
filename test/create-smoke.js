'use strict';
const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'speedoone-create-'));
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
    page.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
    page.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
    await sleep(130);
  }
  async function type(text) { await page.insertText(text); await sleep(80); }
  async function go(name) { await press('k', ['control']); await type(name); await press('Enter'); await sleep(200); }
  async function shot(name) { win.show(); win.focus(); await sleep(300); fs.writeFileSync(path.join(out, `${name}.png`), (await page.capturePage()).toPNG()); }
  try {
    await go('Create Vouchers');
    assert.equal(await title(), 'Sales invoice');
    assert.equal(await js('document.querySelectorAll(".creation-rail button").length'), 14);
    assert.equal(await js('document.querySelector(".creation-rail button.active").innerText.includes("F8")'), true);
    assert.equal(await js('[...document.querySelectorAll("#nav .item")].some(b => /New sales invoice|New purchase bill|New credit note|New debit note|Voucher entry/.test(b.textContent))'), false);
    for (const [key, expected] of [['F5','Voucher entry: Payment'],['F6','Voucher entry: Receipt'],['F7','Voucher entry: Journal'],['F9','Purchase bill'],['F10','Credit note (sales return)'],['F11','Debit note (purchase return)'],['F12','Purchase order'],['F1','Sales order'],['F3','Quotation'],['F4','Voucher entry: Contra'],['F8','Sales invoice']]) {
      await press(key); assert.equal(await title(), expected, key);
    }
    await press('F2'); assert.equal(await js('document.activeElement.classList.contains("date")'), true);
    await press('F9', ['shift']); assert.equal(await title(), 'Sales invoice');
    await press('F7', ['alt']); assert.equal(await title(), 'Stock journal: stock in');
    await press('F8', ['alt']); assert.equal(await title(), 'Stock journal: stock out');
    await press('F8');
    await type('Unsaved customer'); await press('F5');
    assert.equal(await js('!!document.querySelector(".overlay")'), true);
    await press('n'); assert.equal(await title(), 'Sales invoice');
    assert.equal(await js('document.activeElement.value'), 'Unsaved customer');
    await press('F5'); await press('y'); assert.equal(await title(), 'Voucher entry: Payment');
    await press('F8'); await shot('vouchers');
    win.setSize(1100, 720); await sleep(200); await shot('vouchers-compact'); win.setSize(1400,860);
    await go('Masters');assert.equal(await title(),'Masters');
    await press('F1');await press('c',['alt']);assert.equal(await title(),'Create ledger');
    await type('Desk Customer');await press('Enter');await type('Sundry Debtors');await press('Enter');await press('s',['control']);assert.equal(await title(),'Masters');
    assert.equal(await js('window.books.call("ledgers").then(rows => rows.some(l => l.name === "Desk Customer" && l.groupName === "Sundry Debtors"))'),true);
    await press('F3');await press('c',['alt']);await type('Desk Item');await press('s',['control']);
    assert.equal(await title(),'Masters');
    assert.equal(await js('window.books.call("items").then(rows => rows.some(i => i.name === "Desk Item"))'),true);
    await shot('masters');
    await press('b',['control']); assert.equal(await js('!!document.activeElement.closest("#nav")'), true);
    await press('h',['control']); assert.equal(await title(), 'Dashboard');
    console.log(`CREATE SMOKE OK. Screenshots: ${out}`); app.exit(0);
  } catch (error) {
    await shot('failure'); console.error(`CREATE SMOKE FAILED: ${error.stack}\nScreenshots: ${out}`); app.exit(1);
  }
});
