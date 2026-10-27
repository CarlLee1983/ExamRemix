// 作答空間：每個題型的預設值與單題覆寫，單位是「行」。
// 各題型元件都從這裡取行數，預設值的定義集中在此；行高是 paper.css 的 --calc-line-height 與 --sentence-line-height。
import type { Question } from './schema.ts';

/**
 * 各題型的預設作答空間（行）。意義依題型而定：
 * 造句類是作答行數；橫式計算與應用題是計算區的高度；直式計算是橫線下方的列數（答案寫在最後一列）；
 * 預設 0 的題型沒有額外作答空間，覆寫後才在題目下方留白。
 */
export const DEFAULT_SPACE: Record<Question['type'], number> = {
  choice: 0,
  'multi-select': 0,
  'diagram-label': 0,
  'table-fill': 0,
  'true-false': 0,
  'fill-blank': 0,
  'char-to-zhuyin': 0,
  'zhuyin-to-char': 0,
  'make-sentence': 2,
  'imitate-sentence': 2,
  'horizontal-calc': 2,
  'vertical-calc': 1,
  'word-problem': 4,
};

/** 題目覆寫的作答空間，沒覆寫時用題型預設。 */
export function answerSpace(question: Question): number {
  return question.space ?? DEFAULT_SPACE[question.type];
}
