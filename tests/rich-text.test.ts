import { describe, expect, it } from 'vitest';
import { parseRichText } from '../src/domain/rich-text';

describe('parseRichText 的 \\[ 與 \\$、數學式', () => {
  it('\\[ 與 \\$ 並用，各自變成字面字元', () => {
    expect(parseRichText('\\[A|B] 要 \\$5')).toEqual({
      segments: [{ kind: 'text', text: '[A|B] 要 $5' }],
      errors: [],
    });
  });

  it('跳脫的方括號與數學式並存，數學式內容不受影響', () => {
    expect(parseRichText('\\[A|B] 與 $x + 1$').segments).toEqual([
      { kind: 'text', text: '[A|B] 與 ' },
      { kind: 'math', tex: 'x + 1' },
    ]);
  });
});

describe('parseRichText：數學式內的 \\[', () => {
  it('$...$ 內的 \\[ 原樣交給 KaTeX（它不認得，所以報數學式錯誤），不被當成字面方括號', () => {
    const { segments, errors } = parseRichText('$\\[x$');
    expect(segments).toEqual([]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('數學式「$\\[x$」無法以 KaTeX 解析');
    expect(errors[0]).toContain('Undefined control sequence: \\[');
  });
});
