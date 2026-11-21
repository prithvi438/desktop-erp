'use strict';
// End-to-end check: starts the real app on a throwaway books file and drives it
// with key presses only. Run with `npm run smoke`. Screenshots go to SMOKE_OUT.
const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const out = process.env.SMOKE_OUT || fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-erp-smoke-'));
process.env.DESKTOP_ERP_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-erp-books-'));
require('../main.js');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

app.whenReady().then(async () => {
  await require('./wait-for-window')();
  const win = BrowserWindow.getAllWindows()[0];
  const page = win.webContents;
  page.setBackgroundThrottling(false);
  win.focus();
  page.focus();

  const code = (ch) => (ch === ' ' ? 'Space' : ch);
  async function press(keyCode, modifiers = []) {
    page.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
    page.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
    await sleep(170);
  }
  async function type(text) {
    for (const ch of text) {
      page.sendInputEvent({ type: 'keyDown', keyCode: code(ch) });
      page.sendInputEvent({ type: 'char', keyCode: ch });
      page.sendInputEvent({ type: 'keyUp', keyCode: code(ch) });
    }
    await sleep(170);
  }
  // Type each value and press Enter after it.
  async function enter(...values) {
    for (const value of values) {
      await type(value);
      await press('Enter');
    }
  }
  const read = (selector) => page.executeJavaScript(`document.querySelector(${JSON.stringify(selector)}).innerText`);
  const title = () => read('#title');
  const shot = async (name) => {
    win.show();
    win.focus();
    await sleep(400);
    fs.writeFileSync(path.join(out, `${name}.png`), (await page.capturePage()).toPNG());
  };
  const save = () => press('s', ['control']);
  // Ctrl+K, type the name of a screen, Enter.
  async function go(name, expected = null) {
    await press('k', ['control']);
    await sleep(150);
    await enter(name);
    await sleep(250);
    if (expected) assert.match(await title(), expected, `"${name}" did not open`);
  }
  const home = async () => {
    for (let i = 0; i < 4 && (await title()) !== 'Dashboard'; i++) await press('Escape');
    assert.equal(await title(), 'Dashboard');
  };

  try {
    assert.equal(await title(), 'Dashboard');

    // Company details, including the state that decides CGST/SGST or IGST.
    await go('company', /^Company$/);
    await enter('Speedo Traders', '12 Market Road', 'Maharashtra', '27AAAAA0000A1Z5', '9999900000');
    assert.equal(await read('#company'), 'Speedo Traders');

    // Ledgers, entered with the keyboard only.
    await go('ledgers', /^Ledgers$/);
    for (const [name, group, opening, side] of [['HDFC Bank', 'bank', '50000', null], ['Capital', 'capital', '50000', 'c'], ['Rent', 'indirect e', '', null]]) {
      await press('c', ['alt']);
      await enter(name, group);
      await type(opening);
      await press('Enter');
      if (side) await press(side);
      await save();
      assert.equal(await title(), 'Ledgers', `ledger ${name} was not saved`);
    }
    const ledgers = await read('main');
    assert.match(ledgers, /HDFC Bank\s+Bank Accounts\s+50,000\.00 Dr/);
    assert.match(ledgers, /Capital\s+Capital Account\s+50,000\.00 Cr/);
    await home();

    // Parties start under the right group; one customer is in another state.
    await go('customers', /^Customers$/);
    await press('c', ['alt']);
    assert.equal(await title(), 'Create ledger');
    await type('City Chemist');
    await save();
    await press('c', ['alt']);
    await enter('Delhi Medicals', '', '', '', '07ABCDE1234F1Z5');
    await type('Delhi');
    await save();
    assert.match(await read('main'), /Delhi Medicals\s+07ABCDE1234F1Z5/);
    await home();
    await go('suppliers', /^Suppliers$/);
    await press('c', ['alt']);
    await type('Medico Supplies');
    await save();
    await home();

    // Payment: rent paid from the bank. Then F6 for a receipt: a cash sale.
    await go('voucher entry', /^Voucher entry: Payment$/);
    await enter('hdfc', 'rent', '12000');
    await press('Enter');
    await enter('November rent');
    assert.match(await read('#toast'), /Payment No\. 1 saved/);
    await press('F6');
    assert.equal(await title(), 'Voucher entry: Receipt');
    await enter('cash', 'sales', '25000.50');
    await press('Enter');
    await press('Enter');
    assert.match(await read('#toast'), /Receipt No\. 1 saved/);
    await home();

    await go('trial balance', /^Trial balance as of/);
    assert.match(await read('main'), /Total\s+75,000\.50\s+75,000\.50/);
    await home();

    // An item, then a purchase by batch, sales in and out of state, and a return.
    await go('items', /^Items$/);
    await press('c', ['alt']);
    await enter('Paracetamol 500', 'strip', '3004', 'Tablets', 'Cipla', '12', '30', '20', '20');
    await save(); // Optional billing controls now follow stock/pricing fields.
    assert.match(await read('main'), /Paracetamol 500\s+Tablets\s+Cipla\s+3004\s+12\.00\s+30\.00\s+0 STRIP/);
    await home();

    await go('new purchase bill', /^Purchase bill$/);
    await enter('medico', 'para', 'B1', '3-35', '100');
    await press('Enter'); // rate offered from the item
    await press('Enter'); // optional line discount
    await press('Enter'); // GST offered from the item
    await press('Enter'); // empty item line: open ledger entries
    await press('Enter'); // empty ledger line: go to narration
    await press('Enter');
    assert.match(await read('#toast'), /Purchase bill No\. 1 saved, total 2,240\.00/);
    await home();

    await go('new sales invoice', /^Sales invoice$/);
    for (const [party, quantity, total] of [['city', '10', '336.00'], ['delhi', '20', '672.00']]) {
      await enter(party, 'para');
      await sleep(300);
      await type(quantity);
      if (party === 'city') await shot('2-sales-invoice');
      await press('Enter', ['control']); // finish the line with default prices
      await press('Enter'); // empty item moves to ledger entries
      await press('Enter');
      await press('Enter');
      assert.match(await read('#toast'), new RegExp(`Sales invoice No\\. \\d saved, total ${total}`));
    }
    await home();

    await go('new credit note', /^Credit note/);
    await enter('city', 'para', 'B1', '3-35', '2');
    await press('Enter'); // additional ledger-entry step after the items
    await press('Enter'); // rate
    await press('Enter');
    await press('Enter');
    await press('Enter');
    await press('Enter');
    assert.match(await read('#toast'), /Credit note \(sales return\) No\. 1 saved, total 67\.20/);
    await home();

    // 100 bought, 30 sold, 2 returned: 72 left at a cost of 20.00.
    await go('stock on hand', /^Stock on hand/);
    assert.match(await read('main'), /Paracetamol 500\s+Tablets\s+B1\s+03-2035\s+72 STRIP\s+1,440\.00/);
    await home();

    await go('debtors', /^Debtors/);
    const dues = await read('main');
    assert.match(dues, /City Chemist\s+268\.80\s+268\.80/);
    assert.match(dues, /Delhi Medicals\s+672\.00/);
    await home();

    await go('gst returns', /^GST returns/);
    const gst = await read('main');
    assert.match(gst, /Outward supplies \(sales less returns\)\s+840\.00\s+14\.40\s+14\.40\s+72\.00\s+100\.80/);
    assert.match(gst, /Delhi Medicals\s+07ABCDE1234F1Z5\s+600\.00\s+72\.00\s+72\.00/);
    assert.match(gst, /HSN 3004 at 12\.00%: 28 STRIP\s+840\.00\s+100\.80/);
    await shot('3-gst-returns');
    await home();

    await go('sales register', /^Sales register/);
    assert.match(await read('main'), /Total\s+840\.00\s+14\.40\s+14\.40\s+72\.00\s+940\.80/);
    await home();

    await go('trading account', /^Trading account/);
    assert.match(await read('main'), /Gross profit\s+25,280\.50/);
    await home();
    await go('profit & loss', /^Profit & loss/);
    assert.match(await read('main'), /Net profit\s+13,280\.50/);
    await home();

    await go('balance sheet', /^Balance sheet/);
    const sheet = await read('main');
    const liabilities = /Total liabilities\s+([\d,.]+)/.exec(sheet)[1];
    assert.equal(/Total assets\s+([\d,.]+)/.exec(sheet)[1], liabilities);
    await shot('4-balance-sheet');
    await home();

    await go('cash flow', /^Cash flow/);
    assert.match(await read('main'), /Closing cash and bank\s+63,000\.50/);
    await home();

    // Mark the rent payment as cleared by the bank.
    await go('bank reconciliation');
    await press('Enter');
    await sleep(250);
    assert.equal(await title(), 'Bank reconciliation: HDFC Bank');
    assert.match(await read('main'), /Balance as per bank\s+50,000\.00/);
    for (let i = 0; i < 3; i++) await press('Up');
    await press('Enter');
    await sleep(250);
    assert.match(await read('main'), /Balance as per bank\s+38,000\.00/);
    await home();

    await go('chart of accounts', /^Chart of accounts$/);
    assert.match(await read('main'), /Sundry Debtors\s+940\.80 Dr\s+City Chemist\s+268\.80 Dr/);
    await shot('5-chart-of-accounts');
    await home();

    await go('ratios', /^Ratios/);
    assert.match(await read('main'), /Gross profit margin\s+97\.8%/);
    await home();

    // The day book opens each voucher on the screen it was entered on.
    await go('day book', /^Day book$/);
    await press('Enter');
    assert.equal(await title(), 'Alter: Credit note (sales return)');
    await home();

    // A sales order moves no stock; Alt+V turns it into an invoice with the batch filled in.
    await go('sales orders', /^Sales orders$/);
    await press('c', ['alt']);
    await enter('city', 'para', '5');
    await press('Enter', ['control']); // finish rate, discount and GST with defaults
    await press('Enter'); // empty item moves to ledger entries
    await press('Enter');
    await press('Enter');
    assert.match(await read('#toast'), /Sales order No\. 1 saved, total 168\.00/);
    await home();
    await go('sales orders', /^Sales orders$/);
    await press('Enter');
    assert.equal(await title(), 'Alter: Sales order');
    await press('v', ['alt']);
    await sleep(400);
    assert.equal(await title(), 'Sales invoice');
    await save();
    assert.match(await read('#toast'), /Sales invoice No\. 3 saved, total 168\.00/);
    await home();

    await go('budgets', /^Budgets/);
    await press('Down');
    await press('Down');
    await press('Enter');
    await enter('20000');
    await sleep(250);
    assert.match(await read('main'), /Rent\s+Indirect Expenses\s+20,000\.00\s+12,000\.00\s+8,000\.00\s+60%/);
    await home();

    // Typing on the dashboard opens the palette with what was typed.
    await shot('1-dashboard');
    await press('i');
    await enter('nvoices');
    await sleep(250);
    assert.equal(await title(), 'Invoices');
    await home();
    await press('Down');
    await press('Enter');
    await sleep(250);
    assert.equal(await title(), 'Reports');

    await home();
    // New catalog pricing is created through keyboard controls.
    await go('pricebooks', /^Pricebooks$/);
    await press('c', ['alt']);
    async function field(value) { await press('a', ['control']); await type(value); await press('Tab'); }
    await field('Trade'); await field('MARKDOWN'); await field('10'); await field('Yes'); await field('No');
    await save();
    assert.equal(await title(), 'Pricebooks');
    assert.match(await read('main'), /Trade\s+MARKDOWN\s+10\.00/);
    await press('Enter');
    assert.equal(await title(), 'Prices: Trade');
    await press('c', ['alt']);
    await field('Paracetamol 500'); await field('10'); await type('20'); await save();
    assert.equal(await title(), 'Prices: Trade');
    assert.match(await read('main'), /Paracetamol 500\s+10 strip\s+20\.00/i);
    await shot('7-pricebook');
    await home();
    await go('new sales invoice', /^Sales invoice$/);
    await press('p', ['alt']); await enter('Trade');
    assert.match(await read('.pricebook-button'), /Trade/);
    await enter('City Chemist', 'Paracetamol');
    await type('10'); await press('Enter');
    assert.equal(await page.executeJavaScript('document.querySelector("tbody tr input.num").value'), '10');
    assert.equal(await page.executeJavaScript('document.querySelectorAll("tbody tr input.num")[1].value'), '20.00');
    await shot('8-pricebook-invoice');
    // Save proves the selected price and reference reach SQLite.
    await save();
    assert.match(await read('#toast'), /saved/);
    await home();
    await go('cheques', /^Cheques$/);
    await press('c', ['alt']);
    await field('IN'); await field('123456'); await field('City Chemist'); await field('HDFC Bank'); await field('100');
    await field('01-01-2020'); await field('01-01-2020'); await type('Customer cheque'); await save();
    assert.equal(await title(), 'Cheques');
    assert.match(await read('main'), /123456.*01-01-2020/s);
    assert.match(await read('main'), /PENDING/);
    await press('d', ['alt']); await press('Enter'); await press('Enter');
    assert.match(await read('main'), /DEPOSITED/);
    await press('l', ['alt']); await press('Enter'); await press('Enter');
    assert.match(await read('main'), /CLEARED/);
    await shot('9-cheques');
    await press('F10'); await press('Down'); await press('Enter');
    assert.equal(await title(), 'Reports');
    await press('F10'); await press('PageDown');
    assert.equal(await page.executeJavaScript('document.activeElement.closest("#nav") !== null'), true);
    await press('h', ['control']);
    assert.equal(await title(), 'Dashboard');

    console.log(`SMOKE OK. Screenshots: ${out}`);
    app.exit(0);
  } catch (error) {
    await shot('failure').catch(() => {});
    console.error(`SMOKE FAILED: ${error.message}\ntitle: ${await title().catch(() => '?')}\nscreenshots: ${out}`);
    app.exit(1);
  }
});
