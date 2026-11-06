/** Cross-paper equivalence is deliberately different from within-paper source conflicts. */
import { composePaper, compositionContentKey, compositionDigest, compositionVersion, validateCompositionConfiguration, validateCompositionWitness, type MathCompositionInput, type MathSection, type MathWitness, type SelectionConflicts, type CompositionResult } from './paper-composition.ts';

function keyedItems(sections:readonly MathSection[],imageHashes:Readonly<Record<string,string>>) {
 return sections.flatMap(s=>s.items.map(item=>{
  const material=s.materials.find(m=>s.items.findIndex(i=>i.slotId===m.beforeSlotId)<=s.items.indexOf(item));
  return {...item,key:compositionContentKey(item.question,material?{paragraphs:material.paragraphs,image:material.image}:undefined,imageHashes)};
 }));
}
function compileComparison(previous:readonly MathSection[],available:readonly MathSection[],conflicts:SelectionConflicts,imageHashes:Readonly<Record<string,string>>={}) {
 const old=keyedItems(previous,imageHashes),fresh=keyedItems(available,imageHashes);
 const explicit=new Set(conflicts.pairs.flatMap(p=>(p.kind==='question'?[p.ids]:p.memberPairs??[]).flatMap(([a,b])=>[JSON.stringify([a,b]),JSON.stringify([b,a])])));
 const edges=new Map(fresh.map(b=>[b.questionId,old.flatMap((a,i)=>a.questionId===b.questionId || a.key===b.key || explicit.has(JSON.stringify([a.questionId,b.questionId]))?[i]:[])]));
 return (ids:readonly string[])=>{
  const owner=new Map<number,number>();
  function augment(i:number,seen:Set<number>):boolean {
   for(const j of edges.get(ids[i]!)??[])if(!seen.has(j)) {
    seen.add(j);const prior=owner.get(j);
    if(prior===undefined || augment(prior,seen)){owner.set(j,i);return true;}
   }
   return false;
  }
  for(let i=0;i<ids.length;i++)augment(i,new Set());
  return {matched:owner.size,changed:ids.length-owner.size,required:Math.ceil(ids.length/3)};
 };
}
/** Augmenting paths yield maximum cardinality, including ambiguous/non-transitive pairs. */
export function compareCompositionPapers(previous:readonly MathSection[],next:readonly MathSection[],conflicts:SelectionConflicts,imageHashes:Readonly<Record<string,string>>={}) {
 return compileComparison(previous,next,conflicts,imageHashes)(next.flatMap(s=>s.items.map(i=>i.questionId)));
}
export interface RedrawWitness extends MathWitness {
 operation:{mode:'first'|'redraw'|'version-restart';previousIdentity:string|null;previous:MathWitness|null;changed:number|null;required:number;resultHash:string};
}
export type RedrawResult=Exclude<CompositionResult,{status:'success'}>|{status:'success';witness:RedrawWitness;states:number}|{status:'redraw-impossible';diagnostics:{message:string}[];states:number};
export function paperOnly(witness:MathWitness):MathWitness {
 const {coreVersion,profileId,profileRevision,seed,profileHash,bankHash,conflictsHash,inputHash,sections,imageHashes,totalPoints,resultId}=witness;
 return {coreVersion,profileId,profileRevision,seed,profileHash,bankHash,conflictsHash,inputHash,sections,imageHashes,totalPoints,resultId};
}
export async function assessPreviousPaper(input:MathCompositionInput,previous:MathWitness) {
 input=structuredClone(input);previous=structuredClone(paperOnly(previous));
 const ready=validateCompositionConfiguration(input);
 if(ready.status!=='ready')return {sameVersion:false,valid:false,diagnostics:ready.diagnostics};
 const version=await compositionVersion(input,ready.profile,ready.conflicts);
 const diagnostics=await validateCompositionWitness(input,previous,{allowVersionChange:true});
 return {sameVersion:previous.inputHash===version.inputHash,valid:diagnostics.length===0,diagnostics};
}
export async function redrawPaper(input:MathCompositionInput,options:{seed:string;previous?:MathWitness}):Promise<RedrawResult> {
 input=structuredClone(input);options=structuredClone(options);
 const prior=options.previous?paperOnly(options.previous):undefined;
 const assessment=prior?await assessPreviousPaper(input,prior):undefined;
 if(assessment?.sameVersion && !assessment.valid)return {status:'data-error',diagnostics:assessment.diagnostics,states:0};
 const previous=assessment?.sameVersion && assessment.valid?prior:undefined;
 const conflicts=validateCompositionConfiguration(input);if(conflicts.status!=='ready')return {...conflicts,states:0};
 let completeSeen=false;
 const total=conflicts.profile.sections.reduce((n,s)=>n+s.slots.length,0);
 const partial=(ids:readonly string[]):MathSection[]=>[...new Set(ids)].map(id=>{const group=conflicts.report.membership.get(id);return {id,title:id,points:0,items:[{slotId:id,questionId:id,points:0,question:conflicts.report.index.get(id)!}],materials:group?[{beforeSlotId:id,groupId:group.id,paragraphs:group.group.paragraphs,image:group.group.image}]:[]};});
 const compare=previous?compileComparison(previous.sections,partial([...conflicts.report.index.keys()]),conflicts.conflicts,input.imageHashes):undefined;
 const result=await composePaper(input,{seed:options.seed,acceptPartial:(selected,mandatory)=>!compare || !completeSeen || total-compare([...new Set([...selected,...mandatory])]).matched>=Math.ceil(total/3),acceptComplete:sections=>{
  completeSeen=true;return !compare || compare(sections.flatMap(s=>s.items.map(i=>i.questionId))).changed>=Math.ceil(sections.flatMap(s=>s.items).length/3);
 }});
 if(result.status==='insufficient' && previous && completeSeen)return {status:'redraw-impossible',states:result.states,diagnostics:[{message:'可組完整卷，但無法達成本次重抽差異'}]};
 if(result.status!=='success')return result;
 const comparison=previous?compareCompositionPapers(previous.sections,result.witness.sections,conflicts.conflicts,input.imageHashes):undefined;
 const operation={mode:previous?'redraw' as const:prior?'version-restart' as const:'first' as const,previousIdentity:prior?.resultId??null,previous:prior??null,changed:comparison?.changed??null,required:Math.ceil(result.witness.sections.flatMap(s=>s.items).length/3)};
 return {...result,witness:{...result.witness,operation:{...operation,resultHash:await compositionDigest({paper:result.witness,operation})}}};
}
