// 題庫檢查模組的跨檔規則：題目 ID 不可重複、附圖要存在、新題的衍生規則、試卷只能引用存在的題目、疑點（ADR 0003）。
// 純函式，輸入是已通過 schema 的題庫檔與試卷檔，不讀檔、不依賴 Astro（ADR 0002）。
import { hasDoubt } from './doubt.ts';
import { fileNameProblem } from './file-name.ts';
import type { Problem } from './problem.ts';
import { deriveQuestionId, type BankFile, type PaperFile, type Question, type VisualText } from './schema.ts';

/** 題庫檔：name 是題庫檔名（不含副檔名，用來組題目 ID），file 是相對於資料根目錄的路徑。 */
export interface BankInput {
  name: string;
  file: string;
  data: BankFile;
}

/** 試卷檔：file 是相對於資料根目錄的路徑。 */
export interface PaperInput {
  file: string;
  data: PaperFile;
}

const byFile = (a: { file: string }, b: { file: string }) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0);

/** 題目 ID → 題目。ID 重複時留下第一個；重複本身由 checkBank 回報。 */
export function buildQuestionIndex(banks: readonly Pick<BankInput, 'name' | 'data'>[]): Map<string, Question> {
  const index = new Map<string, Question>();
  for (const bank of banks) {
    for (const question of bank.data.questions) {
      const id = deriveQuestionId(bank.name, question.no);
      if (!index.has(id)) index.set(id, question);
    }
  }
  return index;
}

// 新題必須與原題一致的欄位；單元以「含沒有」比較
const INHERITED_FIELDS = [
  ['type', '題型'],
  ['subject', '科目'],
  ['grade', '年級'],
  ['unit', '單元'],
] as const;

const show = (value: string | number | undefined) => (value === undefined ? '無' : String(value));

/** 包括題目附圖、選項圖與表格欄標題圖；標示圖使用共通的 image 欄位。 */
function imageReferences(question: Question): string[] {
  const paths = question.image ? [question.image.src] : [];
  const add = (content: VisualText) => {
    if (typeof content !== 'string' && content.image) paths.push(content.image.src);
  };
  if (question.type === 'choice' || question.type === 'multi-select') question.options.forEach(add);
  if (question.type === 'table-fill') question.columns.forEach(add);
  return [...new Set(paths)];
}

/** 兩題在 INHERITED_FIELDS 中不一致的欄位，回傳「欄位（甲 值，乙 值）」。 */
function mismatches(a: Question, b: Question, aLabel: string, bLabel: string): string[] {
  return INHERITED_FIELDS.filter(([key]) => a[key] !== b[key]).map(
    ([key, label]) => `${label}（${aLabel} ${show(a[key])}，${bLabel} ${show(b[key])}）`,
  );
}

/**
 * 回傳所有問題（試卷引用有疑點的題目是警告，其餘是錯誤）；沒有錯誤代表通過。順序固定：先檔名不合格，再題目 ID 重複，再附圖不存在，
 * 再新題的衍生規則（依題庫檔、題目順序），最後依試卷檔、大題、題目順序。
 * images 是 bank/ 底下所有圖片檔相對於 bank/ 的路徑。
 */
export function checkBank(input: {
  banks: readonly BankInput[];
  papers: readonly PaperInput[];
  images: readonly string[];
}): Problem[] {
  const banks = [...input.banks].sort(byFile);
  const papers = [...input.papers].sort(byFile);
  const problems: Problem[] = [];
  const addError = (problem: Omit<Problem, 'severity'>) => problems.push({ severity: 'error', ...problem });
  const addWarning = (problem: Omit<Problem, 'severity'>) => problems.push({ severity: 'warning', ...problem });

  // 檔名不合格的檔案
  for (const { file } of [...banks, ...papers].sort(byFile)) {
    const reason = fileNameProblem(file.slice(file.lastIndexOf('/') + 1));
    if (reason) addError({ files: [file], message: `檔名不合格：${reason}` });
  }

  // 真正的防線是檔名規則（題庫名取自合格的檔名，不同檔案不會組出同一個 ID）；
  // 這條規則是純函式層的保證，輸入若仍出現重複 ID 就如實回報。
  const filesById = new Map<string, string[]>();
  for (const bank of banks) {
    for (const question of bank.data.questions) {
      const id = deriveQuestionId(bank.name, question.no);
      filesById.set(id, [...(filesById.get(id) ?? []), bank.file]);
    }
  }
  for (const [id, files] of filesById) {
    if (files.length > 1) {
      addError({
        files,
        questionId: id,
        message: `題目 ID ${id} 重複`,
      });
    }
  }

  const images = new Set(input.images);
  for (const bank of banks) {
    for (const question of bank.data.questions) {
      for (const src of imageReferences(question)) {
        if (images.has(src)) continue;
        const id = deriveQuestionId(bank.name, question.no);
        addError({
          files: [bank.file],
          questionId: id,
          message: `題目 ${id} 找不到附圖 ${src}（圖片要放在 bank/ 底下，路徑相對於 bank/）`,
        });
      }
    }
  }

  const index = buildQuestionIndex(banks);

  // 衍生規則：新題只能衍生自沒有疑點的原題，且題型、科目、年級、單元都與原題一致
  for (const bank of banks) {
    for (const question of bank.data.questions) {
      if (!question.derivedFrom) continue;
      const id = deriveQuestionId(bank.name, question.no);
      const report = (message: string) => addError({ files: [bank.file], questionId: id, message });
      const originals: [string, Question][] = [];
      for (const originalId of question.derivedFrom) {
        const original = index.get(originalId);
        if (!original) {
          report(`新題 ${id} 衍生自不存在的原題 ${originalId}`);
          continue;
        }
        originals.push([originalId, original]);
        if (hasDoubt(original)) report(`新題 ${id} 衍生自有疑點的原題 ${originalId}：${original.doubt}（請先解除原題的疑點，或改從其他原題衍生）`);
        if (original.derivedFrom) report(`新題 ${id} 衍生自 ${originalId}，但它也是新題；新題只能衍生自原題`);
        const diff = mismatches(question, original, '新題', '原題');
        if (diff.length > 0) report(`新題 ${id} 與原題 ${originalId} 的${diff.join('、')}不一致`);
      }
      // 多個原題之間，以第一個為準比對其餘，列出不一致的欄位聯集
      const [first, ...others] = originals;
      if (first && others.length > 0) {
        const fields = INHERITED_FIELDS.filter(([key]) => others.some(([, other]) => other[key] !== first[1][key])).map(
          ([, label]) => label,
        );
        if (fields.length > 0) {
          const ids = originals.map(([originalId]) => originalId).join('、');
          report(`新題 ${id} 衍生自的原題 ${ids} 彼此不一致（${fields.join('、')}）；以 ${first[0]} 為準比對`);
        }
      }
    }
  }

  for (const paper of papers) {
    for (const section of paper.data.sections) {
      for (const id of section.questions) {
        const question = index.get(id);
        if (!question) {
          addError({ files: [paper.file], questionId: id, message: `試卷引用了不存在的題目 ID ${id}` });
        } else if (hasDoubt(question)) {
          // 已組好的試卷引用到有疑點的題目只提出警告，不讓建置停擺
          addWarning({
            files: [paper.file],
            questionId: id,
            message: `試卷引用了有疑點的題目 ${id}：${question.doubt}`,
          });
        }
      }
    }
  }

  return problems;
}
