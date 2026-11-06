/** Browser/build shared math selection. No filesystem, ambient random or Node imports. */
import { z } from 'astro/zod';
import { bankFileSchema, questionSchema, SUBJECTS, type Question } from './schema.ts';
import { checkBank, imageReferences, type BankInput } from './bank-check.ts';
import { assessScopes, fullScope, sameScope } from './exam-scope.ts';
import { answerSpace } from './answer-space.ts';

export const COMPOSITION_CORE_VERSION = 'composition-2';
export const MAX_COMPOSITION_STATES = 100_000;
const text = z.string().trim().min(1);
const evidence = text.optional();
const slotSchema = z.strictObject({
  id:text, type:z.enum(['choice','fill-blank','vertical-calc','word-problem','true-false','multi-select','diagram-label','table-fill','imitate-sentence','make-sentence','matching','personal-response']).optional(), points:z.number().int().positive(), concept:text, difficulty:text,
  answerItems:z.number().int().positive(), space:z.number().int().nonnegative().optional(), layout:text,
  referenceIds:z.array(text).min(1), evidence,
  candidates:z.array(z.strictObject({id:text,evidence})),
});
export const compositionProfileSchema = z.strictObject({
  schemaVersion:z.literal(1), id:text, revision:text, reviewedSnapshotHash:z.string().regex(/^[0-9a-f]{64}$/).optional(),
  scope:z.strictObject({grade:z.literal(3),subject:z.enum(SUBJECTS),semester:z.literal(1),stage:z.literal('midterm')}),
  evidence:z.strictObject({sources:evidence,candidates:evidence,print:evidence}).optional(),
  sections:z.array(z.strictObject({id:text,title:text,type:z.enum(['choice','fill-blank','vertical-calc','word-problem','true-false','multi-select','diagram-label','table-fill','imitate-sentence','make-sentence','matching','personal-response','mixed']),slots:z.array(slotSchema),variants:z.array(z.strictObject({id:text,groupId:text,questionIds:z.array(text).min(1),evidence})).optional()})),
});
export const selectionConflictsSchema = z.strictObject({
  schemaVersion:z.literal(1),revision:text,
  pairs:z.array(z.strictObject({kind:z.enum(['question','group']),ids:z.tuple([text,text]),reason:text,
    memberPairs:z.array(z.tuple([text,text])).optional(),
  })),
});
export const mathProfileSchema=compositionProfileSchema.refine(p=>p.scope.subject==='數學',{message:'數學配置科目不符'});
export type MathProfile = z.infer<typeof compositionProfileSchema>;
export type SelectionConflicts = z.infer<typeof selectionConflictsSchema>;
export interface MathCompositionInput { profile:unknown; conflicts:unknown; banks:readonly BankInput[]; images:readonly string[]; imageHashes?:Readonly<Record<string,string>> }
export interface MathItem { slotId:string; questionId:string; points:number; question:Question }
export interface MathSection { id:string; title:string; points:number; items:MathItem[]; materials:{beforeSlotId:string;groupId:string;paragraphs:string[];image?:{src:string;alt:string}}[] }
export interface MathWitness {
  coreVersion:string; profileId:string; profileRevision:string; seed:string;
  profileHash:string; bankHash:string; conflictsHash:string; inputHash:string;
  sections:MathSection[]; imageHashes:Record<string,string>; totalPoints:number; resultId:string;
}
export interface CompositionDiagnostic { slotId?:string; message:string; ids?:string[] }
export type CompositionResult = {status:'success';witness:MathWitness;states:number} | {status:'unconfigured'|'data-error'|'insufficient'|'search-limit';diagnostics:CompositionDiagnostic[];states:number};
export interface CompositionOptions {
  seed:string;
  /** A complete-result constraint, for callers such as redraw; rejection resumes bounded search. */
  acceptComplete?:(sections:readonly MathSection[])=>boolean;
  acceptPartial?:(selected:readonly string[],mandatory:readonly string[])=>boolean;
}
const FORMS = [ ['選擇','choice',7,2],['做做看','choice',7,2],['填答','fill-blank',10,2],['比大小','fill-blank',6,2],['直式','vertical-calc',5,2],['應用','word-problem',6,5] ] as const;

/** Fixed contract forms; science's final section has three distinct quotas. */
export const COMPOSITION_FORMS: Record<(typeof SUBJECTS)[number],readonly (readonly [string,Question['type']|'mixed',number,number])[]> = {
 '數學':FORMS,
 '國語':[['國字注音','fill-blank',7,2],['改錯字','fill-blank',8,2],['部首造詞','fill-blank',4,2],['選字填空','fill-blank',7,2],['反義詞','fill-blank',1,2],['字詞填寫','fill-blank',6,2],['選擇','choice',5,2],['仿作','imitate-sentence',4,2],['造句','make-sentence',2,4],['排序','choice',1,2],['閱讀','choice',3,2]],
 '自然':[['是非','true-false',10,2],['選擇','choice',15,2],['勾選','multi-select',5,4],['圖表填答','mixed',5,6]],
 '社會':[['是非','true-false',15,2],['選擇','choice',15,2],['勾選','multi-select',3,8],['材料閱讀','choice',2,8]],
 '英語':[['大小寫','fill-blank',4,4],['字母順序','choice',6,4],['句型','choice',5,4],['看圖選句','choice',4,4],['配對','matching',1,4],['個人問答','personal-response',2,4],['短文閱讀','choice',3,4]],
};
/** Canonical JSON, preserving array order and every content-bearing field. */
export function compositionCanonical(value:unknown):string {
  if (Array.isArray(value)) return `[${value.map(v=>compositionCanonical(v)).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.entries(value).filter(([,v])=>v!==undefined).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,v])=>`${JSON.stringify(k)}:${compositionCanonical(v)}`).join(',')}}`;
  return JSON.stringify(value);
}
export async function compositionDigest(value:unknown) {
  const bytes = await globalThis.crypto.subtle.digest('SHA-256',new TextEncoder().encode(compositionCanonical(value)));
  return [...new Uint8Array(bytes)].map(x=>x.toString(16).padStart(2,'0')).join('');
}
/** Exact reviewed content identity; excludes filesystem locations, includes image bytes by hash. */
export function compositionReviewSnapshot(input:MathCompositionInput):string {
  return compositionCanonical({banks:input.banks.map(b=>({name:b.name,data:b.data})).sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0),images:[...input.images].sort(),imageHashes:input.imageHashes??{}});
}
export function compositionContentKey(q:Question, material?:unknown,imageHashes:Readonly<Record<string,string>>={}) {
  const ignored=new Set(['no','source','derivedFrom','explanation','examScope','unit','grade','subject','doubt','answer','sampleAnswer','space']);
  const content:Record<string,unknown>=Object.fromEntries(Object.entries(q).filter(([key])=>!ignored.has(key)));
  function normalized(value:unknown):unknown {
    if(typeof value==='string')return value.normalize('NFC').replace(/\s+/g,' ').trim();
    if(Array.isArray(value))return value.map(normalized);
    if(value!==null && typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([key])=>key!=='answer' && key!=='answers').map(([k,v])=>[k,k==='src' && typeof v==='string' && imageHashes[v]?imageHashes[v]:normalized(v)]));
    return value;
  }
  if ('options' in q) content.options=q.options.map(normalized).sort((a,b)=>{const x=compositionCanonical(a),y=compositionCanonical(b);return x<y?-1:x>y?1:0;});
  if(q.type==='matching') {
    // Assignment codes and answer links are presentation/grading metadata; the task
    // consists of the two multisets of visible contents, including image bytes.
    const ordered=(values:unknown[])=>values.map(normalized).sort((a,b)=>{const x=compositionCanonical(a),y=compositionCanonical(b);return x<y?-1:x>y?1:0;});
    content.left=ordered(q.left.map(item=>item.content));
    content.right=ordered(q.right.map(item=>item.content));
  }
  return compositionCanonical(normalized({content,material}));
}

/** Synchronous preflight, also usable by classification transactions before publishing a new view. */
export function validateCompositionConfiguration(input:MathCompositionInput) {
  const errors:CompositionDiagnostic[]=[];
  const missing:CompositionDiagnostic[]=[];
  for (const bank of input.banks) {
    const parsed=bankFileSchema.safeParse(bank.data);
    if (!parsed.success) errors.push(...parsed.error.issues.map(i=>({message:`${bank.file}:${i.path.join('.')}: ${i.message}`})));
  }
  if (errors.length) return {status:'data-error' as const,diagnostics:errors};
  const referencedImages=input.banks.flatMap(b=>[...b.data.questions.flatMap(imageReferences),...(b.data.groups??[]).flatMap(g=>g.image?[g.image.src]:[])]);
  for(const path of new Set(referencedImages)) if(!/^[0-9a-f]{64}$/.test(input.imageHashes?.[path]??''))errors.push({message:`圖片 ${path} 缺 SHA-256 內容雜湊`});
  errors.push(...checkBank({banks:input.banks,papers:[],images:input.images}).filter(p=>p.severity==='error').map(p=>({message:p.message})));
  if(errors.length)return {status:'data-error' as const,diagnostics:errors};
  const p=compositionProfileSchema.safeParse(input.profile), c=selectionConflictsSchema.safeParse(input.conflicts);
  if (input.profile === undefined || input.profile === null) return {status:'unconfigured' as const,diagnostics:[{message:'完整卷規則尚未配置'}]};
  if (!p.success || !c.success) return {status:'data-error' as const,diagnostics:[...(!p.success?p.error.issues:[]),...(!c.success?c.error.issues:[])].map(i=>({message:`${i.path.join('.')}: ${i.message}`}))};
  const profile=p.data,conflicts=c.data, report=assessScopes(input.banks,[]);
  if(!profile.reviewedSnapshotHash)missing.push({message:'題庫或圖片內容尚未核對'});
  if (!profile.evidence?.sources || !profile.evidence.candidates || !profile.evidence.print) missing.push({message:'來源、候選或列印證據尚未核對'});
  const forms=COMPOSITION_FORMS[profile.scope.subject];
  if (profile.sections.length!==forms.length) errors.push({message:'固定大題數不符'});
  const ids=new Set<string>();
  for (const [i,section] of profile.sections.entries()) {
    const form=forms[i];
    if (!form || section.title!==form[0] || section.type!==form[1] || section.slots.length!==form[2]) errors.push({message:`大題 ${section.id} 形式／題數錯誤`});
    if(ids.has(section.id)) errors.push({message:`大題 ID ${section.id} 重複`}); ids.add(section.id);
    for (const [slotIndex,slot] of section.slots.entries()) {
      const expectedType=section.type==='mixed'?(['diagram-label','diagram-label','table-fill','fill-blank','fill-blank'] as const)[slotIndex]:section.type;
      if((section.type==='mixed' && slot.type!==expectedType) || (slot.type && slot.type!==expectedType))errors.push({slotId:slot.id,message:'槽位題型配額不符'});
      if(ids.has(slot.id)) errors.push({slotId:slot.id,message:'槽位 ID 重複'}); ids.add(slot.id);
      if(slot.points!==form?.[3]) errors.push({slotId:slot.id,message:'槽位配分錯誤'});
      if(!slot.evidence) missing.push({slotId:slot.id,message:'參照／考點證據尚未核對'});
      if(new Set(slot.candidates.map(c=>c.id)).size!==slot.candidates.length) errors.push({slotId:slot.id,message:'候選 ID 重複'});
      for (const id of slot.referenceIds) {
        const q=report.index.get(id);
        if(!q || q.derivedFrom || q.type!==expectedType || !sameScope(fullScope(q),profile.scope)) errors.push({slotId:slot.id,message:`參照原題 ${id} 不存在、形式或範圍不符`});
        else if(report.questions.get(id)?.length)missing.push({slotId:slot.id,message:`參照原題 ${id} 尚有資格疑點`});
      }
      for (const candidate of slot.candidates) {
        const q=report.index.get(candidate.id);
        if(!candidate.evidence) missing.push({slotId:slot.id,message:`候選 ${candidate.id} 缺核對證據`});
        if(!q) {errors.push({slotId:slot.id,message:`候選 ${candidate.id} 不存在`});continue;}
        if(q.type!==expectedType) errors.push({slotId:slot.id,message:`候選 ${candidate.id} 題型不符`});
        const items=compositionAnswerItems(q);
        if(items!==slot.answerItems || (slot.space!==undefined && answerSpace(q)!==slot.space)) errors.push({slotId:slot.id,message:`候選 ${candidate.id} 作答條件不符`});
        for (const originalId of q.derivedFrom??[]) {
          const original=report.index.get(originalId);
          if(original && imageReferences(original).length) errors.push({slotId:slot.id,message:`候選 ${candidate.id} 不可衍生自圖題 ${originalId}`});
        }
        if(report.membership.has(candidate.id) && !section.variants?.some(v=>v.questionIds.includes(candidate.id))) errors.push({slotId:slot.id,message:`未配置的題組變體 ${candidate.id}`});
        if(profile.scope.subject==='英語' && section.title==='看圖選句' && !imageReferences(q).length) errors.push({slotId:slot.id,message:'看圖選句必須保留圖片'});
        if(profile.scope.subject==='英語' && section.title==='大小寫' && (q.type!=='fill-blank' || q.writingGuide!=='four-line'))errors.push({slotId:slot.id,message:'大小寫須保留四線格'});
      }
    }
  }
  const reading=profile.scope.subject==='國語'?'閱讀':profile.scope.subject==='社會'?'材料閱讀':profile.scope.subject==='英語'?'短文閱讀':undefined;
  for(const section of profile.sections) {
    if(section.title===reading && !section.variants?.length)missing.push({message:`${section.title} 缺已核對閱讀變體`});
    if(section.variants?.length && section.title!==reading)errors.push({message:'非閱讀大題不可使用閱讀變體'});
    const variantIds=new Set<string>();
    for(const variant of section.variants??[]) {
      if(variantIds.has(variant.id))errors.push({message:'閱讀變體 ID 重複'});variantIds.add(variant.id);
      if(!variant.evidence)missing.push({message:'閱讀變體缺核對證據'});
      if(variant.questionIds.length!==section.slots.length || new Set(variant.questionIds).size!==variant.questionIds.length)errors.push({message:'閱讀變體小題數不符'});
      for(const [i,id] of variant.questionIds.entries())if(report.membership.get(id)?.id!==variant.groupId || !section.slots[i]?.candidates.some(c=>c.id===id))errors.push({message:`閱讀變體成員不符 ${id}`});
    }
  }
  const groups=new Map([...report.membership.values()].map(m=>[m.id,m]));
  const pairKeys=new Set<string>();
  for(const pair of conflicts.pairs) {
    const [a,b]=pair.ids;
    const index=pair.kind==='question'?report.index:groups;
    if(a===b || !index.has(a) || !index.has(b)) errors.push({message:`近重配對引用錯誤 ${a} / ${b}`});
    const key=pair.kind+compositionCanonical([...pair.ids].sort());
    if(pairKeys.has(key)) errors.push({message:`近重配對重複 ${a} / ${b}`}); pairKeys.add(key);
    if(pair.kind==='question' && pair.memberPairs) errors.push({message:'題目配對不可有題組成員對應'});
    if(pair.kind==='group') {
      if(!pair.memberPairs?.length) errors.push({message:`題組近重缺成員對應 ${a} / ${b}`});
      for(const [x,y] of pair.memberPairs??[]) if(report.membership.get(x)?.id!==a || report.membership.get(y)?.id!==b) errors.push({message:`題組成員對應引用錯誤 ${x} / ${y}`});
    }
  }
  return errors.length ? {status:'data-error' as const,diagnostics:errors} : missing.length ? {status:'unconfigured' as const,diagnostics:missing} : {status:'ready' as const,diagnostics:[],profile,conflicts,report,imageHashes:input.imageHashes??{}};
}

function sectionsFrom(profile:MathProfile,questions:ReadonlyMap<string,Question>,selected:readonly string[],membership:ReturnType<typeof assessScopes>["membership"]):MathSection[] {
  let offset=0;
  return profile.sections.map(s=>({id:s.id,title:s.title,points:s.slots.reduce((n,x)=>n+x.points,0),materials:(()=>{const group=membership.get(selected[offset]??'');return group?[{beforeSlotId:s.slots[0]!.id,groupId:group.id,paragraphs:group.group.paragraphs,...(group.group.image?{image:group.group.image}:{})}]:[];})(),items:s.slots.map(slot=>{const questionId=selected[offset++]!;return {slotId:slot.id,questionId,points:slot.points,question:questions.get(questionId)!};})}));
}
function pairConflict(a:string,b:string,ready:Extract<ReturnType<typeof validateCompositionConfiguration>,{status:'ready'}>):string|undefined {
  if(a===b) return '重複 ID';
  const qa=ready.report.index.get(a)!,qb=ready.report.index.get(b)!;
  if((qa.derivedFrom??[a]).some(id=>(qb.derivedFrom??[b]).includes(id))) return '實際來源交集';
  if(ready.conflicts.pairs.some(p=>p.kind==='question' && p.ids.includes(a) && p.ids.includes(b))) return '已確認近重';
  const ga=ready.report.membership.get(a),gb=ready.report.membership.get(b);
  if(ga && gb && ga.id!==gb.id) {
    const sources=(g:typeof ga)=>g.group.derivedFrom?[g.group.derivedFrom]:[g.id];
    if(sources(ga).some(id=>sources(gb).includes(id)))return '題組材料來源交集';
    if(ready.conflicts.pairs.some(p=>p.kind==='group' && p.ids.includes(ga.id) && p.ids.includes(gb.id)))return '題組已確認近重';
  }
  const material=(g:typeof ga)=>g?{paragraphs:g.group.paragraphs,image:g.group.image}:undefined;
  if(compositionContentKey(qa,material(ga),ready.imageHashes)===compositionContentKey(qb,material(gb),ready.imageHashes)) return '相同作答內容';
  return undefined;
}
export async function compositionVersion(input:MathCompositionInput,profile:MathProfile,conflicts:SelectionConflicts) {
  const [profileHash,bankHash,conflictsHash]=await Promise.all([compositionDigest(profile),compositionDigest({banks:input.banks,images:input.images,imageHashes:input.imageHashes??{}}),compositionDigest(conflicts)]);
  return {profileHash,bankHash,conflictsHash,inputHash:await compositionDigest({coreVersion:COMPOSITION_CORE_VERSION,profileHash,bankHash,conflictsHash})};
}

/** Ordered candidates are supplied by the seeded caller. Every valid one-question extension
 * counts as one state, including full assignments. The empty root and rejected edges do not.
 * Complete-result constraints participate in backtracking and share the same fixed budget. */
export function searchCompositionCandidates(input:{
  slots:readonly {id:string;candidates:readonly string[]}[];
  conflict:(a:string,b:string)=>string|undefined;
  acceptComplete?:(ids:readonly string[])=>boolean;
  acceptPartial?:(ids:readonly string[],mandatory:readonly string[])=>boolean;
}):{status:'success';ids:string[];states:number}|{status:'insufficient'|'search-limit';states:number;diagnostics:CompositionDiagnostic[]} {
  let states=0,limited=false;const selected:string[]=[];const diagnostics=new Map<string,CompositionDiagnostic>();
  function search(depth:number):string[]|undefined {
    if(depth===input.slots.length)return !input.acceptComplete || input.acceptComplete([...selected])?[...selected]:undefined;
    const slot=input.slots[depth]!;
    for(const id of slot.candidates) {
      let conflict=false;
      for(const previous of selected) {
        const reason=id===previous?'重複 ID':input.conflict(id,previous);
        if(reason) {conflict=true;const key=compositionCanonical([slot.id,id,previous]);if(diagnostics.size<100)diagnostics.set(key,{slotId:slot.id,message:reason,ids:[id,previous]});break;}
      }
      if(conflict)continue;
      if(states===MAX_COMPOSITION_STATES){limited=true;return undefined;}
      states++;selected.push(id);
      const mandatory=input.slots.slice(depth+1).flatMap(s=>s.candidates.length===1?[s.candidates[0]!]:[]);
      const found=(!input.acceptPartial || input.acceptPartial(selected,mandatory))?search(depth+1):undefined;selected.pop();if(found)return found;if(limited)return undefined;
    }
    return undefined;
  }
  const ids=search(0);
  return ids?{status:'success',ids,states}:{status:limited?'search-limit':'insufficient',states,diagnostics:[{message:limited?'組卷未完成：達 100000 個部分配置狀態':'窮盡合法候選，無符合全部限制的完整卷'},...diagnostics.values()]};
}

export async function composePaper(input:MathCompositionInput,options:CompositionOptions):Promise<CompositionResult> {
  input=structuredClone(input);
  options={...options};
  const ready=validateCompositionConfiguration(input);
  if(ready.status!=='ready') return {...ready,states:0};
  if(typeof options.seed!=='string' || !options.seed.length) return {status:'data-error',diagnostics:[{message:'必須明示非空種子'}],states:0};
  const data=ready;
  if(data.profile.reviewedSnapshotHash!==await compositionReviewHash(input))return {status:'unconfigured',diagnostics:[{message:'題庫或圖片核對版本已過期'}],states:0};
  const conflictCache=new Map<string,string|undefined>();
  function cachedConflict(a:string,b:string) {
    const key=compositionCanonical([a,b].sort());
    if(!conflictCache.has(key))conflictCache.set(key,pairConflict(a,b,data));
    return conflictCache.get(key);
  }
  const hashes=await compositionVersion(input,data.profile,data.conflicts);
  // SHA-derived PRNG state; all order and state counting is fixed by the core version.
  const seedHash=await compositionDigest(options.seed); let randomState=parseInt(seedHash.slice(0,8),16)||1;
  const random=()=>{randomState^=randomState<<13;randomState^=randomState>>>17;randomState^=randomState<<5;return (randomState>>>0)/4294967296;};
  const slots=data.profile.sections.flatMap(s=>s.slots);
  const candidates=slots.map(slot=>{
    const ids=slot.candidates.filter(c=>{const q=data.report.index.get(c.id)!;return sameScope(fullScope(q),data.profile.scope) && data.report.questions.get(c.id)?.length===0;}).map(c=>c.id);
    for(let i=ids.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[ids[i],ids[j]]=[ids[j]!,ids[i]!];} return ids;
  });
  const deficits=candidates.flatMap((ids,i)=>ids.length?[]:[{slotId:slots[i]!.id,message:`${slots[i]!.concept} 需要 1 題，合格 0 題，差額 1`}]);
  if(deficits.length) return {status:'insufficient',diagnostics:deficits,states:0};
  const search=searchCompositionCandidates({slots:slots.map((s,i)=>({id:s.id,candidates:candidates[i]!})),conflict:cachedConflict,
    acceptPartial:options.acceptPartial,
    acceptComplete:ids=>validVariants(data.profile,ids) && (!options.acceptComplete || options.acceptComplete(sectionsFrom(data.profile,data.report.index,ids,data.report.membership)))});
  if(search.status!=='success')return search;
  const sections=sectionsFrom(data.profile,data.report.index,search.ids,data.report.membership);
  const states=search.states;
  const body={coreVersion:COMPOSITION_CORE_VERSION,profileId:data.profile.id,profileRevision:data.profile.revision,seed:options.seed,...hashes,sections,imageHashes:selectedImageHashes(sections,input),totalPoints:100};
  return {status:'success',states,witness:{...body,resultId:await compositionDigest(body)}};
}

/** Rechecks a saved/pre-made result against current configuration and immutable content. */
const witnessSchema=z.strictObject({
  coreVersion:text,profileId:text,profileRevision:text,seed:text,profileHash:text,bankHash:text,conflictsHash:text,inputHash:text,resultId:text,totalPoints:z.number(),imageHashes:z.record(z.string(),z.string()),
  sections:z.array(z.strictObject({id:text,title:text,points:z.number(),materials:z.array(z.strictObject({beforeSlotId:text,groupId:text,paragraphs:z.array(text),image:z.strictObject({src:text,alt:text}).optional()})),items:z.array(z.strictObject({slotId:text,questionId:text,points:z.number(),question:questionSchema}))})),
});
export async function validateCompositionWitness(input:MathCompositionInput,rawWitness:unknown,options:{allowVersionChange?:boolean}={}):Promise<CompositionDiagnostic[]> {
  input=structuredClone(input);
  const parsed=witnessSchema.safeParse(rawWitness);
  if(!parsed.success)return [{message:'見證格式錯誤'}];
  const witness=parsed.data;
  const ready=validateCompositionConfiguration(input);if(ready.status!=='ready')return ready.diagnostics;
  const issues:CompositionDiagnostic[]=[];const hashes=await compositionVersion(input,ready.profile,ready.conflicts);
  if(ready.profile.reviewedSnapshotHash!==await compositionReviewHash(input))issues.push({message:'題庫或圖片核對版本已過期'});
  if(!options.allowVersionChange)for(const key of ['profileHash','bankHash','conflictsHash','inputHash'] as const) if(witness[key]!==hashes[key])issues.push({message:`版本不符 ${key}`});
  if(witness.coreVersion!==COMPOSITION_CORE_VERSION || (!options.allowVersionChange && (witness.profileId!==ready.profile.id || witness.profileRevision!==ready.profile.revision)) || !witness.seed) issues.push({message:'核心、配置識別或種子不符'});
  const ids=witness.sections?.flatMap(s=>s.items.map(i=>i.questionId))??[];
  const expected=sectionsFrom(ready.profile,ready.report.index,ids,ready.report.membership);
  if(ids.length!==ready.profile.sections.reduce((n,s)=>n+s.slots.length,0) || !validVariants(ready.profile,ids) || witness.totalPoints!==100 || compositionCanonical(expected)!==compositionCanonical(witness.sections))issues.push({message:'槽位、順序、題目內容、材料或配分不符'});
  if(compositionCanonical(witness.imageHashes)!==compositionCanonical(selectedImageHashes(witness.sections,input)))issues.push({message:'已選圖片內容版本不符'});
  const slots=ready.profile.sections.flatMap(s=>s.slots);
  for(const [i,id] of ids.entries()) {
    if(!slots[i]?.candidates.some(c=>c.id===id) || !sameScope(fullScope(ready.report.index.get(id)??{grade:0,subject:'數學'}),ready.profile.scope) || ready.report.questions.get(id)?.length)issues.push({slotId:slots[i]?.id,message:`不合格候選 ${id}`});
    if(!ready.report.index.has(id)) continue;
    for(const previous of ids.slice(0,i)) if(ready.report.index.has(previous)) {const reason=pairConflict(id,previous,ready);if(reason)issues.push({message:reason,ids:[id,previous]});}
  }
  const {resultId,...body}=witness;if(resultId!==await compositionDigest(body))issues.push({message:'結果雜湊不符'});
  return issues;
}

/** Math compatibility boundary, intentionally refuses another subject. */
export function validateMathConfiguration(input:MathCompositionInput) {
 const ready=validateCompositionConfiguration(input);
 return ready.status==='ready' && ready.profile.scope.subject!=='數學'?{status:'data-error' as const,diagnostics:[{message:'數學配置科目不符'}]}:ready;
}
export async function composeMathPaper(input:MathCompositionInput,options:CompositionOptions):Promise<CompositionResult> {
 const ready=validateMathConfiguration(input);return ready.status==='ready'?composePaper(input,options):{...ready,states:0};
}
export async function validateMathWitness(input:MathCompositionInput,witness:unknown) {
 const ready=validateMathConfiguration(input);return ready.status==='ready'?validateCompositionWitness(input,witness):ready.diagnostics;
}
export function compositionAnswerItems(q:Question):number {
 switch(q.type) {
 case 'fill-blank':return q.answer.length;
 case 'diagram-label':return q.labels.length;
 case 'table-fill':return q.rows.reduce((n,r)=>n+r.answers.length,0);
 case 'matching':return q.left.length;
 default:return 1;
 }
}
function validVariants(profile:MathProfile,ids:readonly string[]) {
 let offset=0;return profile.sections.every(s=>{const selected=ids.slice(offset,offset+s.slots.length);offset+=s.slots.length;return !s.variants?.length || s.variants.some(v=>compositionCanonical(v.questionIds)===compositionCanonical(selected));});
}

export async function compositionReviewHash(input:MathCompositionInput) {return compositionDigest(JSON.parse(compositionReviewSnapshot(input)));}

function selectedImageHashes(sections:readonly MathSection[],input:MathCompositionInput):Record<string,string> {
 const paths=sections.flatMap(s=>[...s.items.flatMap(i=>imageReferences(i.question)),...s.materials.flatMap(m=>m.image?[m.image.src]:[])]);
 return Object.fromEntries([...new Set(paths)].sort().map(path=>[path,input.imageHashes?.[path]??'']));
}
