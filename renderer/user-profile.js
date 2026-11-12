import {h,call,labelled,formKeys,parseDate,showDate,toast,confirmBox} from './ui.js';
import {pop} from './router.js';
export function greetingText(name='',date=new Date()){
 const hour=date.getHours(),greeting=hour<12?'Good morning':hour<17?'Good afternoon':'Good evening';
 return name?.trim()?`${greeting}, ${name.trim()}`:greeting;
}
export function userProfileForm(){
 let original='',loaded=false;
 const fields={name:h('input',{maxLength:120,'aria-label':'Your name',autocomplete:'name'}),dateOfBirth:h('input',{placeholder:'dd-mm-yyyy','aria-label':'Date of birth',autocomplete:'bday'}),email:h('input',{maxLength:254,'aria-label':'Email',autocomplete:'email'}),phone:h('input',{maxLength:40,'aria-label':'Phone',autocomplete:'tel'}),designation:h('input',{maxLength:120,'aria-label':'Designation'})};
 const labels={name:'Your name *',dateOfBirth:'Date of birth',email:'Email',phone:'Phone',designation:'Designation / role'};
 const snapshot=()=>JSON.stringify(Object.fromEntries(Object.entries(fields).map(([k,v])=>[k,v.value])));
 async function save(){try{const values=Object.fromEntries(Object.entries(fields).map(([k,v])=>[k,v.value.trim()]));if(values.dateOfBirth){const date=parseDate(values.dateOfBirth);if(!date)throw Error('Enter a valid date of birth');values.dateOfBirth=date;}await call('saveUserProfile',values);original=snapshot();toast('User profile saved');pop();}catch(e){toast(e.message,'error');}}
 const canLeave=async()=>snapshot()===original||await confirmBox('Leave without saving your profile?');
 return {title:'User profile',el:h('section',{class:'form user-profile-form'},h('h2',{},'Your profile'),h('p',{class:'tip'},'Personalise your dashboard greeting. Only your name is required.'),...Object.entries(fields).map(([k,v])=>labelled(labels[k],v)),h('button',{onclick:save},'Save profile - Ctrl+S')),hints:[['Enter / Tab','Next field'],['Ctrl+S','Save profile'],['Esc','Back']],canLeave,async onShow(){if(!loaded){const values=await call('userProfile');for(const [k,v]of Object.entries(fields))v.value=k==='dateOfBirth'&&values[k]?showDate(values[k]):values[k]||'';original=snapshot();loaded=true;}fields.name.focus();},onKey:formKeys(Object.values(fields),save)};
}
