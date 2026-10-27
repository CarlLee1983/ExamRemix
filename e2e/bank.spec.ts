import { expect, test, type Page } from '@playwright/test';

const BANK = '/bank/';

// 範例資料已知：sample-math 40 題、sample-chinese 16 題，共 56 題；未確認的只有 sample-math-22 與 sample-chinese-16
const TOTAL = 56;
const UNCONFIRMED = ['sample-chinese-16', 'sample-math-22'];

const items = (page: Page) => page.locator('.bank-item:visible');
const ids = (page: Page) => items(page).locator('.question-id').allTextContents();
const filter = (page: Page, label: string, option: string) => page.getByLabel(label).selectOption({ label: option });

test.describe('題庫瀏覽頁', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BANK);
  });

  test('預設列出所有題目（含未確認），依 ID 排序，顯示筆數', async ({ page }) => {
    await expect(items(page)).toHaveCount(TOTAL);
    const all = await ids(page);
    expect(all.slice(0, 2)).toEqual(['sample-chinese-01', 'sample-chinese-02']);
    expect(all).toEqual([...all].sort());
    expect(all).toContain('sample-math-22');
    await expect(page.locator('#count')).toHaveText(`共 ${TOTAL} 題，顯示 ${TOTAL} 題`);
  });

  test('篩選條件預設都是全部', async ({ page }) => {
    for (const label of ['科目', '年級', '單元', '題型', '確認狀態']) {
      await expect(page.getByLabel(label)).toHaveValue('');
      await expect(page.getByLabel(label).locator('option').first()).toHaveText('全部');
    }
  });

  test('確認狀態選未確認：只剩未確認的題目，改回全部則恢復', async ({ page }) => {
    await filter(page, '確認狀態', '未確認');
    expect(await ids(page)).toEqual(UNCONFIRMED);
    await expect(page.locator('#count')).toHaveText(`共 ${TOTAL} 題，顯示 2 題`);

    await filter(page, '確認狀態', '已確認');
    await expect(items(page)).toHaveCount(TOTAL - 2);
    expect(await ids(page)).not.toContain('sample-math-22');

    await filter(page, '確認狀態', '全部');
    await expect(items(page)).toHaveCount(TOTAL);
  });

  test('條件以 AND 組合：科目加確認狀態', async ({ page }) => {
    await filter(page, '確認狀態', '未確認');
    await filter(page, '科目', '數學');
    expect(await ids(page)).toEqual(['sample-math-22']);
    await filter(page, '科目', '國語');
    expect(await ids(page)).toEqual(['sample-chinese-16']);
  });

  test('條件以 AND 組合：科目、題型與確認狀態', async ({ page }) => {
    await filter(page, '科目', '國語');
    await filter(page, '題型', '選擇題');
    expect(await ids(page)).toEqual(['sample-chinese-01', 'sample-chinese-02', 'sample-chinese-03', 'sample-chinese-16']);
    await filter(page, '確認狀態', '已確認');
    expect(await ids(page)).toEqual(['sample-chinese-01', 'sample-chinese-02', 'sample-chinese-03']);
  });

  test('年級與單元的選項只含資料裡實際出現的值，單元篩選有效', async ({ page }) => {
    await expect(page.getByLabel('年級').locator('option')).toHaveText(['全部', '3 年級']);
    await expect(page.getByLabel('科目').locator('option')).toHaveText(['全部', '國語', '數學']);
    const units = await page.getByLabel('單元').locator('option').allTextContents();
    expect(units[0]).toBe('全部');
    expect(units).toEqual(expect.arrayContaining(['乘法', '字音', '造句']));
    // 範例資料每題都有單元，不會出現「無單元」選項
    expect(units).not.toContain('（無單元）');
    await filter(page, '單元', '字音');
    expect(await ids(page)).toContain('sample-chinese-16');
    await expect(items(page).locator('.meta-unit')).toHaveText(Array(await items(page).count()).fill('字音'));
  });

  test('沒有符合的題目時顯示 0 題', async ({ page }) => {
    await filter(page, '科目', '數學');
    await filter(page, '單元', '字音');
    await expect(items(page)).toHaveCount(0);
    await expect(page.locator('#count')).toHaveText(`共 ${TOTAL} 題，顯示 0 題`);
  });

  test('每題顯示 ID、中文題型與出處，答案與解析都看得到', async ({ page }) => {
    const item = page.locator('.bank-item[data-id="sample-math-01"]');
    await expect(item.locator('.question-id')).toHaveText('sample-math-01');
    await expect(item.locator('.meta')).toContainText('數學');
    await expect(item.locator('.meta')).toContainText('3 年級');
    await expect(item.locator('.meta')).toContainText('乘法');
    await expect(item.locator('.meta')).toContainText('選擇題');
    await expect(item.locator('.meta')).toContainText('已確認');
    await expect(item.locator('.meta')).toContainText('虛構三年級數學小考 第 1 題');
    await expect(item.locator('.stem')).toContainText('3 × 4 等於多少？');
    await expect(item.locator('.answer')).toBeVisible();
    await expect(item.locator('.answer')).toHaveText('2');
    await expect(item.locator('.explanation')).toBeVisible();
    await expect(item.locator('.explanation')).toContainText('3 × 4 = 12');
  });

  test('未確認的題目標示未確認，也看得到答案與解析', async ({ page }) => {
    const item = page.locator('.bank-item[data-id="sample-math-22"]');
    await expect(item.locator('.meta')).toContainText('未確認');
    await expect(item.locator('.explanation')).toBeVisible();
    await expect(item.locator('.answer')).toBeVisible();
  });

  test('ID 是可選取的文字', async ({ page }) => {
    const id = page.locator('.bank-item[data-id="sample-math-01"] .question-id');
    await expect(id).toHaveCSS('user-select', 'text');
  });

  test('切換篩選會把條件寫進網址，帶條件的網址開啟時已套用', async ({ page }) => {
    await filter(page, '確認狀態', '未確認');
    await expect(page).toHaveURL(/\?confirmed=false$/);
    await page.goto('/bank/?confirmed=false&subject=%E6%95%B8%E5%AD%B8');
    await expect(page.getByLabel('確認狀態')).toHaveValue('false');
    await expect(page.getByLabel('科目')).toHaveValue('數學');
    expect(await ids(page)).toEqual(['sample-math-22']);
    // 不認得的值當作全部
    await page.goto('/bank/?subject=nope');
    await expect(items(page)).toHaveCount(TOTAL);
  });

  test('不需要網路：載入時沒有對 localhost 以外發出請求', async ({ page }) => {
    const external: string[] = [];
    page.on('request', (request) => {
      const { protocol, hostname } = new URL(request.url());
      if (protocol.startsWith('http') && hostname !== 'localhost') external.push(request.url());
    });
    await page.goto(BANK, { waitUntil: 'networkidle' });
    expect(external).toEqual([]);
  });
});

test.describe('試卷列表', () => {
  const PAPERS = [
    { id: 'sample-chinese', title: '三年級國語試卷（範例）', subject: '國語', questions: 15 },
    { id: 'sample-math', title: '三年級數學試卷（範例）', subject: '數學', questions: 39 },
  ];

  test('列出兩份範例試卷，顯示科目、年級與題數', async ({ page }) => {
    await page.goto('/papers/');
    const rows = page.locator('.paper-list li');
    await expect(rows).toHaveCount(PAPERS.length);
    for (const [i, paper] of PAPERS.entries()) {
      await expect(rows.nth(i).getByRole('link')).toHaveText(paper.title);
      await expect(rows.nth(i)).toContainText(paper.subject);
      await expect(rows.nth(i)).toContainText('3 年級');
      await expect(rows.nth(i)).toContainText(`${paper.questions} 題`);
    }
  });

  for (const paper of PAPERS) {
    test(`連結開啟 ${paper.id} 的試卷頁`, async ({ page }) => {
      await page.goto('/papers/');
      await page.getByRole('link', { name: paper.title }).click();
      await expect(page).toHaveURL(`/papers/${paper.id}/`);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(paper.title);
    });
  }
});

test.describe('首頁', () => {
  test('連到題庫瀏覽與試卷列表', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: '題庫瀏覽' }).click();
    await expect(page).toHaveURL(BANK);
    await page.goto('/');
    await page.getByRole('link', { name: '試卷列表' }).click();
    await expect(page).toHaveURL('/papers/');
  });
});
