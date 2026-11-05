import { test, expect } from '@playwright/test';

test('未知範圍卷的試卷／答案網址都為404，所有入口與題庫不留下連結', async ({ page }) => {
  for (const suffix of ['', '?print=paper', '?print=answer']) {
    const response=await page.goto(`http://localhost:4400/papers/disabled-unknown/${suffix}`);
    expect(response?.status()).toBe(404);
    await expect(page.getByText('不得輸出的未知範圍合成卷',{exact:true})).toHaveCount(0);
  }
  for(const path of ['/','/papers/','/bank/']){
    await page.goto(`http://localhost:4400${path}`);
    await expect(page.locator('a[href*="/papers/disabled-unknown/"]')).toHaveCount(0);
  }
});

test('首頁把可選容量與未配置的完整卷規則分開，原始題數不冒充可組卷數', async ({ page }) => {
  await page.goto('/');
  const capacities=page.locator('#capacities');
  await expect(capacities.locator('li')).toHaveCount(5);
  await expect(capacities).toContainText('可選題數不代表完整卷能力');
  await expect(capacities).toContainText('完整卷規則尚未配置');
});
