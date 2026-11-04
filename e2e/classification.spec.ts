import { expect, test } from '@playwright/test';
import { answerToggle, FIXTURE_URL } from './helpers';

test('分類題列出類別與每個敘述，整題只占一個題號，答案填回原作答位置', async ({ page }) => {
  await page.goto('/papers/sample-social/');
  const question = page.locator('[data-question-type="classification"]');
  await expect(page.locator('.question')).toHaveCount(4);
  await expect(question.locator('.number')).toHaveText('3.');
  await expect(question.locator('.classification-categories li')).toHaveCount(3);
  await expect(question.locator('.classification-categories')).toContainText('學校生活');
  await expect(question.locator('.classification-categories')).toContainText('社區生活');
  await expect(question.locator('.classification-categories ruby')).toHaveCount(2);
  const rows = question.locator('.classification-statements li');
  await expect(rows).toHaveCount(4);
  const slots = question.locator('.classification-slot');
  await expect(slots).toHaveCount(4);
  await expect(question.locator('.answer:visible, .explanation:visible')).toHaveCount(0);
  const before = await slots.evaluateAll(elements => elements.map(element => {
    const origin = element.closest('.question')!.getBoundingClientRect();
    const rect = element.getBoundingClientRect();
    return [rect.x - origin.x, rect.y - origin.y, rect.width, rect.height];
  }));
  await answerToggle(page).click();
  await expect(question.locator('.classification-statements .answer')).toHaveText(['△', '○', '□', '△']);
  await expect(question.locator('.answer:visible')).toHaveCount(4);
  await expect(question.locator('.explanation')).toBeVisible();
  expect(await slots.evaluateAll(elements => elements.map(element => {
    const origin = element.closest('.question')!.getBoundingClientRect();
    const rect = element.getBoundingClientRect();
    return [rect.x - origin.x, rect.y - origin.y, rect.width, rect.height];
  }))).toEqual(before);
});

test('題庫可依分類題篩選，展開顯示內容，首頁將多個敘述計為一題', async ({ page }) => {
  await page.goto('/bank/');
  await page.getByLabel('題型').selectOption({ label: '分類題' });
  const item = page.locator('.bank-item:visible');
  await expect(item).toHaveCount(1);
  await expect(item.locator('.question-id')).toHaveText('sample-social-07');
  await expect(item.locator('summary')).toContainText('分類題');
  await item.locator('summary').click();
  await expect(item.locator('.classification-statements li')).toHaveCount(4);
  await expect(item.locator('.classification-statements .answer:visible')).toHaveCount(4);
  await page.goto('/');
  const social = page.locator('#composition .mix-subject[data-subject="社會"]');
  await expect(social).toContainText('8 題');
  await expect(social.locator('.mix-bar')).toHaveAttribute('aria-label', /分類題 1/);
});

test('多字元符號原樣顯示且完整落在括號內，不當成 HTML 或注音', async ({ page }) => {
  await page.goto(`${FIXTURE_URL}/papers/classification/`);
  const question = page.locator('[data-question-type="classification"]');
  await expect(question.locator('b, ruby')).toHaveCount(0);
  await expect(question.locator('.classification-category-symbol')).toHaveText(['[A|B]', '<b>iiiiiiiiii</b>']);
  await expect(question.locator('.classification-statements .katex')).toHaveCount(2);
  await answerToggle(page).click();
  await expect(question.locator('.classification-statements .answer')).toHaveText(['[A|B]', '<b>iiiiiiiiii</b>']);
  for (const answer of await question.locator('.classification-statements .answer').all()) {
    const bounds = await answer.boundingBox();
    const cell = await answer.locator('..').boundingBox();
    expect(bounds).not.toBeNull();
    expect(cell).not.toBeNull();
    expect(bounds!.x).toBeGreaterThanOrEqual(cell!.x);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(cell!.x + cell!.width + 1);
    expect(await answer.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  }
});

for (const mode of ['paper', 'answer'] as const) {
  test(`分類題的 ${mode} 模式輸出 A4 PDF，保留類別與作答位置`, async ({ page }, testInfo) => {
    await page.goto('/papers/sample-social/');
    if (mode === 'answer') await answerToggle(page).click();
    await page.emulateMedia({ media: 'print' });
    const question = page.locator('[data-question-type="classification"]');
    await expect(question.locator('.classification-categories li')).toHaveCount(3);
    await expect(question.locator('.classification-slot')).toHaveCount(4);
    await expect(question.locator('.answer:visible')).toHaveCount(mode === 'answer' ? 4 : 0);
    await expect(question.locator('.explanation:visible')).toHaveCount(mode === 'answer' ? 1 : 0);
    const pdf = await page.pdf({ path: testInfo.outputPath(`${mode}.pdf`), preferCSSPageSize: true });
    const pages = [...pdf.toString('latin1').matchAll(/\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/g)];
    expect(pages.length).toBeGreaterThan(0);
    for (const [, width, height] of pages) {
      expect(Math.abs(Number(width) - 595)).toBeLessThan(1);
      expect(Math.abs(Number(height) - 842)).toBeLessThan(1);
    }
  });
}


test('題庫展開頁的多字元粗體答案完整留在預留格內', async ({ page }) => {
  await page.goto(`${FIXTURE_URL}/bank/`);
  const item = page.locator('details[data-id="classification-01"]');
  await item.locator('summary').click();
  await page.evaluate(() => document.fonts.ready);
  const bounds = await item.locator('.classification-statements .answer').evaluateAll(elements => elements.map(element => {
    const range = document.createRange();
    range.selectNodeContents(element);
    const text = range.getBoundingClientRect();
    const cell = element.parentElement!.getBoundingClientRect();
    return { textLeft: text.left, textRight: text.right, cellLeft: cell.left, cellRight: cell.right };
  }));
  expect(bounds).toHaveLength(2);
  for (const bound of bounds) {
    expect(bound.textLeft).toBeGreaterThanOrEqual(bound.cellLeft - 0.1);
    expect(bound.textRight).toBeLessThanOrEqual(bound.cellRight + 0.1);
  }
});
