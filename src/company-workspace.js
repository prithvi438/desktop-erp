'use strict';
const fs=require('node:fs'),path=require('node:path'),{randomUUID}=require('node:crypto');
const {BooksError}=require('./books');
const valid=d=>typeof d==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(d)&&!Number.isNaN(Date.parse(d))&&new Date(d).toISOString().slice(0,10)===d;
const yearOf=d=>{const y=Number(d.slice(0,4))-(d.slice(5,7)<'04'?1:0);return {id:String(y),name:`${y}–${y+1}`,from:`${y}-04-01`,to:`${y+1}-03-31`};};
function fiscal(api,db){
 const get=()=>{const saved=db.prepare("SELECT value FROM meta WHERE key='financial_years'").get();if(saved)return JSON.parse(saved.value);const now=new Date().toISOString().slice(0,10),current=yearOf(now),years=new Map([[current.id,current]]);for(const row of db.prepare('SELECT DISTINCT date FROM vouchers').all()){const y=yearOf(row.date);years.set(y.id,y);}return {years:[...years.values()].sort((a,b)=>a.from.localeCompare(b.from)),selected:current.id};};
 const save=value=>db.prepare("INSERT INTO meta(key,value) VALUES('financial_years',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(JSON.stringify(value));
 return {financialYearState(){const state=get();return {...state,active:state.years.find(y=>y.id===state.selected)};},
  createFinancialYear({name,from,to}){if(!valid(from)||!valid(to)||from>to||(Date.parse(to)-Date.parse(from))/86400000>365)throw new BooksError('Enter a financial year of up to 366 days with valid From and To dates');const s=get();if(s.years.some(y=>from<=y.to&&to>=y.from))throw new BooksError('This financial year overlaps an existing year');const y={id:randomUUID(),name:String(name||`${from} to ${to}`).trim().slice(0,100),from,to};s.years.push(y);s.years.sort((a,b)=>a.from.localeCompare(b.from));save(s);return y;},
  selectFinancialYear({id}){const s=get();if(!s.years.some(y=>y.id===id))throw new BooksError('Financial year not found');s.selected=id;delete s.period;save(s);return s;},
  setReportingPeriod({from,to}){if(!valid(from)||!valid(to)||from>to)throw new BooksError('Choose a valid reporting period');const s=get();s.period={from,to};save(s);return s;},
 };
}
function companyWorkspace(root,open){
 const file=path.join(root,'companies.json');let index;
 if(fs.existsSync(file)){index=JSON.parse(fs.readFileSync(file,'utf8'));if(index.version!==1||!Array.isArray(index.companies)||!index.companies.some(c=>c.id===index.active))throw Error('Invalid company index. Restore companies.json from backup.');}
 else index={version:1,active:'legacy',companies:[{id:'legacy',name:'Existing company'}]};
 const directory=id=>{if(id==='legacy')return root;if(!/^[a-f0-9-]{36}$/.test(id))throw new BooksError('Invalid company identifier');return path.join(root,'companies',id);};
 const persist=next=>{const tmp=file+'.tmp';fs.writeFileSync(tmp,JSON.stringify(next,null,2));fs.renameSync(tmp,file);index=next;};
 let books=open(directory(index.active));index.companies.find(c=>c.id===index.active).name=books.api.company().name;persist(index);
 return {get books(){return books;},get directory(){return directory(index.active);},
  list(){return {active:index.active,companies:index.companies.map(c=>({...c,name:c.id===index.active?books.api.company().name:c.name}))};},
  create({name}){name=String(name||'').trim();if(!name||name.length>120)throw new BooksError('Enter a company name of up to 120 characters');if(index.companies.some(c=>c.name.toLowerCase()===name.toLowerCase()))throw new BooksError('A company with that name already exists');const id=randomUUID(),dir=directory(id);fs.mkdirSync(dir,{recursive:true});const created=open(dir);try{created.api.setCompany({...created.api.company(),name});persist({...index,companies:[...index.companies,{id,name}]});}finally{created.close();}return {id,name};},
  select({id}){if(!index.companies.some(c=>c.id===id))throw new BooksError('Company not found');if(id===index.active)return;const next=open(directory(id));try{persist({...index,active:id,companies:index.companies.map(c=>c.id===index.active?{...c,name:books.api.company().name}:c)});}catch(error){next.close();throw error;}const old=books;books=next;old.close();},
  reopen(){books.close();books=open(directory(index.active));return books;},
 };
}
module.exports={companyWorkspace,fiscal};
