'use strict';
// Spreadsheet programs must treat labels as text, never as formulas.
function csvCell(value){
  let text=String(value??'');
  if(/^[\s]*[=+\-@]/.test(text)||/^[\t\r\n]/.test(text))text=`'${text}`;
  return `"${text.replaceAll('"','""')}"`;
}
function tableCsv({columns,rows}){
  if(!Array.isArray(columns)||!columns.length||columns.length>100||!Array.isArray(rows)||rows.length>100000)throw Error('Export supports up to 100 columns and 100,000 rows.');
  const values=[columns,...rows];
  if(values.some(row=>!Array.isArray(row)||row.length!==columns.length||row.some(cell=>cell!=null&&!['string','number','boolean'].includes(typeof cell))))throw Error('Invalid report data.');
  const csv='\uFEFF'+values.map(row=>row.map(csvCell).join(',')).join('\r\n')+'\r\n';
  if(Buffer.byteLength(csv)>25*1024*1024)throw Error('Export is too large. Narrow the report period or filter.');
  return csv;
}
module.exports={tableCsv};
