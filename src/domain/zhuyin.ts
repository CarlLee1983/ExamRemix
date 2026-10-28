// 注音標注：文字中的 `[字|注音]` 把注音標在字上，多字寫成 `[公園|ㄍㄨㄥ ㄩㄢˊ]`，
// 注音以半形空白分隔、組數必須等於字數。沒有 `|` 的 `[...]` 一律是一般文字；要寫出不被當成標注的 `[`，寫成 `\[`。
// 用 [ ] 而不是 { }，是為了不和之後數學式的 LaTeX 衝突。
// 純函式，不依賴 Astro；schema 與 RichText 元件都讀這個檔，標注寫法的定義集中在此。

export type Segment =
  | { kind: 'text'; text: string }
  | {
      kind: 'ruby';
      /** 被標注的字與各自的注音，一個元素一個字 */
      chars: { char: string; zhuyin: string }[];
    };

export interface ParseResult {
  segments: Segment[];
  /** 格式錯誤的說明，沒有錯誤時為空陣列 */
  errors: string[];
}

// 一組注音的結構：輕聲 ˙ 只能放最前面，注音符號（ㄅ–ㄩ，U+3105–U+3129）至少一個，
// 其他聲調（ˊ ˇ ˋ）最多一個且放最後
const VALID_GROUP = /^˙?[ㄅ-ㄩ]+[ˊˇˋ]?$/;

// 以字素為單位數字：帶異體字選擇符等組合字元的字算一個字
const graphemes = new Intl.Segmenter('zh-Hant', { granularity: 'grapheme' });

function parseAnnotation(content: string): { segment?: Segment; errors: string[] } {
  const marker = `[${content}]`;
  const bar = content.indexOf('|');
  const chars = Array.from(graphemes.segment(content.slice(0, bar)), (g) => g.segment);
  const groups = content.slice(bar + 1).split(' ');
  const errors: string[] = [];

  const charsOk = chars.length > 0 && !chars.some((c) => /[\s_]/.test(c));
  if (chars.length === 0) {
    errors.push(`注音標注「${marker}」缺少要標注的字`);
  } else if (!charsOk) {
    errors.push(`注音標注「${marker}」標注的字不可包含空白或底線`);
  }
  if (groups.some((g) => g === '')) {
    errors.push(`注音標注「${marker}」含空的注音組，注音請以單一半形空白分隔`);
  }
  for (const group of groups.filter((g) => g !== '' && !VALID_GROUP.test(g))) {
    errors.push(
      `注音標注「${marker}」含非法注音「${group}」，只能由注音符號（ㄅ–ㄩ）組成，輕聲 ˙ 放最前面，其他聲調（ˊ ˇ ˋ）最多一個且放最後`,
    );
  }
  if (charsOk && groups.length !== chars.length && !groups.some((g) => g === '')) {
    errors.push(`注音標注「${marker}」的注音組數（${groups.length}）必須等於字數（${chars.length}）`);
  }

  return errors.length > 0 ? { errors } : { segment: { kind: 'ruby', chars: chars.map((char, i) => ({ char, zhuyin: groups[i]! })) }, errors };
}

/** 把文字切成一般文字與注音標注的片段，並回報所有格式錯誤；有錯誤的標注不會出現在 segments。 */
export function parseZhuyin(text: string): ParseResult {
  const segments: Segment[] = [];
  const errors: string[] = [];
  let plain = '';
  const flush = () => {
    if (plain !== '') segments.push({ kind: 'text', text: plain });
    plain = '';
  };

  let i = 0;
  while (i < text.length) {
    if (text.startsWith('\\[', i)) {
      // \[ 是字面的 [，不開始注音標注；單獨的 ] 本來就是一般文字，所以不需要 \]
      plain += '[';
      i += 2;
      continue;
    }
    if (text[i] !== '[') {
      plain += text[i];
      i += 1;
      continue;
    }
    // 找這個 [ 之後第一個 ] 或沒被跳脫的 [，決定它是標注、一般文字，還是未閉合
    const rest = text.slice(i + 1);
    const next = rest.search(/[\]]|(?<!\\)\[/);
    const closed = next >= 0 && rest[next] === ']';
    const body = next >= 0 ? rest.slice(0, next) : rest;

    if (!body.includes('|')) {
      // 沒有 | 的 [...] 是一般文字：只吃掉這個 [，其餘照常往後掃
      plain += '[';
      i += 1;
    } else if (!closed) {
      errors.push(`注音標注未閉合：「[${body}」缺少 ]`);
      i += 1 + body.length;
    } else {
      const result = parseAnnotation(body);
      errors.push(...result.errors);
      if (result.segment) {
        flush();
        segments.push(result.segment);
      }
      i += body.length + 2;
    }
  }
  flush();
  return { segments, errors };
}

/** 去掉注音，只留字。 */
export function plainText(segments: Segment[]): string {
  return segments.map((s) => (s.kind === 'text' ? s.text : s.chars.map((c) => c.char).join(''))).join('');
}

export function hasAnnotation(segments: Segment[]): boolean {
  return segments.some((s) => s.kind === 'ruby');
}
