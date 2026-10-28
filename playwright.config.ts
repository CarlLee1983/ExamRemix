import { defineConfig } from '@playwright/test';

const port = 4399;

export default defineConfig({
  testDir: 'e2e',
  webServer: {
    // 固定讀範例資料，不受使用者環境變數影響；--ignore-lock 讓 preview 在 agent 環境下也留在前景（否則會自動轉背景而被判定提早結束）
    // 另外以 tests/fixtures/no-unit 建一份到 dist-fixture，在 4400 埠提供：它有題目沒有單元（範例資料每題都有單元）
    command: [
      'pnpm run build',
      'EXAMREMIX_DATA_DIR=tests/fixtures/no-unit pnpm exec astro build --outDir dist-fixture',
      '{ pnpm exec astro preview --outDir dist-fixture --port 4400 --ignore-lock & fixture=$!; }',
      'trap "kill $fixture" EXIT TERM INT',
      `pnpm run preview --port ${port} --ignore-lock`,
    ].join(' && '),
    env: { EXAMREMIX_DATA_DIR: 'examples' },
    url: `http://localhost:${port}/papers/sample-math/`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
  use: { baseURL: `http://localhost:${port}` },
});
