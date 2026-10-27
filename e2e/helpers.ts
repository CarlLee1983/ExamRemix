import type { Page } from '@playwright/test';

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
