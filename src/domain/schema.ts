// 題庫檢查模組：題庫檔與試卷檔的 schema。
// 不依賴 Astro 執行環境（依賴 astro/zod 與 katex，後者用來驗證數學式），讓 Vitest 與 agent 都能直接呼叫（ADR 0002）。
import { z } from 'astro/zod';
import { countBlanks, hasOverlongUnderscores } from './blank.ts';
import { imageSrcProblem } from './image.ts';
import { parseRichText } from './rich-text.ts';
import { NO_UNIT_LABEL } from './unit.ts';
import { calculate, DECIMAL_FORMAT, OPERATORS, sameNumber } from './vertical-calc.ts';
import { hasAnnotation, parseZhuyin } from './zhuyin.ts';

export const SUBJECTS = ['國語', '數學', '自然'] as const;

const subjectSchema = z.enum(SUBJECTS);
const gradeSchema = z.number().int().min(1).max(6);

/** 題目 ID：題庫檔名（不含副檔名）加兩位數序號，例如 sample-math-01。 */
export function deriveQuestionId(bankName: string, no: number): string {
  return `${bankName}-${String(no).padStart(2, '0')}`;
}

/** 依 ID 排序用的比較函式（題目 ID、試卷 ID 共用）。 */
export function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

const nonEmptyText = z.string().min(1, '文字不可為空');

/** 把注音標注的格式錯誤加進 ctx（path 即該欄位），回傳解析結果。所有文字欄位共用。 */
function addZhuyinIssues(text: string, ctx: z.RefinementCtx) {
  const result = parseZhuyin(text);
  for (const message of result.errors) ctx.addIssue({ code: 'custom', message });
  return result;
}

/** 可含注音標注（`[字|注音]`）與數學式（`$...$`）的非空文字。 */
const richText = nonEmptyText.superRefine((text, ctx) => {
  for (const message of parseRichText(text).errors) ctx.addIssue({ code: 'custom', message });
});

/** YAML 的 answer: 300 會讀成數字，轉成字串；其他型別一律拒絕。 */
const stringOrNumber = (message: string) => z.union([z.string(), z.number()], { error: message }).transform(String);

/** 填空與計算題的答案文字。 */
const answerText = (message: string) => stringOrNumber(message).pipe(richText);
/** 每個空格的答案 */
const blankAnswer = answerText('每個答案必須是非空字串或數字');

/** 直式計算的運算元與答案：非負十進位數，YAML 寫成數字也可以。 */
const decimalNumber = stringOrNumber('必須是非負數字（字串或數字）').pipe(
  z.string().regex(DECIMAL_FORMAT, '必須是非負數字，只含數字與最多一個小數點（如 36 或 4.5）'),
);

/** 國字注音與注音寫國字的題幹：標注就是要考的字，至少要有一個。 */
const zhuyinTargetStem = nonEmptyText.superRefine((text, ctx) => {
  const { segments, errors } = addZhuyinIssues(text, ctx);
  if (errors.length === 0 && !hasAnnotation(segments)) {
    ctx.addIssue({
      code: 'custom',
      message: '題幹至少要有一個注音標注，例如 [公園|ㄍㄨㄥ ㄩㄢˊ]，標注就是要考的字',
    });
  }
});

/** 題目附圖：src 是相對於 bank/ 的路徑（檔案是否存在由跨檔檢查負責），alt 是替代文字。 */
const imageSchema = z.strictObject({
  src: z.string().superRefine((src, ctx) => {
    const problem = imageSrcProblem(src);
    if (problem) ctx.addIssue({ code: 'custom', message: problem });
  }),
  alt: nonEmptyText,
});

/** 選項與表格欄標題可沿用文字，或用物件提供文字、圖片或兩者。 */
const visualTextSchema = z.union([
  richText,
  z.strictObject({ text: richText.optional(), image: imageSchema.optional() }).refine(
    (content) => content.text !== undefined || content.image !== undefined,
    { message: '至少要有文字或圖片' },
  ),
]);

const optionsSchema = z.array(visualTextSchema).min(2).max(6);

const sourceSchema = z
  .strictObject({
    originalPaper: z.string().min(1),
    /** 原卷的大題標題，包含印出的配分說明。 */
    section: z.string().min(1).optional(),
    /** 原卷印有的小題號；沒有印就省略。 */
    number: z.number().int().positive().optional(),
  })
  .refine((source) => source.section !== undefined || source.number !== undefined, {
    message: '來源至少要有原卷大題或小題號',
  });

// 所有題型共用的欄位；新題型以 extend 加上自己的欄位。
const questionBase = z.strictObject({
  no: z.number().int().positive(),
  subject: subjectSchema,
  grade: gradeSchema,
  unit: z
    .string()
    .min(1)
    .refine((unit) => unit !== NO_UNIT_LABEL, { error: `單元不可只寫 ${NO_UNIT_LABEL}，它在列出題目與題庫瀏覽時代表「沒有單元」；沒有單元請省略這個欄位` })
    .optional(),
  stem: richText,
  explanation: richText,
  /** 附圖，顯示在題幹下方 */
  image: imageSchema.optional(),
  /** 覆寫作答空間（行）；沒寫時用題型預設，見 answer-space.ts */
  space: z.number().int().min(0).optional(),
  /** 疑點：一句說明哪裡可疑；有這個欄位就是有疑點 */
  doubt: z.string().min(1, '疑點不可為空字串；沒有疑點請省略這個欄位').optional(),
  // 原題記錄出處，新題記錄衍生自哪些題目；兩者擇一（見 questionSchema）
  source: sourceSchema.optional(),
  derivedFrom: z.array(z.string().min(1)).min(1).optional(),
});

export const choiceQuestionSchema = questionBase
  .extend({
    type: z.literal('choice'),
    options: optionsSchema,
    /** 1 起算的選項編號 */
    answer: z.number().int().min(1),
  })
  .refine((q) => q.answer <= q.options.length, {
    path: ['answer'],
    message: '答案必須落在選項範圍內',
  });

export const multiSelectQuestionSchema = questionBase
  .extend({
    type: z.literal('multi-select'),
    options: optionsSchema,
    /** 所有正確選項的編號，從 1 起算；至少一個。 */
    answer: z.array(z.number().int().positive()).min(1, '至少要有一個正確選項'),
  })
  .superRefine((q, ctx) => {
    const seen = new Set<number>();
    q.answer.forEach((number, index) => {
      if (number > q.options.length) {
        ctx.addIssue({ code: 'custom', path: ['answer', index], message: '答案必須落在選項範圍內' });
      }
      if (seen.has(number)) {
        ctx.addIssue({ code: 'custom', path: ['answer', index], message: '同一個選項不可重複作答' });
      }
      seen.add(number);
    });
  });

/** 標示空格位置與大小相對於整張圖，以百分比表示；答案與空格一起保存。 */
const diagramLabelSchema = z
  .strictObject({
    x: z.number().min(0).max(100),
    y: z.number().min(0).max(100),
    width: z.number().positive().max(100),
    height: z.number().positive().max(100),
    answer: blankAnswer,
  })
  .superRefine((label, ctx) => {
    if (label.x + label.width > 100) ctx.addIssue({ code: 'custom', path: ['width'], message: '空格不可超出圖片右緣' });
    if (label.y + label.height > 100) ctx.addIssue({ code: 'custom', path: ['height'], message: '空格不可超出圖片下緣' });
  });

export const diagramLabelQuestionSchema = questionBase.extend({
  type: z.literal('diagram-label'),
  image: imageSchema,
  labels: z.array(diagramLabelSchema).min(1),
});

export const tableFillQuestionSchema = questionBase
  .extend({
    type: z.literal('table-fill'),
    /** 欄標題可以是文字、圖片或兩者；每列有文字標題及各欄的答案。 */
    columns: z.array(visualTextSchema).min(1),
    rows: z.array(z.strictObject({
      label: richText,
      answers: z.array(blankAnswer).min(1),
    })).min(1),
  })
  .superRefine((q, ctx) => {
    q.rows.forEach((row, index) => {
      if (row.answers.length !== q.columns.length) {
        ctx.addIssue({ code: 'custom', path: ['rows', index, 'answers'], message: `此列有 ${row.answers.length} 個答案，但表格有 ${q.columns.length} 欄` });
      }
    });
  });

export const trueFalseQuestionSchema = questionBase.extend({
  type: z.literal('true-false'),
  answer: z.boolean(),
});

export const fillBlankQuestionSchema = questionBase
  .extend({
    type: z.literal('fill-blank'),
    /** 每個空格一個答案，依題幹中空格出現的順序 */
    answer: z
      .array(blankAnswer)
      .min(1),
  })
  .superRefine((q, ctx) => {
    if (hasOverlongUnderscores(q.stem)) {
      ctx.addIssue({
        code: 'custom',
        path: ['stem'],
        message: '空格請用剛好三個底線 ___，題幹中不可出現連續四個以上的底線',
      });
      return;
    }
    const blanks = countBlanks(q.stem);
    if (blanks === 0) {
      ctx.addIssue({ code: 'custom', path: ['stem'], message: '填空題的題幹至少要有一個空格（___）' });
    } else if (blanks !== q.answer.length) {
      ctx.addIssue({
        code: 'custom',
        path: ['answer'],
        message: `題幹有 ${blanks} 個空格，但 answer 有 ${q.answer.length} 個答案`,
      });
    }
  });

// 國字注音與注音寫國字：資料形狀相同，答案就是題幹中的標注，所以沒有 answer 欄位
export const charToZhuyinQuestionSchema = questionBase.extend({
  type: z.literal('char-to-zhuyin'),
  stem: zhuyinTargetStem,
});

export const zhuyinToCharQuestionSchema = questionBase.extend({
  type: z.literal('zhuyin-to-char'),
  stem: zhuyinTargetStem,
});

/** 答案寫在作答行（列）上的題型，space 不可為 0，否則答案卷的答案沒有地方放。 */
function requireAnswerRow(message: string) {
  return (q: { space?: number | undefined }, ctx: z.RefinementCtx) => {
    if (q.space === 0) ctx.addIssue({ code: 'custom', path: ['space'], message });
  };
}

const sentenceSpaceMessage = '造句類題型至少要有一行作答行，space 不可為 0';

export const makeSentenceQuestionSchema = questionBase
  .extend({
    type: z.literal('make-sentence'),
    /** 範例句子 */
    answer: richText,
  })
  .superRefine(requireAnswerRow(sentenceSpaceMessage));

export const imitateSentenceQuestionSchema = questionBase
  .extend({
    type: z.literal('imitate-sentence'),
    /** 題幹下方顯示的例句 */
    example: richText,
    /** 範例句子 */
    answer: richText,
  })
  .superRefine(requireAnswerRow(sentenceSpaceMessage));

export const horizontalCalcQuestionSchema = questionBase.extend({
  type: z.literal('horizontal-calc'),
  /** 題幹含算式與結尾的等號，例如 `$36 + 48 =$`；答案填在題幹後的底線上 */
  answer: answerText('答案必須是非空字串或數字'),
});

export const verticalCalcQuestionSchema = questionBase
  .extend({
    type: z.literal('vertical-calc'),
    /** 由上到下的運算元 */
    operands: z.array(decimalNumber).min(2),
    operator: z.enum(OPERATORS),
    answer: decimalNumber,
  })
  .superRefine(requireAnswerRow('直式計算至少要有一列答案列，space 不可為 0'))
  .superRefine((q, ctx) => {
    // 運算元或答案本身格式有誤時，欄位的錯誤已經回報，不再算結果
    if (![...q.operands, q.answer].every((n) => DECIMAL_FORMAT.test(n))) return;
    const result = calculate(q.operands, q.operator);
    if (result === null) {
      ctx.addIssue({ code: 'custom', path: ['operands'], message: '減法的結果不可為負數（國小直式減法被減數要夠大）' });
    } else if (!sameNumber(q.answer, result)) {
      ctx.addIssue({
        code: 'custom',
        path: ['answer'],
        message: `答案 ${q.answer} 與計算結果不符，正確答案是 ${result}`,
      });
    }
  });

export const wordProblemQuestionSchema = questionBase.extend({
  type: z.literal('word-problem'),
  /** 答句，不含「答：」前綴，例如「小明共有 12 顆蘋果。」 */
  answer: richText,
});

// 題型的鑑別聯集；之後的 ticket 在這裡加題型。
export const questionSchema = z
  .discriminatedUnion('type', [
    choiceQuestionSchema,
    multiSelectQuestionSchema,
    diagramLabelQuestionSchema,
    tableFillQuestionSchema,
    trueFalseQuestionSchema,
    fillBlankQuestionSchema,
    charToZhuyinQuestionSchema,
    zhuyinToCharQuestionSchema,
    makeSentenceQuestionSchema,
    imitateSentenceQuestionSchema,
    horizontalCalcQuestionSchema,
    verticalCalcQuestionSchema,
    wordProblemQuestionSchema,
  ])
  .superRefine((q, ctx) => {
    const hasSource = q.source !== undefined;
    const hasDerived = q.derivedFrom !== undefined;
    if (hasSource === hasDerived) {
      ctx.addIssue({
        code: 'custom',
        path: [hasSource ? 'derivedFrom' : 'source'],
        message: hasSource
          ? '原題（source）與新題（derivedFrom）只能擇一，不可同時存在'
          : '必須有 source（原題）或 derivedFrom（新題）其中之一',
      });
    }
  });

/** 題庫檔：一個檔案是一份原卷，或一次產生的新題。 */
export const bankFileSchema = z
  .strictObject({
    questions: z.array(questionSchema).min(1),
  })
  .superRefine((file, ctx) => {
    // 檔內 no 不可重複，否則題目 ID 會撞名；跨檔的 ID 重複是另一層檢查
    const seen = new Set<number>();
    file.questions.forEach((q, i) => {
      if (seen.has(q.no)) {
        ctx.addIssue({
          code: 'custom',
          path: ['questions', i, 'no'],
          message: `題號 no ${q.no} 在同一個題庫檔內重複`,
        });
      }
      seen.add(q.no);
    });
  });

export const sectionSchema = z.strictObject({
  title: z.string().min(1),
  /** 配分 */
  points: z.number().int().positive().optional(),
  /** 題目 ID */
  questions: z.array(z.string().min(1)).min(1),
});

/** 試卷檔 */
export const paperFileSchema = z.strictObject({
  title: z.string().min(1),
  subject: subjectSchema,
  grade: gradeSchema,
  sections: z.array(sectionSchema).min(1),
});

export type Question = z.infer<typeof questionSchema>;
export type ChoiceQuestion = z.infer<typeof choiceQuestionSchema>;
export type MultiSelectQuestion = z.infer<typeof multiSelectQuestionSchema>;
export type DiagramLabelQuestion = z.infer<typeof diagramLabelQuestionSchema>;
export type TableFillQuestion = z.infer<typeof tableFillQuestionSchema>;
export type VisualText = z.infer<typeof visualTextSchema>;
export type TrueFalseQuestion = z.infer<typeof trueFalseQuestionSchema>;
export type FillBlankQuestion = z.infer<typeof fillBlankQuestionSchema>;
export type CharToZhuyinQuestion = z.infer<typeof charToZhuyinQuestionSchema>;
export type ZhuyinToCharQuestion = z.infer<typeof zhuyinToCharQuestionSchema>;
export type MakeSentenceQuestion = z.infer<typeof makeSentenceQuestionSchema>;
export type ImitateSentenceQuestion = z.infer<typeof imitateSentenceQuestionSchema>;
export type HorizontalCalcQuestion = z.infer<typeof horizontalCalcQuestionSchema>;
export type VerticalCalcQuestion = z.infer<typeof verticalCalcQuestionSchema>;
export type WordProblemQuestion = z.infer<typeof wordProblemQuestionSchema>;
export type BankFile = z.infer<typeof bankFileSchema>;
export type PaperFile = z.infer<typeof paperFileSchema>;
