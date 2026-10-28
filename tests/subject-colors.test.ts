// 科目色檢查：SUBJECTS 的每一科都要有 .subj-<科目> class 與完整色票；漏掉不會報錯，只會讓組成條變透明。
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SUBJECTS } from '../src/domain/schema.ts';

const ui = readFileSync('src/styles/ui.css', 'utf8');
const tokens = readFileSync('src/styles/tokens.css', 'utf8');
const ROLES = ['--sc', '--sc-soft', '--sc-text', '--sc-mid'];

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** 取出 .subj-<科目> 規則裡 --sc-* 變數指向的 token 名稱；沒有這個 class 回傳 undefined。 */
function subjectRule(subject: string): Record<string, string> | undefined {
  const body = ui.match(new RegExp(`(?:^|\\n)\\.subj-${escapeRegExp(subject)}\\s*\\{([^}]*)\\}`))?.[1];
  if (body === undefined) return undefined;
  return Object.fromEntries([...body.matchAll(/(--sc[\w-]*)\s*:\s*var\((--[\w-]+)\)/g)].map((m) => [m[1], m[2]]));
}

/** token 的色碼；未定義回傳 undefined。 */
const tokenHex = (name: string) => tokens.match(new RegExp(`${name}\\s*:\\s*(#[0-9a-fA-F]{6})\\s*;`))?.[1];

function luminance(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
};

describe('科目色', () => {
  it.each(SUBJECTS)('%s 有 .subj class，且四個 --sc-* 都指向 tokens.css 裡有定義的色碼', (subject) => {
    const rule = subjectRule(subject);
    expect(rule, `ui.css 缺 .subj-${subject}`).toBeDefined();
    for (const role of ROLES) {
      const token = rule![role];
      expect(token, `.subj-${subject} 缺 ${role}`).toBeDefined();
      expect(tokenHex(token!), `tokens.css 缺 ${token}`).toBeDefined();
    }
  });

  it.each(SUBJECTS)('%s 的文字色對淺底色對比 ≥ 4.5', (subject) => {
    const rule = subjectRule(subject)!;
    expect(contrast(tokenHex(rule['--sc-text']!)!, tokenHex(rule['--sc-soft']!)!)).toBeGreaterThanOrEqual(4.5);
  });

  it('不同科目用不同的科目色', () => {
    const colors = SUBJECTS.map((subject) => tokenHex(subjectRule(subject)!['--sc']!));
    expect(new Set(colors).size).toBe(SUBJECTS.length);
  });
});
