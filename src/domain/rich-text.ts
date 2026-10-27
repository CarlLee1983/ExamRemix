// 富文字：題目文字欄位的完整語法。`$...$` 是數學式（LaTeX，由 KaTeX 渲染），`\$` 是字面的錢字號，
// 數學式以外的部分交給 parseZhuyin 處理注音標注；數學式的內容不做注音解析。
// 純函式，不依賴 Astro；schema 與 RichText 元件都讀這個檔，數學式寫法的定義集中在此。
import katex from 'katex';
import { parseZhuyin, plainText, type Segment } from './zhuyin.ts';

export type RichSegment = Segment | { kind: 'math'; tex: string };

export interface RichParseResult {
  segments: RichSegment[];
  /** 格式錯誤的說明，沒有錯誤時為空陣列 */
  errors: string[];
}

/** 渲染數學式；LaTeX 無法解析時丟出 KaTeX 的 ParseError。schema 檢查與元件渲染用同一組選項。 */
export function renderMath(tex: string): string {
  return katex.renderToString(tex, { throwOnError: true });
}

/** 把文字切成一般文字、注音標注與數學式的片段，並回報所有格式錯誤；有錯誤的片段不會出現在 segments。 */
export function parseRichText(text: string): RichParseResult {
  const segments: RichSegment[] = [];
  const errors: string[] = [];
  let plain = '';
  const flush = () => {
    if (plain === '') return;
    const result = parseZhuyin(plain);
    segments.push(...result.segments);
    errors.push(...result.errors);
    plain = '';
  };

  let i = 0;
  while (i < text.length) {
    if (text.startsWith('\\$', i)) {
      plain += '$';
      i += 2;
    } else if (text[i] !== '$') {
      plain += text[i];
      i += 1;
    } else {
      // 找下一個沒被反斜線跳脫的 $；數學式內的 \$ 原樣交給 KaTeX（它認得 \$）
      let end = i + 1;
      while (end < text.length && text[end] !== '$') end += text[end] === '\\' ? 2 : 1;
      if (end >= text.length) {
        errors.push(`數學式未閉合：「${text.slice(i)}」缺少結尾的 $（字面的錢字號請寫成 \\$）`);
        break;
      }
      const tex = text.slice(i + 1, end);
      i = end + 1;
      if (tex.trim() === '') {
        errors.push('數學式不可為空：$$ 中間沒有內容（字面的錢字號請寫成 \\$）');
        continue;
      }
      try {
        renderMath(tex);
      } catch (error) {
        errors.push(`數學式「$${tex}$」無法以 KaTeX 解析：${(error as Error).message}`);
        continue;
      }
      flush();
      segments.push({ kind: 'math', tex });
    }
  }
  flush();
  return { segments, errors };
}

/** 去掉注音，只留字；數學式以原始 LaTeX 計入（用於估算寬度）。 */
export function richPlainText(segments: RichSegment[]): string {
  return segments.map((s) => (s.kind === 'math' ? s.tex : plainText([s]))).join('');
}
