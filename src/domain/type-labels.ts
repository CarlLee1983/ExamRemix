// 題型的中文名稱：題庫瀏覽頁的題型欄位與篩選用。Record 以題型為鍵，新增題型漏填時型別檢查會報錯。
import type { Question } from './schema.ts';

export const TYPE_LABELS: Record<Question['type'], string> = {
  choice: '選擇題',
  'multi-select': '勾選題',
  'diagram-label': '圖示標示題',
  'table-fill': '表格填答題',
  'true-false': '是非題',
  'fill-blank': '填空題',
  'char-to-zhuyin': '國字注音',
  'zhuyin-to-char': '注音寫國字',
  'make-sentence': '造句',
  'imitate-sentence': '照樣造句',
  'horizontal-calc': '橫式計算',
  'vertical-calc': '直式計算',
  'word-problem': '應用題',
};
