// 檢查指令：pnpm check:bank [資料目錄]
// 讀 <資料目錄>/bank/*.yaml 與 papers/*.yaml，先以 schema 驗證，通過後再跑跨檔檢查。
// 資料目錄依序取 CLI 參數、EXAMREMIX_DATA_DIR、examples。結束狀態：沒問題 0；有問題 1；資料目錄或 bank/、papers/ 不存在 2。
import { z } from 'astro/zod';
import { checkBank, formatProblem } from '../src/domain/bank-check.ts';
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

/** 以 schema 驗證；schema 錯誤轉成「檔案：欄位：訊息」的行。 */
function validate<T>(files: DataFile[], schema: z.ZodType<T>) {
  const loaded: { name: string; file: string; data: T }[] = [];
  const problems: string[] = [];
  for (const { name, file, raw } of files) {
    const result = schema.safeParse(raw);
    if (result.success) {
      loaded.push({ name, file, data: result.data });
    } else {
      for (const issue of result.error.issues) {
        problems.push(`${file}：${issue.path.join('.') || '(根)'}：${issue.message}`);
      }
    }
  }
  return { loaded, problems };
}

const banks = validate(contents.banks, bankFileSchema);
const papers = validate(contents.papers, paperFileSchema);

// 檔案都讀得進來、schema 都過了才跑跨檔檢查
const schemaProblems = [...contents.problems, ...banks.problems, ...papers.problems];
const lines =
  schemaProblems.length > 0
    ? schemaProblems
    : checkBank({ banks: banks.loaded, papers: papers.loaded, images: contents.images }).map(formatProblem);

if (lines.length === 0) {
  console.log(`題庫檢查通過：${banks.loaded.length} 個題庫檔、${papers.loaded.length} 份試卷檔，沒有問題`);
} else {
  for (const line of lines) console.log(line);
  console.log(`題庫檢查失敗：${lines.length} 個問題（資料目錄 ${dataDir}）`);
  process.exit(1);
}
