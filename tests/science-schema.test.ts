import { describe, expect, it } from 'vitest';
import { checkBank } from '../src/domain/bank-check';
import { bankFileSchema, questionSchema } from '../src/domain/schema';

const base = {
  no: 1,
  subject: '自然',
  grade: 3,
  stem: '請作答。',
  explanation: '說明答案。',
  source: { originalPaper: '三年級自然期中考', section: '七、圖示（每格 1 分，共 4 分）' },
};

const image = { src: 'science/leaf.png', alt: '葉片圖' };
const choice = { ...base, type: 'choice', options: ['文字', { image }, { text: '文字和圖', image }], answer: 2 };
const multi = { ...base, type: 'multi-select', options: ['甲', '乙', '丙'], answer: [1, 3] };
const diagram = {
  ...base,
  type: 'diagram-label',
  image,
  labels: [{ x: 10, y: 20, width: 15, height: 10, answer: '甲' }],
};
const table = {
  ...base,
  type: 'table-fill',
  columns: ['文字欄', { image }],
  rows: [{ label: '葉形', answers: ['甲', '乙'] }],
};

const paths = (value: unknown) => {
  const result = questionSchema.safeParse(value);
  return result.success ? [] : result.error.issues.map((issue) => issue.path.join('.'));
};

describe('自然題目', () => {
  it('選項可以是文字、圖片或圖文', () => {
    expect(questionSchema.safeParse(choice).success).toBe(true);
    expect(questionSchema.safeParse({ ...choice, options: ['甲', '乙'] }).success).toBe(true);
    expect(paths({ ...choice, options: ['甲', {}] })).toContain('options.1');
    expect(paths({ ...choice, options: ['甲', { image: { src: '../bad.png', alt: '圖' } }] })).toContain('options.1.image.src');
  });

  it('來源至少要有大題或小題號', () => {
    expect(questionSchema.safeParse(choice).success).toBe(true);
    expect(questionSchema.safeParse({ ...choice, source: { originalPaper: '原卷', number: 1 } }).success).toBe(true);
    expect(paths({ ...choice, source: { originalPaper: '原卷' } })).toContain('source');
  });

  it('勾選答案至少一個，重複與越界不通過', () => {
    expect(questionSchema.safeParse(multi).success).toBe(true);
    expect(paths({ ...multi, answer: [] })).toContain('answer');
    expect(paths({ ...multi, answer: [1, 1] })).toContain('answer.1');
    expect(paths({ ...multi, answer: [4] })).toContain('answer.0');
  });

  it('圖示空格必須有答案、正尺寸且留在圖片內', () => {
    expect(questionSchema.safeParse(diagram).success).toBe(true);
    expect(paths({ ...diagram, labels: [{ ...diagram.labels[0], x: 90, width: 20 }] })).toContain('labels.0.width');
    expect(paths({ ...diagram, labels: [{ ...diagram.labels[0], height: 0 }] })).toContain('labels.0.height');
    expect(paths({ ...diagram, labels: [{ ...diagram.labels[0], answer: '' }] })).toContain('labels.0.answer');
  });

  it('表格每列答案數必須與欄數一致', () => {
    expect(questionSchema.safeParse(table).success).toBe(true);
    expect(paths({ ...table, rows: [{ label: '葉形', answers: ['甲'] }] })).toContain('rows.0.answers');
    expect(paths({ ...table, rows: [{ label: '葉形', answers: ['甲', ''] }] })).toContain('rows.0.answers.1');
  });

  it('檢查題目、選項及表格標題引用的所有圖片', () => {
    const data = bankFileSchema.parse({ questions: [
      { ...choice, no: 1, image: { src: 'science/stem.png', alt: '題圖' } },
      { ...table, no: 2, columns: ['文字欄', { image: { src: 'science/header.png', alt: '表格圖' } }] },
    ] });
    const problems = checkBank({ banks: [{ name: 'science', file: 'bank/science.yaml', data }], papers: [], images: [] });
    expect(problems.map((p) => p.message)).toEqual(expect.arrayContaining([
      expect.stringContaining('science/stem.png'),
      expect.stringContaining('science/leaf.png'),
      expect.stringContaining('science/header.png'),
    ]));
    expect(problems).toHaveLength(3);
    expect(checkBank({ banks: [{ name: 'science', file: 'bank/science.yaml', data }], papers: [], images: ['science/stem.png', 'science/leaf.png', 'science/header.png'] })).toEqual([]);
  });
});
