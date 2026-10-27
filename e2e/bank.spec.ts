import { expect, test, type Page } from '@playwright/test';
import { EXAMPLE_DOUBTED as DOUBTED, EXAMPLE_TOTAL as TOTAL, expectSorted } from './helpers';

const BANK = '/bank/';

// 疑點描述寫著「題幹依上下文推定」的那一題
const DOUBTED_STEM = 'sample-math-02';

const items = (page: Page) => page.locator('.bank-item:visible');
const ids = (page: Page) => items(page).locator('.question-id').allTextContents();
const filter = (page: Page, label: string, option: string) => page.locator('#filters').getByLabel(label).selectOption({ label: option });

test.describe('題庫瀏覽頁', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BANK);
  });

  test('預設列出所有題目（含有疑點）：有疑點在前，沒有疑點在後，各自依 ID 排序，顯示筆數', async ({ page }) => {
    await expect(items(page)).toHaveCount(TOTAL);
    const all = await ids(page);
    expect(all.slice(0, 2)).toEqual(DOUBTED);
    const plain = all.slice(2);
    expect(plain.slice(0, 2)).toEqual(['sample-chinese-01', 'sample-chinese-02']);
    expectSorted(plain);
    await expect(page.locator('#count')).toHaveText(`共 ${TOTAL} 題，顯示 ${TOTAL} 題`);
  });

  test('篩選條件預設都是全部', async ({ page }) => {
    for (const label of ['科目', '年級', '單元', '題型', '疑點']) {
      await expect(page.locator('#filters').getByLabel(label)).toHaveValue('');
      await expect(page.locator('#filters').getByLabel(label).locator('option').first()).toHaveText('全部');
    }
  });

  test('條件以 AND 組合：科目加疑點', async ({ page }) => {
    await filter(page, '疑點', '有疑點');
    await filter(page, '科目', '數學');
    expect(await ids(page)).toEqual(DOUBTED);
    await filter(page, '科目', '國語');
    expect(await ids(page)).toEqual([]);
    await expect(page.locator('#count')).toHaveText(`共 ${TOTAL} 題，顯示 0 題`);
  });

  test('條件以 AND 組合：科目加題型，再加上疑點', async ({ page }) => {
    await filter(page, '科目', '國語');
    await filter(page, '題型', '選擇題');
    expect(await ids(page)).toEqual(['sample-chinese-01', 'sample-chinese-02', 'sample-chinese-03', 'sample-chinese-16']);
    await filter(page, '科目', '數學');
    await filter(page, '疑點', '有疑點');
    expect(await ids(page)).toEqual(DOUBTED);
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
    // 沒有疑點的題目收在 details 內，展開後才看得到題目
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

  test('疑點選有疑點：只剩有疑點的題目；選無疑點則排除它', async ({ page }) => {
    await filter(page, '疑點', '有疑點');
    expect(await ids(page)).toEqual(DOUBTED);
    await expect(page.locator('#count')).toHaveText(`共 ${TOTAL} 題，顯示 ${DOUBTED.length} 題`);
    await filter(page, '疑點', '無疑點');
    await expect(items(page)).toHaveCount(TOTAL - DOUBTED.length);
    for (const id of DOUBTED) expect(await ids(page)).not.toContain(id);
  });

  test('疑點篩選寫進網址，帶 ?doubt=true 開啟時已套用', async ({ page }) => {
    await filter(page, '疑點', '有疑點');
    await expect(page).toHaveURL(/\?doubt=true$/);
    await page.goto('/bank/?doubt=true');
    await expect(page.locator('#filters').getByLabel('疑點')).toHaveValue('true');
    expect(await ids(page)).toEqual(DOUBTED);
    await page.goto('/bank/?doubt=false');
    await expect(items(page)).toHaveCount(TOTAL - DOUBTED.length);
  });

  test('有疑點的題目顯示有疑點與描述，沒有疑點的題目不顯示', async ({ page }) => {
    const doubt = page.locator(`.bank-item[data-id="${DOUBTED_STEM}"] .status-doubt`);
    await expect(doubt).toBeVisible();
    await expect(doubt).toContainText('題幹依上下文推定');
    await expect(page.locator('.bank-item[data-id="sample-math-01"] .status-doubt')).toHaveCount(0);
    await expect(page.locator(`.bank-item[data-id="${DOUBTED_STEM}"] .chip.doubt`)).toHaveText('有疑點');
    await expect(page.locator('.bank-item[data-id="sample-math-01"] .chip.doubt')).toHaveCount(0);
  });

  test('有疑點的題目不必展開就看得到答案與解析', async ({ page }) => {
    const item = page.locator('.bank-item[data-id="sample-math-22"]');
    await expect(item.locator('.explanation')).toBeVisible();
    await expect(item.locator('.answer')).toBeVisible();
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
    await page.goto('/bank/?doubt=true');
    await expect(page.locator('#filters').getByLabel('疑點')).toHaveClass(/active/);
  });

  test('ID 是可選取的文字', async ({ page }) => {
    const id = page.locator('.bank-item[data-id="sample-math-01"] .question-id');
    await expect(id).toHaveCSS('user-select', 'text');
  });

  test('切換篩選會把條件寫進網址，帶條件的網址開啟時已套用', async ({ page }) => {
    await filter(page, '疑點', '有疑點');
    await expect(page).toHaveURL(/\?doubt=true$/);
    await page.goto('/bank/?doubt=true&subject=%E6%95%B8%E5%AD%B8');
    await expect(page.locator('#filters').getByLabel('疑點')).toHaveValue('true');
    await expect(page.getByLabel('科目')).toHaveValue('數學');
    expect(await ids(page)).toEqual(DOUBTED);
    // 移除的確認狀態參數當作沒有條件，不保留相容
    await page.goto('/bank/?confirmed=false');
    await expect(items(page)).toHaveCount(TOTAL);
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
