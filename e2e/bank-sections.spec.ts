import { expect, test, type Page } from '@playwright/test';
import { copiedTexts, EXAMPLE_DOUBTED as DOUBTED, EXAMPLE_TOTAL as TOTAL, expectSorted, FIXTURE_URL, stubClipboard } from './helpers';

const BANK = '/bank/';

const doubtSection = (page: Page) => page.locator('#doubt-section');
const plainSection = (page: Page) => page.locator('#plain-section');
const ids = (section: ReturnType<typeof doubtSection>) => section.locator('.bank-item:visible .question-id').allTextContents();

test.describe('題庫：有疑點與沒有疑點兩區', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BANK);
  });

  test('有疑點在前、沒有疑點在後，兩區各自依 ID 排序，標題顯示題數', async ({ page }) => {
    const headings = page.locator('#items h2');
    await expect(headings).toHaveText([/^有疑點\s*2 題$/, new RegExp(`^沒有疑點\\s*${TOTAL - 2} 題$`)]);
    expect(await ids(doubtSection(page))).toEqual(DOUBTED);
    const plain = await ids(plainSection(page));
    expect(plain).toHaveLength(TOTAL - 2);
    expectSorted(plain);
  });

  test('有疑點的題目完整展開：題幹、答案、解析與疑點都看得到', async ({ page }) => {
    const card = page.locator('.bank-item[data-id="sample-math-22"]');
    await expect(card.locator('.stem')).toBeVisible();
    await expect(card.locator('.answer')).toBeVisible();
    await expect(card.locator('.explanation')).toBeVisible();
    await expect(card.locator('.chip.doubt')).toHaveText('有疑點');
    await expect(card.locator('.status-doubt')).toBeVisible();
  });

  test('沒有疑點的題目收在 details 內，summary 有 ID、題型、單元，展開才看得到題目', async ({ page }) => {
    const item = page.locator('details.bank-item[data-id="sample-math-01"]');
    await expect(item).not.toHaveAttribute('open', '');
    await expect(item.locator('summary')).toContainText('sample-math-01');
    await expect(item.locator('summary')).toContainText('選擇題');
    await expect(item.locator('summary')).toContainText('乘法');
    await expect(item.locator('.stem')).toBeHidden();
    await item.locator('summary').click();
    await expect(item.locator('.stem')).toContainText('3 × 4 等於多少？');
    await expect(item.locator('.chip.doubt')).toHaveCount(0);
  });

  test('篩選後區塊標題的題數跟著變，空的區塊隱藏', async ({ page }) => {
    await page.getByLabel('科目').selectOption({ label: '數學' });
    await expect(page.locator('#doubt-section h2')).toHaveText(/2 題/);
    await page.locator('#filters').getByLabel('疑點').selectOption({ label: '有疑點' });
    await expect(plainSection(page)).toBeHidden();
    await page.locator('#filters').getByLabel('疑點').selectOption({ label: '無疑點' });
    await expect(doubtSection(page)).toBeHidden();
    await expect(plainSection(page)).toBeVisible();
  });

  test('每題顯示「用於：」的試卷標題；沒被引用的寫「尚未用於試卷」', async ({ page }) => {
    await expect(page.locator('.bank-item[data-id="sample-math-22"] .used-in')).toHaveText('尚未用於試卷');
    const used = page.locator('.bank-item[data-id="sample-math-02"] .used-in');
    await expect(used).toHaveText('用於：三年級數學試卷（範例）');
  });

  test('出處與衍生自仍然顯示', async ({ page }) => {
    await expect(page.locator('.bank-item[data-id="sample-math-22"] .meta')).toContainText('出處：虛構三年級數學小考 第 22 題');
  });

  test('網站唯讀：沒有勾選框', async ({ page }) => {
    await expect(page.getByRole('checkbox')).toHaveCount(0);
  });
});

test.describe('題庫：清除條件', () => {
  test('沒有條件時不出現；有條件才出現，按下後全部清掉並更新網址與題數', async ({ page }) => {
    await page.goto(BANK);
    const clear = page.getByRole('button', { name: '清除條件' });
    await expect(clear).toBeHidden();
    await page.getByLabel('科目').selectOption({ label: '數學' });
    await expect(clear).toBeVisible();
    await clear.click();
    await expect(page.getByLabel('科目')).toHaveValue('');
    await expect(page).toHaveURL(BANK);
    await expect(page.locator('#count')).toHaveText(`共 ${TOTAL} 題，顯示 ${TOTAL} 題`);
    await expect(clear).toBeHidden();
    // 清除鈕消失後焦點要有去處，不能掉回頁面頂端
    await expect(page.getByLabel('科目')).toBeFocused();
  });

  test('帶條件的網址開啟時就有清除條件', async ({ page }) => {
    await page.goto('/bank/?doubt=true');
    await expect(page.getByRole('button', { name: '清除條件' })).toBeVisible();
  });
});

test.describe('題庫：沒有單元的題目', () => {
  test('不輸出空的單元項目，也沒有多餘的分隔', async ({ page }) => {
    await page.goto(`${FIXTURE_URL}/bank/`);
    const loose = page.locator('details.bank-item[data-id="loose-01"]');
    await loose.locator('summary').click();
    await expect(loose.locator('.meta-tags')).toHaveText('3 年級・是非題');
    await expect(loose.locator('.meta-unit')).toHaveCount(0);
    const withUnit = page.locator('details.bank-item[data-id="loose-02"]');
    await withUnit.locator('summary').click();
    await expect(withUnit.locator('.meta-tags')).toHaveText('3 年級・乘法・是非題');
    // summary 只有 ID 與題型（沒有單元時不留「・」）
    await expect(loose.locator('summary .summary-text')).toHaveText('是非題');
  });
});

test.describe('題庫：複製 ID', () => {
  test('複製 ID 把題目 ID 寫進剪貼簿（有疑點的卡片與沒有疑點的展開後都有）', async ({ page }) => {
    await stubClipboard(page);
    await page.goto(BANK);
    await page.locator('.bank-item[data-id="sample-math-22"]').getByRole('button', { name: '複製 ID' }).click();
    expect(await copiedTexts(page)).toEqual(['sample-math-22']);

    const item = page.locator('details.bank-item[data-id="sample-math-01"]');
    await item.locator('summary').click();
    await item.getByRole('button', { name: '複製 ID' }).click();
    expect(await copiedTexts(page)).toEqual(['sample-math-22', 'sample-math-01']);
  });

  test('複製成功時讀屏用的狀態區也有文字', async ({ page }) => {
    await stubClipboard(page);
    await page.goto(BANK);
    await page.locator('.bank-item[data-id="sample-math-22"] .copy-id').click();
    await expect(page.locator('#announce')).toHaveText('已複製 sample-math-22');
  });

  test('複製失敗：按鈕訊息維持超過 2 秒、選取該 ID、狀態區說明', async ({ page }) => {
    await stubClipboard(page, { fail: true });
    await page.goto(BANK);
    const button = page.locator('.bank-item[data-id="sample-math-22"] .copy-id');
    await button.click();
    await expect(button).toContainText('無法複製');
    await page.waitForTimeout(2200);
    await expect(button).toContainText('無法複製');
    expect(await page.evaluate(() => getSelection()!.toString())).toBe('sample-math-22');
    await expect(page.locator('#announce')).toContainText('無法複製');
  });

  test('沒有疑點的題目複製失敗：選取 summary 裡的 ID，details 維持展開', async ({ page }) => {
    await stubClipboard(page, { fail: true });
    await page.goto(BANK);
    const item = page.locator('details.bank-item[data-id="sample-math-01"]');
    await item.locator('summary').click();
    await item.locator('.copy-id').click();
    expect(await page.evaluate(() => getSelection()!.toString())).toBe('sample-math-01');
    await expect(item).toHaveAttribute('open', '');
  });

  test('按下後按鈕短暫回饋「已複製」', async ({ page }) => {
    await stubClipboard(page);
    await page.goto(BANK);
    const button = page.locator('.bank-item[data-id="sample-math-22"]').locator('.copy-id');
    await button.click();
    await expect(button).toContainText('已複製');
    // 成功回饋轉綠色（--ok-bg），標籤還原時一併還原
    await expect(button).toHaveClass(/done/);
    await expect(button).toHaveCSS('background-color', 'rgb(227, 245, 234)');
    await expect(button).not.toHaveClass(/done/, { timeout: 4000 });
    await expect(button).toContainText('複製 ID');
  });
});
