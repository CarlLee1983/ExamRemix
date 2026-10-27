import { expect, test } from '@playwright/test';
import { FIXTURE_URL } from './helpers';

const PAPERS = [
  { id: 'sample-chinese', title: '三年級國語試卷（範例）', subject: '國語', meta: '15 題・7 大題' },
  { id: 'sample-math', title: '三年級數學試卷（範例）', subject: '數學', meta: '39 題・9 大題' },
  { id: 'sample-science', title: '三年級自然練習（虛構範例）', subject: '自然', meta: '5 題・2 大題' },
];

test.describe('共用外殼', () => {
  for (const [path, current] of [
    ['/', '首頁'],
    ['/bank/', '題庫瀏覽'],
    ['/papers/', '試卷列表'],
  ] as const) {
    test(`${path} 的導覽列只有「${current}」標為目前頁`, async ({ page }) => {
      await page.goto(path);
      const nav = page.getByRole('navigation', { name: '主選單' });
      await expect(nav.getByRole('link')).toHaveText(['首頁', '題庫瀏覽', '試卷列表']);
      await expect(nav.locator('[aria-current="page"]')).toHaveText(current);
    });
  }

  test('試卷頁不用外殼', async ({ page }) => {
    await page.goto('/papers/sample-math/');
    await expect(page.getByRole('navigation', { name: '主選單' })).toHaveCount(0);
  });
});

test.describe('首頁：總覽', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('疑點卡片顯示題數，「查看疑點」連到疑點清單', async ({ page }) => {
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('總覽');
    await expect(page.getByRole('heading', { level: 2, name: '有疑點的題目' })).toBeVisible();
    await expect(page.locator('.pending-count')).toHaveText('2');
    await expect(page.getByRole('link', { name: '查看疑點' })).toHaveAttribute('href', '/bank/?doubt=true');
  });

  test('每份試卷一列：標題連結、科目・題數、試卷與答案卷的列印連結', async ({ page }) => {
    const rows = page.locator('.paper-list li');
    await expect(rows).toHaveCount(PAPERS.length);
    for (const [i, paper] of PAPERS.entries()) {
      const row = rows.nth(i);
      await expect(row.getByRole('link', { name: paper.title })).toHaveAttribute('href', `/papers/${paper.id}/`);
      await expect(row.locator('.chip.subject')).toHaveText(paper.subject);
      await expect(row).toContainText(paper.meta);
      await expect(row.getByRole('link', { name: '列印試卷', exact: true })).toHaveAttribute('href', `/papers/${paper.id}/?print=paper`);
      await expect(row.getByRole('link', { name: '列印答案卷', exact: true })).toHaveAttribute('href', `/papers/${paper.id}/?print=answer`);
    }
  });

  test('題庫組成條：每個科目顯示題數與各題型題數，色段寬度依題數', async ({ page }) => {
    const mix = page.locator('#composition');
    await expect(mix).toContainText('共 61 題');
    const subjects = mix.locator('.mix-subject');
    await expect(subjects).toHaveCount(3);
    for (const [subject, count] of [['國語', 16], ['數學', 40], ['自然', 5]] as const) {
      const block = mix.locator(`.mix-subject[data-subject="${subject}"]`);
      await expect(block).toContainText(`${count} 題`);
      const bar = block.locator('.mix-bar');
      await expect(bar).toHaveAttribute('aria-label', new RegExp(`^${subject}：`));
      const flex = await bar.locator('span').evaluateAll((spans) => spans.map((s) => Number(getComputedStyle(s).flexGrow)));
      expect(flex.length).toBeGreaterThan(0);
      expect(flex.reduce((a, b) => a + b, 0)).toBe(count);
    }
    await expect(mix.locator('.mix-subject[data-subject="數學"] .mix-bar')).toHaveAttribute('aria-label', /選擇題 22/);
  });

  test('問候日期在瀏覽器端產生', async ({ page }) => {
    await expect(page.locator('#today')).toHaveText(/^\d{1,2} 月 \d{1,2} 日　星期[一二三四五六日]$/);
  });

  test('導覽列連到題庫瀏覽與試卷列表', async ({ page }) => {
    await page.getByRole('navigation', { name: '主選單' }).getByRole('link', { name: '題庫瀏覽' }).click();
    await expect(page).toHaveURL('/bank/');
    await page.goto('/');
    await page.getByRole('navigation', { name: '主選單' }).getByRole('link', { name: '試卷列表' }).click();
    await expect(page).toHaveURL('/papers/');
  });
});

test.describe('試卷列表：列印連結', () => {
  test('每列有試卷與答案卷的列印連結', async ({ page }) => {
    await page.goto('/papers/');
    const rows = page.locator('.paper-list li');
    for (const [i, paper] of PAPERS.entries()) {
      await expect(rows.nth(i).getByRole('link', { name: '列印試卷', exact: true })).toHaveAttribute('href', `/papers/${paper.id}/?print=paper`);
      await expect(rows.nth(i).getByRole('link', { name: '列印答案卷', exact: true })).toHaveAttribute('href', `/papers/${paper.id}/?print=answer`);
    }
  });
});

test.describe('首頁：沒有 JavaScript', () => {
  test.use({ javaScriptEnabled: false });

  test('不顯示日期，其餘內容照常', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#today')).toBeHidden();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('總覽');
    await expect(page.locator('#composition')).toBeVisible();
  });
});

test.describe('首頁：沒有疑點', () => {
  test('寫「沒有疑點」，次要連結到題庫，沒有「查看疑點」', async ({ page }) => {
    await page.goto(`${FIXTURE_URL}/`);
    await expect(page.getByText('沒有疑點', { exact: true })).toBeVisible();
    await expect(page.locator('.pending-count')).toHaveCount(0);
    await expect(page.getByRole('link', { name: '查看疑點' })).toHaveCount(0);
    const link = page.getByRole('link', { name: '查看題庫' });
    await expect(link).toHaveAttribute('href', '/bank/');
    await expect(link).not.toHaveClass(/primary/);
  });
});

test.describe('版面：整頁不橫捲', () => {
  for (const width of [1440, 390]) {
    for (const path of ['/', '/bank/', '/papers/', '/papers/sample-math/']) {
      test(`${path} 在 ${width} 寬沒有整頁橫向捲動`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(path);
        const { scrollWidth, innerWidth } = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth }));
        expect(scrollWidth).toBeLessThanOrEqual(innerWidth);
      });
    }
  }
});
