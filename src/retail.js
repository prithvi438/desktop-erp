'use strict';

// Retail controls and bill matching use integer paise and thousandths of a unit,
// just like the books engine. Allocations link postings; they never post twice.
module.exports=function retail({db,BooksError,tx,isDate,ledgers,items,today}){
  let referenceProvider=null;
  const q=sql=>db.prepare(sql),fail=message=>{throw new BooksError(message);};
  const integer=(value,label,max=Number.MAX_SAFE_INTEGER)=>{if(!Number.isSafeInteger(value)||value<0||value>max)fail(`${label} is outside the supported range`);};
  const addDays=(date,days)=>new Date(Date.parse(`${date}T00:00:00Z`)+days*86400000).toISOString().slice(0,10);
  function controls(){return {lockedThrough:'',blockExpiredSales:false,...JSON.parse(q("SELECT value FROM meta WHERE key='retail_controls'").get()?.value||'{}')};}
  function saveControls({lockedThrough='',blockExpiredSales=false}){
    if(lockedThrough&&!isDate(lockedThrough))fail('Enter a valid lock date');
    if(typeof blockExpiredSales!=='boolean')fail('Expiry protection must be on or off');
    q("INSERT INTO meta(key,value) VALUES('retail_controls',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(JSON.stringify({lockedThrough,blockExpiredSales}));
    return controls();
  }
  function checkDates(...dates){const lock=controls().lockedThrough;if(lock&&dates.some(date=>date&&date<=lock))fail(`Transactions through ${lock} are locked. Change the lock date in Retail controls before altering these books.`);}
  function ledgerPolicy(id){return {...(q('SELECT credit_limit AS creditLimit,stop_sales AS stopSales,pricebook_id AS pricebookId FROM ledger_policy WHERE ledger_id=?').get(id)||{creditLimit:0,stopSales:0,pricebookId:null}),blockOverdue:q('SELECT value FROM meta WHERE key=?').get('block_overdue_'+id)?.value==='true'};}
  function saveLedgerPolicy(id,{creditLimit=0,stopSales=false,pricebookId=null,blockOverdue=false}){
    integer(creditLimit,'Credit limit');if(typeof stopSales!=='boolean')fail('Stop billing must be on or off');
    if(pricebookId&&!q('SELECT 1 FROM pricebooks WHERE id=?').get(pricebookId))fail('Choose a valid pricebook');
    q('INSERT INTO ledger_policy(ledger_id,credit_limit,stop_sales,pricebook_id) VALUES(?,?,?,?) ON CONFLICT(ledger_id) DO UPDATE SET credit_limit=excluded.credit_limit,stop_sales=excluded.stop_sales,pricebook_id=excluded.pricebook_id').run(id,creditLimit,Number(stopSales),pricebookId||null);
    if(typeof blockOverdue!=='boolean')fail('Overdue credit protection must be on or off');
    q("INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run('block_overdue_'+id,JSON.stringify(blockOverdue));
  }
  function itemPolicy(id){return q('SELECT max_discount AS maxDiscount,max_qty AS maxQty,stop_sales AS stopSales,rack FROM item_policy WHERE item_id=?').get(id)||{maxDiscount:10000,maxQty:0,stopSales:0,rack:''};}
  function saveItemPolicy(id,{maxDiscount=10000,maxQty=0,stopSales=false,rack=''}){
    integer(maxDiscount,'Maximum discount',10000);integer(maxQty,'Maximum bill quantity');
    if(typeof stopSales!=='boolean')fail('Stop item billing must be on or off');
    if(typeof rack!=='string'||rack.length>80)fail('Rack must be up to 80 characters');
    q('INSERT INTO item_policy(item_id,max_discount,max_qty,stop_sales,rack) VALUES(?,?,?,?,?) ON CONFLICT(item_id) DO UPDATE SET max_discount=excluded.max_discount,max_qty=excluded.max_qty,stop_sales=excluded.stop_sales,rack=excluded.rack').run(id,maxDiscount,maxQty,Number(stopSales),rack.trim());
  }
  function checkSale({id,type,partyId,total,rows,date}){
    if(!['Sales','Sales Order'].includes(type))return;
    const party=ledgers().find(row=>row.id===partyId),policy=ledgerPolicy(partyId);
    if(policy.stopSales)fail(`Billing is stopped for ${party.name}. Change its ledger billing controls first.`);
    if(policy.blockOverdue&&party.accountGroup==='Sundry Debtors'&&referenceProvider){const due=referenceProvider({partyId,asOf:date,excludeVoucherId:id});if(due.overdue>0)fail(`Overdue bills remain for ${party.name}. Settle them or change the ledger overdue credit control before billing.`);}
    if(policy.creditLimit&&party.accountGroup==='Sundry Debtors'){
      const old=id?q('SELECT COALESCE(SUM(amount),0) AS amount FROM entries WHERE voucher_id=? AND ledger_id=?').get(id,partyId).amount:0;
      if(party.balance-old+total>policy.creditLimit)fail(`Credit limit exceeded for ${party.name}. Limit ${(policy.creditLimit/100).toFixed(2)}, proposed balance ${((party.balance-old+total)/100).toFixed(2)}.`);
    }
    const quantities=new Map(),expiryBlock=controls().blockExpiredSales;
    for(const row of rows){
      const policy=itemPolicy(row.itemId),name=q('SELECT name FROM items WHERE id=?').get(row.itemId)?.name;
      if(policy.stopSales)fail(`Billing is stopped for ${name}`);
      if(row.discountPct>policy.maxDiscount)fail(`Discount exceeds the permitted ${(policy.maxDiscount/100).toFixed(2)}% for ${name}`);
      quantities.set(row.itemId,(quantities.get(row.itemId)||0)+row.qty);
      if(policy.maxQty&&quantities.get(row.itemId)>policy.maxQty)fail(`Bill quantity exceeds the permitted ${policy.maxQty/1000} for ${name}`);
      if(type==='Sales'&&expiryBlock){
        // Validate persisted batch expiry too: an altered field cannot bypass the rule.
        const expired=q("SELECT 1 FROM stock_moves WHERE item_id=? AND batch=? AND expiry<>'' AND expiry<? AND qty>0 LIMIT 1").get(row.itemId,row.batch,date.slice(0,7));
        if(expired||row.expiry&&row.expiry<date.slice(0,7))fail(`Expired batch cannot be sold: ${name} ${row.batch}`);
      }
    }
  }
  function partySign(partyId){
    const party=ledgers().find(row=>row.id===partyId);
    if(!party||!['Sundry Debtors','Sundry Creditors'].includes(party.accountGroup))fail('Choose a customer or supplier ledger');
    return {party,sign:party.accountGroup==='Sundry Debtors'?1:-1};
  }
  function postings(partyId,asOf='9999-12-31'){
    return q(`SELECT v.id,v.date,v.type,v.number,v.narration,SUM(e.amount) AS amount,
      COALESCE(json_extract(d.value,'$.dueDate'),'') AS dueDate
      FROM entries e JOIN vouchers v ON v.id=e.voucher_id LEFT JOIN record_details d ON d.scope='document' AND d.record_id=v.id
      WHERE e.ledger_id=? AND v.date<=? GROUP BY v.id, d.value HAVING SUM(e.amount)<>0 ORDER BY v.date,v.id`).all(partyId,asOf);
  }
  function outstanding({partyId,asOf=today()}={}){
    if(!isDate(asOf))fail('Enter a valid report date');
    const {party,sign}=partySign(partyId),rows=postings(partyId,asOf);
    const matched=q(`SELECT a.* FROM bill_allocations a JOIN vouchers b ON b.id=a.bill_id JOIN vouchers p ON p.id=a.payment_id WHERE a.party_id=? AND b.date<=? AND p.date<=?`).all(partyId,asOf,asOf);
    const allocated=(id,field)=>matched.filter(a=>a[field]===id).reduce((sum,a)=>sum+a.amount,0);
    const bills=rows.filter(r=>r.amount*sign>0).map(row=>{
      const amount=row.amount*sign,paid=allocated(row.id,'bill_id'),dueDate=row.dueDate||addDays(row.date,party.creditDays);
      return {...row,amount,paid,remaining:amount-paid,dueDate,overdue:Math.max(0,Math.floor((Date.parse(asOf)-Date.parse(dueDate))/86400000))};
    });
    const credits=rows.filter(r=>r.amount*sign<0).map(row=>({...row,amount:-row.amount*sign,allocated:allocated(row.id,'payment_id'),remaining:-row.amount*sign-allocated(row.id,'payment_id')}));
    const opening=party.opening*sign;
    return {party,asOf,bills,credits,opening,pending:bills.reduce((sum,r)=>sum+r.remaining,0),onAccount:credits.reduce((sum,r)=>sum+r.remaining,0),net:opening+rows.reduce((sum,r)=>sum+r.amount*sign,0)};
  }
  function allocationOptions({paymentId,partyId}){
    const result=outstanding({partyId,asOf:'9999-12-31'}),payment=result.credits.find(r=>r.id===paymentId);
    if(!payment)fail('Choose a receipt, payment or credit posting for this party');
    const selected=q('SELECT bill_id AS billId,amount FROM bill_allocations WHERE payment_id=? AND party_id=?').all(paymentId,partyId);
    return {party:result.party,payment,bills:result.bills.map(b=>({...b,allocated:selected.find(s=>s.billId===b.id)?.amount||0})).filter(b=>b.remaining>0||b.allocated>0)};
  }
  function validateAllocations(){
    const parties=q('SELECT DISTINCT party_id AS id FROM bill_allocations').all();
    if(parties.length){
      const accounts=new Map(ledgers().map(row=>[row.id,row]));
      for(const row of parties){
        const group=accounts.get(row.id)?.accountGroup,sign=group==='Sundry Debtors'?1:group==='Sundry Creditors'?-1:0;
        if(!sign||q('SELECT 1 FROM bill_allocations a WHERE a.party_id=? AND (SELECT COALESCE(SUM(amount),0) FROM entries WHERE voucher_id=a.bill_id AND ledger_id=a.party_id)*?<=0 LIMIT 1').get(row.id,sign))fail('Clear bill settlements before changing this party between customer, supplier or other account groups.');
      }
    }
    const invalid=q(`SELECT a.party_id FROM bill_allocations a
      LEFT JOIN (SELECT voucher_id,ledger_id,SUM(amount) AS n FROM entries GROUP BY voucher_id,ledger_id) b ON b.voucher_id=a.bill_id AND b.ledger_id=a.party_id
      LEFT JOIN (SELECT voucher_id,ledger_id,SUM(amount) AS n FROM entries GROUP BY voucher_id,ledger_id) p ON p.voucher_id=a.payment_id AND p.ledger_id=a.party_id
      WHERE b.n IS NULL OR p.n IS NULL OR b.n*p.n>=0
      OR (SELECT SUM(amount) FROM bill_allocations WHERE bill_id=a.bill_id AND party_id=a.party_id)>ABS(b.n)
      OR (SELECT SUM(amount) FROM bill_allocations WHERE payment_id=a.payment_id AND party_id=a.party_id)>ABS(p.n) LIMIT 1`).get();
    if(invalid)fail('This change would invalidate bill settlements. Clear or adjust the affected bill allocations first.');
  }
  function saveAllocations({paymentId,partyId,allocations=[]}){
    return tx(()=>{
    const {payment,bills}=allocationOptions({paymentId,partyId});
    if(!Array.isArray(allocations)||allocations.length>2000)fail('Provide valid bill allocations');
    checkDates(payment.date,...bills.filter(b=>b.allocated||allocations.some(a=>a.billId===b.id)).map(b=>b.date));
    const seen=new Set();let total=0;
    for(const row of allocations){integer(row.amount,'Allocation');const bill=bills.find(b=>b.id===row.billId);
      if(!row.amount||!bill||seen.has(row.billId)||row.amount>bill.remaining+bill.allocated)fail('Allocation exceeds the unpaid bill amount, repeats a bill or names an invalid bill');
      total+=row.amount;seen.add(row.billId);
    }
    if(!Number.isSafeInteger(total)||total>payment.amount)fail('Allocated total exceeds the payment amount');
      q('DELETE FROM bill_allocations WHERE payment_id=? AND party_id=?').run(paymentId,partyId);
      for(const row of allocations)q('INSERT INTO bill_allocations(payment_id,bill_id,party_id,amount) VALUES(?,?,?,?)').run(paymentId,row.billId,partyId,row.amount);
      validateAllocations();return {paymentId,partyId,allocated:total,onAccount:payment.amount-total};});
  }
  function checkDelete(id){if(q('SELECT 1 FROM bill_allocations WHERE payment_id=?1 OR bill_id=?1').get(id))fail('This voucher has bill settlements. Clear those allocations before deleting it.');}
  function purchasePlan({days=30,asOf=today(),from}={}){
    integer(days,'Planning days',365);if(!days||!isDate(asOf))fail('Enter a planning period between 1 and 365 days and a valid date');
    from=from||addDays(asOf,-days+1);
    if(!isDate(from)||from>asOf)fail('Choose a valid planning period');
    return items().map(item=>{
      const activity=q(`SELECT COALESCE(SUM(CASE WHEN v.type='Sales' THEN -m.qty WHEN v.type='Credit Note' THEN -m.qty ELSE 0 END),0) AS sold,
        MAX(CASE WHEN v.type='Sales' THEN v.date END) AS lastSale FROM stock_moves m JOIN vouchers v ON v.id=m.voucher_id WHERE m.item_id=? AND v.date BETWEEN ? AND ?`).get(item.id,from,asOf);
      const stock=q('SELECT COALESCE(SUM(m.qty),0) AS n FROM stock_moves m JOIN vouchers v ON v.id=m.voucher_id WHERE m.item_id=? AND v.date<=?').get(item.id,asOf).n;
      const target=Math.max(item.reorderLevel,Math.max(0,activity.sold)),suggested=Math.max(0,target-stock);
      return {...item,stock,sold:activity.sold,lastSale:activity.lastSale,target,suggested,cost:Math.round(suggested*item.purchaseRate/1000)};
    });
  }
  function salesAnalysis({from,to,by='item'}={}){
    if(!isDate(from)||!isDate(to)||from>to)fail('Choose a valid report period');
    if(!['item','party','month','category','brand'].includes(by))fail('Choose an analysis grouping');
    const rows=q(`SELECT i.name AS item,i.category,i.brand,l.name AS party,v.date,v.type,m.qty,m.amount,m.discount_pct AS discountPct,m.rate,m.line,d.value AS details FROM stock_moves m JOIN vouchers v ON v.id=m.voucher_id JOIN items i ON i.id=m.item_id LEFT JOIN invoices n ON n.voucher_id=v.id LEFT JOIN ledgers l ON l.id=n.party_id LEFT JOIN record_details d ON d.scope='document' AND d.record_id=v.id WHERE v.type IN ('Sales','Credit Note') AND v.date BETWEEN ? AND ?`).all(from,to);
    const groups=new Map();for(const row of rows){const name=(by==='month'?row.date.slice(0,7):row[by])||'Unspecified',sign=row.type==='Sales'?1:-1;
      const data=row.details?JSON.parse(row.details):{};
      const original=data.unitLines?.find(unit=>unit.line===row.line)||data.offerLines?.find(unit=>unit.line===row.line);
      const gross=Math.round(original?original.qty*original.rate/1000:Math.abs(row.qty)*row.rate/1000);
      const group=groups.get(name)||{name,qty:0,sales:0,returns:0,net:0,discount:0};group.qty-=row.qty;group[row.type==='Sales'?'sales':'returns']+=row.amount;group.net+=sign*row.amount;group.discount+=sign*(gross-row.amount);groups.set(name,group);
    }return [...groups.values()].sort((a,b)=>b.net-a.net||a.name.localeCompare(b.name));
  }
  return {setReferenceProvider:fn=>{referenceProvider=fn;},controls,saveControls,checkDates,ledgerPolicy,saveLedgerPolicy,itemPolicy,saveItemPolicy,checkSale,validateAllocations,checkDelete,
    api:{retailControls:controls,saveRetailControls:saveControls,outstandingBills:outstanding,allocationOptions,saveAllocations,purchasePlan,salesAnalysis}};
};
