// A small arithmetic parser: no eval or executable input.
export function calculate(expression){
 const source=String(expression).replace(/\s+/g,'').replaceAll('\u00d7','*').replaceAll('\u00f7','/');
 if(!source||source.length>500)throw Error('Enter a calculation (up to 500 characters).');
 let at=0;
 const take=c=>source.startsWith(c,at)?(at+=c.length,true):false;
 function atom(){
  let value;
  if(take('(')){value=sum();if(!take(')'))throw Error('Close the bracket.');}
  else if(take('sqrt(')){value=sum();if(!take(')'))throw Error('Close the bracket.');value=Math.sqrt(value);}
  else {const m=/^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?/i.exec(source.slice(at));if(!m)throw Error('Check the calculation.');at+=m[0].length;value=Number(m[0]);}
  while(take('%'))value/=100;
  return value;
 }
 function power(){const value=atom();return take('^')?value**unary():value;}
 function unary(){return take('+')?unary():take('-')?-unary():power();}
 function product(){let value=unary();while(true){if(take('*'))value*=unary();else if(take('/')){const divisor=unary();if(divisor===0)throw Error('Cannot divide by zero.');value/=divisor;}else return value;}}
 function sum(){let value=product();while(true){if(take('+'))value+=product();else if(take('-'))value-=product();else return value;}}
 const value=sum();if(at!==source.length)throw Error('Check the calculation.');if(!Number.isFinite(value))throw Error('Result is outside the supported range.');
 return Number(value.toPrecision(15)).toString();
}
