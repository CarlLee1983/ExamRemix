# 完整卷重抽與預覽控制

[#64](https://github.com/CarlLee1983/ExamRemix/issues/64) 依 [完整卷契約](paper-composition-contract.md) 提供純資料重抽及預覽狀態控制；不新增正式候選／配置、不接正式網站入口、不寫檔或部署。五科僅使用隔離合成資料驗證，正式數學入口與整卷列印驗收仍由後續票承接。

`composePaper`／`validateCompositionWitness` 共用五科固定配置。數學的 `composeMathPaper`、`validateMathConfiguration`、`validateMathWitness` 保留科目檢查。配置與見證型別沿用 `MathProfile`／`MathWitness` 名稱以保持 #63 呼叫端相容。核心版本為 `composition-2`，不能把早期見證當作新版本可用證據。自然維持四大題；最後「圖表填答」為 `mixed` 大題，槽位必須明列 `type` 且依序2題 `diagram-label`、1題 `table-fill`、2題 `fill-blank`。其他大題的槽位可省略 `type`，有填寫時須符合大題型別。

國語／社會／英語閱讀大題必須有 `variants: [{id,groupId,questionIds,evidence}]`；每個變體恰好3／2／3個依槽位順序的已核對成員。只接受整個登記的變體，不能跨組拼湊；材料只輸出一次且在該大題第一個成員前。英語看圖選句必須有圖片，大小寫須保留四線格；配對、表格與圖示的 `answerItems` 按完整作答項數核對，不拆分內部項目。

## 核對內容版本

配置新增 `reviewedSnapshotHash`（64位小寫 SHA-256）。`compositionReviewSnapshot(input)` 回傳 `{banks:[{name,data}], images, imageHashes}` 的精確 canonical JSON：題庫依名稱、圖片路徑依字串排序，排除檔案系統位置。`compositionReviewHash(input)` 提供等價的非同步瀏覽器 SHA-256；Node 核對工具可用 `createHash('sha256').update(compositionReviewSnapshot(input)).digest('hex')`。圖片雜湊必須來自實際圖片位元。只有內容核對流程明示接受新快照後才能更新此欄位，讀取器不得自動刷新。

`validateCompositionConfiguration` 是同步格式、資格與配置預檢，會檢查欄位存在及格式，**不能單獨證明內容核對版本仍有效**。非同步組卷／見證驗證及預覽載入會重算雜湊；缺少或過期核對證據回報 `unconfigured`，格式錯誤回報 `data-error`。改題幹、答案、來源、疑點或圖片位元後，舊證據不能繼續授權新內容。非空核對引用及雜湊綁定仍不取代本機的語意／列印人工核對。

## 重抽與重現

`redrawPaper(input, {seed, previous?})` 深複製快照及前卷，將 `ceil(N/3)` 門檻放入同一次有界完整卷搜尋。`compareCompositionPapers` 以增廣路徑求最大一對一相同／近重匹配 M，替換數為 N−M。相同 ID、相同作答內容、明列題目近重及題組 `memberPairs` 才視為未換；不將近重作傳遞閉包，也不將共用來源當作跨卷相同。圖片內容鍵可傳入 `imageHashes` 以比較實際圖片內容；選項排序及答案／解析差異不會憑空增加替換數。配對整板比較左右兩側的可見內容多重集合，忽略列序、答案池順序及作答代號／答案連結；數字、圖片、題幹與一對一模式仍保留。表格與閱讀材料的內部順序不任意排序。

所有配置、資格與同卷互斥仍參與搜尋。先找到完整合法葉節點後，可用已選題及後續單一候選的最大匹配作安全上界剪枝：這些不可避免的匹配已經使門檻不可能達成時，無須繼續分支。每個合法候選延伸仍算一個狀態，剪枝不增加額外預算；最多100,000狀態。區分 `redraw-impossible`（已見完整卷且窮盡符合門檻的分支）、`insufficient`（無完整卷）、`search-limit`、`unconfigured`、`data-error`。從不報未證得的最大可換題數。

成功的 `RedrawWitness` 保存完整核心見證，以及 `operation`：首次／重抽／版本重新開始、前卷完整見證與識別、本次替換數／門檻及涵蓋結果和操作輸入的 SHA-256。連同固定版本題庫、配置、衝突與圖片快照及種子可重現同一次結果；只保存種子不足以重現。`paperOnly` 可取核心見證供 `validateCompositionWitness` 重驗，避免把操作收據當核心欄位。

`assessPreviousPaper` 在版本改變時重驗前卷 ID、完整題目內容（含來源／答案）、資格／疑點、槽位、材料、配分、互斥及結果雜湊。見證另保存已選圖片的位元雜湊清單；同路徑圖片內容改變亦會使舊卷無效，未選圖片變動不誤傷舊卷。新版本即使前卷仍合法也以 `version-restart` 重新開始，不宣稱跨版本替換保證。

## 預覽狀態所有權

`CompositionPreview.load(scope, loader)` 原子載入一份完整快照；讀取／預檢失敗不混用舊候選與新衝突。`generate(seed)` 只有當核心成功且完整見證再次驗證通過，才一次替換上一卷。任何失敗都保留上一卷、答案顯示及紙張設定。同範圍有效前卷的列印就緒狀態在重抽失敗後保留；載入失敗或舊卷不再合格則停用列印。

每次載入／產生都有獨立序號，遲到結果無權更新目前狀態；切範圍會清除畫面上的前卷。`setAnswers`、`setPaperSize` 及成功換卷會遞增 `state.layoutRevision` 並停用列印。DOM／圖片／字型／分頁檢查完成後，呼叫 `setLayoutReady(true, capturedRevision)`；只有目前修訂的回呼可啟用列印。控制器不宣稱自行完成真實整卷列印檢查，檢查責任由後續正式入口承接。

## 隔離驗證

```sh
pnpm exec vitest run tests/redraw.test.ts tests/paper-composition.test.ts tests/composition-cli.test.ts
pnpm exec playwright test --config playwright.redraw.config.ts
pnpm exec astro sync
pnpm exec tsc --noEmit
```

五科測試逐一核對完整題型、配額、100分、閱讀材料及15／16、13／14、11／12、11／12、8／9替換邊界。瀏覽器測試位於 `tests/browser/`；獨立 Vite fixture 直接匯入實際核心與控制器，以測試提供的合成 JSON 快照操作，無固定求解回傳或產品情境切換。它不加入 Astro 正式路由、不建置正式資料、不驗收新增正式列印版面；Vite 快取使用並清理獨立系統暫存目錄。
