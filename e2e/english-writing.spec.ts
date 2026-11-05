import { expect, test } from '@playwright/test';
import { FIXTURE_URL } from './helpers';

test('英語四線格在試卷和答案卷維持位置，保留多空格換行與列印線條', async ({ page }) => {
  await page.goto(`${FIXTURE_URL}/papers/english-four-line/`);
  const questions = page.locator('.question-four-line');
  await expect(questions).toHaveCount(6);
  await expect(page.locator('.writing-guide')).toHaveCount(8);
  await expect(page.locator('.writing-guide > span')).toHaveCount(32);
  await expect(page.locator('.blank-answer:visible')).toHaveCount(0);

  const multiple = questions.nth(1).locator('.blank-four-line');
  await expect(multiple).toHaveCount(3);
  const first = await multiple.nth(0).boundingBox();
  const second = await multiple.nth(1).boundingBox();
  expect(second!.y).toBeGreaterThanOrEqual(first!.y + first!.height);

  const geometry = () => questions.first().locator('.blank-four-line').evaluate((el) => {
    const blank = el.getBoundingClientRect();
    return {
      width: blank.width,
      height: blank.height,
      lines: [...el.querySelectorAll('.writing-guide > span')].map((line) => {
        const rect = line.getBoundingClientRect();
        return { y: rect.y - blank.y, border: getComputedStyle(line).borderTopStyle };
      }),
    };
  });
  const before = await geometry();
  expect(before.lines.map((line) => line.border)).toEqual(['solid', 'dashed', 'solid', 'solid']);
  await page.getByRole('button', { name: '顯示答案卷' }).click();
  await expect(page.locator('.blank-answer:visible')).toHaveCount(8);
  expect(await geometry()).toEqual(before);
  await page.setViewportSize({ width: 658, height: 1123 });
  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('.blank-answer:visible')).toHaveCount(8);
  expect((await geometry()).lines.map((line) => line.border)).toEqual(['solid', 'dashed', 'solid', 'solid']);
  for (const index of [3, 4, 5]) {
    const bounds = await questions.nth(index).locator('.blank-four-line').evaluate((el) => {
      const box = el.getBoundingClientRect();
      const paper = el.closest('.paper')!.getBoundingClientRect();
      const answer = el.querySelector<HTMLElement>('.blank-answer')!;
      return { right: box.right, paperRight: paper.right, textWidth: answer.scrollWidth, available: answer.clientWidth };
    });
    expect(bounds.right).toBeLessThanOrEqual(bounds.paperRight);
    expect(bounds.textWidth).toBeLessThanOrEqual(bounds.available + 1);
  }
});

test('窄螢幕題庫的長答案與四線格不會被裁切', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 900 });
  await page.goto(`${FIXTURE_URL}/bank/`);
  for (const id of ['four-line-04', 'four-line-05', 'four-line-06']) {
    const item = page.locator(`details.bank-item[data-id="${id}"]`);
    await item.locator('summary').click();
    const blank = item.locator('.blank-four-line');
    await expect(blank).toBeVisible();
    const bounds = await blank.evaluate((el) => {
      const item = el.closest('.bank-item')!.getBoundingClientRect();
      const box = el.getBoundingClientRect();
      const answer = el.querySelector<HTMLElement>('.blank-answer')!;
      return { itemLeft: item.left, itemRight: item.right, left: box.left, right: box.right, textWidth: answer.scrollWidth, available: answer.clientWidth };
    });
    expect(bounds.left).toBeGreaterThanOrEqual(bounds.itemLeft);
    expect(bounds.right).toBeLessThanOrEqual(bounds.itemRight);
    expect(bounds.textWidth).toBeLessThanOrEqual(bounds.available + 1);
  }
});

test('題庫頁也顯示四線格與答案', async ({ page }) => {
  await page.goto(`${FIXTURE_URL}/bank/`);
  const item = page.locator('details.bank-item[data-id="four-line-01"]');
  await item.locator('summary').click();
  await expect(item.locator('.writing-guide > span')).toHaveCount(4);
  await expect(item.locator('.blank-answer')).toBeVisible();
  await expect(item.locator('.blank-answer')).toHaveText('BAG');
});
