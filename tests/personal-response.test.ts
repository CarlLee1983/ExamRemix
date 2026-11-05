import { describe, expect, it } from 'vitest';
import { answerSpace } from '../src/domain/answer-space';
import { checkBank } from '../src/domain/bank-check';
import { bankFileSchema, questionSchema } from '../src/domain/schema';

const base = {
  no: 1,
  type: 'personal-response',
  subject: '英語',
  grade: 3,
  writingGuide: 'four-line',
  stem: 'What is your name?',
  explanation: '依自己的姓名回答。',
  source: { originalPaper: '測試用英語卷', number: 1 },
};

describe('英語個人問答', () => {
  it('允許沒有範例，或以含標點、數字及姓名的句子作範例', () => {
    const noSample = questionSchema.parse(base);
    expect(noSample.type).toBe('personal-response');
    expect(answerSpace(noSample)).toBe(1);
    expect(questionSchema.safeParse({ ...base, sampleAnswer: "I'm 8. My name is Anne-Marie O'Neil.", space: 2 }).success).toBe(true);
  });

  it('拒絕固定答案、空白範例、錯誤 rich text、零作答區或其他科目', () => {
    expect(questionSchema.safeParse({ ...base, answer: 'Amy' }).success).toBe(false);
    expect(questionSchema.safeParse({ ...base, sampleAnswer: '  ' }).success).toBe(false);
    expect(questionSchema.safeParse({ ...base, sampleAnswer: '[字|not-zhuyin]' }).success).toBe(false);
    expect(questionSchema.safeParse({ ...base, space: 0 }).success).toBe(false);
    expect(questionSchema.safeParse({ ...base, subject: '國語' }).success).toBe(false);
    expect(questionSchema.safeParse({ ...base, writingGuide: undefined }).success).toBe(false);
  });

  it('仍要求來源或衍生擇一，並沿用跨題型的衍生檢查', () => {
    expect(questionSchema.safeParse({ ...base, source: undefined }).success).toBe(false);
    expect(questionSchema.safeParse({ ...base, derivedFrom: ['original-01'] }).success).toBe(false);
    const original = bankFileSchema.parse({ questions: [base] });
    const derived = bankFileSchema.parse({ questions: [{ ...base, source: undefined, derivedFrom: ['original-01'] }] });
    const banks = [
      { name: 'original', file: 'bank/original.yaml', data: original },
      { name: 'new', file: 'bank/new.yaml', data: derived },
    ];
    expect(checkBank({ banks, papers: [], images: [] })).toEqual([]);
    const missing = bankFileSchema.parse({ questions: [{ ...base, source: undefined, derivedFrom: ['missing-01'] }] });
    expect(checkBank({ banks: [{ name: 'new', file: 'bank/new.yaml', data: missing }], papers: [], images: [] })
      .some((problem) => problem.message.includes('不存在'))).toBe(true);
    const { writingGuide: _guide, ...choiceBase } = base;
    const choice = bankFileSchema.parse({ questions: [{ ...choiceBase, type: 'choice', options: ['A', 'B'], answer: 1 }] });
    expect(checkBank({ banks: [{ name: 'original', file: 'bank/original.yaml', data: choice }, banks[1]!], papers: [], images: [] })
      .some((problem) => problem.message.includes('題型'))).toBe(true);
  });
});
