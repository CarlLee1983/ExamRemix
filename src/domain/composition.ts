// 題庫組成：每個科目的題數，以及各題型的題數（首頁的題庫組成條用）。
import { SUBJECTS } from './schema.ts';
import type { Question } from './schema.ts';
import { TYPE_LABELS } from './type-labels.ts';

export interface SubjectComposition {
  subject: string;
  count: number;
  /** 各題型題數，依 TYPE_LABELS 的順序，只含有題目的題型 */
  types: { type: Question['type']; label: string; count: number }[];
}

/** 依 SUBJECTS 的順序回傳有題目的科目；沒有題目的科目不出現。 */
export function bankComposition(entries: readonly { question: Pick<Question, 'subject' | 'type'> }[]): SubjectComposition[] {
  const typeOrder = Object.keys(TYPE_LABELS) as Question['type'][];
  return SUBJECTS.flatMap((subject) => {
    const own = entries.filter((e) => e.question.subject === subject);
    if (own.length === 0) return [];
    const types = typeOrder
      .map((type) => ({ type, label: TYPE_LABELS[type], count: own.filter((e) => e.question.type === type).length }))
      .filter((t) => t.count > 0);
    return [{ subject, count: own.length, types }];
  });
}
