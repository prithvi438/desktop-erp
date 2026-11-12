'use strict';

const frameworks={noncompany:'Non-company · ICAI presentation',llp:'LLP · ICAI presentation',division1:'Company · Schedule III Division I (AS)',division2:'Company · Schedule III Division II (Ind AS)'};
// Presentation mappings never change ledger postings or their accounting nature.
const buckets=[
 ['capital','Capital / share capital','equity'],['reserves','Reserves / other equity','equity'],['sharePending','Share application money pending allotment','equity'],
 ['longBorrowings','Non-current borrowings','ncl'],['deferredTaxLiability','Deferred tax liabilities (net)','ncl'],['longProvisions','Non-current provisions','ncl'],['longOther','Other non-current liabilities','ncl'],
 ['shortBorrowings','Current borrowings','cl'],['payablesMSME','Trade payables — micro and small enterprises','cl'],['payables','Trade payables — other creditors','cl'],['shortProvisions','Current provisions','cl'],['taxLiability','Current tax liabilities (net)','cl'],['shortOther','Other current liabilities','cl'],
 ['ppe','Property, plant and equipment','nca'],['cwip','Capital work-in-progress','nca'],['investmentProperty','Investment property','nca'],['goodwill','Goodwill','nca'],['intangibles','Intangible assets','nca'],['intangiblesDevelopment','Intangible assets under development','nca'],['longInvestments','Non-current investments','nca'],['longLoans','Non-current loans and advances','nca'],['deferredTaxAsset','Deferred tax assets (net)','nca'],['longFinancial','Other non-current financial assets','nca'],['longAssets','Other non-current assets','nca'],
 ['inventory','Inventories','ca'],['shortInvestments','Current investments','ca'],['receivables','Trade receivables','ca'],['cash','Cash and cash equivalents','ca'],['otherBank','Other bank balances','ca'],['shortLoans','Current loans and advances','ca'],['shortFinancial','Other current financial assets','ca'],['taxAsset','Current tax assets (net)','ca'],['shortAssets','Other current assets','ca'],
 ['revenue','Revenue from operations','income'],['otherIncome','Other income','income'],['materials','Cost of materials consumed','expense'],['purchases','Purchases of stock-in-trade','expense'],['employee','Employee benefits expense','expense'],['finance','Finance costs','expense'],['depreciation','Depreciation and amortisation expense','expense'],['otherExpense','Other expenses','expense'],['exceptional','Exceptional items (net expense)','expense'],['currentTax','Current income tax expense','expense'],['deferredTax','Deferred income tax expense','expense'],['discontinued','Profit / (loss) from discontinued operations, net of tax','income'],['ociNoRecycle','Other comprehensive income — not reclassified to profit or loss, net of tax','income'],['ociRecycle','Other comprehensive income — reclassified to profit or loss, net of tax','income'],
];
const byKey=new Map(buckets.map(([key,label,section])=>[key,{key,label,section}]));
module.exports=function reporting({db,BooksError,statements,ledgers,groups,company,isDate}){
 const q=sql=>db.prepare(sql),fail=message=>{throw new BooksError(message);};
 function settings(){const result={framework:'noncompany',unit:'rupees',notes:'',mappings:{},...JSON.parse(q("SELECT value FROM meta WHERE key='reporting_settings'").get()?.value||'{}')};for(const id of Object.keys(result.mappings))if(!q('SELECT id FROM ledgers WHERE id=?').get(Number(id)))delete result.mappings[id];return result;}
 function saveSettings(values){
  const next={...settings(),...values};
  if(!Object.hasOwn(frameworks,next.framework))fail('Choose a reporting framework');
  if(!['rupees','thousands','lakhs','millions'].includes(next.unit))fail('Choose a reporting unit');
  if(typeof next.notes!=='string'||next.notes.length>30000)fail('Notes must be text up to 30,000 characters');
  if(!next.mappings||typeof next.mappings!=='object'||Array.isArray(next.mappings))fail('Invalid reporting mappings');
  const accounts=new Map(ledgers().map(row=>[String(row.id),row]));
  for(const [id,key]of Object.entries(next.mappings)){
   const ledger=accounts.get(id),bucket=byKey.get(key);if(!ledger||!bucket)fail('Choose a valid ledger and reporting heading');
   const isPL=['income','expense'].includes(ledger.nature),isPLBucket=['income','expense'].includes(bucket.section);
   if(isPL!==isPLBucket)fail('Balance-sheet ledgers cannot be mapped to income / expense headings, or vice versa');
  }
  q("INSERT INTO meta(key,value) VALUES('reporting_settings',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(JSON.stringify({framework:next.framework,unit:next.unit,notes:next.notes,mappings:next.mappings}));return settings();
 }
 function inferred(row,tree){
  const path=[];let group=tree.get(row.groupId);while(group){path.push(group.name);group=tree.get(group.parentId);}
  const has=name=>path.includes(name);
  if(row.nature==='income')return has('Sales Accounts')||has('Direct Incomes')?'revenue':'otherIncome';
  if(row.nature==='expense')return has('Purchase Accounts')?'purchases':'otherExpense';
  if(has('Sundry Debtors'))return row.balance<0?'shortOther':'receivables';
  if(has('Sundry Creditors'))return row.balance>0?'shortAssets':'payables';
  if(has('Cash-in-Hand')||has('Bank Accounts'))return row.balance<0?'shortBorrowings':'cash';
  if(has('Bank OD A/c'))return row.balance>0?'cash':'shortBorrowings';
  if(has('Duties & Taxes'))return row.balance>0?'shortAssets':'shortOther';
  if(has('Reserves & Surplus'))return 'reserves';if(has('Capital Account'))return 'capital';
  if(has('Loans (Liability)'))return 'longBorrowings';if(has('Provisions'))return 'shortProvisions';
  if(has('Fixed Assets'))return 'ppe';if(has('Investments'))return 'longInvestments';if(has('Stock-in-Hand'))return 'inventory';
  if(has('Loans & Advances (Asset)'))return 'shortLoans';return row.nature==='asset'?'shortAssets':'shortOther';
 }
 function mappingRows(){const config=settings(),tree=new Map(groups().map(row=>[row.id,row]));return ledgers().map(row=>({...row,key:config.mappings[row.id]||inferred(row,tree),automatic:!config.mappings[row.id]}));}
 const previousDate=value=>{const [year,month,day]=value.split('-').map(Number),last=new Date(Date.UTC(year-1,month,0)).getUTCDate();return `${year-1}-${String(month).padStart(2,'0')}-${String(Math.min(day,last)).padStart(2,'0')}`;};
 function financialReport({type='balanceSheet',asOf,from,framework}={}){
  if(!isDate(asOf))fail('Choose a valid reporting date');
  if(!['balanceSheet','profitLoss','trialBalance','trading'].includes(type))fail('Unknown financial report');
  const config=settings();if(framework){if(!frameworks[framework])fail('Choose a reporting framework');config.framework=framework;}
  const ranged=['profitLoss','trading'].includes(type);
  if(ranged&&from&&(!isDate(from)||from>asOf))fail('Choose a valid reporting period');
  const current=statements({asOf,...(ranged&&from?{from}:{})}),prior=statements({asOf:type==='balanceSheet'?new Date(Date.parse(current.from+'T00:00:00Z')-86400000).toISOString().slice(0,10):previousDate(asOf),...(ranged&&from?{from:previousDate(from)}:{})}),tree=new Map(groups().map(row=>[row.id,row]));
  const prepare=s=>{const result=new Map(buckets.map(([key])=>[key,{value:0,ledgers:[]} ]));
   for(const row of s.ledgers){const key=config.mappings[row.ledgerId]||inferred(row,tree),bucket=byKey.get(key),isPL=['income','expense'].includes(bucket.section);if(isPL!==['income','expense'].includes(row.nature))fail('Review the reporting mapping for '+row.name+' after its account group changed');const amount=(isPL?row.period:row.balance)*(['income','equity','ncl','cl'].includes(bucket.section)?-1:1);result.get(key).value+=amount;result.get(key).ledgers.push({...row,amount});}
   result.get('inventory').value+=s.closingStock;result.get('reserves').value+=s.broughtForward+s.netProfit;return result;};
  const a=prepare(current),b=prepare(prior),rows=[],notes=[];let note=0;
  const value=(key,side=a)=>side.get(key).value;
  const total=(keys,side=a)=>keys.reduce((n,key)=>n+value(key,side),0);
  const add=(kind,name,amount=null,previous=null,extra={})=>rows.push({kind,name,amount,previous,...extra});
  function heading(key,label){const item=byKey.get(key),ref=String(++note);add('head',label||item.label,value(key),value(key,b),{note:ref});
   const all=new Map([...a.get(key).ledgers,...b.get(key).ledgers].map(row=>[row.ledgerId,row]));
   for(const row of all.values())add('sub',row.name,a.get(key).ledgers.find(r=>r.ledgerId===row.ledgerId)?.amount||0,b.get(key).ledgers.find(r=>r.ledgerId===row.ledgerId)?.amount||0,{ledgerId:row.ledgerId});
   if(key==='inventory')add('sub','Inventory valuation from stock records',current.closingStock,prior.closingStock);
   if(key==='reserves')add('sub','Accumulated results computed from books',current.broughtForward+current.netProfit,prior.broughtForward+prior.netProfit);
   notes.push(`${ref}. ${label||item.label}: see the supporting ledger detail. Classification and required disclosures must be reviewed.`);
  }
  const section=(key,label)=>{add('section',label);const keys=buckets.filter(row=>row[2]===key).map(row=>row[0]);for(const k of keys)heading(k,k==='sharePending'&&['noncompany','llp'].includes(config.framework)?'Capital contributions pending allocation':k==='capital'?(config.framework==='noncompany'?"Owner’s / partners’ capital":config.framework==='llp'?"Partners’ contribution":'Share capital'):k==='reserves'?(config.framework==='division2'?'Other equity':'Reserves and surplus'):null);add('total',`Total ${label.toLowerCase()}`,total(keys),total(keys,b));return keys;};
  const warnings=['Draft presentation from books. Review classifications, accounting policies, valuation and disclosures before statutory use.'];
  if(mappingRows().some(row=>row.automatic&&row.balance))warnings.push('Some ledger classifications are inferred. Review them in Settings → Financial reporting.');
  if(current.openingDifference){const openings=ledgers().filter(l=>l.opening);const fmt=n=>(Math.abs(n)/100).toFixed(2)+(n<0?' Cr':' Dr');warnings.push('Opening balance mismatch: INR '+fmt(current.openingDifference)+'. Opening balances: '+openings.slice(0,6).map(l=>l.name+' INR '+fmt(l.opening)).join('; ')+(openings.length>6?'; further balances available in the opening review':'')+'. Review the opening amounts and their corresponding ledger balances; no balancing entry has been invented.');}
  if(type==='trialBalance'){
   for(const row of current.ledgers){const old=prior.ledgers.find(l=>l.ledgerId===row.ledgerId);add('sub',row.name,null,null,{ledgerId:row.ledgerId,group:row.groupName,debit:Math.max(0,row.balance),credit:Math.max(0,-row.balance),priorDebit:Math.max(0,old?.balance||0),priorCredit:Math.max(0,-(old?.balance||0))});}
   for(const row of prior.ledgers.filter(row=>!current.ledgers.some(r=>r.ledgerId===row.ledgerId)))add('sub',row.name,null,null,{ledgerId:row.ledgerId,group:row.groupName,debit:0,credit:0,priorDebit:Math.max(0,row.balance),priorCredit:Math.max(0,-row.balance)});
   add('total','Total',null,null,{debit:current.debit,credit:current.credit,priorDebit:prior.debit,priorCredit:prior.credit});
   add(current.debit===current.credit?'head':'bad',current.openingDifference&&current.debit-current.credit===current.openingDifference?'Difference in opening balances':'Difference (debit less credit)',current.debit-current.credit,prior.debit-prior.credit);
  }else if(type==='balanceSheet'){
   const assets=()=>{add('section','ASSETS');const keys=[...section('nca','Non-current assets'),...section('ca','Current assets')];add('total','TOTAL ASSETS',total(keys),total(keys,b));return total(keys);};
   const liabilities=()=>{add('section','EQUITY AND LIABILITIES');const keys=[...section('equity','Equity / capital funds'),...section('ncl','Non-current liabilities'),...section('cl','Current liabilities')];add('total','TOTAL EQUITY AND LIABILITIES',total(keys),total(keys,b));return total(keys);};
   let av,lv;if(config.framework==='division2'){av=assets();lv=liabilities();}else{lv=liabilities();av=assets();}
   const difference=av-lv;if(difference)add('bad','Unreconciled difference — not a balancing entry',difference,prior.openingDifference);
   if(value('inventory')!==current.closingStock)warnings.push('Inventory contains both ledger balances and stock valuation. Review for duplicate stock recognition.');
  }else if(type==='trading'){
   const of=(s,key)=>s.byPrimary[key]||0;
   const display=(name,get,primary)=>{add('head',name,get(current),get(prior));if(primary){const all=new Map([...current.ledgers,...prior.ledgers].filter(row=>row.primary===primary).map(row=>[row.ledgerId,row]));for(const row of all.values()){const sign=row.nature==='income'?-1:1;add('sub',row.name,(current.ledgers.find(r=>r.ledgerId===row.ledgerId)?.period||0)*sign,(prior.ledgers.find(r=>r.ledgerId===row.ledgerId)?.period||0)*sign,{ledgerId:row.ledgerId});}}};
   add('section','REVENUE');display('Net sales',s=>-of(s,'Sales Accounts'),'Sales Accounts');display('Direct income',s=>-of(s,'Direct Incomes'),'Direct Incomes');
   add('section','COST OF GOODS SOLD');display('Opening inventories',s=>s.openingStock);display('Net purchases',s=>of(s,'Purchase Accounts'),'Purchase Accounts');display('Direct expenses',s=>of(s,'Direct Expenses'),'Direct Expenses');display('Less: closing inventories',s=>-s.closingStock);
   const cost=s=>s.openingStock+of(s,'Purchase Accounts')+of(s,'Direct Expenses')-s.closingStock;
   add('total','Cost of goods sold',cost(current),cost(prior));add('total','Gross profit / (loss)',-of(current,'Sales Accounts')-of(current,'Direct Incomes')-cost(current),-of(prior,'Sales Accounts')-of(prior,'Direct Incomes')-cost(prior));
   warnings.push('Trading account is a supporting schedule; it does not replace the statement of profit and loss.');
  }else{
   const income=['revenue','otherIncome'],expenses=['materials','purchases','employee','finance','depreciation','otherExpense'];
   const changes=current.openingStock-current.closingStock,priorChanges=prior.openingStock-prior.closingStock;
   const profit=side=>total(income,side)-total(expenses,side)-(side===a?changes:priorChanges)-value('exceptional',side)-value('currentTax',side)-value('deferredTax',side)+value('discontinued',side);
   add('section','INCOME');income.forEach(key=>heading(key));add('total','Total income',total(income),total(income,b));
   add('section','EXPENSES');heading('materials');heading('purchases');add('head','Changes in inventories',changes,priorChanges);expenses.slice(2).forEach(key=>heading(key));
   add('total','Total expenses',total(expenses)+changes,total(expenses,b)+priorChanges);
   add('total','Profit / (loss) before exceptional items and tax',total(income)-total(expenses)-changes,total(income,b)-total(expenses,b)-priorChanges);heading('exceptional');
   add('total','Profit / (loss) before tax',profit(a)+value('currentTax')+value('deferredTax')-value('discontinued'),profit(b)+value('currentTax',b)+value('deferredTax',b)-value('discontinued',b));
   heading('currentTax');heading('deferredTax');heading('discontinued');add('total','Profit / (loss) for the period',profit(a),profit(b));
   if(config.framework==='division2'){add('section','OTHER COMPREHENSIVE INCOME');heading('ociNoRecycle');heading('ociRecycle');add('total','Total comprehensive income',profit(a)+value('ociNoRecycle')+value('ociRecycle'),profit(b)+value('ociNoRecycle',b)+value('ociRecycle',b));warnings.push('OCI requires explicit ledger mapping. Equity movement and other Ind AS disclosures are not inferred.');}
   if(['division1','division2'].includes(config.framework)){add('head','Basic earnings per share — share data not provided');add('head','Diluted earnings per share — share data not provided');warnings.push('EPS and statutory notes require additional share, tax and disclosure information. Blank figures mean not provided, not zero.');}
  }
  return {type,title:{balanceSheet:'Balance sheet',profitLoss:'Statement of profit and loss',trialBalance:'Trial balance',trading:'Trading account'}[type],company:company(),framework:config.framework,frameworkLabel:frameworks[config.framework],unit:config.unit,asOf,from:current.from,priorAsOf:prior.asOf,priorFrom:prior.from,rows,warnings,notes:[config.notes,...notes].filter(Boolean).join('\n\n')};
 }
 return {reportingSettings:settings,saveReportingSettings:saveSettings,reportingOptions:()=>({frameworks,buckets:buckets.map(([key,label,section])=>({key,label,section})),ledgers:mappingRows()}),financialReport};
};
