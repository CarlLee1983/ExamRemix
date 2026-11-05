import { deriveQuestionId, type BankFile, type Question } from './schema.ts';

/** 題目 ID → 題目。ID 重複時留下第一個；重複本身由 checkBank 回報。 */
export function buildQuestionIndex(banks: readonly { name: string; data: BankFile }[]): Map<string, Question> {
  const index = new Map<string, Question>();
  for (const bank of banks) {
    for (const question of bank.data.questions) {
      const id = deriveQuestionId(bank.name, question.no);
      if (!index.has(id)) index.set(id, question);
    }
  }
  return index;
}
