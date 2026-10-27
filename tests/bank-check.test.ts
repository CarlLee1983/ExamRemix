import { describe, expect, it } from 'vitest';
import { buildQuestionIndex, checkBank, type BankInput, type PaperInput } from '../src/domain/bank-check.ts';
import type { BankFile, PaperFile } from '../src/domain/schema.ts';

function bank(name: string, questions: Array<{ no: number; confirmed?: boolean }>, file = `bank/${name}.yaml`): BankInput {
  const data: BankFile = {
    questions: questions.map(({ no, confirmed }) => ({
      no,
      type: 'choice',
      subject: '數學',
      grade: 3,
      stem: `題幹 ${no}`,
      options: ['甲', '乙'],
      answer: 1,
      explanation: '解析',
      confirmed: confirmed ?? true,
      source: { originalPaper: '虛構小考', number: no },
    })),
  };
  return { name, file, data };
}

function paper(name: string, ids: string[]): PaperInput {
  const data: PaperFile = {
    title: name,
    subject: '數學',
    grade: 3,
    sections: [{ title: '一、選擇題', questions: ids }],
  };
  return { file: `papers/${name}.yaml`, data };
}

describe('checkBank', () => {
  it('合法的題庫與試卷回傳空清單；未確認但沒被引用的題目允許', () => {
    const problems = checkBank({
      banks: [bank('a', [{ no: 1 }, { no: 2, confirmed: false }])],
      papers: [paper('p', ['a-01'])],
    });
    expect(problems).toEqual([]);
  });

  it('題目 ID 跨題庫檔重複：回報該 ID 與所有出現的檔案', () => {
    // 檔名加序號組成的 ID 幾乎不會撞名，這裡以固定資料（兩個檔案對到同一個題庫名）直接驗證規則本身
    const dup = checkBank({
      banks: [bank('a', [{ no: 1 }]), bank('a', [{ no: 1 }, { no: 2 }], 'bank/b.yaml')],
      papers: [],
    });
    expect(dup).toHaveLength(1);
    expect(dup[0]?.questionId).toBe('a-01');
    expect(dup[0]?.files).toEqual(['bank/a.yaml', 'bank/b.yaml']);
    expect(dup[0]?.message).toContain('a-01');
  });

  it('檔名不合格：回報該檔案與原因，題庫檔與試卷檔都檢查', () => {
    const problems = checkBank({
      banks: [bank('Sample_Math', [{ no: 1 }]), bank('a b', [{ no: 1 }])],
      papers: [paper('Bad.Name', ['a-01'])],
    });
    const named = problems.filter((p) => p.message.startsWith('檔名不合格'));
    expect(named.map((p) => p.files[0])).toEqual([
      'bank/Sample_Math.yaml',
      'bank/a b.yaml',
      'papers/Bad.Name.yaml',
    ]);
  });

  it('試卷引用不存在的 ID：回報試卷檔與該 ID', () => {
    const problems = checkBank({
      banks: [bank('a', [{ no: 1 }])],
      papers: [paper('p', ['a-01', 'a-09'])],
    });
    expect(problems).toHaveLength(1);
    expect(problems[0]?.files).toEqual(['papers/p.yaml']);
    expect(problems[0]?.questionId).toBe('a-09');
    expect(problems[0]?.message).toContain('a-09');
  });

  it('試卷引用未確認的題目：回報試卷檔與該題目 ID', () => {
    const problems = checkBank({
      banks: [bank('a', [{ no: 1, confirmed: false }])],
      papers: [paper('p', ['a-01'])],
    });
    expect(problems).toHaveLength(1);
    expect(problems[0]?.files).toEqual(['papers/p.yaml']);
    expect(problems[0]?.questionId).toBe('a-01');
    expect(problems[0]?.message).toContain('未確認');
  });

  it('多個問題同時存在時全部回報，順序穩定', () => {
    const input = {
      banks: [bank('b', [{ no: 1, confirmed: false }]), bank('a', [{ no: 1 }])],
      papers: [paper('q', ['b-01', 'zz-01']), paper('p', ['a-02'])],
    };
    const problems = checkBank(input);
    expect(problems.map((p) => [p.files[0], p.questionId])).toEqual([
      ['papers/p.yaml', 'a-02'],
      ['papers/q.yaml', 'b-01'],
      ['papers/q.yaml', 'zz-01'],
    ]);
    // 輸入順序不影響結果
    expect(checkBank({ banks: [...input.banks].reverse(), papers: [...input.papers].reverse() })).toEqual(problems);
  });
});

describe('buildQuestionIndex', () => {
  it('以題庫檔名加序號建立 ID → 題目的索引', () => {
    const index = buildQuestionIndex([bank('a', [{ no: 1 }, { no: 12 }])]);
    expect([...index.keys()]).toEqual(['a-01', 'a-12']);
    expect(index.get('a-12')?.no).toBe(12);
  });
});
