// 題庫檢查模組：題庫檔與試卷檔的 schema。
// 只依賴 astro/zod，不碰 Astro 執行環境，讓 Vitest 與 agent 都能直接呼叫（ADR 0002）。
import { z } from 'astro/zod';
import { countBlanks } from './blank.ts';

export const SUBJECTS = ['國語', '數學'] as const;

const subjectSchema = z.enum(SUBJECTS);
const gradeSchema = z.number().int().min(1).max(6);

/** 題目 ID：題庫檔名（不含副檔名）加兩位數序號，例如 sample-math-01。 */
export function deriveQuestionId(bankName: string, no: number): string {
  return `${bankName}-${String(no).padStart(2, '0')}`;
}

// 所有題型共用的欄位；新題型以 extend 加上自己的欄位。
const questionBase = z.strictObject({
  no: z.number().int().positive(),
  subject: subjectSchema,
  grade: gradeSchema,
  unit: z.string().min(1).optional(),
  stem: z.string().min(1),
  explanation: z.string().min(1),
  confirmed: z.boolean().default(false),
  // 原題記錄出處，新題記錄衍生自哪些題目；兩者擇一（見 questionSchema）
  source: z
    .strictObject({
      originalPaper: z.string().min(1),
      number: z.number().int().positive(),
    })
    .optional(),
  derivedFrom: z.array(z.string().min(1)).min(1).optional(),
});

export const choiceQuestionSchema = questionBase
  .extend({
    type: z.literal('choice'),
    options: z.array(z.string().min(1)).min(2).max(6),
    /** 1 起算的選項編號 */
    answer: z.number().int().min(1),
  })
  .refine((q) => q.answer <= q.options.length, {
    path: ['answer'],
    message: '答案必須落在選項範圍內',
  });

export const trueFalseQuestionSchema = questionBase.extend({
  type: z.literal('true-false'),
  answer: z.boolean(),
});

export const fillBlankQuestionSchema = questionBase
  .extend({
    type: z.literal('fill-blank'),
    /** 每個空格一個答案，依題幹中空格出現的順序 */
    answer: z.array(z.string().min(1)).min(1),
  })
  .superRefine((q, ctx) => {
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

// 題型的鑑別聯集；之後的 ticket 在這裡加題型。
export const questionSchema = z
  .discriminatedUnion('type', [choiceQuestionSchema, trueFalseQuestionSchema, fillBlankQuestionSchema])
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
export type TrueFalseQuestion = z.infer<typeof trueFalseQuestionSchema>;
export type FillBlankQuestion = z.infer<typeof fillBlankQuestionSchema>;
export type BankFile = z.infer<typeof bankFileSchema>;
export type PaperFile = z.infer<typeof paperFileSchema>;
