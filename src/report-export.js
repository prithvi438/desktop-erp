'use strict';
const ExcelJS=require('exceljs');
const escape=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
function validate(data){
  require('./csv').tableCsv(data);
  for(const key of ['title','subtitle','notes'])if(data[key]!=null&&(typeof data[key]!=='string'||data[key].length>100000))throw Error('Invalid report heading or notes');
  if(data.rows.some(row=>row.some(value=>typeof value==='number'&&!Number.isFinite(value))))throw Error('Report contains an invalid number');
  return data;
}
const amountFormat='#,##,##0.00;(#,##,##0.00);"—"';
async function workbook(data){
  validate(data);const book=new ExcelJS.Workbook();book.creator='Desktop ERP';book.created=new Date();
  const sheet=book.addWorksheet('Report',{pageSetup:{paperSize:9,orientation:data.columns.length>5?'landscape':'portrait',fitToPage:true,fitToWidth:1,fitToHeight:0},views:[{state:'frozen',ySplit:5}]});
  const width=data.columns.length;
  for(const value of [data.company?.name||'Company',data.title||'Report',data.subtitle||'',data.units||'Amounts in INR unless stated otherwise']){const row=sheet.addRow([value]);if(width>1)sheet.mergeCells(row.number,1,row.number,width);row.font={name:'Calibri',size:row.number===1?16:11,bold:row.number<=2};row.height=row.number===1?25:row.number>=3?32:20;row.alignment={wrapText:true,vertical:'middle'};}
  const head=sheet.addRow(data.columns);head.font={bold:true,color:{argb:'FFFFFFFF'}};head.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF234E70'}};head.height=30;
  data.rows.forEach((values,index)=>{
    // Values remain literal scalars: never interpret text as Excel formulas.
    const row=sheet.addRow(values),kind=data.kinds?.[index]||'';row.height=Math.max(20,...values.map((value,col)=>Math.ceil(String(value??'').length/(col===0?45:22))*15+4));
    row.eachCell({includeEmpty:true},(cell,col)=>{cell.font={name:'Calibri',size:11,bold:['section','head','total'].includes(kind)};cell.alignment={vertical:'top',wrapText:true,horizontal:typeof cell.value==='number'?'right':'left',indent:kind==='sub'&&col===1?1:0};
      if(typeof cell.value==='number'&&data.formats?.[col-1]==='money')cell.numFmt=amountFormat;
      if(kind==='total')cell.border={top:{style:'thin',color:{argb:'FF526879'}},bottom:{style:'double',color:{argb:'FF526879'}}};
      if(['section','head'].includes(kind))cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:kind==='section'?'FFDFE8EE':'FFF0F4F7'}};
    });
  });
  if(data.notes){sheet.addRow([]);for(const text of data.notes.split('\n')){const row=sheet.addRow([text]);if(width>1)sheet.mergeCells(row.number,1,row.number,width);row.alignment={wrapText:true,vertical:'top'};row.height=Math.max(18,Math.ceil(text.length/(width*15))*15);}}
  sheet.columns.forEach((column,index)=>{column.width=index===0?48:data.formats?.[index]==='money'?23:Math.min(40,Math.max(14,data.columns[index].length+3));});
  sheet.pageSetup.printTitlesRow='1:5';sheet.headerFooter.oddFooter='&LDesktop ERP&CPage &P of &N&R&D';
  sheet.pageSetup.margins={left:0.3,right:0.3,top:0.4,bottom:0.5,header:0.2,footer:0.2};
  return Buffer.from(await book.xlsx.writeBuffer());
}
function html(data){
  validate(data);const number=new Intl.NumberFormat('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2});
  const display=(value,index)=>typeof value==='number'&&data.formats?.[index]==='money'?(value<0?`(${number.format(-value)})`:value===0?'—':number.format(value)):String(value??'');
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escape(data.title||'Report')}</title><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><style>
  @page{size:A4 ${data.columns.length>5?'landscape':'portrait'};margin:14mm 10mm 18mm}body{font:10px Arial,sans-serif;color:#182d3b}h1{font-size:18px;margin:0 0 5px}h2{font-size:14px;margin:5px 0}p{margin:5px 0;white-space:pre-wrap}table{border-collapse:collapse;width:100%;table-layout:fixed;margin-top:14px}thead{display:table-header-group}th{background:#234e70;color:white;text-align:left}td,th{padding:6px;border-bottom:1px solid #d1dae0;overflow-wrap:anywhere;vertical-align:top}tr{break-inside:avoid}th:first-child{width:37%}.num{text-align:right;font-variant-numeric:tabular-nums}.section{background:#dfe8ee;font-weight:bold}.head{background:#f0f4f7;font-weight:bold}.total{font-weight:bold;border-top:1px solid;border-bottom:3px double}.sub td:first-child{padding-left:15px}.notes{margin-top:18px;border-top:1px solid #9baab5;padding-top:8px;line-height:1.5}</style></head><body>
  <h1>${escape(data.company?.name||'Company')}</h1><p>${escape(data.company?.address||'')}</p><h2>${escape(data.title||'Report')}</h2><p>${escape(data.subtitle||'')}</p><p>${escape(data.units||'Amounts in INR unless stated otherwise')}</p>
  <table><thead><tr>${data.columns.map(label=>`<th>${escape(label)}</th>`).join('')}</tr></thead><tbody>${data.rows.map((row,index)=>`<tr class="${['section','head','total','sub','bad'].includes(data.kinds?.[index])?data.kinds[index]:''}">${row.map((value,col)=>`<td class="${typeof value==='number'?'num':''}">${escape(display(value,col))}</td>`).join('')}</tr>`).join('')}</tbody></table>${data.notes?`<p class="notes">${escape(data.notes)}</p>`:''}</body></html>`;
}
async function pdf(data,BrowserWindow){
  const win=new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,javascript:false}});
  try{await win.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent(html(data)));return await win.webContents.printToPDF({printBackground:true,preferCSSPageSize:true,displayHeaderFooter:true,headerTemplate:'<span></span>',footerTemplate:'<div style="font-size:8px;width:100%;text-align:center">Desktop ERP · Page <span class="pageNumber"></span> of <span class="totalPages"></span></div>'});}finally{win.destroy();}
}
module.exports={validate,workbook,html,pdf};
