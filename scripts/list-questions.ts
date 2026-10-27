// 列出題目指令：pnpm list:questions [資料目錄] [過濾條件]
// 讀 <資料目錄>/bank/*.yaml，每題輸出一行，欄位以 tab 分隔：
// ID、題型、科目、年級、單元（沒有則 -）、confirmed 或 unconfirmed、題幹（空白與換行壓成一個空格）。
// 過濾條件可組合（AND），同一個旗標重複給值則是 OR：
//   --confirmed  --unconfirmed  --subject <科目>  --grade <年級>  --unit <單元>  --type <題型>  --id <題目 ID>
// schema 不過的題庫檔跳過並在 stderr 提醒執行 check:bank。沒有符合的題目仍以 0 結束；資料目錄不存在或旗標錯誤以 2 結束。
import { parseArgs } from 'node:util';
import { bankFileSchema, deriveQuestionId } from '../src/domain/schema.ts';
import { unitLabel } from '../src/domain/unit.ts';
import { readDataDir, resolveDataDir } from '../src/lib/data-dir.ts';

function fail(message: string): never {
  console.error(message);
  process.exit(2);
}

let args: ReturnType<typeof parseArgs<{ allowPositionals: true; options: typeof options }>>;
const options = {
  confirmed: { type: 'boolean' },
  unconfirmed: { type: 'boolean' },
  subject: { type: 'string', multiple: true },
  grade: { type: 'string', multiple: true },
  unit: { type: 'string', multiple: true },
  type: { type: 'string', multiple: true },
  id: { type: 'string', multiple: true },
} as const;
try {
  args = parseArgs({ args: process.argv.slice(2), options, allowPositionals: true });
} catch (error) {
  fail(`${(error as Error).message}\n用法：pnpm list:questions [資料目錄] [--confirmed] [--unconfirmed] [--subject <科目>] [--grade <年級>] [--unit <單元>] [--type <題型>] [--id <題目 ID>]`);
}
const { values, positionals } = args;
if (positionals.length > 1) fail(`多餘的參數：${positionals.slice(1).join(' ')}`);
for (const grade of values.grade ?? []) {
  if (!/^\d+$/.test(grade)) fail(`--grade 必須是整數：${grade}`);
}

let contents: ReturnType<typeof readDataDir>;
try {
  contents = readDataDir(resolveDataDir(positionals[0]));
} catch (error) {
  fail((error as Error).message);
}

for (const problem of contents.problems) console.error(`${problem}（已跳過，請執行 pnpm check:bank 檢查）`);

/** 沒給這個旗標就全部通過；給了就要符合其中任一個值。 */
const matches = (wanted: string[] | undefined, actual: string) => wanted === undefined || wanted.includes(actual);

for (const { name, file, raw } of contents.banks) {
  const parsed = bankFileSchema.safeParse(raw);
  if (!parsed.success) {
    console.error(`${file}：schema 檢查未通過，已跳過；請執行 pnpm check:bank 檢查`);
    continue;
  }
  for (const q of parsed.data.questions) {
    const id = deriveQuestionId(name, q.no);
    if (
      (values.confirmed && !q.confirmed) ||
      (values.unconfirmed && q.confirmed) ||
      !matches(values.subject, q.subject) ||
      !matches(values.grade, String(q.grade)) ||
      !matches(values.unit, unitLabel(q.unit)) ||
      !matches(values.type, q.type) ||
      !matches(values.id, id)
    ) {
      continue;
    }
    const status = q.confirmed ? 'confirmed' : 'unconfirmed';
    console.log([id, q.type, q.subject, q.grade, unitLabel(q.unit), status, q.stem.replace(/\s+/g, ' ').trim()].join('\t'));
  }
}
