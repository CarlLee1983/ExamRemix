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

describe('astro build 遇到跨檔問題', () => {
  it('以非零狀態結束，並列出全部問題', () => {
    const { status, output } = build(resolve('tests/fixtures/cross-file-problems'));

    expect(status).not.toBe(0);
    expect(output).toContain('papers/bad-refs.yaml');
    expect(output).toContain('draft-99');
  }, 120_000);
});

describe('astro build 遇到不合格的檔名', () => {
  it('檔名含大寫與底線時失敗，並指出該檔名', () => {
    const { status, output } = build(resolve('tests/fixtures/bad-file-name'));

    expect(status).not.toBe(0);
    expect(output).toContain('bank/Sample_Math.yaml');
  }, 120_000);

  it('a b.yaml 與 a-b.yaml 並存時失敗，不會被 Astro 合併後放行', () => {
    const { status, output } = build(resolve('tests/fixtures/colliding-names'));

    expect(status).not.toBe(0);
    expect(output).toContain('bank/a b.yaml');
  }, 120_000);
});

describe('astro build 遇到 YAML 語法錯誤', () => {
  it('以非零狀態結束，並指出檔案', () => {
    const { status, output } = build(resolve('tests/fixtures/bad-yaml'));

    expect(status).not.toBe(0);
    expect(output).toContain('bank/broken-syntax.yaml');
  }, 120_000);
});

describe('check:bank 與 astro build 的判定一致', () => {
  const fixtures = [
    'examples',
    'tests/fixtures/bad-data',
    'tests/fixtures/bad-yaml',
    'tests/fixtures/bad-file-name',
    'tests/fixtures/colliding-names',
    'tests/fixtures/cross-file-problems',
  ];

  it.each(fixtures)('%s：兩邊同為通過或同為失敗', (dir) => {
    const cli = spawnSync('pnpm', ['--silent', 'check:bank', dir], { encoding: 'utf8' });
    const built = build(resolve(dir));

    expect(built.status === 0).toBe(cli.status === 0);
  }, 120_000);
});
