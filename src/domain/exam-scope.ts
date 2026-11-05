import type { BankInput, PaperInput } from './bank-check.ts';
import type { Problem } from './problem.ts';
import { buildQuestionIndex } from './question-index.ts';
import { effectiveDoubt, groupMembership } from './question-groups.ts';
import { SUBJECTS, deriveQuestionId, type ExamScope, type Question } from './schema.ts';

export interface FullScope extends ExamScope {
  grade: number;
  subject: (typeof SUBJECTS)[number];
}

export const SUPPORTED_SCOPES: readonly FullScope[] = SUBJECTS.map(subject => ({
  grade: 3, semester: 1, stage: 'midterm', subject,
}));

export function fullScope(value: Pick<Question, 'grade' | 'subject' | 'examScope'>): FullScope | undefined {
  return value.examScope ? { grade: value.grade, subject: value.subject, ...value.examScope } : undefined;
}

export function sameScope(a: FullScope | undefined, b: FullScope | undefined): boolean {
  return a !== undefined && b !== undefined && a.grade === b.grade && a.subject === b.subject && a.semester === b.semester && a.stage === b.stage;
}

export function supportedScope(scope: FullScope): boolean {
  return SUPPORTED_SCOPES.some(s => sameScope(s, scope));
}

/** 針對已通過 schema 的完整資料快照判定；資料錯誤由 checkBank 阻擋使用。 */
export function assessScopes(banks: readonly BankInput[], papers: readonly PaperInput[]) {
  const index = buildQuestionIndex(banks);
  const membership = groupMembership(banks);
  const questions = new Map<string, string[]>();
  const paperReasons = new Map<string, string[]>();
  const problems: Problem[] = [];
  const groupReasons = new Map<string, string[]>();
  const questionFiles = new Map<string, string>();
  for (const bank of banks) for (const q of bank.data.questions) questionFiles.set(deriveQuestionId(bank.name, q.no), bank.file);
  for (const [id, member] of membership) {
    if (groupReasons.has(member.id)) continue;
    const bank = banks.find(b => member.id === `${b.name}#${member.group.no}`)!;
    const members = member.group.members.map(no => index.get(deriveQuestionId(bank.name, no)));
    const known = members.flatMap(q => q && fullScope(q) ? [fullScope(q)!] : []);
    const reasons: string[] = [];
    if (known.length !== members.length) reasons.push(`題組 ${member.id} 考試範圍未知`);
    if (known.some(s => !sameScope(s, known[0]))) {
      reasons.push(`題組 ${member.id} 成員考試範圍衝突`);
      problems.push({severity:'error',files:[questionFiles.get(id)!],message:reasons.at(-1)!});
    }
    groupReasons.set(member.id, reasons);
  }
  for (const [id, q] of index) {
    const reasons: string[] = [];
    if (!fullScope(q)) reasons.push('考試範圍未知');
    const group = membership.get(id);
    if (group) reasons.push(...(groupReasons.get(group.id) ?? []));
    const doubt = effectiveDoubt(q, group);
    if (doubt !== undefined) reasons.push(`有疑點：${doubt}`);
    for (const originalId of q.derivedFrom ?? []) {
      const original = index.get(originalId);
      const a = fullScope(q), b = original && fullScope(original);
      const sourceGroup = membership.get(originalId);
      const unknownGroup = sourceGroup && groupReasons.get(sourceGroup.id)?.length;
      if (!original || !sameScope(a,b) || unknownGroup) {
        reasons.push(`原題 ${originalId} 考試範圍未知或不一致`);
        // 完全未分類的歷史資料可保留供遷移；任一端開始分類後必須維持來源鏈一致。
        if (original && (a || b)) problems.push({severity:'error',files:[questionFiles.get(id)!],questionId:id,message:`新題 ${id} 與原題 ${originalId} 考試範圍未知或不一致`});
      }
    }
    questions.set(id, [...new Set(reasons)]);
  }
  for (const paper of papers) {
    const scope = fullScope(paper.data);
    const reasons: string[] = [];
    if (!scope) reasons.push('試卷考試範圍未知');
    else if (!supportedScope(scope)) reasons.push('試卷考試範圍未支援');
    for (const id of paper.data.sections.flatMap(s => s.questions)) {
      const q = index.get(id);
      if (!q) reasons.push(`${id} 不存在`);
      else {
        reasons.push(...(questions.get(id) ?? []).map(r => `${id}：${r}`));
        if (scope && fullScope(q) && !sameScope(scope,fullScope(q))) reasons.push(`${id} 與試卷考試範圍不一致`);
      }
    }
    paperReasons.set(paper.file, [...new Set(reasons)]);
  }
  return { questions, papers: paperReasons, problems, index, membership };
}

/** 尚無完整卷配置時只回報可選容量，不能推算完整卷數。 */
export function scopeStatus(report: ReturnType<typeof assessScopes>, scope: FullScope) {
  const supported = supportedScope(scope);
  const ids = new Set([...report.index].filter(([id,q]) => sameScope(fullScope(q),scope) && report.questions.get(id)?.length === 0).map(([id]) => id));
  const groups = new Set([...report.membership.values()].filter(m => m.group.members.every(no => ids.has(deriveQuestionId(m.id.split('#')[0]!, no)))).map(m=>m.id)).size;
  return { scope, state: !supported ? 'unsupported' as const : ids.size === 0 ? 'empty' as const : 'unconfigured' as const, count: supported ? ids.size : 0, groups: supported ? groups : 0 };
}
