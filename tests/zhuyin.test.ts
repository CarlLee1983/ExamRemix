import { describe, expect, it } from 'vitest';
import { hasAnnotation, parseZhuyin, plainText } from '../src/domain/zhuyin';

describe('parseZhuyin', () => {
  it('沒有標注時整段是一般文字', () => {
    expect(parseZhuyin('今天天氣很好')).toEqual({
      segments: [{ kind: 'text', text: '今天天氣很好' }],
      errors: [],
    });
  });

  it('空字串沒有任何片段', () => {
    expect(parseZhuyin('')).toEqual({ segments: [], errors: [] });
  });

  it('單字標注', () => {
    expect(parseZhuyin('[國|ㄍㄨㄛˊ]').segments).toEqual([
      { kind: 'ruby', chars: ['國'], zhuyin: ['ㄍㄨㄛˊ'] },
    ]);
  });

  it('多字標注：注音以半形空白分隔，與字一一對應', () => {
    expect(parseZhuyin('[公園|ㄍㄨㄥ ㄩㄢˊ]')).toEqual({
      segments: [{ kind: 'ruby', chars: ['公', '園'], zhuyin: ['ㄍㄨㄥ', 'ㄩㄢˊ'] }],
      errors: [],
    });
  });

  it('一句中有多個標注，前後與中間的文字保留', () => {
    const { segments, errors } = parseZhuyin('我在[公園|ㄍㄨㄥ ㄩㄢˊ]看見[花|ㄏㄨㄚ]。');
    expect(errors).toEqual([]);
    expect(segments).toEqual([
      { kind: 'text', text: '我在' },
      { kind: 'ruby', chars: ['公', '園'], zhuyin: ['ㄍㄨㄥ', 'ㄩㄢˊ'] },
      { kind: 'text', text: '看見' },
      { kind: 'ruby', chars: ['花'], zhuyin: ['ㄏㄨㄚ'] },
      { kind: 'text', text: '。' },
    ]);
  });

  it('沒有 | 的 [...] 當成一般文字', () => {
    expect(parseZhuyin('選項[1]與[乙]')).toEqual({
      segments: [{ kind: 'text', text: '選項[1]與[乙]' }],
      errors: [],
    });
  });

  it('沒有 | 也沒有 ] 的 [ 當成一般文字', () => {
    expect(parseZhuyin('a [b')).toEqual({ segments: [{ kind: 'text', text: 'a [b' }], errors: [] });
  });

  it('輕聲 ˙ 放在注音前或後都合法', () => {
    expect(parseZhuyin('[子|˙ㄗ]').errors).toEqual([]);
    expect(parseZhuyin('[嗎|ㄇㄚ˙]').errors).toEqual([]);
  });

  it('與空格 ___ 共存：___ 保留在一般文字中', () => {
    expect(parseZhuyin('[花|ㄏㄨㄚ]是___的')).toEqual({
      segments: [
        { kind: 'ruby', chars: ['花'], zhuyin: ['ㄏㄨㄚ'] },
        { kind: 'text', text: '是___的' },
      ],
      errors: [],
    });
  });

  it('注音組數少於字數時回報錯誤，說明兩個數量', () => {
    const { errors } = parseZhuyin('[公園|ㄍㄨㄥ]');
    expect(errors).toEqual(['注音標注「[公園|ㄍㄨㄥ]」的注音組數（1）必須等於字數（2）']);
  });

  it('注音組數多於字數時回報錯誤', () => {
    const { errors } = parseZhuyin('[公|ㄍㄨㄥ ㄩㄢˊ]');
    expect(errors).toEqual(['注音標注「[公|ㄍㄨㄥ ㄩㄢˊ]」的注音組數（2）必須等於字數（1）']);
  });

  it('注音含非法字元時回報錯誤，指出該組', () => {
    expect(parseZhuyin('[花|hua]').errors).toEqual([
      '注音標注「[花|hua]」含非法注音「hua」，只能使用注音符號（ㄅ–ㄩ）與聲調符號（ˊ ˇ ˋ ˙）',
    ]);
    expect(parseZhuyin('[花|ㄏㄨㄚ1]').errors).toHaveLength(1);
  });

  it('只有聲調符號、沒有注音符號的組是非法的', () => {
    expect(parseZhuyin('[花|ˊ]').errors).toHaveLength(1);
  });

  it('空的注音組（多餘空白或空注音）是非法的', () => {
    expect(parseZhuyin('[公園|ㄍㄨㄥ  ㄩㄢˊ]').errors.length).toBeGreaterThan(0);
    expect(parseZhuyin('[花|]').errors).toEqual([
      '注音標注「[花|]」含空的注音組，注音請以單一半形空白分隔',
    ]);
  });

  it('缺少要標注的字時回報錯誤', () => {
    expect(parseZhuyin('[|ㄏㄨㄚ]').errors).toEqual(['注音標注「[|ㄏㄨㄚ]」缺少要標注的字']);
  });

  it('標注的字不可含空白或底線', () => {
    expect(parseZhuyin('[花 草|ㄏㄨㄚ ㄘㄠˇ]').errors).toHaveLength(1);
    expect(parseZhuyin('[花_|ㄏㄨㄚ ㄅ]').errors).toHaveLength(1);
  });

  it('未閉合：有 | 但沒有 ] 時回報錯誤', () => {
    expect(parseZhuyin('今天[花|ㄏㄨㄚ').errors).toEqual([
      '注音標注未閉合：「[花|ㄏㄨㄚ」缺少 ]',
    ]);
  });

  it('未閉合：下一個 [ 出現前沒有 ] 時回報錯誤，後面的標注仍可解析', () => {
    const { segments, errors } = parseZhuyin('[花|ㄏㄨㄚ [草|ㄘㄠˇ]');
    expect(errors).toEqual(['注音標注未閉合：「[花|ㄏㄨㄚ 」缺少 ]']);
    expect(segments.some((s) => s.kind === 'ruby' && s.chars[0] === '草')).toBe(true);
  });

  it('同一段文字的多個錯誤全部回報', () => {
    expect(parseZhuyin('[花|hua][草|ㄘㄠˇ ㄘ]').errors).toHaveLength(2);
  });
});

describe('plainText / hasAnnotation', () => {
  it('plainText 去掉注音，只留字', () => {
    expect(plainText(parseZhuyin('我在[公園|ㄍㄨㄥ ㄩㄢˊ]玩').segments)).toBe('我在公園玩');
  });

  it('hasAnnotation 判斷是否至少有一個標注', () => {
    expect(hasAnnotation(parseZhuyin('[花|ㄏㄨㄚ]').segments)).toBe(true);
    expect(hasAnnotation(parseZhuyin('花[1]').segments)).toBe(false);
  });
});
