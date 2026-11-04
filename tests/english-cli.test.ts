import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { stringify } from 'yaml';

it('英語題目與試卷是合法科目，方括號跳脫與中文注音可以並用', () => {
  const directory = mkdtempSync(join(tmpdir(), 'examremix-english-'));
  try {
    mkdirSync(join(directory, 'bank'));
    mkdirSync(join(directory, 'papers'));
    writeFileSync(join(directory, 'bank/english.yaml'), stringify({ questions: [{ no: 1, type: 'choice', subject: '英語', grade: 3, stem: '[圈選|ㄑㄩㄢ ㄒㄩㄢˇ] \\[is|are].', options: ['is', 'are'], answer: 1, explanation: 'It is a tree.', source: { originalPaper: '自編英語', number: 1 } }] }));
    writeFileSync(join(directory, 'papers/english.yaml'), stringify({ title: '英語練習', subject: '英語', grade: 3, sections: [{ title: '圈選', questions: ['english-01'] }] }));
    const result = spawnSync(process.execPath, ['scripts/check-bank.ts', directory], { encoding: 'utf8' });
    expect(result.stdout + result.stderr).toContain('1 個題庫檔、1 份試卷檔，0 個錯誤、0 個警告');
    expect(result.status).toBe(0);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
