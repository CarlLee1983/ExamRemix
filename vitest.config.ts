import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // 建置整合測試共用 .astro 暫存，測試檔之間必須循序執行。
    fileParallelism: false,
  },
});
