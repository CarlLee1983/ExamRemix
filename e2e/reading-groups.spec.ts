import { expect, test } from '@playwright/test';
import { FIXTURE_URL } from './helpers';

test('範例試卷選用部分混合題型，試卷與答案卷的材料各印一次', async ({ page }) => {
  await page.goto('/papers/sample-social/');
  const material = page.locator('.question-material');
  const questions = page.locator('.question');
  await expect(material).toHaveCount(1);
  await expect(material).toContainText('社區準備舉辦親子環境日');
  await expect(questions).toHaveCount(2);
  expect(await material.evaluate((el) => Boolean(el.compareDocumentPosition(document.querySelector('.question')!) & Node.DOCUMENT_POSITION_FOLLOWING))).toBe(true);
  for (const mode of ['paper', 'answer'] as const) {
    if (mode === 'answer') await page.getByRole('button', { name: '顯示答案卷' }).click();
    await page.emulateMedia({ media: 'print' });
    await expect(material).toHaveCount(1);
    await expect(material).toBeVisible();
    await expect(page.locator('.explanation:visible')).toHaveCount(mode === 'answer' ? 2 : 0);
    await page.emulateMedia({ media: 'screen' });
  }
});


test('節選不含第一個組員時，材料仍印在首個選中成員之前，且不同題組各印一次', async ({ page }, testInfo) => {
  await page.goto(`${FIXTURE_URL}/papers/reading-subset/`);
  const materials = page.locator('.question-material');
  const questions = page.locator('.question');
  await expect(questions.locator('.number')).toHaveText(['1.', '2.', '3.', '4.']);
  await expect(materials).toHaveCount(2);
  const first = materials.nth(0);
  await expect(first).toHaveAttribute('data-group-id', 'reading#1');
  await expect(first.locator('ruby')).toHaveCount(2);
  await expect(first.locator('.katex')).toHaveCount(1);
  const image = first.getByRole('img', { name: '樹的示意圖' });
  await expect(image).toBeVisible();
  expect(await image.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0);
  await expect(materials.nth(1)).toHaveAttribute('data-group-id', 'reading#2');
  // 直接觀察頁面順序，材料不可跑到前面的獨立題之前。
  expect(await page.locator('.question, .question-material').evaluateAll(elements => elements.map(el => el.classList.contains('question-material') ? el.getAttribute('data-group-id') : el.querySelector('.number')?.textContent))).toEqual(['1.', 'reading#1', '2.', '3.', 'reading#2', '4.']);
  for (const mode of ['paper', 'answer'] as const) {
    if (mode === 'answer') await page.getByRole('button', { name: '顯示答案卷' }).click();
    await page.emulateMedia({ media: 'print' });
    await expect(materials).toHaveCount(2);
    await expect(first).toBeVisible();
    await expect(page.locator('.explanation:visible')).toHaveCount(mode === 'answer' ? 4 : 0);
    await page.pdf({ path: testInfo.outputPath(`${mode}.pdf`), preferCSSPageSize: true });
    await page.emulateMedia({ media: 'screen' });
  }
  await page.goto(`${FIXTURE_URL}/papers/reading-single/`);
  await expect(page.locator('.question-material')).toHaveCount(1);
  await expect(page.locator('.question')).toHaveCount(1);
});

test('題庫展開個別組員仍顯示完整共用材料', async ({ page }) => {
  await page.goto(`${FIXTURE_URL}/bank/`);
  for (const id of ['reading-01', 'reading-03']) {
    const item = page.locator(`details.bank-item[data-id="${id}"]`);
    await item.locator('summary').click();
    await expect(item.locator('.question-material')).toContainText('兩人輪流澆水');
    await expect(item.getByRole('img', { name: '樹的示意圖' })).toBeVisible();
  }
});
