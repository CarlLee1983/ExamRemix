## Agent skills

### Issue tracker

Issue 放在 GitHub Issues（`CarlLee1983/ExamRemix`），透過 `gh` CLI 操作。See `docs/agents/issue-tracker.md`.

### Triage labels

沿用五個預設 triage label：`needs-triage`、`needs-info`、`ready-for-agent`、`ready-for-human`、`wontfix`。See `docs/agents/triage-labels.md`.

### Domain docs

Single-context：repo 根目錄一份 `GLOSSARY.md`，ADR 放在 `docs/adr/`。See `docs/agents/domain.md`.

## 題庫批次與驗證

- 擴充或組卷以一份原卷或一張可交付試卷為批次；參照收集的原卷選題型結構，逐題核對來源、答案及跨卷近重，未確認的題目不計入可用容量。
- 沿用仍適用的資料操作方案及已接受的風險分析；每批只重審變動與受影響範圍。整卷及新增圖文題型完成後驗證列印，不為每道普通文字題重建列印站。
- 交易與故障測試優先使用小型合成 fixture 和獨立暫存目錄；正式題庫按批次驗證，保留必要的來源與回復資料，不為每個測試案例複製整份題庫。成功後只清理自己建立、可重建且不含唯一證據的暫存。
- 臨時驗證的輸出優先留在工具結果；需要寫檔時使用明確工作目錄內的新檔及隔離建置目錄，避免相對路徑覆寫工作區外的檔案。正式建置仍使用專案原有命令。
- 收到進度查詢時，先以既有證據及必要的唯讀核對回報，不加派會拖住回覆的新工作；先前已授權的執行工作於回報後接續。
