// 檢查指令：pnpm check:bank [資料目錄]
// 讀 <資料目錄>/bank/*.yaml 與 papers/*.yaml，先以 schema 驗證，通過後再跑跨檔檢查。
// 資料目錄依序取 CLI 參數、EXAMREMIX_DATA_DIR、examples。先列錯誤再列警告，最後一行是摘要。
// 結束狀態：沒有錯誤 0（只有警告也是 0）；有錯誤 1；資料目錄或 bank/、papers/ 不存在 2。
import { z } from 'astro/zod';
import { checkBank } from '../src/domain/bank-check.ts';
import { reportProblems, type Problem } from '../src/domain/problem.ts';
import { bankFileSchema, paperFileSchema } from '../src/domain/schema.ts';
import { readDataDir, resolveDataDir, type DataFile } from '../src/lib/data-dir.ts';

const dataDir = resolveDataDir(process.argv[2]);

let contents: ReturnType<typeof readDataDir>;
try {
  contents = readDataDir(dataDir);
} catch (error) {
  console.error((error as Error).message);
  process.exit(2);
}

/** 以 schema 驗證；schema 錯誤是錯誤，訊息寫成「欄位：訊息」。 */
function validate<T>(files: DataFile[], schema: z.ZodType<T>) {
  const loaded: { name: string; file: string; data: T }[] = [];
  const problems: Problem[] = [];
  for (const { name, file, raw } of files) {
    const result = schema.safeParse(raw);
    if (result.success) {
      loaded.push({ name, file, data: result.data });
    } else {
      for (const issue of result.error.issues) {
        problems.push({ severity: 'error', files: [file], message: `${issue.path.join('.') || '(根)'}：${issue.message}` });
      }
    }
  }
  return { loaded, problems };
}

const banks = validate(contents.banks, bankFileSchema);
const papers = validate(contents.papers, paperFileSchema);

// 檔案都讀得進來、schema 都過了才跑跨檔檢查
const schemaProblems = [...contents.problems, ...banks.problems, ...papers.problems];
const { lines, summary, failed } = reportProblems(
  schemaProblems.length > 0
    ? schemaProblems
    : checkBank({ banks: banks.loaded, papers: papers.loaded, images: contents.images }),
);

for (const line of lines) console.log(line);
if (failed) {
  console.log(`題庫檢查失敗：${summary}（資料目錄 ${dataDir}）`);
  process.exit(1);
}
console.log(`題庫檢查通過：${banks.loaded.length} 個題庫檔、${papers.loaded.length} 份試卷檔，${summary}`);
