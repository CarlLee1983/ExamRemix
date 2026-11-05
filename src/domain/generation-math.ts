import { z } from 'astro/zod';
import { calculate, digitCounts, sameNumber } from './vertical-calc.ts';
import type { Question } from './schema.ts';

const decimal=z.string().max(40).regex(/^(0|[1-9]\d*)(\.\d+)?$/);
const range=z.object({min:decimal,max:decimal}).strict();
export const arithmeticModelSchema=z.object({
  steps:z.array(z.object({operator:z.enum(['+','-','×','÷']),operands:z.tuple([decimal,decimal]),result:decimal,remainder:decimal.optional(),ranges:z.tuple([range,range]).optional()}).strict()).min(1).max(20),
  inputUnits:z.array(z.string().trim().min(1)),outputUnit:z.string().trim().min(1),conversions:z.number().int().nonnegative(),
}).strict();
export const arithmeticEntrySchema=z.object({id:z.string().min(1),model:arithmeticModelSchema}).strict();
type Model=z.infer<typeof arithmeticModelSchema>;

function transferProfile(a:string,b:string,operator:'+'|'-'|'×') {
  const scale=Math.max(digitCounts(a).frac,digitCounts(b).frac);
  const digits=(n:string)=>n.replace('.','').padEnd(n.replace('.','').length+scale-digitCounts(n).frac,'0').split('').reverse().map(Number);
  const x=digits(a),y=digits(b),transfers:number[][]=[];
  if(operator==='×') {
    // Each partial product's carries, then the carries while summing partials.
    const partials:number[][]=[];
    for(let j=0;j<y.length;j++) {
      let carry=0;const row:number[]=Array(j).fill(0),trace:number[]=[];
      for(let i=0;i<x.length;i++){const n=x[i]!*y[j]!+carry;row.push(n%10);carry=Math.floor(n/10);trace.push(carry);}
      if(carry)row.push(carry);partials.push(row);transfers.push(trace);
    }
    let carry=0;const sum:number[]=[];
    for(let i=0;i<Math.max(...partials.map(p=>p.length));i++){const n=partials.reduce((n,p)=>n+(p[i]??0),carry);carry=Math.floor(n/10);sum.push(carry);}
    transfers.push(sum);
  } else {
    let carry=0;const trace:number[]=[],acrossZero:number[]=[];
    for(let i=0;i<Math.max(x.length,y.length);i++) {
      const left=x[i]??0,right=y[i]??0;
      acrossZero.push(operator==='-' && carry===1 && left===0 ? 1:0);
      carry=operator==='+' ? Math.floor((left+right+carry)/10) : left-carry<right ? 1:0;
      trace.push(carry);
    }
    transfers.push(trace,acrossZero);
  }
  return transfers;
}

export function arithmeticProfile(model:Model) {
  return {inputUnits:model.inputUnits,outputUnit:model.outputUnit,conversions:model.conversions,steps:model.steps.map(step=>{
    const [a,b]=step.operands;
    step.ranges?.forEach((range,i)=>{if(calculate([range.max,range.min],'-')===null || calculate([step.operands[i]!,range.min],'-')===null || calculate([range.max,step.operands[i]!],'-')===null)throw new Error('運算元超出固定數值範圍');});
    if(step.operator==='÷') {
      if([a,b,step.result,step.remainder??'0'].some(n=>n.includes('.')) || BigInt(b)===0n)throw new Error('除法模型只支援非負整數商與餘數，除數須非零');
      const remainder=BigInt(step.remainder??'0');
      if(BigInt(b)*BigInt(step.result)+remainder!==BigInt(a)||remainder>=BigInt(b))throw new Error('除法模型求解／餘數不符');
      return {operator:step.operator,ranges:step.ranges,digits:step.operands.map(digitCounts),zeros:step.operands.map(n=>BigInt(n)===0n),quotientDigits:digitCounts(step.result),exact:remainder===0n};
    }
    const result=calculate(step.operands,step.operator);
    if(result===null || !sameNumber(result,step.result) || step.remainder!==undefined)throw new Error('數學模型精確結果不符');
    return {operator:step.operator,ranges:step.ranges,digits:step.operands.map(digitCounts),zeros:step.operands.map(n=>sameNumber(n,'0')),resultDigits:digitCounts(result),transfers:transferProfile(a,b,step.operator)};
  })};
}

export function checkArithmeticBinding(q:Question,model:Model) {
  // Free text requires the recorded independent modelling evidence. Structured
  // vertical calculations can additionally be bound without parsing prose.
  if(q.type!=='vertical-calc')return;
  if(model.steps.length!==q.operands.length-1)throw new Error('直式模型步驟未對應題目');
  for(let i=0;i<model.steps.length;i++) {
    const step=model.steps[i]!;
    if(step.operator!==q.operator || !sameNumber(step.operands[0],i===0?q.operands[0]!:model.steps[i-1]!.result) || !sameNumber(step.operands[1],q.operands[i+1]!))throw new Error('直式模型運算元未對應題目');
  }
  if(!sameNumber(model.steps.at(-1)!.result,q.answer))throw new Error('直式模型答案未對應題目');
}
