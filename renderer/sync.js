// Settings > Sync with Speedo One: link these books to a business on the server,
// see what the last sync did, and run one now. Unlinked books stay offline.
import { h, toast, confirmBox, ask, picker, formKeys, labelled, showDate } from './ui.js';
import { chrome } from './router.js';
import { pageMasterForm } from './keyboard-pages.js';

const sync = (method, args) => window.sync.call(method, args);
const when = (iso) => (iso ? `${showDate(iso.slice(0, 10))} ${new Date(iso).toLocaleTimeString()}` : 'Never');

export function syncScreen() {
  let status = { paired: false };
  let pages;
  const el = h('section', { class: 'form master-form sync-form' });
  const server = h('input', { class: 'wide', maxLength: 200 });
  const identity = h('input', { class: 'wide', maxLength: 100 });
  const password = h('input', { class: 'wide', type: 'password', maxLength: 200 });
  const direction=h('select',{},h('option',{value:'upload'},'Local to Speedo One'),h('option',{value:'both'},'Two-way: also receive web changes'));
  const fact = (label, value, tone = '') => h('label', {}, h('span', {}, label), h('strong', { class: tone }, value));
  const note = (text) => h('p', { class: 'tip' }, text);

  function draw() {
    if (!status.paired) {
      server.value ||= status.server || '';
      return el.replaceChildren(
        note('These books are kept on this computer only. Sign in to keep a copy on Speedo One and work on them from the web as well.'),
        labelled('Server', server), labelled('Email, username or phone', identity), labelled('Password', password),labelled('Sync direction',direction),h('button',{onclick:connect},'Link business · Ctrl+S'),
        note('The password is used once to link this computer and is not stored.'));
    }
    const last = status.last;
    el.replaceChildren(
      fact('Linked to', status.business || 'A Speedo One business'),
      fact('Business ID', status.businessId || 'Existing connection (ID not recorded locally)'),
      fact('Direction',status.direction==='upload'?'Local to Speedo One':'Two-way'),
      fact('Server', status.server),
      fact('Sync with Speedo One', status.enabled ? 'Enabled' : 'Paused — entries stay on this computer'),
      fact('Automatic sync', status.auto ? 'On, every minute' : 'Off'),
      fact('Last sync', when(status.lastSync)),
      fact('Last successful sync',when(status.lastSuccess)),
      fact('Master changes',status.mastersPending?'Waiting to upload':'Up to date'),
      fact('Waiting to upload', status.waitingFrom ? `Vouchers from ${showDate(status.waitingFrom)}` : 'Nothing'),
      ...(status.lastError ? [fact('Problem', status.lastError, 'bad')] : []),
      ...(last ? [
        fact('Received from Speedo One', `${last.received} change(s)`),
        fact('Uploaded vouchers', `${last.vouchers.created} new, ${last.vouchers.skipped} already there, ${last.vouchers.failed} refused`),
        ...(last.masters ? [fact('Uploaded masters', `${last.masters.created} new, ${last.masters.merged} matched, ${last.masters.failed} refused`)] : []),
        ...(last.conflicts ? [fact('Conflicts to settle on the web', String(last.conflicts), 'bad')] : []),
        ...last.problems.map((problem) => note(problem)),
      ] : []),
      note('A voucher changed in both places is not merged: Speedo One lists it as a conflict to settle on the web, under Accounting, Tally sync.'),
      note('Connector coverage: ledgers, items and supported vouchers, including cheque accounting entries. Quotations, stock journals, pricebook definitions, cheque register metadata, additional fields, document details and image/PDF attachments stay local. This is not a complete cloud backup.'),
      h('div', { class: 'quick-actions' },
        h('button', { onclick: toggleEnabled, disabled: status.busy }, status.enabled ? 'Pause sync (Alt+E)' : 'Enable sync (Alt+E)'),
        h('button', { onclick: syncNow, disabled: !status.enabled || status.busy }, 'Sync now (F5)'),
        h('button', { onclick: toggleAuto, disabled: !status.enabled || status.busy }, status.auto ? 'Turn automatic sync off' : 'Turn automatic sync on'),
        h('button', { onclick: unlink, disabled: status.busy }, 'Unlink business (Alt+U)')));
    // Connection, transfer results and actions share the existing keyboard-page layout.
    const nodes=[...el.children],sections=[];let fields=[];
    const section=content=>sections.push(h('fieldset',{class:'master-group sync-group'},h('legend',{},sections.length?`Sync details ${sections.length+1}`:'Connection'),...content));
    const flush=()=>{if(fields.length){section(fields);fields=[];}};
    for(const node of nodes){
      if(node.tagName==='P'||node.textContent.length>180){flush();for(const chunk of node.textContent.match(/[\s\S]{1,320}/g)||[])section([note(chunk)]);}
      else{fields.push(node);if(fields.length===4)flush();}
    }
    flush();el.replaceChildren(...sections);pages=pageMasterForm(el);
  }

  async function refresh() {
    status = await sync('status');
    draw();
    chrome();
  }

  // Runs one request, showing its problem instead of failing silently.
  async function attempt(work) {
    try {
      await work();
    } catch (error) {
      toast(error.message, 'error');
    }
  }

  const connect = () => attempt(async () => {
    toast('Signing in');
    let out = await sync('login', { server: server.value, identity: identity.value, password: password.value });
    password.value = '';
    if (out.twoFactor) {
      const code = await ask(`Sign-in code sent to ${out.hint || 'you'}`);
      if (!code) return;
      out = await sync('verify', { code });
    }
    const choice = await picker('Link these books to which business?', out.businesses.map((row) => ({ id: row.id, label: row.name, hint: row.active ? 'Open now' : '' })));
    if (!choice) return;
    if (!(await confirmBox(`Upload these books to ${choice.label} on Speedo One?`))) return;
    await sync('pair', { businessId: choice.id, businessName: choice.label,direction:direction.value });
    toast('Linked. Press F5 to sync now.');
    await refresh();
  });

  const syncNow = () => attempt(async () => {
    if (!status.enabled) return toast('Enable sync first. Local entries remain saved.', 'error');
    toast('Syncing');
    status = await sync('syncNow');
    draw();
    const problem=status.lastError||status.last?.problems?.[0]||(status.last?.conflicts?'Resolve sync conflicts on Speedo One.':'');
    toast(problem || 'Sync finished', problem ? 'error' : 'ok');
  });

  const toggleAuto = () => attempt(async () => {
    status = await sync('setAuto', { on: !status.auto });
    draw();
  });

  const toggleEnabled = () => attempt(async () => {
    status = await sync('setEnabled', { on: !status.enabled });
    draw();
    toast(status.enabled ? 'Sync enabled. F5 uploads to the linked business.' : 'Sync paused. Continue working locally.');
  });

  const unlink = () => attempt(async () => {
    if (!(await confirmBox('Stop syncing these books? Nothing is deleted here or on Speedo One.'))) return;
    await sync('unpair');
    await refresh();
    server.focus();
  });

  const signInKeys = formKeys([server, identity, password,direction], connect);

  return {
    title: 'Sync with Speedo One',
    get hints() {
      return status.paired
        ? [['PgUp / PgDn','Details'],['F5', 'Sync now'], ['Alt+E', 'Enable / pause sync'], ['Alt+A', 'Automatic sync on / off'], ['Alt+U', 'Unlink'], ['Esc', 'Back']]
        : [['Enter', 'Next field, then sign in'], ['Esc', 'Back']];
    },
    el,
    async onShow() {
      await refresh();
      if (!status.paired) (server.value ? identity : server).focus();
      else el.querySelector('.row-pages button:not(:disabled)')?.focus();
    },
    onKey(event) {
      if (!status.paired) return signInKeys(event);
      if(event.key==='PageDown'||event.key==='PageUp')pages?.move(event.key==='PageDown'?1:-1);
      else if (event.key === 'F5') syncNow();
      else if (event.altKey && event.code === 'KeyE') toggleEnabled();
      else if (event.altKey && event.code === 'KeyA') toggleAuto();
      else if (event.altKey && event.code === 'KeyU') unlink();
      else return false;
      event.preventDefault();
      return true;
    },
  };
}
