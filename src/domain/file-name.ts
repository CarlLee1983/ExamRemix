// 題庫檔與試卷檔共用的檔名規則：檔名（不含副檔名）是題目 ID 的前綴，試卷檔名也是網址的一段，
// 所以只允許小寫英數字與連字號。CLI 與 Astro 建置都用這一條，避免兩邊對同一個檔名結論不同。
const BASENAME = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const EXTENSION = '.yaml';

/** 檔名（含副檔名，不含目錄）合格回傳 undefined，否則回傳原因。 */
export function fileNameProblem(fileName: string): string | undefined {
  if (!fileName.endsWith(EXTENSION)) {
    return `檔名必須以 ${EXTENSION} 結尾`;
  }
  if (!BASENAME.test(fileName.slice(0, -EXTENSION.length))) {
    return '檔名只能使用小寫英數字與連字號（例如 sample-math.yaml），且不能以連字號開頭、結尾或連續出現';
  }
  return undefined;
}
