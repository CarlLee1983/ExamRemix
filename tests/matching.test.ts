import { describe, expect, it } from 'vitest';
import { checkBank } from '../src/domain/bank-check';
import { bankFileSchema, questionSchema } from '../src/domain/schema';

const base = {
  no: 1,
  type: 'matching',
  subject: '英語',
  grade: 3,
  unit: '配對練習',
  stem: '把左欄與右欄的項目連起來。',
  explanation: '依照詞義配對。',
  source: { originalPaper: '自編練習', section: '連連看' },
  left: ['tree', 'sun', 'moon'],
  right: [{ image: { src: 'matching/tree.svg', alt: '一棵樹' } }, '太陽', '月亮'],
  answer: [1, 2, 3],
};

const canonical = (raw: Record<string, unknown>) => {
  const { answer, left, right, ...rest } = raw;
  if (!Array.isArray(answer) || !Array.isArray(left) || !Array.isArray(right)) throw new Error('invalid test fixture');
  return { ...rest, mode: 'one-to-one',
    left: left.map((content, i) => ({ content, answer: String(answer[i] ?? '') })),
    right: right.map((content, i) => ({ code: String(i + 1), content })),
  };
};
const paths = (question: Record<string, unknown>) => {
  const result = questionSchema.safeParse(canonical(question));
  return result.success ? [] : result.error.issues.map((issue) => issue.path.join('.').replace(/^left\.(\d+)\.answer$/, 'answer.$1').replace(/\.content$/, ''));
};

describe('配對連線題', () => {
  it('接受完整的一對一配對，兩欄均可使用文字或圖片', () => {
    expect(questionSchema.safeParse(canonical(base)).success).toBe(true);
    expect(questionSchema.safeParse(canonical({ ...base, left: ['甲', { image: { src: 'matching/star.svg', alt: '星星' } }], right: ['一', '二'], answer: [2, 1] })).success).toBe(true);
    const ten = Array.from({ length: 10 }, (_, i) => `第${i + 1}項`);
    expect(questionSchema.safeParse(canonical({ ...base, left: ten, right: ten, answer: ten.map((_, i) => i + 1) })).success).toBe(true);
    expect(questionSchema.safeParse(canonical({ ...base, left: [...ten, '第11項'], right: [...ten, '第11項'], answer: Array.from({ length: 11 }, (_, i) => i + 1) })).success).toBe(false);
    const { left: _left, right: _right, ...choiceBase } = base;
    expect(questionSchema.safeParse({ ...choiceBase, type: 'choice', options: ten.slice(0, 6), answer: 1 }).success).toBe(true);
    expect(questionSchema.safeParse({ ...choiceBase, type: 'choice', options: ten.slice(0, 7), answer: 1 }).success).toBe(false);
    expect(questionSchema.safeParse({ ...choiceBase, type: 'multi-select', options: ten.slice(0, 7), answer: [1] }).success).toBe(false);
  });

  it('拒絕缺項、越界、重複答案及重複的欄內選項', () => {
    expect(paths({ ...base, right: ['一', '二'] })).toContain('right');
    expect(paths({ ...base, answer: [1, 2] })).toContain('answer.2');
    expect(paths({ ...base, answer: [1, 2, 4] })).toContain('answer.2');
    expect(paths({ ...base, answer: [1, 1, 3] })).toContain('answer.1');
    expect(paths({ ...base, left: ['tree', 'tree', 'moon'] })).toContain('left.1');
    expect(paths({ ...base, left: ['tree', '  ', 'moon'] })).toContain('left.1');
    expect(paths({ ...base, left: ['apple tree', { text: 'apple\n tree ' }, 'moon'] })).toContain('left.1');
    expect(paths({ ...base, right: ['太陽', { text: '太陽  ' }, '月亮'] })).toContain('right.1');
    expect(paths({ ...base, right: [base.right[0], base.right[0], '月亮'] })).toContain('right.1');
    expect(questionSchema.safeParse(canonical({ ...base, answerText: 'ignored' })).success).toBe(false);
  });

  it('核對兩欄的圖片，並阻止從有圖的配對原題衍生', () => {
    const original = bankFileSchema.parse({ questions: [canonical(base)] });
    const derived = bankFileSchema.parse({ questions: [canonical({ ...base, source: undefined, derivedFrom: ['original-01'], right: ['樹', '太陽', '月亮'] })] });
    const banks = [
      { name: 'original', file: 'bank/original.yaml', data: original },
      { name: 'new', file: 'bank/new.yaml', data: derived },
    ];
    const missing = checkBank({ banks, papers: [], images: [] });
    expect(missing.some((problem) => problem.message.includes('matching/tree.svg'))).toBe(true);
    expect(missing.some((problem) => problem.message.includes('不可由圖題衍生'))).toBe(true);
    const withImage = checkBank({ banks, papers: [], images: ['matching/tree.svg'] });
    expect(withImage).toHaveLength(1);
    expect(withImage[0]?.message).toContain('不可由圖題衍生');
  });
});
