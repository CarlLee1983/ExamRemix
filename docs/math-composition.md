# 數學限制組卷核心

[#63](https://github.com/CarlLee1983/ExamRemix/issues/63) 的核心實作依 [完整卷契約](paper-composition-contract.md)。此入口驗證數學三上期中六大題，依序選擇7×2、做做看7×2、填答10×2、比大小6×2、直式5×2、應用6×5，共41題／100分。不啟用正式候選、不新增正式配置、不承諾所有卷等機率，也不推估完整卷數。合成資料只存在測試 fixture。

## CLI 與固定快照

```sh
node scripts/compose-math.ts --data-dir /absolute/snapshot --profile math --seed diagnostic-1
node scripts/compose-math.ts --data-dir /absolute/snapshot --profile math --seed diagnostic-1 --witness /absolute/witness.json
```

只接受明示資料目錄，讀取 `bank/*.yaml`、`profiles/math.yaml` 及 `selection-conflicts.yaml`；沿用資料根目錄讀鎖及維護標記，包含配置、衝突與圖片內容均在同一租約內擷取。同一考試範圍有多份配置時拒絕載入。輸出 JSON 到 stdout；不寫題庫或試卷。狀態／退出碼為 `success`／0、`data-error`／1、`unconfigured`／2、`insufficient`／3、`search-limit`／4。見證驗證成功為 `valid`／0，無效為 `data-error`／1。

## 配置與證據

兩種 YAML 均用 `schemaVersion: 1`。精確 schema 的唯一來源是 [paper-composition.ts](../src/domain/paper-composition.ts)；可執行的完整合成範例是 [mathFixture](../tests/fixtures/composition/math.ts)，不得複製為正式啟用證據。

配置包含 `id`、`revision`、完整 `scope` 及 `evidence.sources/candidates/print` 核對紀錄引用。`sections` 依序使用上列六個標題與各自題型，每個槽位有唯一 `id`、`points`、`concept`、`difficulty`、`answerItems`、可選 `space`、`layout`、`referenceIds`、參照 `evidence` 及明列 `candidates: [{id,evidence}]`。參照只能是同型、同範圍原題；候選必須符合槽位作答項數及指定作答空間。核對紀錄由本機內容流程保存；非空引用不是系統自動證明語意正確。缺參照／候選／來源／列印核對引用時為 `unconfigured`；不存在的 ID、錯誤配分、格式、圖片或近重引用為 `data-error`。合資格不足才是 `insufficient`。

衝突檔包含 `revision` 及 `pairs: [{kind,ids:[a,b],reason}]`。`kind` 是 `question` 或 `group`；題組還須 `memberPairs: [[memberA,memberB]]` 且成員屬於對應組。近重只按明確配對，來源只按實際原題 ID 集合交集，均不作傳遞閉包。完全相同作答內容忽略 ID、來源、解析、答案、空間及選項排列後也互斥；保留數字、單位及運算，姓名等語意近重仍須明列已核對配對。數學仍使用獨立題槽位；#64 的共用核心另支援其他科目已核對的閱讀變體，見 [重抽與預覽控制](paper-redraw.md)。

## 純核心與可重現見證

`composeMathPaper(input, {seed, acceptComplete?})`、`validateMathWitness(input, unknownWitness)` 是非同步純資料 API，使用瀏覽器／Node 共有的 Web Crypto SHA-256。`validateMathConfiguration(input)` 是同步預檢，可供建置及分類交易使用。輸入是配置、衝突、已載入 `BankInput[]`、圖片路徑與 `imageHashes`。圖片內容雜湊必須由快照讀取器從位元計算；純核心要求每張引用圖片的64位小寫 SHA-256，無法從路徑自行驗證位元。`readMathCompositionInput(root, name)` 提供本機讀取器。非同步入口先深複製輸入，避免雜湊期間混用變動資料。

同核心版本、完整快照與種子決定候選洗牌及搜尋順序。每次合法地延伸一題算一個部分配置狀態，完整葉節點也計入；空根及已知衝突而拒絕的邊不計。最多100,000個狀態；只有合法候選窮盡才報無解。衝突診斷最多保留100例，並非最小矛盾集合，也不聲稱補N題就能解決。

成功見證記錄配置識別／修訂、核心版本、種子、配置／題庫與圖片／衝突 SHA-256、完整輸入識別、六大題及槽位順序、完整題目、材料陣列、分數與結果 SHA-256。數學無閱讀材料，因此材料陣列為空；原題附圖保留在題目。見證重驗重新檢查資格、槽位、內容、互斥及雜湊；同一種子不表示改版後仍可重現。選題成功不代表 DOM、字型、圖片與版面已通過正式整卷列印驗收。

`searchCompositionCandidates` 提供共用的有界回溯，接受已排序候選、成對衝突判斷及完整結果條件；數學包裝器另外持有資格、固定配額及種子排序。`acceptComplete` 的拒絕會繼續同次搜尋，供後續重抽接入；#64 另以 `redrawPaper` 及 `CompositionPreview` 提供匹配、前卷狀態與操作收據；數學核心見證本身仍不代表重抽差異保證。

#64 補上內容核對版本綁定：配置必須明列 `reviewedSnapshotHash`，非同步組卷與重驗重新計算銀行與圖片快照 SHA-256，過期時為 `unconfigured`。同步預檢只驗證結構／資格，不能單獨授權組卷。核心版本升為 `composition-2`；成功見證新增已選圖片內容雜湊，防止同路徑換圖仍沿用舊列印資格。重抽及五科共用配置詳見 [重抽與預覽控制](paper-redraw.md)。
