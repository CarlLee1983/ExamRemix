import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { bankFileSchema, paperFileSchema } from './domain/schema';

// 資料根目錄：底下有 bank/*.yaml（題庫檔）與 papers/*.yaml（試卷檔）。
// 預設讀 repo 內的虛構範例；真實資料目錄由 EXAMREMIX_DATA_DIR 指定（ADR 0001）。
const dataDir = resolve(process.env.EXAMREMIX_DATA_DIR ?? 'examples');

// glob loader 遇到不存在的目錄只會警告並產生空集合，所以這裡自己擋下來
function requireDir(path: string): string {
  if (!existsSync(path)) {
    throw new Error(
      `資料目錄不完整：找不到 ${path}（資料根目錄為 ${dataDir}，可用 EXAMREMIX_DATA_DIR 指定，底下需有 bank/ 與 papers/）`,
    );
  }
  return path;
}

// entry id 即原始檔名（不含副檔名）。不用 glob 預設的 slug 化：它會把不同檔名合併成同一個 id，
// 而 Astro 對重複 id 只警告並覆蓋；檔名是否合格由題庫檢查（src/domain/file-name.ts）回報。
const generateId = ({ entry }: { entry: string }) => entry.replace(/\.yaml$/, '');

const bank = defineCollection({
  loader: glob({ pattern: '*.yaml', base: requireDir(resolve(dataDir, 'bank')), generateId }),
  schema: bankFileSchema,
});

const papers = defineCollection({
  loader: glob({ pattern: '*.yaml', base: requireDir(resolve(dataDir, 'papers')), generateId }),
  schema: paperFileSchema,
});

export const collections = { bank, papers };
