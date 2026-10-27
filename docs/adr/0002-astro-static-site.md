# 用 Astro 建置靜態網站

網站要在建置時讀入 YAML 題庫、以 schema 驗證後產出純靜態頁面，而 Astro 的 content collections 原生支援 YAML 載入與 zod schema 驗證，輸出就是靜態 HTML，不必自己寫載入與驗證流程。另一個選項是 Vite + TypeScript 自行實作這段流程，被捨棄的原因是要重做 Astro 已內建的部分。題庫 schema 因此寫成 Astro 的 collection 定義，日後若要換框架，schema 與載入層都得一起搬。schema 本身寫在不依賴 Astro 執行環境的一般模組（以 `astro/zod` 的 zod 定義），collection 定義只引用它，讓匯入與產生新題的 agent 也能在 Astro 建置之外跑同一套檢查。

**Falsified if:** 網站需要在瀏覽器保存狀態或呼叫後端（例如在網頁上挑題、編輯題目），不再只是建置期渲染；或題庫 schema 必須在 Astro 之外重用（例如給匯入用的 agent 獨立驗證），使得 `src/content.config.ts` 綁定在 Astro 上的定義成為負擔。
