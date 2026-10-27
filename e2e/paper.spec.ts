import { expect, test } from '@playwright/test';

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
