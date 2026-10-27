import { expect, test, type Locator, type Page } from '@playwright/test';
import { answerToggle, expectedAnswerColor } from './helpers';

const PAPER = '/papers/sample-math/';

// 範例試卷 sample-math 的數學題型：29–31 橫式計算、32–35 直式計算、36–40 應用題
const HORIZONTAL_ANSWERS = ['84', '57', '56'];
const VERTICAL_ANSWERS = ['825', '7.35', '424', '408'];
const WORD_ANSWERS = ['小明共有 12 顆蘋果。', '媽媽一共買了 36 顆雞蛋。', '小華還剩 38 元。', '長方形的周長是 26 公分。', '老闆應該找她 94 元。'];

const horizontal = (page: Page) => page.locator('.question-horizontal-calc');
const vertical = (page: Page) => page.locator('.question-vertical-calc');
const word = (page: Page) => page.locator('.question-word-problem');

/** 一組元素的大小與相對於所屬題目左上角的位置：答案卷的解析會把後面的題目往下推，題目內部的版面才是不能動的 */
const rects = (page: Page, selector: string) =>
  page.locator(selector).evaluateAll((els) =>
    els.map((el) => {
      const top = el.closest('.question')!.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      return [r.x - top.x, r.y - top.y, r.width, r.height];
    }),
  );

const box = async (locator: Locator) => (await locator.boundingBox())!;

test.describe('數學式（KaTeX）', () => {
  test('題幹與解析的數學式渲染成 .katex，原始的 $ 標記不外露', async ({ page }) => {
    await page.goto(PAPER);
    const first = horizontal(page).first();
    await expect(first.locator('.stem .katex')).toHaveCount(1);
    await expect(first.locator('.stem .katex-html')).toContainText('36+48=');
    await expect(first.locator('.explanation .katex')).toHaveCount(1);
    await expect(page.locator('.question').filter({ hasText: '$' })).toHaveCount(0);
  });

  test('載入頁面時不對 localhost 以外的主機發出任何請求（字型與 CSS 都在本機）', async ({ page }) => {
    const external: string[] = [];
    page.on('request', (request) => {
      const { protocol, hostname } = new URL(request.url());
      if (protocol.startsWith('http') && hostname !== 'localhost' && hostname !== '127.0.0.1') {
        external.push(request.url());
      }
    });
    await page.goto(PAPER, { waitUntil: 'networkidle' });
    await expect(page.locator('.katex').first()).toBeVisible();
    // 等 KaTeX 字型載入完成，確保字型請求也已發出
    await page.evaluate(() => document.fonts.ready);
    expect(external).toEqual([]);
    const fonts = await page.evaluate(() =>
      [...document.fonts].filter((f) => f.family.startsWith('KaTeX') && f.status === 'loaded').length,
    );
    expect(fonts).toBeGreaterThan(0);
  });
});

test.describe('橫式計算', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(PAPER);
  });

  test('題號、算式、答案底線與計算區', async ({ page }) => {
    await expect(horizontal(page)).toHaveCount(HORIZONTAL_ANSWERS.length);
    for (const q of await horizontal(page).all()) {
      await expect(q.locator('.stem .number')).toBeVisible();
      await expect(q.locator('.stem .blank')).toHaveCount(1);
      const stem = await box(q.locator('.stem .katex').first());
      const blank = await box(q.locator('.stem .blank'));
      // 底線在算式右邊，同一行
      expect(blank.x).toBeGreaterThanOrEqual(stem.x + stem.width - 1);
      expect(Math.abs(blank.y + blank.height - (stem.y + stem.height))).toBeLessThan(stem.height);
      // 計算區在題幹下方，有高度
      const area = await box(q.locator('.calc-area'));
      expect(area.y).toBeGreaterThanOrEqual(stem.y + stem.height - 1);
      expect(area.height).toBeGreaterThan(40);
    }
  });

  test('試卷隱藏答案與解析，答案卷以紅字顯示答案並附解析', async ({ page }) => {
    const color = await expectedAnswerColor(page);
    await expect(page.locator('.question-horizontal-calc :is(.blank-answer, .explanation):visible')).toHaveCount(0);

    await answerToggle(page).click();
    const answers = horizontal(page).locator('.blank-answer');
    await expect(answers).toHaveCount(HORIZONTAL_ANSWERS.length);
    for (const [i, expected] of HORIZONTAL_ANSWERS.entries()) {
      await expect(answers.nth(i)).toBeVisible();
      await expect(answers.nth(i)).toHaveText(expected);
      await expect(answers.nth(i)).toHaveCSS('color', color);
    }
    await expect(horizontal(page).locator('.explanation:visible')).toHaveCount(HORIZONTAL_ANSWERS.length);
  });

  test('切換前後題目內的版面不變', async ({ page }) => {
    const sel = '.question-horizontal-calc :is(.stem, .blank, .calc-area)';
    const before = await rects(page, sel);
    await answerToggle(page).click();
    expect(await rects(page, sel)).toEqual(before);
  });
});

test.describe('直式計算', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(PAPER);
  });

  test('個位數（最右邊的格子）在各運算元列與答案列對齊', async ({ page }) => {
    await expect(vertical(page)).toHaveCount(VERTICAL_ANSWERS.length);
    for (const q of await vertical(page).all()) {
      const rows = q.locator('.vcalc-row');
      expect(await rows.count()).toBeGreaterThanOrEqual(3);
      const rights: number[] = [];
      for (const row of await rows.all()) {
        const last = await box(row.locator('.vcalc-cell').last());
        rights.push(Math.round((last.x + last.width) * 10) / 10);
      }
      expect(new Set(rights).size).toBe(1);
    }
  });

  test('小數加法：小數點與各位數字上下對齊', async ({ page }) => {
    // sample-math-33：4.6 + 2.75 = 7.35
    const q = vertical(page).nth(1);
    const points = q.locator('.vcalc-point');
    // 兩個運算元與答案各有一個格子後面接小數點，這些格子的 x 座標相同
    await expect(points).toHaveCount(3);
    const xs = new Set<number>();
    for (const p of await points.all()) xs.add(Math.round((await box(p)).x));
    expect(xs.size).toBe(1);
  });

  test('運算元由上到下，運算子在最後一個運算元列的最左欄，其下有橫線', async ({ page }) => {
    const q = vertical(page).first();
    const operandRows = q.locator('.vcalc-row.operand');
    await expect(operandRows).toHaveCount(2);
    await expect(operandRows.nth(0).locator('.vcalc-operator')).toHaveText('');
    await expect(operandRows.nth(1).locator('.vcalc-operator')).toHaveText('+');
    // 運算子在整列最左邊
    const op = await box(operandRows.nth(1).locator('.vcalc-operator'));
    const cells = await q.locator('.vcalc-cell').evaluateAll((els) => Math.min(...els.map((e) => e.getBoundingClientRect().x)));
    expect(op.x).toBeLessThanOrEqual(cells + 1);
    await expect(operandRows.nth(1)).toHaveCSS('border-bottom-style', 'solid');
    await expect(operandRows.nth(0)).toHaveCSS('border-bottom-style', 'none');
    // 橫線下方有答案列
    const answerRow = await box(q.locator('.vcalc-row.result').last());
    const lastOperand = await box(operandRows.nth(1));
    expect(answerRow.y).toBeGreaterThanOrEqual(lastOperand.y + lastOperand.height - 1);
  });

  test('乘法與減法的運算子', async ({ page }) => {
    await expect(vertical(page).nth(2).locator('.vcalc-row.operand .vcalc-operator').last()).toHaveText('−');
    await expect(vertical(page).nth(3).locator('.vcalc-row.operand .vcalc-operator').last()).toHaveText('×');
  });

  test('試卷隱藏答案，答案卷在答案列以紅字顯示，數字與上方的欄對齊', async ({ page }) => {
    const color = await expectedAnswerColor(page);
    await expect(page.locator('.question-vertical-calc :is(.vcalc-answer, .explanation):visible')).toHaveCount(0);

    await answerToggle(page).click();
    for (const [i, expected] of VERTICAL_ANSWERS.entries()) {
      const q = vertical(page).nth(i);
      const digits = q.locator('.vcalc-answer:visible');
      await expect(digits).toHaveText(expected.replace('.', '').split(''));
      for (const d of await digits.all()) await expect(d).toHaveCSS('color', color);
      await expect(q.locator('.explanation')).toBeVisible();
      // 答案最右邊的數字與第一個運算元的個位數（小數則為最右一位）對齊
      const rightDigit = await box(digits.last());
      const topRight = await box(q.locator('.vcalc-row').first().locator('.vcalc-cell').last());
      expect(Math.abs(rightDigit.x + rightDigit.width - (topRight.x + topRight.width))).toBeLessThan(1);
    }
  });

  test('切換前後直式的格子位置與大小不變', async ({ page }) => {
    const sel = '.question-vertical-calc .vcalc-cell';
    const before = await rects(page, sel);
    await answerToggle(page).click();
    expect(await rects(page, sel)).toEqual(before);
  });
});

test.describe('應用題', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(PAPER);
  });

  test('有算式計算區與答句欄', async ({ page }) => {
    await expect(word(page)).toHaveCount(WORD_ANSWERS.length);
    for (const q of await word(page).all()) {
      const area = q.locator('.calc-box');
      await expect(area).toContainText('算式：');
      await expect(area).toHaveCSS('border-top-style', 'solid');
      const sentence = q.locator('.answer-sentence');
      await expect(sentence).toContainText('答：');
      await expect(sentence.locator('.answer-line')).toHaveCSS('border-bottom-style', 'solid');
      const areaBox = await box(area);
      const lineBox = await box(sentence.locator('.answer-line'));
      expect(areaBox.height).toBeGreaterThan(80);
      expect(lineBox.y).toBeGreaterThanOrEqual(areaBox.y + areaBox.height - 1);
      // 答句欄橫跨大部分版面
      expect(lineBox.width).toBeGreaterThan(areaBox.width * 0.7);
    }
  });

  test('試卷隱藏答案與解析，答案卷以紅字把答句填在線上', async ({ page }) => {
    const color = await expectedAnswerColor(page);
    await expect(page.locator('.question-word-problem :is(.answer-line-text, .explanation):visible')).toHaveCount(0);

    await answerToggle(page).click();
    for (const [i, expected] of WORD_ANSWERS.entries()) {
      const q = word(page).nth(i);
      const text = q.locator('.answer-line-text');
      await expect(text).toBeVisible();
      await expect(text).toHaveText(expected);
      await expect(text).toHaveCSS('color', color);
      await expect(q.locator('.explanation')).toBeVisible();
      const line = await box(q.locator('.answer-line'));
      const t = await box(text);
      expect(t.y).toBeGreaterThanOrEqual(line.y - 1);
      expect(t.y + t.height).toBeLessThanOrEqual(line.y + line.height + 1);
    }
  });

  test('切換前後計算區與答句欄的位置、大小不變', async ({ page }) => {
    const sel = '.question-word-problem :is(.stem, .calc-box, .answer-sentence, .answer-line)';
    const before = await rects(page, sel);
    await answerToggle(page).click();
    expect(await rects(page, sel)).toEqual(before);
  });
});

test.describe('數學題型的答案卷與列印', () => {
  const MATH_QUESTIONS = '.question-horizontal-calc, .question-vertical-calc, .question-word-problem';

  test('答案卷：三種題型都有解析', async ({ page }) => {
    await page.goto(PAPER);
    await answerToggle(page).click();
    await expect(page.locator(MATH_QUESTIONS)).toHaveCount(12);
    await expect(page.locator('.explanation:visible')).toHaveCount(await page.locator('.question').count());
    for (const q of await page.locator(MATH_QUESTIONS).all()) await expect(q.locator('.explanation')).toBeVisible();
  });

  test('列印試卷（print media）不顯示答案與解析', async ({ page }) => {
    await page.goto(PAPER);
    await page.emulateMedia({ media: 'print' });
    await expect(page.locator(MATH_QUESTIONS)).toHaveCount(12);
    await expect(
      page.locator(':is(.blank-answer, .vcalc-answer, .answer-line-text, .explanation):visible'),
    ).toHaveCount(0);
  });

  test('列印答案卷時答案仍在，切換鈕不印', async ({ page }) => {
    await page.goto(PAPER);
    await answerToggle(page).click();
    await page.emulateMedia({ media: 'print' });
    await expect(page.locator('.question-horizontal-calc .blank-answer:visible')).toHaveCount(3);
    await expect(page.locator('.question-word-problem .answer-line-text:visible')).toHaveCount(5);
    await expect(page.locator('.question-vertical-calc .vcalc-answer:visible')).toHaveCount(
      VERTICAL_ANSWERS.join('').replace(/\./g, '').length,
    );
    await expect(page.locator('#mode-toggle')).toBeHidden();
  });
});
