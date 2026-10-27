// 題庫附圖的靜態端點：把 <資料目錄>/bank/ 底下的圖片原樣輸出到 /bank-images/<路徑>。
// 圖片在資料目錄（可能在 repo 外，ADR 0001），不在 public/，所以要由端點提供；開發與靜態建置都適用，不需要網路。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { APIRoute, GetStaticPaths } from 'astro';
import { imageContentType } from '../../domain/image';
import { readDataDir, resolveDataDir } from '../../lib/data-dir';

export const getStaticPaths = (() => {
  const { images } = readDataDir(resolveDataDir());
  return images.map((path) => ({ params: { path } }));
}) satisfies GetStaticPaths;

export const GET: APIRoute = ({ params }) => {
  const path = params.path!;
  const body = readFileSync(join(resolveDataDir(), 'bank', path));
  return new Response(body, { headers: { 'Content-Type': imageContentType(path)! } });
};
