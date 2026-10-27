// 列出題目指令：實際以子行程執行 pnpm list:questions，驗證輸出與結束狀態。
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function run(...args: string[]) {
  const result = spawnSync('pnpm', ['--silent', 'list:questions', ...args], {
    env: { ...process.env, EXAMREMIX_DATA_DIR: '' },
    encoding: 'utf8',
  });
  const lines = result.stdout.split('\n').filter((line) => line !== '');
  return { status: result.status, lines, rows: lines.map((line) => line.split('\t')), stderr: result.stderr };
}

describe('pnpm list:questions', () => {
  it('沒有過濾條件時列出全部題目，每題一行、七個以 tab 分隔的欄位', () => {
    const { status, rows } = run('examples');
    expect(status).toBe(0);
    expect(rows.length).toBeGreaterThan(40);
    for (const row of rows) expect(row).toHaveLength(7);
    const first = rows.find((r) => r[0] === 'sample-math-01')!;
    expect(first.slice(1, 6)).toEqual(['choice', '數學', '3', '乘法', 'confirmed']);
    expect(first[6]).toBe('3 × 4 等於多少？');
  });

  it('沒給參數時預設讀 examples/', () => {
    expect(run('--id', 'sample-math-01').rows).toHaveLength(1);
  });

  it('過濾條件以 AND 組合：科目、題型與未確認', () => {
    const { rows } = run('examples', '--subject', '數學', '--type', 'choice', '--unconfirmed');
    expect(rows.map((r) => r[0])).toEqual(['sample-math-22']);
    expect(rows[0]![5]).toBe('unconfirmed');
  });

  it('重複同一個旗標是 OR；--confirmed 排除未確認的題目', () => {
    const { rows } = run('examples', '--subject', '數學', '--type', 'true-false', '--type', 'fill-blank', '--confirmed');
    expect(rows.length).toBeGreaterThan(0);
    expect(new Set(rows.map((r) => r[1]))).toEqual(new Set(['true-false', 'fill-blank']));
    expect(new Set(rows.map((r) => r[5]))).toEqual(new Set(['confirmed']));
  });

  it('--grade 與 --unit 過濾；沒有單元的題目以 - 顯示', () => {
    const { rows } = run('examples', '--grade', '3', '--unit', '乘法');
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row.slice(3, 5)).toEqual(['3', '乘法']);
    const all = run('examples').rows;
    expect(all.every((r) => r[4] !== '')).toBe(true);
  });

  it('--unit - 只列出沒有單元的題目，與輸出的 - 一致', () => {
    const { rows } = run('tests/fixtures/no-unit', '--unit', '-');
    expect(rows.map((r) => [r[0], r[4]])).toEqual([['loose-01', '-']]);
    // 與其他單元用重複旗標組成 OR
    expect(run('tests/fixtures/no-unit', '--unit', '-', '--unit', '乘法').rows.map((r) => r[0])).toEqual([
      'loose-01',
      'loose-02',
    ]);
    expect(run('tests/fixtures/no-unit', '--unit', '乘法').rows.map((r) => r[0])).toEqual(['loose-02']);
  });

  it('--id 只列出該題；重複旗標可列多題', () => {
    expect(run('examples', '--id', 'sample-math-05').rows.map((r) => r[0])).toEqual(['sample-math-05']);
    expect(run('examples', '--id', 'sample-math-05', '--id', 'sample-math-06').rows.map((r) => r[0])).toEqual([
      'sample-math-05',
      'sample-math-06',
    ]);
  });

  it('沒有符合的題目：沒有輸出，結束狀態仍是 0', () => {
    const { status, lines } = run('examples', '--id', 'no-such-01');
    expect(status).toBe(0);
    expect(lines).toEqual([]);
  });

  it('schema 不過的題庫檔跳過並在 stderr 提醒跑 check:bank', () => {
    const { status, stderr } = run('tests/fixtures/bad-data');
    expect(status).toBe(0);
    expect(stderr).toContain('bank/broken.yaml');
    expect(stderr).toContain('check:bank');
  });

  it('不認得的旗標：結束狀態 2', () => {
    const { status, stderr } = run('examples', '--nope');
    expect(status).toBe(2);
    expect(stderr).toContain('--nope');
  });

  it('旗標缺值或 --grade 不是整數：結束狀態 2', () => {
    expect(run('examples', '--subject').status).toBe(2);
    expect(run('examples', '--grade', 'x').status).toBe(2);
  });

  it('資料目錄不存在：結束狀態 2 並說明路徑', () => {
    const missing = join('tests', 'fixtures', 'no-such-dir');
    const { status, stderr } = run(missing);
    expect(status).toBe(2);
    expect(stderr).toContain(missing);
  });
});
