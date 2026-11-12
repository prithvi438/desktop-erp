import {h,money,showDate} from './ui.js';
const colours=['#2563a6','#14958b','#d69b32','#8a6bc1','#db7865','#6f8598'];
const svg=(tag,attrs={},text)=>{const el=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const [k,v] of Object.entries(attrs))el.setAttribute(k,v);if(text!=null)el.textContent=text;return el;};
const value=n=>new Intl.NumberFormat('en-IN',{notation:'compact',maximumFractionDigits:1}).format(n/100);
function chart(rows,series,bars=false){
 const w=620,height=235,left=58,right=15,top=20,bottom=40,plotH=height-top-bottom,plotW=w-left-right;
 const values=rows.flatMap(r=>series.map(s=>r[s.key])),min=Math.min(0,...values),max=Math.max(1,...values),span=max-min;
 const x=i=>left+(i+.5)*plotW/Math.max(1,rows.length),y=n=>top+(max-n)/span*plotH;
 const root=svg('svg',{viewBox:`0 0 ${w} ${height}`,role:'img','aria-label':series.map(s=>s.name).join(' and ')+' by month'});
 for(let i=0;i<=4;i++){const n=min+span*i/4;root.append(svg('line',{x1:left,x2:w-right,y1:y(n),y2:y(n),stroke:'#e4eaf0'}),svg('text',{x:left-8,y:y(n)+4,'text-anchor':'end',fill:'#66788b','font-size':13},value(n)));}
 root.append(svg('line',{x1:left,x2:w-right,y1:y(0),y2:y(0),stroke:'#94a3b8'}));
 series.forEach((s,j)=>{if(bars){const width=Math.min(18,plotW/Math.max(1,rows.length)/(series.length+1));rows.forEach((r,i)=>{const rect=svg('rect',{x:x(i)+(j-series.length/2)*width,y:Math.min(y(r[s.key]),y(0)),width:Math.max(1,width-2),height:Math.abs(y(r[s.key])-y(0)),rx:2,fill:colours[j]});rect.append(svg('title',{},`${r.name}: ${s.name} INR ${money(r[s.key])}`));root.append(rect);});}else{root.append(svg('polyline',{points:rows.map((r,i)=>`${x(i)},${y(r[s.key])}`).join(' '),fill:'none',stroke:colours[j],'stroke-width':2.5,'stroke-linejoin':'round'}));rows.forEach((r,i)=>{const dot=svg('circle',{cx:x(i),cy:y(r[s.key]),r:3.5,fill:colours[j],stroke:'white','stroke-width':1.5});dot.append(svg('title',{},`${r.name}: ${s.name} INR ${money(r[s.key])}`));root.append(dot);});}});
 rows.forEach((r,i)=>{if(i%Math.max(1,Math.ceil(rows.length/8))===0||i===rows.length-1)root.append(svg('text',{x:x(i),y:height-14,'text-anchor':'middle',fill:'#66788b','font-size':13},new Date(r.from+'T00:00:00Z').toLocaleDateString('en-IN',{month:'short',year:'2-digit',timeZone:'UTC'})));});
 return root;
}
function dataTable(rows,series){
 const head=h('thead',{},h('tr',{},h('th',{},'Period'),...series.map(s=>h('th',{class:'num'},s.name))));
 const body=h('tbody',{},...rows.map(r=>h('tr',{},h('td',{},r.name),...series.map(s=>h('td',{class:'num'},(r[s.key]<0?'-':'')+money(r[s.key]))))));
 const summary=h('summary',{},'View figures'),details=h('details',{class:'chart-data'},summary,h('div',{class:'chart-table'},h('table',{},head,body)));
 summary.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();e.stopPropagation();details.open=!details.open;}});return details;
}
export function dashboardCharts({months,statements,from,to,openReport}){
 const panel=(title,subtitle,visual,rows,series,report)=>h('section',{class:'dashboard-chart'},h('div',{class:'chart-heading'},h('div',{},h('h3',{},title),h('p',{},subtitle)),h('button',{onclick:()=>openReport(report),'aria-label':'Open '+report},'View report')),visual,dataTable(rows,series));
 const trend=[{key:'sales',name:'Net sales'},{key:'purchases',name:'Net purchases'}],cash=[{key:'inflow',name:'Cash in'},{key:'outflow',name:'Cash out'}];
 const legend=series=>h('div',{class:'chart-legend'},...series.map((s,i)=>h('span',{},h('i',{class:'chart-colour-'+i}),s.name)));
 const donutRows=Object.entries(statements.ledgers.filter(l=>l.nature==='expense').reduce((o,l)=>{o[l.groupName]=(o[l.groupName]||0)+l.period;return o;},{})).filter(([,n])=>n>0).sort((a,b)=>b[1]-a[1]);
 const slices=donutRows.slice(0,5).map(([name,amount])=>({name,amount}));if(donutRows.length>5)slices.push({name:'Other expenses',amount:donutRows.slice(5).reduce((n,r)=>n+r[1],0)});
 const total=slices.reduce((n,r)=>n+r.amount,0),pie=svg('svg',{viewBox:'0 0 230 210',role:'img','aria-label':'Expense composition'});let offset=0;pie.append(svg('circle',{cx:115,cy:100,r:70,fill:'none',stroke:'#e9eef3','stroke-width':27}));
 slices.forEach((r,i)=>{const length=r.amount/total*100,c=svg('circle',{cx:115,cy:100,r:70,fill:'none',stroke:colours[i],'stroke-width':27,pathLength:100,'stroke-dasharray':`${length} ${100-length}`,'stroke-dashoffset':-offset,transform:'rotate(-90 115 100)'});c.append(svg('title',{},`${r.name}: INR ${money(r.amount)}`));pie.append(c);offset+=length;});pie.append(svg('text',{x:115,y:98,'text-anchor':'middle',fill:'#24364b','font-size':21,'font-weight':600},total?value(total):'No expenses'),svg('text',{x:115,y:118,'text-anchor':'middle',fill:'#66788b','font-size':11},total?'INR in selected period':'in selected period'));
 const mix=h('div',{class:'expense-mix'},pie,h('div',{class:'expense-legend'},...slices.map((r,i)=>h('div',{},h('i',{class:'chart-colour-'+i}),h('span',{},r.name),h('strong',{},Math.round(r.amount/total*100)+'%')))));
 return h('div',{class:'dashboard-analytics'},h('div',{class:'analytics-heading'},h('h2',{},'Business performance'),h('span',{},showDate(from)+' - '+showDate(to)+' | INR')),h('div',{class:'dashboard-chart-grid'},
 panel('Sales & purchases','Net ledger movements, excluding tax',h('div',{},legend(trend),chart(months,trend)),months,trend,'Profit & loss'),
 panel('Cash movement','Receipts and payments across cash and bank',h('div',{},legend(cash),chart(months,cash,true)),months,cash,'Cash flow'),
 panel('Expense composition','Positive expense-group balances; includes purchases',mix,slices,[{key:'amount',name:'Amount'}],'Profit & loss'),
 panel('Cash & bank trend','Closing balance at each month end',chart(months,[{key:'closing',name:'Closing balance'}]),months,[{key:'closing',name:'Closing balance'}],'Cash / bank book')));
}
