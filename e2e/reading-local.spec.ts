import { expect, test } from '@playwright/test';
import { FIXTURE_URL } from './helpers';

test('試卷題組保留同一篇材料及連續題號', async ({ page }) => {
  await page.goto(`${FIXTURE_URL}/papers/reading-subset-local/`);
  const material = page.locator('.question-material');
  const questions = page.locator('.question');
  await expect(material).toHaveCount(1);
  await expect(material).toContainText('小安和小文一起種了一棵樹');
  const illustration = material.getByRole('img', { name: '樹的示意圖' });
  await expect(illustration).toBeVisible();
  expect(await illustration.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
  await expect(questions).toHaveCount(3);
  await expect(questions.locator('.number')).toHaveText(['1.', '2.', '3.']);
  await expect(questions.nth(0)).toContainText('兩人一起做了什麼');
  await expect(questions.nth(1)).toContainText('故事中的兩個孩子');
  expect(await material.evaluate((el) => Boolean(el.compareDocumentPosition(document.querySelector('.question')!) & Node.DOCUMENT_POSITION_FOLLOWING))).toBe(true);
  await expect(page.locator('.answer:visible, .blank-answer:visible, .explanation:visible')).toHaveCount(0);
  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('.answer:visible, .blank-answer:visible, .explanation:visible')).toHaveCount(0);
  await page.emulateMedia({ media: 'screen' });
  await page.getByRole('button', { name: '顯示答案卷' }).click();
  await expect(page.locator('.explanation:visible')).toHaveCount(3);
  await expect(questions.nth(1).locator('.explanation')).toContainText('順序可互換');
  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('.explanation:visible')).toHaveCount(3);

  await page.emulateMedia({ media: 'screen' });
  await page.goto(`${FIXTURE_URL}/papers/reading-single-local/`);
  await expect(page.locator('.question-material')).toHaveCount(1);
  await expect(page.locator('.question')).toHaveCount(1);
});

test('題庫單獨展開任一組員仍可看到完整材料', async ({ page }) => {
  await page.goto(`${FIXTURE_URL}/bank/`);
  for (const id of ['reading-local-01', 'reading-local-03']) {
    const item = page.locator(`details.bank-item[data-id="${id}"]`);
    await item.locator('summary').click();
    await expect(item.locator('.question-material')).toContainText('小安和小文一起種了一棵樹');
    await expect(item.getByRole('img', { name: '樹的示意圖' })).toBeVisible();
    await expect(item.locator('.explanation')).toBeVisible();
  }
});

test('衍生題組可逆序節選並只印新材料一次', async ({ page }) => {
  await page.goto(`${FIXTURE_URL}/papers/reading-remix/`);
  await expect(page.locator('.question-material')).toHaveCount(1);
  await expect(page.locator('.question-material')).toContainText('小芸和小志在菜園裡照顧菜');
  await expect(page.locator('.question')).toHaveCount(2);
  await expect(page.locator('.question .number')).toHaveText(['1.', '2.']);
  await expect(page.locator('.explanation:visible')).toHaveCount(0);
  await page.getByRole('button', { name: '顯示答案卷' }).click();
  await expect(page.locator('.explanation:visible')).toHaveCount(2);
});
