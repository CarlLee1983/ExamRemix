// 建置時載入題庫與試卷，一律跑跨檔檢查；有錯誤就讓建置失敗並列出全部問題，只有警告時印出警告後繼續。
import { getCollection } from 'astro:content';
import { basename } from 'node:path';
import { listImages, resolveDataDir } from './data-dir.ts';
import { buildQuestionIndex, checkBank } from '../domain/bank-check.ts';
import { reportProblems } from '../domain/problem.ts';
import { compareIds, type Question } from '../domain/schema.ts';

function actualFileName(id: string, filePath: string | undefined): string {
  if (!filePath) throw new Error(`資料項目 ${id} 缺少檔案路徑，無法檢查檔名`);
  return basename(filePath);
}

async function load() {
  const [banks, papers] = await Promise.all([getCollection('bank'), getCollection('papers')]);

  // 檔名取自實際檔案；題庫名（題目 ID 前綴）是檔名不含副檔名
  const bankInputs = banks.map((b) => {
    const fileName = actualFileName(b.id, b.filePath);
    return { name: basename(fileName, '.yaml'), file: `bank/${fileName}`, data: b.data };
  });
  const paperInputs = papers.map((p) => ({ file: `papers/${actualFileName(p.id, p.filePath)}`, data: p.data }));
  const report = reportProblems(
    checkBank({ banks: bankInputs, papers: paperInputs, images: listImages(resolveDataDir()) }),
  );
  const details = report.lines.map((line) => `  - ${line}`).join('\n');
  if (report.failed) throw new Error(`題庫檢查發現 ${report.summary}：\n${details}`);
  if (report.lines.length > 0) console.warn(`題庫檢查發現 ${report.summary}：\n${details}`);

  const questions = buildQuestionIndex(bankInputs) as ReadonlyMap<string, Question>;
  // 題庫瀏覽頁用：所有題目，依 ID 排序
  const entries = [...questions]
    .map(([id, question]) => ({ id, question }))
    .sort((a, b) => compareIds(a.id, b.id));

  return { papers, questions, entries };
}

let loaded: ReturnType<typeof load> | undefined;

/** 檢查通過才回傳試卷、題目索引（題目 ID → 題目）與依 ID 排序的所有題目；同一次建置只算一次。 */
export function loadChecked() {
  return (loaded ??= load());
}
