import { applyClassification, inspectClassification, previewClassification, recoverClassification, rollbackClassification } from '../src/lib/classification.ts';
try {
  const [command,path,...args]=process.argv.slice(2);
  if(!path)throw new Error('必須明示資料目錄或請求 JSON');
  let result:unknown;
  if(command==='inspect'&&!args.length)result=inspectClassification(path);
  else if(command==='preview'&&(!args.length||args.length===1&&args[0]==='--build'))result=previewClassification(path,args[0]==='--build');
  else if(command==='apply'&&args.length===2&&args[0]==='--expected')result=applyClassification(path,args[1]!);
  else if(command==='rollback'&&args.length===1)result=rollbackClassification(path,args[0]!);
  else if(command==='recover'&&args.length===2&&(args[1]==='before'||args[1]==='after'))result=recoverClassification(path,args[0]!,args[1]);
  else throw new Error('用法：bank:classify inspect <資料目錄> | preview <請求 JSON> [--build] | apply <請求 JSON> --expected <planHash> | recover <資料目錄> <batchId> before|after | rollback <資料目錄> <batchId>');
  console.log(JSON.stringify(result));
} catch(error) {console.error((error as Error).message);process.exitCode=1;}
