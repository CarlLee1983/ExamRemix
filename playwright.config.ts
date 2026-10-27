import { defineConfig } from '@playwright/test';

const port = 4399;

export default defineConfig({
  testDir: 'e2e',
  webServer: {
    // 固定讀範例資料，不受使用者環境變數影響；--ignore-lock 讓 preview 在 agent 環境下也留在前景（否則會自動轉背景而被判定提早結束）
    command: `npm run build && npm run preview -- --port ${port} --ignore-lock`,
    env: { EXAMREMIX_DATA_DIR: 'examples' },
    url: `http://localhost:${port}/papers/sample-math/`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
  use: { baseURL: `http://localhost:${port}` },
});
