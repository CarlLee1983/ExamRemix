# 按批次補齊有證據的考試範圍

實作 #62；分類與回復規則沿用[考試範圍契約](exam-scope-contract.md#遷移與回復邊界)。每批是一份原卷或可交付卷。工具不猜測檔名、「第一次評量」、單元或封存目錄的意思，不修改正式資料直到明確執行 `apply`。

## 準備與預覽

在包含本工具的固定程式版本，以明確資料根目錄取得版本及資格結果：

```sh
pnpm bank:classify inspect /absolute/data
```

保存輸出的 `programHash` 與 `dataHash`。前者涵蓋 Node 版本、src、scripts、public、套件／鎖定檔與建置設定的內容；後者涵蓋資料根目錄所有普通檔案（包括圖片與存在狀態），不僅題數。拒絕資料樹中的符號連結。保持這份程式可取得；恢復與回復要求相同程式雜湊。

在題庫及網站輸出之外保存請求 JSON，例如：

```json
{
  "version": "classification-v1",
  "batchId": "math-original-001",
  "batch": "某校三年級上學期數學期中原卷",
  "dataDir": "/absolute/data",
  "programHash": "inspect 輸出的 64 位 SHA256",
  "dataHash": "inspect 輸出的 64 位 SHA256",
  "evidence": [{
    "file": "/private/originals/math.pdf",
    "hash": "原卷檔案的 64 位 SHA256",
    "location": "第 1 頁標題與第 2 頁題號",
    "reason": "標題明示三年級、數學、上學期及期中；已對照匯入題號",
    "originalPaper": "與題目 source.originalPaper 完全相同的原卷識別",
    "ids": ["original-math-01", "original-math-02"],
    "scope": {"grade": 3, "subject": "數學", "semester": 1, "stage": "midterm"}
  }],
  "papers": []
}
```

相對路徑以請求 JSON 所在目錄為準。證據須為資料目錄外的普通檔案；工具核對位元雜湊、ID、原卷識別及年級／科目，**證據內容是否真的支持分類仍由操作者核對**。只列有證據的原題；其他題目保持未知。工具傳遞給所有受影響新題，多來源有未知／矛盾或完整題組衝突時拒絕。

如需補試卷範圍，`papers` 明列 `{ "file": "papers/example.yaml", "scope": { ...完整範圍... }, "reason": "分類理由及來源對照" }`。引用題目的完整範圍須一致；不會自動替試卷補分類或換題。

```sh
pnpm bank:classify preview /private/request.json --build
pnpm bank:classify apply /private/request.json --expected <preview輸出的planHash>
```

`preview` 可先快速檢視；`--build` 另在操作目錄中的隔離資料副本與乾淨產物目錄執行實際 Astro 建置，核對試卷路由，保存日誌及產物雜湊。`apply` 必須取得相同預覽的建置紀錄並核對產物未變。預覽在記憶體的隔離資料視圖執行共用 schema、來源／題組及完整題庫驗證，列出每個改動的舊／新分類、受影響題組、試卷與完整卷／近重配置、排除原因、各科容量與完整題組數。所有非分類欄位及未計畫分類必須逐值相同；圖片位元由清單雜湊保護。容量不代表可組成完整卷。

`apply` 在排他鎖下重新計算同一預覽；程式、資料、來源或請求改變即拒絕。它保存證據副本、完整前後文字與雜湊後，先持久化維護標記，再逐檔替換並同步及完整驗證，最後持久化完成紀錄才解除標記。這是受控維護窗口，不是跨檔原子 rename。外部已部署靜態版本不受此本機操作影響。

## 中斷、重跑與回復

紀錄位於資料根目錄旁的 `<data>.examremix-operations/classifications/<batchId>/record.json`；它含校驗碼、來源副本、前後備份與版本。不要搬進題庫、提交或公開，也不要刪除唯一恢復證據。維護標記不隨行程結束消失。共用鎖只協調受管入口；維護時不要用其他程式直接編輯資料。

相同 `apply` 請求與預覽雜湊在完成後核對最終檔案清單及雜湊，無修改地回傳原結果。原請求或證據檔遺失時，使用紀錄恢復：

```sh
pnpm bank:classify recover /absolute/data math-original-001 after
# 或取消尚未完成的套用，恢復完整舊狀態：
pnpm bank:classify recover /absolute/data math-original-001 before
# 已完成套用後的明確回復：
pnpm bank:classify rollback /absolute/data math-original-001
```

每個自有檔案只接受紀錄中的精確舊／新版本。任何第三種內容、遺失檔案、紀錄損毀、其他操作標記或程式改版都停止並保留阻擋狀態。回復方向先寫入紀錄，再恢復資料；已開始回復不可改向重新套用。中斷的回復以 `recover ... before` 繼續。

回復會拒絕自有檔案的任何後續修改，以及新增／修改的受影響題目引用（含完整卷配置及近重資料），並先驗證完整舊分類視圖。只有本批檔案會還原，無關檔案保留；同檔的無關後續編輯也保守停止，不用舊備份覆蓋它。衝突需先人工核對，不能刪標記繞過。

## 建置與驗收界線

預覽的 `--build` 在切換前驗證乾淨靜態輸出及資格路由，不自行發布網站。依本批預覽核對受影響試卷及必要列印；分類恢復後亦需重新建置相容產物。停用試卷由共用資格模組排除；部署後的404與快取處理由發布流程負責。本機 metadata 回復不會回復線上版本。

合成 CLI 測試覆蓋跨檔中斷、同步失敗、持久標記、讀者拒絕、重跑、衝突及備份恢復。它們不代替正式來源的語意核對、逐科候選驗收、實體列印或斷電硬體測試。檔案系統須支援既有協定使用的硬連結、rename 與檔案／目錄 fsync。

完整卷配置也屬於同一快照：預覽會核對五科固定配額、引用及唯一範圍，列出 `configurations` 狀態。`checked` 表示結構與核對雜湊符合目前資料，仍須實際選題見證才能宣稱可組完整卷。分類變動使核對雜湊過期時會列為 `unconfigured`，不自動更新核對證據；沿用未變動部分的證據，核對本批影響後才明確更新版本。隔離建置帶入配置及近重資料原始位元。
