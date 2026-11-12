'use strict';
// Read-only report projections. Money stays in paise; quantities stay in thousandths.
module.exports=function({db,BooksError,isDate,statements,stockSummary}){
 const query=sql=>db.prepare(sql);
 const before=date=>new Date(Date.parse(date+'T00:00:00Z')-86400000).toISOString().slice(0,10);
 function periods(from,to){
  if(!isDate(from)||!isDate(to)||from>to)throw new BooksError('Choose a valid report date range');
  const result=[];let start=from;
  while(start<=to){if(result.length>=1200)throw new BooksError('Choose a period of at most 100 years');const [y,m]=start.split('-').map(Number),next=`${m===12?y+1:y}-${String(m===12?1:m+1).padStart(2,'0')}-01`,end=before(next);result.push({from:start,to:end<to?end:to,name:new Date(start+'T00:00:00Z').toLocaleDateString('en-IN',{month:'long',year:'numeric',timeZone:'UTC'})});start=next;}return result;
 }
 const cash="(WITH RECURSIVE cg(id) AS (SELECT id FROM groups WHERE name IN ('Cash-in-Hand','Bank Accounts') UNION ALL SELECT g.id FROM groups g JOIN cg ON g.parent_id=cg.id) SELECT id FROM ledgers WHERE group_id IN (SELECT id FROM cg))";
 function cashMovement({from,to}){
  const months=periods(from,to);
  const opening=query(`SELECT COALESCE(SUM(opening),0) AS n FROM ledgers WHERE id IN ${cash}`).get().n+query(`SELECT COALESCE(SUM(e.amount),0) AS n FROM entries e JOIN vouchers v ON v.id=e.voucher_id WHERE e.ledger_id IN ${cash} AND v.date<?`).get(from).n;
  const entries=query(`SELECT v.id AS voucherId,v.date,v.type,v.number,v.narration,SUM(e.amount) AS amount,CASE WHEN EXISTS(SELECT 1 FROM invoices i WHERE i.voucher_id=v.id) THEN 1 ELSE 0 END AS document FROM vouchers v JOIN entries e ON e.voucher_id=v.id WHERE e.ledger_id IN ${cash} AND v.date BETWEEN ? AND ? GROUP BY v.id HAVING SUM(e.amount)<>0 ORDER BY v.date,v.id`).all(from,to);
  let closing=opening;const rows=months.map(month=>{const moves=entries.filter(e=>e.date>=month.from&&e.date<=month.to),inflow=moves.reduce((n,e)=>n+Math.max(0,e.amount),0),outflow=moves.reduce((n,e)=>n+Math.max(0,-e.amount),0),row={...month,opening:closing,inflow,outflow,net:inflow-outflow};closing+=row.net;return {...row,closing};});
  return {from,to,opening,closing,rows,entries};
 }
 function workingCapital(asOf){const s=statements({asOf});return {assets:(s.byPrimary['Current Assets']||0)+s.closingStock,liabilities:-(s.byPrimary['Current Liabilities']||0)};}
 function fundsFlow({from,to}){const months=periods(from,to);return {from,to,rows:months.map(month=>{const a=workingCapital(before(month.from)),b=workingCapital(month.to),opening=a.assets-a.liabilities,closing=b.assets-b.liabilities;return {...month,opening,assets:b.assets,liabilities:b.liabilities,closing,increase:Math.max(0,closing-opening),decrease:Math.max(0,opening-closing)};})};}
 function workingCapitalSchedule({from,to}){
  periods(from,to);const a=statements({asOf:before(from)}),b=statements({asOf:to}),rows=new Map();
  for(const [s,key] of [[a,'opening'],[b,'closing']])for(const l of s.ledgers){if(!['Current Assets','Current Liabilities'].includes(l.primary))continue;const row=rows.get(l.ledgerId)||{ledgerId:l.ledgerId,name:l.name,group:l.primary,opening:0,closing:0};row[key]=l.balance;rows.set(l.ledgerId,row);}
  const values=[...rows.values(),{name:'Inventory at cost',group:'Current Assets',opening:a.closingStock,closing:b.closingStock}];return values.map(r=>({...r,increase:Math.max(0,r.closing-r.opening),decrease:Math.max(0,r.opening-r.closing)}));
 }
 function fundsSources({from,to}){
  periods(from,to);const a=statements({asOf:before(from)}),b=statements({asOf:to}),rows=new Map();
  for(const [s,sign] of [[a,1],[b,-1]])for(const l of s.ledgers){if(['Current Assets','Current Liabilities'].includes(l.primary)||['income','expense'].includes(l.nature))continue;const r=rows.get(l.ledgerId)||{ledgerId:l.ledgerId,name:l.name,amount:0};r.amount+=sign*l.balance;rows.set(l.ledgerId,r);}
  const retained=s=>s.broughtForward+s.netProfit;
  const result=[...rows.values(),{name:'Profit / (loss), including inventory change',amount:retained(b)-retained(a)}].filter(r=>r.amount);
  return result.map(r=>({...r,source:Math.max(0,r.amount),application:Math.max(0,-r.amount)}));
 }
 function stockMonthly({itemId,from,to}){const item=query('SELECT id,name,unit FROM items WHERE id=?').get(itemId);if(!item)throw new BooksError('Item not found');return periods(from,to).map(month=>({...month,itemId,unit:item.unit,opening:0,inward:0,outward:0,closing:0,...inventoryMovement(month).find(r=>r.itemId===itemId)}));}
 function stockAgeing({asOf}){
  if(!isDate(asOf))throw new BooksError('Choose a valid report date');
  const moves=query(`SELECT i.id AS itemId,i.name,i.unit,m.batch,m.expiry,m.qty,v.date FROM stock_moves m JOIN vouchers v ON v.id=m.voucher_id JOIN items i ON i.id=m.item_id WHERE v.date<=? ORDER BY v.date,v.id,m.line`).all(asOf),batches=new Map();
  for(const m of moves){const key=JSON.stringify([m.itemId,m.batch,m.expiry]),b=batches.get(key)||{...m,lots:[],negative:0};if(m.qty>0){const paid=Math.min(m.qty,b.negative);b.negative-=paid;if(m.qty>paid)b.lots.push({qty:m.qty-paid,date:m.date});}else{let left=-m.qty;while(left&&b.lots.length){const lot=b.lots[0],used=Math.min(left,lot.qty);left-=used;lot.qty-=used;if(!lot.qty)b.lots.shift();}b.negative+=left;}batches.set(key,b);}
  return [...batches.values()].map(b=>{const r={itemId:b.itemId,name:b.name,unit:b.unit,batch:b.batch,expiry:b.expiry,days30:0,days60:0,days90:0,older:0,negative:-b.negative,qty:-b.negative};for(const lot of b.lots){const age=(Date.parse(asOf)-Date.parse(lot.date))/86400000;r[age<=30?'days30':age<=60?'days60':age<=90?'days90':'older']+=lot.qty;r.qty+=lot.qty;}return r;}).filter(r=>r.qty);
 }
 function inventoryMovement({from,to}){
  periods(from,to);return query(`SELECT i.id AS itemId,i.name,i.unit,i.category,i.brand,COALESCE(SUM(CASE WHEN v.date<? THEN m.qty ELSE 0 END),0) AS opening,COALESCE(SUM(CASE WHEN v.date BETWEEN ? AND ? AND m.qty>0 THEN m.qty ELSE 0 END),0) AS inward,COALESCE(SUM(CASE WHEN v.date BETWEEN ? AND ? AND m.qty<0 THEN -m.qty ELSE 0 END),0) AS outward,COALESCE(SUM(m.qty),0) AS closing FROM items i LEFT JOIN stock_moves m ON m.item_id=i.id LEFT JOIN vouchers v ON v.id=m.voucher_id WHERE v.date<=? OR v.id IS NULL GROUP BY i.id ORDER BY i.name`).all(from,from,to,from,to,to);
 }
 function inventoryCategory({asOf}){if(!isDate(asOf))throw new BooksError('Choose a valid report date');const rows=new Map();for(const r of stockSummary({asOf}).rows){const name=r.category||'Uncategorised',row=rows.get(name)||{name,value:0,items:new Set()};row.value+=r.value;row.items.add(r.itemId);rows.set(name,row);}return [...rows.values()].map(r=>({name:r.name,value:r.value,count:r.items.size}));}
 return {cashMovement,fundsFlow,fundsSources,workingCapitalSchedule,inventoryMovement,inventoryCategory,stockMonthly,stockAgeing};
};
