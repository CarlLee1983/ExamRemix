import { expect, test, type Page } from '@playwright/test';
import { answerToggle } from './helpers';

const PAPER = '/papers/sample-science/';
const ANSWERS = '.answer, .diagram-answer, .table-answer, .explanation';
const multiSelect = (page: Page) => page.locator('[data-question-type="multi-select"]');

// 解析會推移後續題目；比較題目內的相對位置，才能偵測作答空間本身的位移。
const rects = (page: Page, selector: string) =>
  page.locator(selector).evaluateAll((elements) => elements.map((element) => {
    const question = element.closest('.question')!.getBoundingClientRect();
    const rect = element.getBoundingClientRect();
    return [rect.x - question.x, rect.y - question.y, rect.width, rect.height];
  }));

const expectAnswers = async (page: Page) => {
  const checks = multiSelect(page).first().locator('.answer');
  await expect(checks).toHaveText(['✓', '', '✓']);
  await expect(checks.nth(0)).toBeVisible();
  await expect(checks.nth(2)).toBeVisible();
  // 未選的選項保留空白作答欄，不以叉號提示錯誤。
  await expect(multiSelect(page).last().locator('.answer')).toHaveText(['✓', '', '✓']);
  await expect(page.locator('.diagram-answer')).toHaveText(['甲', '乙']);
  await expect(page.locator('.table-answer')).toHaveText(['甲', '乙']);
  await expect(page.locator('.diagram-answer:visible')).toHaveCount(2);
  await expect(page.locator('.table-answer:visible')).toHaveCount(2);
  await expect(page.locator('.explanation:visible')).toHaveCount(5);
};

test.describe('自然題型', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(PAPER);
  });

  test('試卷隱藏答案與解析，答案卷顯示勾選、圖示與表格答案', async ({ page }) => {
    await expect(multiSelect(page)).toHaveCount(2);
    await expect(page.locator('[data-question-type="diagram-label"]')).toHaveCount(1);
    await expect(page.locator('[data-question-type="table-fill"]')).toHaveCount(1);
    await expect(page.locator(ANSWERS).filter({ visible: true })).toHaveCount(0);
    await answerToggle(page).click();
    await expectAnswers(page);
  });

  test('圖文選項及表頭圖片可載入且有替代文字，切換答案不移動圖示空格或表格', async ({ page }) => {
    await expect(page.locator('.question-choice .visual-text-image')).toHaveCount(2);
    await expect(page.locator('.answer-table .visual-text-image')).toHaveCount(2);
    const images = page.locator('.paper img');
    await expect(images).toHaveCount(5);
    for (const image of await images.all()) {
      await expect(image).toBeVisible();
      await expect(image).toHaveAttribute('alt', /\S/);
      await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth > 0)).toBe(true);
    }
    await page.evaluate(() => document.fonts.ready);
    const selector = '.diagram-frame, .diagram-frame > img, .diagram-blank, .answer-table, .answer-table th, .answer-table td';
    const before = await rects(page, selector);
    const frame = (await page.locator('.diagram-frame').boundingBox())!;
    const image = (await page.locator('.diagram-frame > img').boundingBox())!;
    expect(frame.width).toBeGreaterThan(0);
    expect(frame.height).toBeGreaterThan(0);
    expect(image).toEqual(frame);
    for (const blank of await page.locator('.diagram-blank').all()) {
      const box = (await blank.boundingBox())!;
      expect(box.width).toBeGreaterThan(0);
      expect(box.height).toBeGreaterThan(0);
      expect(box.x).toBeGreaterThanOrEqual(frame.x);
      expect(box.y).toBeGreaterThanOrEqual(frame.y);
      expect(box.x + box.width).toBeLessThanOrEqual(frame.x + frame.width + 1);
      expect(box.y + box.height).toBeLessThanOrEqual(frame.y + frame.height + 1);
    }
    await answerToggle(page).click();
    expect(await rects(page, selector)).toEqual(before);
  });

  test('圖示受高度上限縮小時，圖框與空格仍對齊實際圖片', async ({ page }) => {
    const image = page.locator('.diagram-frame > img');
    await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth > 0)).toBe(true);
    const original = (await image.boundingBox())!;
    await page.addStyleTag({ content: '.diagram-frame > img { max-height: 90px; }' });
    const scaled = (await image.boundingBox())!;
    expect(scaled.height).toBeLessThan(original.height);
    expect(scaled.height).toBeLessThanOrEqual(90);
    expect(scaled.width).toBeGreaterThan(0);
    expect(await page.locator('.diagram-frame').boundingBox()).toEqual(scaled);

    const blanks = page.locator('.diagram-blank');
    await expect(blanks).toHaveCount(2);
    // 範例圖的兩格位於圖片寬度 72%、高度 15% / 70%，大小為 20% × 12%。
    for (const [index, top] of [0.15, 0.70].entries()) {
      const blank = (await blanks.nth(index).boundingBox())!;
      expect(blank.x - scaled.x).toBeCloseTo(scaled.width * 0.72, 1);
      expect(blank.y - scaled.y).toBeCloseTo(scaled.height * top, 1);
      expect(blank.width).toBeCloseTo(scaled.width * 0.20, 1);
      expect(blank.height).toBeCloseTo(scaled.height * 0.12, 1);
    }
  });

  for (const mode of ['試卷', '答案卷']) {
    test(`列印${mode}保留正確的答案顯隱，能產生 A4 PDF`, async ({ page }) => {
      if (mode === '答案卷') await answerToggle(page).click();
      await page.emulateMedia({ media: 'print' });
      await expect(page.locator('#mode-toggle')).toBeHidden();
      if (mode === '答案卷') await expectAnswers(page);
      else await expect(page.locator(ANSWERS).filter({ visible: true })).toHaveCount(0);
      const pdf = await page.pdf({ preferCSSPageSize: true });
      expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
      expect(pdf.length).toBeGreaterThan(1_000);
      // Chromium 實際輸出 /MediaBox [0 0 594.95996 841.91998]；容許 A4 換算時的點數捨入。
      const pages = [...pdf.toString('latin1').matchAll(/\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/g)];
      expect(pages.length).toBeGreaterThan(0);
      for (const [, width, height] of pages) {
        expect(Math.abs(Number(width) - 595)).toBeLessThan(1);
        expect(Math.abs(Number(height) - 842)).toBeLessThan(1);
      }
    });
  }
});

test('題庫可篩選自然與新題型，大題來源不產生虛構小題號', async ({ page }) => {
  await page.goto('/bank/');
  await page.getByLabel('科目').selectOption({ label: '自然' });
  const items = page.locator('.bank-item:visible');
  await expect(items.locator('.question-id')).toHaveText([
    'sample-science-01', 'sample-science-02', 'sample-science-03', 'sample-science-04', 'sample-science-05',
  ]);
  for (const [type, ids] of [
    ['multi-select', ['sample-science-01', 'sample-science-05']],
    ['diagram-label', ['sample-science-03']],
    ['table-fill', ['sample-science-04']],
  ] as const) {
    await page.getByLabel('題型').selectOption(type);
    await expect(items.locator('.question-id')).toHaveText([...ids]);
  }
  await page.getByLabel('題型').selectOption('');
  for (const [id, section] of [
    ['sample-science-01', '一、觀察植物（每個答案 1 分，共 3 分）'],
    ['sample-science-03', '二、植物構造（每格 1 分，共 2 分）'],
    ['sample-science-04', '三、植物圖片（每格 1 分，共 2 分）'],
    ['sample-science-05', '四、觀察方法'],
  ]) {
    const source = page.locator(`.bank-item[data-id="${id}"] .meta .source`);
    await expect(source).toHaveText(`出處：虛構三年級自然練習 ${section}`);
    await expect(source).not.toContainText('undefined');
    await expect(source).not.toContainText(/第\s*\d+\s*題/);
  }
});
