import { describe, expect, it } from 'vitest';
import { checkBank, type BankInput } from '../src/domain/bank-check.ts';
import { effectiveDoubt, groupMembership, resolvePaperGroups } from '../src/domain/question-groups.ts';
import { bankFileSchema } from '../src/domain/schema.ts';

const source = { originalPaper: '自編三年級閱讀', section: '閱讀' };
const choice = (no: number) => ({ no, type: 'choice', subject: '國語', grade: 3, stem: `問題 ${no}`, options: ['甲', '乙'], answer: 1, explanation: '解析', source });
const group = { no: 1, paragraphs: ['一段短文。'], members: [1, 2], source };
const original = () => ({ questions: [choice(1), choice(2), choice(3)], groups: [group] });
const bank = (name: string, raw: unknown = original()): BankInput => ({ name, file: `bank/${name}.yaml`, data: bankFileSchema.parse(raw) });

describe('閱讀題組的題庫資料', () => {
  it('保留既有題目，允許同檔原題與共用材料', () => {
    expect(bankFileSchema.safeParse(original()).success).toBe(true);
    expect(bankFileSchema.safeParse({ questions: [choice(1)] }).success).toBe(true);
  });

  it('拒絕缺少成員、重複成員、重複組號與跨組重用', () => {
    for (const groups of [
      [{ ...group, members: [1, 9] }],
      [{ ...group, members: [1, 1] }],
      [group, { ...group, members: [3] }],
      [group, { ...group, no: 2, members: [2, 3] }],
      [{ ...group, members: [] }],
    ]) expect(bankFileSchema.safeParse({ ...original(), groups }).success).toBe(false);
  });

  it('拒絕空材料、混科目或年級、不同來源或新題', () => {
    const examples = [
      { ...original(), groups: [{ ...group, paragraphs: [] }] },
      { ...original(), groups: [{ ...group, paragraphs: [' \n\t'] }] },
      { ...original(), questions: [choice(1), { ...choice(2), subject: '數學' }] },
      { ...original(), questions: [choice(1), { ...choice(2), grade: 4 }] },
      { ...original(), questions: [choice(1), { ...choice(2), source: { originalPaper: '別份卷', number: 2 } }] },
      { ...original(), questions: [choice(1), { ...choice(2), source: undefined, derivedFrom: ['a-01'] }] },
    ];
    for (const data of examples) expect(bankFileSchema.safeParse(data).success).toBe(false);
  });

  it('同一題組可包含不同題型', () => {
    const { options: _options, ...base } = choice(2);
    expect(bankFileSchema.safeParse({ ...original(), questions: [choice(1), { ...base, type: 'true-false', answer: true }] }).success).toBe(true);
  });
});

describe('閱讀材料與組卷', () => {
  it('允許部分成員連續排列，拒絕跨大題或被其他題隔開', () => {
    const grouped = bank('a');
    const check = (sections: { title: string; questions: string[] }[]) => checkBank({ banks: [grouped], images: [], papers: [{ file: 'papers/p.yaml', data: { title: 'p', subject: '國語', grade: 3, sections } }] });
    expect(check([{ title: '一', questions: ['a-02', 'a-01', 'a-03'] }])).toEqual([]);
    expect(check([{ title: '一', questions: ['a-02'] }])).toEqual([]);
    expect(check([{ title: '一', questions: ['a-01'] }, { title: '一', questions: ['a-02'] }]).some((p) => p.severity === 'error' && p.message.includes('同一大題'))).toBe(true);
    expect(check([{ title: '一', questions: ['a-01', 'a-03', 'a-02'] }]).some((p) => p.severity === 'error' && p.message.includes('連續'))).toBe(true);
    const sections = [{ title: '一', questions: ['a-01', 'a-02'] }];
    expect(checkBank({ banks: [grouped], images: [], papers: ['p', 'q'].map((name) => ({ file: `papers/${name}.yaml`, data: { title: name, subject: '國語' as const, grade: 3, sections } })) })).toEqual([]);
  });

  it('按完整題目 ID 查材料，每份卷首次選到時印一次，支援逆序', () => {
    const membership = groupMembership([bank('a'), bank('b')]);
    const sections = [{ questions: ['a-02', 'b-01'] }, { questions: ['a-01', 'b-02'] }];
    const result = resolvePaperGroups(sections, membership);
    expect(result.map((s) => s.materials.map((m) => m?.id))).toEqual([['a#1', 'b#1'], [undefined, undefined]]);
    expect(resolvePaperGroups([{ questions: ['a-01'] }], membership)[0]?.materials[0]?.id).toBe('a#1');
    expect(resolvePaperGroups([{ questions: ['a-03'] }], membership)[0]?.materials[0]).toBeUndefined();
  });

  it('材料疑點影響所有組員，單題疑點不影響同組其他題', () => {
    const grouped = bank('a', { ...original(), groups: [{ ...group, doubt: '文章待核' }] });
    const membership = groupMembership([grouped]);
    expect(effectiveDoubt(grouped.data.questions[0]!, membership.get('a-01'))).toContain('文章待核');
    expect(effectiveDoubt(grouped.data.questions[1]!, membership.get('a-02'))).toContain('文章待核');
    expect(effectiveDoubt(grouped.data.questions[2]!, membership.get('a-03'))).toBeUndefined();
    expect(effectiveDoubt({ ...grouped.data.questions[0]!, doubt: '題目待核' }, membership.get('a-01'))).toContain('文章待核');
    const individual = bank('a', { ...original(), questions: [{ ...choice(1), doubt: '題目待核' }, choice(2), choice(3)] });
    const individualMembership = groupMembership([individual]);
    expect(effectiveDoubt(individual.data.questions[0]!, individualMembership.get('a-01'))).toBe('題目待核');
    expect(effectiveDoubt(individual.data.questions[1]!, individualMembership.get('a-02'))).toBeUndefined();
    const warnings = checkBank({ banks: [grouped], images: [], papers: [{ file: 'papers/p.yaml', data: { title: 'p', subject: '國語', grade: 3, sections: [{ title: '閱讀', questions: ['a-02'] }] } }] });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.severity).toBe('warning');
    expect(warnings[0]?.message).toContain('文章待核');
  });

  it('檢查材料圖片並拒絕從任何題組成員單題衍生', () => {
    const grouped = bank('a', { ...original(), groups: [{ ...group, image: { src: 'a/material.png', alt: '短文插圖' } }] });
    const derived = bankFileSchema.parse({ questions: [{ ...choice(1), source: undefined, derivedFrom: ['a-03', 'a-01'] }] });
    const problems = checkBank({ banks: [grouped, { name: 'new', file: 'bank/new.yaml', data: derived }], papers: [], images: [] });
    expect(problems.some((p) => p.message.includes('找不到附圖 a/material.png'))).toBe(true);
    expect(problems.some((p) => p.message.includes('題組成員 a-01'))).toBe(true);
    expect(checkBank({ banks: [grouped], papers: [], images: ['a/material.png'] })).toEqual([]);
  });
});

describe('整組衍生', () => {
  const parent = () => bank('a', { ...original(), groups: [{ ...group, members: [2, 1] }] });
  const newGroup = () => ({
    questions: [
      { ...choice(9), source: undefined, derivedFrom: ['a-01'] },
      { ...choice(11), source: undefined, derivedFrom: ['a-02'] },
    ],
    groups: [{ no: 3, paragraphs: ['另一篇文章。'], members: [11, 9], derivedFrom: 'a#1' }],
  });
  const run = (a: BankInput, n: BankInput, images: string[] = []) => checkBank({ banks: [a, n], papers: [], images });

  it('依 members 順序而非題號或儲存順序，允許完整原組一一衍生', () => {
    const a = parent();
    const n = bank('new', newGroup());
    expect(run(a, n)).toEqual([]);
    const membership = groupMembership([a, n]);
    expect(resolvePaperGroups([{ questions: ['new-09'] }, { questions: ['new-11'] }], membership).map((s) => s.materials[0]?.id)).toEqual(['new#3', undefined]);
  });

  it('題組來源必須擇一，原組與新組不得混裝', () => {
    const both = newGroup();
    expect(bankFileSchema.safeParse({ ...both, groups: [{ ...both.groups[0]!, source }] }).success).toBe(false);
    expect(bankFileSchema.safeParse({ ...both, groups: [{ no: 3, paragraphs: ['文字'], members: [11, 9] }] }).success).toBe(true);
    expect(bankFileSchema.safeParse({ ...both, groups: [{ ...both.groups[0]!, derivedFrom: [] }] }).success).toBe(false);
    expect(bankFileSchema.safeParse({ ...both, groups: [{ ...both.groups[0]!, derivedFrom: ['a#1', 'b#1'] }] }).success).toBe(false);
    expect(bankFileSchema.safeParse({ ...both, questions: [choice(9), both.questions[1]!] }).success).toBe(false);
  });

  it('拒絕不存在的原組、非原組、漏題及錯序或多來源', () => {
    const a = parent();
    const missing = newGroup();
    expect(run(a, bank('new', { ...missing, groups: [{ ...missing.groups[0]!, derivedFrom: 'missing#1' }] })).some((p) => p.message.includes('不存在的原題組'))).toBe(true);
    const short = newGroup();
    expect(run(a, bank('new', { ...short, groups: [{ ...short.groups[0]!, members: [11] }] })).some((p) => p.message.includes('小題數不一致'))).toBe(true);
    const swapped = newGroup();
    expect(run(a, bank('new', { ...swapped, groups: [{ ...swapped.groups[0]!, members: [9, 11] }] })).some((p) => p.message.includes('須只衍生自對應的'))).toBe(true);
    const multi = newGroup();
    multi.questions[1]!.derivedFrom = ['a-02', 'a-03'];
    expect(run(a, bank('new', multi)).some((p) => p.message.includes('須只衍生自對應的'))).toBe(true);
    const n = bank('new', newGroup());
    const later = newGroup();
    later.groups[0]!.derivedFrom = 'new#3';
    later.questions[0]!.derivedFrom = ['new-09'];
    later.questions[1]!.derivedFrom = ['new-11'];
    expect(run(a, n).length).toBe(0);
    expect(checkBank({ banks: [a, n, bank('later', later)], papers: [], images: [] }).some((p) => p.message.includes('也是新題組'))).toBe(true);
  });

  it('原題組刪除或改變成員順序後，既有新組重新檢查會失敗', () => {
    const n = bank('new', newGroup());
    expect(run(parent(), n)).toEqual([]);
    const removed = bank('a', { questions: [choice(1), choice(2), choice(3)] });
    expect(run(removed, n).some((p) => p.message.includes('不存在的原題組'))).toBe(true);
    expect(run(bank('a', original()), n).some((p) => p.message.includes('須只衍生自對應的'))).toBe(true);
  });

  it('材料或任何原組員有疑點或圖片時，不得從整組衍生', () => {
    const n = bank('new', newGroup());
    const baseline = () => ({ ...original(), groups: [{ ...group, members: [2, 1] }] });
    expect(run(bank('a', baseline()), n)).toEqual([]);
    const variants = [
      { data: { ...baseline(), groups: [{ ...baseline().groups[0]!, doubt: '文章待核' }] }, expected: '有疑點' },
      { data: { ...baseline(), questions: [choice(1), { ...choice(2), doubt: '第二題待核' }] }, expected: '有疑點' },
      { data: { ...baseline(), groups: [{ ...baseline().groups[0]!, image: { src: 'a/text.png', alt: '材料圖' } }] }, expected: '衍生自有圖片的題組 a#1' },
      { data: { ...baseline(), questions: [choice(1), { ...choice(2), image: { src: 'a/item.png', alt: '題目圖' } }] }, expected: '原題組成員 a-02 有圖片' },
      { data: { ...baseline(), questions: [choice(1), { ...choice(2), options: [{ image: { src: 'a/option.png', alt: '選項圖' } }, '乙'] }] }, expected: '原題組成員 a-02 有圖片' },
    ];
    for (const { data, expected } of variants) {
      const problems = run(bank('a', data), n, ['a/text.png', 'a/item.png', 'a/option.png']);
      expect(problems.some((p) => p.severity === 'error' && p.message.includes(expected))).toBe(true);
      expect(problems.some((p) => p.message.includes('須只衍生自對應的'))).toBe(false);
    }
  });
});
