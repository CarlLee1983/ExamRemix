import { inspectBatchRoot, publishBatch, rollbackBatch } from '../src/lib/question-batch.ts';

try {
  const [command, path, ...rest]=process.argv.slice(2);
  if (!path || (command==='rollback' ? rest.length!==1 : rest.length!==0) || !['inspect','publish','rollback'].includes(command!)) throw new Error('用法：pnpm bank:batch inspect <資料目錄> | publish <請求 JSON> | rollback <資料目錄> <batchId>');
  console.log(JSON.stringify(command==='rollback' ? rollbackBatch(path,rest[0]!) : command==='inspect' ? inspectBatchRoot(path) : publishBatch(path)));
} catch (error) {
  console.error((error as Error).message);
  process.exitCode=1;
}
