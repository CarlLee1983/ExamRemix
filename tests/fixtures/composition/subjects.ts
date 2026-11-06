import { createHash } from 'node:crypto';
import { bankFileSchema, type Question, type SUBJECTS } from '../../../src/domain/schema.ts';
import { COMPOSITION_FORMS, compositionProfileSchema, compositionReviewSnapshot, compositionAnswerItems, type MathCompositionInput, type MathProfile, type SelectionConflicts } from '../../../src/domain/paper-composition.ts';
export function review(input:MathCompositionInput & {profile:MathProfile}) {
 input.profile.reviewedSnapshotHash=createHash('sha256').update(compositionReviewSnapshot(input)).digest('hex');return input;
}
/** Full synthetic forms; each slot has a distinct concept and reviewed candidate. */
export function subjectFixture(subject:(typeof SUBJECTS)[number]):MathCompositionInput & {profile:MathProfile;conflicts:SelectionConflicts} {
 let no=0;const questions:Question[]=[];
 const sections=COMPOSITION_FORMS[subject].map(([title,type,count,points],i)=>({id:`s${i}`,title,type,slots:Array.from({length:count},(_,j)=>{
  const slotType=type==='mixed'?(['diagram-label','diagram-label','table-fill','fill-blank','fill-blank'] as const)[j]!:type;
  no++;const id=`synthetic-${String(no).padStart(2,'0')}`;
  const base={no,type:slotType,subject,grade:3,examScope:{semester:1,stage:'midterm'},stem:`合成 ${no}`,explanation:`解析 ${no}`,source:{originalPaper:'synthetic',number:no}};
  const fields=slotType==='choice'?{options:['甲','乙'],answer:1,...(subject==='英語' && title==='看圖選句'?{image:{src:'synthetic.png',alt:'合成圖'}}:{})}:slotType==='fill-blank'?{stem:`合成 ${no} ___`,answer:[subject==='英語'?'A':'1'],...(subject==='英語'?{writingGuide:'four-line'}:{})}:slotType==='multi-select'?{options:['甲','乙'],answer:[1]}:slotType==='true-false'?{answer:true}:slotType==='diagram-label'?{image:{src:'synthetic.png',alt:'合成圖'},labels:[{x:0,y:0,width:20,height:10,answer:'1'}]}:slotType==='table-fill'?{columns:['項目'],rows:[{label:'甲',answers:['1']}]}:slotType==='matching'?{left:[{content:'甲',answer:'a'},{content:'乙',answer:'b'}],right:[{code:'a',content:'A'},{code:'b',content:'B'}],mode:'one-to-one'}:slotType==='personal-response'?{writingGuide:'four-line',sampleAnswer:'I am fine.'}:slotType==='imitate-sentence'?{example:'天空很藍',answer:'小草很綠'}:slotType==='vertical-calc'?{operands:['1','2'],operator:'+',answer:'3'}:{answer:'答案'};
  const question=bankFileSchema.parse({questions:[{...base,...fields}]}).questions[0]!;questions.push(question);
  return {id:`s${i}-${j}`,type:slotType,points,concept:`考點 ${i}-${j}`,difficulty:'三年級',answerItems:compositionAnswerItems(question),layout:'checked synthetic',referenceIds:[id],evidence:'synthetic',candidates:[{id,evidence:'synthetic'}]};
 })}));
 const reading=['國語','社會','英語'].includes(subject)?sections.at(-1):undefined;
 const ids=reading?.slots.map(s=>s.candidates[0]!.id);
 const profile=compositionProfileSchema.parse({schemaVersion:1,id:`synthetic-${subject}`,revision:'1',scope:{grade:3,subject,semester:1,stage:'midterm'},evidence:{sources:'synthetic',candidates:'synthetic',print:'synthetic'},sections:sections.map(s=>s===reading?{...s,variants:[{id:'reading-original',groupId:'synthetic#1',questionIds:ids,evidence:'synthetic'}]}:s)});
 const data=bankFileSchema.parse({questions,...(reading?{groups:[{no:1,paragraphs:['合成閱讀材料'],members:reading.slots.map(s=>Number(s.candidates[0]!.id.split('-')[1]))}]}:{})});
 const images=questions.some(q=>'image' in q)?['synthetic.png']:[];
 const input={profile,conflicts:{schemaVersion:1 as const,revision:'1',pairs:[]},banks:[{name:'synthetic',file:'bank/synthetic.yaml',data}],images,imageHashes:Object.fromEntries(images.map(p=>[p,'0'.repeat(64)]))};review(input);return input;
}
/** Add independently reviewed, substantially changed same-source alternatives. */
export function addAlternatives(input:ReturnType<typeof subjectFixture>,count:number) {
 const slots=input.profile.sections.flatMap(s=>s.slots);const originals=[...input.banks[0]!.data.questions];
 for(let i=0;i<count;i++) {
  const q=originals[i]!,no=originals.length+i+1,id=`synthetic-${String(no).padStart(2,'0')}`;
  const {source,...base}=q;
  input.banks[0]!.data.questions.push({...base,no,stem:q.stem.replace('合成','新情境數字 200'),derivedFrom:[slots[i]!.candidates[0]!.id]});
  slots[i]!.candidates.push({id,evidence:'synthetic-rechecked'});
 }
 review(input);return input;
}
