// 疑點：題目上選填的 doubt（非空字串）；有這個欄位就是有疑點。判斷集中在這裡，頁面、檢查與指令共用。

/** 題目有沒有疑點；有的話 doubt 一定是非空字串。 */
export function hasDoubt<T extends { doubt?: string }>(question: T): question is T & { doubt: string } {
  return question.doubt !== undefined;
}
