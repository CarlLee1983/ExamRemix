# 題庫受管操作

契約以 [#59](https://github.com/CarlLee1983/ExamRemix/issues/59)、[#58](https://github.com/CarlLee1983/ExamRemix/issues/58)、[新題與入庫契約](question-generation-contract.md) 及 ADR 0005 為準。本頁說明已實作入口；獨立題及完整題組的 AI 品質流程見[本機新題品質流程](question-generation-workflow.md)。

## 準備與發布完整候選

```sh
pnpm bank:batch inspect /absolute/path/to/data
pnpm list:questions /absolute/path/to/data --eligible --id original-01
pnpm bank:batch publish /absolute/work/request.json
```

`inspect` 回傳 canonical 資料根目錄、`targetHash`、`pendingHash` 及來源／待發布批次索引。索引不是品質判定，仍須以 `list:questions --eligible` 及完整來源 YAML 核對資格。`targetHash` 涵蓋全部題庫、試卷與圖片位元；`pendingHash` 涵蓋其他未完成批次的識別與完整候選。任一版本變動使舊品質及近重核對失效，入口停止，須重新核對受影響內容，不會自行換來源或只更新雜湊。

請求與候選須在資料根目錄外，且不放在 `public/`、建置輸出或其他公開目錄。候選用正常題庫 schema：無圖、無疑點，只記 `derivedFrom`，逐題明寫完整範圍，一次只發布一份完整 YAML。範例（雜湊需換成實際 SHA256）：

```json
{
  "contractVersion": "question-batch-v1",
  "batchId": "math-one",
  "dataDir": "/absolute/path/to/data",
  "batchScope": "原卷或可交付卷識別及本次選題範圍",
  "sourceIds": ["original-01"],
  "scope": {"grade": 3, "subject": "數學", "semester": 1, "stage": "midterm"},
  "quantity": {"count": 1, "unit": "questions"},
  "constraints": "原考點、允許變動、難度限制與核對方法",
  "target": "new-math-one.yaml",
  "candidate": "/absolute/work/candidate.yaml",
  "candidateHash": "候選原始位元的 SHA256",
  "targetHash": "inspect 回傳值",
  "pendingHash": "inspect 回傳值",
  "evidence": [{
    "id": "new-math-one-01", "attempt": 1, "decision": "accept", "reviewer": "實際核對者",
    "solution": "從題意求解的過程與結果",
    "independentCheck": "不同方法及核對結果",
    "difficulty": "逐項比較考點、進退位、單位等限制",
    "uniqueness": "封閉題唯一性或開放題判準",
    "explanation": "解析對應最終題幹、答案與材料的核對",
    "leakage": "孩子可見內容的提示核對結果",
    "nearDuplicates": "與完整目標、本批及待發布批次比較的 ID、差異與判斷理由"
  }]
}
```

題組用 `quantity.unit: "groups"`，證據涵蓋每個小題及每個 `檔名#組號`。嘗試次數限 1–3，凍結在紀錄中；本票接受已完成候選，不負責產題及重出調度。缺項、`reject` 或版本不符拒絕整批。雜湊能綁定證據與內容，不能證明核對者判斷正確；正規化比對僅攔可計算的重複，姓名替換、事實、全部語意近重及提示仍需具體的 AI／人核對證據。

## 持久化、中斷與失敗

入口先保存完整候選、來源 YAML／雜湊、目標檔案清單、證據與發布意圖，再同步同檔案系統的暫存檔，用 hard link 原子新增目的檔（目的存在即失敗），同步目錄、重驗完整目標題庫及試卷，最後持久化結果才回報。暫存與撤回檔不在 `bank/`，不進掃描。一般覆寫式 rename 不用來發布新檔。

中斷後用同一份請求重跑。實際檔案、內容雜湊與紀錄相符才辨認為同批；回傳原 ID，不新增後綴。相同指紋的新 `batchId` 也回傳既有結果。指紋含根目錄、契約版本、批次範圍、完整考試範圍、來源版本與 ID、數量及約束。同批請求／候選衝突、損毀紀錄、檔案被修改或舊證據失效均停止。已完成結果核對完整目標及自有檔，不因其他批次後來新增而重算容量。

成功回傳 `published`、固定 ID／題組清單、`added` 與警告。`added` 為本批合格小題數，重跑回傳同一結果，不能再次累加；目前總容量以 `check:bank` 為準。只有完整發布才有容量；正式資料未由本票擴充。

發布後檢查失敗只撤回雜湊仍符且沒有其他題庫／試卷引用的自有新檔。先持久化撤回意圖，再原子移出掃描範圍、同步並檢查剩餘資料；候選、錯誤與撤回檔保留。當次回報失敗，之後重跑回傳 `reverted`、`added: 0`。修改／引用衝突時保留檔案及持久維護標記並停止，不能刪除他人成果。使用者主動回復使用下列入口。

## 回復已發布批次

```sh
pnpm bank:batch rollback /absolute/path/to/data <batchId>
```

使用發布結果的 `batchId`，資料目錄須為該批原目標。入口只接受有完整紀錄的已發布批次或已開始撤回的批次；發布尚未完成時，先以原請求執行 `publish` 恢復。未知批次、損毀紀錄、其他操作的維護標記或忙碌鎖均停止，不以檔名認領或移除資料。

回復沿用同一排他鎖，核對批次紀錄、候選雜湊、實際檔案及其他題庫／題組／試卷引用。衝突會列出檔案及引用欄位、ID；已修改、遺失、撤回位置被占用或已回復目的檔重新出現時停止，不覆寫他人內容。引用掃描保守比對所有 YAML 文字值；若文字恰好等於本批 ID，也會列出位置供人工判斷。不要刪引用或控制檔繞過拒絕。

無衝突時，先持久化維護標記及撤回意圖，將完整自有檔原子移至資料根目錄的 `.batch-<batchId>.withdrawn`，同步來源與目的目錄，記錄 `reverted`、原 ID／題組 ID 與 `added: 0`，再檢查完整剩餘題庫，成功才解除維護。原題、其他批次及試卷保持原狀；撤回檔、候選、來源與紀錄是恢復證據，須保留在掃描及公開輸出之外。

中斷或同步失敗後重跑同一回復命令。移檔後錯誤會保留維護標記，讀者持續拒讀；先處理所列衝突或剩餘資料錯誤，再重跑。已完成回復且自有檔不存在時，核對保留證據與剩餘資料後成功無操作；證據遺失／被修改仍停止。原發布請求或相同指紋重跑只回傳 `reverted`，不自動重新發布；目前容量以 `check:bank` 查詢，不能將舊 `added` 累加。

## 所有受管修改與一致性讀取的共同協定

控制目錄固定為「canonical 資料根目錄 + `.examremix-operations`」，在題庫／試卷掃描範圍及公開產物之外，不納入 Git。不同路徑別名／symlink 共用鎖。此處含唯一恢復證據，不能當成可任意刪除的快取，也不能移入公開目錄。

匯入、產題、組卷、疑點修改都把實際寫入放進一個前景腳本；先完成選題及內容核對，取得 `inspect` 版本，再執行：

```sh
pnpm bank:access write /absolute/path/to/data --expected <targetHash> -- node /absolute/work/apply.mjs
pnpm bank:access read /absolute/path/to/data -- node /absolute/work/read.mjs
```

write wrapper 持鎖、鎖內核對目標版本、建立持久維護標記、執行腳本、檢查完整目標，成功才清除標記。腳本只修改本次授權檔案並在鎖內重新核對準備時的品質及選題條件。這是既有修改入口的共同排他協定，**不是多檔原子交易**；腳本失敗或中斷時保留標記，一致性讀者持續拒絕混合版本，須先核對／恢復該次修改。禁止背景 writer／daemon。獨立題及完整題組均使用 `bank:generate`，由入口保存嘗試並呼叫批次發布；不使用 write wrapper 直接新增 AI 候選。

`check:bank`、`list:questions` 持鎖取得固定記憶體快照；Astro integration 在載入 collections 前取得讀取 lease，持有至程序結束，涵蓋全部頁面與圖片。讀者也循序使用同一排他鎖；忙碌或有持久維護標記時明確失敗。開發伺服器會持有 lease，改資料前先停止。非受管編輯器／腳本須停止；直接編輯不在協定保證內。

鎖記 host、PID、唯一 token；前景 wrapper 另記 process group，父程序死亡但子行程仍活著時仍視為忙碌。只在同一 host 且 OS 確認 PID／group 已消失時回收 stale lock。PID 重用、其他 host、未知權限、鎖恢復本身中斷均停止並保留證據。活躍擁有者的檢查子行程繼承 lease，不能藉此巢狀取得寫鎖。

要求支援 hard link、同檔案系統原子 rename、檔案／目錄 `fsync` 的本機檔案系統，不保證跨主機或網路磁碟。I/O／同步錯誤不當作成功。停用時停止新寫入，保留普通 YAML、控制目錄與維護標記；不要刪鎖／標記繞過未完成操作。
