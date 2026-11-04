import { expect, test } from '@playwright/test';
import { answerToggle, FIXTURE_URL } from './helpers';

test('配對題以兩欄黑點保留連線空間，答案卷在左側原位置顯示代號與解析', async ({ page }) => {
  await page.goto('/papers/sample-social/');
  const question = page.locator('[data-question-type="matching"]');
  await expect(page.locator('.question')).toHaveCount(4);
  await expect(question.locator('.number')).toHaveText('4.');
  const left = question.locator('.matching-left li');
  const right = question.locator('.matching-right li');
  await expect(left).toHaveCount(3);
  await expect(right).toHaveCount(4);
  await expect(question.locator('.matching-right .matching-code')).toHaveText(['甲', '乙', '丙', '丁']);
  const dots = question.locator('.matching-endpoint');
  await expect(dots).toHaveCount(7);
  for (const dot of await dots.all()) {
    await expect(dot).toHaveText('●');
    await expect(dot).toBeVisible();
  }
  const leftDot = (await left.first().locator('.matching-endpoint').boundingBox())!;
  const rightDot = (await right.first().locator('.matching-endpoint').boundingBox())!;
  expect(rightDot.x - leftDot.x - leftDot.width).toBeGreaterThan(20);
  await expect(question.locator('svg, canvas, line')).toHaveCount(0);
  for (const image of await question.getByRole('img').all()) {
    await expect(image).toBeVisible();
    await expect.poll(() => image.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true);
  }
  await expect(question.getByRole('img')).toHaveCount(2);
  await expect(question.locator('ruby')).toHaveCount(3);
  await page.evaluate(() => document.fonts.ready);
  const content = question.locator('.matching-content, .matching-endpoint');
  const before = await content.evaluateAll(elements => elements.map(element => {
    const origin = element.closest('.question')!.getBoundingClientRect();
    const box = element.getBoundingClientRect();
    return [box.x - origin.x, box.y - origin.y, box.width, box.height];
  }));
  await expect(question.locator('.answer:visible, .explanation:visible')).toHaveCount(0);
  await answerToggle(page).click();
  await expect(question.locator('.matching-left .answer')).toHaveText(['甲', '乙', '乙']);
  await expect(question.locator('.answer:visible')).toHaveCount(3);
  await expect(question.locator('.explanation')).toBeVisible();
  expect(await content.evaluateAll(elements => elements.map(element => {
    const origin = element.closest('.question')!.getBoundingClientRect();
    const box = element.getBoundingClientRect();
    return [box.x - origin.x, box.y - origin.y, box.width, box.height];
  }))).toEqual(before);
});


test('題庫可篩選配對題，圖文與答案完整顯示，首頁只計一題', async ({ page }) => {
  await page.goto('/bank/');
  await page.getByLabel('題型').selectOption({ label: '配對題' });
  const item = page.locator('.bank-item:visible');
  await expect(item).toHaveCount(1);
  await expect(item.locator('.question-id')).toHaveText('sample-social-08');
  await item.locator('summary').click();
  await expect(item.locator('.matching-left .answer:visible')).toHaveCount(3);
  await expect(item.locator('.matching-right li')).toHaveCount(4);
  await expect(item.getByRole('img')).toHaveCount(2);
  await page.goto('/');
  const social = page.locator('#composition .mix-subject[data-subject="社會"]');
  await expect(social).toContainText('8 題');
  await expect(social.locator('.mix-bar')).toHaveAttribute('aria-label', /配對題 1/);
});

for (const surface of ['paper', 'bank'] as const) {
  test(`${surface} 的多字元代號原樣顯示，保留全池寬高且不溢出答案格`, async ({ page }) => {
    await page.goto(`${FIXTURE_URL}/${surface === 'paper' ? 'papers/matching-codes/' : 'bank/'}`);
    const question = surface === 'paper' ? page.locator('[data-question-type="matching"]') : page.locator('details[data-id="matching-01"]');
    if (surface === 'paper') await answerToggle(page).click();
    else await question.locator('summary').click();
    for (const width of surface === 'paper' ? [1280] : [1280, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await page.evaluate(() => document.fonts.ready);
      await expect(question.locator('.matching-left .answer')).toHaveText(['[A|B]', '<b>iiiiiiiiiiiiiiiiiiii</b>']);
      await expect(question.locator('b')).toHaveCount(0);
      await expect(question.locator('.matching-left ruby')).toHaveCount(1);
      await expect(question.locator('.matching-right .katex')).toHaveCount(1);
      for (const image of await question.getByRole('img').all()) {
        await expect.poll(() => image.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true);
      }
      const bounds = await question.locator('.matching-left .answer').evaluateAll(elements => elements.map(element => {
        const range = document.createRange();
        range.selectNodeContents(element);
        const text = range.getBoundingClientRect();
        const cell = element.parentElement!.getBoundingClientRect();
        return { textLeft: text.left, textRight: text.right, textTop: text.top, textBottom: text.bottom, cellLeft: cell.left, cellRight: cell.right, cellTop: cell.top, cellBottom: cell.bottom };
      }));
      for (const bound of bounds) {
        expect(bound.textLeft).toBeGreaterThanOrEqual(bound.cellLeft - 0.1);
        expect(bound.textRight).toBeLessThanOrEqual(bound.cellRight + 0.1);
        expect(bound.textTop).toBeGreaterThanOrEqual(bound.cellTop - 1);
        expect(bound.textBottom).toBeLessThanOrEqual(bound.cellBottom + 1);
      }
      if (surface === 'bank') expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
  });
}

for (const mode of ['paper', 'answer'] as const) {
  test(`配對題 ${mode} 輸出 A4 PDF，兩欄與答案顯隱正確`, async ({ page }, testInfo) => {
    await page.goto('/papers/sample-social/');
    if (mode === 'answer') await answerToggle(page).click();
    await page.emulateMedia({ media: 'print' });
    const question = page.locator('[data-question-type="matching"]');
    await expect(question.locator('.matching-left .answer:visible')).toHaveCount(mode === 'answer' ? 3 : 0);
    await expect(question.locator('.explanation:visible')).toHaveCount(mode === 'answer' ? 1 : 0);
    await expect(question.locator('.matching-endpoint')).toHaveCount(7);
    const pdf = await page.pdf({ path: testInfo.outputPath(`${mode}.pdf`), preferCSSPageSize: true });
    const pages = [...pdf.toString('latin1').matchAll(/\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/g)];
    expect(pages.length).toBeGreaterThan(0);
    for (const [, width, height] of pages) {
      expect(Math.abs(Number(width) - 595)).toBeLessThan(1);
      expect(Math.abs(Number(height) - 842)).toBeLessThan(1);
    }
  });
}

test('超過十項仍完整顯示，兩欄不等長時不截斷內容', async ({ page }, testInfo) => {
  await page.goto(`${FIXTURE_URL}/papers/matching-many/`);
  const question = page.locator('[data-question-type="matching"]');
  await expect(question.locator('.number')).toHaveText('1.');
  await expect(question.locator('.matching-left li')).toHaveCount(11);
  await expect(question.locator('.matching-left li').last()).toContainText('第11項');
  await expect(question.locator('.matching-right li')).toHaveCount(2);
  for (const mode of ['paper', 'answer'] as const) {
    if (mode === 'answer') await answerToggle(page).click();
    await page.emulateMedia({ media: 'print' });
    await expect(question.locator('.answer:visible')).toHaveCount(mode === 'answer' ? 11 : 0);
    await page.pdf({ path: testInfo.outputPath(`${mode}.pdf`), preferCSSPageSize: true });
    await page.emulateMedia({ media: 'screen' });
  }
});
