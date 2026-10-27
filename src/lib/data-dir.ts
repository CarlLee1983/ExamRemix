// 讀資料目錄：check:bank 與 Astro 建置共用的唯一一份讀檔流程。
// 目錄規則（bank/、papers/）、副檔名（.yaml）與 YAML 解析器（yaml 套件）只寫在這裡。
// 要用 node:fs，所以不放進只依賴 astro/zod 的 src/domain/。
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join, resolve, sep } from 'node:path';
import { parse } from 'yaml';
import { isImageFile } from '../domain/image.ts';

const EXTENSION = '.yaml';

export interface DataFile {
  /** 原始檔名，不含副檔名 */
  name: string;
  /** 相對於資料根目錄的路徑，例如 bank/x.yaml */
  file: string;
  /** 絕對路徑 */
  path: string;
  /** YAML 解析後、尚未過 schema 的內容 */
  raw: unknown;
}

export interface DataDirContents {
  banks: DataFile[];
  papers: DataFile[];
  /** bank/ 底下（含子目錄）所有圖片檔，相對於 bank/、以 / 分隔，已排序 */
  images: string[];
  /** 無法讀入的檔案（YAML 語法錯誤），每項已含檔案與原因 */
  problems: string[];
}

/** 資料根目錄：參數、EXAMREMIX_DATA_DIR、examples 依序取用（ADR 0001）。 */
export function resolveDataDir(arg?: string): string {
  return resolve(arg || process.env.EXAMREMIX_DATA_DIR || 'examples');
}

function readSubdir(dataDir: string, subdir: string, problems: string[]): DataFile[] {
  const dir = join(dataDir, subdir);
  if (!existsSync(dir)) {
    throw new Error(`找不到目錄 ${dir}（資料目錄 ${dataDir} 底下需有 bank/ 與 papers/，可用 EXAMREMIX_DATA_DIR 指定）`);
  }
  const files: DataFile[] = [];
  for (const fileName of readdirSync(dir).filter((n) => n.endsWith(EXTENSION)).sort()) {
    const file = `${subdir}/${fileName}`;
    const path = join(dir, fileName);
    try {
      files.push({ name: basename(fileName, EXTENSION), file, path, raw: parse(readFileSync(path, 'utf8')) });
    } catch (error) {
      problems.push(`${file}：YAML 格式錯誤：${(error as Error).message.split('\n')[0]}`);
    }
  }
  return files;
}

/** 圖片檔與題庫檔放在一起：bank/ 底下遞迴找出所有支援副檔名的檔案。 */
export function listImages(dataDir: string): string[] {
  const bankDir = join(dataDir, 'bank');
  return readdirSync(bankDir, { recursive: true, encoding: 'utf8' })
    .filter((path) => isImageFile(path) && statSync(join(bankDir, path)).isFile())
    .map((path) => path.split(sep).join('/'))
    .sort();
}

/** 資料目錄或 bank/、papers/ 不存在時丟出錯誤並指出路徑；YAML 語法錯誤收進 problems。 */
export function readDataDir(dataDir: string): DataDirContents {
  if (!existsSync(dataDir)) {
    throw new Error(`找不到資料目錄 ${dataDir}（可用第一個參數或 EXAMREMIX_DATA_DIR 指定）`);
  }
  const problems: string[] = [];
  const banks = readSubdir(dataDir, 'bank', problems);
  const papers = readSubdir(dataDir, 'papers', problems);
  return { banks, papers, images: listImages(dataDir), problems };
}
