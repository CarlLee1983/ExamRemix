# ExamRemix

把手機拍的原卷照片或 PDF 交給 AI agent 分析，只保留題目（去除已作答的筆跡），存成結構化題庫；再由 AI 參考原題產生同題型的新題，最後在本機純靜態網頁上依題型排版，輸出 A4 可列印的試卷。

## 目前能力與後續契約

本輪整合基底（[#56](https://github.com/CarlLee1983/ExamRemix/issues/56)）保留既有題型、題組、英語四線格／個人問答、一對一配對及 A4 列印，並帶入正式資料建置。本輪 #57 加入範圍／容量與舊卷停用（見下方「考試範圍與可用容量」）。以下描述的 CLI、頁面與「只支援 A4」是目前程式行為。

[#55 工程規格](https://github.com/CarlLee1983/ExamRemix/issues/55)所定的可靠入庫、固定完整卷／重抽、正式入口、國語直排／SVG 注音與 A3 列印，以及正式發布／回復仍由後續子票完成。已合併的[新題契約](docs/question-generation-contract.md)、[範圍契約](docs/exam-scope-contract.md)、[組卷契約](docs/paper-composition-contract.md)與已接受原型是驗收依據，不代表目前程式已提供這些能力。現有題數及歷史練習卷不代表可組出幾份符合新配置的完整卷；不增加逐題確認流程。

## 功能目標

- **匯入**：在 Claude Code 等 AI agent 中分析照片 / PDF，區分印刷題目與手寫作答，只保留題目
- **產生**：參考原題產生新題，並附上答案與解析
- **輸出**：依題型（選擇、是非、造句、數學問答……）套用不同版面與作答空間；網頁可切換成答案卷，列印預設為試卷，答案卷供家長對答

## 已定方向

| 面向 | 決定 |
| --- | --- |
| AI 執行方式 | 在本機的 AI agent（Claude Code）內執行，不在網頁呼叫 API |
| 網頁 | 純靜態網站，可本機使用或部署至靜態託管 |
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

網站有三個入口，都是純靜態、唯讀：

- `/`：首頁（總覽）。上方是淺藍主視覺：瀏覽器端產生的問候日期、「總覽」標題與一句摘要，右邊一張統計卡「份試卷可列印」（試卷數與「看試卷」）。下面每份試卷一個區塊：科目標籤、「N 題・M 大題」、標題連結，以及「列印試卷」「列印答案卷」兩個列印連結；最後是「題庫組成」，每個科目一條色段，寬度依各題型題數，旁邊列出題型與題數（建置時由題庫算出）。
- `/papers/`：試卷列表，以和首頁相同的試卷區塊列出所有試卷（科目標籤、年級、題數・大題數、標題），每塊同樣有「列印試卷」「列印答案卷」連結，標題連到試卷頁 `/papers/<試卷檔名>/`，在那裡切換試卷與答案卷、列印。
- `/bank/`：題庫瀏覽，單一清單依題目 ID 排序，每題收成一列（科目、ID、題型・單元），點開才看完整卡片：頂列有科目與「年級・單元・題型」標籤和「複製 ID」鈕（貼進試卷檔引用，複製後短暫轉成綠色「已複製」）；接著是題目與答案，淺底的解析，最後是出處或衍生自哪些題目、用於哪些試卷（或「尚未用於試卷」）。可依科目、年級、單元、題型篩選，條件可組合，有條件時出現「清除條件」，右上角顯示「共 N 題，顯示 M 題」；篩選條件會寫進網址，例如 `/bank/?subject=數學`，可以直接加書籤。

網站是純靜態、唯讀的：不寫入任何東西，也沒有回報按鈕，畫面上不顯示疑點。發現題目有問題時開 GitHub issue，由 agent 在本機處理（見下方「核對與疑點」）。

試卷頁上方有工具列（螢幕上黏在頂端，列印時不印）：返回試卷列表、切換試卷與答案卷、列印。首頁與試卷列表的列印連結（「列印試卷」「列印答案卷」）是 `/papers/<試卷檔名>/?print=paper` 與 `?print=answer`：開啟試卷頁時套用對應的版本、直接呼叫瀏覽器的列印，並把 `print` 參數從網址拿掉（重新整理不會又跳出列印）。

### 核對與疑點

題目預設可用，發現可疑之處才記**疑點**（題目上選填的 `doubt`，一句說明哪裡可疑；見 ADR 0003）。疑點只在本機與 issue 流程中使用，網站不顯示。疑點只有兩個來源：

- **AI agent 解析時判斷有問題**：匯入原卷時讀不清楚或推定的題目，agent 直接記下 `doubt`，並在回報中逐題列出（題目 ID、疑點說明、原卷位置），請家長對照原卷判斷。產生的新題已逐題驗算，不帶疑點。
- **人類在網站上看到異常**：開一個 GitHub issue，只寫題目 ID 與問題描述（例如「sample-math-22 答案應為 2」）；repo 是公開的，不要貼私人原卷的題目內容或照片（ADR 0001）。在本機把 issue 交給 agent（`record-doubt`），它會修正題目，或先把疑點寫進題庫；處理完在 issue 留言說明並關閉。

家長判斷後，可以請 agent 修正題目並解除疑點（「sample-math-22 的疑點修好它」），或判定沒問題直接解除（「sample-math-22 的疑點沒問題」）；兩種都由 agent 刪掉 `doubt`。想隨時查看，用 `pnpm list:questions <資料目錄> --doubt`。

有疑點的題目不能放進新試卷，也不能拿來衍生新題。已組好的試卷引用到有疑點的題目時，`check:bank` 會提出警告及停用原因；整體建置可繼續，但該卷不再輸出頁面或連結（網站上不顯示疑點內容）。

### 在 Claude Code 裡請 agent 做

repo 內附四個專案 skill（`.claude/skills/`），在 Claude Code 裡直接用口語提出即可，例如「匯入 inputs/ 裡這份考卷」：

| skill | 做什麼 |
| --- | --- |
| `import-original` | 把一份原卷（多張照片或一份 PDF）匯入成一個題庫檔，讀不清楚或推定的題目帶疑點，回報題數與帶疑點的題目 |
| `record-doubt` | 記錄一題的疑點，或在修正題目、判定沒有疑點後解除 |
| `generate-questions` | 參考沒有疑點的原題產生同題型的新題，存成一個題庫檔 |
| `compose-paper` | 依科目、年級、單元、題型與題數，從沒有疑點的題目組成一份試卷檔 |

每個 skill 完成前都會跑 `pnpm check:bank`，修到 0 個錯誤為止，並把警告回報給你。挑題時用的 `pnpm list:questions` 見「題庫檢查」。

### 指定資料目錄

網站從資料目錄讀題庫與試卷：`<資料目錄>/bank/*.yaml` 是題庫檔，`<資料目錄>/papers/*.yaml` 是試卷檔。預設讀 repo 內虛構的 `examples/`；用環境變數 `EXAMREMIX_DATA_DIR` 改指真實資料目錄：

```sh
EXAMREMIX_DATA_DIR=data pnpm dev
```

正式題庫放在 repo 根目錄的 `data/bank/`，試卷放在 `data/papers/`，兩者納入 Git（見 ADR 0001）。正式預覽用 `pnpm dev:data`，部署用 `pnpm build:deploy`；兩個指令固定讀 `data/`，不受外部 `EXAMREMIX_DATA_DIR` 影響，缺少資料目錄時失敗。`examples/` 保留供開發與自動測試使用。題庫檔或試卷檔格式有誤時，建置會失敗並指出檔案與欄位。

### 考試範圍與可用容量

題目與試卷可以明寫 `examScope: { semester: 1, stage: midterm }`；`semester` 只接受數字 1／2，`stage` 只接受 `midterm`／`final`，物件必須完整且無額外鍵。省略代表未知，不預設三上期中。年級與科目仍用原有欄位，每題只屬一組範圍。分類必須來自原卷或可對照來源，不能從檔名、單元或「第一次評量」推定；分類證據留在題庫外。正式資料批次遷移由 #62 承接，本輪不修改正式題庫。

共用資格模組供查題、檢查、首頁容量及試卷輸出使用。首版啟用三上期中五科；題組有任何未知成員就整組無法歸類，成員範圍衝突或已分類來源鏈不一致是錯誤。完全未分類的歷史來源鏈可保留供遷移，但不得計入容量或通過新入口。新匯入、產題及組卷須取得完整範圍；不得用舊資料相容規則發布未知分類。

`list:questions` 支援 `--semester 1|2`、`--stage midterm|final` 及 `--eligible`。學期／階段只篩選分類，仍可搭配 `--doubt` 盤點被排除的題目；`--eligible` 才限制為通過共用資格的挑題結果。重複同旗標為 OR、不同旗標為 AND。這些查詢會檢查完整資料快照，載入或資料錯誤時失敗，不把失敗當0題。未指定範圍／`--eligible` 時仍可盤點未知／疑點資料；`--no-doubt` 本身不代表範圍已知。

`check:bank` 列出各卷的「停用」原因與五科可選題數／完整題組數。材料、空格及配對端點不另計題數；完整組數不與成員題數相加。首頁保留原始題庫組成，另顯示合格容量；有題但配置未完成時顯示「完整卷規則尚未配置」，不宣稱完整卷可行或推算卷數。

未知、跨範圍、有效疑點或未支援範圍的試卷不產生試卷／答案頁，也不出現在列表或題庫「用於」連結；乾淨建置後舊網址為404。原 YAML 與引用保留，補分類或解除疑點後重新驗證才恢復輸出；線上撤下仍須另經部署及快取驗收。詳見[範圍契約](docs/exam-scope-contract.md)。

### 題庫檢查

```sh
pnpm check:bank [資料目錄]    # 沒給參數時依序取 EXAMREMIX_DATA_DIR、examples
```

檢查資料目錄裡的題庫檔與試卷檔：檔名是否合格（只能用小寫英數字與連字號，如 `sample-math.yaml`）、格式是否符合 schema，以及跨檔規則：題目 ID 不可在題庫檔之間重複；題目的附圖、選項圖片與表格欄標題圖片（各處的 `image.src`）必須存在於 `bank/` 底下；新題（`derivedFrom`）的衍生規則（見下）；試卷只能引用存在的題目。題目可以帶疑點（選填的 `doubt`，一句說明哪裡可疑，不可為空字串）：新題衍生自有疑點的原題是錯誤；試卷引用有疑點的題目是警告，訊息寫出試卷檔、題目 ID 與疑點描述。

衍生規則，逐一檢查新題的每個原題：原題必須存在；不能有疑點；本身必須是原題（有 `source`，新題只能衍生自原題，不能衍生自新題）；題型、科目、年級、單元都要與新題一致（單元連「沒有」也要一致，一個原題回報一次並列出不一致的欄位）；衍生自多個原題時，這些原題彼此的四個欄位也要一致。原題屬於題組時，須遵守下方「題組衍生」的整組來源對應，不能單獨衍生小題；材料疑點與單題疑點都會阻擋衍生。每個問題分成錯誤或警告（只有試卷引用有疑點的題目是警告，其餘規則都是錯誤），輸出一行（開頭標出「錯誤」或「警告」，接著是檔案、欄位或題目 ID、說明），先列錯誤再列警告，最後一行是摘要「N 個錯誤、M 個警告」；有錯誤以狀態碼 1 結束，只有警告或沒有問題以 0 結束，資料目錄或 `bank/`、`papers/` 不存在時也非零結束。`pnpm build` 會跑同一套跨檔檢查，有錯誤就失敗並列出全部問題，只有警告時印出警告後照常建置。agent 匯入或產生題目後應先跑這個指令，修到沒有錯誤為止。

```sh
pnpm list:questions [資料目錄] [過濾條件]
```

列出題庫裡的題目，每題一行，欄位以 tab 分隔：題目 ID、題型、科目、年級、單元（沒有則 `-`）、`doubt`（有疑點）或 `-`、題幹（換行壓成空格）。過濾條件都選填、彼此 AND，同一個旗標重複給值則是 OR：`--doubt`（只列有疑點的題目）、`--no-doubt`（只列沒有疑點的題目）、`--subject <科目>`、`--grade <年級>`、`--unit <單元>`、`--type <題型>`、`--id <題目 ID>`，例如 `pnpm list:questions --no-doubt --type choice --grade 3`。沒有符合的題目時沒有輸出、狀態碼仍是 0；資料目錄不存在或旗標錯誤以 2 結束。格式不合 schema 的題庫檔會跳過並在 stderr 提醒先跑 `pnpm check:bank`。

### 題型

每題都有共用欄位（`no`、`type`、`subject`、`grade`、選填的 `unit`、`stem`、`explanation`、選填的 `doubt`、`image` 與 `space`，以及原題的 `source` 或新題的 `derivedFrom` 擇一），`subject` 支援國語、英語、數學、社會、自然；`grade` 為 1 至 6。`no` 是檔內不重複的正整數，用來組成題目 ID；`stem`、`explanation` 都是非空文字；`doubt` 是一句說明哪裡可疑的非空文字，沒有疑點就省略。每題至多一個 `unit`，同一份原卷的不同題可以屬於不同單元，無法確定時省略。再加上各題型自己的欄位：

| `type` | 欄位 | 說明 |
| --- | --- | --- |
| `choice` | `options`（2 至 6 個文字或圖文選項）、`answer`（1 起算的選項編號） | 題幹下方列出選項，留一個作答括號 |
| `multi-select` | `options`（同 `choice`）、`answer`（1 起算的選項編號陣列） | 勾選題；至少一個正確選項，編號不可重複或超出選項範圍 |
| `classification` | `categories`（至少兩個 `{ name, symbol }`）、`statements`（至少一個 `{ text, answer }`） | 分類題；`answer` 是從 1 起算的類別編號，每個敘述歸入一類，整道題算一題 |
| `matching` | `left`（至少一個 `{ content, answer }`）、`right`（至少一個 `{ code, content }`） | 配對題；左側 `answer` 引用答案池的 `code`，`content` 沿用文字／圖文選項格式 |
| `diagram-label` | 必填 `image`、`labels`（至少一個 `{ x, y, width, height, answer }`） | 在圖上原空格作答；座標與寬高均為圖片百分比，`x`、`y` 為空格左上角的水平、垂直位置（0 至 100）；寬高大於 0，空格須完整在圖片內 |
| `table-fill` | `columns`（至少一個文字或圖文欄標題）、`rows`（至少一列 `{ label, answers }`） | `label` 是非空文字列標題；各列 `answers` 長度須等於欄數，在對應儲存格作答 |
| `true-false` | `answer`（`true` 或 `false`） | 留一個作答括號；答案卷填 ○（true）或 ✕（false） |
| `fill-blank` | `answer`（字串陣列，每個空格一個答案）、英語可選 `writingGuide: four-line` | 題幹用 `___` 標記空格 |
| `personal-response` | `writingGuide: four-line`、選填 `sampleAnswer` | 英語個人問答；範例不是唯一答案 |
| `char-to-zhuyin` | 只有 `stem`，沒有 `answer` | 題幹中的注音標注就是要考的字（至少一個）：試卷上該字加底線，後面留注音作答格，寬度依注音組數 |
| `zhuyin-to-char` | 只有 `stem`，沒有 `answer` | 題幹中的注音標注就是要考的字（至少一個）：試卷上該字換成空白作答格（每字一格），注音以 ruby 顯示在格子上方 |
| `make-sentence` | `answer`（範例句子，非空字串） | `stem` 寫說明與詞語；題幹下方留預設行數的作答行（預設 2 行，見 `src/domain/answer-space.ts`），答案卷在行上以紅字顯示範例句子 |
| `imitate-sentence` | `example`（例句，非空字串）、`answer`（範例句子，非空字串） | 題幹下方另起一行顯示「例句：…」，再留同造句的作答行 |
| `horizontal-calc` | `answer`（字串或數字，可含數學式） | `stem` 寫算式與結尾的等號，例如 `$36 + 48 =$`；題幹後接一條答案底線，下方留計算區（預設 2 行，見 `src/domain/answer-space.ts`），答案卷在底線上以紅字顯示答案 |
| `vertical-calc` | `operands`（2 個以上非負數字，字串或數字，只含數字與最多一個小數點）、`operator`（`+`、`-`、`×`）、`answer`（數字，字串或數字） | `stem` 寫說明（如「用直式計算。」）；運算元排成直式，每個數字一格：加減法依小數點對齊，乘法靠右對齊；運算子在最後一個運算元列的最左欄，其下一條橫線，再留答案列（預設 1 列，見 `src/domain/answer-space.ts`），答案卷在答案列以紅字顯示。題庫檢查會以精確運算核對 `answer`（以數值比較，`12.50` 等於 `12.5`），減法結果不可為負 |
| `word-problem` | `answer`（答句，不含「答：」前綴，可含數學式） | 題幹下方是標有「算式：」的框線計算區（預設 4 行，見 `src/domain/answer-space.ts`），再接「答：」與一條橫線；答案卷在橫線上以紅字顯示答句 |

`choice`、`multi-select` 的各選項與 `table-fill` 的各欄標題，可寫非空字串，或 `{ text, image }` 物件；物件的 `text`、`image` 至少一個有值。`text` 同其他富文字欄位支援注音與數學式；`image` 使用下方「附圖與作答空間」的路徑與替代文字規則。圖示空格與表格儲存格的答案可寫非空字串或數字，文字也支援注音與數學式。一個完整圖題或表格保留為一題，不拆成各空格獨立的題目。

原題的 `source` 含 `originalPaper`（原卷名稱），並至少有 `section` 或 `number` 其中一個：`section` 保存原卷大題的完整標題、說明與配分文字；`number` 只記原印的小題號，沒有印小題號就省略。新題改用 `derivedFrom` 列出原題 ID，兩者擇一。以下是一個完整自然題庫檔的例子（圖片須先放到對應路徑）：

```yaml
questions:
  - no: 1
    type: multi-select
    subject: 自然
    grade: 3
    unit: 植物
    stem: "哪些是植物的部位？"
    options:
      - "根"
      - text: "葉"
        image: { src: "sample-science/leaf.png", alt: "一片葉子" }
      - image: { src: "sample-science/wing.png", alt: "鳥的翅膀" }
    answer: [1, 2]
    explanation: "植物具有根和葉。"
    source:
      originalPaper: 三年級自然練習
      section: "一、勾選題（每題 4 分，共 20 分）"
      number: 1
  - no: 2
    type: diagram-label
    subject: 自然
    grade: 3
    unit: 植物
    stem: "在圖中的空格填入植物部位名稱。"
    image: { src: "sample-science/plant.png", alt: "植物構造圖，葉片旁有一個空格" }
    labels:
      - { x: 60, y: 20, width: 25, height: 10, answer: "葉" }
    explanation: "葉片是圖中扁平、展開的部位。"
    source:
      originalPaper: 三年級自然練習
      section: "二、填寫植物構造（每格 2 分，共 10 分）"
  - no: 3
    type: table-fill
    subject: 自然
    grade: 3
    stem: "填寫觀察結果。"
    columns:
      - "水"
      - image: { src: "sample-science/stone.png", alt: "一顆石頭" }
    rows:
      - label: "是否有固定形狀"
        answers: ["沒有", "有"]
    explanation: "水會隨容器改變形狀，石頭有固定形狀。"
    source:
      originalPaper: 三年級自然練習
      section: "三、觀察表（每格 2 分，共 4 分）"
```

填空題的空格數必須等於 `answer` 的長度，且至少一個空格，答案依空格出現的順序排列，例如：

```yaml
- no: 27
  type: fill-blank
  stem: "3 公尺 = ___ 公分；1 公里 = ___ 公尺。"
  answer: ["300", "1000"]
```

試卷上空格渲染成底線，寬度依該空格答案的字數決定，不會印出 `___`；答案卷把答案以紅字填在底線上，底線寬度不變。

英語填空題如需練習字母或單字書寫，可選填 `writingGuide: four-line`，將每個空格印成四線格；未填時仍是一般底線。四線格答案限英文字母及詞間空格，題幹中的換行會保留。答案卷的電腦字型供核對字母內容，筆畫與位置仍須依書寫要求判斷。每題的大小寫順序與評分方式仍應寫在題幹或大題標題，讓讀題的人能看見。

英語個人問答使用 `personal-response`、必填 `writingGuide: four-line`，不填固定 `answer`。每題預設留一組全寬四線格；選填 `space` 可指定組數，至少一組。答案卷顯示「依個人情況作答」，選填的 `sampleAnswer` 會標示為範例，允許數字、姓名與標點，不能當成唯一正解。題目不儲存學生的個人回答。

舊版程式不認得這個題型；如需回復舊版，先移除新題型的試卷引用與題庫資料，再回復程式。

```yaml
- no: 1
  type: personal-response
  subject: 英語
  grade: 3
  writingGuide: four-line
  stem: "What is your name?"
  sampleAnswer: "My name is Amy."
  explanation: "依自己的姓名回答。"
  source: { originalPaper: "三年級英語練習", number: 1 }
```

```yaml
- no: 1
  type: fill-blank
  subject: 英語
  grade: 3
  writingGuide: four-line
  stem: "依字母順序寫出大小寫：Aa ___ Cc"
  answer: ["Bb"]
  explanation: "Aa、Bb、Cc 依字母順序排列。"
  source: { originalPaper: "三年級英語練習", number: 1 }
```

### 英語題

科目為 `英語` 的題目內容與共用材料標示 `lang="en"`，以 Arial、Helvetica Neue 與既有中文字型備援呈現；採系統字型，無需連線載入。題號、中文標籤、全形作答括號、試卷抬頭與姓名／日期／配分等外框仍沿用中文。其他科目的字型不變，英語內容裡的中文也可照常用 `[圈選|ㄑㄩㄢ ㄒㄩㄢˇ]` 標注音。

要印出 `[is|are]`，寫成 `\\[is|are]` 跳脫左方括號；未跳脫的語法仍按注音規則檢查。英文填空沿用 `___`，英語半形字元各保留 1em，加上原有留白，以容納大寫 W／M；其他科目的空格估算不變。

自編範例見 `examples/bank/sample-english.yaml` 與 `examples/papers/sample-english.yaml`，包含填空、混合題型題組、中文注音及方括號跳脫。

### 配對題

`left` 保存各左側題目的 `content` 與答案代號 `answer`，`right` 是共用答案池，每個項目有 `code` 與 `content`。兩側各至少一項，數量可以不同；同一代號可以被多次引用，答案池也可以有未使用的項目。整道配對題只占一個題號。

固定一對一連線時加上 `mode: one-to-one`：兩欄須有相同的 2 至 10 項，每個答案代號恰好使用一次，同欄文字或圖片不可重複。題目仍使用相同的 `left[{content, answer}]` 與 `right[{code, content}]` 格式；試卷保留編號與連線板，答案卷另列配對答案。未指定 `mode` 時沿用一般答案池規則。

`content` 沿用選項格式：可直接寫支援注音與數學式的文字，或以 `{ text?, image? }` 提供文字、圖片或兩者；圖片沿用題庫內的相對路徑及替代文字規則。兩欄與題目本身的附圖都會由 `check:bank` 檢查是否存在，包含未使用的答案池項目。

代號與答案都必須是非空字串，解析時去除前後空白並做 Unicode NFC 正規化，保留大小寫差異。答案池代號不可重複，每個 `answer` 必須指向存在的代號。代號原樣顯示，不解析 HTML、注音或數學式；重排答案池不需調整答案引用。

試卷以兩欄與朝內的黑點提供連線位置；答案卷在每個左側題目旁顯示對應代號，並在整題下方顯示解析。兩種模式都保留兩欄內容與連線空間，不自動畫連線。長代號可以換行；列印時應核對配對區與圖片完整可讀。

```yaml
questions:
  - no: 1
    type: matching
    subject: 社會
    grade: 3
    stem: "將活動與適合的場所連起來，同一場所可重複使用。"
    left:
      - { content: "寄信。", answer: "A" }
      - { content: "借書。", answer: "B" }
      - { content: "在館內閱讀報紙。", answer: "B" }
    right:
      - code: "A"
        content:
          image: { src: "sample-social/post-office.svg", alt: "郵局建築示意圖" }
      - { code: "B", content: "圖書館" }
      - { code: "C", content: "公園" }
    explanation: "寄信到郵局；借書與閱讀館內報紙可在圖書館進行。"
    source: { originalPaper: "自編社區活動", number: 1 }
```

完整圖文範例見 `examples/bank/sample-social.yaml` 的第 8 題，以及 `examples/papers/sample-social.yaml`。

### 分類題

一題分類題包含多個敘述與至少兩個類別。每個類別有 `name`（名稱）與 `symbol`（作答符號）；每個敘述有 `text` 與 `answer`，答案是 `categories` 陣列中從 1 起算的編號。可以重複選用同一類別，不要求每個類別都被使用；類別數沒有固定上限。調整類別順序時，必須同步調整答案編號。

名稱、符號與敘述不可為空白。類別名稱與作答符號分別在去除前後空白及 Unicode NFC 正規化後檢查重複。名稱與敘述沿用注音、數學式語法；`symbol` 是原樣顯示的識別文字，不解析注音、數學式或 HTML。

試卷先列出類別及符號，再為每個敘述留一個作答括號；答案卷在原括號內顯示對應符號，並在整題下方顯示解析。無論有幾個敘述，都只占一個題號。任意題型共用的附圖、疑點、來源及額外作答空間規則照常適用。

```yaml
questions:
  - no: 1
    type: classification
    subject: 社會
    grade: 3
    stem: "依活動場域填入對應符號。"
    categories:
      - { name: "家庭生活", symbol: "△" }
      - { name: "學校生活", symbol: "○" }
      - { name: "社區生活", symbol: "□" }
    statements:
      - { text: "和家人一起整理客廳。", answer: 1 }
      - { text: "參加班會討論。", answer: 2 }
      - { text: "參加社區清潔活動。", answer: 3 }
    explanation: "家務、班會與社區清潔，分別屬於家庭、學校及社區生活。"
    source: { originalPaper: "自編社會練習", number: 1 }
```

完整範例見 `examples/bank/sample-social.yaml` 的第 7 題，以及 `examples/papers/sample-social.yaml`。

### 共用閱讀或排序材料的題組

一份題庫檔可在 `questions` 旁加 `groups`。每個題組用檔內不重複的正整數 `no`、至少一段非空文字 `paragraphs`、至少一個成員題號 `members` 表示；可選填材料 `source`、`image` 與 `doubt`。成員題號指同一檔的 `questions[].no`，不可重複、不可分屬多組。成員可為不同題型，但須同科目與年級，且各自保留來源與答案；填寫材料 `source` 時，成員須為同一原卷的原題。

試卷仍引用各小題原有的題目 ID，可只選部分，但所選成員必須在同一大題連續排列；材料印在第一個選中成員之前、只印一次，不增加題數。題庫展開任一成員時也顯示材料。材料有 `doubt` 時整組視為有疑點；單題的疑點只影響該題。`list:questions --no-doubt` 會排除材料有疑點的全部成員，避免用於新試卷；已有試卷引用有疑點的材料會逐題警告，但仍可建置。

題組 ID 為「題庫檔名#題組 no」，例如 `sample-social#1`；它只識別共用材料，試卷仍引用小題 ID。重新命名題庫檔或改變題組 `no` 會改變題組 ID。

可參考 `examples/bank/sample-social.yaml` 的題組，以及 `examples/papers/sample-social.yaml` 節選部分成員的試卷。

```yaml
groups:
  - no: 1
    paragraphs: ["小安和小文一起種樹。", "兩人輪流澆水。"]
    members: [1, 2]
    source: { originalPaper: "自編閱讀練習", section: "閱讀" }
questions:
  - no: 1
    type: fill-blank
    subject: 國語
    grade: 3
    stem: "故事中的兩人是___和___。"
    answer: ["小安", "小文"]
    explanation: "小安和小文順序可互換。"
    source: { originalPaper: "自編閱讀練習", section: "閱讀", number: 1 }
  - no: 2
    type: choice
    subject: 國語
    grade: 3
    stem: "兩人做了什麼？"
    options: ["種樹", "蓋房子"]
    answer: 1
    explanation: "短文寫兩人一起種樹。"
    source: { originalPaper: "自編閱讀練習", section: "閱讀", number: 2 }
```

### 題組衍生

新題組以單一字串 `derivedFrom: "原題庫檔名#題組號"` 記錄原題組，並保存新材料與全部新題；材料的 `source` 與 `derivedFrom` 不能同時存在。原題組仍可省略材料 `source`，但其成員都必須是原題。原題組必須存在、本身不是新題組，且材料與所有成員都沒有疑點或圖片。有圖的配對原題也不可衍生新題。

新舊題組的 `members` 數量須相同，依順序逐題對應：新題的 `derivedFrom` 陣列只能包含對應的一個原題 ID。每題的題型、科目、年級、單元（含省略單元）沿用現有衍生規則；整組可以混合題型與單元。不能只衍生部分小題、調錯成員對應、混入別組來源，或在未宣告衍生來源的題組內藏入個別衍生題。完成整組衍生後，試卷仍可節選新題組的部分成員。

例如把上方自編閱讀題庫命名為 `reading.yaml`，新題庫可寫成：

```yaml
groups:
  - no: 1
    derivedFrom: "reading#1"
    paragraphs: ["小美和小明一起打掃教室，兩人輪流擦桌子。"]
    members: [1, 2]
questions:
  - no: 1
    type: fill-blank
    subject: 國語
    grade: 3
    stem: "故事中的兩人是___和___。"
    answer: ["小美", "小明"]
    explanation: "新材料的兩人是小美和小明。"
    derivedFrom: ["reading-01"]
  - no: 2
    type: choice
    subject: 國語
    grade: 3
    stem: "兩人做了什麼？"
    options: ["打掃教室", "蓋房子"]
    answer: 1
    explanation: "新材料寫兩人一起打掃教室。"
    derivedFrom: ["reading-02"]
```

`check:bank` 與建置共用上述檢查，錯誤會列出新題組或小題 ID。材料與題目內容是否相符、是否為新內容，仍須生成時逐題核對；`generate-questions` 以整組產生並驗證，有圖的原題或題組材料沿用該 skill 的不可衍生規則。

### 注音標注

除分類題作答符號與配對題代號外，所有題型的文字欄位（題幹、選項、解析、填空答案、造句的例句與答案）都能在任何字上加注音，寫法是 `[字|注音]`；多字寫成 `[公園|ㄍㄨㄥ ㄩㄢˊ]`，注音以半形空白分隔，組數必須等於字數，每組注音由注音符號（ㄅ–ㄩ）組成，輕聲 ˙ 只能放最前面，其他聲調（ˊ ˇ ˋ）最多一個且放最後，例如 `ㄉㄜ˙` 要寫成 `˙ㄉㄜ`。字數以字素計，帶異體字選擇符的字算一個字。沒有 `|` 的 `[...]` 一律當一般文字。頁面上每個字渲染成一個 `<ruby>`，注音橫排在字的上方。標注格式有誤（組數不符、非法注音、未閉合）時，題庫檢查與建置會指出題目與欄位。

要寫出字面的 `[`、不被當成標注的開頭，在它前面加反斜線：`圈選 \[is|are]` 會原樣顯示為「圈選 [is|are]」。`\[` 在所有科目、所有文字欄位都適用；單獨的 `]` 本來就是一般文字，不需要跳脫。`\[` 不適用於 `$...$` 數學式內，那裡的內容原樣交給 KaTeX。

```yaml
- no: 8
  type: char-to-zhuyin
  stem: "小明到[公園|ㄍㄨㄥ ㄩㄢˊ]散步。"   # 要考「公園」的注音
- no: 9
  type: imitate-sentence
  stem: "照樣造句。"
  example: "月亮像一個大銀盤掛在天上。"
  answer: "太陽像一顆大火球掛在天上。"
```

### 數學式

除分類題作答符號與配對題代號外，所有題型的文字欄位（題幹、選項、解析、各種 `answer`、例句）都能寫行內數學式：用 `$...$` 包住 LaTeX，例如 `$\frac{3}{4} + \frac{1}{4} =$`；字面的錢字號寫成 `\$`（字面的 `[` 寫成 `\[`，見〈注音標注〉，不適用於 `$...$` 內）。數學式在建置時由 KaTeX 渲染，CSS 與字型都打包在站內，不需要網路。數學式的內容不做注音解析，數學式以外的文字照常支援注音標注。數學式未閉合、空的 `$$`、或 KaTeX 無法解析的 LaTeX，題庫檢查與建置都會指出題目與欄位。填空題答案含數學式時，底線寬度以原始 LaTeX 的長度估算。

```yaml
- no: 29
  type: horizontal-calc
  stem: "$36 + 48 =$"
  answer: 84
- no: 33
  type: vertical-calc
  stem: "用直式計算。"
  operands: ["4.6", "2.75"]
  operator: "+"
  answer: "7.35"
```

### 附圖與作答空間

任一題型都可以附圖（`diagram-label` 必須有圖）：`image: { src: "sample-math/39.svg", alt: "替代文字" }`。`src` 是相對於 `bank/` 的路徑，圖片檔與題庫檔放在一起（建議每個題庫檔一個同名子目錄），副檔名限 png、jpg、jpeg、gif、svg、webp（不分大小寫）；不可是絕對路徑、不可含 `..` 或反斜線。圖片顯示在題幹之後，試卷與答案卷都有，建置時由 `/bank-images/` 端點原樣輸出，不需要網路。引用的圖片不存在時，題庫檢查會指出題庫檔、題目與圖片路徑。選項與表格欄標題中的圖片也使用相同規則，`alt` 必填且非空，應描述可見內容；圖內只保留題目所需的乾淨印刷內容，移除印刷答案、孩子作答及批改標記。圖示標示題的作答框由 `labels` 疊在圖片上，圖片本身的空格須保持未作答。

每個題型有預設作答空間，單位是行；題目可以用 `space`（0 以上的整數）覆寫，預設值與意義集中在 `src/domain/answer-space.ts`：

| 題型 | 預設 | `space` 的意義 |
| --- | --- | --- |
| `make-sentence`、`imitate-sentence` | 2 | 作答行數；至少 1，不可為 0 |
| `horizontal-calc` | 2 | 計算區的高度 |
| `word-problem` | 4 | 算式計算區的高度 |
| `vertical-calc` | 1 | 橫線下方的列數，答案在最後一列；至少 1，不可為 0 |
| 其他題型 | 0 | 題目下方額外留白的高度，0 時不留 |

### 測試

```sh
pnpm check         # 型別檢查
pnpm test          # Vitest：schema 與題庫檢查單元測試、檢查指令測試，與較慢的建置失敗整合測試
pnpm test:e2e      # Playwright：以範例資料建置後測試首頁、題庫、試卷頁與 A4 列印（另以 tests/fixtures/no-unit 建一份到 dist-fixture，測試沒有單元的情形）
```

首次跑 `test:e2e` 前需要 `pnpm exec playwright install chromium`。

### 答案卷與列印

試卷頁上方工具列的切換鈕可在試卷與答案卷之間切換：答案卷把選擇題與是非題的答案以紅字填進作答括號、勾選題在正確選項前打勾、圖示標示題的答案填在圖片原空格、表格題的答案填在原儲存格、分類題的符號填在各敘述的括號內、配對題在左側題目旁顯示代號、填空題的答案填在底線上、國字注音與注音寫國字的答案填在作答格內、造句類的範例句子填在作答行上，並在每題下方顯示解析。載入頁面時一律是試卷，切換狀態不保存。列印跟隨當下的顯示模式：沒切換就印出試卷（不含答案與解析），切換成答案卷後再列印則含答案與解析；工具列本身不會印出。想直接印，可用工具列的「列印」鈕，或從首頁、試卷列表的「列印試卷」「列印答案卷」連結進來（見上面的入口說明）。

## 隱私

原卷照片 / PDF 放在 `inputs/`，已被 `.gitignore` 排除，不會推上 GitHub。正式題庫、附圖與試卷納入 Git，部署會提供答案、解析、來源及圖片（ADR 0001）；封存及操作紀錄不公開。

## 正式部署決策

正式網址採用 `https://examremix.gravito.dev/`。目前已整合正式資料載入、`dev:data`、`build:deploy` 及驗證 CI；託管、手動發布與指定版本回復以[部署決策與操作契約](docs/deployment.md)為準。發布 workflow、帳號／網域設定與上線驗收仍待完成，這份基底不是已上線版本。
