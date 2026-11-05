import { expect, test } from '@playwright/test';
import { FIXTURE_URL } from './helpers';

test('配對題保留六組連線空間，答案只在答案卷與題庫顯示', async ({ page }) => {
  await page.goto(`${FIXTURE_URL}/papers/matching-local/`);
  const board = page.locator('.matching-board');
  await expect(board.locator('.matching-left li')).toHaveCount(6);
  await expect(board.locator('.matching-right li')).toHaveCount(6);
  const image = board.getByRole('img', { name: '一棵樹' });
  await expect.poll(() => image.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true);
  await expect(page.locator('.matching-key')).toBeHidden();
  await expect(page.locator('.explanation')).toBeHidden();
  const left = (await board.locator('.matching-left').boundingBox())!;
  const right = (await board.locator('.matching-right').boundingBox())!;
  expect(right.x - (left.x + left.width)).toBeGreaterThan(70);
  await page.emulateMedia({ media: 'print' });
  const paperPdf = await page.pdf({ preferCSSPageSize: true, printBackground: false });
  expect(paperPdf.subarray(0, 5).toString()).toBe('%PDF-');
  expect([...paperPdf.toString('latin1').matchAll(/\/MediaBox\s*\[/g)]).toHaveLength(1);
  await expect(page.locator('.matching-key')).toBeHidden();
  await page.emulateMedia({ media: 'screen' });
  await page.getByRole('button', { name: '顯示答案卷' }).click();
  await expect(page.locator('.matching-key')).toHaveText('第 1 題配對答案：左1 → 右2；左2 → 右4；左3 → 右6；左4 → 右1；左5 → 右3；左6 → 右5');
  await expect(page.locator('.explanation')).toBeVisible();
  await page.emulateMedia({ media: 'print' });
  const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: false });
  expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
  expect([...pdf.toString('latin1').matchAll(/\/MediaBox\s*\[/g)]).toHaveLength(1);
  await expect(page.locator('.matching-key')).toBeVisible();

  await page.goto(`${FIXTURE_URL}/bank/`);
  const item = page.locator('details.bank-item[data-id="matching-local-01"]');
  await item.locator('summary').click();
  await expect(item.locator('.matching-key')).toContainText('左1 → 右2');
});

test('停用 JavaScript 時仍可閱讀與列印空白連線題', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto(`${FIXTURE_URL}/papers/matching-local/`);
  await expect(page.locator('.matching-board .matching-column li')).toHaveCount(12);
  await expect(page.locator('.matching-key')).toBeHidden();
  await page.emulateMedia({ media: 'print' });
  expect((await page.pdf({ preferCSSPageSize: true })).subarray(0, 5).toString()).toBe('%PDF-');
  await context.close();
});

test('十項配對的試卷與答案卷各在一頁，沒有只含抬頭的空頁', async ({ page }, testInfo) => {
  await page.goto(`${FIXTURE_URL}/papers/matching-ten/`);
  await expect(page.locator('.matching-left li')).toHaveCount(10);
  await expect(page.locator('.matching-right li')).toHaveCount(10);
  await expect(page.locator('.matching-key')).toBeHidden();
  await page.evaluate(() => document.fonts.ready);
  for (const mode of ['paper', 'answer'] as const) {
    if (mode === 'answer') {
      await page.getByRole('button', { name: '顯示答案卷' }).click();
      await expect(page.locator('.matching-key')).toContainText('第 1 題配對答案：左1 → 右10');
      await expect(page.locator('.matching-key')).toContainText('左10 → 右1');
    }
    await page.emulateMedia({ media: 'print' });
    const pdf = await page.pdf({ path: testInfo.outputPath(`${mode}.pdf`), preferCSSPageSize: true });
    expect([...pdf.toString('latin1').matchAll(/\/MediaBox\s*\[/g)]).toHaveLength(1);
    await page.emulateMedia({ media: 'screen' });
  }
});
