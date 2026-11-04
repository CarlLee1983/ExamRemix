import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { stringify } from 'yaml';

const matching = () => ({
  no: 1,
  type: 'matching',
  subject: '社會',
  grade: 3,
  stem: '將左欄活動和適合的場所連起來。',
  left: [{ content: '借閱圖書。', answer: '甲' }, { content: '整理公園環境。', answer: '乙' }, { content: '在館內閱讀。', answer: '甲' }],
  right: [{ code: '甲', content: '圖書館' }, { code: '乙', content: '公園' }, { code: '丙', content: '郵局' }, { code: '丁', content: { image: { src: 'library.svg', alt: '圖書館示意圖' } } }],
  explanation: '借閱與閱讀在圖書館，整理公園環境在公園。',
  source: { originalPaper: '自編社區活動', number: 1 },
});
let directory: string;
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'examremix-matching-'));
  mkdirSync(join(directory, 'bank'));
  mkdirSync(join(directory, 'papers'));
});
afterEach(() => rmSync(directory, { recursive: true, force: true }));
function writeQuestion(question: unknown = matching()) {
  writeFileSync(join(directory, 'bank/sample.yaml'), stringify({ questions: [question] }));
  writeFileSync(join(directory, 'papers/sample.yaml'), stringify({ title: '配對練習', subject: '社會', grade: 3, sections: [{ title: '配對題', questions: ['sample-01'] }] }));
  writeFileSync(join(directory, 'bank/library.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
}
function run() {
  const result = spawnSync(process.execPath, ['scripts/check-bank.ts', directory], { encoding: 'utf8' });
  return { status: result.status, output: result.stdout + result.stderr };
}

describe('check:bank 配對題', () => {
  it('接受文字／圖片答案池，允許同一代號多次作答及未使用項目，兩欄數量可不同', () => {
    writeQuestion();
    const result = run();
    expect(result.output).toContain('1 個題庫檔、1 份試卷檔，0 個錯誤、0 個警告');
    expect(result.status).toBe(0);
  });

  it('拒絕指向不存在代號的答案，指出題庫、左側題目與答案欄位', () => {
    writeQuestion({ ...matching(), left: [{ content: '借書。', answer: '戊' }] });
    const result = run();
    expect(result.status).toBe(1);
    expect(result.output).toContain('bank/sample.yaml');
    expect(result.output).toContain('questions.0.left.0.answer');
    expect(result.output).toContain('戊');
  });


  it('拒絕答案池重複代號，前後空白不會偽裝成另一代號', () => {
    writeQuestion({ ...matching(), right: [...matching().right, { code: ' 甲 ', content: '另一個場所' }] });
    const result = run();
    expect(result.status).toBe(1);
    expect(result.output).toContain('questions.0.right.4.code');
    expect(result.output).toContain('代號不可重複');
  });


  it('檢查題幹、左側及未使用答案池項目的所有圖片，補齊後通過', () => {
    const data = matching();
    writeQuestion({ ...data, image: { src: 'stem.svg', alt: '題圖' }, left: [{ content: { text: '借書', image: { src: 'left.svg', alt: '借書示意圖' } }, answer: '甲' }] });
    rmSync(join(directory, 'bank/library.svg'));
    const missing = run();
    expect(missing.status).toBe(1);
    expect(missing.output).toContain('stem.svg');
    expect(missing.output).toContain('left.svg');
    expect(missing.output).toContain('library.svg');
    expect(missing.output).toContain('3 個錯誤、0 個警告');
    for (const name of ['stem.svg', 'left.svg', 'library.svg']) {
      writeFileSync(join(directory, 'bank', name), '<svg xmlns="http://www.w3.org/2000/svg"/>');
    }
    expect(run().status).toBe(0);
  });


  it('答案池重排不影響代號引用；代號與答案一起去除前後空白並正規化 Unicode', () => {
    writeQuestion({ ...matching(), right: [...matching().right].reverse() });
    expect(run().status).toBe(0);
    writeQuestion({ ...matching(), left: [{ content: '文字', answer: ' e\u0301 ' }], right: [{ code: 'é', content: '內容' }] });
    expect(run().status).toBe(0);
  });

  it('Unicode 等價代號不能在答案池出現兩次', () => {
    writeQuestion({ ...matching(), right: [...matching().right, { code: 'é', content: '一' }, { code: 'e\u0301', content: '二' }] });
    const result = run();
    expect(result.status).toBe(1);
    expect(result.output).toContain('right.5.code');
  });

  it.each([
    ['空左欄', { ...matching(), left: [] }, 'left'],
    ['空答案池', { ...matching(), right: [] }, 'right'],
    ['空白答案', { ...matching(), left: [{ content: '文字', answer: ' \t ' }] }, 'left.0.answer'],
    ['空白代號', { ...matching(), right: [{ code: ' ', content: '文字' }] }, 'right.0.code'],
    ['數字代號', { ...matching(), right: [{ code: 1, content: '文字' }] }, 'right.0.code'],
    ['空內容', { ...matching(), left: [{ content: {}, answer: '甲' }] }, 'left.0.content'],
    ['錯誤注音', { ...matching(), left: [{ content: '[字|ABC]', answer: '甲' }] }, 'left.0.content'],
    ['不安全圖片', { ...matching(), right: [{ code: '甲', content: { image: { src: '../private.svg', alt: '圖' } } }] }, 'right.0.content'],
  ])('拒絕%s，錯誤指出對應欄位', (_label, data, field) => {
    writeQuestion(data);
    const result = run();
    expect(result.status).toBe(1);
    expect(result.output).toContain(`questions.0.${field}`);
  });

  it('不沿用一對一或十項上限，單一配對及更多項目皆可保存', () => {
    writeQuestion({ ...matching(), left: [{ content: '題目', answer: '甲' }], right: [{ code: '甲', content: '答案' }] });
    expect(run().status).toBe(0);
    writeQuestion({ ...matching(), left: Array.from({ length: 11 }, (_, i) => ({ content: `活動${i + 1}`, answer: '甲' })) });
    expect(run().status).toBe(0);
  });

});
