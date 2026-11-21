'use strict';
// Two-way sync with the Desktop ERP server over its Tally agent API
// (Desktop-ERP-Backend: services/tallySync.js). These books present themselves as a
// Tally company: masters and vouchers go up as Tally-format XML, and the server's own
// changes come down as jobs in the same format.
//
// What the server expects, and this file relies on:
//  - Masters are matched by name, so every upload is safe to repeat.
//  - A voucher is identified by its GUID (our uuid) and its ALTERID (our rev).
//  - An upload for a date window must hold every voucher in it: one that is missing
//    is taken as deleted here.
//  - Uploads are imported in the background; the batch is polled for its result.
//  - A voucher born on the server has a 24-hex id. It is kept under that id here and
//    sent back in later windows so the server recognises its own.
const crypto = require('node:crypto');
const os = require('node:os');
const xml = require('./xml');
const { VOUCHER_TYPES, BooksError } = require('./books');

const DEFAULT_SERVER = process.env.DESKTOP_ERP_SYNC_URL || '';
const UNSENT_TYPES = ['Quotation', 'Stock Journal']; // the server takes no vouchers of these types
const WINDOW_DAYS = 31;

const ymd = (date) => date.replaceAll('-', '');
const fromYmd = (value) => `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
const addDays = (date, days) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
const earliest = (...dates) => dates.filter(Boolean).sort()[0] || '';
const tag = (name, value) => (value === '' || value == null ? '' : `<${name}>${xml.escape(value)}</${name}>`);
// Tally writes a debit as a negative amount.
const tallyAmount = (paise) => (-paise / 100).toFixed(2);
const paise = (value) => Math.round(parseFloat(String(value).replace(/,/g, '')) * 100) || 0;

// A message safe to show the user as-is.
class SyncError extends BooksError {}

function serverAddress(input) {
  let address = String(input || '').trim() || DEFAULT_SERVER;
  if(!address)throw new SyncError('Enter your cloud server address');
  if (!/^https?:\/\//i.test(address)) address = `https://${address}`;
  const url = new URL(address);
  if (url.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(url.hostname)) throw new SyncError('The server address must start with https://');
  if (url.pathname === '/' || url.pathname === '') url.pathname = '/api';
  return url.toString().replace(/\/$/, '');
}

// ---- books to Tally XML ----

const envelope = (messages) => `<ENVELOPE><BODY><IMPORTDATA><REQUESTDATA>${messages.map((body) => `<TALLYMESSAGE xmlns:UDF="TallyUDF">${body}</TALLYMESSAGE>`).join('')}</REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>`;

function mastersXml({ groups, ledgers, items }) {
  const named = (name, rest) => `NAME="${xml.escape(name)}">${rest}`;
  const categories = [...new Set(items.map((item) => item.category).filter(Boolean))];
  const units = [...new Set(items.map((item) => item.unit))];
  const rate = (head, value) => `<RATEDETAILS.LIST>${tag('GSTRATEDUTYHEAD', head)}${tag('GSTRATE', value / 100)}</RATEDETAILS.LIST>`;
  return envelope([
    ...groups.map((group) => `<GROUP ${named(group.name, tag('PARENT', group.parent))}</GROUP>`),
    ...ledgers.map((ledger) => `<LEDGER ${named(ledger.name, [
      tag('PARENT', ledger.parent),
      ledger.opening ? tag('OPENINGBALANCE', tallyAmount(ledger.opening)) : '',
      tag('PARTYGSTIN', ledger.gstin), tag('LEDSTATENAME', ledger.state), tag('LEDGERMOBILE', ledger.phone),
      ledger.creditDays ? tag('BILLCREDITPERIOD', `${ledger.creditDays} Days`) : '',
    ].join(''))}</LEDGER>`),
    ...units.map((unit) => `<UNIT ${named(unit, tag('ISSIMPLEUNIT', 'Yes'))}</UNIT>`),
    ...categories.map((category) => `<STOCKGROUP ${named(category, '')}</STOCKGROUP>`),
    ...items.map((item) => `<STOCKITEM ${named(item.name, [
      tag('PARENT', item.category), tag('BASEUNITS', item.unit),
      `<GSTDETAILS.LIST>${tag('APPLICABLEFROM', '20170701')}${tag('HSNCODE', item.hsn)}${tag('TAXABILITY', item.gstRate ? 'Taxable' : 'Exempt')}`,
      `<STATEWISEDETAILS.LIST>${rate('Central Tax', item.gstRate / 2)}${rate('State Tax', item.gstRate / 2)}${rate('Integrated Tax', item.gstRate)}</STATEWISEDETAILS.LIST></GSTDETAILS.LIST>`,
    ].join(''))}</STOCKITEM>`),
  ]);
}

function voucherXml(voucher) {
  const entry = (row) => `<ALLLEDGERENTRIES.LIST>${tag('LEDGERNAME', row.ledger)}${tag('ISDEEMEDPOSITIVE', row.amount > 0 ? 'Yes' : 'No')}${tag('AMOUNT', tallyAmount(row.amount))}</ALLLEDGERENTRIES.LIST>`;
  const line = (row) => {
    const quantity = `${Math.abs(row.qty) / 1000} ${row.unit}`;
    // The current connector imports order rates but has no discount field.
    // Export a net unit rate, while AMOUNT retains the exact rounded net line value.
    const netRate=row.qty&&Math.round(Math.abs(row.qty)*row.rate/1000)!==row.amount?Math.round(row.amount*1000/Math.abs(row.qty)):row.rate;
    // Goods coming in (or ordered from a supplier) are the debit side.
    const inward = row.qty > 0 && voucher.type !== 'Sales Order';
    return `<ALLINVENTORYENTRIES.LIST>${[
      tag('STOCKITEMNAME', row.item), tag('ISDEEMEDPOSITIVE', inward ? 'Yes' : 'No'),
      tag('RATE', `${(netRate / 100).toFixed(2)}/${row.unit}`), tag('AMOUNT', tallyAmount(inward ? row.amount : -row.amount)),
      tag('ACTUALQTY', quantity), tag('BILLEDQTY', quantity),
      `<BATCHALLOCATIONS.LIST>${tag('GODOWNNAME', 'Main Location')}${tag('BATCHNAME', row.batch)}${tag('ACTUALQTY', quantity)}${tag('BILLEDQTY', quantity)}</BATCHALLOCATIONS.LIST>`,
      `<RATEDETAILS.LIST>${tag('GSTRATEDUTYHEAD', 'Integrated Tax')}${tag('GSTRATE', row.gstRate / 100)}</RATEDETAILS.LIST>`,
    ].join('')}</ALLINVENTORYENTRIES.LIST>`;
  };
  return `<VOUCHER REMOTEID="${xml.escape(voucher.uuid)}" VCHTYPE="${xml.escape(voucher.type)}" ACTION="Create">${[
    tag('DATE', ymd(voucher.date)), tag('GUID', voucher.uuid), tag('ALTERID', voucher.rev), tag('MASTERID', voucher.id),
    tag('VOUCHERTYPENAME', voucher.type), tag('VOUCHERNUMBER', voucher.ref || voucher.number),
    tag('PARTYLEDGERNAME', voucher.party || voucher.entries[0]?.ledger), tag('NARRATION', voucher.narration),
    ...voucher.entries.map(entry), ...voucher.lines.map(line),
  ].join('')}</VOUCHER>`;
}

// ---- the sync itself ----

// support: the books' sync support object. keyStore: { get(), set(value) } for the agent key,
// which is a secret and is kept out of the books file. wait(ms) is replaceable for tests.
function createSync({ support, keyStore, version = '0', fetch = globalThis.fetch, wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) }) {
  let session = {}; // login token or 2FA challenge, held in memory only while pairing
  let busy = false;
  // Recover the range claimed by a process that stopped before acknowledging it.
  const interrupted=support.getState('inflight_from');
  if(interrupted){support.setDirtyFrom(earliest(interrupted,support.dirtyFrom()));support.setState('inflight_from','');}

  async function request(method, path, { token, key, body } = {}) {
    const base = support.getState('server') || DEFAULT_SERVER;
    const headers = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (token) headers.Authorization = token; // the server hands the token out already prefixed with "Bearer "
    if (key) headers['X-Tally-Agent-Key'] = key;
    let response;
    try {
      response = await fetch(`${base}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(120000) });
    } catch (error) {
      throw new SyncError(`Cannot reach Desktop ERP at ${base}: ${error.cause?.message || error.message}`);
    }
    const raw = await response.text();
    let data;
    try { data = raw ? JSON.parse(raw) : {}; } catch { data = { message: raw.slice(0, 200) }; }
    if (!response.ok) {
      const error = new SyncError(data.message || `Desktop ERP answered ${response.status}`);
      error.status = response.status;
      throw error;
    }
    return data;
  }

  // ---- pairing ----

  const businesses = async () => (await request('GET', '/org/businesses', { token: session.token })).map((row) => ({ id: row._id, name: row.name, active: Boolean(row.is_active) }));

  // identity: email, username or phone. Answers { twoFactor, hint } or { businesses }.
  async function login({ server, identity, password }) {
    if (busy || keyStore.get()) throw new SyncError('Unlink the current business before signing in again');
    support.setState('server', serverAddress(server));
    const out = await request('POST', '/login', { body: { email: String(identity || '').trim(), password } });
    if (out.two_factor_required) {
      session = { challenge: out.challenge_token };
      return { twoFactor: true, hint: out.contact_hint || out.method || '' };
    }
    if (!out.token) throw new SyncError(out.message || 'Sign-in failed');
    session = { token: out.token };
    return { businesses: await businesses() };
  }

  async function verify({ code }) {
    if (!session.challenge) throw new SyncError('Sign in again');
    const out = await request('POST', '/login/2fa/verify', { token: session.challenge, body: { code: String(code).trim() } });
    session = { token: out.token };
    return { businesses: await businesses() };
  }

  // Links these books to one business on the server and stores the agent key it issues.
  async function pair({ businessId, businessName, direction='upload' }) {
    if (busy || keyStore.get()) throw new SyncError('Unlink the current business before linking another');
    if (!session.token) throw new SyncError('Sign in again');
    if(!['upload','both'].includes(direction))throw new SyncError('Choose local-to-web or two-way sync');
    const allowed = await businesses();
    const business = allowed.find((row) => row.id === businessId);
    if (!business) throw new SyncError('Choose a business available to your account');
    const switched = await request('POST', '/org/switch-business', { token: session.token, body: { business: businessId } });
    const company = support.companyName();
    const first = support.range().first;
    const out = await request('POST', '/accounting/tally-sync/connections', {
      token: switched.token || session.token,
      body: {
        tally_company: company,
        name: `${company} @ ${os.hostname()} (Desktop ERP)`,
        device_name: os.hostname(),
        tally_version: `Desktop ERP ${version}`,
        direction: direction==='upload'?'pull':'both',
        ...(first ? { from_date: first } : {}),
      },
    });
    if (!out.agent_key) throw new SyncError(out.message || 'Desktop ERP did not issue a key for this computer');
    session = {};
    keyStore.set(out.agent_key);
    support.setState('connection', out.connection?._id || '');
    support.setState('business', business.name);
    support.setState('business_id', businessId);
    support.setState('direction',direction);
    support.setState('enabled', '1');
    support.setState('auto', '');
    support.setState('masters_hash', '');
    support.setState('last_error', '');
    support.setDirtyFrom(first || '');
    return status();
  }

  // Forgets the key here. The connection stays listed on the server until removed there.
  function unpair() {
    if (busy) throw new SyncError('Wait for the current sync to finish before unlinking');
    keyStore.set('');
    for (const key of ['connection', 'business', 'business_id', 'direction', 'enabled', 'masters_hash', 'last_sync', 'last_error', 'last_result', 'last_success', 'inflight_from', 'auto']) support.setState(key, '');
    return status();
  }

  function status() {
    let last = null;
    try { last = JSON.parse(support.getState('last_result') || 'null'); } catch { /* an unreadable summary is not worth failing for */ }
    return {
      paired: Boolean(keyStore.get()),
      server: support.getState('server') || DEFAULT_SERVER,
      business: support.getState('business'),
      businessId: support.getState('business_id'),
      direction: support.getState('direction')||'both',
      enabled: Boolean(keyStore.get()) && support.getState('enabled') !== '0',
      auto: support.getState('auto') === '1',
      busy,
      waitingFrom: earliest(support.dirtyFrom(),support.getState('inflight_from')),
      mastersPending:crypto.createHash('sha256').update(mastersXml(support.masters())).digest('hex')!==support.getState('masters_hash'),
      lastSuccess:support.getState('last_success'),
      lastSync: support.getState('last_sync'),
      lastError: support.getState('last_error'),
      last,
    };
  }

  function setAuto({ on }) {
    if (on && (!keyStore.get() || support.getState('enabled') === '0')) throw new SyncError('Enable sync with a linked business first');
    support.setState('auto', on ? '1' : '');
    return status();
  }

  function setEnabled({ on }) {
    if (!keyStore.get()) throw new SyncError('Link a business first');
    if (busy) throw new SyncError('Wait for the current sync to finish before changing sync settings');
    support.setState('enabled', on ? '1' : '0');
    if (!on) support.setState('auto', '');
    return status();
  }

  // ---- server to books ----

  function applyVoucher(node) {
    const uuid = node.attrs.REMOTEID || xml.text(node, 'GUID');
    if (!uuid) throw new SyncError('The server sent a voucher without an id');
    if (/^(delete|cancel)$/i.test(node.attrs.ACTION || '')) return support.removeVoucher({ uuid });

    const inventory = [...xml.all(node, 'ALLINVENTORYENTRIES.LIST'), ...xml.all(node, 'INVENTORYENTRIES.LIST')];
    const entries = [...xml.all(node, 'ALLLEDGERENTRIES.LIST'), ...xml.all(node, 'LEDGERENTRIES.LIST'), ...inventory.flatMap((line) => xml.all(line, 'ACCOUNTINGALLOCATIONS.LIST'))]
      .map((entry) => ({ ledger: xml.text(entry, 'LEDGERNAME'), amount: -paise(xml.text(entry, 'AMOUNT')) }))
      .filter((entry) => entry.ledger && entry.amount);

    // The server keeps opening balances as journals against this account. Here an opening
    // balance is a figure on the ledger, so take the figure and store no voucher.
    if (entries.some((entry) => /^opening balance equity$/i.test(entry.ledger))) {
      for (const entry of entries) if (!/^opening balance equity$/i.test(entry.ledger)) support.setOpening({ name: entry.ledger, opening: entry.amount });
      return 1;
    }

    const lines = inventory.map((line) => {
      const quantity = xml.text(line, 'ACTUALQTY') || xml.text(line, 'BILLEDQTY'); // "2 PCS"
      const qty = Math.round(parseFloat(quantity) * 1000) || 0;
      const rates = xml.all(line, 'RATEDETAILS.LIST').map((rate) => [xml.text(rate, 'GSTRATEDUTYHEAD'), parseFloat(xml.text(rate, 'GSTRATE')) || 0]);
      const integrated = rates.find(([head]) => /integrated|igst/i.test(head));
      const gst = integrated ? integrated[1] : rates.filter(([head]) => /central|state|cgst|sgst/i.test(head)).reduce((total, [, rate]) => total + rate, 0);
      const batch = xml.all(line, 'BATCHALLOCATIONS.LIST')[0];
      return {
        item: xml.text(line, 'STOCKITEMNAME'),
        unit: quantity.replace(/^[\d.,\s-]+/, '').trim(),
        batch: batch ? xml.text(batch, 'BATCHNAME') : '',
        qty: /^yes$/i.test(xml.text(line, 'ISDEEMEDPOSITIVE')) ? qty : -qty,
        rate: paise(xml.text(line, 'RATE')),
        gstRate: Math.round(gst * 100),
        amount: Math.abs(paise(xml.text(line, 'AMOUNT'))),
      };
    }).filter((line) => line.item && line.qty);

    const name = xml.text(node, 'VOUCHERTYPENAME') || node.attrs.VCHTYPE || '';
    const type = /pro\s*-?forma/i.test(name) ? 'Quotation' : VOUCHER_TYPES.find((known) => known.toLowerCase() === name.toLowerCase()) || 'Journal';
    const date = xml.text(node, 'DATE') || xml.text(node, 'EFFECTIVEDATE');
    support.importVoucher({
      uuid, type, entries, lines,
      ref: xml.text(node, 'VOUCHERNUMBER'),
      date: /^\d{8}$/.test(date) ? fromYmd(date) : date,
      narration: xml.text(node, 'NARRATION'),
      party: xml.text(node, 'PARTYLEDGERNAME'),
    });
    return 1;
  }

  // Applies one job and answers how many records it changed. Units, stock groups, godowns
  // and voucher types that ride along with a job have no counterpart here and are passed over.
  function applyJob(job) {
    return support.atomic(()=>{
    let changed = 0;
    for (const message of xml.all(xml.parse(job.xml), 'TALLYMESSAGE')) {
      for (const node of message.children) {
        const name = node.attrs.NAME || xml.text(node, 'NAME');
        const period = parseInt(xml.text(node, 'BILLCREDITPERIOD'), 10) || 0;
        if (node.name === 'GROUP') support.upsertGroup({ name, parent: xml.text(node, 'PARENT') });
        else if (node.name === 'LEDGER') support.upsertLedger({ name, parent: xml.text(node, 'PARENT'), gstin: xml.text(node, 'PARTYGSTIN'), state: xml.text(node, 'LEDSTATENAME'), phone: xml.text(node, 'LEDGERPHONE'), creditDays: period });
        else if (node.name === 'STOCKITEM') support.upsertItem({ name, unit: xml.text(node, 'BASEUNITS'), category: xml.text(node, 'PARENT'), hsn: xml.text(xml.all(node, 'GSTDETAILS.LIST')[0] || node, 'HSNCODE') });
        else if (node.name === 'VOUCHER') applyVoucher(node);
        else continue;
        changed += 1;
      }
    }
    return changed;
    });
  }

  async function takeJobs(key, summary) {
    for (let round = 0; round < 20; round++) {
      const { jobs = [] } = await request('GET', '/tally-agent/jobs?limit=25', { key });
      if (!jobs.length) return;
      const results = jobs.map((job) => {
        try {
          const changed = applyJob(job);
          summary.received += 1;
          return { id: job._id, ok: true, result: { ok: true, created: changed, altered: 0, deleted: 0, cancelled: 0, errors_count: 0, last_vchid: '', last_mid: '', errors: [] } };
        } catch (error) {
          summary.problems.push(`${job.label || job.kind}: ${error.message}`);
          return { id: job._id, ok: false, result: { errors: [error.message] } };
        }
      });
      // Every job taken is answered, or it stays stuck as "sent" on the server.
      await request('POST', '/tally-agent/jobs/ack', { key, body: { results } });
    }
  }

  // ---- books to server ----

  // Uploads one batch and waits for the server to finish importing it.
  async function upload(key, body) {
    let batch;
    for (let attempt = 0; ; attempt++) {
      try {
        ({ batch } = await request('POST', '/tally-agent/push', { key, body }));
        break;
      } catch (error) {
        if (error.status !== 429 || attempt >= 10) throw error; // 429: the server is still on an earlier batch
        await wait(3000);
      }
    }
    for (let polls = 0; polls < 600; polls++) {
      if (batch.state === 'done') return batch.result || {};
      if (batch.state === 'failed') throw new SyncError(batch.error || 'Desktop ERP could not import the upload');
      if (batch.state === 'lost') throw new SyncError('Desktop ERP restarted during the upload. It will be sent again.');
      await wait(2000);
      ({ batch } = await request('GET', `/tally-agent/batches/${batch._id}`, { key }));
    }
    throw new SyncError('Desktop ERP is still importing the last upload. It will be checked again.');
  }

  // Masters go up only when something in them changed, because each upload makes the
  // server post every opening balance afresh.
  async function pushMasters(key, summary, force) {
    const body = mastersXml(support.masters());
    const hash = crypto.createHash('sha256').update(body).digest('hex');
    if (!force && hash === support.getState('masters_hash')) return;
    const result = await upload(key, { kind: 'masters', xml: body });
    summary.masters = { created: result.created || 0, merged: result.merged || 0, failed: result.failed || 0 };
    for (const error of result.errors || []) summary.problems.push(`${error.type} ${error.name}: ${error.error}`);
    if(result.failed||result.errors?.length)throw new SyncError('Some masters were refused by Desktop ERP. They remain pending; correct the reported problems and retry.');
    if(typeof result.skipped==='string')throw new SyncError('Master import is disabled for this connection on Desktop ERP. Enable it before uploading vouchers.');
    support.setState('masters_hash', hash);
  }

  // Uploads every window from the earliest date changed here. Windows are whole, so the
  // server can tell that a voucher missing from one was deleted.
  async function pushVouchers(key, state, summary) {
    let from = support.dirtyFrom();
    if (!from) return false;
    if (state.from_date && from < fromYmd(state.from_date)) throw new SyncError(`Pending entries start on ${from}, before this connection's start date. Change its start date in Desktop ERP; these entries remain pending.`);
    const last = [support.range().last || from, from].sort()[1];
    // Cleared first: a voucher changed while this runs sets it again for the next cycle.
    support.setState('inflight_from',from);
    support.setDirtyFrom('');
    let needsMasters = false;
    try {
      for (let start = from; start <= last; start = addDays(start, WINDOW_DAYS)) {
        const end = [addDays(start, WINDOW_DAYS - 1), last].sort()[0];
        const vouchers = support.vouchers({ from: start, to: end }).filter((voucher) => !UNSENT_TYPES.includes(voucher.type));
        const result = await upload(key, { kind: 'vouchers', xml: envelope(vouchers.map(voucherXml)), from: ymd(start), to: ymd(end) });
        for (const field of ['created', 'skipped', 'failed', 'conflicts']) summary.vouchers[field] += typeof result[field]==='number'?result[field]:0;
        for (const error of result.errors || []) summary.problems.push(`${error.type} ${error.number} of ${error.date}: ${error.error}`);
        summary.conflicts = result.conflicts_total ?? summary.conflicts;
        needsMasters ||= Boolean(result.needs_masters);
        if(result.failed||result.errors?.length)throw new SyncError('Some vouchers were refused by Desktop ERP. The upload range remains pending; correct the reported problems and retry.');
        if(result.not_selected||typeof result.skipped==='string')throw new SyncError('Some voucher types are disabled in the Desktop ERP connector settings. Enable them and retry; the upload range remains pending.');
      }
    } catch (error) {
      support.setDirtyFrom(earliest(from, support.dirtyFrom()));
      support.setState('inflight_from','');
      throw error;
    }
    // The server lacked a master some voucher names: send them all again, then the vouchers.
    if (needsMasters) support.setDirtyFrom(earliest(from, support.dirtyFrom()));
    support.setState('inflight_from','');
    return needsMasters;
  }

  // One round: take the server's changes, then send ours. Problems are recorded in the
  // status and never thrown, so a timer can call this safely.
  async function cycle() {
    const key = keyStore.get();
    if (!key || busy || support.getState('enabled') === '0') return status();
    busy = true;
    const summary = { received: 0, masters: null, vouchers: { created: 0, skipped: 0, failed: 0, conflicts: 0 }, conflicts: 0, problems: [] };
    try {
      const state = await request('POST', '/tally-agent/heartbeat', { key, body: { tally_version: `Desktop ERP ${version}`, agent_version: version, host: os.hostname(), tally_online: true, company_open: true } });
      const expectedBusiness = support.getState('business_id');
      if (state.business && expectedBusiness && String(state.business) !== expectedBusiness) throw new SyncError('The server connection belongs to another business. Sync stopped before transferring any records.');
      const expectedConnection = support.getState('connection');
      if (state.connection && expectedConnection && String(state.connection) !== expectedConnection) throw new SyncError('The server connection does not match this computer. Relink before syncing.');
      summary.conflicts = state.conflicts || 0;
      if (state.enabled === false) throw new SyncError('Sync is paused for this computer on Desktop ERP');
      if(state.direction==='push'&&support.getState('direction')==='upload')throw new SyncError('This connection allows web-to-local changes only. Enable local uploads in the Desktop ERP connector settings.');
      // Directions are named from the server's side: "push" sends to us only, "pull" takes from us only.
      if (state.direction !== 'pull'&&support.getState('direction')!=='upload') await takeJobs(key, summary);
      if (state.direction !== 'push') {
        await pushMasters(key, summary, false);
        if (await pushVouchers(key, state, summary)) await pushMasters(key, summary, true);
      }
      support.setState('last_error', '');
      if(!summary.problems.length&&!summary.conflicts&&!support.dirtyFrom())support.setState('last_success',new Date().toISOString());
    } catch (error) {
      if (!(error instanceof BooksError)) console.error(error);
      support.setState('last_error', error instanceof BooksError ? error.message : 'Sync stopped on an unexpected error. See the log.');
    } finally {
      busy = false;
      support.setState('last_sync', new Date().toISOString());
      support.setState('last_result', JSON.stringify({ ...summary, problems: summary.problems.slice(0, 20) }));
    }
    return status();
  }

  return { api: { status, login, verify, pair, unpair, setAuto, setEnabled, syncNow: cycle }, cycle };
}

module.exports = { createSync, SyncError, DEFAULT_SERVER, mastersXml, voucherXml };
