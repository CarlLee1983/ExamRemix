import { deriveQuestionId, type BankFile, type Question, type QuestionGroup } from './schema.ts';

export interface GroupMembership {
  /** 題組 ID 只供識別共用材料，不是試卷引用的題目 ID。 */
  id: string;
  group: QuestionGroup;
}

/** 題目 ID → 題組，使用完整題目 ID 避免不同題庫的本地題號碰撞。 */
export function groupMembership(banks: readonly { name: string; data: BankFile }[]): Map<string, GroupMembership> {
  const result = new Map<string, GroupMembership>();
  for (const bank of banks) {
    for (const group of bank.data.groups ?? []) {
      const membership = { id: `${bank.name}#${group.no}`, group };
      for (const no of group.members) result.set(deriveQuestionId(bank.name, no), membership);
    }
  }
  return result;
}

/** 材料有疑點時整組都有疑點；單題疑點不影響其他成員。 */
export function effectiveDoubt(question: Question, membership?: GroupMembership): string | undefined {
  const doubts = [question.doubt, membership?.group.doubt === undefined ? undefined : `題組材料：${membership.group.doubt}`].filter((doubt): doubt is string => doubt !== undefined);
  return doubts.length ? doubts.join('；') : undefined;
}

/** 保留試卷順序，在整份試卷第一個選中的成員之前提供材料。 */
export function resolvePaperGroups<T extends { questions: readonly string[] }>(
  sections: readonly T[],
  membership: ReadonlyMap<string, GroupMembership>,
): Array<T & { materials: Array<GroupMembership | undefined> }> {
  const seen = new Set<string>();
  return sections.map((section) => ({
    ...section,
    materials: section.questions.map((id) => {
      const group = membership.get(id);
      if (!group || seen.has(group.id)) return undefined;
      seen.add(group.id);
      return group;
    }),
  }));
}
