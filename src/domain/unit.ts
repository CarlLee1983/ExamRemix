// 「沒有單元」的顯示與篩選值：列出題目指令（--unit -）與題庫瀏覽頁的單元篩選共用這一個定義。
// schema 不接受單元本身就是這個值，所以它不會和真的單元撞名。
export const NO_UNIT_LABEL = '-';

export const unitLabel = (unit: string | undefined): string => unit ?? NO_UNIT_LABEL;
