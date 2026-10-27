import { expect, test, type Locator, type Page } from '@playwright/test';
import { answerToggle } from './helpers';

const PAPER = '/papers/sample-math/';

// 範例試卷 sample-math：39 是附圖的應用題（sample-math/39.svg），40 是覆寫 space: 8 的應用題，36–39 是預設空間（4 行）的應用題
const figureQuestion = (page: Page) => page.locator('.question-word-problem').filter({ has: page.locator('.question-figure') });
const box = async (locator: Locator) => (await locator.boundingBox())!;

test.beforeEach(async ({ page }) => {
  await page.goto(PAPER);
});

test.describe('附圖', () => {
  test('試卷頁顯示圖片，檔案載入成功、位在題幹之後', async ({ page }) => {
    await expect(page.locator('.question-figure')).toHaveCount(1);
    const q = figureQuestion(page);
    await expect(q).toHaveCount(1);
    const img = q.locator('.question-figure img');
    await expect(img).toBeVisible();
    await expect(img).toHaveAttribute('alt', '長 9 公分、寬 4 公分的長方形');
    expect(await img.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0);
    const stem = await box(q.locator('.stem'));
    const figure = await box(q.locator('.question-figure'));
    expect(figure.y).toBeGreaterThanOrEqual(stem.y + stem.height - 1);
    // 圖在計算區上方
    expect(figure.y + figure.height).toBeLessThanOrEqual((await box(q.locator('.calc-box'))).y + 1);
  });

  test('答案卷同樣顯示圖片', async ({ page }) => {
    await answerToggle(page).click();
    const img = figureQuestion(page).locator('.question-figure img');
    await expect(img).toBeVisible();
    expect(await img.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0);
  });

  test('圖片在版面內，不切開跨頁（break-inside: avoid）', async ({ page }) => {
    const figure = figureQuestion(page).locator('.question-figure');
    await expect(figure).toHaveCSS('break-inside', 'avoid');
    const paper = await box(page.locator('.paper'));
    const img = await box(figure.locator('img'));
    expect(img.x + img.width).toBeLessThanOrEqual(paper.x + paper.width);
    expect(img.height).toBeLessThanOrEqual(60 * 3.78 + 1);
  });

  test('圖片端點回傳正確的 Content-Type', async ({ page }) => {
    const response = await page.request.get('/bank-images/sample-math/39.svg');
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toBe('image/svg+xml');
    expect((await response.text()).startsWith('<svg')).toBe(true);
  });
});

test.describe('作答空間覆寫', () => {
  test('覆寫 space 的應用題計算區比預設的高，高度與行數成正比', async ({ page }) => {
    const defaults = page.locator('.question-word-problem .calc-box[data-space="4"]');
    const override = page.locator('.question-word-problem .calc-box[data-space="8"]');
    await expect(defaults).toHaveCount(4);
    await expect(override).toHaveCount(1);
    const normal = await box(defaults.first());
    const tall = await box(override);
    expect(tall.height).toBeGreaterThan(normal.height);
    // 框線與內距是固定的，行數多 4 行就多 4 × 行高
    const lineHeight = (tall.height - normal.height) / 4;
    expect(lineHeight).toBeGreaterThan(20);
    expect(normal.height).toBeGreaterThanOrEqual(4 * lineHeight);
  });

  test('各題型預設的作答空間行數', async ({ page }) => {
    await expect(page.locator('.question-horizontal-calc .calc-area[data-space="2"]')).toHaveCount(3);
    await expect(page.locator('.question-vertical-calc .vcalc[data-space="1"]')).toHaveCount(4);
    // 預設為 0 的題型沒有額外作答空間
    await expect(page.locator('.answer-space')).toHaveCount(0);
  });

  test('覆寫的版面在答案卷同樣大小', async ({ page }) => {
    const override = page.locator('.question-word-problem .calc-box[data-space="8"]');
    const before = await box(override);
    await answerToggle(page).click();
    const after = await box(override);
    expect(after.height).toBe(before.height);
    expect(after.width).toBe(before.width);
  });
});
