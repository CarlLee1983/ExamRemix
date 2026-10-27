// 檢查指令：pnpm check:bank [資料目錄]
// 讀 <資料目錄>/bank/*.yaml 與 papers/*.yaml，先以 schema 驗證，通過後再跑跨檔檢查。
// 資料目錄依序取 CLI 參數、EXAMREMIX_DATA_DIR、examples。結束狀態：沒問題 0；有問題 1；資料目錄或 bank/、papers/ 不存在 2。
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { z } from 'astro/zod';
import { parse } from 'yaml';
import { checkBank, formatProblem } from '../src/domain/bank-check.ts';
import { bankFileSchema, paperFileSchema } from '../src/domain/schema.ts';

const dataDir = resolve(process.argv[2] || process.env.EXAMREMIX_DATA_DIR || 'examples');

function fail(message: string): never {
  console.error(message);
  process.exit(2);
}

function yamlFiles(subdir: string): string[] {
  const dir = join(dataDir, subdir);
  if (!existsSync(dir)) {
    fail(`找不到目錄 ${dir}（資料目錄 ${dataDir} 底下需有 bank/ 與 papers/）`);
  }
  return readdirSync(dir)
    .filter((name) => name.endsWith('.yaml'))
    .sort();
}

/** 讀檔、解析 YAML、以 schema 驗證；schema 錯誤轉成「檔案：欄位：訊息」的行。 */
function load<T>(subdir: string, schema: z.ZodType<T>) {
  const loaded: { name: string; file: string; data: T }[] = [];
  const problems: string[] = [];
  for (const name of yamlFiles(subdir)) {
    const file = `${subdir}/${name}`;
    let raw: unknown;
    try {
      raw = parse(readFileSync(join(dataDir, subdir, name), 'utf8'));
    } catch (error) {
      problems.push(`${file}：YAML 格式錯誤：${(error as Error).message.split('\n')[0]}`);
      continue;
    }
    const result = schema.safeParse(raw);
    if (result.success) {
      loaded.push({ name: basename(name, '.yaml'), file, data: result.data });
    } else {
      for (const issue of result.error.issues) {
        problems.push(`${file}：${issue.path.join('.') || '(根)'}：${issue.message}`);
      }
    }
  }
  return { loaded, problems };
}

if (!existsSync(dataDir)) {
  fail(`找不到資料目錄 ${dataDir}（可用第一個參數或 EXAMREMIX_DATA_DIR 指定）`);
}

const banks = load('bank', bankFileSchema);
const papers = load('papers', paperFileSchema);

// schema 都過了才跑跨檔檢查
const schemaProblems = [...banks.problems, ...papers.problems];
const lines =
  schemaProblems.length > 0
    ? schemaProblems
    : checkBank({ banks: banks.loaded, papers: papers.loaded }).map(formatProblem);

if (lines.length === 0) {
  console.log(`題庫檢查通過：${banks.loaded.length} 個題庫檔、${papers.loaded.length} 份試卷檔，沒有問題`);
} else {
  for (const line of lines) console.log(line);
  console.log(`題庫檢查失敗：${lines.length} 個問題（資料目錄 ${dataDir}）`);
  process.exit(1);
}
