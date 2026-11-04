import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { stringify } from 'yaml';

const classification = () => ({
  no: 1,
  type: 'classification',
  subject: '社會',
  grade: 3,
  stem: '將各項活動歸入適合的類別。',
  categories: [{ name: '家庭', symbol: '△' }, { name: '學校', symbol: '○' }, { name: '社區', symbol: '□' }],
  statements: [{ text: '和家人一起整理客廳。', answer: 1 }, { text: '參加班會討論。', answer: 2 }, { text: '參加社區清潔活動。', answer: 3 }],
  explanation: '家務屬於家庭，班會屬於學校，社區清潔屬於社區。',
  source: { originalPaper: '自編三年級社會分類題', number: 1 },
});
let directory: string;
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'examremix-classification-'));
  mkdirSync(join(directory, 'bank'));
  mkdirSync(join(directory, 'papers'));
});
afterEach(() => rmSync(directory, { recursive: true, force: true }));
function writeQuestion(question: unknown = classification()) {
  writeFileSync(join(directory, 'bank/sample.yaml'), stringify({ questions: [question] }));
  writeFileSync(join(directory, 'papers/sample.yaml'), stringify({ title: '分類練習', subject: '社會', grade: 3, sections: [{ title: '分類題', questions: ['sample-01'] }] }));
}
function run() {
  const result = spawnSync(process.execPath, ['scripts/check-bank.ts', directory], { encoding: 'utf8' });
  return { status: result.status, output: result.stdout + result.stderr };
}

describe('check:bank 分類題', () => {
  it('允許三個類別及多個敘述，整道分類題由一個題目 ID 引用', () => {
    writeQuestion();
    const result = run();
    expect(result.output).toContain('1 個題庫檔、1 份試卷檔，0 個錯誤、0 個警告');
    expect(result.status).toBe(0);
  });

  it.each([0, -1, 1.5, 4, '1', null])('拒絕不存在或非法的類別編號 %s，指出答案欄位', (answer) => {
    const data = classification();
    writeQuestion({ ...data, statements: [{ text: '敘述。', answer }] });
    const result = run();
    expect(result.status).toBe(1);
    expect(result.output).toContain('bank/sample.yaml');
    expect(result.output).toContain('questions.0.statements.0.answer');
  });

  it.each([0, 1])('類別只有 %s 個時報錯', (count) => {
    writeQuestion({ ...classification(), categories: classification().categories.slice(0, count) });
    const result = run();
    expect(result.status).toBe(1);
    expect(result.output).toContain('questions.0.categories');
  });


  it.each([
    ['空敘述', { ...classification(), statements: [] }, 'statements'],
    ['空白敘述', { ...classification(), statements: [{ text: ' \t ', answer: 1 }] }, 'statements.0.text'],
    ['空白類別名稱', { ...classification(), categories: [{ name: '  ', symbol: '△' }, { name: '學校', symbol: '○' }] }, 'categories.0.name'],
    ['空白作答符號', { ...classification(), categories: [{ name: '家庭', symbol: '  ' }, { name: '學校', symbol: '○' }] }, 'categories.0.symbol'],
    ['重複類別名稱', { ...classification(), categories: [{ name: '家庭', symbol: '△' }, { name: ' 家庭 ', symbol: '○' }] }, 'categories.1.name'],
    ['重複作答符號', { ...classification(), categories: [{ name: '家庭', symbol: '△' }, { name: '學校', symbol: ' △ ' }] }, 'categories.1.symbol'],
    ['Unicode等價符號', { ...classification(), categories: [{ name: '家庭', symbol: 'é' }, { name: '學校', symbol: 'e\u0301' }] }, 'categories.1.symbol'],
  ])('拒絕%s，指出對應欄位', (_label, data, field) => {
    writeQuestion(data);
    const result = run();
    expect(result.status).toBe(1);
    expect(result.output).toContain(`questions.0.${field}`);
  });

});
