import { describe, expect, it } from 'vitest';
import { doubtedNumbers, firstNumbers } from '../src/domain/paper-numbers.ts';

const section = (...doubts: (string | undefined)[]) => ({ questions: doubts.map((doubt) => ({ doubt })) });

describe('firstNumbers', () => {
  it('題號在試卷內連續編號：每個大題的起始題號接在前面各大題之後', () => {
    expect(firstNumbers([section(undefined, undefined), section(undefined), section(undefined)])).toEqual([1, 3, 4]);
  });
});

describe('doubtedNumbers', () => {
  it('列出有疑點的題目在試卷裡的題號，跨大題連續編號', () => {
    expect(doubtedNumbers([section(undefined, '推定'), section(undefined, undefined, '看不清')])).toEqual([2, 5]);
  });

  it('沒有疑點時回傳空陣列', () => {
    expect(doubtedNumbers([section(undefined), section(undefined)])).toEqual([]);
  });
});
