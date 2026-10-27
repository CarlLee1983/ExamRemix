import { expect, test, type Page } from '@playwright/test';
import { expectedAnswerColor } from './helpers';

const PAPER = '/papers/sample-math/';
// 範例試卷 sample-chinese 沒有引用有疑點的題目
const PAPER_WITHOUT_DOUBT = '/papers/sample-chinese/';
// 範例試卷 sample-math 的各題型題數
const CHOICE_COUNT = 21;
const TRUE_FALSE_COUNT = 3;
const FILL_BLANK_COUNT = 3;
const MATH_COUNT = 3 + 4 + 5; // 橫式計算、直式計算、應用題
const QUESTION_COUNT = CHOICE_COUNT + TRUE_FALSE_COUNT + FILL_BLANK_COUNT + MATH_COUNT;
// 有作答括號的題數（選擇題與是非題）；填空題的答案另有 .blank-answer
const BRACKET_COUNT = CHOICE_COUNT + TRUE_FALSE_COUNT;

test.describe('試卷頁', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(PAPER);
  });

  test('固定頁首有標題、姓名、日期、分數欄', async ({ page }) => {
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('三年級數學試卷（範例）');
    for (const [field, label] of [
      ['name', '姓名'],
      ['date', '日期'],
      ['score', '分數'],
    ] as const) {
      const el = page.locator(`[data-field="${field}"]`);
      await expect(el).toContainText(label);
      await expect(el.locator('.line')).toBeVisible();
    }
  });

  test('大題標題與選填配分', async ({ page }) => {
    const titles = page.locator('.section-title');
    await expect(titles).toHaveCount(9);
    await expect(titles.nth(0)).toContainText('一、計算選擇題');
    await expect(titles.nth(0).locator('.points')).toHaveText('（40 分）');
    // 第二個大題沒有配分
    await expect(titles.nth(1)).toContainText('二、減法選擇題');
    await expect(titles.nth(1).locator('.points')).toHaveCount(0);
  });

  test('選擇題有作答括號、連續題號、題幹與選項', async ({ page }) => {
    const questions = page.locator('.question-choice');
    await expect(questions).toHaveCount(CHOICE_COUNT);

    const first = questions.first();
    await expect(first.locator('.answer-box')).toHaveText('（　）');
    await expect(first.locator('.number')).toHaveText('1.');
    await expect(first.locator('.stem')).toContainText('3 × 4 等於多少？');
    await expect(first.locator('.option')).toHaveCount(4);
    await expect(first.locator('.option').first()).toContainText('(1) 10');

    // 題號跨大題連續：第二個大題的第一題是 11
    await expect(questions.nth(10).locator('.number')).toHaveText('11.');
    await expect(questions.last().locator('.number')).toHaveText(`${CHOICE_COUNT}.`);
  });

  test('每題 break-inside 為 avoid', async ({ page }) => {
    const values = await page
      .locator('.question')
      .evaluateAll((els) => els.map((el) => getComputedStyle(el).breakInside));
    expect(values.length).toBe(QUESTION_COUNT);
    expect(new Set(values)).toEqual(new Set(['avoid']));
  });

  test('列印為 A4，至少兩頁', async ({ page }) => {
    const pdf = await page.pdf({ preferCSSPageSize: true });
    // Chromium 產出的 PDF 其頁面字典與 MediaBox 是未壓縮的純文字，不需要額外的 PDF 解析套件
    const text = pdf.toString('latin1');
    const pageCount = [...text.matchAll(/\/Type\s*\/Page[^s]/g)].length;
    expect(pageCount).toBeGreaterThanOrEqual(2);

    const boxes = [...text.matchAll(/\/MediaBox\s*\[([^\]]+)\]/g)].map((m) =>
      m[1]!.trim().split(/\s+/).map(Number),
    );
    expect(boxes.length).toBe(pageCount);
    for (const [, , width, height] of boxes) {
      // A4 = 595.28 x 841.89 pt
      expect(width).toBeCloseTo(595.28, 0);
      expect(height).toBeCloseTo(841.89, 0);
    }
  });
});

test.describe('疑點提示', () => {
  const notice = (page: Page) => page.locator('.doubt-notice');

  test('引用有疑點題目的試卷頁頂端提示題數與題號', async ({ page }) => {
    await page.goto(PAPER);
    await expect(notice(page)).toBeVisible();
    await expect(notice(page)).toContainText('這份試卷有 1 題有疑點');
    await expect(notice(page)).toContainText('第 2 題');
  });

  test('列印時隱藏疑點提示', async ({ page }) => {
    await page.goto(PAPER);
    await page.emulateMedia({ media: 'print' });
    await expect(notice(page)).toBeHidden();
  });

  test('沒有疑點的試卷不顯示提示', async ({ page }) => {
    await page.goto(PAPER_WITHOUT_DOUBT);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(notice(page)).toHaveCount(0);
  });
});

test.describe('答案卷切換', () => {
  // 範例資料已知：第 1 題答案 2、第 7 題答案 3、第 11 題答案 1
  const known = [
    { index: 0, answer: '2', explanation: '3 × 4 = 12。' },
    { index: 6, answer: '3', explanation: '48 + 27 = 75。' },
    { index: 10, answer: '1', explanation: '91 − 36 = 55。' },
  ];

  test.beforeEach(async ({ page }) => {
    await page.goto(PAPER);
  });

  const toggle = (page: Page) => page.getByRole('button', { name: '顯示答案卷' });

  test('載入時是試卷：切換鈕未按下，答案與解析不可見', async ({ page }) => {
    await expect(toggle(page)).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('.answer:visible')).toHaveCount(0);
    await expect(page.locator('.explanation:visible')).toHaveCount(0);
  });

  test('切換鈕按下後外觀改變，看得出目前是答案卷', async ({ page }) => {
    const look = () =>
      toggle(page).evaluate((el) => {
        const s = getComputedStyle(el);
        return `${s.backgroundColor} ${s.color}`;
      });
    const before = await look();
    await toggle(page).click();
    expect(await look()).not.toBe(before);
    await toggle(page).click();
    expect(await look()).toBe(before);
  });

  test('切換成答案卷：答案填在作答括號，解析在題目下方', async ({ page }) => {
    await toggle(page).click();
    await expect(toggle(page)).toHaveAttribute('aria-pressed', 'true');

    const questions = page.locator('.question-choice');
    await expect(page.locator('.answer:visible')).toHaveCount(BRACKET_COUNT);
    await expect(page.locator('.explanation:visible')).toHaveCount(QUESTION_COUNT);

    for (const { index, answer, explanation } of known) {
      const q = questions.nth(index);
      await expect(q.locator('.answer')).toHaveText(answer);
      // 答案以 --answer-color 標示
      const answerColor = await q.locator('.answer').evaluate((el) => getComputedStyle(el).color);
      expect(answerColor).toBe(await expectedAnswerColor(page));
      await expect(q.locator('.explanation')).toContainText('解析：');
      await expect(q.locator('.explanation')).toContainText(explanation);

      // 答案落在作答括號的範圍內，解析在選項下方
      const box = (await q.locator('.answer-box').boundingBox())!;
      const ans = (await q.locator('.answer').boundingBox())!;
      expect(ans.x).toBeGreaterThanOrEqual(box.x - 1);
      expect(ans.x + ans.width).toBeLessThanOrEqual(box.x + box.width + 1);
      const options = (await q.locator('.options').boundingBox())!;
      const exp = (await q.locator('.explanation').boundingBox())!;
      expect(exp.y).toBeGreaterThanOrEqual(options.y + options.height - 1);
    }
  });

  test('再切換一次回到試卷', async ({ page }) => {
    await toggle(page).click();
    await toggle(page).click();
    await expect(toggle(page)).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('.answer:visible')).toHaveCount(0);
    await expect(page.locator('.explanation:visible')).toHaveCount(0);
  });

  for (const media of ['screen', 'print'] as const) {
    test(`切換前後題號、題目順序與作答括號、題幹位置不變（${media}）`, async ({ page }) => {
      const snapshot = async () => {
        await page.emulateMedia({ media });
        const numbers = await page.locator('.question .number').allTextContents();
        const stems = await page.locator('.question .stem').allTextContents();
        const boxes = await page.locator('.question:has(.answer-box)').evaluateAll((els) =>
          els.map((el) => {
            const rect = (selector: string) => el.querySelector(selector)!.getBoundingClientRect();
            return { boxWidth: rect('.answer-box').width, stemX: rect('.stem').x, numberX: rect('.number').x };
          }),
        );
        return { numbers, stems: stems.map((s) => s.replace(/\s+/g, ' ')), boxes };
      };

      const before = await snapshot();
      // 列印媒體下切換鈕隱藏，切換要在螢幕媒體下做
      await page.emulateMedia({ media: 'screen' });
      await toggle(page).click();
      const after = await snapshot();

      expect(after.numbers).toEqual(before.numbers);
      expect(after.stems).toEqual(before.stems);
      expect(after.boxes.length).toBe(BRACKET_COUNT);
      after.boxes.forEach((b, i) => {
        expect(Math.abs(b.boxWidth - before.boxes[i]!.boxWidth)).toBeLessThanOrEqual(1);
        expect(Math.abs(b.stemX - before.boxes[i]!.stemX)).toBeLessThanOrEqual(1);
        expect(Math.abs(b.numberX - before.boxes[i]!.numberX)).toBeLessThanOrEqual(1);
      });
    });
  }

  test('列印：未切換時不含答案與解析，且隱藏切換鈕', async ({ page }) => {
    await page.emulateMedia({ media: 'print' });
    await expect(toggle(page)).toBeHidden();
    await expect(page.locator('.answer:visible')).toHaveCount(0);
    await expect(page.locator('.explanation:visible')).toHaveCount(0);
  });

  test('列印：切換成答案卷後含答案與解析，仍隱藏切換鈕', async ({ page }) => {
    await toggle(page).click();
    await page.emulateMedia({ media: 'print' });
    await expect(toggle(page)).toBeHidden();
    await expect(page.locator('.answer:visible')).toHaveCount(BRACKET_COUNT);
    await expect(page.locator('.explanation:visible')).toHaveCount(QUESTION_COUNT);
    // 解析與題目同一區塊，題目仍不可切斷
    const values = await page
      .locator('.question')
      .evaluateAll((els) => els.map((el) => getComputedStyle(el).breakInside));
    expect(new Set(values)).toEqual(new Set(['avoid']));
    await expect(page.locator('.question .explanation').first()).toBeVisible();
  });
});

test.describe('是非題', () => {
  // 範例資料已知：sample-math-23 答案是、24 答案非、25 答案是
  const known = [
    { index: 0, mark: '○' },
    { index: 1, mark: '✕' },
    { index: 2, mark: '○' },
  ];
  const toggle = (page: Page) => page.getByRole('button', { name: '顯示答案卷' });

  test.beforeEach(async ({ page }) => {
    await page.goto(PAPER);
  });

  test('試卷：有作答括號與題號，括號寬度與選擇題一致，答案不可見', async ({ page }) => {
    const questions = page.locator('.question-true-false');
    await expect(questions).toHaveCount(TRUE_FALSE_COUNT);
    const first = questions.first();
    await expect(first.locator('.answer-box')).toHaveText('（　）');
    await expect(first.locator('.number')).toHaveText(`${CHOICE_COUNT + 1}.`);
    await expect(first.locator('.stem')).toContainText('7 × 8 = 56');
    await expect(first.locator('.answer')).toBeHidden();
    await expect(first.locator('.explanation')).toBeHidden();

    const choiceBox = (await page.locator('.question-choice .answer-box').first().boundingBox())!;
    const tfBox = (await first.locator('.answer-box').boundingBox())!;
    expect(Math.abs(tfBox.width - choiceBox.width)).toBeLessThanOrEqual(1);
  });

  test('答案卷：括號內是 ○ 或 ✕，括號寬度不變，解析可見', async ({ page }) => {
    const questions = page.locator('.question-true-false');
    const widthsBefore = await questions
      .locator('.answer-box')
      .evaluateAll((els) => els.map((el) => el.getBoundingClientRect().width));
    await toggle(page).click();

    for (const { index, mark } of known) {
      const q = questions.nth(index);
      await expect(q.locator('.answer')).toBeVisible();
      await expect(q.locator('.answer')).toHaveText(mark);
      const answerColor = await q.locator('.answer').evaluate((el) => getComputedStyle(el).color);
      expect(answerColor).toBe(await expectedAnswerColor(page));
      const box = (await q.locator('.answer-box').boundingBox())!;
      const ans = (await q.locator('.answer').boundingBox())!;
      expect(ans.x).toBeGreaterThanOrEqual(box.x - 1);
      expect(ans.x + ans.width).toBeLessThanOrEqual(box.x + box.width + 1);
      await expect(q.locator('.explanation')).toBeVisible();
      await expect(q.locator('.explanation')).toContainText('解析：');
    }

    const widthsAfter = await questions
      .locator('.answer-box')
      .evaluateAll((els) => els.map((el) => el.getBoundingClientRect().width));
    widthsAfter.forEach((w, i) => expect(Math.abs(w - widthsBefore[i]!)).toBeLessThanOrEqual(1));
  });
});

test.describe('填空題', () => {
  // 範例資料已知：sample-math-26 兩個空格（7、14）、27 兩個空格（300、1000）、28 一個空格（40）
  const known = [
    { index: 0, answers: ['7', '14'] },
    { index: 1, answers: ['300', '1000'] },
    { index: 2, answers: ['40'] },
  ];
  const toggle = (page: Page) => page.getByRole('button', { name: '顯示答案卷' });
  const blankWidths = (page: Page) =>
    page
      .locator('.question-fill-blank .blank')
      .evaluateAll((els) => els.map((el) => el.getBoundingClientRect().width));

  test.beforeEach(async ({ page }) => {
    await page.goto(PAPER);
  });

  test('試卷：空格是底線，題幹不出現 ___，答案與解析不可見', async ({ page }) => {
    const questions = page.locator('.question-fill-blank');
    await expect(questions).toHaveCount(FILL_BLANK_COUNT);
    await expect(questions.first().locator('.number')).toHaveText(`${CHOICE_COUNT + TRUE_FALSE_COUNT + 1}.`);

    for (const { index, answers } of known) {
      const q = questions.nth(index);
      await expect(q.locator('.stem')).not.toContainText('___');
      await expect(q.locator('.blank')).toHaveCount(answers.length);
      const borders = await q
        .locator('.blank')
        .evaluateAll((els) => els.map((el) => getComputedStyle(el).borderBottomStyle));
      expect(new Set(borders)).toEqual(new Set(['solid']));
    }
    await expect(page.locator('.blank-answer:visible')).toHaveCount(0);
    await expect(page.locator('.question-fill-blank .explanation:visible')).toHaveCount(0);
  });

  test('試卷：答案較長的空格比較寬', async ({ page }) => {
    // 第 2 題：答案 300（3 字）與 1000（4 字）
    const [short, long] = await page
      .locator('.question-fill-blank')
      .nth(1)
      .locator('.blank')
      .evaluateAll((els) => els.map((el) => el.getBoundingClientRect().width));
    expect(long!).toBeGreaterThan(short! + 1);
    // 第 1 題：答案 7（1 字）與 14（2 字）
    const [one, two] = await page
      .locator('.question-fill-blank')
      .first()
      .locator('.blank')
      .evaluateAll((els) => els.map((el) => el.getBoundingClientRect().width));
    expect(two!).toBeGreaterThan(one! + 1);
  });

  test('答案卷：各空格顯示正確答案，底線寬度不變，解析可見', async ({ page }) => {
    const before = await blankWidths(page);
    await toggle(page).click();
    const after = await blankWidths(page);
    expect(after.length).toBe(before.length);
    after.forEach((w, i) => expect(Math.abs(w - before[i]!)).toBeLessThanOrEqual(1));

    const questions = page.locator('.question-fill-blank');
    for (const { index, answers } of known) {
      const q = questions.nth(index);
      await expect(q.locator('.blank-answer')).toHaveText(answers);
      await expect(q.locator('.blank-answer:visible')).toHaveCount(answers.length);
      const colors = await q
        .locator('.blank-answer')
        .evaluateAll((els) => els.map((el) => getComputedStyle(el).color));
      expect(new Set(colors)).toEqual(new Set([await expectedAnswerColor(page)]));
      // 答案落在各自底線的範圍內
      for (let i = 0; i < answers.length; i++) {
        const blank = (await q.locator('.blank').nth(i).boundingBox())!;
        const ans = (await q.locator('.blank-answer').nth(i).boundingBox())!;
        expect(ans.x).toBeGreaterThanOrEqual(blank.x - 1);
        expect(ans.x + ans.width).toBeLessThanOrEqual(blank.x + blank.width + 1);
      }
      await expect(q.locator('.explanation')).toBeVisible();
    }
  });

  test('切換前後題幹的版面位置不變', async ({ page }) => {
    const positions = () =>
      page
        .locator('.question-fill-blank .stem')
        .evaluateAll((els) => els.map((el) => el.getBoundingClientRect().height));
    const before = await positions();
    await toggle(page).click();
    const after = await positions();
    after.forEach((h, i) => expect(Math.abs(h - before[i]!)).toBeLessThanOrEqual(1));
  });
});

test.describe('沒有 JavaScript', () => {
  test.use({ javaScriptEnabled: false });

  test('不顯示切換鈕，答案與解析也不可見', async ({ page }) => {
    await page.goto(PAPER);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByRole('button', { name: '顯示答案卷' })).toBeHidden();
    await expect(page.locator('.answer:visible')).toHaveCount(0);
    await expect(page.locator('.explanation:visible')).toHaveCount(0);
  });
});
