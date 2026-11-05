# gravito.dev 部署與版本回復決策

對應 [#50](https://github.com/CarlLee1983/ExamRemix/issues/50)，決策基底為 `34cdbf1e12adac5c825648359ee0cff561275307`。本文件記錄部署方式、必要操作及驗收邊界；#50 未建立 Worker、設定憑證、改 DNS 或發布網站。#56 的本機整合現況見下節，未完成項仍由 #55 子票承接。

## #56 整合基底現況

本輪已在獨立工作區整合既有正式題庫、附圖、試卷、資料公開政策及載入／建置命令，並保留原主工作區、既有整合工作區與原型。`pnpm dev:data` 明確讀正式資料；`pnpm build:deploy` 固定讀 `data/`，先檢查再建置，缺失或錯誤不回退範例。開發及測試仍預設使用 `examples/`。

已整合的 CI 只執行驗證，不持有發布 token 或部署步驟；其瀏覽器測試建置範例及 fixture。正式資料檢查與 `build:deploy` 須另循下方順序執行，測試結束後最後重建正式 `dist/`。後續 #71 承接受控發布及完整產物流程。

這份基底尚未完成 #46–#49 所定的可靠入庫、範圍／資格、完整卷／重抽及正式 UI／列印；也未建立發布 workflow、Wrangler 設定或線上資源。現有歷史卷與原始題數不算新契約的完整卷驗收。交付工作區仍可含待提交變更；只有程式與資料均納入可取得的乾淨 Git SHA，且後續工程與驗收完成後，才可進入正式發布。此處不授予提交、推送或部署權限。

下列「證據與缺口」保留 #50 在 2026-11-04 的固定版本觀察，其中「遠端基底沒有命令／資料」描述當時來源，不是本輪整合工作區的能力清單。託管、域名、手動批准、產物綁定及回復規則仍採本文件同一份契約。

## 決策與目前狀態

採用 **Cloudflare Workers Static Assets**，獨立 Worker 名稱規劃為 `examremix`，以網站根目錄 `/` 提供靜態 `dist/`。使用者已確認正式網址為 **https://examremix.gravito.dev/**；平台預設網址不作為正式交付。初期只接受 GitHub Actions 的手動發布，main push／PR 只驗證，不直接上線；完成首次上線與回復演練後，是否改成自動發布另行決定。

選擇此方式是為了沿用 CarlMath／CarlWonder 的託管慣例、維持靜態網站及獨立網域，避免新增後端或搬動現有服務。Cloudflare Pages 也能提供靜態網站，但會多一套與兩個現有站不同的發布設定；GitHub Pages 的專案子路徑不符合目前根路徑連結契約。網站不保存訪客作答，不增加資料庫或線上 AI 金鑰。

以下是設計決策及未來操作契約，不代表已有發布 workflow 或已完成線上驗收。#56 僅帶入既有程式／資料基底；新增功能及發布設定仍須由後續工程完成。

## 證據與缺口

核對日期：2026-11-04，Asia/Taipei。相鄰專案只讀取設定，沒有讀取或複製憑證；下列引用檔案均與各自 HEAD 一致，其他未提交修改未動。

| 來源／固定版本 | verified：實際設定 | 對本案的意義 |
| --- | --- | --- |
| CarlMath `32d0d6d029f13c0fb4ea983a485358e958a9d48d`：`wrangler.jsonc:5`、`.github/workflows/deploy.yml:3`、`package.json` | assets 指向 `./dist`；`math.gravito.dev` Custom Domain；停用 workers.dev／preview URLs；main push 或手動觸發並受 `CLOUDFLARE_DEPLOY_ENABLED` gate；Wrangler 相依範圍 `^4.150.0` | 沿用資產與域名模式，初期進一步限定手動觸發 |
| CarlWonder `da7adbb08549f8e1ddd11c79ce85c5f1a81ae58c`：`wrangler.jsonc:5`、`.github/workflows/deploy.yml:3`、`package.json` | `./dist`、`carlwonder.gravito.dev`；main push 先驗證再重建正式內容；Wrangler `4.147.0` | 測試產物不能直接當正式產物，發布前必須重建 |
| CarlAcademy `9189a68078f66d875e2a9621f1e54fffef9b7356`：`README.md:60`、`.github/workflows/verify.yml` | 文件指定 `academy.gravito.dev`、origin／base path；verify 沒有發布步驟 | 參照獨立網址及驗證／發布分離；「尚未發布」只是文件紀錄，未查線上狀態 |
| ExamRemix `34cdbf1`：`package.json`、`.gitignore`、ADR 0001 | 遠端基底沒有 `build:deploy`，仍排除 `data/`；沒有 CI／部署 workflow 或 Wrangler 相依 | 本機整合尚未進 main，不能宣稱已具備遠端正式建置能力 |
| 本機 `.scratch/integration-main-20261104/worktree`，基底 `9d0b9b91ad8a88d1170d58c88198602b399cf715` | 未提交整合含正式資料建置命令、CI 與資料公開政策調整；主工作區另有未提交資料及 UI 成果 | 這是待整合來源，不可直接以 origin/main 覆寫，也不能把基底 SHA 當完整內容版本 |
| 公開 DNS：`dig examremix.gravito.dev A/AAAA/CNAME`（分別查詢） | 三者均為 NXDOMAIN | 只表示當次公開查詢未解析，不證明帳號內沒有同名 Worker／Custom Domain、憑證或保留設定 |

尚未查核 Cloudflare 帳號 ID、gravito.dev active zone 歸屬、帳號內 Worker／網域綁定、API token 權限及 GitHub production environment。這些缺口阻擋實際上線，不阻擋本票產出決策。inferred：相同平台可降低維護設定的差異；沒有量測成本或效能，故不給成本、容量或上線日期承諾。

## 帳號、域名與操作責任

- **CarlLee1983（維護者）**：確認擁有 gravito.dev active zone 的實際 Cloudflare 帳號，決定並授權建立 `examremix`、綁定唯一 hostname、首次發布與指定版本回復。帳號 ID 以 ExamRemix 自己的設定注入，不從其他 repo／環境複製。
- **維護者或其明確授權的 DevOps 操作者**：唯讀查明同名 Worker、所有既有 DNS record／Custom Domain／route 及憑證狀態；沒有衝突才提出精確建立操作。有衝突時停止綁定，不自動刪除或接管既有紀錄，也不動 `math`、`carlwonder`、`academy` 或根網域。
- **首次建立者**：在明確授權的範圍建立 Worker 與 Custom Domain。Cloudflare 會替 Custom Domain 建立 DNS record；不另手動猜測 CNAME 目標。首次建立需要對應 Worker／zone 權限，與日常只發布該 Worker 的權限分開處理。
- **日常發布**：使用 ExamRemix 專用 API token；由維護者在本 repo 的 GitHub `production` environment 設定 `CLOUDFLARE_API_TOKEN` 與 `CLOUDFLARE_ACCOUNT_ID`，token 只在發布／回復步驟注入。使用平台當時可用的最小 Worker 範圍權限；不得因缺權限改用其他專案 token、全域金鑰或放寬隔離。

Cloudflare 現行權限文件指出：修改 Custom Domain／route 還需要 affected zone 的 Workers Routes Write；既有綁定不變時可只具備目標 Worker Editor。實際帳號是否已能使用此粒度，發布前須確認；不能把文件能力當成此帳號已配置。身分、account、Worker 或 hostname 任一不符，就停止相應操作。

預定 Wrangler 設定如下；**這是後續工程實作的範例，不是目前已啟用的設定**。Wrangler 要在 ExamRemix 本身選定精確版本並鎖檔，不能借用相鄰專案安裝或以浮動 latest 發布；compatibility date 取後續實作與驗證時明確選定的日期。

```jsonc
{
  "name": "examremix",
  "assets": {
    "directory": "./dist",
    "html_handling": "auto-trailing-slash",
    "not_found_handling": "404-page"
  },
  "routes": [{ "pattern": "examremix.gravito.dev", "custom_domain": true }],
  "workers_dev": false,
  "preview_urls": false
}
```

不啟用 SPA fallback；保留目錄 index 與真正的 404。公開內容沿用已接受的範圍：題目、答案、解析、來源與題庫圖片；支援格式的 bank 圖片即使未被試卷引用也可能被輸出。原卷照片／PDF、封存及操作紀錄不發布。這不引入登入或重新要求家長逐題同意。

## 保留整合成果與正式資料建置

1. 保留主工作區、本機整合 worktree、題庫／來源備份與 `.scratch/entry-design/`。現有 323 單元／CLI、179 瀏覽器與正式資料檢查紀錄只是先前整合版本的證據，不能冒充新 SHA 的驗收。
2. 在隔離 worktree 比對已接受整合與最新 main，分批納入程式、正式 `data/bank/`、附圖與 `data/papers/`，同時帶入已接受的資料公開政策調整。不要整目錄複製 `.scratch`、`inputs`、封存或快取。本輪基底的 ADR 0001／README 已同步為正式題庫可公開、原卷留本機；後續同步 main 時保留這項已接受政策，不回復舊的全量排除規則。
3. #46–#48 的可靠入庫、範圍／資格、配額／互斥／重抽，以及 #49 的正式 UI／SVG 注音與列印整合仍需完成。原型快照與情境開關不可當成正式組卷結果。
4. 發布版本必須是可取得的乾淨 Git SHA，程式與正式資料同版。以乾淨 checkout 核對資料、圖片及試卷都存在；不能從未提交本機工作區發布，也不能把本機絕對路徑當 CI 資料來源。
5. 正式建置命令契約為 `pnpm build:deploy`：固定 `EXAMREMIX_DATA_DIR=data`，先檢查正式資料再建置；資料缺失或檢查錯誤時非零退出，不回退 examples。此命令已帶入 #56 整合基底；驗證時可執行下列流程，結果必須對應實際內容版本。

在同一 checkout 依序執行，避免 Astro 共用暫存衝突：

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm test
pnpm check:bank data
pnpm exec playwright install chromium
pnpm test:e2e
pnpm build:deploy
```

Node／pnpm 沿用版本設定（整合基底的 CI 設定為 Node 24.21.0、packageManager 為 pnpm 12.0.0）。e2e 會以 examples／fixture 覆寫 dist，因此正式建置必須放最後。只打包並發布此時的 `dist/`，不上傳整個工作區、dist-fixture、來源原卷或測試資料。另檢查部署產物大小／檔案數是否符合選定方案限制。

## CI 與發布順序

後續工程應維持以下唯一發布路徑，本票不新增會對外寫入的 workflow：

1. #56 已帶入本機 CI；main push／PR 執行既有驗證命令，不持有發布 token、不自動部署。後續擴展正式產物 gates 時保留此界線。production 的發布 workflow 只提供 `workflow_dispatch`；拒絕非 `refs/heads/main` 的觸發。checkout 使用該 run 固定的 Git SHA，不能在途中改抓另一個 main tip。
2. 發布預設關閉：`CLOUDFLARE_DEPLOY_ENABLED` 必須明確為 `true`，並受 production environment 的維護者審批保護。GitHub environment 的可用保護功能須先確認；若缺少要求的審批功能，不啟用發布 workflow，回到維護者決定替代的明確批准途徑。不得自行退化成 push 即上線。
3. 同一 SHA 執行前述完整 gates，正式 build 後驗證首頁／各科完整卷、答案與 A4/A3；將 dist 保存為該 run 的 immutable artifact，計算 SHA256。發布步驟使用同一份產物，不重新 build 或下載未綁定 SHA 的其他 run 產物。
4. 在該 run 記錄 Git SHA、工具版本、產物摘要、資料／題庫版本、目標 account／Worker／hostname、平台 version ID／deployment ID、前一個**已驗收** version ID，以及前後 smoke 結果。沿用 Actions artifact／run 及平台 deployment 記錄，不新增另一套進度系統。
5. 共用 production concurrency group，`cancel-in-progress: false`，同一時間只能有一個發布或回復 writer。token 只在最後發布步驟可見。第一次設定完成後不另啟用 Cloudflare Workers Builds 或其他自動發布入口，避免同 SHA 雙重上線。
6. 維護者明確授權上線後，先確認 account／Worker／hostname 及 live version，再執行鎖定 Wrangler 的 `pnpm exec wrangler deploy`。dry run 只能證明打包，不證明正式網域可用。命令成功、平台部署完成與服務驗證通過分開記錄。

若手動發布在等待期間已有更新的 main，仍只發布已批准的 run SHA，不能悄悄升級版本。若重試遇到未知結果，先查該 SHA／artifact 是否已產生 live deployment，再決定是否重試，不盲目再次部署。

## 上線驗收與回復

後續 DevOps 承接時，必須先取得明確的發布與必要回復授權，再執行線上操作；以下命令本票均未執行。

**上線驗收**：正式 HTTPS 的 `/`、`/bank/`、`/papers/` 與實際每科完整卷能直開及重新整理；題庫篩選、答案顯隱、重抽與列印按 #47–#49 契約運作。圖片／CSS／JS／字型無 404、Content-Type 正確；國語 SVG 注音與題組材料、作答空間保留。不存在路徑必須 HTTP 404。以來源 SHA／產物綁定的 smoke 記錄確認版本，不以 HTTP 200 或命令退出碼取代功能驗收。實體印表機與手機實機尚未驗收，不能宣稱由本票補齊。

出現錯站／錯版本、資產缺失、錯誤答案顯隱、完整卷不符合配置、注音／列印裁切或 404 fallback 錯誤，即停止成功宣告並評估回復；不把重新抓 main 當作回復。

**回復步驟**：

1. 暫停新發布，讓回復使用同一 production writer。確認目標 Worker、account、上一份已驗收的 version ID、Git SHA／artifact，以及該 version ID 仍在平台可回復範圍。不要省略 ID 使用隱含的「前一版」，前一版可能本身未驗收。
2. 經授權後，於具有鎖定 Wrangler 版本及正確設定的 checkout 執行：

   ```sh
   pnpm exec wrangler rollback <已驗收的VERSION_ID> --name examremix
   ```

   這是立即切換線上流量的寫入操作。官方文件指出 version 包含程式、靜態資產、bindings 與 compatibility settings；rollback 建立新的 deployment 並將指定版本切到100%流量。可回復的版本以平台保留範圍為限（目前最多最近100個版本），不能假設永遠存在。
3. 讀回平台 live version／deployment，並重做同一正式 hostname 的上述 smoke；分開記錄「回復命令成功」與「服務驗證通過」。若失敗，保留證據，停止自動切換，交由維護者決定修復或其他已授權路徑。
4. **程式與公開資料**：同一舊 version 的靜態資產一起切回；本機題庫與來源備份不倒退，不覆寫 data。不新增 schema migration 或訪客資料還原。
5. **基礎設施**：DNS、Custom Domain、憑證、API token／GitHub secrets、綁定資源的外部狀態不隨版本回復。發現這類變更造成故障，須另列精確修復操作及授權，不能誤以為 Worker rollback 會修好。
6. **平台舊版本不再可用**：必須先確認保存的舊 dist artifact 與 SHA256，再以當時記錄的相容設定重新發布該產物，建立新 version；不從目前 data 重建舊程式。實作 workflow 須保存目前與上一份已驗收產物，發布前確認兩者可取得並在到期前安排保存；GitHub artifact 的保留期限不是永久。產物及舊版都遺失時，不宣稱可精確回復，停止並由維護者選擇重新驗證的版本。
7. **首次上線沒有前一個已驗收版本**：明列「尚無 rollback target」。首次發布須讓維護者明確接受此條件與失敗處置；不聲稱已演練回復。若首次驗收失敗，停止開放交付並提出修正版；撤除域名／停用服務等處置另外取得授權，不自行刪除資源。

## 本票交付與後續入口

本票完成的是已確認正式網址、具來源的託管／發布／回復方案及上述操作契約。正式資料基底已由 #56 帶入；分類／候選驗收、發布 workflow／Wrangler 設定、Cloudflare 身分／權限確認、網域建立、首次上線與回復演練仍待後續工程與 DevOps 工作；使用者啟動本票不等於授權這些外部變更。部署前應以當次版本及環境重新驗收，不沿用其他專案、原型或舊整合的成功紀錄。

本文件已整併既有本機建置能力與 #50 部署／回復契約；README 只保留入口。上方整合現況、歷史證據與未來操作契約分開記錄，避免將本機建置成功解讀為已發布。

## 平台來源

以下為2026-11-04核對的官方文件；說明平台能力，並非本帳號或正式環境已驗證的證據。

- [Static Assets 設定](https://developers.cloudflare.com/workers/static-assets/routing/static-site-generation/)：資產路由與404處理。
- [Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)：active zone、既有CNAME限制與自動DNS建立。
- [Workers roles and permissions](https://developers.cloudflare.com/workers/authorization/workers/)：Worker 與 zone 權限界線。
- [Versions and deployments](https://developers.cloudflare.com/workers/versions-and-deployments/)：version 包含靜態資產；外部儲存狀態不包含。
- [Rollbacks](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/) 與 [Wrangler rollback](https://developers.cloudflare.com/workers/wrangler/commands/workers/#rollback)：指定版本回復、立即部署效果及保留限制。
