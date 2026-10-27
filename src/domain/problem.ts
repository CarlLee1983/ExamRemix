// 題庫檢查結果的共用形狀與報告方式：嚴重度、單行格式、先錯誤後警告的報告。
// 純函式，不依賴 Astro（ADR 0002）；檢查指令、建置與讀檔流程共用。

/** 錯誤讓檢查指令與建置失敗；警告只列出、不擋。 */
export type Severity = 'error' | 'warning';

export interface Problem {
  severity: Severity;
  /** 問題所在的檔案（相對於資料根目錄）；題目 ID 重複時列出所有出現的檔案 */
  files: string[];
  questionId?: string;
  message: string;
}

const SEVERITY_LABELS: Record<Severity, string> = { error: '錯誤', warning: '警告' };

/** 每個問題一行，開頭標出嚴重度，供建置與檢查指令共用。 */
export function formatProblem(problem: Problem): string {
  return `${SEVERITY_LABELS[problem.severity]}｜${problem.files.join('、')}：${problem.message}`;
}

/** 檢查指令與建置共用的報告：先列錯誤再列警告，摘要寫出兩者數量；有錯誤才算失敗。 */
export function reportProblems(problems: readonly Problem[]): { lines: string[]; summary: string; failed: boolean } {
  const errors = problems.filter((p) => p.severity === 'error');
  const warnings = problems.filter((p) => p.severity === 'warning');
  return {
    lines: [...errors, ...warnings].map(formatProblem),
    summary: `${errors.length} 個錯誤、${warnings.length} 個警告`,
    failed: errors.length > 0,
  };
}
