import { describe, expect, it } from 'vitest';
import { paperRows, paperTitlesByQuestion } from '../src/domain/paper-usage.ts';

function paper(id: string, title: string, sections: string[][]) {
  return { id, data: { title, subject: '數學', grade: 3, sections: sections.map((questions, i) => ({ title: `第 ${i + 1} 大題`, questions })) } };
}

describe('paperRows', () => {
  it('題數是各大題題數的總和，並依試卷 ID 排序', () => {
    const rows = paperRows([paper('b-paper', 'B 卷', [['q-1']]), paper('a-paper', 'A 卷', [['q-1', 'q-2'], ['q-3']])]);
    expect(rows.map((r) => [r.id, r.title, r.subject, r.grade, r.count, r.sections])).toEqual([
      ['a-paper', 'A 卷', '數學', 3, 3, 2],
      ['b-paper', 'B 卷', '數學', 3, 1, 1],
    ]);
  });
});

describe('paperTitlesByQuestion', () => {
  it('每題對應用到它的試卷標題，依試卷 ID 排序', () => {
    const usage = paperTitlesByQuestion([paper('b-paper', 'B 卷', [['q-1', 'q-2']]), paper('a-paper', 'A 卷', [['q-1']])]);
    expect(usage.get('q-1')).toEqual(['A 卷', 'B 卷']);
    expect(usage.get('q-2')).toEqual(['B 卷']);
  });

  it('沒有被任何試卷引用的題目不在表內', () => {
    expect(paperTitlesByQuestion([paper('a-paper', 'A 卷', [['q-1']])]).has('q-9')).toBe(false);
  });

  it('同一份試卷重複引用同一題，標題只記一次', () => {
    expect(paperTitlesByQuestion([paper('a-paper', 'A 卷', [['q-1'], ['q-1']])]).get('q-1')).toEqual(['A 卷']);
  });
});
