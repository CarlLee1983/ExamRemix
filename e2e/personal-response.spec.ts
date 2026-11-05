import { expect, test } from '@playwright/test';
import { FIXTURE_URL } from './helpers';

test('個人問答題本留四線格，答案卷明示依個人情況及非唯一範例', async ({ page }) => {
  await page.goto(`${FIXTURE_URL}/papers/english-personal-response/`);
  const questions = page.locator('.question-personal-response');
  await expect(questions).toHaveCount(3);
  await expect(questions.locator('.personal-writing-line')).toHaveCount(4);
  await expect(questions.locator('.writing-guide > span')).toHaveCount(16);
  await expect(questions.locator('.personal-answer:visible')).toHaveCount(0);
  await expect(questions.locator('.explanation:visible')).toHaveCount(0);
  const multiple = questions.nth(2).locator('.personal-writing-line');
  const firstLine = await multiple.nth(0).boundingBox();
  const secondLine = await multiple.nth(1).boundingBox();
  expect(secondLine!.y).toBeGreaterThan(firstLine!.y + firstLine!.height);

  const geometry = () => questions.first().locator('.personal-writing-line').evaluate((el) => {
    const box = el.getBoundingClientRect();
    return { width: box.width, height: box.height, borders: [...el.querySelectorAll('.writing-guide > span')].map((line) => getComputedStyle(line).borderTopStyle) };
  });
  const before = await geometry();
  expect(before.borders).toEqual(['solid', 'dashed', 'solid', 'solid']);
  await page.getByRole('button', { name: '顯示答案卷' }).click();
  await expect(questions.locator('.personal-answer:visible')).toHaveCount(3);
  await expect(questions.nth(0).locator('.personal-answer')).toContainText("範例：My name is Anne-Marie O'Neil.");
  await expect(questions.nth(1).locator('.personal-answer')).toHaveText('依個人情況作答。');
  expect(await geometry()).toEqual(before);
  await page.emulateMedia({ media: 'print' });
  expect((await geometry()).borders).toEqual(['solid', 'dashed', 'solid', 'solid']);
  await page.emulateMedia({ media: 'screen' });
  await page.getByRole('button', { name: '顯示答案卷' }).click();
  await expect(questions.locator('.personal-answer:visible')).toHaveCount(0);
});

test('窄螢幕題庫可完整顯示四線格和長範例', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 900 });
  await page.goto(`${FIXTURE_URL}/bank/`);
  const item = page.locator('details.bank-item[data-id="personal-response-03"]');
  await item.locator('summary').click();
  await expect(item.locator('.personal-answer')).toBeVisible();
  const bounds = await item.evaluate((el) => {
    const card = el.getBoundingClientRect();
    const line = el.querySelector('.personal-writing-line')!.getBoundingClientRect();
    const answer = el.querySelector<HTMLElement>('.personal-answer')!;
    return { cardLeft: card.left, cardRight: card.right, lineLeft: line.left, lineRight: line.right, textWidth: answer.scrollWidth, available: answer.clientWidth };
  });
  expect(bounds.lineLeft).toBeGreaterThanOrEqual(bounds.cardLeft);
  expect(bounds.lineRight).toBeLessThanOrEqual(bounds.cardRight);
  expect(bounds.textWidth).toBeLessThanOrEqual(bounds.available + 1);
});
