import { generateQuestions } from '../src/lib/question-batch.ts';
try {
  const [path,...extra]=process.argv.slice(2);
  if(!path || extra.length)throw new Error('用法：pnpm bank:generate <完整候選與品質證據 JSON>');
  const result=generateQuestions(path);
  console.log(JSON.stringify(result));
  if(result.state==='rejected'||result.state==='stopped')process.exitCode=1;
} catch(error){console.error((error as Error).message);process.exitCode=1;}
