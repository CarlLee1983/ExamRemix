import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { stringify, parse } from 'yaml';

const dirs:string[]=[];
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
function run(script:string,...args:string[]) {
  const r=spawnSync(process.execPath,[`scripts/${script}.ts`,...args],{encoding:'utf8'});
  return {status:r.status,stdout:r.stdout,output:r.stdout+r.stderr};
}
function fixture() {
  const work=mkdtempSync(join(tmpdir(),'examremix-group-generation-'));dirs.push(work);
  const data=join(work,'data');mkdirSync(join(data,'bank'),{recursive:true});mkdirSync(join(data,'papers'));
  const common={subject:'英語',grade:3,examScope:{semester:1,stage:'midterm'}};
  const source={groups:[{no:1,paragraphs:['Amy has a red bag. She walks to school.'],members:[1,2]}],questions:[
    {...common,no:1,type:'choice',unit:'顏色',stem:'What color is Amy’s bag?',options:['Red','Blue'],answer:1,explanation:'材料寫 red bag。',source:{originalPaper:'合成閱讀卷',number:1}},
    {...common,no:2,type:'true-false',unit:'交通',stem:'Amy walks to school.',answer:true,explanation:'材料寫 walks。',source:{originalPaper:'合成閱讀卷',number:2}},
  ]};
  const original=stringify(source);writeFileSync(join(data,'bank/source.yaml'),original);
  const candidateData={groups:[{no:1,paragraphs:['Ben has a green hat. He takes a bus to school.'],members:[1,2],derivedFrom:'source#1'}],questions:[
    {...common,no:1,type:'choice',unit:'顏色',stem:'What color is Ben’s hat?',options:['Yellow','Green'],answer:2,explanation:'green hat 是綠色帽子。',derivedFrom:['source-01']},
    {...common,no:2,type:'true-false',unit:'交通',stem:'Ben goes to school on foot.',answer:false,explanation:'takes a bus 表示搭公車，非步行。',derivedFrom:['source-02']},
  ]};
  const candidate=join(work,'candidate.yaml');writeFileSync(candidate,stringify(candidateData));
  const view=JSON.parse(run('bank-batch','inspect',data).stdout);
  const ids=['new-group-01','new-group-02','new-group#1'];
  const request={contractVersion:'question-batch-v1',batchId:'reading-one',dataDir:data,target:'new-group.yaml',candidate,candidateHash:'',targetHash:view.targetHash,pendingHash:view.pendingHash,
    sourceIds:['source-01'],scope:{...common.examScope,grade:3,subject:'英語'},batchScope:'合成閱讀卷',quantity:{count:1,unit:'groups'},constraints:'兩題完整閱讀，保留顏色與交通考點',
    rules:{concept:'從短文提取顏色及交通資訊',allowedChanges:'物件與交通方式改寫',invariants:'一選擇及一是非，兩句材料',verification:'逐題從新材料獨立求解，核對否定與詞義'},
    evidence:ids.map((id,i)=>({id,attempt:1,decision:'accept',reviewer:'合成案例核對',solution:['green 對應第二選項。','公車不是步行，答案 false。','短文給出帽子顏色與公車交通，兩題皆可獨立求解。'][i],independentCheck:'核對 green 不是 yellow；bus 與 on foot 不同，無需舊材料。',difficulty:'原組與新組均提取明示資訊，維持選擇及是非的兩個步驟。',uniqueness:'顏色唯一為 green，交通唯一為 bus。',explanation:'解析分別對應新材料的 green hat 及 takes a bus。',leakage:'材料提供必要線索，兩小題互不洩漏答案。',nearDuplicates:'物件、顏色及交通敘述均改寫，答案需要重新推論，不只換姓名。'})),
    comparisons:ids.flatMap((left,i)=>[...['source-01','source-02','source#1'],...ids.slice(i+1)].map(right=>({left,right,decision:'distinct',reason:'新帽子顏色及公車情境改變答案或判斷；材料與小題資訊用途不同。'}))),
  };
  const path=join(work,'request.json');
  const save=()=>{writeFileSync(candidate,stringify(candidateData));request.candidateHash=hash(readFileSync(candidate,'utf8'));writeFileSync(path,JSON.stringify(request));};save();
  return {work,data,source,original,candidate,candidateData,request,path,save};
}
afterEach(()=>dirs.splice(0).forEach(p=>rmSync(p,{recursive:true,force:true})));

it('單一組員展開完整混合題型原組，一次發布並保留組數與小題數，重跑及回復不重發',()=>{
  const f=fixture();
  const first=run('generate-questions',f.path);
  expect(first.status,first.output).toBe(0);
  expect(JSON.parse(first.stdout)).toMatchObject({state:'published',ids:['new-group-01','new-group-02'],groups:['new-group#1'],added:2});
  expect(parse(readFileSync(join(f.data,'bank/new-group.yaml'),'utf8'))).toEqual(f.candidateData);
  expect(run('generate-questions',f.path)).toEqual(first);
  expect(run('list-questions',f.data,'--eligible').stdout).toContain('new-group-02');
  expect(run('bank-batch','rollback',f.data,'reading-one').status).toBe(0);
  const reverted=run('generate-questions',f.path);expect(reverted.status,reverted.output).toBe(0);
  expect(JSON.parse(reverted.stdout)).toMatchObject({state:'reverted',added:0});
  expect(readFileSync(join(f.data,'bank/source.yaml'),'utf8')).toBe(f.original);
  expect(readdirSync(join(f.data,'bank'))).toEqual(['source.yaml']);
});

it('一個成員拒絕時整組同次計數；只修一題而沿用其他成員的次數不能發布',()=>{
  const f=fixture();f.request.evidence[1]!.decision='reject';f.save();
  const first=run('generate-questions',f.path);expect(first.status,first.output).toBe(1);
  expect(JSON.parse(first.stdout)).toMatchObject({state:'rejected',added:0,attempts:{'new-group-01':1,'new-group-02':1,'new-group#1':1}});
  f.request.evidence[1]!.decision='accept';f.request.evidence[1]!.attempt=2;f.save();
  const partial=run('generate-questions',f.path);expect(partial.status,partial.output).toBe(1);
  expect(partial.output).toContain('嘗試次數須為 2');
  expect(readdirSync(join(f.data,'bank'))).toEqual(['source.yaml']);
  f.request.evidence.forEach(e=>e.attempt=2);f.save();
  const complete=run('generate-questions',f.path);expect(complete.status,complete.output).toBe(0);
});

it('材料重出三次未通過即停止整批；另一個合格組也不能部分發布',()=>{
  const f=fixture();
  f.request.quantity.count=2;
  f.candidateData.groups.push({no:2,paragraphs:['May has a yellow cup. She rides a bike to school.'],members:[3,4],derivedFrom:'source#1'});
  f.candidateData.questions.push(...f.candidateData.questions.map((q,i)=>({...q,no:i+3,stem:i===0?'What color is May’s cup?':'May walks to school.'})));
  const ids=['new-group-01','new-group-02','new-group-03','new-group-04','new-group#1','new-group#2'];
  f.request.evidence=ids.map(id=>({...f.request.evidence[0]!,id}));
  f.request.comparisons=ids.flatMap((left,i)=>['source-01','source-02','source#1',...ids.slice(i+1)].map(right=>({left,right,decision:'distinct',reason:'不同材料及作答情境，已逐題核對。'})));
  for(let attempt=1;attempt<=3;attempt++) {
    f.candidateData.groups[0]!.paragraphs=[`Ben has a green hat. Unverified travel statement ${attempt}.`];
    f.request.evidence.filter(e=>['new-group-01','new-group-02','new-group#1'].includes(e.id)).forEach(e=>e.attempt=attempt);
    f.request.evidence.find(e=>e.id==='new-group#1')!.decision='reject';f.save();
    const result=run('generate-questions',f.path);expect(result.status,result.output).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({state:attempt===3?'stopped':'rejected',added:0});
    expect(readdirSync(join(f.data,'bank'))).toEqual(['source.yaml']);
  }
  f.request.batchId='reset';f.request.evidence.forEach(e=>{e.attempt=1;e.decision='accept';});f.save();
  expect(run('generate-questions',f.path).output).toContain('不能重置');
});

it.each(['reviewing','ready'])('完整題組在 %s 中斷後使用保留材料及成員恢復同一次嘗試',state=>{
  const f=fixture();const preload=join(f.work,'interrupt.mjs');
  writeFileSync(preload,`import fs from 'node:fs';import {syncBuiltinESMExports} from 'node:module';const rename=fs.renameSync;fs.renameSync=(a,b)=>{const result=rename(a,b);if(String(b).endsWith('/generations/reading-one.json')&&JSON.parse(fs.readFileSync(b,'utf8')).data.attempts.at(-1).state===${JSON.stringify(state)})process.kill(process.pid,'SIGKILL');return result;};syncBuiltinESMExports();`);
  const crash=spawnSync(process.execPath,['--import',preload,'scripts/generate-questions.ts',f.path],{encoding:'utf8'});expect(crash.signal,crash.stderr).toBe('SIGKILL');
  rmSync(f.candidate);
  const resumed=run('generate-questions',f.path);expect(resumed.status,resumed.output).toBe(0);
  expect(JSON.parse(resumed.stdout)).toMatchObject({state:'published',groups:['new-group#1'],added:2});
  const view=JSON.parse(run('bank-batch','inspect',f.data).stdout);
  expect(view.generations[0].attempts).toEqual({'new-group-01':1,'new-group-02':1,'new-group#1':1});
});

it('數學混合運算題組逐位置對應來源模型，不要求整組所有成員具有同一難度',()=>{
  const f=fixture();
  const common={subject:'數學',grade:3,examScope:{semester:1,stage:'midterm'},type:'word-problem'};
  const original={groups:[{no:1,paragraphs:['有12顆紅球及23顆藍球，另有8盒筆，每盒2枝。'],members:[1,2]}],questions:[
    {...common,no:1,stem:'紅球和藍球共有幾顆？',answer:'35顆',explanation:'12+23=35',source:{originalPaper:'合成數學卷',number:1}},
    {...common,no:2,stem:'8盒筆共有幾枝？',answer:'16枝',explanation:'8×2=16',source:{originalPaper:'合成數學卷',number:2}},
  ]};
  writeFileSync(join(f.data,'bank/source.yaml'),stringify(original));
  const candidate={groups:[{no:1,paragraphs:['有21顆紅球及34顆藍球，另有7盒筆，每盒2枝。'],members:[1,2],derivedFrom:'source#1'}],questions:[
    {...common,no:1,stem:'兩種顏色的球合計幾顆？',answer:'55顆',explanation:'21+34=55',derivedFrom:['source-01']},
    {...common,no:2,stem:'7盒筆合計幾枝？',answer:'14枝',explanation:'7×2=14',derivedFrom:['source-02']},
  ]};
  const model=(operator:string,operands:string[],result:string,unit:string)=>({steps:[{operator,operands,result}],inputUnits:[unit,unit],outputUnit:unit,conversions:0});
  Object.assign(f.request,{scope:{...f.request.scope,subject:'數學'},targetHash:JSON.parse(run('bank-batch','inspect',f.data).stdout).targetHash,
    rules:{...f.request.rules,mathSources:[{id:'source-01',model:model('+',['12','23'],'35','顆')},{id:'source-02',model:model('×',['8','2'],'16','枝')}]},
    arithmetic:[{id:'new-group-01',model:model('+',['21','34'],'55','顆')},{id:'new-group-02',model:model('×',['7','2'],'14','枝')}],
  });
  f.request.evidence.forEach(e=>Object.assign(e,{solution:'紅藍球共21+34=55顆；7盒每盒2枝共14枝。',independentCheck:'55−34=21；14÷2=7，逐一回推原條件。',difficulty:'加法保持兩位數不進位，乘法保持一位乘一位及進位位階。',explanation:'解析分別引用新材料21、34及7、2。',uniqueness:'兩題條件完整，各有唯一數值答案。',leakage:'兩題分別詢問球及筆，不互相提供答案。'}));
  Object.assign(f.candidateData,candidate);f.save();
  const result=run('generate-questions',f.path);expect(result.status,result.output).toBe(0);
  expect(JSON.parse(result.stdout)).toMatchObject({state:'published',added:2});
});

it('其他待發布題組的材料也必須逐對核對',()=>{
  const f=fixture();
  const candidate=join(f.work,'pending.yaml');writeFileSync(candidate,stringify(f.candidateData));
  const {rules,comparisons,...request}=f.request;
  Object.assign(request,{batchId:'pending',target:'new-pending.yaml',candidate,sourceIds:['source-01','source-02'],evidence:request.evidence.map(e=>({...e,id:e.id.replace('new-group','new-pending')}))});
  const path=join(f.work,'pending.json');writeFileSync(path,JSON.stringify(request));
  const preload=join(f.work,'interrupt.mjs');writeFileSync(preload,"import fs from 'node:fs';import {syncBuiltinESMExports} from 'node:module';const open=fs.openSync;fs.openSync=(p,...a)=>{if(String(p).endsWith('/maintenance.json'))process.kill(process.pid,'SIGKILL');return open(p,...a);};syncBuiltinESMExports();");
  const crash=spawnSync(process.execPath,['--import',preload,'scripts/bank-batch.ts','publish',path],{encoding:'utf8'});expect(crash.signal,crash.stderr).toBe('SIGKILL');
  f.request.pendingHash=JSON.parse(run('bank-batch','inspect',f.data).stdout).pendingHash;
  // Supply question pairs, deliberately omit material pairs.
  for(const left of ['new-group-01','new-group-02','new-group#1'])for(const right of ['new-pending-01','new-pending-02'])f.request.comparisons.push({left,right,decision:'distinct',reason:'核對小題但遺漏整組材料。'});
  f.candidateData.questions[0]!.stem='Which color is the new hat?';f.candidateData.questions[1]!.stem='Does Ben walk to school?';f.save();
  const result=run('generate-questions',f.path);expect(result.status,result.output).toBe(1);
  expect(result.output).toContain('比較範圍不完整');
});

it.each(['group-doubt','member-doubt','image','member-image','unknown-scope','missing-member','wrong-order','partial-quantity','material-evidence','near-duplicate','unknown-fact'])('完整題組拒絕 %s，正式題庫保持原狀',kind=>{
  const f=fixture();
  if(kind==='group-doubt')Object.assign(f.source.groups[0]!,{doubt:'材料語意待核對'});
  if(kind==='member-doubt')Object.assign(f.source.questions[1]!,{doubt:'第二題答案待核對'});
  if(kind==='image'||kind==='member-image') {
    Object.assign(kind==='image'?f.source.groups[0]!:f.source.questions[1]!,{image:{src:'picture.svg',alt:'來源圖片'}});
    writeFileSync(join(f.data,'bank/picture.svg'),'<svg/>');
  }
  if(kind==='unknown-scope')delete (f.source.questions[1] as {examScope?:unknown}).examScope;
  if(kind==='missing-member')f.source.questions.pop();
  writeFileSync(join(f.data,'bank/source.yaml'),stringify(f.source));
  if(kind!=='missing-member')f.request.targetHash=JSON.parse(run('bank-batch','inspect',f.data).stdout).targetHash;
  if(kind==='wrong-order')f.candidateData.groups[0]!.members.reverse();
  if(kind==='partial-quantity')f.request.quantity.count=2;
  if(kind==='material-evidence')f.request.evidence.pop();
  if(kind==='near-duplicate')Object.assign(f.request.comparisons.find(p=>p.left==='new-group#1'&&p.right==='source#1')!,{decision:'duplicate',reason:'短文只換姓名，線索與作答關係未改。'});
  if(kind==='unknown-fact')Object.assign(f.request,{haltReason:'交通事實缺乏材料支持，無法獨立確認。'});
  f.save();const before=readFileSync(join(f.data,'bank/source.yaml'),'utf8');
  const result=run('generate-questions',f.path);expect(result.status,result.output).toBe(1);
  expect(readdirSync(join(f.data,'bank')).filter(n=>n.startsWith('new-'))).toEqual([]);
  expect(readFileSync(join(f.data,'bank/source.yaml'),'utf8')).toBe(before);
  if(kind==='unknown-fact')expect(JSON.parse(result.stdout)).toMatchObject({state:'stopped',added:0});
});

it('完全相同的材料不能只靠更換小題視為新組',()=>{
  const f=fixture();f.candidateData.groups[0]!.paragraphs=[...f.source.groups[0]!.paragraphs];f.save();
  const result=run('generate-questions',f.path);expect(result.status,result.output).toBe(1);
  expect(result.output).toContain('重複材料');
});

const readings=[
  {subject:'國語',original:'小明先把書放回書架，再去洗手。',material:'小華先收拾畫筆，再去洗手。',stem:'小華先做哪件事？',options:['洗手','收拾畫筆'],statement:'小華在收拾畫筆以前洗手。',explanation:'先收拾畫筆、再洗手，時間順序不可顛倒。'},
  {subject:'自然',original:'鐵釘靠近磁鐵時被吸引，塑膠尺沒有被吸引。',material:'回紋針含鐵，靠近磁鐵時被吸引；木棒沒有被吸引。',stem:'材料中哪個物品被吸引？',options:['木棒','回紋針'],statement:'木棒也被磁鐵吸引。',explanation:'材料明示回紋針被吸引、木棒沒有，不能泛化所有物品。'},
  {subject:'社會',original:'媽媽的姐姐來訪，小明稱她阿姨。',material:'爸爸的妹妹來訪，小華稱她姑姑。',stem:'小華應如何稱呼爸爸的妹妹？',options:['阿姨','姑姑'],statement:'爸爸的妹妹應稱阿姨。',explanation:'爸爸的姊妹稱姑姑；阿姨是媽媽的姊妹，須辨別父母一側。'},
];
it.each(readings.flatMap(c=>[true,false].map(accept=>({...c,accept}))))('$subject 題組的 accept=$accept 有材料及逐題求解依據',c=>{
  const f=fixture();f.source.groups[0]!.paragraphs=[c.original];
  Object.assign(f.source.questions[0]!,{subject:c.subject,unit:'閱讀',stem:'哪個敘述符合材料？',options:[c.original,'材料完全沒有提到任何事件。'],answer:1,explanation:c.original});
  Object.assign(f.source.questions[1]!,{subject:c.subject,unit:'閱讀',stem:c.original,answer:true,explanation:'敘述與材料一致。'});
  writeFileSync(join(f.data,'bank/source.yaml'),stringify(f.source));
  f.candidateData.groups[0]!.paragraphs=[c.material];
  Object.assign(f.candidateData.questions[0]!,{subject:c.subject,unit:'閱讀',stem:c.stem,options:c.options,answer:2,explanation:c.explanation});
  Object.assign(f.candidateData.questions[1]!,{subject:c.subject,unit:'閱讀',stem:c.statement,answer:!c.accept,explanation:c.accept?c.explanation:'錯誤地把相反關係視為成立。'});
  f.request.scope.subject=c.subject;f.request.targetHash=JSON.parse(run('bank-batch','inspect',f.data).stdout).targetHash;
  f.request.evidence.forEach(e=>Object.assign(e,{solution:c.explanation,independentCheck:`把敘述與新材料逐句比對：${c.material}`,explanation:c.explanation,difficulty:'保留從兩個明示資訊判斷選項及真假，不增加外部知識。'}));
  if(!c.accept)f.request.evidence[1]!.decision='reject';f.save();
  const result=run('generate-questions',f.path);expect(result.status,result.output).toBe(c.accept?0:1);
  expect(JSON.parse(result.stdout)).toMatchObject(c.accept?{state:'published',added:2}:{state:'rejected',added:0});
});

it('題組在正式檔發布後中斷，恢復只補記，不重複新增容量',()=>{
  const f=fixture();const preload=join(f.work,'publish-crash.mjs');
  writeFileSync(preload,"import fs from 'node:fs';import {syncBuiltinESMExports} from 'node:module';const link=fs.linkSync;fs.linkSync=(a,b)=>{const result=link(a,b);if(String(b).endsWith('/bank/new-group.yaml'))process.kill(process.pid,'SIGKILL');return result;};syncBuiltinESMExports();");
  const crashed=spawnSync(process.execPath,['--import',preload,'scripts/generate-questions.ts',f.path],{encoding:'utf8'});expect(crashed.signal,crashed.stderr).toBe('SIGKILL');
  const bytes=readFileSync(join(f.data,'bank/new-group.yaml'),'utf8');
  const result=run('generate-questions',f.path);expect(result.status,result.output).toBe(0);
  expect(JSON.parse(result.stdout)).toMatchObject({state:'published',added:2,groups:['new-group#1']});
  expect(readFileSync(join(f.data,'bank/new-group.yaml'),'utf8')).toBe(bytes);
  const list=run('list-questions',f.data,'--eligible');expect(list.status,list.output).toBe(0);
  expect(list.stdout.trim().split('\n')).toHaveLength(4);
});
