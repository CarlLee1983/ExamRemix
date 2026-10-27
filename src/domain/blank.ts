// 填空題的空格標記：題幹中連續三個半形底線是一個空格。
// 只有 schema 與填空題元件讀這個檔，空格寫法的定義集中在此。
const BLANK_MARK = /_{3}/;

/** 以空格為界切開題幹；n 個空格會得到 n + 1 段文字（可能為空字串）。 */
export function splitStem(stem: string): string[] {
  return stem.split(new RegExp(BLANK_MARK, 'g'));
}

export function countBlanks(stem: string): number {
  return splitStem(stem).length - 1;
}
