import { expect, test, type Page } from '@playwright/test';
import { EXAMPLE_TOTAL as TOTAL, expectSorted } from './helpers';

const BANK = '/bank/';

const items = (page: Page) => page.locator('.bank-item:visible');
const ids = (page: Page) => items(page).locator('.question-id').allTextContents();
const filter = (page: Page, label: string, option: string) => page.locator('#filters').getByLabel(label).selectOption({ label: option });

test.describe('題庫瀏覽頁', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BANK);
  });

  test('預設以單一清單列出所有題目：依 ID 排序，每題都收合，顯示筆數', async ({ page }) => {
    await expect(items(page)).toHaveCount(TOTAL);
    const all = await ids(page);
    expect(all.slice(0, 2)).toEqual(['sample-chinese-01', 'sample-chinese-02']);
    expectSorted(all);
    await expect(page.locator('details.bank-item[open]')).toHaveCount(0);
    await expect(page.locator('#items h2')).toHaveCount(0);
    await expect(page.locator('#count')).toHaveText(`共 ${TOTAL} 題，顯示 ${TOTAL} 題`);
  });

  test('篩選條件預設都是全部', async ({ page }) => {
    for (const label of ['科目', '年級', '單元', '題型']) {
      await expect(page.locator('#filters').getByLabel(label)).toHaveValue('');
      await expect(page.locator('#filters').getByLabel(label).locator('option').first()).toHaveText('全部');
    }
  });

  test('條件以 AND 組合：科目加題型', async ({ page }) => {
    await filter(page, '科目', '國語');
    await filter(page, '題型', '選擇題');
    expect(await ids(page)).toEqual(['sample-chinese-01', 'sample-chinese-02', 'sample-chinese-03', 'sample-chinese-16']);
    await filter(page, '科目', '數學');
    const math = await ids(page);
    expect(math.length).toBeGreaterThan(0);
    expect(math.every((id) => id.startsWith('sample-math-'))).toBe(true);
  });

  test('年級與單元的選項只含資料裡實際出現的值，單元篩選有效', async ({ page }) => {
    await expect(page.getByLabel('年級').locator('option')).toHaveText(['全部', '3 年級']);
    await expect(page.getByLabel('科目').locator('option')).toHaveText(['全部', '國語', '數學', '自然']);
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
    // 每題收在 details 內，展開後才看得到題目
    await item.locator('summary').click();
    await expect(item.locator('.question-id')).toHaveText('sample-math-01');
    await expect(item.locator('.item-head .chip.subject')).toHaveText('數學');
    await expect(item.locator('.meta-tags')).toHaveText('3 年級・乘法・選擇題');
    await expect(item.locator('.meta')).toContainText('虛構三年級數學小考 第 1 題');
    // 出處與用於在同一行，以「・」分隔
    await expect(item.locator('.meta')).toHaveText(/第 1 題・用於：/);
    await expect(item.locator('.stem')).toContainText('3 × 4 等於多少？');
    await expect(item.locator('.answer')).toBeVisible();
    await expect(item.locator('.answer')).toHaveText('2');
    await expect(item.locator('.explanation')).toBeVisible();
    await expect(item.locator('.explanation')).toContainText('3 × 4 = 12');
  });

  test('不再顯示確認狀態', async ({ page }) => {
    await expect(items(page)).toHaveCount(TOTAL);
    await expect(page.locator('.bank-item .meta', { hasText: /已確認|未確認/ })).toHaveCount(0);
  });

  test('有條件的下拉轉藍底（active），清除條件後還原', async ({ page }) => {
    const subject = page.locator('#filters').getByLabel('科目');
    await expect(subject).not.toHaveClass(/active/);
    await expect(subject).toHaveCSS('background-color', 'rgb(255, 255, 255)');
    await filter(page, '科目', '數學');
    await expect(subject).toHaveClass(/active/);
    // --blue-50；背景色有轉場，toHaveCSS 會重試到轉場結束
    await expect(subject).toHaveCSS('background-color', 'rgb(238, 243, 254)');
    await expect(page.locator('#filters').getByLabel('年級')).not.toHaveClass(/active/);
    await page.getByRole('button', { name: '清除條件' }).click();
    await expect(subject).not.toHaveClass(/active/);
    await expect(subject).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  });

  test('帶條件的網址開啟時，對應的下拉已是 active', async ({ page }) => {
    await page.goto('/bank/?subject=%E6%95%B8%E5%AD%B8');
    await expect(page.locator('#filters').getByLabel('科目')).toHaveClass(/active/);
  });

  test('ID 是可選取的文字', async ({ page }) => {
    const id = page.locator('.bank-item[data-id="sample-math-01"] .question-id');
    await expect(id).toHaveCSS('user-select', 'text');
  });

  test('切換篩選會把條件寫進網址，帶條件的網址開啟時已套用', async ({ page }) => {
    await filter(page, '科目', '數學');
    await filter(page, '單元', '乘法');
    await expect(page).toHaveURL(/\?subject=.+&unit=.+$/);
    await page.goto('/bank/?subject=%E6%95%B8%E5%AD%B8&unit=%E4%B9%98%E6%B3%95');
    await expect(page.getByLabel('科目')).toHaveValue('數學');
    await expect(page.getByLabel('單元')).toHaveValue('乘法');
    expect(await ids(page)).toEqual(expect.arrayContaining(['sample-math-01']));
    // 不認得的值當作全部
    await page.goto('/bank/?subject=nope');
    await expect(items(page)).toHaveCount(TOTAL);
  });

  test('網址帶 ?doubt= 或 ?confirmed= 當成不認得的參數：忽略，沒有條件，也沒有疑點篩選', async ({ page }) => {
    for (const query of ['?doubt=true', '?doubt=false', '?confirmed=false']) {
      await page.goto(`${BANK}${query}`);
      await expect(items(page)).toHaveCount(TOTAL);
      await expect(page.getByRole('button', { name: '清除條件' })).toBeHidden();
    }
    await expect(page.locator('#filters select[name="doubt"]')).toHaveCount(0);
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
    { id: 'sample-science', title: '三年級自然練習（虛構範例）', subject: '自然', questions: 5 },
  ];

  test('列出範例試卷，顯示科目、年級與題數', async ({ page }) => {
    await page.goto('/papers/');
    const rows = page.locator('.paper-list li');
    await expect(rows).toHaveCount(PAPERS.length);
    for (const [i, paper] of PAPERS.entries()) {
      await expect(rows.nth(i).getByRole('link').first()).toHaveText(paper.title);
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
