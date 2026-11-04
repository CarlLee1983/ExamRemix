import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { stringify } from 'yaml';

const source = { originalPaper: '自編社區閱讀', section: '閱讀' };
const choice = (no: number) => ({ no, type: 'choice', subject: '社會', grade: 3, stem: `問題 ${no}`, options: ['甲', '乙'], answer: 1, explanation: '解析', source });
const group = { no: 1, paragraphs: ['小安在[公園|ㄍㄨㄥ ㄩㄢˊ]種了 $2$ 棵樹。'], members: [1, 2, 3], source };
const bank = () => ({
  groups: [group],
  questions: [choice(1), { ...choice(2), type: 'true-false', options: undefined, answer: true }, choice(3), choice(4)],
});
const section = (questions: string[]) => ({ title: '閱讀', questions });
let directory: string;
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'examremix-groups-'));
  mkdirSync(join(directory, 'bank'));
  mkdirSync(join(directory, 'papers'));
});
afterEach(() => rmSync(directory, { recursive: true, force: true }));
function writeBank(data: unknown = bank(), name = 'reading') {
  writeFileSync(join(directory, 'bank', `${name}.yaml`), stringify(data));
}
function writePaper(sections = [section(['reading-02', 'reading-01'])], name = 'subset') {
  writeFileSync(join(directory, 'papers', `${name}.yaml`), stringify({ title: '社區閱讀', subject: '社會', grade: 3, sections }));
}
function run(...args: string[]) {
  const result = spawnSync(process.execPath, ['scripts/check-bank.ts', directory, ...args], { encoding: 'utf8' });
  return { status: result.status, output: result.stdout + result.stderr };
}

describe('check:bank 題組保存與組卷', () => {
  it('題組可混合題型、逆序節選部分成員，且每份卷獨立檢查', () => {
    writeBank();
    writePaper();
    writePaper([section(['reading-03'])], 'single');
    const result = run();
    expect(result.output).toContain('0 個錯誤、0 個警告');
    expect(result.status).toBe(0);
  });

  it('拒絕把題組拆到同名的不同大題，或被其他題隔開', () => {
    writeBank();
    writePaper([section(['reading-01']), section(['reading-02'])]);
    const split = run();
    expect(split.status).toBe(1);
    expect(split.output).toContain('papers/subset.yaml');
    expect(split.output).toContain('reading#1');
    expect(split.output).toContain('同一大題');
    writePaper([section(['reading-01', 'reading-04', 'reading-03'])]);
    const gap = run();
    expect(gap.status).toBe(1);
    expect(gap.output).toContain('連續排列');
  });


  it('材料疑點警告全部組員，單題疑點只警告該題且不阻擋建置', () => {
    writeBank({ ...bank(), groups: [{ ...group, doubt: '材料待核對' }] });
    writePaper();
    const material = run();
    expect(material.status).toBe(0);
    expect(material.output).toContain('0 個錯誤、2 個警告');
    expect(material.output).toMatch(/警告.*reading-01.*材料待核對/);
    expect(material.output).toMatch(/警告.*reading-02.*材料待核對/);
    writeBank({ ...bank(), questions: bank().questions.map(q => q.no === 1 ? { ...q, doubt: '題目待核對' } : q) });
    const individual = run();
    expect(individual.status).toBe(0);
    expect(individual.output).toContain('0 個錯誤、1 個警告');
    expect(individual.output).toMatch(/警告.*reading-01.*題目待核對/);
    expect(individual.output).not.toMatch(/警告.*reading-02/);
  });


  it('list:questions 的無疑點挑題排除材料有疑點的全部成員', () => {
    writeBank({ ...bank(), groups: [{ ...group, doubt: '材料待核對' }] });
    const list = (...flags: string[]) => spawnSync(process.execPath, ['scripts/list-questions.ts', directory, ...flags], { encoding: 'utf8' });
    const usable = list('--no-doubt');
    expect(usable.status).toBe(0);
    expect(usable.stdout.trim().split('\n').map(line => line.split('\t')[0])).toEqual(['reading-04']);
    const doubtful = list('--doubt');
    expect(doubtful.status).toBe(0);
    expect(doubtful.stdout.trim().split('\n').map(line => line.split('\t')[0])).toEqual(['reading-01', 'reading-02', 'reading-03']);
  });


  it('材料可省略來源欄位，組員仍各自保留題目來源', () => {
    const { source: _source, ...material } = group;
    writeBank({ ...bank(), groups: [material] });
    writePaper();
    expect(run().status).toBe(0);
  });


  it('材料附圖不存在時報錯，補齊圖片後通過', () => {
    writeBank({ ...bank(), groups: [{ ...group, image: { src: 'tree.svg', alt: '樹' } }] });
    writePaper();
    const missing = run();
    expect(missing.status).toBe(1);
    expect(missing.output).toContain('bank/reading.yaml');
    expect(missing.output).toContain('reading#1');
    expect(missing.output).toContain('tree.svg');
    writeFileSync(join(directory, 'bank/tree.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
    expect(run().status).toBe(0);
  });


  it.each([
    ['缺少成員', [{ ...group, members: [1, 99] }]],
    ['重複成員', [{ ...group, members: [1, 1] }]],
    ['跨組重用成員', [group, { ...group, no: 2, members: [3, 4] }]],
    ['重複題組號', [{ ...group, members: [1] }, { ...group, members: [2] }]],
    ['空成員', [{ ...group, members: [] }]],
    ['空材料', [{ ...group, paragraphs: [] }]],
    ['空白材料', [{ ...group, paragraphs: ['  \n\t'] }]],
    ['錯誤富文字', [{ ...group, paragraphs: ['[字|ABC]'] }]],
    ['不安全圖片路徑', [{ ...group, image: { src: '../tree.svg', alt: '樹' } }]],
  ])('拒絕%s，錯誤指出題庫與題組欄位', (_label, groups) => {
    writeBank({ ...bank(), groups });
    const result = run();
    expect(result.status).toBe(1);
    expect(result.output).toContain('bank/reading.yaml');
    expect(result.output).toContain('groups.');
  });

  it.each([
    ['科目', { ...choice(1), subject: '數學' }],
    ['年級', { ...choice(1), grade: 4 }],
    ['來源', { ...choice(1), source: { originalPaper: '別份原卷', number: 1 } }],
  ])('拒絕組員%s不一致', (_label, question) => {
    writeBank({ ...bank(), questions: [question, ...bank().questions.slice(1)] });
    expect(run().status).toBe(1);
  });

  it('不同題庫可有相同題組號，排列檢查仍識別各組', () => {
    writeBank();
    writeBank(bank(), 'other');
    writePaper([section(['reading-03', 'reading-01', 'other-02', 'other-01'])]);
    expect(run().status).toBe(0);
    writePaper([section(['reading-03', 'other-02', 'reading-01'])]);
    expect(run().output).toContain('題組 reading#1 的題目必須連續排列');
  });

});
