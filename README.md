# ExamRemix

把手機拍的原卷照片或 PDF 交給 AI agent 分析，只保留題目（去除已作答的筆跡），存成結構化題庫；再由 AI 參考原題產生同題型的新題，最後在本機純靜態網頁上依題型排版，輸出 A4 可列印的試卷。

## 功能目標

- **匯入**：在 Claude Code 等 AI agent 中分析照片 / PDF，區分印刷題目與手寫作答，只保留題目
- **產生**：參考原題產生新題，並附上答案與解析
- **輸出**：依題型（選擇、是非、造句、數學問答……）套用不同版面與作答空間；網頁可切換成答案卷，列印預設為試卷，答案卷供家長對答

## 已定方向

| 面向 | 決定 |
| --- | --- |
| AI 執行方式 | 在本機的 AI agent（Claude Code）內執行，不在網頁呼叫 API |
| 網頁 | 純靜態網站，僅本機使用 |
| 題庫格式 | YAML（建置時以 schema 檢查後轉成 JSON） |
| 數學式 | LaTeX 子集，以 KaTeX 渲染；直式計算等以結構化資料表示 |
| 紙張 | 只支援 A4，以 CSS `@page` 控制 |

詳細設計與決策紀錄見 `docs/adr/`，用語見 `GLOSSARY.md`。

## 開始使用

Node.js 版本需求見 `package.json` 的 `engines`，套件管理用 pnpm（版本見 `package.json` 的 `packageManager`）。

```sh
pnpm install
pnpm dev           # 開發伺服器，試卷在 /papers/<試卷檔名>/
pnpm build         # 建置靜態網站到 dist/
pnpm preview       # 預覽建置結果
```

### 指定資料目錄

網站從資料目錄讀題庫與試卷：`<資料目錄>/bank/*.yaml` 是題庫檔，`<資料目錄>/papers/*.yaml` 是試卷檔。預設讀 repo 內虛構的 `examples/`；用環境變數 `EXAMREMIX_DATA_DIR` 改指真實資料目錄：

```sh
EXAMREMIX_DATA_DIR=data pnpm dev
```

建議把真實資料放在 repo 根目錄的 `data/`，它已被 `.gitignore` 排除（見 ADR 0001）。題庫檔或試卷檔格式有誤時，建置會失敗並指出檔案與欄位。

### 題庫檢查

```sh
pnpm check:bank [資料目錄]    # 沒給參數時依序取 EXAMREMIX_DATA_DIR、examples
```

檢查資料目錄裡的題庫檔與試卷檔：檔名是否合格（只能用小寫英數字與連字號，如 `sample-math.yaml`）、格式是否符合 schema，以及三條跨檔規則：題目 ID 不可在題庫檔之間重複、試卷只能引用存在的題目、試卷只能引用已確認的題目（未確認但沒被試卷引用的題目沒問題）。每個問題輸出一行（檔案、欄位或題目 ID、說明），最後一行是摘要；有問題以狀態碼 1 結束，沒有問題以 0 結束，資料目錄或 `bank/`、`papers/` 不存在時也非零結束。`pnpm build` 會跑同一套跨檔檢查，有任何問題就失敗並列出全部問題。agent 匯入或產生題目後應先跑這個指令，修到沒有問題為止。

### 測試

```sh
pnpm check         # 型別檢查
pnpm test          # Vitest：schema 與題庫檢查單元測試、檢查指令測試，與較慢的建置失敗整合測試
pnpm test:e2e      # Playwright：以範例資料建置後測試試卷頁與 A4 列印
```

首次跑 `test:e2e` 前需要 `pnpm exec playwright install chromium`。

## 隱私

原卷照片 / PDF 放在 `inputs/`，已被 `.gitignore` 排除，不會推上 GitHub。
