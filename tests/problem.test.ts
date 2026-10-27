import { describe, expect, it } from 'vitest';
import { formatProblem, reportProblems, type Problem } from '../src/domain/problem.ts';

describe('formatProblem', () => {
  it('格式化輸出標出錯誤或警告', () => {
    const base = { files: ['bank/a.yaml'], message: '說明' };
    expect(formatProblem({ ...base, severity: 'error' })).toBe('錯誤｜bank/a.yaml：說明');
    expect(formatProblem({ ...base, severity: 'warning' })).toBe('警告｜bank/a.yaml：說明');
  });
});

describe('reportProblems', () => {
  const error = (message: string): Problem => ({ severity: 'error', files: ['bank/a.yaml'], message });
  const warning = (message: string): Problem => ({ severity: 'warning', files: ['bank/a.yaml'], message });

  it('先列錯誤再列警告，摘要寫出兩者數量，有錯誤才算失敗', () => {
    const report = reportProblems([warning('w1'), error('e1'), warning('w2'), error('e2')]);
    expect(report.lines).toEqual([
      '錯誤｜bank/a.yaml：e1',
      '錯誤｜bank/a.yaml：e2',
      '警告｜bank/a.yaml：w1',
      '警告｜bank/a.yaml：w2',
    ]);
    expect(report.summary).toBe('2 個錯誤、2 個警告');
    expect(report.failed).toBe(true);
  });

  it('只有警告時不算失敗（建置與檢查指令都不因警告失敗）', () => {
    const report = reportProblems([warning('w1')]);
    expect(report.summary).toBe('0 個錯誤、1 個警告');
    expect(report.failed).toBe(false);
  });

  it('沒有問題時不算失敗', () => {
    expect(reportProblems([])).toEqual({ lines: [], summary: '0 個錯誤、0 個警告', failed: false });
  });
});
