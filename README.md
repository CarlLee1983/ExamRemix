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

Node.js 版本需求見 `package.json` 的 `engines`，套件管理用 npm。

```sh
npm install
npm run dev        # 開發伺服器，試卷在 /papers/<試卷檔名>/
npm run build      # 建置靜態網站到 dist/
npm run preview    # 預覽建置結果
```

### 指定資料目錄

網站從資料目錄讀題庫與試卷：`<資料目錄>/bank/*.yaml` 是題庫檔，`<資料目錄>/papers/*.yaml` 是試卷檔。預設讀 repo 內虛構的 `examples/`；用環境變數 `EXAMREMIX_DATA_DIR` 改指真實資料目錄：

```sh
EXAMREMIX_DATA_DIR=data npm run dev
```

建議把真實資料放在 repo 根目錄的 `data/`，它已被 `.gitignore` 排除（見 ADR 0001）。題庫檔或試卷檔格式有誤時，建置會失敗並指出檔案與欄位。

### 測試

```sh
npm run check      # 型別檢查
npm test           # Vitest：schema 單元測試，與較慢的建置失敗整合測試
npm run test:e2e   # Playwright：以範例資料建置後測試試卷頁與 A4 列印
```

首次跑 `test:e2e` 前需要 `npx playwright install chromium`。

## 隱私

原卷照片 / PDF 放在 `inputs/`，已被 `.gitignore` 排除，不會推上 GitHub。
