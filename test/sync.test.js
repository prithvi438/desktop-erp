'use strict';
// Runs the sync against a stand-in for the Speedo One server that follows its Tally
// agent API as read from Speedoone-Backend. It checks what is sent and how the server's
// changes are applied; it cannot prove the real server accepts it.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { openBooks } = require('../src/books');
const { createSync } = require('../src/sync');
const xml = require('../src/xml');

const SERVER_ID = '665f1c2ab3d4e5f6a7b8c9d0'; // the 24-hex id of a voucher born on the server
const job = (id, body) => ({ _id: id, kind: 'voucher', label: id, xml: `<ENVELOPE><BODY><IMPORTDATA><REQUESTDATA><TALLYMESSAGE>${body}</TALLYMESSAGE></REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>` });
const voucherJob = (id, attrs, body) => job(id, `<VOUCHER REMOTEID="${SERVER_ID}" ${attrs}><GUID>${SERVER_ID}</GUID>${body}</VOUCHER>`);
const entry = (ledger, amount) => `<ALLLEDGERENTRIES.LIST><LEDGERNAME>${ledger}</LEDGERNAME><AMOUNT>${amount}</AMOUNT></ALLLEDGERENTRIES.LIST>`;

async function fakeServer() {
  const seen = { pushes: [], acks: [], tokens: [], connection: null, requests: 0 };
  const state = { jobs: [], enabled: true, business: 'b1', connection: 'c1', from_date:'', result:null };
  const server = http.createServer((req, res) => {
    seen.requests++;
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      const body = raw ? JSON.parse(raw) : {};
      const send = (status, data) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };
      const route = `${req.method} ${req.url.replace('/api', '')}`;
      if (req.headers.authorization) seen.tokens.push(req.headers.authorization);
      if (route.includes('/tally-agent/') && req.headers['x-tally-agent-key'] !== 'so_tally_test') return send(401, { message: 'This agent key is not valid' });

      if (route === 'POST /login') return send(200, body.password === 'needs-code' ? { two_factor_required: true, contact_hint: 'a***@x.in', challenge_token: 'Bearer challenge' } : { token: 'Bearer user' });
      if (route === 'POST /login/2fa/verify') return body.code === '123456' ? send(200, { token: 'Bearer user' }) : send(400, { message: 'Incorrect code. 2 attempt(s) left.' });
      if (route === 'GET /org/businesses') return send(200, [{ _id: 'b1', name: 'Speedo Traders', is_active: true }]);
      if (route === 'POST /org/switch-business') return send(200, { token: 'Bearer scoped', business: { _id: 'b1', name: 'Speedo Traders' } });
      if (route === 'POST /accounting/tally-sync/connections') {
        seen.connection = body;
        return send(201, { connection: { _id: 'c1' }, agent_key: 'so_tally_test' });
      }
      if (route === 'POST /tally-agent/heartbeat') return send(200, { enabled: state.enabled, business: state.business, connection: state.connection, direction: 'both', from_date: state.from_date, conflicts: 0 });
      if (route.startsWith('GET /tally-agent/jobs')) return send(200, { jobs: state.jobs.splice(0) });
      if (route === 'POST /tally-agent/jobs/ack') {
        seen.acks.push(...body.results);
        return send(200, { done: body.results.length, failed: 0 });
      }
      if (route === 'POST /tally-agent/push') {
        seen.pushes.push(body);
        return send(202, { batch: { _id: `batch${seen.pushes.length}`, state: 'queued' } });
      }
      if (route.startsWith('GET /tally-agent/batches/')) return send(200, { batch: { _id: route.split('/').pop(), state: 'done', result: state.result||{ created: 1, conflicts_total: 0 } } });
      return send(404, { message: `No route ${route}` });
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { seen, state, address: `http://127.0.0.1:${server.address().port}`, close: () => server.close() };
}

// Books with a custom group, a bank with an opening balance, a rent payment and a purchase.
async function paired(t) {
  const server = await fakeServer();
  t.after(server.close);
  const books = openBooks(':memory:');
  const { api } = books;
  const ledger = (name) => api.ledgers().find((row) => row.name.toLowerCase() === name.toLowerCase());
  const group = (name) => api.groups().find((row) => row.name === name).id;
  api.setCompany({ name: 'Speedo Traders', state: 'Maharashtra' });
  const office = api.saveGroup({ name: 'Office Costs', parentId: group('Indirect Expenses') }).id;
  const rent = api.saveLedger({ name: 'Rent & Rates', groupId: office }).id;
  api.saveLedger({ name: 'Bank', groupId: group('Bank Accounts'), opening: 100000 });
  const supplier = api.saveLedger({ name: 'Medico Supplies', groupId: group('Sundry Creditors'), gstin: '27ABCDE1234F1Z5' }).id;
  const item = api.saveItem({ name: 'Paracetamol 500', unit: 'strip', hsn: '3004', category: 'Tablets', gstRate: 1200 }).id;
  api.saveInvoice({ type: 'Purchase', date: '2026-10-01', partyId: supplier, items: [{ itemId: item, batch: 'B1', expiry: '2030-01', qty: 100000, rate: 2000, gstRate: 1200 }] });
  const payment = api.saveVoucher({ type: 'Payment', date: '2026-11-05', narration: 'Shop rent', lines: [{ ledgerId: rent, amount: 50000 }, { ledgerId: ledger('Cash').id, amount: -50000 }] });
  api.saveInvoice({ type: 'Quotation', date: '2026-11-05', partyId: supplier, items: [{ itemId: item, qty: 1000, rate: 2000, gstRate: 1200 }] });

  let key = '';
  const sync = createSync({ support: books.support, keyStore: { get: () => key, set: (value) => { key = value; } }, version: 'test', wait: async () => {} });
  const signIn = await sync.api.login({ server: server.address, identity: 'owner@speedo.in', password: 'secret' });
  await sync.api.pair({ businessId: signIn.businesses[0].id, businessName: signIn.businesses[0].name,direction:'both' });
  const vouchersIn = (push) => xml.all(xml.parse(push.xml), 'VOUCHER');
  return { ...server, books, api, sync, ledger, rent, payment, vouchersIn, key: () => key };
}

test('rejected master and voucher batches remain pending and retry successfully',async t=>{
  const {sync,state,seen,books,api,payment,rent,ledger}=await paired(t);
  state.result={failed:1,errors:[{type:'ledger',name:'Rent',error:'Refused'}]};
  let status=await sync.cycle();assert.match(status.lastError,/masters were refused/);assert.equal(status.mastersPending,true);
  assert.equal(seen.pushes.length,1);assert.equal(status.waitingFrom,'2026-10-01');
  state.result=null;status=await sync.cycle();assert.equal(status.mastersPending,false);assert.equal(status.waitingFrom,'');
  api.saveVoucher({id:payment.id,type:'Payment',date:'2026-11-05',lines:[{ledgerId:rent,amount:12300},{ledgerId:ledger('Cash').id,amount:-12300}]});
  state.result={failed:1,errors:[{type:'Payment',number:'1',date:'20261105',error:'Refused'}]};
  status=await sync.cycle();assert.match(status.lastError,/vouchers were refused/);assert.equal(status.waitingFrom,'2026-11-05');
  state.result=null;status=await sync.cycle();assert.equal(status.waitingFrom,'');assert.ok(status.lastSuccess);
  books.close();
});

test('interrupted upload ranges recover on restart without losing newer local edits',async t=>{
  const {books,key}=await paired(t);
  books.support.setState('inflight_from','2026-10-01');books.support.setDirtyFrom('2026-11-05');
  const restarted=createSync({support:books.support,keyStore:{get:key,set:()=>{}},wait:async()=>{}});
  assert.equal(restarted.api.status().waitingFrom,'2026-10-01');assert.equal(books.support.getState('inflight_from'),'');books.close();
});

test('backdated pending data is retained when the cloud connection excludes its date',async t=>{
  const {sync,state}=await paired(t);state.from_date='20261101';
  const status=await sync.cycle();assert.match(status.lastError,/before this connection/);assert.equal(status.waitingFrom,'2026-10-01');
});

test('disabled cloud import types do not acknowledge the local upload range',async t=>{
  const {sync,state,books,api,payment,rent,ledger}=await paired(t);await sync.cycle();
  api.saveVoucher({id:payment.id,type:'Payment',date:'2026-11-05',lines:[{ledgerId:rent,amount:1000},{ledgerId:ledger('Cash').id,amount:-1000}]});
  state.result={created:0,not_selected:1,skipped:1};const status=await sync.cycle();
  assert.match(status.lastError,/types are disabled/);assert.equal(status.waitingFrom,'2026-11-05');books.close();
});

test('new pairings default to local-to-web and do not download jobs',async t=>{
  const {sync,state,seen,address}=await paired(t);sync.api.unpair();
  await sync.api.login({server:address,identity:'owner',password:'test'});await sync.api.pair({businessId:'b1'});
  assert.equal(seen.connection.direction,'pull');assert.equal(sync.api.status().direction,'upload');
  state.jobs.push(job('stay-on-web','<LEDGER NAME="Web only"><PARENT>Indirect Expenses</PARENT></LEDGER>'));
  await sync.cycle();assert.equal(state.jobs.length,1);assert.equal(seen.acks.length,0);assert.ok(seen.pushes.length);
});

test('an incoming job rolls back its earlier records when a later record fails',async t=>{
  const {sync,state,api,seen}=await paired(t);await sync.cycle();
  state.jobs.push(job('atomic-job','<LEDGER NAME="Do not leave half a job"><PARENT>Indirect Expenses</PARENT></LEDGER><GROUP NAME="Invalid parent"><PARENT>Missing parent</PARENT></GROUP>'));
  await sync.cycle();assert.equal(seen.acks.at(-1).ok,false);assert.equal(api.ledgers().some(r=>r.name==='Do not leave half a job'),false);
});

test('pairing signs in, picks a business and keeps only the agent key', async (t) => {
  const { seen, sync, key, address } = await paired(t);
  assert.equal(key(), 'so_tally_test');
  assert.deepEqual([seen.connection.tally_company, seen.connection.direction, seen.connection.from_date], ['Speedo Traders', 'both', '2026-10-01']);
  // The server's token already starts with "Bearer " and is sent back as it came.
  assert.deepEqual([...new Set(seen.tokens)], ['Bearer user', 'Bearer scoped']);
  const status = sync.api.status();
  assert.deepEqual([status.paired, status.server, status.business, status.waitingFrom], [true, `${address}/api`, 'Speedo Traders', '2026-10-01']);
});

test('a code is asked for when the account has two-step sign-in', async (t) => {
  const { sync, address } = await paired(t);
  sync.api.unpair();
  assert.deepEqual(await sync.api.login({ server: address, identity: 'owner', password: 'needs-code' }), { twoFactor: true, hint: 'a***@x.in' });
  await assert.rejects(sync.api.verify({ code: '000000' }), /Incorrect code/);
  await sync.api.login({ server: address, identity: 'owner', password: 'needs-code' });
  assert.equal((await sync.api.verify({ code: '123456' })).businesses[0].name, 'Speedo Traders');
  await assert.rejects(sync.api.login({ server: 'http://example.com', identity: 'owner', password: 'x' }), /must start with https/);
});

test('paused local sync makes no network requests and retains the business binding', async (t) => {
  const { sync, seen, address } = await paired(t);
  assert.equal(sync.api.status().businessId, 'b1');
  sync.api.setAuto({ on: true });
  sync.api.setEnabled({ on: false });
  const requests = seen.requests;
  assert.equal(sync.api.status().auto, false);
  await sync.cycle();
  assert.equal(seen.requests, requests);
  assert.equal(seen.pushes.length, 0);
  assert.equal(sync.api.status().lastSync, '');
  assert.equal(sync.api.status().businessId, 'b1');
  assert.throws(() => sync.api.setAuto({ on: true }), /Enable sync/);
  await assert.rejects(sync.api.login({ server: address, identity: 'x', password: 'x' }), /Unlink/);
  sync.api.setEnabled({ on: true });
  await sync.cycle();
  assert.ok(seen.pushes.length > 0);
  sync.api.unpair();
  assert.equal(sync.api.status().businessId, '');
  assert.equal(sync.api.status().enabled, false);
});

test('a mismatched business stops sync before jobs or uploads', async (t) => {
  const { sync, state, seen } = await paired(t);
  state.business = 'another-business';
  const status = await sync.cycle();
  assert.match(status.lastError, /another business/);
  assert.equal(seen.pushes.length, 0);
  assert.equal(seen.acks.length, 0);
  assert.ok(status.waitingFrom);
});

test('the first sync uploads masters, then every voucher window', async (t) => {
  const { seen, sync, payment, vouchersIn, books } = await paired(t);
  const status = await sync.cycle();
  assert.deepEqual([status.lastError, status.waitingFrom], ['', '']);
  assert.deepEqual(seen.pushes.map((push) => [push.kind, push.from, push.to]), [['masters', undefined, undefined], ['vouchers', '20261001', '20261031'], ['vouchers', '20261101', '20261105']]);

  // Only groups beyond the standard ones are sent; a debit opening balance is negative.
  const masters = seen.pushes[0].xml;
  assert.match(masters, /<GROUP NAME="Office Costs"><PARENT>Indirect Expenses<\/PARENT><\/GROUP>/);
  assert.doesNotMatch(masters, /<GROUP NAME="Current Assets"/);
  assert.match(masters, /<LEDGER NAME="Rent &amp; Rates"><PARENT>Office Costs<\/PARENT><\/LEDGER>/);
  assert.match(masters, /<LEDGER NAME="Bank"><PARENT>Bank Accounts<\/PARENT><OPENINGBALANCE>-1000\.00<\/OPENINGBALANCE>/);
  assert.match(masters, /<STOCKITEM NAME="Paracetamol 500"><PARENT>Tablets<\/PARENT><BASEUNITS>STRIP<\/BASEUNITS>/);

  // A purchase carries its ledger lines and its item lines; a quotation is not sent.
  const [purchase] = vouchersIn(seen.pushes[1]);
  assert.equal(xml.text(purchase, 'PARTYLEDGERNAME'), 'Medico Supplies');
  assert.deepEqual(xml.all(purchase, 'ALLLEDGERENTRIES.LIST').map((row) => [xml.text(row, 'LEDGERNAME'), xml.text(row, 'AMOUNT')]),
    [['Medico Supplies', '2240.00'], ['Purchase', '-2000.00'], ['Input CGST', '-120.00'], ['Input SGST', '-120.00']]);
  const [line] = xml.all(purchase, 'ALLINVENTORYENTRIES.LIST');
  assert.deepEqual(['STOCKITEMNAME', 'ISDEEMEDPOSITIVE', 'RATE', 'AMOUNT', 'ACTUALQTY'].map((name) => xml.text(line, name)), ['Paracetamol 500', 'Yes', '20.00/STRIP', '-2000.00', '100 STRIP']);
  assert.equal(xml.text(xml.all(line, 'BATCHALLOCATIONS.LIST')[0], 'BATCHNAME'), 'B1');

  const sent = vouchersIn(seen.pushes[2]);
  assert.deepEqual(sent.map((voucher) => voucher.attrs.VCHTYPE), ['Payment']);
  const uuid = books.support.vouchers({ from: '2026-11-05', to: '2026-11-05' }).find((row) => row.id === payment.id).uuid;
  assert.deepEqual(['GUID', 'ALTERID', 'DATE', 'VOUCHERNUMBER', 'NARRATION'].map((name) => xml.text(sent[0], name)), [uuid, '1', '20261105', '1', 'Shop rent']);
  assert.equal(sent[0].attrs.REMOTEID, uuid);
  assert.doesNotMatch(uuid, /^[0-9a-f]{24}$|-[0-9a-f]{24}$/); // or the server would take it for its own
});

test('later syncs upload only what changed', async (t) => {
  const { seen, sync, api, payment, rent, ledger, vouchersIn } = await paired(t);
  await sync.cycle();
  seen.pushes.length = 0;
  await sync.cycle();
  assert.deepEqual(seen.pushes, []);

  // An edit sends that voucher's window again with a higher revision, and no masters.
  api.saveVoucher({ id: payment.id, type: 'Payment', date: '2026-11-05', lines: [{ ledgerId: rent, amount: 60000 }, { ledgerId: ledger('Cash').id, amount: -60000 }] });
  assert.equal(sync.api.status().waitingFrom, '2026-11-05');
  await sync.cycle();
  assert.deepEqual(seen.pushes.map((push) => [push.kind, push.from, push.to]), [['vouchers', '20261105', '20261105']]);
  assert.equal(xml.text(vouchersIn(seen.pushes[0])[0], 'ALTERID'), '2');

  // A deleted voucher is simply absent from its window, which is how the server learns of it.
  seen.pushes.length = 0;
  api.deleteVoucher({ id: payment.id });
  await sync.cycle();
  assert.deepEqual(seen.pushes.map((push) => [push.from, vouchersIn(push).length]), [['20261105', 0]]);
});

test('changes made on the server are applied here and not echoed as new', async (t) => {
  const { seen, state, sync, api, ledger, books, rent, vouchersIn } = await paired(t);
  await sync.cycle();
  seen.pushes.length = 0;

  state.jobs.push(
    job('j1', '<LEDGER NAME="STATIONERY" ACTION="Create"><PARENT>Indirect Expenses</PARENT><PARTYGSTIN>27AAAAA0000A1Z5</PARTYGSTIN></LEDGER>'),
    voucherJob('j2', 'VCHTYPE="Payment" ACTION="Create"', `<DATE>20261106</DATE><VOUCHERTYPENAME>Payment</VOUCHERTYPENAME><VOUCHERNUMBER>PAY-0007</VOUCHERNUMBER><NARRATION>Pens &amp; paper</NARRATION>${entry('STATIONERY', '-250.00')}${entry('CASH IN HAND', '250.00')}`),
    job('j3', `<VOUCHER REMOTEID="aaaaaaaaaaaaaaaaaaaaaaaa" VCHTYPE="Journal" ACTION="Create"><DATE>20261106</DATE><VOUCHERTYPENAME>Journal</VOUCHERTYPENAME>${entry('BANK', '-1500.00')}${entry('OPENING BALANCE EQUITY', '1500.00')}</VOUCHER>`),
    job('j4', '<GROUP NAME="NO HOME" ACTION="Create"><PARENT>Nowhere At All</PARENT></GROUP>'),
  );
  const status = await sync.cycle();
  assert.equal(status.last.received, 3);
  assert.deepEqual(seen.acks.map((ack) => [ack.id, ack.ok]), [['j1', true], ['j2', true], ['j3', true], ['j4', false]]);
  assert.match(seen.acks[3].result.errors[0], /Group "Nowhere At All" is not in these books/);

  // The ledger exists, the voucher is stored under the server's id, and the server's
  // cash account is the cash ledger here.
  assert.deepEqual([ledger('stationery').groupName, ledger('stationery').gstin], ['Indirect Expenses', '27AAAAA0000A1Z5']);
  const [imported] = books.support.vouchers({ from: '2026-11-06', to: '2026-11-06' });
  assert.deepEqual([imported.uuid, imported.ref, imported.rev, imported.narration], [SERVER_ID, 'PAY-0007', 1, 'Pens & paper']);
  assert.deepEqual(imported.entries.map((row) => [row.ledger, row.amount]), [['STATIONERY', 25000], ['Cash', -25000]]);
  // An opening-balance journal becomes the ledger's opening figure, not a voucher.
  assert.equal(ledger('Bank').opening, 150000);
  assert.equal(api.dayBook({ from: '2026-11-06', to: '2026-11-06' }).length, 1);

  // Receiving a voucher marks nothing as changed here: only the masters go up, for the new ledger.
  assert.deepEqual(seen.pushes.map((push) => push.kind), ['masters']);

  // When that window is next uploaded, the server's voucher is in it under its own id.
  seen.pushes.length = 0;
  api.saveVoucher({ type: 'Payment', date: '2026-11-06', lines: [{ ledgerId: rent, amount: 1000 }, { ledgerId: ledger('Cash').id, amount: -1000 }] });
  await sync.cycle();
  assert.deepEqual(vouchersIn(seen.pushes[0]).map((voucher) => voucher.attrs.REMOTEID.length).sort(), [24, 36]);

  // An altered copy replaces the stored one; a delete removes it.
  state.jobs.push(voucherJob('j5', 'VCHTYPE="Payment" ACTION="Alter"', `<DATE>20261106</DATE><VOUCHERTYPENAME>Payment</VOUCHERTYPENAME>${entry('STATIONERY', '-300.00')}${entry('CASH IN HAND', '300.00')}`));
  await sync.cycle();
  assert.equal(books.support.vouchers({ from: '2026-11-06', to: '2026-11-06' }).find((row) => row.uuid === SERVER_ID).entries[0].amount, 30000);
  state.jobs.push(voucherJob('j6', 'ACTION="Delete"', ''));
  await sync.cycle();
  assert.equal(books.support.vouchers({ from: '2026-11-06', to: '2026-11-06' }).some((row) => row.uuid === SERVER_ID), false);
});

test('a paused connection or a lost key is reported, not thrown', async (t) => {
  const { state, sync, api, rent, ledger } = await paired(t);
  state.enabled = false;
  assert.match((await sync.cycle()).lastError, /paused/);
  // Nothing was sent, so the changes are still waiting.
  assert.equal(sync.api.status().waitingFrom, '2026-10-01');

  state.enabled = true;
  await sync.cycle();
  sync.api.unpair();
  assert.equal(sync.api.status().paired, false);
  api.saveVoucher({ type: 'Payment', date: '2026-11-07', lines: [{ ledgerId: rent, amount: 1000 }, { ledgerId: ledger('Cash').id, amount: -1000 }] });
  assert.equal((await sync.cycle()).lastSync, ''); // without a key the books stay offline
});
