// 檢查指令：實際以子行程執行 pnpm check:bank，驗證結束狀態與輸出。
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function run(...args: string[]) {
  const result = spawnSync('pnpm', ['--silent', 'check:bank', ...args], {
    env: { ...process.env, EXAMREMIX_DATA_DIR: '' },
    encoding: 'utf8',
  });
  return { status: result.status, output: `${result.stdout}\n${result.stderr}` };
}

describe('pnpm check:bank', () => {
  it('範例資料通過：結束狀態 0', () => {
    const { status, output } = run('examples');
    expect(output).toContain('沒有問題');
    expect(status).toBe(0);
  });

  it('沒給參數也沒有環境變數時，預設檢查 examples/', () => {
    expect(run().status).toBe(0);
  });

  it('環境變數 EXAMREMIX_DATA_DIR 指定資料目錄', () => {
    const result = spawnSync('pnpm', ['--silent', 'check:bank'], {
      env: { ...process.env, EXAMREMIX_DATA_DIR: 'tests/fixtures/cross-file-problems' },
      encoding: 'utf8',
    });
    expect(result.status).toBe(1);
  });

  it('跨檔問題：結束狀態 1，每個問題列出檔案與題目 ID', () => {
    const { status, output } = run('tests/fixtures/cross-file-problems');
    expect(status).toBe(1);
    expect(output).toContain('papers/bad-refs.yaml');
    expect(output).toContain('draft-02');
    expect(output).toContain('draft-99');
    expect(output).toContain('2 個問題');
  });

  it('schema 錯誤：結束狀態 1，輸出檔案與欄位', () => {
    const { status, output } = run('tests/fixtures/bad-data');
    expect(status).toBe(1);
    expect(output).toContain('bank/broken.yaml');
    expect(output).toContain('questions.0.answer');
  });

  it('檔名不合格的題庫檔：結束狀態 1，指出檔名', () => {
    const { status, output } = run('tests/fixtures/bad-file-name');
    expect(status).toBe(1);
    expect(output).toContain('bank/Sample_Math.yaml');
    expect(output).toContain('檔名不合格');
  });

  it('a b.yaml 與 a-b.yaml 並存：結束狀態 1，指出檔名不合格的那個', () => {
    const { status, output } = run('tests/fixtures/colliding-names');
    expect(status).toBe(1);
    expect(output).toContain('bank/a b.yaml');
    expect(output).not.toContain('bank/a-b.yaml');
  });

  it('YAML 語法錯誤：結束狀態 1，指出檔案', () => {
    const { status, output } = run('tests/fixtures/bad-yaml');
    expect(status).toBe(1);
    expect(output).toContain('bank/broken-syntax.yaml');
    expect(output).toContain('YAML 格式錯誤');
  });

  it('資料目錄不存在：非零結束並說明路徑', () => {
    const missing = join('tests', 'fixtures', 'no-such-dir');
    const { status, output } = run(missing);
    expect(status).not.toBe(0);
    expect(output).toContain(missing);
  });

  it('缺 papers/ 目錄：非零結束並說明路徑', () => {
    // bad-data 底下的 bank/ 存在；用一個只有 bank/ 的目錄
    const { status, output } = run('tests/fixtures/cross-file-problems/bank');
    expect(status).not.toBe(0);
    expect(output).toContain(join('tests/fixtures/cross-file-problems/bank', 'bank'));
  });
});
