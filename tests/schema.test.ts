import { z } from 'astro/zod';
import { describe, expect, it } from 'vitest';
import {
  bankFileSchema,
  deriveQuestionId,
  paperFileSchema,
  questionSchema,
} from '../src/domain/schema';

const validChoice = {
  no: 1,
  type: 'choice',
  subject: '數學',
  grade: 3,
  unit: '乘法',
  stem: '3 × 4 等於多少？',
  options: ['10', '12', '14'],
  answer: 2,
  explanation: '3 × 4 = 12。',
  source: { originalPaper: '虛構期中考', number: 1 },
};

/** 回傳解析失敗的 issue path（以 . 串接）；成功時回傳空陣列 */
function issuePaths(schema: z.ZodType, value: unknown): string[] {
  const r = schema.safeParse(value);
  return r.success ? [] : r.error.issues.map((i) => i.path.join('.'));
}

describe('選擇題 schema', () => {
  it('接受合法的原題，confirmed 預設為 false', () => {
    const r = questionSchema.safeParse(validChoice);
    expect(r.success).toBe(true);
    expect(r.data?.confirmed).toBe(false);
  });

  it('接受合法的新題（derivedFrom）且 unit 可省略', () => {
    const { source, unit, ...rest } = validChoice;
    const r = questionSchema.safeParse({ ...rest, derivedFrom: ['sample-math-01'] });
    expect(r.success).toBe(true);
  });

  it('缺題幹時指出 stem', () => {
    const { stem, ...rest } = validChoice;
    expect(issuePaths(questionSchema, rest)).toContain('stem');
  });

  it('選項少於 2 個時指出 options', () => {
    expect(issuePaths(questionSchema, { ...validChoice, options: ['10'], answer: 1 })).toContain(
      'options',
    );
  });

  it('answer 超出選項範圍時指出 answer', () => {
    expect(issuePaths(questionSchema, { ...validChoice, answer: 4 })).toEqual(['answer']);
    expect(issuePaths(questionSchema, { ...validChoice, answer: 0 })).toContain('answer');
  });

  it('source 與 derivedFrom 同時存在時失敗', () => {
    const paths = issuePaths(questionSchema, { ...validChoice, derivedFrom: ['x-01'] });
    expect(paths).toEqual(['derivedFrom']);
  });

  it('source 與 derivedFrom 都沒有時失敗', () => {
    const { source, ...rest } = validChoice;
    expect(issuePaths(questionSchema, rest)).toEqual(['source']);
  });

  it('grade 超出 1–6 時指出 grade', () => {
    expect(issuePaths(questionSchema, { ...validChoice, grade: 7 })).toEqual(['grade']);
    expect(issuePaths(questionSchema, { ...validChoice, grade: 0 })).toEqual(['grade']);
  });

  it('未知的 type 時指出 type', () => {
    expect(issuePaths(questionSchema, { ...validChoice, type: 'essay' })).toContain('type');
  });

  it('未知科目時指出 subject', () => {
    expect(issuePaths(questionSchema, { ...validChoice, subject: '自然' })).toEqual(['subject']);
  });
});

const validTrueFalse = {
  no: 2,
  type: 'true-false',
  subject: '數學',
  grade: 3,
  stem: '7 × 8 = 56。',
  answer: true,
  explanation: '7 × 8 = 56。',
  source: { originalPaper: '虛構期中考', number: 2 },
};

describe('是非題 schema', () => {
  it('接受 true 與 false 的答案', () => {
    expect(questionSchema.safeParse(validTrueFalse).success).toBe(true);
    expect(questionSchema.safeParse({ ...validTrueFalse, answer: false }).success).toBe(true);
  });

  it('answer 不是布林值時指出 answer', () => {
    expect(issuePaths(questionSchema, { ...validTrueFalse, answer: 'true' })).toEqual(['answer']);
    expect(issuePaths(questionSchema, { ...validTrueFalse, answer: 1 })).toEqual(['answer']);
  });

  it('缺 answer 時指出 answer', () => {
    const { answer, ...rest } = validTrueFalse;
    expect(issuePaths(questionSchema, rest)).toEqual(['answer']);
  });
});

const validFillBlank = {
  no: 3,
  type: 'fill-blank',
  subject: '數學',
  grade: 3,
  stem: '3 公尺 = ___ 公分；1 公里 = ___ 公尺。',
  answer: ['300', '1000'],
  explanation: '1 公尺 = 100 公分，1 公里 = 1000 公尺。',
  source: { originalPaper: '虛構期中考', number: 3 },
};

describe('填空題 schema', () => {
  it('接受一個空格與多個空格', () => {
    expect(questionSchema.safeParse(validFillBlank).success).toBe(true);
    const single = { ...validFillBlank, stem: '5 × 8 = ___', answer: ['40'] };
    expect(questionSchema.safeParse(single).success).toBe(true);
  });

  it('空格數多於答案數時指出 answer，訊息說明兩個數量', () => {
    const bad = { ...validFillBlank, answer: ['300'] };
    expect(issuePaths(questionSchema, bad)).toEqual(['answer']);
    const r = questionSchema.safeParse(bad);
    expect(r.error!.issues[0]!.message).toBe('題幹有 2 個空格，但 answer 有 1 個答案');
  });

  it('空格數少於答案數時指出 answer', () => {
    const bad = { ...validFillBlank, answer: ['300', '1000', '5'] };
    expect(issuePaths(questionSchema, bad)).toEqual(['answer']);
  });

  it('題幹沒有空格時失敗', () => {
    const bad = { ...validFillBlank, stem: '3 公尺等於幾公分？', answer: ['300'] };
    expect(issuePaths(questionSchema, bad)).toEqual(['stem']);
  });

  it('只有兩個底線不算空格', () => {
    const bad = { ...validFillBlank, stem: '3 公尺 = __ 公分', answer: ['300'] };
    expect(issuePaths(questionSchema, bad)).toEqual(['stem']);
  });

  it('空格請用剛好三個底線：連續四個以上時指出 stem 並說明', () => {
    for (const run of ['____', '______']) {
      const bad = { ...validFillBlank, stem: `3 公尺 = ${run} 公分`, answer: ['300'] };
      expect(issuePaths(questionSchema, bad)).toEqual(['stem']);
      const r = questionSchema.safeParse(bad);
      expect(r.error!.issues[0]!.message).toContain('空格請用剛好三個底線 ___');
    }
  });

  it('答案寫成數字時轉成字串', () => {
    const r = questionSchema.safeParse({ ...validFillBlank, answer: [300, '1000'] });
    expect(r.success).toBe(true);
    expect(r.data).toMatchObject({ answer: ['300', '1000'] });
  });

  it('答案是布林值、物件或 null 時指出該項，訊息為中文', () => {
    for (const bad of [true, null, { a: 1 }, ['x']]) {
      const r = questionSchema.safeParse({ ...validFillBlank, answer: ['300', bad] });
      expect(r.success).toBe(false);
      expect(r.error!.issues.map((i) => i.path.join('.'))).toEqual(['answer.1']);
      expect(r.error!.issues[0]!.message).toBe('每個答案必須是非空字串或數字');
    }
  });

  it('答案含空字串時指出該項', () => {
    const bad = { ...validFillBlank, answer: ['300', ''] };
    expect(issuePaths(questionSchema, bad)).toEqual(['answer.1']);
    expect(questionSchema.safeParse(bad).error!.issues[0]!.message).toBe('文字不可為空');
  });

  it('answer 為空陣列時失敗', () => {
    expect(issuePaths(questionSchema, { ...validFillBlank, answer: [] })).toContain('answer');
  });

  it('answer 不是陣列時指出 answer', () => {
    expect(issuePaths(questionSchema, { ...validFillBlank, answer: '300' })).toEqual(['answer']);
  });
});

const zhuyinSource = { originalPaper: '虛構三年級國語小考', number: 8 };
const validCharToZhuyin = {
  no: 8,
  type: 'char-to-zhuyin',
  subject: '國語',
  grade: 3,
  stem: '我在[公園|ㄍㄨㄥ ㄩㄢˊ]看見一朵[花|ㄏㄨㄚ]。',
  explanation: '公園、花的注音。',
  source: zhuyinSource,
};
const validZhuyinToChar = { ...validCharToZhuyin, type: 'zhuyin-to-char', stem: '我在[公園|ㄍㄨㄥ ㄩㄢˊ]玩。' };
const validMakeSentence = {
  no: 9,
  type: 'make-sentence',
  subject: '國語',
  grade: 3,
  stem: "用「雖然……但是……」造句。",
  answer: '雖然下雨了，但是我還是去上學。',
  explanation: '要有轉折。',
  source: zhuyinSource,
};
const validImitateSentence = {
  ...validMakeSentence,
  type: 'imitate-sentence',
  stem: '照樣造句。',
  example: '月亮像一個大銀盤。',
  answer: '太陽像一顆大火球。',
};

describe('國字注音／注音寫國字 schema', () => {
  it.each([validCharToZhuyin, validZhuyinToChar])('接受題幹有標注的 $type', (q) => {
    expect(questionSchema.safeParse(q).success).toBe(true);
  });

  it.each([validCharToZhuyin, validZhuyinToChar])('$type 題幹沒有標注時指出 stem 並說明', (q) => {
    const bad = { ...q, stem: '我在公園玩。[1]' };
    expect(issuePaths(questionSchema, bad)).toEqual(['stem']);
    const r = questionSchema.safeParse(bad);
    expect(r.error!.issues[0]!.message).toContain('題幹至少要有一個注音標注');
  });

  it('標注格式錯誤時只回報格式錯誤，不重複回報缺標注', () => {
    const r = questionSchema.safeParse({ ...validCharToZhuyin, stem: '[公園|ㄍㄨㄥ]' });
    expect(r.error!.issues.map((i) => i.path.join('.'))).toEqual(['stem']);
    expect(r.error!.issues[0]!.message).toBe('注音標注「[公園|ㄍㄨㄥ]」的注音組數（1）必須等於字數（2）');
  });

  it('不接受 answer 欄位（答案就是標注本身）', () => {
    expect(issuePaths(questionSchema, { ...validCharToZhuyin, answer: 'ㄏㄨㄚ' })).toContain('');
  });
});

describe('造句／照樣造句 schema', () => {
  it('接受合法的造句與照樣造句', () => {
    expect(questionSchema.safeParse(validMakeSentence).success).toBe(true);
    expect(questionSchema.safeParse(validImitateSentence).success).toBe(true);
  });

  it('造句 answer 為空字串或缺少時指出 answer', () => {
    expect(issuePaths(questionSchema, { ...validMakeSentence, answer: '' })).toEqual(['answer']);
    expect(questionSchema.safeParse({ ...validMakeSentence, answer: '' }).error!.issues[0]!.message).toBe(
      '文字不可為空',
    );
    const { answer, ...rest } = validMakeSentence;
    expect(issuePaths(questionSchema, rest)).toEqual(['answer']);
  });

  it('照樣造句缺 example 或 example 為空字串時指出 example', () => {
    const { example, ...rest } = validImitateSentence;
    expect(issuePaths(questionSchema, rest)).toEqual(['example']);
    expect(issuePaths(questionSchema, { ...validImitateSentence, example: '' })).toEqual(['example']);
  });

  it('照樣造句 answer 為空字串時指出 answer', () => {
    expect(issuePaths(questionSchema, { ...validImitateSentence, answer: '' })).toEqual(['answer']);
    expect(questionSchema.safeParse({ ...validImitateSentence, example: '' }).error!.issues[0]!.message).toBe(
      '文字不可為空',
    );
  });

  it('造句不接受 example 欄位', () => {
    expect(issuePaths(questionSchema, { ...validMakeSentence, example: '例句' })).toContain('');
  });

  it('example 與 answer 也驗證注音標注', () => {
    expect(
      issuePaths(questionSchema, { ...validImitateSentence, example: '[月|ㄩㄝˋ ㄌ]' }),
    ).toEqual(['example']);
    expect(issuePaths(questionSchema, { ...validMakeSentence, answer: '[月|hua]' })).toEqual(['answer']);
  });
});

describe('文字欄位的注音標注驗證', () => {
  const badMark = '[公園|ㄍㄨㄥ]';
  const countMessage = '注音標注「[公園|ㄍㄨㄥ]」的注音組數（1）必須等於字數（2）';

  it('合法標注可用在既有題型的所有文字欄位', () => {
    const ok = '[花|ㄏㄨㄚ]';
    expect(
      questionSchema.safeParse({ ...validChoice, stem: ok, options: [ok, '[草|ㄘㄠˇ]'], explanation: ok })
        .success,
    ).toBe(true);
    expect(questionSchema.safeParse({ ...validFillBlank, answer: ['[花|ㄏㄨㄚ]', '1000'] }).success).toBe(true);
  });

  it('選擇題：stem、options.N、explanation 的錯誤 path 指向該欄位', () => {
    expect(issuePaths(questionSchema, { ...validChoice, stem: badMark })).toEqual(['stem']);
    expect(issuePaths(questionSchema, { ...validChoice, options: ['10', badMark, '14'] })).toEqual([
      'options.1',
    ]);
    const r = questionSchema.safeParse({ ...validChoice, explanation: badMark });
    expect(r.error!.issues.map((i) => i.path.join('.'))).toEqual(['explanation']);
    expect(r.error!.issues[0]!.message).toBe(countMessage);
  });

  it('是非題：stem 與 explanation', () => {
    expect(issuePaths(questionSchema, { ...validTrueFalse, stem: badMark })).toEqual(['stem']);
    expect(issuePaths(questionSchema, { ...validTrueFalse, explanation: badMark })).toEqual(['explanation']);
  });

  it('填空題：stem、answer.N、explanation', () => {
    expect(issuePaths(questionSchema, { ...validFillBlank, stem: `${badMark}___ ___` })).toContain('stem');
    expect(issuePaths(questionSchema, { ...validFillBlank, answer: ['300', badMark] })).toEqual(['answer.1']);
    expect(issuePaths(questionSchema, { ...validFillBlank, explanation: badMark })).toEqual(['explanation']);
  });

  it('同一個欄位有多個錯誤時各自回報', () => {
    const r = questionSchema.safeParse({ ...validChoice, stem: '[a|b][c|d]' });
    expect(r.error!.issues.map((i) => i.path.join('.'))).toEqual(['stem', 'stem']);
  });
});

describe('題庫檔 schema', () => {
  it('接受合法的題庫檔', () => {
    expect(bankFileSchema.safeParse({ questions: [validChoice] }).success).toBe(true);
  });

  it('錯誤 path 帶出題目在陣列中的位置', () => {
    const bad = { ...validChoice, no: 2, answer: 9 };
    expect(issuePaths(bankFileSchema, { questions: [validChoice, bad] })).toEqual([
      'questions.1.answer',
    ]);
  });

  it('檔內 no 重複時，在重複出現的那題指出 no', () => {
    const dup = { ...validChoice, no: 1 };
    const other = { ...validChoice, no: 2 };
    expect(issuePaths(bankFileSchema, { questions: [validChoice, other, dup] })).toEqual([
      'questions.2.no',
    ]);
  });

  it('questions 為空陣列時失敗', () => {
    expect(issuePaths(bankFileSchema, { questions: [] })).toEqual(['questions']);
  });
});

describe('試卷檔 schema', () => {
  const validPaper = {
    title: '三年級數學練習',
    subject: '數學',
    grade: 3,
    sections: [
      { title: '一、選擇題', points: 20, questions: ['sample-math-01'] },
      { title: '二、選擇題', questions: ['sample-math-02'] },
    ],
  };

  it('接受合法的試卷檔，配分可省略', () => {
    expect(paperFileSchema.safeParse(validPaper).success).toBe(true);
  });

  it('沒有大題時失敗', () => {
    expect(issuePaths(paperFileSchema, { ...validPaper, sections: [] })).toEqual(['sections']);
  });

  it('大題沒有題目時指出 questions', () => {
    const bad = { ...validPaper, sections: [{ title: '一、', questions: [] }] };
    expect(issuePaths(paperFileSchema, bad)).toEqual(['sections.0.questions']);
  });

  it('配分不是正整數時指出 points', () => {
    const bad = { ...validPaper, sections: [{ title: '一、', points: 0, questions: ['a-01'] }] };
    expect(issuePaths(paperFileSchema, bad)).toEqual(['sections.0.points']);
  });

  it('缺標題時指出 title', () => {
    const { title, ...rest } = validPaper;
    expect(issuePaths(paperFileSchema, rest)).toEqual(['title']);
  });
});

describe('deriveQuestionId', () => {
  it('以題庫檔名加兩位數序號衍生 ID', () => {
    expect(deriveQuestionId('sample-math', 1)).toBe('sample-math-01');
    expect(deriveQuestionId('sample-math', 12)).toBe('sample-math-12');
    expect(deriveQuestionId('sample-math', 123)).toBe('sample-math-123');
  });
});
