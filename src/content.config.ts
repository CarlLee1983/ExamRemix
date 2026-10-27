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

// entry id 即檔名（不含副檔名）
const bank = defineCollection({
  loader: glob({ pattern: '*.yaml', base: requireDir(resolve(dataDir, 'bank')) }),
  schema: bankFileSchema,
});

const papers = defineCollection({
  loader: glob({ pattern: '*.yaml', base: requireDir(resolve(dataDir, 'papers')) }),
  schema: paperFileSchema,
});

export const collections = { bank, papers };
