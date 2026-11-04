import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { stringify } from 'yaml';

const source = { originalPaper: '自編社區閱讀', section: '閱讀' };
const original = () => ({
  groups: [{ no: 7, paragraphs: ['小安在圖書館借書，也在公園種樹。'], members: [3, 8], source }],
  questions: [
    { no: 3, type: 'choice', subject: '社會', grade: 3, unit: '社區', stem: '小安在哪裡借書？', options: ['圖書館', '郵局'], answer: 1, explanation: '短文說在圖書館借書。', source },
    { no: 8, type: 'true-false', subject: '社會', grade: 3, stem: '小安在公園種樹。', answer: true, explanation: '短文有寫種樹。', source },
  ],
});
const derived = () => ({
  groups: [{ no: 2, paragraphs: ['小文在圖書館閱讀，也在公園散步。'], members: [11, 12], derivedFrom: 'original#7' }],
  questions: original().questions.map(({ source: _source, ...question }, i) => ({ ...question, no: i + 11, stem: i === 0 ? '小文在哪裡閱讀？' : '小文在公園散步。', explanation: '依新短文作答。', derivedFrom: [`original-${i === 0 ? '03' : '08'}`] })),
});
let directory: string;
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'examremix-derived-groups-'));
  mkdirSync(join(directory, 'bank'));
  mkdirSync(join(directory, 'papers'));
});
afterEach(() => rmSync(directory, { recursive: true, force: true }));
function write(name: string, data: unknown) {
  writeFileSync(join(directory, 'bank', `${name}.yaml`), stringify(data));
}
function run() {
  const result = spawnSync(process.execPath, ['scripts/check-bank.ts', directory], { encoding: 'utf8' });
  return { status: result.status, output: result.stdout + result.stderr };
}

describe('check:bank 整組衍生新題', () => {
  it('接受跨檔整組衍生、混合題型與非連續題號，原題組可省略材料來源', () => {
    const data = original();
    const { source: _source, ...group } = data.groups[0]!;
    write('original', { ...data, groups: [group] });
    write('new', derived());
    writeFileSync(join(directory, 'papers/subset.yaml'), stringify({ title: '新材料節選', subject: '社會', grade: 3, sections: [{ title: '閱讀', questions: ['new-12'] }] }));
    const result = run();
    expect(result.output).toContain('2 個題庫檔、1 份試卷檔，0 個錯誤、0 個警告');
    expect(result.status).toBe(0);
  });

  it('來源題組不存在時報錯，指出新題組與來源識別', () => {
    write('original', original());
    const data = derived();
    write('new', { ...data, groups: [{ ...data.groups[0], derivedFrom: 'original#99' }] });
    const result = run();
    expect(result.status).toBe(1);
    expect(result.output).toContain('bank/new.yaml');
    expect(result.output).toContain('新題組 new#2');
    expect(result.output).toContain('不存在的原題組 original#99');
  });


  it('拒絕從新題組或材料有疑點的原題組衍生', () => {
    write('original', original());
    write('new', derived());
    const data = derived();
    write('third', { ...data, groups: [{ ...data.groups[0], derivedFrom: 'new#2' }], questions: data.questions.map((q, i) => ({ ...q, derivedFrom: [`new-${i + 11}`] })) });
    expect(run().output).toContain('新題組 third#2 衍生自 new#2，但它也是新題組');
    rmSync(join(directory, 'bank/third.yaml'));
    const originalData = original();
    write('original', { ...originalData, groups: [{ ...originalData.groups[0], doubt: '材料模糊' }] });
    const result = run();
    expect(result.status).toBe(1);
    expect(result.output).toContain('原題組 original#7 有疑點：材料模糊');
  });


  it('整組成員須等長且依序一對一記錄原題，不能只挑部分或混用其他來源', () => {
    write('original', original());
    const data = derived();
    write('new', { ...data, groups: [{ ...data.groups[0], members: [11] }], questions: [data.questions[0]] });
    expect(run().output).toContain('新題組 new#2 與原題組 original#7 的小題數不一致');
    write('new', { ...data, groups: [{ ...data.groups[0], members: [12, 11] }] });
    expect(run().output).toContain('成員 new-12 須只衍生自對應的 original-03');
    write('other', original());
    write('new', { ...data, questions: data.questions.map((q, i) => i === 0 ? { ...q, derivedFrom: ['original-03', 'other-03'] } : q) });
    expect(run().output).toContain('成員 new-11 須只衍生自對應的 original-03');
  });


  it('原題組成員不能獨立衍生或藏在沒有衍生來源的題組，材料疑點同樣生效', () => {
    const originalData = original();
    write('original', { ...originalData, groups: [{ ...originalData.groups[0], doubt: '材料有誤' }] });
    const data = derived();
    write('new', { questions: [data.questions[0]] });
    let result = run();
    expect(result.status).toBe(1);
    expect(result.output).toContain('新題 new-11 衍生自題組成員 original-03，必須與整個原題組一一對應');
    expect(result.output).toContain('材料有誤');
    const { derivedFrom: _derivedFrom, ...group } = data.groups[0]!;
    write('new', { ...data, groups: [group] });
    expect(run().status).toBe(1);
    write('original', original());
    write('new', { ...data, groups: [{ ...group, derivedFrom: 'other#7' }] });
    write('other', original());
    expect(run().output).toContain('新題 new-11 衍生自題組成員 original-03');
  });


  it.each([
    ['陣列來源', { derivedFrom: ['original#7'] }, 'derivedFrom'],
    ['不合法識別', { derivedFrom: 'original-03' }, 'derivedFrom'],
    ['空白來源', { derivedFrom: ' ' }, 'derivedFrom'],
    ['同時有原卷來源', { source }, 'derivedFrom'],
  ])('拒絕%s，定位題組欄位', (_label, patch, field) => {
    write('original', original());
    const data = derived();
    write('new', { ...data, groups: [{ ...data.groups[0], ...patch }] });
    const result = run();
    expect(result.status).toBe(1);
    expect(result.output).toContain(`groups.0.${field}`);
  });

  it('新題組成員須為新題，不能拿原題直接填入', () => {
    write('original', original());
    const data = derived();
    const { derivedFrom: _derivedFrom, ...question } = data.questions[0]!;
    write('new', { ...data, questions: [{ ...question, source }, data.questions[1]] });
    const result = run();
    expect(result.status).toBe(1);
    expect(result.output).toContain('groups.0.members.0');
    expect(result.output).toContain('新題組成員須為新題');
  });


  it.each(['題型', '科目', '年級', '單元'])('成員%s不一致時沿用逐題衍生錯誤訊息', (field) => {
    write('original', original());
    const data = derived();
    const questions = data.questions.map((q, i) => {
      if (field === '題型' && i === 0) return { ...q, type: 'true-false', options: undefined, answer: true };
      if (field === '科目') return { ...q, subject: '數學' };
      if (field === '年級') return { ...q, grade: 4 };
      if (field === '單元' && i === 0) return { ...q, unit: '家庭' };
      return q;
    });
    write('new', { ...data, questions });
    const result = run();
    expect(result.status).toBe(1);
    expect(result.output).toContain(`新題 new-11 與原題 original-03 的${field}（新題`);
  });

  it('保留沒有單元的比較與原題成員疑點檢查，其他成員有疑點時整組也無法衍生', () => {
    const originalData = original();
    write('original', { ...originalData, questions: originalData.questions.map((q, i) => i === 1 ? { ...q, doubt: '答案待核對' } : q) });
    const data = derived();
    write('new', { ...data, questions: data.questions.map((q, i) => i === 1 ? { ...q, unit: '社區' } : q) });
    const result = run();
    expect(result.status).toBe(1);
    expect(result.output).toContain('新題 new-12 與原題 original-08 的單元（新題 社區，原題 無）');
    expect(result.output).toContain('原題 original-08：答案待核對');
  });

  it('不在題組內的原題仍可以個別衍生', () => {
    const originalData = original();
    write('original', { questions: [originalData.questions[0]] });
    write('new', { questions: [derived().questions[0]] });
    expect(run().status).toBe(0);
  });

});
