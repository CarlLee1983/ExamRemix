import { createHash, randomUUID } from 'node:crypto';
import { existsSync, linkSync, mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { parse } from 'yaml';
import { z } from 'astro/zod';
import { checkBank, buildQuestionIndex } from '../domain/bank-check.ts';
import { assessScopes, fullScope, sameScope, supportedScope, type FullScope } from '../domain/exam-scope.ts';
import { imageReferences } from '../domain/bank-check.ts';
import { groupMembership } from '../domain/question-groups.ts';
import { fileNameProblem } from '../domain/file-name.ts';
import { bankFileSchema, paperFileSchema, deriveQuestionId } from '../domain/schema.ts';
import { readDataDir } from './data-dir.ts';
import { acquireBank, canonicalRoot, durableWrite, syncDirectory, type BankLease } from './bank-access.ts';

export const hash = (content: string | Buffer) => createHash('sha256').update(content).digest('hex');
const text = z.string().trim().min(1);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const evidenceSchema = z.object({
  id: text, attempt: z.number().int().min(1).max(3), decision: z.enum(['accept', 'reject']), reviewer: text,
  solution: text, independentCheck: text, difficulty: text, uniqueness: text, explanation: text,
  leakage: text, nearDuplicates: text,
}).strict();
const requestSchema = z.object({
  contractVersion: z.literal('question-batch-v1'), batchId: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  dataDir: text, target: text, candidate: text, candidateHash: digest, targetHash: digest, pendingHash: digest,
  sourceIds: z.array(text).min(1), scope: z.object({ grade: z.number().int(), subject: text,
    semester: z.union([z.literal(1), z.literal(2)]), stage: z.enum(['midterm', 'final']) }).strict(),
  batchScope: text, quantity: z.object({ count: z.number().int().positive(), unit: z.enum(['questions', 'groups']) }).strict(),
  constraints: text, evidence: z.array(evidenceSchema).min(1),
}).strict();
type Request = z.infer<typeof requestSchema>;
interface Result { state: 'published' | 'reverted'; batchId: string; target: string; ids: string[]; groups: string[]; added: number; warnings: string[] }
interface RecordData {
  request: Request; fingerprint: string; candidate: string; result?: Result; error?: string;
  phase?: 'validated' | 'failed';
  withdrawal?: boolean;
  validation?: { targetManifest: string[][]; sources: { file: string; content: string; hash: string }[]; warnings: string[] };
}
const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.entries(value).filter(([,v]) => v !== undefined).sort(([a],[b]) => a.localeCompare(b)).map(([k,v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
  return JSON.stringify(value);
};
function recordPath(control: string, id: string) { return join(control, 'batches', id, 'record.json'); }
function readRecord(path: string): RecordData {
  const envelope = JSON.parse(readFileSync(path, 'utf8'));
  if (hash(canonical(envelope.data)) !== envelope.hash) throw new Error(`操作紀錄損毀：${path}`);
  const data = envelope.data as RecordData;
  requestSchema.parse(data.request);
  if (hash(data.candidate) !== data.request.candidateHash || fingerprint(data.request) !== data.fingerprint) throw new Error(`紀錄內容衝突：${path}`);
  return data;
}
function saveRecord(control: string, data: RecordData) {
  const path = recordPath(control, data.request.batchId);
  const encoded=JSON.stringify({ hash: hash(canonical(data)), data });
  if (!existsSync(dirname(path))) {
    mkdirSync(join(control,'batches'),{recursive:true,mode:0o700});
    syncDirectory(control);
    // Incomplete initial records never enter the authoritative batch index.
    const stage=join(control,`prepare-${randomUUID()}`);
    mkdirSync(stage,{mode:0o700});
    syncDirectory(control);
    durableWrite(join(stage,'record.json'),encoded);
    renameSync(stage,dirname(path));
    syncDirectory(join(control,'batches'));
    syncDirectory(control);
    return;
  }
  const temp = `${path}.next`;
  // A previous interrupted replacement is never authoritative; the complete record is.
  if (existsSync(temp)) unlinkSync(temp);
  durableWrite(temp, encoded);
  renameSync(temp, path);
  syncDirectory(dirname(path));
}
function fingerprint(r: Request) {
  return hash(canonical({ contractVersion: r.contractVersion, dataDir: r.dataDir, scope: r.scope,
    batchScope: r.batchScope, sourceIds: [...new Set(r.sourceIds)].sort(), sourceVersion: r.targetHash,
    quantity: r.quantity, constraints: r.constraints }));
}
function records(control: string) {
  const dir = join(control, 'batches');
  return existsSync(dir) ? readdirSync(dir).sort().map(id => readRecord(recordPath(control, id))) : [];
}
function snapshot(root: string, omit?: string) {
  const contents = readDataDir(root);
  if (contents.problems.length) throw new Error(contents.problems.map(p=>`${p.files}: ${p.message}`).join('\n'));
  const banks = contents.banks.filter(b=>b.name !== omit).map(b=>({name:b.name,file:b.file,data:bankFileSchema.parse(b.raw)}));
  const papers = contents.papers.map(p=>({file:p.file,data:paperFileSchema.parse(p.raw)}));
  const files = [...contents.banks.filter(b=>b.name !== omit), ...contents.papers].map(f=>[f.file,hash(readFileSync(f.path))]);
  for (const image of contents.images) files.push([`bank/${image}`, hash(readFileSync(join(root,'bank',image)))]);
  const manifest=files.sort(([a],[b])=>a!.localeCompare(b!));
  return { banks, papers, images: contents.images, manifest, targetHash: hash(canonical(manifest)) };
}
function pending(control: string, omit?: string) {
  return records(control).filter(r=>r.request.batchId !== omit && !r.result && r.phase!=='failed').map(r=>({batchId:r.request.batchId, candidateHash:r.request.candidateHash, candidate:r.candidate}));
}
export function checkManagedRoot(root: string) {
  const problems=checkBank(snapshot(root));
  if (problems.some(p=>p.severity==='error')) throw new Error(problems.map(p=>`${p.files}: ${p.message}`).join('\n'));
}
export function inspectBatchRoot(root: string) {
  const lease=acquireBank(root,'read');
  const previous=process.env.EXAMREMIX_BANK_LEASE;
  process.env.EXAMREMIX_BANK_LEASE=lease.token;
  try {
    const view=snapshot(lease.root);
    const waiting=pending(lease.control);
    return {dataDir:lease.root,targetHash:view.targetHash,pendingHash:hash(canonical(waiting)),
      sourceIds:[...buildQuestionIndex(view.banks)].filter(([,q])=>q.source).map(([id])=>id), pending:waiting};
  } finally { restoreEnv(previous); lease.release(); }
}
function restoreEnv(value: string | undefined) {
  if (value === undefined) delete process.env.EXAMREMIX_BANK_LEASE;
  else process.env.EXAMREMIX_BANK_LEASE=value;
}
function assertOutside(root: string, path: string) {
  const rel=relative(root,path);
  if (rel === '' || (!rel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) && !isAbsolute(rel))) throw new Error('候選及操作檔必須位於資料根目錄外');
}
function validate(root: string, control: string, record: RecordData, published: boolean) {
  const r=record.request;
  if (!supportedScope(r.scope as FullScope)) throw new Error('本次考試範圍未支援；不得計入可用容量');
  const name=basename(r.target,'.yaml');
  const candidate=bankFileSchema.parse(parse(record.candidate));
  const view=snapshot(root,published ? name : undefined);
  if (view.targetHash !== r.targetHash) throw new Error('來源／目標版本已變動；舊品質與近重證據失效，請依最新快照重新核對');
  const waiting=pending(control,r.batchId);
  if (hash(canonical(waiting)) !== r.pendingHash) throw new Error('待發布批次已變動；須重新核對品質與近重');
  const banks=[...view.banks,{name,file:`bank/${r.target}`,data:candidate}];
  const problems=checkBank({...view,banks});
  if (problems.some(p=>p.severity==='error')) throw new Error(problems.map(p=>`${p.files}: ${p.message}`).join('\n'));
  const index=buildQuestionIndex(view.banks);
  const membership=groupMembership(view.banks);
  const scope=assessScopes(banks,view.papers);
  const sourceIds=[...new Set(candidate.questions.flatMap(q=>q.derivedFrom ?? []))].sort();
  if (canonical(sourceIds) !== canonical([...new Set(r.sourceIds)].sort())) throw new Error('來源 ID 清單不符');
  for (const id of r.sourceIds) {
    const original=index.get(id);
    if (!original?.source || original.derivedFrom || !sameScope(fullScope(original), r.scope as FullScope)) throw new Error(`${id}：來源缺失或完整範圍不合格`);
    if (imageReferences(original).length || membership.get(id)?.group.image) throw new Error(`${id}：含圖來源不可衍生`);
  }
  if (r.quantity.unit === 'groups' ? candidate.groups?.length !== r.quantity.count || candidate.questions.length !== candidate.groups.flatMap(g=>g.members).length : candidate.questions.length !== r.quantity.count || !!candidate.groups?.length) throw new Error('批次數量／完整題組單位不符');
  const ids=candidate.questions.map(q=>deriveQuestionId(name,q.no));
  const groups=(candidate.groups ?? []).map(g=>`${name}#${g.no}`);
  const required=[...ids,...groups];
  if (canonical(r.evidence.map(e=>e.id).sort()) !== canonical([...required].sort()) || r.evidence.some(e=>e.decision !== 'accept')) throw new Error('缺少逐題／整組必要品質證據，或仍有拒絕判斷');
  for (const q of candidate.questions) {
    const id=deriveQuestionId(name,q.no);
    if (!q.derivedFrom || q.source || scope.questions.get(id)?.length || imageReferences(q).length || !sameScope(fullScope(q),r.scope as FullScope)) throw new Error(`${id}：候選資格／來源／範圍不合格`);
  }
  if (candidate.groups?.some(g=>!g.derivedFrom || g.image || g.doubt)) throw new Error('新材料來源／圖片／疑點不合格');
  // A deterministic filter catches exact content and option/pair order changes.
  // Semantic differences still require the content-bound evidence above.
  const normalize=(q: unknown) => {
    const content={...(q as Record<string,unknown>)};
    for (const key of ['no','source','derivedFrom','explanation','space','doubt']) delete content[key];
    for (const key of ['options','left','right']) if (Array.isArray(content[key])) content[key]=[...content[key]].map(canonical).sort();
    delete content.answer;
    return canonical(content).normalize('NFKC').replace(/[\p{P}\p{Z}\s]/gu,'');
  };
  const others=[...view.banks.flatMap(b=>b.data.questions),...waiting.flatMap(p=>bankFileSchema.parse(parse(p.candidate)).questions)];
  const seen=new Set(others.map(normalize));
  for (const q of candidate.questions) {
    const key=normalize(q);
    if (seen.has(key)) throw new Error(`${deriveQuestionId(name,q.no)}：正規化重複題`);
    seen.add(key);
  }
  const warnings=problems.filter(p=>p.severity==='warning').map(p=>`${p.files}: ${p.message}`);
  const sources=view.banks.filter(b=>b.data.questions.some(q=>r.sourceIds.includes(deriveQuestionId(b.name,q.no)))).map(b=>{
    const content=readFileSync(join(root,b.file),'utf8');
    return {file:b.file,content,hash:hash(content)};
  });
  return {ids,groups,warnings,validation:{targetManifest:view.manifest,sources,warnings}};
}
function clearMaintenance(lease: BankLease) {
  unlinkSync(join(lease.control,'maintenance.json'));
  syncDirectory(lease.control);
}

/** Shared withdrawal for failed publication and explicit user rollback. */
function withdrawalView(lease: BankLease, record: RecordData) {
  const r=record.request;
  const path=join(lease.root,'bank',r.target);
  const quarantine=join(lease.root,`.batch-${r.batchId}.withdrawn`);
  const present=existsSync(path);
  if (present && record.result?.state==='reverted') throw new Error(`撤回衝突：已回復的目的檔重新出現：${path}`);
  if (present ? hash(readFileSync(path))!==r.candidateHash : !record.withdrawal || !existsSync(quarantine) || hash(readFileSync(quarantine))!==r.candidateHash) throw new Error(`撤回衝突：自有檔已變動或遺失：${present ? path : quarantine}`);
  if (present && existsSync(quarantine)) throw new Error(`撤回位置已有內容；停止：${quarantine}`);
  const raw=readDataDir(lease.root);
  if (raw.problems.length) throw new Error(`撤回衝突：無法判定其他檔案引用：${raw.problems.map(p=>`${p.files}: ${p.message}`).join('；')}`);
  const data=bankFileSchema.parse(parse(record.candidate));
  const name=basename(r.target,'.yaml');
  const ids=data.questions.map(q=>deriveQuestionId(name,q.no));
  const groups=(data.groups??[]).map(g=>`${name}#${g.no}`);
  const owned=new Set([...ids,...groups]);
  const references=(value: unknown, location: string): string[] => {
    if (typeof value==='string') return owned.has(value) ? [`${location} → ${value}`] : [];
    if (Array.isArray(value)) return value.flatMap((v,i)=>references(v,`${location}[${i}]`));
    return value !== null && typeof value==='object'
      ? Object.entries(value).flatMap(([key,v])=>references(v,`${location}.${key}`)) : [];
  };
  const conflicts=[...raw.banks.filter(b=>b.name!==name),...raw.papers].flatMap(f=>references(f.raw,f.path));
  if (conflicts.length) throw new Error(`撤回衝突：本批已被其他題庫／試卷引用：\n${conflicts.join('\n')}`);
  return {path,quarantine,present,ids,groups};
}

function withdraw(lease: BankLease, record: RecordData) {
  const r=record.request;
  const {path,quarantine,present,ids,groups}=withdrawalView(lease,record);
  if (present) {
    record.withdrawal=true;
    saveRecord(lease.control,record);
    renameSync(path,quarantine);
  }
  syncDirectory(dirname(path));
  syncDirectory(lease.root);
  record.result={state:'reverted',batchId:r.batchId,target:path,ids,groups,added:0,warnings:[]};
  saveRecord(lease.control,record);
  // Recheck remaining data before permitting readers.
  const remaining=snapshot(lease.root);
  if (checkBank(remaining).some(p=>p.severity==='error')) throw new Error('已撤回本批，但目標仍有其他錯誤；維護標記保留');
  clearMaintenance(lease);
}

export function publishBatch(requestPath: string): Result {
  const request=requestSchema.parse(JSON.parse(readFileSync(requestPath,'utf8')));
  request.dataDir=canonicalRoot(resolve(request.dataDir));
  if (fileNameProblem(request.target) || !request.target.startsWith('new-')) throw new Error('新檔名不合格，必須為 new-*.yaml');
  const lease=acquireBank(request.dataDir,'write',true);
  const previous=process.env.EXAMREMIX_BANK_LEASE;
  process.env.EXAMREMIX_BANK_LEASE=lease.token;
  let record: RecordData | undefined;
  let ownsMaintenance=false;
  let recordAccepted=false;
  try {
    const existing=records(lease.control);
    record=existing.find(r=>r.request.batchId===request.batchId);
    if (record && (record.fingerprint !== fingerprint(request) || record.request.candidateHash !== request.candidateHash || record.request.target !== request.target)) throw new Error('同批請求／候選衝突');
    record ??= existing.find(r=>r.fingerprint===fingerprint(request));
    const durableOwner=record?.phase==='validated' || record?.result!==undefined;
    if (!record) {
      const candidatePath=canonicalRoot(resolve(request.candidate));
      assertOutside(lease.root,candidatePath);
      assertOutside(lease.root,canonicalRoot(resolve(requestPath)));
      const candidate=readFileSync(candidatePath,'utf8');
      if (hash(candidate)!==request.candidateHash) throw new Error('候選內容雜湊不符');
      record={request,fingerprint:fingerprint(request),candidate};
    }
    const r=record.request;
    const marker=join(lease.control,'maintenance.json');
    if (existsSync(marker)) {
      const intent=JSON.parse(readFileSync(marker,'utf8'));
      if (intent.batchId!==r.batchId || intent.fingerprint!==record.fingerprint) throw new Error('其他操作尚待恢復；維護標記保留');
      ownsMaintenance=true;
    }
    recordAccepted=true;
    const destination=join(lease.root,'bank',r.target);
    const present=existsSync(destination);
    if (present && !durableOwner) throw new Error('目的檔已存在且不屬於本批；停止');
    if (present && hash(readFileSync(destination))!==r.candidateHash) throw new Error('目的檔內容衝突；不可覆寫或改名');
    if (record.result?.state==='reverted') {
      if (ownsMaintenance) {
        withdraw(lease,record);
        ownsMaintenance=false;
      } else {
        withdrawalView(lease,record);
        checkManagedRoot(lease.root);
      }
      return record.result!;
    }
    if (record.withdrawal) {
      if (!ownsMaintenance) throw new Error('撤回意圖存在但維護標記遺失；停止');
      withdraw(lease,record);
      ownsMaintenance=false;
      return record.result!;
    }
    if (record.result && !present) throw new Error('已發布檔案遺失；停止');
    if (record.result) {
      if (checkBank(snapshot(lease.root)).some(p=>p.severity==='error')) throw new Error('已發布結果的完整性檢查失敗');
      if (ownsMaintenance) clearMaintenance(lease);
      return record.result;
    }
    const checked=validate(lease.root,lease.control,record,present);
    record.validation=checked.validation;
    record.phase='validated';
    if (!present) {
      // Intent and full candidate are durable before any bank mutation.
      saveRecord(lease.control,record);
      if (!ownsMaintenance) {
        durableWrite(marker,JSON.stringify({batchId:r.batchId,fingerprint:record.fingerprint}));
        ownsMaintenance=true;
      }
      const temp=join(lease.root,`.batch-${r.batchId}.tmp`);
      if (existsSync(temp)) unlinkSync(temp);
      durableWrite(temp,record.candidate);
      try { linkSync(temp,destination); syncDirectory(dirname(destination)); }
      finally { unlinkSync(temp); syncDirectory(lease.root); }
    }
    // Full post-publication view includes the new bank and all papers.
    try {
      const after=snapshot(lease.root);
      const errors=checkBank(after).filter(p=>p.severity==='error');
      if (hash(readFileSync(destination))!==r.candidateHash || errors.length) throw new Error(`發布後檢查失敗：${errors.map(p=>p.message).join('；')}`);
    } catch(error) {
      record.error=[...new Set([record.error,(error as Error).message].filter(Boolean))].join('\n');
      withdraw(lease,record);
      ownsMaintenance=false;
      throw error;
    }
    record.result={state:'published',batchId:r.batchId,target:destination,ids:checked.ids,groups:checked.groups,added:checked.ids.length,warnings:checked.warnings};
    saveRecord(lease.control,record);
    if (ownsMaintenance) clearMaintenance(lease);
    return record.result;
  } catch(error) {
    // Keep uncertain outcomes blocked for recovery; never report a partial success.
    if (record && recordAccepted) {
      record.error=[...new Set([record.error,(error as Error).message].filter(Boolean))].join('\n');
      if (!ownsMaintenance && !record.result) record.phase='failed';
      try { saveRecord(lease.control,record); } catch { /* durable intent remains authoritative */ }
    }
    throw error;
  } finally { restoreEnv(previous); lease.release(); }
}


export function rollbackBatch(root: string, batchId: string): Result {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(batchId)) throw new Error('批次識別不合格');
  const lease=acquireBank(resolve(root),'write',true);
  const previous=process.env.EXAMREMIX_BANK_LEASE;
  process.env.EXAMREMIX_BANK_LEASE=lease.token;
  try {
    const path=recordPath(lease.control,batchId);
    if (!existsSync(path)) throw new Error(`沒有批次紀錄：${batchId}`);
    const record=readRecord(path);
    const r=record.request;
    if (r.dataDir!==lease.root || r.batchId!==batchId || fileNameProblem(r.target) || !r.target.startsWith('new-')) throw new Error('批次紀錄所有權衝突');
    if (!record.result && !record.withdrawal) throw new Error('批次尚未完成發布；請先以原請求恢復');
    const marker=join(lease.control,'maintenance.json');
    if (existsSync(marker)) {
      const intent=JSON.parse(readFileSync(marker,'utf8'));
      if (intent.batchId!==batchId || intent.fingerprint!==record.fingerprint) throw new Error('其他操作尚待恢復；維護標記保留');
    } else {
      withdrawalView(lease,record);
      if (record.result?.state==='reverted') {
        checkManagedRoot(lease.root);
        return record.result;
      }
      durableWrite(marker,JSON.stringify({batchId,fingerprint:record.fingerprint}));
    }
    withdraw(lease,record);
    return record.result!;
  } finally { restoreEnv(previous); lease.release(); }
}
