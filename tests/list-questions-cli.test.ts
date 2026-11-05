// 列出題目指令：實際以子行程執行 pnpm list:questions，驗證輸出與結束狀態。
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
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
    expect(first.slice(1, 6)).toEqual(['choice', '數學', '3', '乘法', '-']);
    expect(first[6]).toBe('3 × 4 等於多少？');
  });

  it('沒給參數時預設讀 examples/', () => {
    expect(run('--id', 'sample-math-01').rows).toHaveLength(1);
  });

  it('過濾條件以 AND 組合：科目、題型與疑點', () => {
    const { rows } = run('examples', '--subject', '數學', '--type', 'choice', '--doubt');
    expect(rows.map((r) => r[0])).toEqual(['sample-math-22']);
    expect(new Set(rows.map((r) => r[5]))).toEqual(new Set(['doubt']));
  });

  it('重複同一個旗標是 OR；--no-doubt 排除有疑點的題目', () => {
    const { rows } = run('examples', '--subject', '數學', '--type', 'true-false', '--type', 'fill-blank', '--no-doubt');
    expect(rows.length).toBeGreaterThan(0);
    expect(new Set(rows.map((r) => r[1]))).toEqual(new Set(['true-false', 'fill-blank']));
    expect(new Set(rows.map((r) => r[5]))).toEqual(new Set(['-']));
  });

  it('移除的 --confirmed、--unconfirmed 當作不認得的旗標：結束狀態 2', () => {
    expect(run('examples', '--confirmed').status).toBe(2);
    expect(run('examples', '--unconfirmed').status).toBe(2);
  });

  it('疑點欄標出有疑點的題目：doubt 或 -', () => {
    const { rows } = run('tests/fixtures/doubt-warning');
    expect(rows.map((r) => [r[0], r[5]])).toEqual([
      ['shaky-01', 'doubt'],
      ['shaky-02', '-'],
    ]);
  });

  it('--doubt 只列有疑點的題目，--no-doubt 只列沒有疑點的題目', () => {
    expect(run('tests/fixtures/doubt-warning', '--doubt').rows.map((r) => r[0])).toEqual(['shaky-01']);
    expect(run('tests/fixtures/doubt-warning', '--no-doubt').rows.map((r) => r[0])).toEqual(['shaky-02']);
  });

  it('--doubt 與 --no-doubt 同時指定：沒有符合的題目，結束狀態 0', () => {
    const { status, lines } = run('tests/fixtures/doubt-warning', '--doubt', '--no-doubt');
    expect(status).toBe(0);
    expect(lines).toEqual([]);
  });

  it('題組材料有疑點時，成員不會列入無疑點結果', () => {
    expect(run('tests/fixtures/no-unit', '--id', 'reading-local-04', '--no-doubt').rows).toEqual([]);
    expect(run('tests/fixtures/no-unit', '--id', 'reading-local-04', '--doubt').rows.map((r) => r[5])).toEqual(['doubt']);
    expect(run('tests/fixtures/no-unit', '--id', 'reading-local-03', '--no-doubt').rows).toHaveLength(1);
  });

  it('可依配對題型篩選，仍輸出原有七欄', () => {
    const { status, rows } = run('tests/fixtures/no-unit', '--type', 'matching', '--unit', '配對練習');
    expect(status).toBe(0);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.slice(0, 6)).toEqual(['matching-local-01', 'matching', '英語', '3', '配對練習', '-']);
    expect(rows[0]).toHaveLength(7);
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

it('考試範圍旗標嚴格驗證且未知資料不被當作期中', () => {
  expect(run('tests/fixtures/no-unit','--semester','3').status).toBe(2);
  expect(run('tests/fixtures/no-unit','--stage','第一次評量').status).toBe(2);
  const unknown=run('tests/fixtures/no-unit','--semester','1','--stage','midterm','--id','unclassified-01');
  expect(unknown.status).toBe(0);
  expect(unknown.rows).toEqual([]);
});

it('範圍篩選可盤點疑點資料，只有 --eligible 才排除不合格題', () => {
  const diagnostic=run('examples','--semester','1','--stage','midterm','--doubt');
  expect(diagnostic.status).toBe(0);
  expect(diagnostic.rows.map(r=>r[0])).toEqual(['sample-math-22']);
  const eligible=run('examples','--semester','1','--stage','midterm','--eligible','--id','sample-math-22');
  expect(eligible.status).toBe(0);
  expect(eligible.rows).toEqual([]);
});

it('重複學期為 OR，單獨學期條件不能放入其他學期的題目', () => {
  const repeated=run('examples','--semester','1','--semester','2','--id','sample-math-01');
  expect(repeated.status).toBe(0);
  expect(repeated.rows.map(r=>r[0])).toEqual(['sample-math-01']);
  const other=run('examples','--semester','2','--id','sample-math-01');
  expect(other.status).toBe(0);
  expect(other.rows).toEqual([]);
});

it.each(['bad-data','bad-yaml','cross-file-problems'])('範圍查詢遇 %s 必須失敗，不能把壞快照回報成0題', dir => {
  for(const flags of [['--eligible'],['--semester','1'],['--stage','midterm']]){
    const result=run(`tests/fixtures/${dir}`,...flags);
    expect(result.status,`${dir}: ${flags.join(' ')}`).toBe(2);
    expect(result.rows).toEqual([]);
    expect(result.stderr).not.toBe('');
  }
});

it('範圍查詢允許既有警告，仍以有效疑點排除題目', () => {
  const result=run('tests/fixtures/doubt-warning','--semester','1');
  expect(result.status).toBe(0);
  expect(result.rows).toEqual([]);
});


it.each(['bank','yaml','paper'])('只有單一損毀 %s 的快照仍須拒絕，不能靠其他錯誤代擋', kind => {
  const root=mkdtempSync(join(tmpdir(),'examremix-query-invalid-'));
  mkdirSync(join(root,'bank'));mkdirSync(join(root,'papers'));
  const valid={questions:[{no:1,type:'choice',subject:'數學',grade:3,examScope:{semester:1,stage:'midterm'},stem:'1+1？',options:['2','3'],answer:1,explanation:'1+1=2',source:{originalPaper:'合成',number:1}}]};
  try {
    writeFileSync(join(root,'bank/sample.yaml'),kind==='yaml'?'questions: [':JSON.stringify(kind==='bank'?{questions:[{no:1}]}:valid));
    if(kind==='paper')writeFileSync(join(root,'papers/broken.yaml'),JSON.stringify({title:1}));
    const result=run(root,'--eligible');
    expect(result.status).toBe(2);
    expect(result.rows).toEqual([]);
    expect(result.stderr).toContain('資料載入／驗證失敗');
  } finally {rmSync(root,{recursive:true,force:true});}
});
