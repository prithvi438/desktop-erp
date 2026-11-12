// Presentation hierarchy only: amounts remain those supplied by the report.
export function balanceSheetTree(rows){
 const roots=[];let root=null,section=null,head=null;
 for(const [index,row] of rows.entries()){
  const node={...row,key:'balance:'+index,children:[]};
  if(row.kind==='section'){
   if(row.name===row.name.toUpperCase()){roots.push(node);root=node;section=null;}
   else{(root?.children||roots).push(node);section=node;}
   head=null;
  }else if(row.kind==='head'){(section?.children||root?.children||roots).push(node);head=node;}
  else if(row.kind==='sub'){(head?.children||section?.children||roots).push(node);}
  else if(row.kind==='total'){
   const parent=row.name===row.name.toUpperCase()?root:section;
   if(parent){parent.amount=row.amount;parent.previous=row.previous;parent.children.push(node);}else roots.push(node);
   head=null;
  }else roots.push(node);
 }
 return roots;
}
export function visibleBalanceRows(tree,expanded){
 const rows=[];
 function visit(nodes,depth){for(const node of nodes){rows.push({...node,depth,expanded:expanded.has(node.key)});if(expanded.has(node.key))visit(node.children,depth+1);}}
 visit(tree,0);return rows;
}
