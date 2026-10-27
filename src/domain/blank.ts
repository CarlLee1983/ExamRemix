// 填空題的空格標記：題幹中剛好連續三個半形底線是一個空格。
// 只有 schema 與填空題、橫式計算元件讀這個檔，空格寫法的定義集中在此。
import { parseRichText, richPlainText } from './rich-text.ts';

const BLANK_MARK = /(?<!_)_{3}(?!_)/g;
const OVERLONG_UNDERSCORES = /_{4,}/;

/** 以空格為界切開題幹；n 個空格會得到 n + 1 段文字（可能為空字串）。 */
export function splitStem(stem: string): string[] {
  return stem.split(BLANK_MARK);
}

export function countBlanks(stem: string): number {
  return splitStem(stem).length - 1;
}

/** 題幹含連續四個以上的底線：無法判斷是幾個空格，一律視為寫錯。 */
export function hasOverlongUnderscores(stem: string): boolean {
  return OVERLONG_UNDERSCORES.test(stem);
}

/**
 * 空格底線的寬度（單位 em）：半形字元 0.6em、其餘（全形）1em，再加 1em 左右留白。
 * 寬度刻意依答案字數決定，試卷與答案卷同寬，所以試卷上看得出答案有幾個字，這是已知的取捨。
 */
export function blankWidthEm(answer: string): number {
  let width = 1;
  for (const char of answer) width += char.codePointAt(0)! <= 0x7f ? 0.6 : 1;
  return Math.round(width * 100) / 100;
}

/** 答案文字（可含注音標注與數學式）的空格底線寬度；填空題與橫式計算共用。 */
export function answerBlankWidthEm(answer: string): number {
  return blankWidthEm(richPlainText(parseRichText(answer).segments));
}
