import { expect, test } from '@playwright/test';
import { answerToggle as toggle, printCalls, stubPrint } from './helpers';

const PAPER = '/papers/sample-math/';

test.describe('試卷頁工具列', () => {
  test.beforeEach(async ({ page }) => {
    await stubPrint(page);
  });

  test('有返回試卷列表的連結、切換鈕與列印鈕', async ({ page }) => {
    await page.goto(PAPER);
    await expect(page.getByRole('link', { name: '試卷列表' })).toHaveAttribute('href', '/papers/');
    await expect(toggle(page)).toBeVisible();
    await expect(page.getByRole('button', { name: '列印', exact: true })).toBeVisible();
  });

  test('切換鈕按下後填色並露出勾，aria-pressed 為 true；再按一次還原', async ({ page }) => {
    await page.goto(PAPER);
    const check = toggle(page).locator('.when-pressed');
    await expect(toggle(page)).toHaveAttribute('aria-pressed', 'false');
    await expect(check).toBeHidden();
    await expect(toggle(page)).toHaveCSS('background-color', 'rgb(255, 255, 255)');
    await toggle(page).click();
    await expect(toggle(page)).toHaveAttribute('aria-pressed', 'true');
    await expect(check).toBeVisible();
    // 按下填 --text 深色；背景色有轉場，toHaveCSS 會重試到轉場結束
    await expect(toggle(page)).toHaveCSS('background-color', 'rgb(20, 33, 61)');
    await toggle(page).click();
    await expect(toggle(page)).toHaveAttribute('aria-pressed', 'false');
    await expect(check).toBeHidden();
    // 游標還停在鈕上時是 hover 色，移開再看
    await page.mouse.move(0, 0);
    await expect(toggle(page)).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  });

  test('工具列黏在視窗上緣，捲動後仍看得到', async ({ page }) => {
    await page.goto(PAPER);
    await page.evaluate(() => window.scrollTo(0, 2000));
    await expect(page.getByRole('link', { name: '試卷列表' })).toBeInViewport();
  });

  test('列印鈕呼叫 window.print，不改變目前的顯示模式', async ({ page }) => {
    await page.goto(PAPER);
    await page.getByRole('button', { name: '列印', exact: true }).click();
    expect(await printCalls(page)).toEqual(['paper']);
    await toggle(page).click();
    await page.getByRole('button', { name: '列印', exact: true }).click();
    expect(await printCalls(page)).toEqual(['paper', 'answer']);
  });

  test('工具列列印時隱藏', async ({ page }) => {
    await page.goto(PAPER);
    await page.emulateMedia({ media: 'print' });
    await expect(page.getByRole('link', { name: '試卷列表' })).toBeHidden();
    await expect(page.getByRole('button', { name: '列印', exact: true })).toBeHidden();
  });

  test('?print=answer：切成答案卷、列印，並拿掉網址參數', async ({ page }) => {
    await page.goto(`${PAPER}?print=answer`);
    await expect.poll(() => printCalls(page)).toEqual(['answer']);
    await expect(toggle(page)).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.explanation:visible')).not.toHaveCount(0);
    await expect(page).toHaveURL(PAPER);
  });

  test('?print=paper：維持試卷、列印，並拿掉網址參數', async ({ page }) => {
    await page.goto(`${PAPER}?print=paper`);
    await expect.poll(() => printCalls(page)).toEqual(['paper']);
    await expect(toggle(page)).toHaveAttribute('aria-pressed', 'false');
    await expect(page).toHaveURL(PAPER);
  });

  test('拿掉 print 參數時保留其他參數', async ({ page }) => {
    await page.goto(`${PAPER}?x=1&print=answer`);
    await expect.poll(() => printCalls(page)).toEqual(['answer']);
    await expect(page).toHaveURL(`${PAPER}?x=1`);
  });

  test('不認得的 print 值不列印', async ({ page }) => {
    await page.goto(`${PAPER}?print=nope`);
    // print() 若會被呼叫，是在 load 與字型就緒之後，所以等到那之後再斷言
    await page.waitForLoadState('load');
    await page.evaluate(() => document.fonts.ready);
    await expect(toggle(page)).toBeVisible();
    expect(await printCalls(page)).toEqual([]);
    await expect(page).toHaveURL(`${PAPER}?print=nope`);
  });
});

test.describe('試卷頁工具列：沒有 JavaScript', () => {
  test.use({ javaScriptEnabled: false });

  test('只顯示返回連結', async ({ page }) => {
    await page.goto(PAPER);
    await expect(page.getByRole('link', { name: '試卷列表' })).toBeVisible();
    await expect(toggle(page)).toBeHidden();
    await expect(page.getByRole('button', { name: '列印', exact: true })).toBeHidden();
  });
});
