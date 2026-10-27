import { expect, test, type Locator, type Page } from '@playwright/test';
import { answerToggle, expectedAnswerColor } from './helpers';

const PAPER = '/papers/sample-chinese/';

// 範例試卷 sample-chinese：1–3 選擇、4–5 是非、6–7 填空、8–9 國字注音、10–11 注音寫國字、12–13 造句、14–15 照樣造句
const QUESTION_COUNT = 15;

const box = async (locator: Locator) => (await locator.boundingBox())!;

/** 元素內第一個文字節點（被 ruby 標注的字）的範圍位置 */
const baseTextBox = (ruby: Locator) =>
  ruby.evaluate((el) => {
    const range = document.createRange();
    range.selectNode(el.firstChild!);
    const { x, y, width, height } = range.getBoundingClientRect();
    return { x, y, width, height };
  });

const within = (inner: { x: number; width: number }, outer: { x: number; width: number }) => {
  expect(inner.x).toBeGreaterThanOrEqual(outer.x - 1);
  expect(inner.x + inner.width).toBeLessThanOrEqual(outer.x + outer.width + 1);
};

/**
 * 一組元素的大小，以及相對於所屬題目左上角的位置，用來比對切換前後版面沒有移動。
 * 不用頁面座標：答案卷的解析會把後面的題目往下推，題目內部的版面才是不能動的。
 */
const rects = (locator: Locator) =>
  locator.evaluateAll((els) =>
    els.map((el) => {
      const origin = el.closest('.question')!.getBoundingClientRect();
      const { x, y, width, height } = el.getBoundingClientRect();
      return { x: x - origin.x, y: y - origin.y, width, height };
    }),
  );

const expectSameRects = (after: Awaited<ReturnType<typeof rects>>, before: typeof after) => {
  expect(after.length).toBe(before.length);
  after.forEach((r, i) => {
    for (const key of ['x', 'y', 'width', 'height'] as const) {
      expect(Math.abs(r[key] - before[i]![key])).toBeLessThanOrEqual(1);
    }
  });
};

const innerText = (locator: Locator) => locator.evaluate((el) => (el as HTMLElement).innerText);

async function expectAnswerStyle(page: Page, answers: Locator) {
  const colors = await answers.evaluateAll((els) => els.map((el) => getComputedStyle(el).color));
  expect(new Set(colors)).toEqual(new Set([await expectedAnswerColor(page)]));
}

test.beforeEach(async ({ page }) => {
  await page.goto(PAPER);
});

test.describe('注音 ruby', () => {
  test('一般注音標注渲染成 ruby/rt，注音在字的上方', async ({ page }) => {
    // 第 2 題題幹：[輕輕|ㄑㄧㄥ ㄑㄧㄥ]，每個字一個 ruby
    const rubies = page.locator('.question-choice').nth(1).locator('.stem ruby');
    await expect(rubies).toHaveCount(2);
    await expect(rubies.locator('rt')).toHaveText(['ㄑㄧㄥ', 'ㄑㄧㄥ']);
    for (let i = 0; i < 2; i++) {
      const base = await baseTextBox(rubies.nth(i));
      const rt = await box(rubies.nth(i).locator('rt'));
      expect(base.height).toBeGreaterThan(0);
      expect(rt.y).toBeLessThan(base.y);
      // 注音整個在字的上半部以上（字的範圍含行距，所以不要求貼齊字的頂端）
      expect(rt.y + rt.height).toBeLessThanOrEqual(base.y + base.height / 2);
    }
    // 橫排：兩個字在同一列、由左到右
    const first = await baseTextBox(rubies.nth(0));
    const second = await baseTextBox(rubies.nth(1));
    expect(second.x).toBeGreaterThan(first.x);
    expect(Math.abs(second.y - first.y)).toBeLessThanOrEqual(1);
  });

  test('ruby 帶有 rp 括號，畫面上不可見', async ({ page }) => {
    // 一般標注（第 2 題）與注音寫國字（第 10 題）都有；rp 只在不支援 ruby 或複製文字時才用到
    for (const q of [page.locator('.question-choice').nth(1), page.locator('.question-zhuyin-to-char').first()]) {
      const rubies = q.locator('ruby');
      const count = await rubies.count();
      await expect(q.locator('rp')).toHaveCount(count * 2);
      await expect(rubies.first().locator('rp').first()).toHaveText('(');
      await expect(rubies.first().locator('rp').last()).toHaveText(')');
      await expect(q.locator('rp:visible')).toHaveCount(0);
      expect(await innerText(q.locator('.stem'))).not.toMatch(/[()]/);
    }
  });

  test('注音標注的原始語法不會出現在頁面上', async ({ page }) => {
    const text = await innerText(page.locator('main'));
    expect(text).not.toMatch(/\[[^\]]*\|[^\]]*\]/);
  });

  test('填空題與造句答案中的標注也渲染成 ruby', async ({ page }) => {
    await expect(page.locator('.question-make-sentence').nth(1).locator('.sentence-answer ruby')).toHaveCount(2);
  });
});

test.describe('國字注音', () => {
  const questions = (page: Page) => page.locator('.question-char-to-zhuyin');

  test('試卷：被考的字加強調，旁邊有作答格，作答格內看不到注音', async ({ page }) => {
    await expect(questions(page)).toHaveCount(2);
    const first = questions(page).first();
    await expect(first.locator('.number')).toHaveText('8.');
    await expect(first.locator('.target-char')).toHaveText(['公園', '花']);
    const decorations = await first
      .locator('.target-char')
      .evaluateAll((els) => els.map((el) => getComputedStyle(el).textDecorationLine));
    expect(new Set(decorations)).toEqual(new Set(['underline']));

    await expect(first.locator('.zhuyin-cell')).toHaveCount(2);
    await expect(first.locator('ruby')).toHaveCount(0);
    await expect(first.locator('.cell-answer')).toHaveCount(2);
    await expect(first.locator('.cell-answer:visible')).toHaveCount(0);
    const text = await innerText(first.locator('.stem'));
    expect(text).toContain('公園');
    expect(text).not.toMatch(/[ㄅ-ㄩ]/);
    await expect(first.locator('.explanation')).toBeHidden();
  });

  test('作答格寬度依注音組數：兩組比一組寬，緊接在被考的字之後', async ({ page }) => {
    const first = questions(page).first();
    const [two, one] = await rects(first.locator('.zhuyin-cell'));
    expect(two!.width).toBeGreaterThan(one!.width + 1);
    const target = await box(first.locator('.target-char').first());
    const cell = await box(first.locator('.zhuyin-cell').first());
    expect(cell.x).toBeGreaterThanOrEqual(target.x + target.width - 1);
    expect(cell.x - (target.x + target.width)).toBeLessThan(20);
    // 三組的作答格比兩組寬
    const [three] = await rects(questions(page).nth(1).locator('.zhuyin-cell'));
    expect(three!.width).toBeGreaterThan(two!.width + 1);
  });

  test('答案卷：作答格內是正確注音，以 --answer-color 顯示在格內，解析可見', async ({ page }) => {
    await answerToggle(page).click();
    const expected = [
      ['ㄍㄨㄥ ㄩㄢˊ', 'ㄏㄨㄚ'],
      ['ㄊㄨˊ ㄕㄨ ㄍㄨㄢˇ'],
    ];
    for (const [i, answers] of expected.entries()) {
      const q = questions(page).nth(i);
      await expect(q.locator('.cell-answer')).toHaveText(answers);
      await expect(q.locator('.cell-answer:visible')).toHaveCount(answers.length);
      await expectAnswerStyle(page, q.locator('.cell-answer'));
      for (let c = 0; c < answers.length; c++) {
        within(await box(q.locator('.cell-answer').nth(c)), await box(q.locator('.zhuyin-cell').nth(c)));
      }
      await expect(q.locator('.explanation')).toBeVisible();
      await expect(q.locator('.explanation')).toContainText('解析：');
    }
  });

  test('切換前後作答格與被考的字位置、大小不變', async ({ page }) => {
    const selector = '.question-char-to-zhuyin :is(.zhuyin-cell, .target-char)';
    const before = await rects(page.locator(selector));
    await answerToggle(page).click();
    expectSameRects(await rects(page.locator(selector)), before);
  });
});

test.describe('注音寫國字', () => {
  const questions = (page: Page) => page.locator('.question-zhuyin-to-char');

  test('試卷：注音以 ruby 顯示在作答格上方，作答格內看不到國字', async ({ page }) => {
    await expect(questions(page)).toHaveCount(2);
    const first = questions(page).first();
    await expect(first.locator('.number')).toHaveText('10.');
    // 爸爸、公園共四個字，每字一格、一個 ruby
    await expect(first.locator('ruby')).toHaveCount(4);
    await expect(first.locator('.char-cell')).toHaveCount(4);
    await expect(first.locator('rt')).toHaveText(['ㄅㄚˋ', '˙ㄅㄚ', 'ㄍㄨㄥ', 'ㄩㄢˊ']);
    for (let i = 0; i < 4; i++) {
      const cell = await box(first.locator('.char-cell').nth(i));
      const rt = await box(first.locator('rt').nth(i));
      expect(rt.y).toBeLessThan(cell.y);
      expect(rt.y + rt.height).toBeLessThanOrEqual(cell.y + 1);
    }
    await expect(first.locator('.cell-answer:visible')).toHaveCount(0);
    const text = await innerText(first.locator('.stem'));
    expect(text).not.toMatch(/爸|公|園/);
    expect(text).toContain('星期天');
    await expect(first.locator('.explanation')).toBeHidden();
  });

  test('答案卷：作答格內是正確國字，以 --answer-color 顯示在格內，解析可見', async ({ page }) => {
    await answerToggle(page).click();
    const expected = [['爸', '爸', '公', '園'], ['蘋', '果']];
    for (const [i, answers] of expected.entries()) {
      const q = questions(page).nth(i);
      await expect(q.locator('.cell-answer')).toHaveText(answers);
      await expect(q.locator('.cell-answer:visible')).toHaveCount(answers.length);
      await expectAnswerStyle(page, q.locator('.cell-answer'));
      for (let c = 0; c < answers.length; c++) {
        within(await box(q.locator('.cell-answer').nth(c)), await box(q.locator('.char-cell').nth(c)));
      }
      await expect(q.locator('.explanation')).toBeVisible();
    }
  });

  test('切換前後作答格與注音位置、大小不變', async ({ page }) => {
    const selector = '.question-zhuyin-to-char :is(.char-cell, rt)';
    const before = await rects(page.locator(selector));
    await answerToggle(page).click();
    expectSameRects(await rects(page.locator(selector)), before);
  });
});

test.describe('造句與照樣造句', () => {
  const make = (page: Page) => page.locator('.question-make-sentence');
  const imitate = (page: Page) => page.locator('.question-imitate-sentence');

  test('造句：題號、題幹與兩行作答行，範例句子不可見', async ({ page }) => {
    await expect(make(page)).toHaveCount(2);
    const first = make(page).first();
    await expect(first.locator('.number')).toHaveText('12.');
    await expect(first.locator('.stem')).toContainText('用「雖然……但是……」造句。');
    await expect(first.locator('.sentence-line')).toHaveCount(2);
    const lines = await rects(first.locator('.sentence-line'));
    expect(lines[1]!.y).toBeGreaterThan(lines[0]!.y + 10);
    const borders = await first
      .locator('.sentence-line')
      .evaluateAll((els) => els.map((el) => getComputedStyle(el).borderBottomStyle));
    expect(new Set(borders)).toEqual(new Set(['solid']));
    await expect(first.locator('.sentence-answer')).toBeHidden();
    await expect(first.locator('.explanation')).toBeHidden();
    expect(await innerText(first)).not.toContain('準時到校');
  });

  test('照樣造句：另起一行顯示例句，同樣有兩行作答行，範例句子不可見', async ({ page }) => {
    await expect(imitate(page)).toHaveCount(2);
    const first = imitate(page).first();
    await expect(first.locator('.number')).toHaveText('14.');
    await expect(first.locator('.example')).toBeVisible();
    await expect(first.locator('.example')).toContainText('例句：月亮像一個大銀盤掛在天上。');
    const stem = await box(first.locator('.stem'));
    const example = await box(first.locator('.example'));
    expect(example.y).toBeGreaterThanOrEqual(stem.y + stem.height - 1);
    await expect(first.locator('.sentence-line')).toHaveCount(2);
    const lines = await box(first.locator('.sentence-lines'));
    expect(lines.y).toBeGreaterThanOrEqual(example.y + example.height - 1);
    await expect(first.locator('.sentence-answer')).toBeHidden();
    expect(await innerText(first)).not.toContain('太陽像一顆大火球');
  });

  test('造句與照樣造句的作答行數與寬度一致', async ({ page }) => {
    const all = await rects(page.locator('.sentence-lines'));
    expect(all).toHaveLength(4);
    for (const r of all) {
      expect(Math.abs(r.width - all[0]!.width)).toBeLessThanOrEqual(1);
      expect(Math.abs(r.height - all[0]!.height)).toBeLessThanOrEqual(1);
    }
  });

  test('答案卷：範例句子以 --answer-color 顯示在作答行上，解析可見', async ({ page }) => {
    await answerToggle(page).click();
    const expected = [
      [make(page).nth(0), '雖然今天下大雨，但是我還是準時到校。'],
      [make(page).nth(1), '妹妹一邊唱歌，一邊洗手。'],
      [imitate(page).nth(0), '太陽像一顆大火球掛在天上。'],
      [imitate(page).nth(1), '小狗在草地上開心地奔跑。'],
    ] as const;
    for (const [q, sentence] of expected) {
      const answer = q.locator('.sentence-answer');
      await expect(answer).toBeVisible();
      // 含 ruby 時 textContent 會夾帶注音與括號，比對前先去掉 rt、rp
      const text = await answer.evaluate((el) => {
        const copy = el.cloneNode(true) as HTMLElement;
        copy.querySelectorAll('rt, rp').forEach((el) => el.remove());
        return copy.textContent;
      });
      expect(text).toBe(sentence);
      await expectAnswerStyle(page, answer);
      const lines = await box(q.locator('.sentence-lines'));
      const rendered = await box(answer);
      within(rendered, lines);
      expect(rendered.y).toBeGreaterThanOrEqual(lines.y - 1);
      expect(rendered.y + rendered.height).toBeLessThanOrEqual(lines.y + lines.height + 1);
      await expect(q.locator('.explanation')).toBeVisible();
    }
  });

  test('切換前後作答行位置、大小不變', async ({ page }) => {
    const selector = ':is(.question-make-sentence, .question-imitate-sentence) :is(.sentence-lines, .sentence-line, .example)';
    const before = await rects(page.locator(selector));
    await answerToggle(page).click();
    expectSameRects(await rects(page.locator(selector)), before);
  });
});

test.describe('國語卷整體', () => {
  test('試卷：沒有答案與解析可見，共 15 題', async ({ page }) => {
    await expect(page.locator('.question')).toHaveCount(QUESTION_COUNT);
    await expect(page.locator('.cell-answer:visible, .sentence-answer:visible, .answer:visible')).toHaveCount(0);
    await expect(page.locator('.explanation:visible')).toHaveCount(0);
  });

  test('答案卷：每題都有解析', async ({ page }) => {
    await answerToggle(page).click();
    await expect(page.locator('.explanation:visible')).toHaveCount(QUESTION_COUNT);
  });

  test('切換前後所有題幹在題目內的位置與大小不變', async ({ page }) => {
    const before = await rects(page.locator('.question .stem'));
    await answerToggle(page).click();
    expectSameRects(await rects(page.locator('.question .stem')), before);
  });

  test('列印答案卷時作答格與作答行的答案也在', async ({ page }) => {
    await answerToggle(page).click();
    await page.emulateMedia({ media: 'print' });
    await expect(page.locator('.cell-answer:visible')).toHaveCount(2 + 1 + 4 + 2);
    await expect(page.locator('.sentence-answer:visible')).toHaveCount(4);
  });
});
