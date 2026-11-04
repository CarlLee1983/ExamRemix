import { expect, test } from '@playwright/test';
import { answerToggle, FIXTURE_URL } from './helpers';

test('英語內容與材料標示英文並用英文字型，中文外框與其他科目維持原字型', async ({ page }) => {
  await page.goto('/papers/sample-english/');
  const chineseFont = await page.locator('.paper-head').evaluate(el => getComputedStyle(el).fontFamily);
  await expect(page.locator('.stem:lang(en)')).toHaveCount(5);
  for (const selector of ['.stem', '.options', '.explanation', '.answer-line-text', '.matching-left .answer', '.material-paragraph']) {
    for (const element of await page.locator(selector).all()) {
      expect(await element.evaluate(el => el.matches(':lang(en)'))).toBe(true);
      expect(await element.evaluate(el => getComputedStyle(el).fontFamily)).toMatch(/^Arial/);
    }
  }
  await expect(page.locator('.material-paragraph')).toHaveText('Mia has a red book. She reads it in the park.');
  await expect(page.locator('.question-choice .stem')).toContainText('[is|are]');
  await expect(page.locator('.question-choice ruby')).toHaveCount(2);
  for (const selector of ['.paper-head', '.section-title', '.number', '.answer-box', '.answer-label', '.calc-box-label', '.explanation-label', '.material-label', 'ruby']) {
    for (const element of await page.locator(selector).all()) {
      expect(await element.evaluate(el => el.matches(':lang(zh)'))).toBe(true);
      expect(await element.evaluate(el => getComputedStyle(el).fontFamily)).toBe(chineseFont);
    }
  }
  await expect(page.locator('.field.name')).toContainText('姓名：');
  await expect(page.locator('.answer-label')).toHaveText('答：');
  await expect(page.locator('.answer-box').first()).toHaveText('（　）');
  await page.goto('/papers/sample-math/');
  await expect(page.locator('.stem:lang(en)')).toHaveCount(0);
  expect(await page.locator('.stem').first().evaluate(el => getComputedStyle(el).fontFamily)).toBe(chineseFont);
});

for (const surface of ['paper', 'bank'] as const) {
  test(`${surface} 的英文 W／M 答案完整落在底線內，答案切換不改變空格`, async ({ page }) => {
    await page.goto(surface === 'paper' ? '/papers/sample-english/' : '/bank/?subject=英語');
    const question = surface === 'paper' ? page.locator('.question-fill-blank') : page.locator('details[data-id="sample-english-01"]');
    if (surface === 'bank') await question.locator('summary').click();
    await page.evaluate(() => document.fonts.ready);
    const blanks = question.locator('.blank');
    const before = await blanks.evaluateAll(elements => elements.map(el => el.getBoundingClientRect().width));
    if (surface === 'paper') await answerToggle(page).click();
    await expect(question.locator('.blank-answer')).toHaveText(['WWWWWWWW', 'MMMMMMMM']);
    for (const answer of await question.locator('.blank-answer').all()) {
      const bounds = await answer.evaluate(el => {
        const range = document.createRange();
        range.selectNodeContents(el);
        const text = range.getBoundingClientRect();
        const blank = el.parentElement!.getBoundingClientRect();
        return { left: text.left, right: text.right, blankLeft: blank.left, blankRight: blank.right };
      });
      expect(bounds.left).toBeGreaterThanOrEqual(bounds.blankLeft - 0.1);
      expect(bounds.right).toBeLessThanOrEqual(bounds.blankRight + 0.1);
    }
    expect(await blanks.evaluateAll(elements => elements.map(el => el.getBoundingClientRect().width))).toEqual(before);
  });
}

test('題庫篩選與首頁包含英語，題庫內容有英文標示及中文注音', async ({ page }) => {
  await page.goto('/bank/?subject=英語');
  await expect(page.locator('.bank-item:visible')).toHaveCount(5);
  const item = page.locator('details[data-id="sample-english-02"]');
  await item.locator('summary').click();
  await expect(item.locator('.stem:lang(en)')).toHaveCount(1);
  await expect(item.locator('.material-paragraph:lang(en)')).toHaveCount(1);
  await expect(item.locator('ruby')).toHaveCount(2);
  expect(await item.locator('.options').evaluate(el => getComputedStyle(el).fontFamily)).toMatch(/^Arial/);
  expect(await item.locator('.item-head').evaluate(el => el.matches(':lang(zh)'))).toBe(true);
  await page.goto('/');
  const english = page.locator('#composition .mix-subject[data-subject="英語"]');
  await expect(english).toContainText('5 題');
  await expect(english.locator('.mix-bar span').first()).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
});

for (const mode of ['paper', 'answer'] as const) {
  test(`英語 ${mode} 輸出 A4 PDF，答案與解析顯隱正確`, async ({ page }, testInfo) => {
    await page.goto('/papers/sample-english/');
    if (mode === 'answer') await answerToggle(page).click();
    await page.evaluate(() => document.fonts.ready);
    await page.emulateMedia({ media: 'print' });
    await expect(page.locator('.explanation:visible')).toHaveCount(mode === 'answer' ? 5 : 0);
    await expect(page.locator('.blank-answer:visible')).toHaveCount(mode === 'answer' ? 2 : 0);
    const pdf = await page.pdf({ path: testInfo.outputPath(`${mode}.pdf`), preferCSSPageSize: true });
    const pages = [...pdf.toString('latin1').matchAll(/\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/g)];
    expect(pages.length).toBeGreaterThan(0);
    for (const [, width, height] of pages) {
      expect(Math.abs(Number(width) - 595)).toBeLessThan(1);
      expect(Math.abs(Number(height) - 842)).toBeLessThan(1);
    }
  });
}

for (const surface of ['paper', 'bank'] as const) {
  test(`${surface} 分類題括號與兩種自製注音保留中文，答案代號仍是英文`, async ({ page }) => {
    await page.goto(`${FIXTURE_URL}/${surface === 'paper' ? 'papers/english-labels/' : 'bank/'}`);
    if (surface === 'bank') {
      for (const id of ['english-labels-01', 'english-labels-02', 'english-labels-03']) {
        await page.locator(`details[data-id="${id}"] summary`).click();
      }
    } else await answerToggle(page).click();
    const classification = surface === 'paper' ? page.locator('.question-classification') : page.locator('details[data-id="english-labels-01"]');
    const slot = classification.locator('.classification-slot');
    const punctuation = slot.locator(':scope > [lang|="zh"]');
    await expect(punctuation).toHaveText(['（', '）']);
    for (const node of await punctuation.all()) {
      expect(await node.evaluate(el => getComputedStyle(el).fontFamily)).not.toMatch(/^Arial/);
    }
    await expect(slot.locator('.answer:lang(en)')).toHaveText('A');
    for (const selector of ['.question-char-to-zhuyin .target-char', '.question-char-to-zhuyin .cell-answer', '.question-zhuyin-to-char ruby']) {
      const el = surface === 'paper' ? page.locator(selector) : page.locator(`details[data-id^="english-labels-"] ${selector}`);
      await expect(el).toHaveCount(1);
      expect(await el.evaluate(el => el.matches(':lang(zh)'))).toBe(true);
      expect(await el.evaluate(el => getComputedStyle(el).fontFamily)).not.toMatch(/^Arial/);
    }
  });
}
