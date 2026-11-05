import { describe, expect, it } from 'vitest';
import { questionSchema, paperFileSchema } from '../src/domain/schema';
const q = { no: 1, type: 'choice', subject: '數學', grade: 3, stem: '1+1？', options: ['2','3'], answer: 1, explanation: '1+1=2', source: { originalPaper: '合成卷', number: 1 } };
describe('考試範圍 schema', () => {
  it('允許完整範圍與舊資料未知，不推定預設分類', () => {
    expect(questionSchema.parse(q).examScope).toBeUndefined();
    expect(questionSchema.safeParse({ ...q, examScope: { semester: 1, stage: 'midterm' } }).success).toBe(true);
    expect(paperFileSchema.safeParse({ title: '合成', subject: '數學', grade: 3, examScope: { semester: 2, stage: 'final' }, sections: [{title:'一',questions:['x-01']}] }).success).toBe(true);
  });
  it.each([{}, {semester:1}, {stage:'midterm'}, {semester:'1',stage:'midterm'}, {semester:3,stage:'midterm'}, {semester:1,stage:'unknown'}, {semester:1,stage:'midterm',grade:3}])('拒絕不完整或非法範圍 %j', examScope => {
    expect(questionSchema.safeParse({...q,examScope}).success).toBe(false);
  });
});

import { checkBank } from '../src/domain/bank-check';
import { bankFileSchema } from '../src/domain/schema';
import { assessScopes, scopeStatus, SUPPORTED_SCOPES } from '../src/domain/exam-scope';
const mid = { semester: 1 as const, stage: 'midterm' as const };
const bank = (questions: object[], groups?: object[]) => ({ name: 'sample', file: 'bank/sample.yaml', data: bankFileSchema.parse({questions, ...(groups ? {groups} : {})}) });
const paper = (examScope: object | undefined = mid, ids=['sample-01']) => ({ file:'papers/test.yaml', data:paperFileSchema.parse({ title:'合成',subject:'數學',grade:3,...(examScope ? {examScope}:{}),sections:[{title:'一',questions:ids}] }) });
describe('共用範圍資格、容量與試卷輸出', () => {
  it('未知不計容量，不從檔名推論；有題未配置與未支援分開', () => {
    const result = assessScopes([bank([q])],[paper(undefined)]);
    expect(result.questions.get('sample-01')).toContain('考試範圍未知');
    expect(result.papers.get('papers/test.yaml')?.length).toBeGreaterThan(0);
    expect(scopeStatus(result, SUPPORTED_SCOPES[0]!)).toMatchObject({state:'empty',count:0});
    const valid = assessScopes([bank([{...q,examScope:mid}])], [paper()]);
    expect(scopeStatus(valid,{grade:3,subject:'數學',...mid})).toMatchObject({state:'unconfigured',count:1});
    expect(scopeStatus(valid,{grade:3,subject:'數學',semester:2,stage:'final'})).toMatchObject({state:'unsupported'});
    expect(valid.papers.get('papers/test.yaml')).toEqual([]);
  });
  it('未知／疑點／不同範圍／未支援卷停止輸出，解除疑點後才恢復', () => {
    const input=bank([{...q,examScope:mid,doubt:'待核對'}]);
    const excluded=assessScopes([input],[paper()]);
    expect(excluded.papers.get('papers/test.yaml')?.join(' ')).toContain('sample-01');
    expect(scopeStatus(excluded,{grade:3,subject:'數學',...mid}).count).toBe(0);
    expect(assessScopes([bank([{...q,examScope:mid}])],[paper()]).papers.get('papers/test.yaml')).toEqual([]);
    expect(assessScopes([bank([{...q,examScope:mid}])],[paper({semester:2,stage:'final'})]).papers.get('papers/test.yaml')?.join(' ')).toContain('不一致');
  });
  it('題組任一未知排除整組，成員衝突是資料錯誤，不能靠節選繞過', () => {
    const grouped=bank([{...q,examScope:mid},{...q,no:2}], [{no:1,paragraphs:['材料'],members:[1,2]}]);
    expect(assessScopes([grouped],[paper()]).questions.get('sample-01')?.join(' ')).toContain('題組');
    const conflicting=bank([{...q,examScope:mid},{...q,no:2,examScope:{semester:2,stage:'final'}}],[{no:1,paragraphs:['材料'],members:[1,2]}]);
    expect(checkBank({banks:[conflicting],papers:[paper()],images:[]}).some(p=>p.severity==='error'&&p.message.includes('範圍'))).toBe(true);
  });
  it('單題疑點只排除成員，材料疑點排除整組，組數不與題數相加', () => {
    const qs=[{...q,examScope:mid,doubt:'待核對'},{...q,no:2,examScope:mid}];
    const group={no:1,paragraphs:['材料'],members:[1,2]};
    expect(scopeStatus(assessScopes([bank(qs,[group])],[]),{grade:3,subject:'數學',...mid})).toMatchObject({count:1,groups:0});
    expect(scopeStatus(assessScopes([bank(qs,[{...group,doubt:'材料待核對'}])],[]),{grade:3,subject:'數學',...mid})).toMatchObject({count:0,groups:0});
    expect(scopeStatus(assessScopes([bank([{...q,examScope:mid},{...q,no:2,examScope:mid}],[group])],[]),{grade:3,subject:'數學',...mid})).toMatchObject({count:2,groups:1});
  });
  it('來源分類嚴格繼承，未知來源不能讓已分類新題通過', () => {
    const {source,...derived}=q;
    for(const original of [q,{...q,examScope:{semester:2,stage:'final'}}]){
      const b=bank([original,{...derived,no:2,examScope:mid,derivedFrom:['sample-01']}]);
      expect(checkBank({banks:[b],papers:[],images:[]}).some(p=>p.severity==='error'&&p.message.includes('範圍'))).toBe(true);
    }
    expect(checkBank({banks:[bank([{...q,examScope:mid},{...derived,no:2,examScope:mid,derivedFrom:['sample-01']}])],papers:[],images:[]})).toEqual([]);
    expect(assessScopes([bank([q,{...derived,no:2,derivedFrom:['sample-01']}])],[]).questions.get('sample-02')?.length).toBeGreaterThan(0);
  });
});
