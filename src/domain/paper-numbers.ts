// 試卷內的題號：跨大題連續編號，從 1 開始。純函式，試卷頁與疑點提示共用。
import { hasDoubt } from './doubt.ts';

interface NumberedSection<T> {
  questions: readonly T[];
}

/** 每個大題的起始題號 = 前面各大題的題數總和 + 1。 */
export function firstNumbers(sections: readonly NumberedSection<unknown>[]): number[] {
  let next = 1;
  return sections.map((section) => {
    const first = next;
    next += section.questions.length;
    return first;
  });
}

/** 有疑點的題目在試卷裡的題號，依出現順序。 */
export function doubtedNumbers(sections: readonly NumberedSection<{ doubt?: string }>[]): number[] {
  const firsts = firstNumbers(sections);
  return sections.flatMap((section, s) =>
    section.questions.flatMap((question, i) => (hasDoubt(question) ? [firsts[s]! + i] : [])),
  );
}
