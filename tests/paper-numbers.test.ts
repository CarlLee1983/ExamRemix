import { describe, expect, it } from 'vitest';
import { firstNumbers } from '../src/domain/paper-numbers.ts';

const section = (...questions: unknown[]) => ({ questions });

describe('firstNumbers', () => {
  it('題號在試卷內連續編號：每個大題的起始題號接在前面各大題之後', () => {
    expect(firstNumbers([section(undefined, undefined), section(undefined), section(undefined)])).toEqual([1, 3, 4]);
  });
});
