import { describe, expect, it } from 'vitest';
import { bankComposition } from '../src/domain/composition.ts';
import type { SUBJECTS } from '../src/domain/schema.ts';

const entry = (subject: (typeof SUBJECTS)[number], type: 'choice' | 'true-false' | 'word-problem') => ({ question: { subject, type } });

describe('bankComposition', () => {
  it('依科目順序統計題數與各題型題數，題型依既定順序', () => {
    const result = bankComposition([entry('數學', 'word-problem'), entry('國語', 'true-false'), entry('數學', 'choice'), entry('數學', 'choice')]);
    expect(result).toEqual([
      { subject: '國語', count: 1, types: [{ type: 'true-false', label: '是非題', count: 1 }] },
      {
        subject: '數學',
        count: 3,
        types: [
          { type: 'choice', label: '選擇題', count: 2 },
          { type: 'word-problem', label: '應用題', count: 1 },
        ],
      },
    ]);
  });

  it('沒有題目的科目不出現；空題庫回傳空陣列', () => {
    expect(bankComposition([entry('自然', 'choice')]).map((c) => c.subject)).toEqual(['自然']);
    expect(bankComposition([])).toEqual([]);
  });
});
