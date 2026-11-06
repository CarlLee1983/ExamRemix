import { createHash } from 'node:crypto';
import { bankFileSchema } from '../../../src/domain/schema.ts';
import { compositionReviewSnapshot, mathProfileSchema, selectionConflictsSchema, type MathProfile, type SelectionConflicts, type MathCompositionInput } from '../../../src/domain/paper-composition.ts';

/** Synthetic evidence only; never written to the formal data directory. */
export function mathFixture(): MathCompositionInput & {profile:MathProfile;conflicts:SelectionConflicts} {
  const forms = [['選擇', 'choice', 7, 2], ['做做看', 'choice', 7, 2], ['填答', 'fill-blank', 10, 2], ['比大小', 'fill-blank', 6, 2], ['直式', 'vertical-calc', 5, 2], ['應用', 'word-problem', 6, 5]] as const;
  let no = 0;
  const questions: unknown[] = [];
  const sections = forms.map(([title, type, count, points], i) => ({
    id: `s${i}`, title, type,
    slots: Array.from({length:count}, (_, j) => {
      no++;
      const id = `synthetic-${String(no).padStart(2,'0')}`;
      const base = {no, type, subject:'數學', grade:3, examScope:{semester:1,stage:'midterm'}, stem:`合成題 ${no}`, explanation:`合成解析 ${no}`, source:{originalPaper:'synthetic',number:no}};
      questions.push(type === 'choice' ? {...base,options:['甲','乙'],answer:1} : type === 'fill-blank' ? {...base,stem:`合成題 ${no} ___`,answer:['1']} : type === 'vertical-calc' ? {...base,operands:['1','2'],operator:'+',answer:'3'} : {...base,answer:'1'});
      return {id:`s${i}-${j}`,points,concept:`考點 ${i}-${j}`,difficulty:'三年級',answerItems:1,layout:'A4/A3 checked synthetic',referenceIds:[id],evidence:'synthetic-reference',candidates:[{id,evidence:'synthetic-candidate'}]};
    }),
  }));
  const input = {profile:mathProfileSchema.parse({schemaVersion:1,id:'synthetic-math',revision:'1',scope:{grade:3,subject:'數學',semester:1,stage:'midterm'},evidence:{sources:'synthetic',candidates:'synthetic',print:'synthetic'},sections}),conflicts:selectionConflictsSchema.parse({schemaVersion:1,revision:'1',pairs:[]}),banks:[{name:'synthetic',file:'bank/synthetic.yaml',data:bankFileSchema.parse({questions})}],images:[]};
  input.profile.reviewedSnapshotHash=createHash('sha256').update(compositionReviewSnapshot(input)).digest('hex');
  return input;
}
