// 較慢的整合測試：實際跑 astro build，驗證資料有誤時建置失敗並指出檔案、欄位或路徑。
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

const tmpRoot = mkdtempSync(join(tmpdir(), 'examremix-build-'));
afterAll(() => rmSync(tmpRoot, { recursive: true, force: true }));

function build(dataDir: string) {
  const result = spawnSync('pnpm', ['exec', 'astro', 'build', '--outDir', join(tmpRoot, 'dist')], {
    env: { ...process.env, EXAMREMIX_DATA_DIR: dataDir },
    encoding: 'utf8',
  });
  return { status: result.status, output: `${result.stdout}\n${result.stderr}` };
}

describe('astro build 遇到壞掉的題庫檔', () => {
  it('以非零狀態結束，並指出檔名與出錯欄位', () => {
    const { status, output } = build(resolve('tests/fixtures/bad-data'));

    expect(status).not.toBe(0);
    expect(output).toContain('broken.yaml');
    expect(output).toContain('questions.0.answer');
  }, 120_000);
});

describe('astro build 遇到不完整的資料目錄', () => {
  it('資料目錄不存在時失敗，並指出該路徑', () => {
    const missing = join(tmpRoot, 'no-such-dir');
    const { status, output } = build(missing);

    expect(status).not.toBe(0);
    expect(output).toContain(missing);
  }, 120_000);

  it('缺 papers/ 時失敗，並指出缺的子目錄', () => {
    const dataDir = join(tmpRoot, 'bank-only');
    mkdirSync(join(dataDir, 'bank'), { recursive: true });
    const { status, output } = build(dataDir);

    expect(status).not.toBe(0);
    expect(output).toContain(join(dataDir, 'papers'));
  }, 120_000);
});
