import { describe, expect, it } from 'vitest';
import { blankWidthEm, countBlanks, hasOverlongUnderscores, splitStem } from '../src/domain/blank';

describe('splitStem / countBlanks', () => {
  it('剛好三個底線是一個空格', () => {
    expect(splitStem('5 × 8 = ___')).toEqual(['5 × 8 = ', '']);
    expect(countBlanks('5 × 8 = ___')).toBe(1);
  });

  it('兩個以空白隔開的空格', () => {
    expect(splitStem('___ 加 ___')).toEqual(['', ' 加 ', '']);
    expect(countBlanks('___ 加 ___')).toBe(2);
  });

  it('題幹以空格開頭或結尾', () => {
    expect(splitStem('___ 是答案')).toEqual(['', ' 是答案']);
    expect(splitStem('答案是 ___')).toEqual(['答案是 ', '']);
  });

  it('沒有空格時只有一段', () => {
    expect(splitStem('沒有空格')).toEqual(['沒有空格']);
    expect(countBlanks('沒有空格')).toBe(0);
  });

  it('只有兩個底線不算空格', () => {
    expect(countBlanks('a __ b')).toBe(0);
    expect(hasOverlongUnderscores('a __ b')).toBe(false);
  });

  it('四個以上的底線不算空格，並被判為過長', () => {
    for (const run of ['____', '_____', '______']) {
      expect(countBlanks(`a ${run} b`)).toBe(0);
      expect(hasOverlongUnderscores(`a ${run} b`)).toBe(true);
    }
  });

  it('剛好三個底線不算過長', () => {
    expect(hasOverlongUnderscores('a ___ b ___')).toBe(false);
  });
});

describe('blankWidthEm', () => {
  it('半形字元 0.6em、全形 1em，再加 1em 留白', () => {
    expect(blankWidthEm('7')).toBe(1.6);
    expect(blankWidthEm('1000')).toBe(3.4);
    expect(blankWidthEm('譬喻')).toBe(3);
    expect(blankWidthEm('3公尺')).toBe(3.6);
  });
});
