import { expect, test, type Page } from '@playwright/test';

const PAPER = '/papers/sample-math/';

test.describe('試卷頁', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(PAPER);
  });

  test('固定頁首有標題、姓名、日期、分數欄', async ({ page }) => {
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('三年級數學試卷（範例）');
    for (const [field, label] of [
      ['name', '姓名'],
      ['date', '日期'],
      ['score', '分數'],
    ] as const) {
      const el = page.locator(`[data-field="${field}"]`);
      await expect(el).toContainText(label);
      await expect(el.locator('.line')).toBeVisible();
    }
  });

  test('大題標題與選填配分', async ({ page }) => {
    const titles = page.locator('.section-title');
    await expect(titles).toHaveCount(3);
    await expect(titles.nth(0)).toContainText('一、計算選擇題');
    await expect(titles.nth(0).locator('.points')).toHaveText('（40 分）');
    // 第二個大題沒有配分
    await expect(titles.nth(1)).toContainText('二、減法選擇題');
    await expect(titles.nth(1).locator('.points')).toHaveCount(0);
  });

  test('選擇題有作答括號、連續題號、題幹與選項', async ({ page }) => {
    const questions = page.locator('.question-choice');
    await expect(questions).toHaveCount(21);

    const first = questions.first();
    await expect(first.locator('.answer-box')).toHaveText('（　）');
    await expect(first.locator('.number')).toHaveText('1.');
    await expect(first.locator('.stem')).toContainText('3 × 4 等於多少？');
    await expect(first.locator('.option')).toHaveCount(4);
    await expect(first.locator('.option').first()).toContainText('(1) 10');

    // 題號跨大題連續：第二個大題的第一題是 11
    await expect(questions.nth(10).locator('.number')).toHaveText('11.');
    await expect(questions.last().locator('.number')).toHaveText('21.');
  });

  test('每題 break-inside 為 avoid', async ({ page }) => {
    const values = await page
      .locator('.question')
      .evaluateAll((els) => els.map((el) => getComputedStyle(el).breakInside));
    expect(values.length).toBe(21);
    expect(new Set(values)).toEqual(new Set(['avoid']));
  });

  test('列印為 A4，至少兩頁', async ({ page }) => {
    const pdf = await page.pdf({ preferCSSPageSize: true });
    // Chromium 產出的 PDF 其頁面字典與 MediaBox 是未壓縮的純文字，不需要額外的 PDF 解析套件
    const text = pdf.toString('latin1');
    const pageCount = [...text.matchAll(/\/Type\s*\/Page[^s]/g)].length;
    expect(pageCount).toBeGreaterThanOrEqual(2);

    const boxes = [...text.matchAll(/\/MediaBox\s*\[([^\]]+)\]/g)].map((m) =>
      m[1]!.trim().split(/\s+/).map(Number),
    );
    expect(boxes.length).toBe(pageCount);
    for (const [, , width, height] of boxes) {
      // A4 = 595.28 x 841.89 pt
      expect(width).toBeCloseTo(595.28, 0);
      expect(height).toBeCloseTo(841.89, 0);
    }
  });
});

test.describe('答案卷切換', () => {
  // 範例資料已知：第 1 題答案 2、第 7 題答案 3、第 11 題答案 1
  const known = [
    { index: 0, answer: '2', explanation: '3 × 4 = 12。' },
    { index: 6, answer: '3', explanation: '48 + 27 = 75。' },
    { index: 10, answer: '1', explanation: '91 − 36 = 55。' },
  ];

  test.beforeEach(async ({ page }) => {
    await page.goto(PAPER);
  });

  const toggle = (page: Page) => page.getByRole('button', { name: /答案卷|試卷/ });

  test('載入時是試卷：切換鈕未按下，答案與解析不可見', async ({ page }) => {
    await expect(toggle(page)).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('.answer:visible')).toHaveCount(0);
    await expect(page.locator('.explanation:visible')).toHaveCount(0);
  });

  test('切換成答案卷：答案填在作答括號，解析在題目下方', async ({ page }) => {
    await toggle(page).click();
    await expect(toggle(page)).toHaveAttribute('aria-pressed', 'true');

    const questions = page.locator('.question-choice');
    await expect(page.locator('.answer:visible')).toHaveCount(21);
    await expect(page.locator('.explanation:visible')).toHaveCount(21);

    for (const { index, answer, explanation } of known) {
      const q = questions.nth(index);
      await expect(q.locator('.answer')).toHaveText(answer);
      await expect(q.locator('.answer')).toHaveCSS('color', 'rgb(255, 0, 0)');
      await expect(q.locator('.explanation')).toContainText('解析：');
      await expect(q.locator('.explanation')).toContainText(explanation);

      // 答案落在作答括號的範圍內，解析在選項下方
      const box = (await q.locator('.answer-box').boundingBox())!;
      const ans = (await q.locator('.answer').boundingBox())!;
      expect(ans.x).toBeGreaterThanOrEqual(box.x - 1);
      expect(ans.x + ans.width).toBeLessThanOrEqual(box.x + box.width + 1);
      const options = (await q.locator('.options').boundingBox())!;
      const exp = (await q.locator('.explanation').boundingBox())!;
      expect(exp.y).toBeGreaterThanOrEqual(options.y + options.height - 1);
    }
  });

  test('再切換一次回到試卷', async ({ page }) => {
    await toggle(page).click();
    await toggle(page).click();
    await expect(toggle(page)).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('.answer:visible')).toHaveCount(0);
    await expect(page.locator('.explanation:visible')).toHaveCount(0);
  });

  test('切換前後題號、題目順序與作答括號、題幹位置不變', async ({ page }) => {
    const snapshot = async () => {
      const numbers = await page.locator('.question .number').allTextContents();
      const stems = await page.locator('.question .stem').allTextContents();
      const boxes = await page.locator('.question').evaluateAll((els) =>
        els.map((el) => {
          const rect = (selector: string) => el.querySelector(selector)!.getBoundingClientRect();
          return { boxWidth: rect('.answer-box').width, stemX: rect('.stem').x, numberX: rect('.number').x };
        }),
      );
      return { numbers, stems: stems.map((s) => s.replace(/\s+/g, ' ')), boxes };
    };

    const before = await snapshot();
    await toggle(page).click();
    const after = await snapshot();

    expect(after.numbers).toEqual(before.numbers);
    expect(after.stems).toEqual(before.stems);
    expect(after.boxes.length).toBe(21);
    after.boxes.forEach((b, i) => {
      expect(Math.abs(b.boxWidth - before.boxes[i]!.boxWidth)).toBeLessThanOrEqual(1);
      expect(Math.abs(b.stemX - before.boxes[i]!.stemX)).toBeLessThanOrEqual(1);
      expect(Math.abs(b.numberX - before.boxes[i]!.numberX)).toBeLessThanOrEqual(1);
    });
  });

  test('列印：未切換時不含答案與解析，且隱藏切換鈕', async ({ page }) => {
    await page.emulateMedia({ media: 'print' });
    await expect(toggle(page)).toBeHidden();
    await expect(page.locator('.answer:visible')).toHaveCount(0);
    await expect(page.locator('.explanation:visible')).toHaveCount(0);
  });

  test('列印：切換成答案卷後含答案與解析，仍隱藏切換鈕', async ({ page }) => {
    await toggle(page).click();
    await page.emulateMedia({ media: 'print' });
    await expect(toggle(page)).toBeHidden();
    await expect(page.locator('.answer:visible')).toHaveCount(21);
    await expect(page.locator('.explanation:visible')).toHaveCount(21);
    // 解析與題目同一區塊，題目仍不可切斷
    const values = await page
      .locator('.question')
      .evaluateAll((els) => els.map((el) => getComputedStyle(el).breakInside));
    expect(new Set(values)).toEqual(new Set(['avoid']));
    await expect(page.locator('.question .explanation').first()).toBeVisible();
  });
});
