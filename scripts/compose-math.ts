// Explicit snapshot only: no implicit examples, formal profile activation or bank writes.
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { composeMathPaper, validateMathWitness } from '../src/domain/paper-composition.ts';
import { readMathCompositionInput } from '../src/lib/composition-data.ts';

try {
  const {values}=parseArgs({options:{'data-dir':{type:'string'},profile:{type:'string'},seed:{type:'string'},witness:{type:'string'}},strict:true});
  if(!values['data-dir'] || !values.profile || !values.seed)throw new Error('用法：node scripts/compose-math.ts --data-dir <目錄> --profile <名稱> --seed <種子> [--witness <JSON>]');
  const input=readMathCompositionInput(values['data-dir'],values.profile);
  if(values.witness) {
    const diagnostics=await validateMathWitness(input,JSON.parse(readFileSync(values.witness,'utf8')));
    console.log(JSON.stringify({status:diagnostics.length?'data-error':'valid',diagnostics}));
    process.exitCode=diagnostics.length?1:0;
  } else {
    const result=await composeMathPaper(input,{seed:values.seed});
    console.log(JSON.stringify(result));
    process.exitCode={success:0,'data-error':1,unconfigured:2,insufficient:3,'search-limit':4}[result.status];
  }
} catch(error) {
  console.log(JSON.stringify({status:'data-error',states:0,diagnostics:[{message:error instanceof Error?error.message:String(error)}]}));
  process.exitCode=1;
}
