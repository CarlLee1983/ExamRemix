// 首頁、試卷列表與題庫瀏覽共用的建置期計算：試卷列資料、題目用於哪些試卷。
import { compareIds } from './schema.ts';

interface PaperLike {
  id: string;
  data: {
    title: string;
    subject: string;
    grade: number;
    sections: readonly { questions: readonly string[] }[];
  };
}

export interface PaperRow {
  id: string;
  title: string;
  subject: string;
  grade: number;
  count: number;
  /** 大題數 */
  sections: number;
}

/** 試卷列表的每列資料（題數是各大題題數的總和），依試卷 ID 排序。 */
export function paperRows(papers: readonly PaperLike[]): PaperRow[] {
  return papers
    .map(({ id, data }) => ({
      id,
      title: data.title,
      subject: data.subject,
      grade: data.grade,
      count: data.sections.reduce((sum, section) => sum + section.questions.length, 0),
      sections: data.sections.length,
    }))
    .sort((a, b) => compareIds(a.id, b.id));
}

/** 題目 ID → 用到它的試卷標題（依試卷 ID 排序、同一份只記一次）；沒被引用的題目不在表內。 */
export function paperTitlesByQuestion(papers: readonly PaperLike[]): Map<string, string[]> {
  const usage = new Map<string, string[]>();
  for (const { data } of [...papers].sort((a, b) => compareIds(a.id, b.id))) {
    for (const questionId of new Set(data.sections.flatMap((section) => section.questions))) {
      usage.set(questionId, [...(usage.get(questionId) ?? []), data.title]);
    }
  }
  return usage;
}
