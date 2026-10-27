import { relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineCollection } from 'astro:content';
import type { Loader } from 'astro/loaders';
import { reportProblems } from './domain/problem.ts';
import { bankFileSchema, paperFileSchema } from './domain/schema';
import { readDataDir, resolveDataDir, type DataFile } from './lib/data-dir.ts';

// 讀檔與 YAML 解析交給 src/lib/data-dir.ts，和 pnpm check:bank 共用同一份流程（不用 glob loader）。
// entry id 即原始檔名（不含副檔名）；檔名是否合格由題庫檢查（src/domain/file-name.ts）回報。
// 預設讀 repo 內的虛構範例；真實資料目錄由 EXAMREMIX_DATA_DIR 指定（ADR 0001）。
function dataLoader(name: string, pick: (contents: ReturnType<typeof readDataDir>) => DataFile[]): Loader {
  return {
    name,
    async load({ store, parseData, config }) {
      const contents = readDataDir(resolveDataDir());
      const report = reportProblems(contents.problems);
      if (report.failed) {
        throw new Error(`資料檔無法讀入：\n${report.lines.map((line) => `  - ${line}`).join('\n')}`);
      }
      store.clear();
      for (const { name: id, file, path, raw } of pick(contents)) {
        // parseData 的錯誤只帶 collection 與 id，這裡補上檔案路徑，欄位 path 留在原訊息裡
        const data = await parseData({ id, data: raw as Record<string, unknown> }).catch((error: unknown) => {
          throw new Error(`${file}：${(error as Error).message}`, { cause: error });
        });
        // Astro 要求 filePath 相對於網站根目錄
        store.set({ id, data, filePath: relative(fileURLToPath(config.root), path) });
      }
    },
  };
}

const bank = defineCollection({
  loader: dataLoader('examremix-bank', (c) => c.banks),
  schema: bankFileSchema,
});

const papers = defineCollection({
  loader: dataLoader('examremix-papers', (c) => c.papers),
  schema: paperFileSchema,
});

export const collections = { bank, papers };
