'use strict';
const { randomUUID } = require('node:crypto');
const SCOPES = ['document', 'item', 'ledger'];
const DEFAULTS = { documentDetails: true, lineDiscount: true, attachments: true, customFields: true, dropdownMasters:false, useCalculator:false, batchTracking:true, expiryTracking:true, discountRules:false, freeOffers:false, batchSort:'expiry', nearExpiryDays:90, roundOff: false, defaultTerms: '', defaultCreditDays: 0 };

module.exports = function detailsStore({ db, BooksError, isDate }) {
  const q = sql => db.prepare(sql);
  const fail = message => { throw new BooksError(message); };
  function scopeCheck(scope) { if (!SCOPES.includes(scope)) fail('Unknown record type'); }
  function settings() {
    const stored = q("SELECT value FROM meta WHERE key='local_form_settings'").get();
    return { ...DEFAULTS, ...(stored ? JSON.parse(stored.value) : {}) };
  }
  function saveSettings(values) {
    const next = settings();
    for (const key of ['documentDetails','lineDiscount','attachments','customFields','dropdownMasters','useCalculator','roundOff','batchTracking','expiryTracking','discountRules','freeOffers']) {
      if (Object.hasOwn(values,key)) {
        if (typeof values[key] !== 'boolean') fail(`${key} must be on or off`);
        next[key] = values[key];
      }
    }
    if (!next.batchTracking && q("SELECT item_id FROM stock_moves WHERE batch<>'' GROUP BY item_id,batch HAVING SUM(qty)<>0 LIMIT 1").get()) fail('Named batches still hold stock. Clear their balances before disabling batch tracking.');
    if (Object.hasOwn(values,'batchSort')) {if(!['expiry','oldest','name'].includes(values.batchSort)) fail('Choose a supported batch order');next.batchSort=values.batchSort;}
    if (Object.hasOwn(values,'nearExpiryDays')) {if(!Number.isInteger(values.nearExpiryDays)||values.nearExpiryDays<0||values.nearExpiryDays>3650)fail('Near expiry days must be between 0 and 3650');next.nearExpiryDays=values.nearExpiryDays;}
    if (Object.hasOwn(values,'defaultTerms')) next.defaultTerms = String(values.defaultTerms).slice(0,5000);
    if (Object.hasOwn(values,'defaultCreditDays')) {
      if (!Number.isInteger(values.defaultCreditDays) || values.defaultCreditDays < 0 || values.defaultCreditDays > 3650) fail('Credit days must be between 0 and 3650');
      next.defaultCreditDays = values.defaultCreditDays;
    }
    q("INSERT INTO meta(key,value) VALUES('local_form_settings',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(JSON.stringify(next));
    return next;
  }
  function fields({ scope } = {}) {
    if (scope) scopeCheck(scope);
    return q('SELECT * FROM custom_fields WHERE ?1 IS NULL OR scope=?1 ORDER BY position,id').all(scope || null).map(r => ({ ...r, options: JSON.parse(r.options) }));
  }
  function saveField({ id = null, scope, label, kind = 'text', required = false, active = true, options = [], position = 0 }) {
    scopeCheck(scope);
    label = String(label || '').trim();
    if (!label || label.length > 80) fail('Enter a field label up to 80 characters');
    if (!['text','number','date','select','boolean'].includes(kind)) fail('Choose a supported field type');
    if (!Array.isArray(options) || options.length > 100 || options.some(o => typeof o !== 'string' || !o.trim() || o.length > 100)) fail('Enter valid choices');
    options = [...new Set(options.map(s => s.trim()))];
    if (kind === 'select' && !options.length) fail('A choice field needs options');
    if (!Number.isInteger(position) || position < 0 || position > 999) fail('Order must be between 0 and 999');
    const old = id && q('SELECT * FROM custom_fields WHERE id=?').get(id);
    if (id && !old) fail('Field not found');
    if (old && (old.scope !== scope || old.kind !== kind)) fail('Scope and type cannot change; deactivate this field and create another');
    if (q('SELECT id FROM custom_fields WHERE scope=? AND label=? COLLATE NOCASE AND id IS NOT ?').get(scope,label,id)) fail('A field with that label already exists');
    const values = [label,kind,required ? 1 : 0,active ? 1 : 0,JSON.stringify(options),position];
    if (id) q('UPDATE custom_fields SET label=?,kind=?,required=?,active=?,options=?,position=? WHERE id=?').run(...values,id);
    else id = Number(q('INSERT INTO custom_fields(label,kind,required,active,options,position,scope) VALUES(?,?,?,?,?,?,?)').run(...values,scope).lastInsertRowid);
    return { id };
  }
  function recordDetails({ scope, id }) {
    scopeCheck(scope);
    const row = q('SELECT value FROM record_details WHERE scope=? AND record_id=?').get(scope,id);
    return row ? JSON.parse(row.value) : { custom: {}, attachments: [] };
  }
  function validate(scope, value = {}, old = {}) {
    scopeCheck(scope);
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail('Record details must be an object');
    const data = { ...old, ...value, custom: { ...(old.custom || {}), ...(value.custom || {}) } };
    if (JSON.stringify(data).length > 100000) fail('Record details are too large');
    for (const f of fields({ scope })) {
      if (!f.active) continue;
      const v = data.custom[f.id];
      const empty = v === '' || v == null;
      if (f.required && empty) fail(`${f.label} is required`);
      if (empty) continue;
      if (f.kind === 'number' && (typeof v !== 'number' || !Number.isFinite(v))) fail(`${f.label} must be a number`);
      if (f.kind === 'date' && !isDate(v)) fail(`${f.label} must be a valid date`);
      if (f.kind === 'boolean' && typeof v !== 'boolean') fail(`${f.label} must be Yes or No`);
      if (['text','select'].includes(f.kind) && (typeof v !== 'string' || v.length > 2000)) fail(`${f.label} must be text up to 2000 characters`);
      // Previously recorded choices remain editable after the field's options change.
      if (f.kind === 'select' && !f.options.includes(v) && v !== old.custom?.[f.id]) fail(`Choose a value for ${f.label}`);
    }
    for (const key of ['reference','billNumber','orderNumber','notes','terms','address','email','bankName','accountNumber','accountHolder','branch','ifsc','sku','description']) {
      if (data[key] != null && (typeof data[key] !== 'string' || data[key].length > 5000)) fail(`${key} is too long`);
    }
    if (data.dueDate && !isDate(data.dueDate)) fail('Due date is not valid');
    if (!Array.isArray(data.attachments || []) || (data.attachments || []).length > 10) fail('Attach up to 10 files');
    data.attachments = [...new Set(data.attachments || [])];
    for (const fileId of data.attachments) {
      const file = q('SELECT scope,record_id FROM local_files WHERE id=?').get(fileId);
      if (!file) fail('An attachment is missing; choose the file again');
      if (file.record_id != null && (file.scope !== scope || file.record_id !== data._recordId)) fail('This attachment belongs to another record');
    }
    return data;
  }
  function save(scope,id,value) {
    const old = recordDetails({ scope,id });
    const data = validate(scope,{ ...value,_recordId:id },old);
    delete data._recordId;
    if(scope==='item'&&data.sku){
      data.sku=data.sku.trim();
      if(data.sku.length>100)fail('SKU / barcode must be up to 100 characters');
      if(q("SELECT record_id FROM record_details WHERE scope='item' AND record_id<>? AND json_extract(value,'$.sku')=? COLLATE NOCASE").get(id,data.sku))fail('An item already uses this SKU / barcode');
    }
    q('INSERT INTO record_details(scope,record_id,value) VALUES(?,?,?) ON CONFLICT(scope,record_id) DO UPDATE SET value=excluded.value').run(scope,id,JSON.stringify(data));
    for (const fileId of data.attachments) q('UPDATE local_files SET scope=?,record_id=? WHERE id=?').run(scope,id,fileId);
    for (const fileId of old.attachments || []) if (!data.attachments.includes(fileId)) q('DELETE FROM local_files WHERE id=? AND scope=? AND record_id=?').run(fileId,scope,id);
    return data;
  }
  function remove(scope,id) {
    q('DELETE FROM record_details WHERE scope=? AND record_id=?').run(scope,id);
    q('DELETE FROM local_files WHERE scope=? AND record_id=?').run(scope,id);
  }
  function importFile({ name, bytes }) {
    bytes = Buffer.from(bytes);
    if (!bytes.length || bytes.length > 10*1024*1024) fail('Each file must be between 1 byte and 10 MB');
    let mime;
    if (bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) mime = 'image/png';
    else if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) mime = 'image/jpeg';
    else if (bytes.toString('ascii',0,4) === 'RIFF' && bytes.toString('ascii',8,12) === 'WEBP') mime = 'image/webp';
    else if (bytes.toString('ascii',0,5) === '%PDF-') mime = 'application/pdf';
    else fail('Choose a PNG, JPEG, WebP image or PDF');
    const pending = q('SELECT COALESCE(SUM(length(bytes)),0) AS size FROM local_files WHERE record_id IS NULL').get().size;
    if (pending + bytes.length > 100*1024*1024) fail('Unsaved attachments exceed 100 MB. Save or discard the open forms first.');
    const id = randomUUID();
    name = String(name).split(/[\\/]/).pop().slice(0,180);
    q('INSERT INTO local_files(id,name,mime,bytes,created_at) VALUES(?,?,?,?,?)').run(id,name,mime,bytes,new Date().toISOString());
    return fileInfo({ id });
  }
  function fileInfo({ id }) {
    const row = q('SELECT id,name,mime,bytes FROM local_files WHERE id=?').get(id);
    if (!row) fail('File not found');
    return { id:row.id,name:row.name,mime:row.mime,size:row.bytes.length,preview:row.mime.startsWith('image/') ? `data:${row.mime};base64,${Buffer.from(row.bytes).toString('base64')}` : '' };
  }
  return {
    deleteField({id}){
      if(!q('SELECT id FROM custom_fields WHERE id=?').get(id))fail('Field not found');
      for(const row of q('SELECT value FROM record_details').all()){const value=JSON.parse(row.value).custom?.[id];if(value!==undefined&&value!==null&&value!=='')fail('This field has saved values. Deactivate it instead of deleting it.');}
      q('DELETE FROM custom_fields WHERE id=?').run(id);return {id};
    },
    settings, saveSettings, fields, saveField, recordDetails, validate, save, remove, importFile, fileInfo,
    fileBytes(id) { return q('SELECT name,mime,bytes FROM local_files WHERE id=?').get(id) || fail('File not found'); },
    discardFiles({ ids }) {
      if (!Array.isArray(ids) || ids.length > 10) fail('Invalid attachment list');
      ids.forEach(id => q('DELETE FROM local_files WHERE id=? AND record_id IS NULL').run(id));
    },
  };
};
