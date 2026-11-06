import { expect, it } from 'vitest';
import { composeMathPaper, compositionReviewHash } from '../src/domain/paper-composition.ts';
import { mathFixture } from './fixtures/composition/math.ts';
it('refuses stale content evidence until explicitly reviewed again',async()=>{
 const input=mathFixture(); input.banks[0]!.data.questions[0]!.stem='changed';
 expect((await composeMathPaper(input,{seed:'review'})).status).toBe('unconfigured');
 input.profile.reviewedSnapshotHash=await compositionReviewHash(input);
 expect((await composeMathPaper(input,{seed:'review'})).status).toBe('success');
});

import { composePaper, validateCompositionWitness } from '../src/domain/paper-composition.ts';
import { subjectFixture } from './fixtures/composition/subjects.ts';
it('composes fixed five-subject full forms, including reviewed reading variants and science image/table quotas',async()=>{
 for(const subject of ['國語','數學','自然','社會','英語'] as const){
  const result=await composePaper(subjectFixture(subject),{seed:'full'});
  expect(result.status,subject).toBe('success');
  if(result.status!=='success')continue;
  expect(result.witness.sections.flatMap(s=>s.items)).toHaveLength({國語:48,數學:41,自然:35,社會:35,英語:25}[subject]);
  expect(result.witness.sections.reduce((n,s)=>n+s.points,0)).toBe(100);
  const expected={
   國語:[['國字注音',7,14],['改錯字',8,16],['部首造詞',4,8],['選字填空',7,14],['反義詞',1,2],['字詞填寫',6,12],['選擇',5,10],['仿作',4,8],['造句',2,8],['排序',1,2],['閱讀',3,6]],
   數學:[['選擇',7,14],['做做看',7,14],['填答',10,20],['比大小',6,12],['直式',5,10],['應用',6,30]],
   自然:[['是非',10,20],['選擇',15,30],['勾選',5,20],['圖表填答',5,30]],
   社會:[['是非',15,30],['選擇',15,30],['勾選',3,24],['材料閱讀',2,16]],
   英語:[['大小寫',4,16],['字母順序',6,24],['句型',5,20],['看圖選句',4,16],['配對',1,4],['個人問答',2,8],['短文閱讀',3,12]],
  };
  expect(result.witness.sections.map(s=>[s.title,s.items.length,s.points])).toEqual(expected[subject]);
  if(subject==='自然')expect(result.witness.sections[3]!.items.map(i=>i.question.type)).toEqual(['diagram-label','diagram-label','table-fill','fill-blank','fill-blank']);

  expect(await validateCompositionWitness(subjectFixture(subject),result.witness)).toEqual([]);
  expect(result.witness.sections.flatMap(s=>s.materials)).toHaveLength(['國語','社會','英語'].includes(subject)?1:0);
 }
});

import { redrawPaper, compareCompositionPapers } from '../src/domain/paper-redraw.ts';
import { review } from './fixtures/composition/subjects.ts';
it('does not report a successful redraw when the first full paper is the only solution',async()=>{
 const input=mathFixture(), first=await redrawPaper(input,{seed:'first'});
 if(first.status!=='success')throw Error('first');
 const result=await redrawPaper(input,{seed:'next',previous:first.witness});
 expect(result.status).toBe('redraw-impossible');expect(result).not.toHaveProperty('maximumChanges');
});

import { addAlternatives } from './fixtures/composition/subjects.ts';
it.each([['國語',15,16],['數學',13,14],['自然',11,12],['社會',11,12],['英語',8,9]] as const)('enforces %s full-form replacement boundary %i/%i without treating common sources as unchanged',async(subject,low,high)=>{
 for(const [count,status] of [[low,'redraw-impossible'],[high,'success']] as const){
  const input=addAlternatives(subjectFixture(subject),count);
  const first=await redrawPaper(input,{seed:'initial'});if(first.status!=='success')throw Error(JSON.stringify(first));
  const result=await redrawPaper(input,{seed:'redraw',previous:first.witness});
  expect(result.status,JSON.stringify(result)).toBe(status);
  if(result.status==='success') {
   expect(result.witness.operation.changed).toBe(high);
   expect(result.witness.operation.required).toBe(high);
   expect(result.witness.operation.previousIdentity).toBe(first.witness.resultId);
   expect(await redrawPaper(input,{seed:'redraw',previous:first.witness})).toEqual(result);
  }
 }
});

import { CompositionPreview } from '../src/domain/composition-preview.ts';
it('retains a valid paper and answer/paper settings after impossible redraw',async()=>{
 const preview=new CompositionPreview();await preview.load('math',async()=>mathFixture());
 await preview.generate('first');preview.setAnswers(true);preview.setPaperSize('A3');preview.setLayoutReady(true,preview.state.layoutRevision);
 const before=preview.state.paper;
 await preview.generate('impossible');
 expect(preview.state.status).toBe('redraw-impossible');expect(preview.state.paper).toEqual(before);
 expect(preview.state.answers).toBe(true);expect(preview.state.paperSize).toBe('A3');expect(preview.state.printReady).toBe(true);
});

it('uses maximum one-to-one matching instead of greedy or transitive pairing',async()=>{
 const input=addAlternatives(subjectFixture('數學'),2),first=await composePaper(input,{seed:'old'});
 if(first.status!=='success')throw Error('first');
 const old=structuredClone(first.witness.sections),fresh=structuredClone(old);
 const a=old[0]!.items[0]!,b=old[0]!.items[1]!;
 const x=fresh[0]!.items[0]!,y=fresh[0]!.items[1]!;
 x.questionId='x';x.question={...x.question,stem:'X'};y.questionId='y';y.question={...y.question,stem:'Y'};
 input.conflicts.pairs=[{kind:'question',ids:[a.questionId,'x'],reason:'checked'},{kind:'question',ids:[a.questionId,'y'],reason:'checked'},{kind:'question',ids:[b.questionId,'x'],reason:'checked'}];
 expect(compareCompositionPapers(old,fresh,input.conflicts)).toMatchObject({matched:41,changed:0});
 input.conflicts.pairs=[{kind:'question',ids:[a.questionId,'middle'],reason:'checked'},{kind:'question',ids:['middle','x'],reason:'checked'}];
 expect(compareCompositionPapers(old,fresh,input.conflicts).changed).toBe(2);
});

it('counts reordered identical content across IDs as unchanged, with explicit member mappings only',async()=>{
 const input=subjectFixture('國語'),first=await composePaper(input,{seed:'reading'});if(first.status!=='success')throw Error('first');
 const fresh=structuredClone(first.witness.sections);const reading=fresh.at(-1)!;
 reading.materials[0]!.paragraphs=['另一閱讀材料'];
 reading.items.forEach((item,i)=>{item.questionId=`new-${i}`;item.question={...item.question,stem:`新的閱讀考點 ${i}`};});
 const old=first.witness.sections.at(-1)!.items;
 input.conflicts.pairs=[{kind:'group',ids:['synthetic#1','new#1'],reason:'checked',memberPairs:[[old[0]!.questionId,'new-2']]}];
 expect(compareCompositionPapers(first.witness.sections,fresh,input.conflicts).changed).toBe(2);
 const math=await composePaper(subjectFixture('數學'),{seed:'same'});if(math.status!=='success')throw Error('math');
 const reordered=structuredClone(math.witness.sections);reordered[0]!.items.reverse();
 reordered[0]!.items.forEach(i=>{i.questionId=`renamed-${i.questionId}`;if(i.question.type==='choice')i.question.options.reverse();});
 expect(compareCompositionPapers(math.witness.sections,reordered,{schemaVersion:1,revision:'1',pairs:[]}).changed).toBe(0);
});

it('does not conflate search limit or malformed data with proven redraw impossibility',async()=>{
 const input=addAlternatives(subjectFixture('數學'),41),first=await redrawPaper(input,{seed:'limit-first'});if(first.status!=='success')throw Error('first');
 // Every alternative is explicitly near the corresponding previous item, so no difference is possible.
 // Keep two choices at every slot: bounded search must stop before proving exhaustion.
 input.conflicts.pairs=input.profile.sections.flatMap(s=>s.slots).map(s=>({kind:'question' as const,ids:[s.candidates[0]!.id,s.candidates[1]!.id] as [string,string],reason:'checked'}));
 const prior=await redrawPaper(input,{seed:'new-version'});if(prior.status!=='success')throw Error('prior');
 // Disable no safe pruning: each slot still has a choice, and every partial match below the threshold remains possible until late.
 const result=await redrawPaper(input,{seed:'limit-next',previous:prior.witness});
 expect(result.status).toBe('search-limit');expect(result.states).toBe(100000);expect(result).not.toHaveProperty('maximumChanges');
 input.conflicts.pairs.push({kind:'question',ids:['missing','also-missing'],reason:'invalid'});
 expect((await redrawPaper(input,{seed:'bad',previous:prior.witness})).status).toBe('data-error');
});

it('revalidates content, eligibility and sources on versions and restarts without a cross-version promise',async()=>{
 const preview=new CompositionPreview(),input=mathFixture();await preview.load('math',async()=>input);await preview.generate('v1');preview.setLayoutReady(true,preview.state.layoutRevision);
 input.conflicts.revision='v2';await preview.load('math',async()=>input);
 expect(preview.state.restart).toBe(true);expect(preview.state.printReady).toBe(true);
 await preview.generate('v2');expect(preview.state.paper?.operation.mode).toBe('version-restart');expect(preview.state.paper?.operation.changed).toBeNull();
 input.banks[0]!.data.questions[0]!.stem='changed source content';review(input);
 await preview.load('math',async()=>input);expect(preview.state.printReady).toBe(false);expect(preview.state.diagnostics.length).toBeGreaterThan(0);
 await preview.generate('v3');expect(preview.state.status).toBe('success');expect(preview.state.paper?.operation.mode).toBe('version-restart');
 input.banks[0]!.data.questions[0]!.doubt='unresolved';review(input);
 await preview.load('math',async()=>input);expect(preview.state.printReady).toBe(false);expect(preview.state.status).toBe('unconfigured');
});

it('ignores late redraw and late range loads and retains settings after load failure',async()=>{
 const preview=new CompositionPreview();await preview.load('math',async()=>addAlternatives(subjectFixture('數學'),14));
 const earlier=preview.generate('earlier'),latest=preview.generate('latest');await Promise.all([earlier,latest]);expect(preview.state.paper?.seed).toBe('latest');
 let release!:(input:ReturnType<typeof subjectFixture>)=>void;
 const delayed=preview.load('chinese',()=>new Promise(resolve=>{release=resolve;}));
 await preview.load('english',async()=>subjectFixture('英語'));await preview.generate('english');release(subjectFixture('國語'));await delayed;
 expect(preview.state.scope).toBe('english');expect(preview.state.paper?.seed).toBe('english');
 preview.setAnswers(true);preview.setPaperSize('A3');await preview.load('english',async()=>{throw Error('read failed');});
 expect(preview.state.status).toBe('load-error');expect(preview.state.paper?.seed).toBe('english');expect(preview.state.printReady).toBe(false);expect(preview.state.answers).toBe(true);expect(preview.state.paperSize).toBe('A3');
});

it('binds reviewed evidence to answer and image contents, and rejects doubtful reference anchors after explicit review',async()=>{
 for(const mutation of ['answer','image'] as const){
  const input=subjectFixture('英語');
  if(mutation==='answer'){const q=input.banks[0]!.data.questions[4]!;if(q.type==='choice')q.answer=2;}else input.imageHashes={'synthetic.png':'f'.repeat(64)};
  expect((await composePaper(input,{seed:'stale'})).status).toBe('unconfigured');review(input);expect((await composePaper(input,{seed:'reviewed'})).status).toBe('success');
 }
 const input=subjectFixture('數學');input.banks[0]!.data.questions[0]!.doubt='參照未核對';input.profile.sections[0]!.slots[0]!.candidates=[{id:'synthetic-02',evidence:'sound original'}];review(input);
 expect((await composePaper(input,{seed:'doubt'})).status).toBe('unconfigured');
 const groups=subjectFixture('國語');groups.banks[0]!.data.groups![0]!.doubt='材料未核對';review(groups);
 expect((await composePaper(groups,{seed:'group-doubt'})).status).toBe('unconfigured');
});

it('revalidates selected image bytes precisely while unrelated images and version-only edits can retain old print readiness',async()=>{
 const input=subjectFixture('英語'),preview=new CompositionPreview();input.images=[...input.images,'unused.png'];input.imageHashes={...input.imageHashes,'unused.png':'0'.repeat(64)};review(input);
 await preview.load('english',async()=>input);await preview.generate('v1');preview.setLayoutReady(true,preview.state.layoutRevision);
 input.imageHashes={...input.imageHashes,'unused.png':'1'.repeat(64)};review(input);await preview.load('english',async()=>input);expect(preview.state.printReady).toBe(true);expect(preview.state.restart).toBe(true);
 input.imageHashes={...input.imageHashes,'synthetic.png':'1'.repeat(64)};review(input);await preview.load('english',async()=>input);expect(preview.state.printReady).toBe(false);expect(preview.state.diagnostics).toContainEqual({message:'已選圖片內容版本不符'});
});

it('ignores stale layout readiness for old answers, paper size and completed papers',async()=>{
 const preview=new CompositionPreview();await preview.load('math',async()=>addAlternatives(subjectFixture('數學'),14));await preview.generate('first');
 const first=preview.state.layoutRevision;preview.setAnswers(true);preview.setLayoutReady(true,first);expect(preview.state.printReady).toBe(false);
 preview.setLayoutReady(true,preview.state.layoutRevision);const answerRevision=preview.state.layoutRevision;preview.setPaperSize('A3');preview.setLayoutReady(true,answerRevision);expect(preview.state.printReady).toBe(false);
 const old=preview.state.layoutRevision;await preview.generate('redraw');preview.setLayoutReady(true,old);expect(preview.state.printReady).toBe(false);
 preview.setLayoutReady(true,preview.state.layoutRevision);expect(preview.state.printReady).toBe(true);
});

it('an early generate cannot invalidate a still-loading snapshot',async()=>{
 const preview=new CompositionPreview();let release!:(input:ReturnType<typeof subjectFixture>)=>void;
 const loading=preview.load('math',()=>new Promise(resolve=>{release=resolve;}));await preview.generate('too-early');
 expect(preview.state.status).toBe('loading');expect(preview.state.pending).toBe(true);
 release(subjectFixture('數學'));await loading;expect(preview.state.status).toBe('ready');await preview.generate('after-load');expect(preview.state.status).toBe('success');
});

it('matches images by byte hash and cannot count identical pictures under new paths as replacements',async()=>{
 const input=subjectFixture('英語'),first=await composePaper(input,{seed:'images'});if(first.status!=='success')throw Error('first');
 const fresh=structuredClone(first.witness.sections);fresh[3]!.items.forEach(item=>{item.questionId=`copy-${item.questionId}`;item.question.image={src:'copied.png',alt:'合成圖'};});
 expect(compareCompositionPapers(first.witness.sections,fresh,input.conflicts,{'synthetic.png':'0'.repeat(64),'copied.png':'0'.repeat(64)}).changed).toBe(0);
});

it('rejects reading variants with omitted members, mixed groups or invalid member-pair references',async()=>{
 for(const kind of ['omitted','mixed','mapping'] as const){
  const input=subjectFixture('國語'),reading=input.profile.sections.at(-1)!;
  if(kind==='omitted')reading.variants![0]!.questionIds.pop();
  else if(kind==='mixed')reading.variants![0]!.questionIds[1]='synthetic-01';
  else input.conflicts.pairs=[{kind:'group',ids:['synthetic#1','missing#1'],reason:'checked',memberPairs:[['synthetic-01','synthetic-02']]}];
  expect((await composePaper(input,{seed:'invalid-reading'})).status).toBe('data-error');
 }
});

it('does not count matching-board row or answer-pool reordering and renamed assignment codes as a changed question',async()=>{
 const input=subjectFixture('英語'),first=await composePaper(input,{seed:'matching'});if(first.status!=='success')throw Error('first');
 const next=structuredClone(first.witness.sections),item=next[4]!.items[0]!;item.questionId='renamed-matching';
 if(item.question.type!=='matching')throw Error('matching form');
 item.question.left.reverse();item.question.right.reverse();
 item.question.left.forEach(x=>{x.answer=`new-${x.answer}`;});item.question.right.forEach(x=>{x.code=`new-${x.code}`;});
 expect(compareCompositionPapers(first.witness.sections,next,input.conflicts).changed).toBe(0);
 item.question.left[0]!.content='實質新增的配對內容';
 expect(compareCompositionPapers(first.witness.sections,next,input.conflicts).changed).toBe(1);
});
