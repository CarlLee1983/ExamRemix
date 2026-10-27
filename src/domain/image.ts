// 題目附圖的檔案規則：支援的副檔名、題庫檔內 `image.src` 的寫法、Content-Type。
// 純函式，不依賴 Astro 與 node；schema、讀檔流程與圖片端點都讀這個檔，圖片格式的定義集中在此。

const CONTENT_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  webp: 'image/webp',
};

function extensionOf(path: string): string | undefined {
  const match = /\.([A-Za-z0-9]+)$/.exec(path);
  const ext = match?.[1]?.toLowerCase();
  return ext !== undefined && ext in CONTENT_TYPES ? ext : undefined;
}

export function isImageFile(path: string): boolean {
  return extensionOf(path) !== undefined;
}

/** 副檔名不支援時回傳 undefined。 */
export function imageContentType(path: string): string | undefined {
  const ext = extensionOf(path);
  return ext === undefined ? undefined : CONTENT_TYPES[ext];
}

/** `image.src` 是相對於 bank/ 的路徑，用 / 分隔；寫法有問題時回傳原因，合格時回傳 null。 */
export function imageSrcProblem(src: string): string | null {
  if (src === '') return '圖片路徑不可為空';
  if (src.includes('\\')) return '圖片路徑請用 / 分隔，不可含反斜線';
  if (src.startsWith('/') || /^[A-Za-z]:/.test(src)) return '圖片路徑必須是相對於 bank/ 的相對路徑，不可是絕對路徑';
  if (src.split('/').includes('..')) return '圖片路徑不可含 ..';
  if (!isImageFile(src)) return `圖片副檔名必須是 ${Object.keys(CONTENT_TYPES).join('、')} 其中之一`;
  return null;
}
