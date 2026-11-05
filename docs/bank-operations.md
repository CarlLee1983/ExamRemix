# 題庫受管操作

契約以 [#58](https://github.com/CarlLee1983/ExamRemix/issues/58)、[新題與入庫契約](question-generation-contract.md) 及 ADR 0005 為準。本頁說明已實作入口；正式 AI 產題流程與完整使用者回復介面由後票交付。

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

發布後檢查失敗只撤回雜湊仍符且沒有其他題庫／試卷引用的自有新檔。先持久化撤回意圖，再原子移出掃描範圍、同步並檢查剩餘資料；候選、錯誤與撤回檔保留。當次回報失敗，之後重跑回傳 `reverted`、`added: 0`。修改／引用衝突時保留檔案及持久維護標記並停止，不能刪除他人成果。完整使用者回復入口由後票交付。

## 所有受管修改與一致性讀取的共同協定

控制目錄固定為「canonical 資料根目錄 + `.examremix-operations`」，在題庫／試卷掃描範圍及公開產物之外，不納入 Git。不同路徑別名／symlink 共用鎖。此處含唯一恢復證據，不能當成可任意刪除的快取，也不能移入公開目錄。

匯入、產題、組卷、疑點修改都把實際寫入放進一個前景腳本；先完成選題及內容核對，取得 `inspect` 版本，再執行：

```sh
pnpm bank:access write /absolute/path/to/data --expected <targetHash> -- node /absolute/work/apply.mjs
pnpm bank:access read /absolute/path/to/data -- node /absolute/work/read.mjs
```

write wrapper 持鎖、鎖內核對目標版本、建立持久維護標記、執行腳本、檢查完整目標，成功才清除標記。腳本只修改本次授權檔案並在鎖內重新核對準備時的品質及選題條件。這是既有修改入口的共同排他協定，**不是多檔原子交易**；腳本失敗或中斷時保留標記，一致性讀者持續拒絕混合版本，須先核對／恢復該次修改。禁止背景 writer／daemon。正式 AI 產題流程切換至批次入口由後票交付；此票只統一它現有寫入區段的排他協定。

`check:bank`、`list:questions` 持鎖取得固定記憶體快照；Astro integration 在載入 collections 前取得讀取 lease，持有至程序結束，涵蓋全部頁面與圖片。讀者也循序使用同一排他鎖；忙碌或有持久維護標記時明確失敗。開發伺服器會持有 lease，改資料前先停止。非受管編輯器／腳本須停止；直接編輯不在協定保證內。

鎖記 host、PID、唯一 token；前景 wrapper 另記 process group，父程序死亡但子行程仍活著時仍視為忙碌。只在同一 host 且 OS 確認 PID／group 已消失時回收 stale lock。PID 重用、其他 host、未知權限、鎖恢復本身中斷均停止並保留證據。活躍擁有者的檢查子行程繼承 lease，不能藉此巢狀取得寫鎖。

要求支援 hard link、同檔案系統原子 rename、檔案／目錄 `fsync` 的本機檔案系統，不保證跨主機或網路磁碟。I/O／同步錯誤不當作成功。停用時停止新寫入，保留普通 YAML、控制目錄與維護標記；不要刪鎖／標記繞過未完成操作。
