import { describe, expect, it } from 'vitest';
import { buildQuestionIndex, checkBank, type BankInput, type PaperInput } from '../src/domain/bank-check.ts';
import { formatProblem } from '../src/domain/problem.ts';
import type { BankFile, PaperFile } from '../src/domain/schema.ts';

function bank(name: string, questions: Array<{ no: number }>, file = `bank/${name}.yaml`): BankInput {
  const data: BankFile = {
    questions: questions.map(({ no }) => ({
      no,
      type: 'choice',
      subject: '數學',
      grade: 3,
      stem: `題幹 ${no}`,
      options: ['甲', '乙'],
      answer: 1,
      explanation: '解析',
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
  it('合法的題庫與試卷回傳空清單', () => {
    const problems = checkBank({
      images: [],
      banks: [bank('a', [{ no: 1 }, { no: 2 }])],
      papers: [paper('p', ['a-01'])],
    });
    expect(problems).toEqual([]);
  });

  it('題目 ID 跨題庫檔重複：回報該 ID 與所有出現的檔案', () => {
    // 檔名加序號組成的 ID 幾乎不會撞名，這裡以固定資料（兩個檔案對到同一個題庫名）直接驗證規則本身
    const dup = checkBank({
      images: [],
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
      images: [],
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
      images: [],
      banks: [bank('a', [{ no: 1 }])],
      papers: [paper('p', ['a-01', 'a-09'])],
    });
    expect(problems).toHaveLength(1);
    expect(problems[0]?.files).toEqual(['papers/p.yaml']);
    expect(problems[0]?.questionId).toBe('a-09');
    expect(problems[0]?.message).toContain('a-09');
  });

  it('多個問題同時存在時全部回報，順序穩定', () => {
    const input = {
      images: [],
      banks: [bank('b', [{ no: 1 }]), bank('a', [{ no: 1 }])],
      papers: [paper('q', ['b-02', 'zz-01']), paper('p', ['a-02'])],
    };
    const problems = checkBank(input);
    expect(problems.map((p) => [p.files[0], p.questionId])).toEqual([
      ['papers/p.yaml', 'a-02'],
      ['papers/q.yaml', 'b-02'],
      ['papers/q.yaml', 'zz-01'],
    ]);
    // 輸入順序不影響結果
    expect(checkBank({ ...input, banks: [...input.banks].reverse(), papers: [...input.papers].reverse() })).toEqual(problems);
  });
});

/** 可覆寫欄位的題庫：patch 裡有 undefined 的鍵會被移除（用來拿掉 source 或 unit） */
function customBank(name: string, questions: Array<Record<string, unknown> & { no: number }>): BankInput {
  const data = {
    questions: questions.map((patch) => {
      const q: Record<string, unknown> = {
        type: 'choice',
        subject: '數學',
        grade: 3,
        unit: '乘法',
        stem: '題幹',
        options: ['甲', '乙'],
        answer: 1,
        explanation: '解析',
        source: { originalPaper: '虛構小考', number: patch.no },
        ...patch,
      };
      for (const key of Object.keys(q)) if (q[key] === undefined) delete q[key];
      return q;
    }),
  } as BankFile;
  return { name, file: `bank/${name}.yaml`, data };
}

const derived = (no: number, from: string[], patch: Record<string, unknown> = {}) => ({
  no,
  source: undefined,
  derivedFrom: from,
  ...patch,
});

describe('checkBank：附圖引用', () => {
  const withImage = (src: string) => customBank('a', [{ no: 1, image: { src, alt: '圖' } }]);

  it('圖片存在於清單時通過', () => {
    expect(checkBank({ images: ['a/1.png'], banks: [withImage('a/1.png')], papers: [] })).toEqual([]);
  });

  it('圖片不在清單時：回報題庫檔、題目 ID，訊息指出圖片路徑', () => {
    const problems = checkBank({ images: ['a/2.png'], banks: [withImage('a/1.png')], papers: [] });
    expect(problems).toHaveLength(1);
    expect(problems[0]?.files).toEqual(['bank/a.yaml']);
    expect(problems[0]?.questionId).toBe('a-01');
    expect(problems[0]?.message).toContain('a/1.png');
  });

  it('沒有附圖的題目不受影響', () => {
    expect(checkBank({ images: [], banks: [bank('a', [{ no: 1 }])], papers: [] })).toEqual([]);
  });
});

describe('checkBank：衍生規則', () => {
  const run = (...banks: BankInput[]) => checkBank({ images: [], banks, papers: [] });

  it('合法的新題（原題存在、沒有疑點、四個欄位一致）通過', () => {
    expect(run(customBank('a', [{ no: 1 }]), customBank('n', [derived(1, ['a-01'])]))).toEqual([]);
  });

  it('原題不存在：回報新題所在檔案、新題 ID，訊息指出原題 ID', () => {
    const problems = run(customBank('n', [derived(1, ['a-09'])]));
    expect(problems).toHaveLength(1);
    expect(problems[0]?.files).toEqual(['bank/n.yaml']);
    expect(problems[0]?.questionId).toBe('n-01');
    expect(problems[0]?.message).toContain('a-09');
    expect(problems[0]?.message).toContain('不存在');
  });

  it('原題本身是新題：新題只能衍生自原題', () => {
    const problems = run(
      customBank('a', [{ no: 1 }]),
      customBank('n', [derived(1, ['a-01']), derived(2, ['n-01'])]),
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]?.questionId).toBe('n-02');
    expect(problems[0]?.message).toContain('n-01');
    expect(problems[0]?.message).toContain('新題');
  });

  it('題型、科目、年級、單元不一致：一個原題一個問題，列出不一致的欄位', () => {
    const problems = run(
      customBank('a', [{ no: 1 }]),
      customBank('n', [derived(1, ['a-01'], { type: 'true-false', options: undefined, answer: true, grade: 4 })]),
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]?.questionId).toBe('n-01');
    expect(problems[0]?.message).toContain('a-01');
    for (const field of ['題型', '年級']) expect(problems[0]?.message).toContain(field);
    for (const field of ['科目', '單元']) expect(problems[0]?.message).not.toContain(field);
  });

  it('科目不一致', () => {
    const problems = run(customBank('a', [{ no: 1 }]), customBank('n', [derived(1, ['a-01'], { subject: '國語' })]));
    expect(problems).toHaveLength(1);
    expect(problems[0]?.message).toContain('科目');
  });

  it('單元以「含沒有」比較：原題有單元、新題沒有也算不一致，兩邊都沒有則一致', () => {
    const mismatch = run(customBank('a', [{ no: 1 }]), customBank('n', [derived(1, ['a-01'], { unit: undefined })]));
    expect(mismatch).toHaveLength(1);
    expect(mismatch[0]?.message).toContain('單元');
    expect(
      run(customBank('a', [{ no: 1, unit: undefined }]), customBank('n', [derived(1, ['a-01'], { unit: undefined })])),
    ).toEqual([]);
  });

  it('多個原題彼此不一致：一個問題，點名這些原題', () => {
    const problems = run(
      customBank('a', [{ no: 1 }, { no: 2, unit: '加法' }]),
      customBank('n', [derived(1, ['a-01', 'a-02'])]),
    );
    const own = problems.filter((p) => p.message.includes('彼此'));
    expect(own).toHaveLength(1);
    expect(own[0]?.files).toEqual(['bank/n.yaml']);
    expect(own[0]?.questionId).toBe('n-01');
    expect(own[0]?.message).toContain('a-01');
    expect(own[0]?.message).toContain('a-02');
  });

  it('多個原題彼此一致時通過', () => {
    expect(run(customBank('a', [{ no: 1 }, { no: 2 }]), customBank('n', [derived(1, ['a-01', 'a-02'])]))).toEqual([]);
  });

  it('衍生規則排在附圖檢查之後、試卷檢查之前', () => {
    const problems = checkBank({
      images: [],
      banks: [customBank('n', [derived(1, ['a-09'], { image: { src: 'n/1.png', alt: '圖' } })])],
      papers: [paper('p', ['zz-01'])],
    });
    expect(problems.map((p) => p.questionId)).toEqual(['n-01', 'n-01', 'zz-01']);
    expect(problems[0]?.message).toContain('n/1.png');
    expect(problems[1]?.message).toContain('a-09');
  });
});

describe('buildQuestionIndex', () => {
  it('以題庫檔名加序號建立 ID → 題目的索引', () => {
    const index = buildQuestionIndex([bank('a', [{ no: 1 }, { no: 12 }])]);
    expect([...index.keys()]).toEqual(['a-01', 'a-12']);
    expect(index.get('a-12')?.no).toBe(12);
  });
});

describe('嚴重度', () => {
  it('疑點警告以外的規則回報的問題都是錯誤', () => {
    const problems = checkBank({
      images: [],
      banks: [bank('a', [{ no: 1 }]), bank('a', [{ no: 1 }], 'bank/A_b.yaml')],
      papers: [paper('p', ['a-01', 'zz-01'])],
    });
    expect(problems.length).toBeGreaterThan(0);
    expect(problems.every((p) => p.severity === 'error')).toBe(true);
  });
});

describe('checkBank：疑點', () => {
  const doubt = '題幹被筆跡蓋住，依上下文推定';

  it('新題衍生自有疑點的原題：錯誤，訊息含原題 ID 與疑點描述', () => {
    const problems = checkBank({
      images: [],
      banks: [customBank('a', [{ no: 1, doubt }]), customBank('n', [derived(1, ['a-01'])])],
      papers: [],
    });
    expect(problems).toHaveLength(1);
    expect(problems[0]?.severity).toBe('error');
    expect(problems[0]?.files).toEqual(['bank/n.yaml']);
    expect(problems[0]?.questionId).toBe('n-01');
    expect(problems[0]?.message).toContain('a-01');
    expect(problems[0]?.message).toContain(doubt);
  });

  it('試卷引用有疑點的題目：只有一則警告，輸出含試卷檔、題目 ID 與疑點描述', () => {
    const problems = checkBank({
      images: [],
      banks: [customBank('a', [{ no: 1, doubt }])],
      papers: [paper('p', ['a-01'])],
    });
    expect(problems).toHaveLength(1);
    expect(problems[0]?.severity).toBe('warning');
    expect(problems[0]?.questionId).toBe('a-01');
    const line = formatProblem(problems[0]!);
    expect(line).toContain('papers/p.yaml');
    expect(line).toContain('a-01');
    expect(line).toContain(doubt);
  });

  it('沒有疑點的題目照常可被引用與衍生（題目預設可用）', () => {
    expect(
      checkBank({
        images: [],
        banks: [customBank('a', [{ no: 1 }]), customBank('n', [derived(1, ['a-01'])])],
        papers: [paper('p', ['a-01', 'n-01'])],
      }),
    ).toEqual([]);
  });

  it('有疑點的題目沒被引用或衍生時不回報', () => {
    expect(checkBank({ images: [], banks: [customBank('a', [{ no: 1, doubt }])], papers: [] })).toEqual([]);
  });
});
