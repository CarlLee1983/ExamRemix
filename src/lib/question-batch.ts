import { createHash, randomUUID } from 'node:crypto';
import { existsSync, linkSync, mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { parse } from 'yaml';
import { arithmeticEntrySchema, arithmeticProfile, checkArithmeticBinding } from '../domain/generation-math.ts';
import { z } from 'astro/zod';
import { checkBank, buildQuestionIndex } from '../domain/bank-check.ts';
import { assessScopes, fullScope, sameScope, supportedScope, type FullScope } from '../domain/exam-scope.ts';
import { imageReferences } from '../domain/bank-check.ts';
import { groupMembership } from '../domain/question-groups.ts';
import { fileNameProblem } from '../domain/file-name.ts';
import { bankFileSchema, paperFileSchema, questionSchema, deriveQuestionId } from '../domain/schema.ts';
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
  const batches=records(control);
  const waiting=batches.filter(r=>r.request.batchId !== omit && !r.result && r.phase!=='failed').map(r=>({batchId:r.request.batchId,candidateHash:r.request.candidateHash,candidate:r.candidate}));
  for(const g of generationRecords(control)) {
    const last=g.attempts.at(-1);
    if(g.request.batchId!==omit && last && ['reviewing','ready'].includes(last.state) && !batches.some(b=>b.request.batchId===g.request.batchId) && !waiting.some(b=>b.batchId===g.request.batchId))waiting.push({batchId:g.request.batchId,candidateHash:hash(last.candidate),candidate:last.candidate});
  }
  return waiting.sort((a,b)=>a.batchId<b.batchId?-1:a.batchId>b.batchId?1:0);
}
function pendingQuestionIds(control:string,omit:string) {
  const targets=new Map([...records(control),...generationRecords(control)].map(r=>[r.request.batchId,basename(r.request.target,'.yaml')]));
  return pending(control,omit).flatMap(p=>bankFileSchema.parse(parse(p.candidate)).questions.map(q=>deriveQuestionId(targets.get(p.batchId)!,q.no)));
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
      sourceIds:[...buildQuestionIndex(view.banks)].filter(([,q])=>q.source).map(([id])=>id),
      pending:waiting.map(p=>{const r=[...records(lease.control),...generationRecords(lease.control)].find(r=>r.request.batchId===p.batchId)!;return {...p,target:r.request.target,ids:bankFileSchema.parse(parse(p.candidate)).questions.map(q=>deriveQuestionId(basename(r.request.target,'.yaml'),q.no))};}),
      generations:generationRecords(lease.control).map(g=>{const published=records(lease.control).find(b=>b.request.batchId===g.request.batchId);return {batchId:g.request.batchId,state:published?.result?.state??g.attempts.at(-1)?.state,attempts:g.attempts.at(-1)?.counts,errors:g.attempts.at(-1)?.errors,publicationError:published?.error};})};
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


const generationRulesSchema=z.object({concept:text,allowedChanges:text,invariants:text,verification:text,mathSources:z.array(arithmeticEntrySchema).optional()}).strict();
const comparisonSchema=z.object({left:text,right:text,decision:z.enum(['distinct','duplicate','uncertain']),reason:text}).strict();
const generationRequestSchema=requestSchema.extend({rules:generationRulesSchema,comparisons:z.array(comparisonSchema),arithmetic:z.array(arithmeticEntrySchema).optional(),haltReason:text.optional()});
interface GenerationAttempt {
  receipt:string; candidate:string; counts:Record<string,number>; hashes:Record<string,string>;
  request:Request; state:'reviewing'|'rejected'|'ready'|'stopped'; errors:string[];
}
interface GenerationRecord { fingerprint:string; request:Request; sources:{file:string;content:string;hash:string}[]; attempts:GenerationAttempt[] }
function generationRecords(control:string):GenerationRecord[] {
  const dir=join(control,'generations');
  return existsSync(dir) ? readdirSync(dir).filter(p=>p.endsWith('.json')).sort().map(p=>{
    const envelope=JSON.parse(readFileSync(join(dir,p),'utf8'));
    if(hash(canonical(envelope.data))!==envelope.hash)throw new Error(`產題紀錄損毀：${p}`);
    const record=envelope.data as GenerationRecord;
    requestSchema.parse(record.request);
    if(fingerprint(record.request)!==record.fingerprint)throw new Error(`產題紀錄指紋不符：${p}`);
    return record;
  }) : [];
}
function saveGeneration(control:string,record:GenerationRecord) {
  const dir=join(control,'generations');
  mkdirSync(dir,{recursive:true,mode:0o700});syncDirectory(control);
  const path=join(dir,`${record.request.batchId}.json`),temp=`${path}.next`;
  if(existsSync(temp))unlinkSync(temp);
  durableWrite(temp,JSON.stringify({hash:hash(canonical(record)),data:record}));
  renameSync(temp,path);syncDirectory(dir);
}
function generationSources(root:string,r:Request) {
  const view=snapshot(root);
  checkManagedRoot(root);
  if(view.targetHash!==r.targetHash)throw new Error('來源／目標版本已變動；停止產題，重新核對來源');
  const index=buildQuestionIndex(view.banks),scopes=assessScopes(view.banks,view.papers),members=groupMembership(view.banks);
  const first=index.get(r.sourceIds[0]!);
  for(const id of r.sourceIds) {
    const q=index.get(id);
    if(!q?.source || q.derivedFrom || scopes.questions.get(id)?.length || !sameScope(fullScope(q),r.scope as FullScope) || !supportedScope(r.scope as FullScope))throw new Error(`${id}：原題範圍／疑點／來源不合格`);
    if(members.has(id))throw new Error(`${id}：本入口只處理獨立原題，完整題組由後續入口承接`);
    if(imageReferences(q).length)throw new Error(`${id}：含圖原題不可衍生`);
    if(q.type!==first?.type || q.unit!==first?.unit || q.subject!==first?.subject || q.grade!==first?.grade)throw new Error(`${id}：多來源題型／單元／科目／年級不一致`);
  }
  return view;
}

function immutableGenerationFile(path:string,content:string) {
  if(existsSync(path)) {
    if(readFileSync(path,'utf8')!==content)throw new Error(`產題交付檔衝突：${path}`);
    syncDirectory(dirname(path));return;
  }
  const temp=`${path}.${randomUUID()}.tmp`;
  try {durableWrite(temp,content);linkSync(temp,path);syncDirectory(dirname(path));}
  finally {if(existsSync(temp)){unlinkSync(temp);syncDirectory(dirname(path));}}
}
function generationPublication(control:string,request:Request,candidate?:string) {
  const dir=join(control,'generations');mkdirSync(dir,{recursive:true,mode:0o700});syncDirectory(control);
  const candidatePath=join(dir,`${request.batchId}.candidate.yaml`);
  if(candidate!==undefined)immutableGenerationFile(candidatePath,candidate);
  const accepted=candidate===undefined?request:{...request,candidate:candidatePath};
  const path=join(dir,`${request.batchId}.publish-request`);
  immutableGenerationFile(path,JSON.stringify(accepted));
  return path;
}

/** Local AI supplies solved candidates and content-bound evidence; no AI API is called. */
export function generateQuestions(requestPath:string) {
  const input=generationRequestSchema.parse(JSON.parse(readFileSync(requestPath,'utf8')));
  if(input.quantity.unit!=='questions')throw new Error('本入口僅接受獨立題');
  const {rules,comparisons,arithmetic,haltReason,...base}=input;
  const request:Request={...base,dataDir:canonicalRoot(resolve(base.dataDir)),constraints:canonical({description:base.constraints,rules})};
  if(fileNameProblem(request.target)||!request.target.startsWith('new-'))throw new Error('新檔名不合格');
  const lease=acquireBank(request.dataDir,'write',true),previous=process.env.EXAMREMIX_BANK_LEASE;
  process.env.EXAMREMIX_BANK_LEASE=lease.token;
  let publication:string|undefined;
  try {
    const all=generationRecords(lease.control);
    let record=all.find(g=>g.request.batchId===request.batchId);
    if(record && record.fingerprint!==fingerprint(request))throw new Error('同批來源／約束已改變；不能重置嘗試');
    record??=all.find(g=>g.fingerprint===fingerprint(request));
    const alias=record!==undefined && record.request.batchId!==request.batchId;
    if(record)request.batchId=record.request.batchId;
    const completed=records(lease.control).find(r=>r.fingerprint===fingerprint(request));
    const prior=record?.attempts.at(-1);
    if(record && record.request.target!==request.target && !completed?.result)throw new Error(`沿用原批 ${record.request.batchId} 與目的檔 ${record.request.target}`);
    if(completed?.result && !alias && (completed.request.candidateHash!==request.candidateHash || completed.request.target!==request.target))throw new Error('同批已發布候選衝突；不能替換已核對內容');
    if(prior?.state==='ready' && !completed?.result && hash(canonical({request,comparisons,candidate:prior.candidate,arithmetic,haltReason}))!==prior.receipt)throw new Error('已核對請求衝突；保留原候選，停止發布');
    if(completed?.result || prior?.state==='ready') {
      const accepted=prior?.request ?? completed!.request;
      publication=generationPublication(lease.control,accepted,prior?.candidate);
    } else {
      if(existsSync(join(lease.control,'maintenance.json')))throw new Error('其他操作尚待恢復；停止產題');
      if(prior?.state==='stopped')throw new Error(`本批已停止，不能重置嘗試：${prior.errors.join('；')}`);
      const view=generationSources(lease.root,request);
      if(hash(canonical(pending(lease.control,request.batchId)))!==request.pendingHash)throw new Error('待發布批次已變動；停止並重新核對');
      const stored=record?.attempts.find(a=>a.request.candidateHash===request.candidateHash);
      const candidatePath=stored ? resolve(request.candidate) : canonicalRoot(resolve(request.candidate));
      assertOutside(lease.root,candidatePath);assertOutside(lease.root,canonicalRoot(resolve(requestPath)));
      const candidate=stored?.candidate ?? readFileSync(candidatePath,'utf8');
      if(hash(candidate)!==request.candidateHash)throw new Error('候選內容雜湊不符');
      const raw=z.looseObject({questions:z.array(z.looseObject({no:z.number().int().positive()})).min(1)}).parse(parse(candidate));
      if(raw.groups || raw.questions.length!==request.quantity.count || raw.questions.some((q,i)=>q.no!==i+1))throw new Error('獨立候選須完整並依序編號；不得交付部分批次');
      const sourceIndex=buildQuestionIndex(view.banks);
      if(request.scope.subject==='數學') {
        if(canonical((rules.mathSources??[]).map(s=>s.id).sort())!==canonical([...request.sourceIds].sort()))throw new Error('數學原題須有完整且明確的求解模型');
        const profiles=rules.mathSources!.map(s=>{checkArithmeticBinding(sourceIndex.get(s.id)!,s.model);return canonical(arithmeticProfile(s.model));});
        if(new Set(profiles).size!==1)throw new Error('多來源數學難度特徵互相衝突');
      }
      const receipt=hash(canonical({request,comparisons,candidate,arithmetic,haltReason}));
      if(prior?.state==='reviewing' && prior.receipt!==receipt)throw new Error('未完成的品質核對尚待恢復；須使用同一請求');
      const cached=record?.attempts.find(a=>a.receipt===receipt);
      const counts={...prior?.counts},hashes:Record<string,string>={};
      const name=basename(request.target,'.yaml');
      for(const q of raw.questions) {
        const id=deriveQuestionId(name,q.no);
        const evidence=request.evidence.find(e=>e.id===id);
        hashes[id]=hash(canonical({question:q,evidence:evidence?{...evidence,attempt:undefined}:undefined,arithmetic:arithmetic?.find(a=>a.id===id),comparisons:comparisons.filter(p=>p.left===id||p.right===id).sort((a,b)=>canonical(a).localeCompare(canonical(b)))}));
        counts[id]=(prior?.counts[id]??0)+(prior?.hashes[id]===hashes[id]?0:1);
      }
      if(!record)record={fingerprint:fingerprint(request),request,sources:view.banks.filter(b=>b.data.questions.some(q=>request.sourceIds.includes(deriveQuestionId(b.name,q.no)))).map(b=>{const content=readFileSync(join(lease.root,b.file),'utf8');return {file:b.file,content,hash:hash(content)};}),attempts:[]};
      const attempt=cached??{receipt,candidate,counts,hashes,request,state:'reviewing' as const,errors:[]};
      if(!cached){record.attempts.push(attempt);saveGeneration(lease.control,record);}
      if(attempt.state==='reviewing') {
        const errors:string[]=[],failedIds=new Set<string>();
        const basis=cached ? record.attempts[record.attempts.indexOf(cached)-1] : prior;
        const changedIds=Object.keys(hashes).filter(id=>basis?.hashes[id]!==hashes[id]);
        if(haltReason)errors.push(`無法核對／工具失敗：${haltReason}`);
        if(request.scope.subject==='數學') {
          const ids=raw.questions.map(q=>deriveQuestionId(name,q.no));
          if(canonical((arithmetic??[]).map(a=>a.id).sort())!==canonical([...ids].sort())){errors.push('每個數學候選須有明確求解模型');ids.filter(id=>!arithmetic?.some(a=>a.id===id)).forEach(id=>failedIds.add(id));}
          for(const a of arithmetic??[])try {
            const rawQuestion=raw.questions.find(q=>deriveQuestionId(name,q.no)===a.id);
            if(!rawQuestion)throw new Error('候選 ID 不存在');
            const q=questionSchema.parse(rawQuestion);
            checkArithmeticBinding(q,a.model);
            if(canonical(arithmeticProfile(a.model))!==canonical(arithmeticProfile(rules.mathSources![0]!.model)))throw new Error('數學難度／進退位／整除／單位約束漂移');
          }catch(error){errors.push(`${a.id}：${(error as Error).message}`);failedIds.add(a.id);}
        }
        if(Object.values(counts).some(n=>n>3))errors.push('已達三次上限；整批停止');
        for(const e of request.evidence) {
          if(e.attempt!==counts[e.id]){errors.push(`${e.id}：嘗試次數須為 ${counts[e.id]}`);failedIds.add(e.id);}
          if(e.decision==='reject'){errors.push(`${e.id}：內容核對拒絕：${e.independentCheck}；${e.explanation}`);failedIds.add(e.id);}
        }
        try{validate(lease.root,lease.control,{request:{...request,evidence:request.evidence.map(e=>({...e,decision:'accept'}))},fingerprint:record.fingerprint,candidate},false);}catch(error){
          if((error as NodeJS.ErrnoException).code)throw error;
          const message=(error as Error).message;errors.push(message);
          const implicated=error instanceof z.ZodError ? error.issues.flatMap(issue=>issue.path[0]==='questions'&&typeof issue.path[1]==='number'?[deriveQuestionId(name,raw.questions[issue.path[1]]!.no)]:[]) : Object.keys(hashes).filter(id=>message.includes(id));
          (implicated.length?implicated:changedIds).forEach(id=>failedIds.add(id));
        }
        const ids=Object.keys(hashes),others=[...buildQuestionIndex(view.banks).keys(),...pendingQuestionIds(lease.control,request.batchId)];
        const required=ids.flatMap((id,i)=>[...others,...ids.slice(i+1)].map(other=>`${id}\0${other}`));
        const actual=comparisons.map(p=>`${p.left}\0${p.right}`);
        if(canonical([...actual].sort())!==canonical([...required].sort())){errors.push('比較範圍不完整：須逐對核對完整題庫及本批候選');const missing=required.filter(pair=>!actual.includes(pair)).map(pair=>pair.split('\0')[0]!);(missing.length?missing:changedIds).forEach(id=>failedIds.add(id));}
        for(const pair of comparisons)if(pair.decision!=='distinct'){errors.push(`${pair.left}／${pair.right}：${pair.decision}：${pair.reason}`);failedIds.add(pair.left);}
        attempt.errors=errors;
        attempt.state=errors.length ? haltReason || Object.values(counts).some(n=>n>3) || [...failedIds].some(id=>(counts[id]??0)>=3)?'stopped':'rejected' : 'ready';
        saveGeneration(lease.control,record);
      }
      if(attempt.state!=='ready')return {state:attempt.state,batchId:request.batchId,added:0,attempts:attempt.counts,errors:attempt.errors};
      publication=generationPublication(lease.control,attempt.request,attempt.candidate);
    }
  } finally {restoreEnv(previous);lease.release();}
  return publishBatch(publication!);
}
