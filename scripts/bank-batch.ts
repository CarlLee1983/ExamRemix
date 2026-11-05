import { inspectBatchRoot, publishBatch } from '../src/lib/question-batch.ts';

try {
  const [command, path, ...rest]=process.argv.slice(2);
  if (!path || rest.length || !['inspect','publish'].includes(command!)) throw new Error('用法：pnpm bank:batch inspect <資料目錄> | publish <請求 JSON>');
  console.log(JSON.stringify(command==='inspect' ? inspectBatchRoot(path) : publishBatch(path)));
} catch (error) {
  console.error((error as Error).message);
  process.exitCode=1;
}
