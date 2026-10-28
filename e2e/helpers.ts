import { expect, type Page } from '@playwright/test';

/** --answer-color 解析後的實際計算色：用暫時元素套 color: var(--answer-color) 取得 */
export const expectedAnswerColor = (page: Page) =>
  page.evaluate(() => {
    const probe = document.createElement('span');
    probe.style.color = 'var(--answer-color)';
    document.body.append(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    return color;
  });

/** 切換成答案卷的按鈕 */
export const answerToggle = (page: Page) => page.getByRole('button', { name: '顯示答案卷' });

/** 以腳本取代 navigator.clipboard（fail 時 writeText 一律 reject），把寫入的文字記在 window.__copied（避免依賴瀏覽器的剪貼簿權限） */
export const stubClipboard = (page: Page, options: { fail?: boolean } = {}) =>
  page.addInitScript((fail) => {
    const copied: string[] = [];
    Object.assign(window, { __copied: copied });
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          if (fail) throw new DOMException('denied', 'NotAllowedError');
          copied.push(text);
        },
      },
    });
  }, options.fail ?? false);

export const copiedTexts = (page: Page) => page.evaluate(() => (window as unknown as { __copied: string[] }).__copied);

/** 以腳本取代 window.print，記下每次呼叫當下的顯示模式（window.__prints） */
export const stubPrint = (page: Page) =>
  page.addInitScript(() => {
    const prints: string[] = [];
    Object.assign(window, { __prints: prints });
    window.print = () => void prints.push(document.documentElement.dataset.mode ?? 'paper');
  });

export const printCalls = (page: Page) => page.evaluate(() => (window as unknown as { __prints: string[] }).__prints);

/** 範例資料已知：數學 40 題、國語 16 題、社會 6 題、自然 5 題，共 67 題 */
export const EXAMPLE_TOTAL = 67;

/** 題庫頁清單依 ID 排序（字串順序，與 compareIds 一致） */
export const expectSorted = (ids: string[]) => expect(ids).toEqual([...ids].sort());

/** 第二個預覽伺服器（見 playwright.config.ts），讀 tests/fixtures/no-unit：其中一題沒有單元 */
export const FIXTURE_URL = 'http://localhost:4400';
