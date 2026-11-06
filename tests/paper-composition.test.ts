import { review } from './fixtures/composition/subjects.ts';
import { expect, it } from 'vitest';
import { composeMathPaper, compositionContentKey, compositionReviewHash, compositionReviewSnapshot, validateMathWitness } from '../src/domain/paper-composition.ts';
import { mathFixture } from './fixtures/composition/math.ts';

it('produces exactly six ordered math sections, 41 questions and 100 points with reproducible witness', async () => {
  const input = mathFixture();
  const result = await composeMathPaper(review(input),{seed:'demo'});
  expect(result.status).toBe('success');
  if (result.status !== 'success') return;
  expect(result.witness.sections.map(s=>[s.title,s.items.length,s.points])).toEqual([
    ['選擇',7,14],['做做看',7,14],['填答',10,20],['比大小',6,12],['直式',5,10],['應用',6,30],
  ]);
  expect(result.witness.totalPoints).toBe(100);
  expect(result.witness.sections.flatMap(s=>s.items)).toHaveLength(41);
  expect(await validateMathWitness(input,result.witness)).toEqual([]);
  expect(await composeMathPaper(review(input),{seed:'demo'})).toEqual(result);
});


it('distinguishes missing candidate evidence from invalid points and references', async () => {
  const missing=mathFixture();
  delete missing.profile.sections[0]!.slots[0]!.candidates[0]!.evidence;
  expect((await composeMathPaper(missing,{seed:'x'})).status).toBe('unconfigured');
  const badPoints=mathFixture();badPoints.profile.sections[0]!.slots[0]!.points=3;
  expect((await composeMathPaper(badPoints,{seed:'x'})).status).toBe('data-error');
  const badReference=mathFixture();badReference.profile.sections[0]!.slots[0]!.referenceIds=['missing-01'];
  expect((await composeMathPaper(badReference,{seed:'x'})).status).toBe('data-error');
});

it('detects whole-paper ID competition even though every slot has a qualified candidate', async () => {
  const input=mathFixture();
  input.profile.sections[0]!.slots[1]!.candidates=[{id:'synthetic-01',evidence:'checked'}];
  const result=await composeMathPaper(review(input),{seed:'x'});
  expect(result.status).toBe('insufficient');
  if(result.status==='insufficient')expect(result.diagnostics).toContainEqual(expect.objectContaining({message:'重複 ID',ids:['synthetic-01','synthetic-01']}));
  expect(result).not.toHaveProperty('witness');
});

it('uses actual source intersections without making the relation transitive', async () => {
  const input=mathFixture();const q=input.banks[0]!.data.questions[0]!;
  for(const [no,sources] of [[42,['synthetic-01']],[43,['synthetic-01','synthetic-02']],[44,['synthetic-02']]] as const) {
    const {source,...base}=q;
    input.banks[0]!.data.questions.push({...base,no,stem:`新題 ${no}`,derivedFrom:[...sources]});
  }
  input.profile.sections[0]!.slots[0]!.candidates=[{id:'synthetic-42',evidence:'checked'}];
  input.profile.sections[0]!.slots[1]!.candidates=[{id:'synthetic-44',evidence:'checked'}];
  expect((await composeMathPaper(review(input),{seed:'x'})).status).toBe('success');
  input.profile.sections[0]!.slots[1]!.candidates=[{id:'synthetic-43',evidence:'checked'}];
  expect((await composeMathPaper(review(input),{seed:'x'})).status).toBe('insufficient');
});

it('allows original picture questions but rejects derivation from a picture', async () => {
  const input=mathFixture();const q=input.banks[0]!.data.questions[0]!;
  q.image={src:'synthetic.png',alt:'合成圖'};input.images=['synthetic.png'];input.imageHashes={'synthetic.png':'0'.repeat(64)};
  expect((await composeMathPaper(review(input),{seed:'x'})).status).toBe('success');
  const {source,...base}=q;
  input.banks[0]!.data.questions.push({...base,no:42,derivedFrom:['synthetic-01']});
  input.profile.sections[0]!.slots[0]!.candidates=[{id:'synthetic-42',evidence:'checked'}];
  expect((await composeMathPaper(review(input),{seed:'x'})).status).toBe('data-error');
});

it('rejects tampered or stale witnesses instead of relying on the seed', async () => {
  const input=mathFixture(),result=await composeMathPaper(review(input),{seed:'x'});
  if(result.status!=='success')throw new Error('fixture must compose');
  result.witness.sections[0]!.items[0]!.points=5;
  expect(await validateMathWitness(input,result.witness)).toContainEqual(expect.objectContaining({message:'槽位、順序、題目內容、材料或配分不符'}));
  input.conflicts.revision='2';
  expect(await validateMathWitness(input,result.witness)).toContainEqual(expect.objectContaining({message:'版本不符 conflictsHash'}));
});

it('rejects identical content despite option reordering and a different ID', async () => {
  const input=mathFixture();const q=input.banks[0]!.data.questions[0]!;
  if(q.type!=='choice')throw new Error('choice fixture');
  input.banks[0]!.data.questions.push({...q,no:42,options:[...q.options].reverse(),answer:2});
  input.profile.sections[0]!.slots[1]!.candidates=[{id:'synthetic-42',evidence:'checked'}];
  expect((await composeMathPaper(review(input),{seed:'x'})).status).toBe('insufficient');
});

it('rejects identical visible options whose whitespace changes their raw sort order', async () => {
  const input=mathFixture();const q=input.banks[0]!.data.questions[0]!;
  if(q.type!=='choice')throw new Error('choice fixture');
  q.options=[' A','B'];
  const duplicate={...q,no:42,options:['A',' B']};
  expect(compositionContentKey(q)).toBe(compositionContentKey(duplicate));
  input.banks[0]!.data.questions.push(duplicate);
  input.profile.sections[0]!.slots[1]!.candidates=[{id:'synthetic-42',evidence:'checked'}];
  const result=await composeMathPaper(review(input),{seed:'normalized-options'});
  expect(result.status).toBe('insufficient');
  if(result.status==='insufficient')expect(result.diagnostics).toContainEqual(expect.objectContaining({message:'相同作答內容'}));
});

it('orders reviewed banks by code units and preserves the review hash when input order changes', async () => {
  const input=mathFixture(),bank=input.banks[0]!;
  input.banks=[{...bank,name:'a'},{...bank,name:'A'}];
  expect(JSON.parse(compositionReviewSnapshot(input)).banks.map((b:{name:string})=>b.name)).toEqual(['A','a']);
  const hash=await compositionReviewHash(input);
  input.banks=[...input.banks].reverse();
  expect(await compositionReviewHash(input)).toBe(hash);
});

it('stops at exactly 100000 states without reporting bounded search as proven impossible', async () => {
  const input=mathFixture();
  for(const [i,q] of [...input.banks[0]!.data.questions].entries()) {
    const no=i+42;
    input.banks[0]!.data.questions.push({...q,no,stem:q.type==='fill-blank'?`另一合成 ${no} ___`:`另一合成 ${no}`});
    input.profile.sections.flatMap(s=>s.slots)[i]!.candidates.push({id:`synthetic-${no}`,evidence:'checked'});
  }
  const result=await composeMathPaper(review(input),{seed:'bounded',acceptComplete:()=>false});
  expect(result.status).toBe('search-limit');
  expect(result.states).toBe(100000);
  expect(result).not.toHaveProperty('witness');
});

it('does not transitively expand confirmed near-duplicate pairs', async () => {
  const input=mathFixture(),q=input.banks[0]!.data.questions[0]!;
  input.banks[0]!.data.questions.push({...q,no:42,stem:'未入選的中介題'});
  input.conflicts.pairs=[{kind:'question',ids:['synthetic-01','synthetic-42'],reason:'checked'},{kind:'question',ids:['synthetic-42','synthetic-02'],reason:'checked'}];
  expect((await composeMathPaper(review(input),{seed:'pairs'})).status).toBe('success');
  input.conflicts.pairs.push({kind:'question',ids:['synthetic-01','synthetic-02'],reason:'checked'});
  const result=await composeMathPaper(review(input),{seed:'pairs'});
  expect(result.status).toBe('insufficient');
  if(result.status==='insufficient')expect(result.diagnostics).toContainEqual(expect.objectContaining({message:'已確認近重'}));
});

it('backtracks across slots instead of returning a partial paper after a conflict', async () => {
  const input=mathFixture(),q=input.banks[0]!.data.questions[0]!;
  input.banks[0]!.data.questions.push({...q,no:42,stem:'獨立可用的另一題'});
  input.profile.sections[0]!.slots[0]!.candidates.push({id:'synthetic-42',evidence:'checked'});
  input.profile.sections[0]!.slots[1]!.candidates=[{id:'synthetic-01',evidence:'checked'}];
  const result=await composeMathPaper(review(input),{seed:'backtrack'});
  expect(result.status).toBe('success');
  if(result.status==='success')expect(result.witness.sections[0]!.items.slice(0,2).map(i=>i.questionId)).toEqual(['synthetic-42','synthetic-01']);
});

it('captures immutable async input and rejects malformed witness JSON', async () => {
  const input=mathFixture();
  const pending=composeMathPaper(review(input),{seed:'immutable'});
  input.banks[0]!.data.questions[0]!.stem='late mutation';
  const result=await pending;
  expect(result.status).toBe('success');
  if(result.status==='success')expect(result.witness.sections[0]!.items[0]!.question.stem).toBe('合成題 1');
  expect(await validateMathWitness(input,{sections:null})).toEqual([{message:'見證格式錯誤'}]);
});

it('requires image-byte hashes and invalidates a witness after image bytes change', async () => {
  const input=mathFixture();input.banks[0]!.data.questions[0]!.image={src:'math.png',alt:'合成圖'};input.images=['math.png'];
  expect((await composeMathPaper(review(input),{seed:'images'})).status).toBe('data-error');
  input.imageHashes={'math.png':'0'.repeat(64)};
  const result=await composeMathPaper(review(input),{seed:'images'});
  if(result.status!=='success')throw new Error('image fixture must compose');
  input.imageHashes={'math.png':'1'.repeat(64)};
  expect(await validateMathWitness(input,result.witness)).toContainEqual({message:'版本不符 bankHash'});
});
