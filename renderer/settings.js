import {yesNo} from './yes-no.js';
import { h, call, labelled, toast, mod, createList, confirmBox } from './ui.js';
import { push, pop } from './router.js';

const flagLabels = { useCalculator:'Use calculator (Ctrl+Shift+C)', documentDetails:'Document references, dates and notes',lineDiscount:'Line discount and description',attachments:'Images and PDF attachments',customFields:'Additional custom fields',roundOff:'Round document totals to nearest rupee',dropdownMasters:'Show Dropdowns in Masters' };
export function formSettings() {
  let savedValues='',loaded=false;
  const flags = Object.fromEntries(Object.keys(flagLabels).map(key => [key,yesNo()]));
  const terms = h('textarea',{ rows:4,maxLength:5000 });
  const days = h('input',{ type:'number',min:0,max:3650 });
  const values=()=>({ ...Object.fromEntries(Object.entries(flags).map(([key,input]) => [key,input.checked])),defaultTerms:terms.value,defaultCreditDays:Number(days.value) });
  const el = h('section',{ class:'form settings-form' },
    h('h2',{},'Forms & features'),h('p',{ class:'tip' },'These preferences apply to local books on this computer. Existing saved values are retained when a section is hidden.'),
    ...Object.entries(flagLabels).map(([key,label]) => labelled(label,flags[key])),
    labelled('Default credit days',days),labelled('Default terms',terms),
    h('div',{ class:'register-actions' },h('button',{ onclick:save },'Save settings (Ctrl+S)'),h('button',{ onclick:() => push(customFieldList()) },'Manage additional fields (Alt+F)')),
    h('p',{ class:'tip' },'Attachments: PNG, JPEG, WebP or PDF, up to 10 MB each. Files and additional fields stay local; the Tally connector does not transfer them. Required custom fields remain visible.'));
  async function save() {
    try { const saving=values();await call('saveSettings',saving);savedValues=JSON.stringify(saving); toast('Local settings saved'); }
    catch (e) { toast(e.message,'error'); }
  }
  const canLeave=()=>JSON.stringify(values())===savedValues||confirmBox('Leave without saving these settings?');
  return { title:'Forms & feature settings',el,canLeave,hints:[['Ctrl+S','Save'],['Alt+F','Additional fields'],['Y / N / arrows','Toggle'],['Esc','Back']],
    async onShow() { if(!loaded){const settings = await call('settings'); for (const [key,input] of Object.entries(flags)) input.checked=settings[key]; terms.value=settings.defaultTerms; days.value=settings.defaultCreditDays;savedValues=JSON.stringify(values());loaded=true;} Object.values(flags)[0].focus(); },
    onKey(e) { if (mod(e) && e.code==='KeyS') save(); else if(e.altKey && e.code==='KeyF') push(customFieldList());else if(e.key==='Escape')Promise.resolve(canLeave()).then(ok=>{if(ok)pop();}); else return false; e.preventDefault();return true; },
  };
}
export function customFieldList() {
  const list = createList({ filter:true,empty:'No additional fields. Alt+C creates one.',columns:[
    {label:'Field',get:r=>r.label},{label:'Used on',get:r=>r.scope},{label:'Type',get:r=>r.kind},
    {label:'Required',get:r=>r.required?'Yes':'No'},{label:'Status',get:r=>r.active?'Active':'Inactive'},
  ],onEnter:r=>push(fieldForm(r)) });
  return { title:'Additional fields',el:list.el,hints:[['Alt+C','Create field'],['Enter','Edit / deactivate'],['Esc','Back']],
    async onShow(){list.setRows(await call('customFields'));list.focus();},
    onKey(e){if(e.altKey&&e.code==='KeyC'){e.preventDefault();push(fieldForm());return true;}return list.onKey(e);},
  };
}
export function fieldForm(field,preset={}) {
  const select = values => h('select',{},...values.map(v=>h('option',{value:v},v)));
  const scope=select(['document','item','ledger']),kind=select(['text','number','date','select','boolean']);
  scope.value=field?.scope||preset.scope||'document';kind.value=field?.kind||preset.kind||'text';scope.disabled=Boolean(field||preset.scope);kind.disabled=Boolean(field||preset.kind);
  const label=h('input',{value:field?.label||'',maxLength:80});
  const required=h('input',{type:'checkbox',checked:Boolean(field?.required)}),active=h('input',{type:'checkbox',checked:field?Boolean(field.active):true});
  const options=h('textarea',{rows:3,value:(field?.options||[]).join('\n')}),position=h('input',{type:'number',min:0,max:999,value:field?.position||0});
  const el=h('section',{class:'form'},labelled('Used on',scope),labelled('Label',label),labelled('Type',kind),labelled('Required',required),labelled('Active',active),labelled('Choices (one per line)',options),labelled('Display order',position),h('button',{onclick:save},'Save field (Ctrl+S)'),h('p',{class:'tip'},'Deactivate fields instead of deleting them. Saved values remain available. Required fields are validated when saving a record.'));
  async function save(){try{await call('saveCustomField',{id:field?.id,scope:scope.value,label:label.value,kind:kind.value,required:required.checked,active:active.checked,options:options.value.split('\n').map(s=>s.trim()).filter(Boolean),position:Number(position.value)});toast('Additional field saved');pop();}catch(e){toast(e.message,'error');}}
  return {title:field?'Edit additional field':'Create additional field',el,hints:[['Ctrl+S','Save'],['Tab','Next field'],['Esc','Back']],onShow(){label.focus();},onKey(e){if(mod(e)&&e.code==='KeyS'){e.preventDefault();save();return true;}return false;}};
}
