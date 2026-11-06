import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { closeSync, existsSync, fsyncSync, linkSync, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, realpathSync, renameSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parse, parseDocument } from 'yaml';
import { z } from 'astro/zod';
import { acquireBank, durableWrite, syncDirectory, withClassificationValidation, type BankLease } from './bank-access.ts';
import { readDataDir } from './data-dir.ts';
import { checkBank, buildQuestionIndex, type BankInput } from '../domain/bank-check.ts';
import { assessScopes, fullScope, sameScope, scopeStatus, SUPPORTED_SCOPES, type FullScope } from '../domain/exam-scope.ts';
import { compositionCanonical, compositionReviewSnapshot, validateCompositionConfiguration } from '../domain/paper-composition.ts';
import { bankFileSchema, paperFileSchema, deriveQuestionId, SUBJECTS, type ExamScope } from '../domain/schema.ts';

const hash=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');
const encoded=(value:unknown)=>JSON.stringify(value);
const digest=z.string().regex(/^[a-f0-9]{64}$/);
const text=z.string().trim().min(1);
const scopeSchema=z.object({grade:z.number().int().min(1).max(6),subject:z.enum(SUBJECTS),semester:z.union([z.literal(1),z.literal(2)]),stage:z.enum(['midterm','final'])}).strict();
const requestSchema=z.object({version:z.literal('classification-v1'),batchId:z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),dataDir:text,programHash:digest,dataHash:digest,batch:text,
  evidence:z.array(z.object({file:text,hash:digest,location:text,reason:text,originalPaper:text,ids:z.array(text).min(1),scope:scopeSchema}).strict()).min(1),
  papers:z.array(z.object({file:text,scope:scopeSchema,reason:text}).strict()),
}).strict();
type Request=z.infer<typeof requestSchema>;
type Manifest={file:string;hash:string;exists:true}[];
interface Change {file:string;id:string;kind:'original'|'derived'|'paper';before:ExamScope|null;after:ExamScope;reason:string}
interface Replacement {file:string;before:string;after:string;beforeHash:string;afterHash:string}
const project=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
function manifest(root:string):Manifest {
  if(lstatSync(root).isSymbolicLink())throw new Error(`拒絕符號連結：${root}`);
  const result:Manifest=[];
  function walk(dir:string) {
    for(const entry of readdirSync(dir).sort()) {
      const path=join(dir,entry),stat=lstatSync(path);
      if(stat.isSymbolicLink()) throw new Error(`拒絕符號連結：${path}`);
      if(stat.isDirectory()) walk(path);
      else if(stat.isFile()) result.push({file:relative(root,path).split(sep).join('/'),hash:hash(readFileSync(path)),exists:true});
      else throw new Error(`不支援的檔案：${path}`);
    }
  }
  walk(root);return result;
}
function programHash() {
  const files=['src','scripts','public'].filter(dir=>existsSync(join(project,dir))).flatMap(dir=>manifest(join(project,dir)).map(f=>({...f,file:`${dir}/${f.file}`})));
  for(const file of ['package.json','pnpm-lock.yaml','astro.config.mjs','tsconfig.json']) if(existsSync(join(project,file)))files.push({file,hash:hash(readFileSync(join(project,file))),exists:true});
  return hash(encoded({node:process.version,files}));
}
function withLease<T>(root:string,mode:'read'|'write',recovery:boolean,fn:(lease:ReturnType<typeof acquireBank>)=>T):T {
  const lease=acquireBank(root,mode,recovery),previous=process.env.EXAMREMIX_BANK_LEASE;
  process.env.EXAMREMIX_BANK_LEASE=lease.token;
  try{return fn(lease);}finally{if(previous===undefined)delete process.env.EXAMREMIX_BANK_LEASE;else process.env.EXAMREMIX_BANK_LEASE=previous;lease.release();}
}
function view(root:string,replacements:Replacement[]=[],side:'before'|'after'='after') {
  const contents=readDataDir(root);
  if(contents.problems.length)throw new Error(encoded(contents.problems));
  const raw=(file:string,value:unknown)=>{const r=replacements.find(r=>r.file===file);return r?parse(r[side]):value;};
  const banks=contents.banks.map(b=>({name:b.name,file:b.file,data:bankFileSchema.parse(raw(b.file,b.raw))}));
  const papers=contents.papers.map(p=>({file:p.file,data:paperFileSchema.parse(raw(p.file,p.raw))}));
  const problems=checkBank({banks,papers,images:contents.images});
  if(problems.some(p=>p.severity==='error'))throw new Error(`隔離驗證失敗：${encoded(problems)}`);
  const assessment=assessScopes(banks,papers);
  const configurations=checkConfigurations(root,banks,contents.images);
  return {banks,papers,assessment,summary:{
    configurations,
    capacities:SUPPORTED_SCOPES.map(s=>scopeStatus(assessment,s)),
    excludedQuestions:[...assessment.questions].filter(([,r])=>r.length).map(([id,reasons])=>({id,reasons})),
    papers:[...assessment.papers].map(([file,reasons])=>({file,eligible:reasons.length===0,reasons})),
  }};
}
/** Use the classified view for configuration validation, without claiming a feasible paper. */
function checkConfigurations(root:string,banks:BankInput[],images:string[]) {
  const directory=join(root,'profiles');
  if(!existsSync(directory))return [];
  const conflictsFile=join(root,'selection-conflicts.yaml');
  const conflicts=existsSync(conflictsFile)?parse(readFileSync(conflictsFile,'utf8')):undefined;
  const imageHashes=Object.fromEntries(images.map(file=>[file,hash(readFileSync(join(root,'bank',file)))]));
  const scopes=new Set<string>();
  return readdirSync(directory).filter(file=>file.endsWith('.yaml')).sort().map(file=>{
    const profile=parse(readFileSync(join(directory,file),'utf8'));
    const checked=validateCompositionConfiguration({banks,images,imageHashes,profile,conflicts});
    if(checked.status==='data-error')throw new Error(`完整卷配置驗證失敗 ${file}：${encoded(checked.diagnostics)}`);
    const scope=compositionCanonical(profile.scope);
    if(scopes.has(scope))throw new Error(`同一考試範圍有多份配置：${file}`);
    scopes.add(scope);
    const reviewed=profile.reviewedSnapshotHash===hash(compositionReviewSnapshot({banks,images,imageHashes,profile,conflicts}));
    return {file:`profiles/${file}`,state:checked.status==='ready'&&reviewed?'checked':'unconfigured',
      diagnostics:[...checked.diagnostics,...(!reviewed?[{message:'題庫或圖片核對版本尚未提供或已過期'}]:[])]};
  });
}
function includeGroupMembers(assessment:ReturnType<typeof assessScopes>,ids:Set<string>) {
  const groups=new Set([...assessment.membership].filter(([id])=>ids.has(id)).map(([,m])=>m.id));
  for(const [id,m] of assessment.membership)if(groups.has(m.id))ids.add(id);
  return ids;
}
export function inspectClassification(root:string) {
  return withLease(root,'read',false,lease=>{
    const files=manifest(lease.root),checked=view(lease.root);
    return {dataDir:lease.root,programHash:programHash(),dataHash:hash(encoded(files)),manifest:files,...checked.summary};
  });
}
function readRequest(path:string) {
  const request=requestSchema.parse(JSON.parse(readFileSync(path,'utf8')));
  request.dataDir=realpathSync(resolve(dirname(resolve(path)),request.dataDir));
  for(const e of request.evidence)e.file=realpathSync(resolve(dirname(resolve(path)),e.file));
  return request;
}
function prepare(request:Request) {
  const root=request.dataDir,files=manifest(root);
  if(request.programHash!==programHash())throw new Error('程式版本已變動；重新預覽');
  if(request.dataHash!==hash(encoded(files)))throw new Error('資料版本已變動；重新預覽');
  const before=view(root),banks=structuredClone(before.banks),papers=structuredClone(before.papers);
  const index=buildQuestionIndex(banks),changes:Change[]=[],evidence=[];
  const fileById=new Map(banks.flatMap(b=>b.data.questions.map(q=>[deriveQuestionId(b.name,q.no),b.file] as const)));
  const assigned=new Map<string,string>(),originalScopes=new Map<string,FullScope>();
  for(const e of request.evidence) {
    const rel=relative(root,e.file);
    if(rel===''||(!rel.startsWith(`..${sep}`)&&rel!=='..'))throw new Error('來源證據必須位於資料目錄外');
    if(!lstatSync(e.file).isFile())throw new Error('來源證據必須為普通檔案');
    const bytes=readFileSync(e.file);if(hash(bytes)!==e.hash)throw new Error(`來源證據雜湊不符：${e.file}`);
    evidence.push({...e,content:bytes.toString('base64')});
    const prior=originalScopes.get(e.originalPaper);
    if(prior&&!sameScope(prior,e.scope))throw new Error('同一原卷分類衝突');
    originalScopes.set(e.originalPaper,e.scope);
    for(const id of e.ids) {
      const q=index.get(id);
      if(!q?.source||q.derivedFrom||q.source.originalPaper!==e.originalPaper)throw new Error(`證據原題／原卷不符：${id}`);
      if(q.grade!==e.scope.grade||q.subject!==e.scope.subject)throw new Error(`證據年級科目不符：${id}`);
      if(assigned.has(id))throw new Error(`重複證據 ID：${id}`);
      assigned.set(id,e.reason);
      const next={semester:e.scope.semester,stage:e.scope.stage};
      if(!sameScope(fullScope(q),e.scope)) {
        changes.push({file:fileById.get(id)!,id,kind:'original',before:q.examScope??null,after:next,reason:e.reason});q.examScope=next;
      }
    }
  }
  // A source is identified by its explicit originalPaper, never by its filename.
  for(const [id,q] of index)if(q.source&&originalScopes.has(q.source.originalPaper)&&q.examScope&&!sameScope(fullScope(q),originalScopes.get(q.source.originalPaper))) {
    throw new Error(`同一原卷既有分類衝突：${id}`);
  }
  const affected=new Set(changes.map(c=>c.id));
  for(const [id,q] of index) {
    if(!q.derivedFrom?.some(source=>affected.has(source)||assigned.has(source)))continue;
    const sources=q.derivedFrom.map(source=>index.get(source));
    const scope=sources[0]&&fullScope(sources[0]);
    if(!scope||sources.some(s=>!s||!sameScope(fullScope(s),scope)))throw new Error(`多來源未分類或範圍衝突：${id}`);
    if(q.grade!==scope.grade||q.subject!==scope.subject)throw new Error(`繼承年級科目不符：${id}`);
    if(!sameScope(fullScope(q),scope)) {
      const next={semester:scope.semester,stage:scope.stage};
      changes.push({file:fileById.get(id)!,id,kind:'derived',before:q.examScope??null,after:next,reason:`繼承 ${q.derivedFrom.join(', ')}`});q.examScope=next;affected.add(id);
    }
  }
  for(const p of request.papers) {
    const paper=papers.find(paper=>paper.file===p.file);
    if(!paper||paper.data.grade!==p.scope.grade||paper.data.subject!==p.scope.subject)throw new Error(`試卷範圍不符：${p.file}`);
    const ids=paper.data.sections.flatMap(s=>s.questions);
    if(!ids.length||ids.some(id=>!sameScope(index.get(id)&&fullScope(index.get(id)!),p.scope)))throw new Error(`試卷引用未分類或衝突：${p.file}`);
    if(!sameScope(fullScope(paper.data),p.scope)) {
      const next={semester:p.scope.semester,stage:p.scope.stage};
      changes.push({file:p.file,id:p.file,kind:'paper',before:paper.data.examScope??null,after:next,reason:p.reason});paper.data.examScope=next;
    }
  }
  const replacements:Replacement[]=[];
  for(const file of new Set(changes.map(c=>c.file))) {
    const beforeText=readFileSync(join(root,file),'utf8'),doc=parseDocument(beforeText);
    const bank=before.banks.find(b=>b.file===file);
    for(const c of changes.filter(c=>c.file===file)) {
      const path=bank?['questions',bank.data.questions.findIndex(q=>deriveQuestionId(bank.name,q.no)===c.id),'examScope']:['examScope'];
      doc.setIn(path,c.after);
    }
    const afterText=doc.toString();
    // Compare every raw field, including unplanned classifications and YAML aliases.
    const expected=JSON.parse(JSON.stringify(parse(beforeText)));
    for(const c of changes.filter(c=>c.file===file)) {
      if(bank)expected.questions[bank.data.questions.findIndex(q=>deriveQuestionId(bank.name,q.no)===c.id)].examScope=c.after;
      else expected.examScope=c.after;
    }
    if(encoded(expected)!==encoded(parse(afterText)))throw new Error(`分類以外或未計畫內容變動：${file}`);
    replacements.push({file,before:beforeText,after:afterText,beforeHash:hash(beforeText),afterHash:hash(afterText)});
  }
  const after=view(root,replacements);
  const affectedIds=includeGroupMembers(after.assessment,new Set([...assigned.keys(),...changes.filter(c=>c.kind!=='paper').map(c=>c.id)]));
  const groups=[...new Set([...after.assessment.membership].filter(([id])=>affectedIds.has(id)).map(([,m])=>m.id))];
  const affectedPapers=after.papers.filter(p=>p.data.sections.some(s=>s.questions.some(id=>affectedIds.has(id)))).map(p=>p.file);
  const affectedConfigurations=configurationReferences(root,files,new Set([...affectedIds,...groups]));
  return {request,manifest:files,evidence,replacements,report:{state:'previewed',batchId:request.batchId,programHash:request.programHash,dataHash:request.dataHash,changes,groups,affectedPapers,affectedConfigurations,before:before.summary,after:after.summary}};
}
export function previewClassification(path:string,build=false) {
  const request=readRequest(path);
  return withLease(request.dataDir,'read',false,lease=>{
    const plan=prepare(request),planHash=hash(encoded(plan));
    if(build)verifyOutput(lease,plan,planHash);
    return {...plan.report,planHash,outputVerified:build};
  });
}

type Plan=ReturnType<typeof prepare>;
interface Operation { output:OutputReceipt; version:'classification-operation-v1'; plan:Plan; planHash:string; state:'running'|'applied'|'reverted'; direction:'before'|'after'; runManifest:Manifest }
function recordFile(control:string,id:string) {
  if(!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id))throw new Error('批次識別不合格');
  const path=join(control,'classifications',id,'record.json');
  for(const part of [control,join(control,'classifications'),dirname(path),path])if(existsSync(part)&&lstatSync(part).isSymbolicLink())throw new Error(`拒絕操作紀錄符號連結：${part}`);
  return path;
}
function saveOperation(lease:BankLease,op:Operation) {
  const path=recordFile(lease.control,op.plan.request.batchId);
  const parent=dirname(dirname(path));
  mkdirSync(parent,{recursive:true,mode:0o700});syncDirectory(lease.control);
  const content=encoded({hash:hash(encoded(op)),data:op});
  if(!existsSync(dirname(path))) {
    const stage=join(lease.control,`classification-prepare-${randomUUID()}`);
    mkdirSync(stage,{mode:0o700});syncDirectory(lease.control);
    durableWrite(join(stage,'record.json'),content);
    renameSync(stage,dirname(path));syncDirectory(parent);syncDirectory(lease.control);
  } else {
    const temp=join(dirname(path),`record-${randomUUID()}.tmp`);
    durableWrite(temp,content);renameSync(temp,path);syncDirectory(dirname(path));
  }
}
function readOperation(lease:BankLease,id:string):Operation {
  const envelope=JSON.parse(readFileSync(recordFile(lease.control,id),'utf8'));
  if(hash(encoded(envelope.data))!==envelope.hash)throw new Error('分類操作紀錄損毀');
  const op=envelope.data as Operation;
  if(op.version!=='classification-operation-v1'||!['running','applied','reverted'].includes(op.state)||!['before','after'].includes(op.direction))throw new Error('分類紀錄狀態不合格');
  requestSchema.parse(op.plan.request);
  if(op.plan.request.dataDir!==lease.root||op.plan.request.batchId!==id||hash(encoded(op.plan))!==op.planHash)throw new Error('分類紀錄所有權／計畫雜湊衝突');
  const safe=(file:string)=>{if(!/^(bank|papers)\/[^/]+\.yaml$/.test(file)||file.includes('..'))throw new Error('分類紀錄路徑不合格');};
  for(const r of op.plan.replacements) {
    safe(r.file);
    if(hash(r.before)!==r.beforeHash||hash(r.after)!==r.afterHash)throw new Error('分類備份損毀');
    if(!op.plan.manifest.some(f=>f.file===r.file&&f.hash===r.beforeHash))throw new Error('分類備份與原版本不符');
  }
  for(const e of op.plan.evidence)if(hash(Buffer.from(e.content,'base64'))!==e.hash)throw new Error('來源備份損毀');
  return op;
}
function markerFor(op:Operation) {return encoded({operation:'classification',batchId:op.plan.request.batchId,planHash:op.planHash});}
function assertMarker(lease:BankLease,op:Operation) {
  const marker=join(lease.control,'maintenance.json');
  if(existsSync(marker)&&readFileSync(marker,'utf8')!==markerFor(op))throw new Error('其他操作尚待恢復；維護標記保留');
  return existsSync(marker);
}
function assertProgram(op:Operation) {
  if(programHash()!==op.plan.request.programHash)throw new Error('程式版本已變動；使用原固定版本恢復／回復');
}
function expectedManifest(op:Operation,side:'before'|'after') {
  return op.runManifest.map(f=>{const r=op.plan.replacements.find(r=>r.file===f.file);return r?{...f,hash:r[side==='after'?'afterHash':'beforeHash']}:f;});
}
function assertState(lease:BankLease,op:Operation,mixed:boolean) {
  const current=manifest(lease.root),expected=expectedManifest(op,op.direction);
  if(current.length!==expected.length)throw new Error('檔案存在狀態衝突');
  for(let i=0;i<expected.length;i++) {
    const f=current[i]!,e=expected[i]!,owned=op.plan.replacements.find(r=>r.file===e.file);
    if(f.file!==e.file||f.hash!==e.hash&&!(mixed&&owned&&(f.hash===owned.beforeHash||f.hash===owned.afterHash)))throw new Error(`檔案雜湊衝突：${e.file}`);
  }
}
function validateDuring(lease:BankLease,op:Operation,side?:'before'|'after') {
  const run=()=>view(lease.root,side?op.plan.replacements:[],side);
  return existsSync(join(lease.control,'maintenance.json'))?withClassificationValidation(lease,markerFor(op),run):run();
}
function result(op:Operation) {return {...op.plan.report,state:op.state,planHash:op.planHash};}
function publishMarker(lease:BankLease,op:Operation) {
  const temp=join(lease.control,`classification-marker-${randomUUID()}.tmp`);
  durableWrite(temp,markerFor(op));
  linkSync(temp,join(lease.control,'maintenance.json'));syncDirectory(lease.control);
  unlinkSync(temp);syncDirectory(lease.control);
}
function finish(lease:BankLease,op:Operation) {
  assertProgram(op);assertMarker(lease,op);assertState(lease,op,true);
  // Validate the complete intended view before writing even when resuming mixed files.
  validateDuring(lease,op,op.direction);
  const marker=join(lease.control,'maintenance.json');
  if(!existsSync(marker))publishMarker(lease,op);
  for(const r of op.plan.replacements) {
    const path=join(lease.root,r.file),content=r[op.direction];
    if(hash(readFileSync(path))!==hash(content)) {
      const temp=join(dirname(recordFile(lease.control,op.plan.request.batchId)),`replacement-${randomUUID()}.tmp`);
      durableWrite(temp,content);renameSync(temp,path);syncDirectory(dirname(temp));
    }
    // Re-sync even an already matching file: a prior fsync may have failed.
    const fd=openSync(path,'r');try{fsyncSync(fd);}finally{closeSync(fd);}
    syncDirectory(dirname(path));
  }
  assertState(lease,op,false);validateDuring(lease,op);
  op.state=op.direction==='after'?'applied':'reverted';saveOperation(lease,op);
  unlinkSync(marker);syncDirectory(lease.control);
  return result(op);
}
export function applyClassification(path:string,expected:string) {
  const request=readRequest(path);
  return withLease(request.dataDir,'write',true,lease=>{
    const file=recordFile(lease.control,request.batchId);
    if(existsSync(file)) {
      const op=readOperation(lease,request.batchId);
      if(encoded(op.plan.request)!==encoded(request)||op.planHash!==expected)throw new Error('同批請求／預覽衝突');
      const marked=assertMarker(lease,op);assertProgram(op);
      if(op.state!=='running'&&!marked){assertState(lease,op,false);view(lease.root);return result(op);}
      if(op.direction!=='after')throw new Error('本批回復中；請使用 recover before');
      return finish(lease,op);
    }
    if(existsSync(join(lease.control,'maintenance.json')))throw new Error('其他操作尚待恢復');
    const plan=prepare(request),planHash=hash(encoded(plan));
    if(planHash!==expected)throw new Error('預覽雜湊不符；重新預覽');
    const output=readOutput(lease,planHash);
    const op:Operation={output,version:'classification-operation-v1',plan,planHash,state:'running',direction:'after',runManifest:plan.manifest};
    saveOperation(lease,op);return finish(lease,op);
  });
}
// Configuration may reference either individual candidates or a whole material group.
// Fail conservatively on exact ID values; never infer references from substrings.
function configurationReferences(root:string,files:Manifest,ids:Set<string>) {
  function references(value:unknown):boolean {
    if(typeof value==='string')return ids.has(value);
    if(Array.isArray(value))return value.some(references);
    return value!==null&&typeof value==='object'&&Object.values(value).some(references);
  }
  return files.filter(f=>(f.file.startsWith('profiles/')&&f.file.endsWith('.yaml')||f.file==='selection-conflicts.yaml')&&
    references(parse(readFileSync(join(root,f.file),'utf8')))).map(f=>f.file);
}
function rollbackConflicts(lease:BankLease,op:Operation) {
  const current=manifest(lease.root);
  for(const r of op.plan.replacements)if(current.find(f=>f.file===r.file)?.hash!==r.afterHash)throw new Error(`後續修改衝突：${r.file}`);
  const knownIds=new Set([...op.plan.report.changes.filter(c=>c.kind!=='paper').map(c=>c.id),...op.plan.report.groups]);
  for(const file of configurationReferences(lease.root,current,knownIds)) {
    if(current.find(f=>f.file===file)?.hash!==op.plan.manifest.find(f=>f.file===file)?.hash)throw new Error(`後續依賴衝突：${file}`);
  }
  const checked=view(lease.root),ids=includeGroupMembers(checked.assessment,new Set(op.plan.report.changes.filter(c=>c.kind!=='paper').map(c=>c.id)));
  const dependent=new Set(checked.banks.filter(b=>b.data.questions.some(q=>q.derivedFrom?.some(id=>ids.has(id)))).map(b=>b.file));
  for(const p of checked.papers)if(p.data.sections.some(s=>s.questions.some(id=>ids.has(id))))dependent.add(p.file);
  const referenceIds=new Set([...ids,...op.plan.report.groups]);
  for(const file of configurationReferences(lease.root,current,referenceIds))dependent.add(file);
  for(const file of dependent) {
    if(op.plan.replacements.some(r=>r.file===file))continue;
    if(current.find(f=>f.file===file)?.hash!==op.plan.manifest.find(f=>f.file===file)?.hash)throw new Error(`後續依賴衝突：${file}`);
  }
  view(lease.root,op.plan.replacements,'before');
  return current;
}
export function rollbackClassification(root:string,id:string) {
  return withLease(root,'write',true,lease=>{
    const op=readOperation(lease,id),marked=assertMarker(lease,op);assertProgram(op);
    if(op.state==='reverted'&&!marked){assertState(lease,op,false);view(lease.root);return result(op);}
    if(marked||op.state==='running')throw new Error('未完成操作；使用 recover 指定原方向');
    op.runManifest=rollbackConflicts(lease,op);op.direction='before';op.state='running';
    saveOperation(lease,op);return finish(lease,op);
  });
}
export function recoverClassification(root:string,id:string,direction:'before'|'after') {
  return withLease(root,'write',true,lease=>{
    const op=readOperation(lease,id);assertMarker(lease,op);assertProgram(op);
    if(op.state!=='running'&&!existsSync(join(lease.control,'maintenance.json')))throw new Error('操作已完成；使用 apply 核對或 rollback');
    assertState(lease,op,true);
    if(op.direction==='before'&&direction!=='before')throw new Error('回復方向已持久化；不可切換');
    if(direction!==op.direction) {op.direction=direction;op.state='running';saveOperation(lease,op);}
    return finish(lease,op);
  });
}

interface OutputReceipt { planHash:string; directory:string; files:Manifest }
function outputReceiptFile(lease:BankLease,planHash:string) {
  if(!/^[a-f0-9]{64}$/.test(planHash))throw new Error('預覽雜湊格式錯誤');
  const parent=join(lease.control,'classification-previews'),path=join(parent,`${planHash}.json`);
  for(const part of [parent,path])if(existsSync(part)&&lstatSync(part).isSymbolicLink())throw new Error('拒絕建置紀錄符號連結');
  return path;
}
function readOutput(lease:BankLease,planHash:string):OutputReceipt {
  const file=outputReceiptFile(lease,planHash);
  if(!existsSync(file))throw new Error('缺少隔離建置驗證；先執行 preview <請求> --build');
  const envelope=JSON.parse(readFileSync(file,'utf8')),receipt=envelope.data as OutputReceipt;
  if(hash(encoded(receipt))!==envelope.hash||receipt.planHash!==planHash||dirname(receipt.directory)!==join(lease.control,'classification-previews')||!/^view-/.test(relative(dirname(receipt.directory),receipt.directory)))throw new Error('隔離建置紀錄損毀');
  if(encoded(manifest(join(receipt.directory,'output')))!==encoded(receipt.files))throw new Error('隔離建置產物已變動；重新預覽');
  return receipt;
}
function verifyOutput(lease:BankLease,plan:Plan,planHash:string) {
  const parent=join(lease.control,'classification-previews'),receiptFile=outputReceiptFile(lease,planHash);
  if(existsSync(receiptFile)){readOutput(lease,planHash);return;}
  mkdirSync(parent,{recursive:true,mode:0o700});syncDirectory(lease.control);
  const directory=mkdtempSync(join(parent,'view-')),data=join(directory,'data');
  mkdirSync(join(data,'bank'),{recursive:true});mkdirSync(join(data,'papers'));
  const contents=readDataDir(lease.root);
  for(const f of [...contents.banks,...contents.papers])writeFileSync(join(data,f.file),plan.replacements.find(r=>r.file===f.file)?.after??readFileSync(f.path));
  for(const file of contents.images){const destination=join(data,'bank',file);mkdirSync(dirname(destination),{recursive:true});writeFileSync(destination,readFileSync(join(lease.root,'bank',file)));}
  for(const f of plan.manifest.filter(f=>f.file==='selection-conflicts.yaml'||f.file.startsWith('profiles/'))) {
    const destination=join(data,f.file);mkdirSync(dirname(destination),{recursive:true});writeFileSync(destination,readFileSync(join(lease.root,f.file)));
  }
  // Only dependency resolution is shared; data, generated types, cache and output are isolated.
  symlinkSync(join(project,'node_modules'),join(directory,'node_modules'),'dir');
  writeFileSync(join(directory,'package.json'),readFileSync(join(project,'package.json')));
  const config=join(directory,'astro.config.mjs');
  writeFileSync(config,`import base from ${JSON.stringify(pathToFileURL(join(project,'astro.config.mjs')).href)};\nexport default {...base,root:${JSON.stringify(directory)},srcDir:${JSON.stringify(join(project,'src'))},publicDir:${JSON.stringify(join(project,'public'))},cacheDir:${JSON.stringify(join(directory,'cache'))},outDir:${JSON.stringify(join(directory,'output'))}};\n`);
  const pkg=JSON.parse(readFileSync(join(project,'node_modules/astro/package.json'),'utf8'));
  const bin=typeof pkg.bin==='string'?pkg.bin:pkg.bin.astro;
  const built=spawnSync(process.execPath,[join(project,'node_modules/astro',bin),'build','--config',relative(project,config)],{cwd:project,encoding:'utf8',maxBuffer:16*1024*1024,env:{...process.env,EXAMREMIX_DATA_DIR:data,EXAMREMIX_BANK_LEASE:''}});
  durableWrite(join(directory,'build.log'),built.stdout+built.stderr);
  if(built.status!==0)throw new Error(`隔離建置失敗：${join(directory,'build.log')}\n${built.stderr.slice(-3000)}`);
  const files=manifest(join(directory,'output'));
  // The same qualification result must govern the actual clean static output.
  for(const paper of plan.report.after.papers) {
    const name=paper.file.slice('papers/'.length,-'.yaml'.length);
    if(existsSync(join(directory,'output','papers',name,'index.html'))!==paper.eligible)throw new Error(`隔離路由與資格不符：${paper.file}`);
  }
  const receipt:OutputReceipt={planHash,directory,files};
  // Artifact bytes and parent entries are durable before issuing a build receipt.
  for(const f of files){const fd=openSync(join(directory,'output',f.file),'r');try{fsyncSync(fd);}finally{closeSync(fd);}}
  for(const dir of new Set(files.map(f=>dirname(join(directory,'output',f.file)))))syncDirectory(dir);
  syncDirectory(join(directory,'output'));syncDirectory(directory);syncDirectory(parent);
  const receiptTemp=join(parent,`receipt-${randomUUID()}.tmp`);
  durableWrite(receiptTemp,encoded({hash:hash(encoded(receipt)),data:receipt}));
  linkSync(receiptTemp,receiptFile);syncDirectory(parent);
  unlinkSync(receiptTemp);syncDirectory(parent);
}
