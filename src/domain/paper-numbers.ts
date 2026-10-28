// 試卷內的題號：跨大題連續編號，從 1 開始。純函式。

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
