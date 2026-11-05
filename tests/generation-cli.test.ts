import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { stringify } from 'yaml';

const dirs:string[]=[];
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
function run(script:string,...args:string[]) {
  const r=spawnSync(process.execPath,[`scripts/${script}.ts`,...args],{encoding:'utf8'});
  return {status:r.status,stdout:r.stdout,output:r.stdout+r.stderr};
}
function fixture() {
  const work=mkdtempSync(join(tmpdir(),'examremix-generation-'));dirs.push(work);
  const data=join(work,'data');mkdirSync(join(data,'bank'),{recursive:true});mkdirSync(join(data,'papers'));
  const original={no:1,type:'personal-response',subject:'英語',grade:3,examScope:{semester:1,stage:'midterm'},writingGuide:'four-line',stem:'What is your name?',sampleAnswer:'My name is Amy.',explanation:'依自己的姓名回答；範例不是唯一答案。',source:{originalPaper:'合成英語讀寫卷',number:1}};
  const source=stringify({questions:[original]});writeFileSync(join(data,'bank/source.yaml'),source);
  const question={...original,source:undefined,derivedFrom:['source-01'],stem:'What is your favorite color?',sampleAnswer:'My favorite color is blue.',explanation:'說出自己喜歡的顏色；red 等顏色也可，不把 blue 當唯一答案。'};
  const candidate=join(work,'candidate.yaml');writeFileSync(candidate,stringify({questions:[question]}));
  const view=JSON.parse(run('bank-batch','inspect',data).stdout);
  const request={contractVersion:'question-batch-v1',batchId:'english-one',dataDir:data,target:'new-one.yaml',candidate,candidateHash:hash(readFileSync(candidate,'utf8')),targetHash:view.targetHash,pendingHash:view.pendingHash,
    sourceIds:['source-01'],scope:{grade:3,subject:'英語',semester:1,stage:'midterm'},batchScope:'合成英語讀寫卷',quantity:{count:1,unit:'questions'},constraints:'以一個完整句子回答個人資料，不要求唯一個人事實',
    rules:{concept:'個人問答與完整句回答',allowedChanges:'姓名改為喜歡的顏色',invariants:'三年級個人問答、四線格、一個完整句子',verification:'從問句獨立判斷所需資訊，逐詞檢查範例並提出另一個合格答案'},
    evidence:[{id:'new-one-01',attempt:1,decision:'accept',reviewer:'合成案例核對',solution:'問句詢問喜歡的顏色，blue 是有效顏色詞；範例以 My favorite color is 回答。',independentCheck:'用 red 代入亦成立，確認開放個人回答不具唯一事實。',difficulty:'均用一個完整句子回答個人資訊，沒有時態變化或多步推論。',uniqueness:'開放題，完整句子說明個人顏色偏好即可。',explanation:'解析提到 blue 與 red，均對應最後問句與範例。',leakage:'範例只供答案卷參考，問句未提供學生偏好。',nearDuplicates:'source-01 詢問姓名，新題要求顏色詞與不同回答句型。'}],
    comparisons:[{left:'new-one-01',right:'source-01',decision:'distinct',reason:'姓名與顏色需要不同資訊及回答句型。'}]};
  const path=join(work,'request.json');
  const save=()=>{request.candidateHash=hash(readFileSync(candidate,'utf8'));writeFileSync(path,JSON.stringify(request));};save();
  return {work,data,source,question,candidate,request,path,save};
}
afterEach(()=>dirs.splice(0).forEach(p=>rmSync(p,{recursive:true,force:true})));

it('合格獨立英語開放題經品質流程與可靠入口發布，重跑不重複，回復後不重發',()=>{
  const f=fixture();
  const first=run('generate-questions',f.path);
  expect(first.status,first.output).toBe(0);
  expect(JSON.parse(first.stdout)).toMatchObject({state:'published',ids:['new-one-01'],added:1});
  expect(run('generate-questions',f.path)).toEqual(first);
  expect(readFileSync(join(f.data,'bank/source.yaml'),'utf8')).toBe(f.source);
  expect(readdirSync(join(f.data,'bank')).sort()).toEqual(['new-one.yaml','source.yaml']);
  expect(run('bank-batch','rollback',f.data,'english-one').status).toBe(0);
  const reverted=run('generate-questions',f.path);
  expect(reverted.status,reverted.output).toBe(0);
  expect(JSON.parse(reverted.stdout)).toMatchObject({state:'reverted',added:0});
  expect(readdirSync(join(f.data,'bank'))).toEqual(['source.yaml']);
});

it('錯解析連續三次拒絕，重啟與換 batchId 不能歸零，整批零新增',()=>{
  const f=fixture();
  for(let n=1;n<=3;n++) {
    f.question.stem=`What is your favorite ${['color','animal','food'][n-1]}?`;
    f.question.explanation=`錯解析 ${n}：仍回答姓名。`;
    writeFileSync(f.candidate,stringify({questions:[f.question]}));
    f.request.evidence[0]!.attempt=n;f.request.evidence[0]!.decision='reject';
    f.request.evidence[0]!.explanation='問句已改詢問偏好，解析卻仍要求姓名。';f.save();
    const result=run('generate-questions',f.path);
    expect(result.status,result.output).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({state:n===3?'stopped':'rejected',added:0,attempts:{'new-one-01':n}});
    expect(readdirSync(join(f.data,'bank'))).toEqual(['source.yaml']);
    if(n<3)expect(run('generate-questions',f.path)).toEqual(result);
  }
  f.request.batchId='another-name';f.request.evidence[0]!.decision='accept';f.request.evidence[0]!.attempt=1;f.save();
  const reset=run('generate-questions',f.path);
  expect(reset.status,reset.output).toBe(1);expect(reset.output).toContain('不能重置');
  expect(readFileSync(join(f.data,'bank/source.yaml'),'utf8')).toBe(f.source);
});

it('拒絕近重與提示洩漏後只重出失敗候選，第二次通過才入庫',()=>{
  const f=fixture();
  f.request.comparisons[0]!.decision='uncertain';f.request.comparisons[0]!.reason='尚未核對姓名與偏好是否只是表面換詞。';f.save();
  const rejected=run('generate-questions',f.path);expect(rejected.status,rejected.output).toBe(1);
  f.question.stem='Which animal do you like?';f.question.sampleAnswer='I like cats.';f.question.explanation='回答自己喜歡的動物即可，dogs 也可。';
  writeFileSync(f.candidate,stringify({questions:[f.question]}));
  f.request.evidence[0]!.attempt=2;f.request.evidence[0]!.solution='問句問喜歡的動物，cats 是動物，I like cats 符合問句。';
  f.request.evidence[0]!.independentCheck='以 I like dogs 代入，另一個動物也可，沒有唯一個人事實。';
  f.request.evidence[0]!.explanation='解析說明動物偏好，cats 與 dogs 對應最終內容。';
  f.request.comparisons[0]!.decision='distinct';f.request.comparisons[0]!.reason='動物名詞及喜好句型與姓名回答不同。';f.save();
  const result=run('generate-questions',f.path);expect(result.status,result.output).toBe(0);
  expect(JSON.parse(result.stdout)).toMatchObject({state:'published',added:1});
});

function mathFixture(sourceOperands=['12','23'],newOperands=['21','34'],operator='+',sourceAnswer='35',answer='55') {
  const f=fixture();
  const source={no:1,type:'vertical-calc',subject:'數學',grade:3,examScope:{semester:1,stage:'midterm'},stem:'用直式計算。',operands:sourceOperands,operator,answer:sourceAnswer,explanation:`${sourceOperands.join(operator)}=${sourceAnswer}`,source:{originalPaper:'合成數學卷',number:1}};
  writeFileSync(join(f.data,'bank/source.yaml'),stringify({questions:[source]}));
  writeFileSync(f.candidate,stringify({questions:[{...source,source:undefined,derivedFrom:['source-01'],operands:newOperands,answer,explanation:`${newOperands.join(operator)}=${answer}`}]}));
  const model=(operands:string[],result:string)=>({steps:[{operator,operands,result}],inputUnits:['個','個'],outputUnit:'個',conversions:0});
  Object.assign(f.request,{scope:{grade:3,subject:'數學',semester:1,stage:'midterm'},targetHash:JSON.parse(run('bank-batch','inspect',f.data).stdout).targetHash,
    rules:{...f.request.rules,concept:'二位數直式計算',allowedChanges:'換數字',invariants:'運算種類、位數及進退位位階不變',verification:'逐位運算及反向驗算',mathSources:[{id:'source-01',model:model(sourceOperands,sourceAnswer)}]},
    arithmetic:[{id:'new-one-01',model:model(newOperands,answer)}]});
  Object.assign(f.request.evidence[0]!,{solution:`${newOperands.join(operator)}=${answer}`,independentCheck:`${answer}-${newOperands[1]}=${newOperands[0]}`,difficulty:'保留兩個二位整數及原進退位位階。',uniqueness:'算式只有一個精確數值。',explanation:'解析中的運算元與最終題目一致。',leakage:'題幹只有運算指令，無額外提示。'});
  f.request.comparisons[0]!.reason='實質換運算數字並重新求解，保持考點。';f.save();
  return f;
}

it('數學顯式模型保持不進位與位數，精確求解後通過',()=>{
  const f=mathFixture();const result=run('generate-questions',f.path);
  expect(result.status,result.output).toBe(0);
  expect(JSON.parse(result.stdout)).toMatchObject({state:'published',added:1});
});

it.each([
  {label:'不進位變進位',a:['12','23'],b:['18','27'],op:'+',sa:'35',answer:'45'},
  {label:'跨零退位改為普通退位',a:['302','105'],b:['342','115'],op:'-',sa:'197',answer:'227'},
])('$label 即使答案正確仍拒絕，零新增',c=>{
  const f=mathFixture(c.a,c.b,c.op,c.sa,c.answer);const result=run('generate-questions',f.path);
  expect(result.status,result.output).toBe(1);expect(result.output).toContain('約束漂移');
  expect(readdirSync(join(f.data,'bank'))).toEqual(['source.yaml']);
});

it('比較範圍包含其他待發布批次，缺其配對不能通過',()=>{
  const f=fixture();
  const candidate=join(f.work,'pending.yaml');writeFileSync(candidate,stringify({questions:[{...f.question,stem:'What fruit do you like?',sampleAnswer:'I like apples.'}]}));
  const {rules,comparisons,...request}=f.request;
  Object.assign(request,{batchId:'pending',target:'new-pending.yaml',candidate,candidateHash:hash(readFileSync(candidate,'utf8')),evidence:request.evidence.map(e=>({...e,id:'new-pending-01'}))});
  const path=join(f.work,'pending.json');writeFileSync(path,JSON.stringify(request));
  const preload=join(f.work,'interrupt.mjs');writeFileSync(preload,"import fs from 'node:fs';import {syncBuiltinESMExports} from 'node:module';const open=fs.openSync;fs.openSync=(p,...a)=>{if(String(p).endsWith('/maintenance.json'))process.kill(process.pid,'SIGKILL');return open(p,...a);};syncBuiltinESMExports();");
  const stopped=spawnSync(process.execPath,['--import',preload,'scripts/bank-batch.ts','publish',path],{encoding:'utf8'});
  expect(stopped.signal,stopped.stderr).toBe('SIGKILL');
  f.request.pendingHash=JSON.parse(run('bank-batch','inspect',f.data).stdout).pendingHash;f.save();
  const result=run('generate-questions',f.path);
  expect(result.status,result.output).toBe(1);expect(result.output).toContain('比較範圍不完整');
  expect(readdirSync(join(f.data,'bank'))).toEqual(['source.yaml']);
});

const contentCases=[
  {name:'國語字音',subject:'國語',source:{type:'char-to-zhuyin',stem:'[公園|ㄍㄨㄥ ㄩㄢˊ]',explanation:'公園的園讀ㄩㄢˊ。'},good:{type:'char-to-zhuyin',stem:'[天空|ㄊㄧㄢ ㄎㄨㄥ]',explanation:'天空的空讀ㄎㄨㄥ，第一聲。'},bad:{type:'char-to-zhuyin',stem:'[天空|ㄊㄧㄢ ㄎㄨㄥˊ]',explanation:'天空的空讀第二聲。'},solution:'天空是ㄊㄧㄢ ㄎㄨㄥ，空為第一聲。',check:'把空放回天空的詞義核對，不是空白的ㄎㄨㄥˋ，也不是第二聲。',reason:'候選把天空的空標為第二聲，與詞義不符。'},
  {name:'國語仿作',subject:'國語',source:{type:'imitate-sentence',stem:'用一邊…一邊…表示同時做兩件事。',example:'哥哥一邊走路，一邊唱歌。',answer:'我一邊看書，一邊做筆記。',explanation:'兩件事同時進行。'},good:{type:'imitate-sentence',stem:'照樣寫出妹妹同時做的兩件事。',example:'哥哥一邊走路，一邊唱歌。',answer:'妹妹一邊唱歌，一邊跳舞。',explanation:'唱歌與跳舞同時進行，其他合乎句型及情境的答案也可。'},bad:{type:'imitate-sentence',stem:'照樣寫出妹妹同時做的兩件事。',example:'哥哥一邊走路，一邊唱歌。',answer:'妹妹先唱歌，再跳舞。',explanation:'先後與同時意思相同。'},solution:'一邊唱歌一邊跳舞是同時動作，符合目標句型。',check:'改成先唱歌再跳舞會變成先後，與目標同時關係不同。',reason:'先…再…表先後，無法作為同時句型的合格示例。'},
  {name:'自然條件',subject:'自然',source:{type:'true-false',stem:'磁鐵能吸引鐵釘。',answer:true,explanation:'鐵釘含鐵，可被磁鐵吸引。'},good:{type:'true-false',stem:'磁鐵能直接吸引不含金屬的塑膠尺。',answer:false,explanation:'不含金屬的塑膠尺不被磁鐵直接吸引。'},bad:{type:'true-false',stem:'磁鐵能直接吸引不含金屬的塑膠尺。',answer:true,explanation:'所有固體都能被磁鐵吸引。'},solution:'不含金屬的塑膠尺不被磁鐵直接吸引，敘述為假。',check:'用鐵釘作對照：是否含可被磁鐵吸引的材料才是條件，固體不是充分條件。',reason:'把固體當充分條件會把塑膠誤判為可被吸引。'},
  {name:'社會角色',subject:'社會',source:{type:'true-false',stem:'媽媽的姐姐通常稱為阿姨。',answer:true,explanation:'媽媽的姊妹稱阿姨。'},good:{type:'true-false',stem:'爸爸的弟弟通常稱為叔叔。',answer:true,explanation:'叔叔指爸爸的弟弟。'},bad:{type:'true-false',stem:'爸爸的姐姐通常稱為阿姨。',answer:true,explanation:'爸爸的姐姐是阿姨。'},solution:'爸爸的弟弟是叔叔，從爸爸與弟弟兩層角色判斷。',check:'爸爸的姊妹是姑姑，媽媽的姊妹才是阿姨；先辨父母一側再辨性別輩分。',reason:'把爸爸的姐姐稱為阿姨混淆父系與母系，應為姑姑。'},
];
it.each(contentCases.flatMap(c=>[true,false].map(accept=>({...c,accept}))))('$name 的 accept=$accept 保存具體求解與反例判斷',c=>{
  const f=fixture();
  const common={no:1,subject:c.subject,grade:3,examScope:{semester:1,stage:'midterm'}};
  writeFileSync(join(f.data,'bank/source.yaml'),stringify({questions:[{...common,...c.source,source:{originalPaper:`合成${c.subject}卷`,number:1}}]}));
  writeFileSync(f.candidate,stringify({questions:[{...common,...(c.accept?c.good:c.bad),derivedFrom:['source-01']}]}));
  Object.assign(f.request,{scope:{...f.request.scope,subject:c.subject},targetHash:JSON.parse(run('bank-batch','inspect',f.data).stdout).targetHash,
    rules:{concept:c.name,allowedChanges:'替換同程度的詞語或情境',invariants:'保留題型及判斷步驟',verification:c.check}});
  Object.assign(f.request.evidence[0]!,{decision:c.accept?'accept':'reject',solution:c.solution,independentCheck:c.check,difficulty:`原題與新題皆需${c.name}判斷。`,uniqueness:c.name.includes('仿作')?'開放仿作，以同時句型及合理情境為判準。':'依明示語境與條件可判斷答案。',explanation:c.accept?c.good.explanation:c.reason,leakage:'學生可見題幹未額外寫出正確判斷，仿作例句屬必要資訊。',nearDuplicates:'新題更換詞語或關係，須重新辨讀或推論，非只重排選項。'});
  f.request.comparisons[0]!.reason='改換詞語、材料條件或親屬關係後需重新作答，非姓名替換。';f.save();
  const result=run('generate-questions',f.path);expect(result.status,result.output).toBe(c.accept?0:1);
  expect(readdirSync(join(f.data,'bank')).sort()).toEqual(c.accept?['new-one.yaml','source.yaml']:['source.yaml']);
});

it.each(['reviewing','ready'])('產題紀錄在 %s 中斷，來源不變時以保留候選恢復且不重置次數',state=>{
  const f=fixture();
  const preload=join(f.work,'interrupt.mjs');writeFileSync(preload,`import fs from 'node:fs';import {syncBuiltinESMExports} from 'node:module';const rename=fs.renameSync;fs.renameSync=(a,b)=>{const r=rename(a,b);if(String(b).endsWith('/generations/english-one.json')&&JSON.parse(fs.readFileSync(b,'utf8')).data.attempts.at(-1).state===${JSON.stringify(state)})process.kill(process.pid,'SIGKILL');return r;};syncBuiltinESMExports();`);
  const stopped=spawnSync(process.execPath,['--import',preload,'scripts/generate-questions.ts',f.path],{encoding:'utf8'});
  expect(stopped.signal,stopped.stderr).toBe('SIGKILL');
  expect(readdirSync(join(f.data,'bank'))).toEqual(['source.yaml']);
  rmSync(f.candidate);
  const resumed=run('generate-questions',f.path);expect(resumed.status,resumed.output).toBe(0);
  expect(JSON.parse(resumed.stdout)).toMatchObject({state:'published',added:1});
  const record=JSON.parse(readFileSync(`${f.data}.examremix-operations/generations/english-one.json`,'utf8')).data;
  expect(record.attempts).toHaveLength(1);expect(record.attempts[0].counts).toEqual({'new-one-01':1});
});

it('候選交付暫存同步失敗不留下半份公開檔，重跑恢復同一次嘗試',()=>{
  const f=fixture();
  const preload=join(f.work,'io-failure.mjs');writeFileSync(preload,"import fs from 'node:fs';import {syncBuiltinESMExports} from 'node:module';const open=fs.openSync;let target;fs.openSync=(p,...a)=>{const fd=open(p,...a);if(String(p).includes('.candidate.yaml.')&&String(p).endsWith('.tmp'))target=fd;return fd;};const sync=fs.fsyncSync;fs.fsyncSync=fd=>{if(fd===target){const e=new Error('candidate EIO');e.code='EIO';throw e;}return sync(fd);};syncBuiltinESMExports();");
  const failed=spawnSync(process.execPath,['--import',preload,'scripts/generate-questions.ts',f.path],{encoding:'utf8'});
  expect(failed.status).toBe(1);expect(failed.stderr).toContain('EIO');
  expect(readdirSync(join(f.data,'bank'))).toEqual(['source.yaml']);
  const resumed=run('generate-questions',f.path);expect(resumed.status,resumed.output).toBe(0);
  expect(JSON.parse(resumed.stdout)).toMatchObject({state:'published',added:1});
});

it.each(['scope','image','doubt','group'])('來源 %s 不合格直接停止，不建立新題',kind=>{
  const f=fixture();const source=JSON.parse(JSON.stringify({no:1,type:'true-false',subject:'英語',grade:3,stem:'A cat is an animal.',answer:true,explanation:'Cat 是一種動物。',examScope:{semester:1,stage:'midterm'},source:{originalPaper:'合成卷',number:1}}));
  if(kind==='scope')delete source.examScope;
  if(kind==='doubt')source.doubt='待核對事實';
  if(kind==='image'){source.image={src:'image.svg',alt:'合成圖'};writeFileSync(join(f.data,'bank/image.svg'),'<svg/>');}
  writeFileSync(join(f.data,'bank/source.yaml'),stringify({questions:[source],...(kind==='group'?{groups:[{no:1,paragraphs:['A cat is an animal.'],members:[1]}]}:{})}));
  f.request.targetHash=JSON.parse(run('bank-batch','inspect',f.data).stdout).targetHash;f.save();
  const result=run('generate-questions',f.path);expect(result.status,result.output).toBe(1);expect(result.output).toContain('source-01');
  expect(readdirSync(join(f.data,'bank')).filter(p=>p.startsWith('new-'))).toEqual([]);
});

it.each(['unit','range','wrong-model','missing-model'])('明確數學約束拒絕 %s，不能只靠 schema 正確',kind=>{
  const f=mathFixture();const input=JSON.parse(readFileSync(f.path,'utf8'));
  if(kind==='unit')input.arithmetic[0].model.outputUnit='公分';
  if(kind==='range') {
    const ranges=[{min:'10',max:'25'},{min:'20',max:'29'}];
    input.rules.mathSources[0].model.steps[0].ranges=ranges;input.arithmetic[0].model.steps[0].ranges=ranges;
  }
  if(kind==='wrong-model')input.arithmetic[0].model.steps[0]={operator:'+',operands:['22','33'],result:'55'};
  if(kind==='missing-model')delete input.arithmetic;
  writeFileSync(f.path,JSON.stringify(input));
  const result=run('generate-questions',f.path);expect(result.status,result.output).toBe(1);
  expect(readdirSync(join(f.data,'bank'))).toEqual(['source.yaml']);
});

it('整除改為有餘數會拒絕，除法模型不用浮點近似',()=>{
  const f=fixture();
  const original={no:1,type:'horizontal-calc',subject:'數學',grade:3,examScope:{semester:1,stage:'midterm'},stem:'$20 \\div 4 =$',answer:'5',explanation:'4×5=20，餘數0。',source:{originalPaper:'合成除法卷',number:1}};
  writeFileSync(join(f.data,'bank/source.yaml'),stringify({questions:[original]}));
  writeFileSync(f.candidate,stringify({questions:[{...original,source:undefined,derivedFrom:['source-01'],stem:'$21 \\div 4 =$',answer:'5 餘 1',explanation:'4×5+1=21，1小於4。'}]}));
  const model=(n:string,remainder:string)=>({steps:[{operator:'÷',operands:[n,'4'],result:'5',remainder}],inputUnits:['個','個'],outputUnit:'個',conversions:0});
  Object.assign(f.request,{scope:{grade:3,subject:'數學',semester:1,stage:'midterm'},targetHash:JSON.parse(run('bank-batch','inspect',f.data).stdout).targetHash,
    rules:{...f.request.rules,concept:'整除',invariants:'二位數除以一位數，整除',mathSources:[{id:'source-01',model:model('20','0')}]},arithmetic:[{id:'new-one-01',model:model('21','1')}]});
  Object.assign(f.request.evidence[0]!,{solution:'21÷4=5餘1',independentCheck:'4×5+1=21，且1<4',explanation:'解析對應21、4、5及餘數1。'});f.save();
  const result=run('generate-questions',f.path);expect(result.status,result.output).toBe(1);expect(result.output).toContain('約束漂移');
});

it('小數加法保留位數與精確結果，沒有浮點誤差',()=>{
  const f=mathFixture(['1.2','2.3'],['2.1','3.4'],'+','3.5','5.5');
  const result=run('generate-questions',f.path);expect(result.status,result.output).toBe(0);
});

it('題庫中有疑點的題目也必須納入近重配對',()=>{
  const f=fixture();
  writeFileSync(join(f.data,'bank/doubt.yaml'),stringify({questions:[{...f.question,derivedFrom:undefined,source:{originalPaper:'另一合成卷',number:1},stem:'What food do you like?',doubt:'語句待核對'}]}));
  f.request.targetHash=JSON.parse(run('bank-batch','inspect',f.data).stdout).targetHash;f.save();
  const result=run('generate-questions',f.path);expect(result.status,result.output).toBe(1);expect(result.output).toContain('比較範圍不完整');
  expect(readdirSync(join(f.data,'bank')).sort()).toEqual(['doubt.yaml','source.yaml']);
});

it('完整兩題批次只有失敗題修訂時才增加該題次數，未全通過不發布部分題',()=>{
  const f=fixture();
  const second={...f.question,no:2,stem:'What animal do you like?',sampleAnswer:'I like blue.',explanation:'blue 是動物。'};
  f.request.quantity.count=2;
  f.request.evidence.push({...f.request.evidence[0]!,id:'new-one-02',decision:'reject',solution:'問題要求動物，blue 是顏色，不能回答動物。',independentCheck:'cat、dog 是動物，blue 不屬於動物詞。',explanation:'解析誤把 blue 當動物。'});
  f.request.comparisons.push({left:'new-one-01',right:'new-one-02',decision:'distinct',reason:'顏色與動物分別需要不同種類詞語。'},{left:'new-one-02',right:'source-01',decision:'distinct',reason:'動物偏好與姓名是不同資訊。'});
  writeFileSync(f.candidate,stringify({questions:[f.question,second]}));f.save();
  expect(run('generate-questions',f.path).status).toBe(1);expect(readdirSync(join(f.data,'bank'))).toEqual(['source.yaml']);
  second.sampleAnswer='I like cats.';second.explanation='cats 是動物；dogs 也可，依個人偏好回答。';
  Object.assign(f.request.evidence[1]!,{attempt:2,decision:'accept',solution:'cats 是動物，I like cats 回答動物偏好。',independentCheck:'I like dogs 也是完整合格回答。',explanation:second.explanation});
  writeFileSync(f.candidate,stringify({questions:[f.question,second]}));f.save();
  const result=run('generate-questions',f.path);expect(result.status,result.output).toBe(0);expect(JSON.parse(result.stdout).added).toBe(2);
  const journal=JSON.parse(readFileSync(`${f.data}.examremix-operations/generations/english-one.json`,'utf8')).data;
  expect(journal.attempts.at(-1).counts).toEqual({'new-one-01':1,'new-one-02':2});
});

it.each(['duplicate','leakage','unverifiable'])('語意 %s 的具體拒絕證據阻止入庫',kind=>{
  const f=fixture();
  if(kind==='duplicate'){f.request.comparisons[0]!.decision='duplicate';f.request.comparisons[0]!.reason='假設本次人工比對確認只換姓名，作答資訊未變。';}
  if(kind==='leakage'){
    f.question.stem='請回答 blue。What is your favorite color?';writeFileSync(f.candidate,stringify({questions:[f.question]}));
    Object.assign(f.request.evidence[0]!,{decision:'reject',leakage:'題幹要求回答 blue，取代了學生自己的偏好判斷。',independentCheck:'刪除請回答 blue 後才保留原本開放問答考點。'});
  }
  if(kind==='unverifiable')Object.assign(f.request,{haltReason:'需要教材中的字詞範圍，現有資料無法確定程度。'});
  f.save();const result=run('generate-questions',f.path);expect(result.status,result.output).toBe(1);
  expect(JSON.parse(result.stdout).state).toBe(kind==='unverifiable'?'stopped':'rejected');
  expect(readdirSync(join(f.data,'bank'))).toEqual(['source.yaml']);
});

it('第三次修訂通過可以完整發布，不把上限誤當一律拒絕',()=>{
  const f=fixture();
  for(let n=1;n<=3;n++) {
    f.question.explanation=`第${n}次核對：依個人偏好回答，blue 與 red 都是合格顏色。`;
    writeFileSync(f.candidate,stringify({questions:[f.question]}));
    f.request.evidence[0]!.attempt=n;f.request.evidence[0]!.decision=n===3?'accept':'reject';
    f.request.evidence[0]!.explanation=n===3?f.question.explanation:'前次核對尚未處理其他顏色的開放判準。';f.save();
    const result=run('generate-questions',f.path);expect(result.status,result.output).toBe(n===3?0:1);
  }
  expect(readdirSync(join(f.data,'bank')).sort()).toEqual(['new-one.yaml','source.yaml']);
});

it('來源版本改動及紀錄損毀停止，保留原檔與歷史',()=>{
  const f=fixture();f.request.evidence[0]!.decision='reject';f.save();expect(run('generate-questions',f.path).status).toBe(1);
  const journal=`${f.data}.examremix-operations/generations/english-one.json`,history=readFileSync(journal,'utf8');
  writeFileSync(join(f.data,'bank/source.yaml'),f.source+'\n# changed version\n');
  const changed=run('generate-questions',f.path);expect(changed.status).toBe(1);expect(changed.output).toContain('版本已變動');expect(readFileSync(journal,'utf8')).toBe(history);
  writeFileSync(join(f.data,'bank/source.yaml'),f.source);writeFileSync(journal,'{}');
  expect(run('generate-questions',f.path).status).toBe(1);expect(readFileSync(journal,'utf8')).toBe('{}');
  expect(readdirSync(join(f.data,'bank'))).toEqual(['source.yaml']);
});

it('可靠發布移入後中斷，產題入口恢復原批 ID，不因自身已入庫使來源版本判錯',()=>{
  const f=fixture();
  const preload=join(f.work,'publish-crash.mjs');writeFileSync(preload,"import fs from 'node:fs';import {syncBuiltinESMExports} from 'node:module';const link=fs.linkSync;fs.linkSync=(a,b)=>{const r=link(a,b);if(String(b).endsWith('/bank/new-one.yaml'))process.kill(process.pid,'SIGKILL');return r;};syncBuiltinESMExports();");
  const stopped=spawnSync(process.execPath,['--import',preload,'scripts/generate-questions.ts',f.path],{encoding:'utf8'});
  expect(stopped.signal,stopped.stderr).toBe('SIGKILL');
  expect(readFileSync(join(f.data,'bank/new-one.yaml'),'utf8')).toBe(readFileSync(f.candidate,'utf8'));
  expect(run('bank-batch','inspect',f.data).output).toContain('持久維護標記');rmSync(f.candidate);
  const result=run('generate-questions',f.path);expect(result.status,result.output).toBe(0);expect(JSON.parse(result.stdout)).toMatchObject({state:'published',ids:['new-one-01'],added:1});
  const view=JSON.parse(run('bank-batch','inspect',f.data).stdout);expect(view.generations[0]).toMatchObject({state:'published',attempts:{'new-one-01':1}});expect(view.pending).toEqual([]);
});

it('某題第三次已通過，不會因另一題仍可重出而提前停止整批',()=>{
  const f=fixture();const second={...f.question,no:2,stem:'Which animal do you like?',sampleAnswer:'I like cats.',explanation:'Cats 是動物，dogs 也可。'};
  f.request.quantity.count=2;
  f.request.evidence.push({...f.request.evidence[0]!,id:'new-one-02',solution:'Cats 是動物，回答動物偏好。',independentCheck:'Dogs 也可，問題是開放個人回答。',explanation:second.explanation});
  f.request.comparisons.push({left:'new-one-01',right:'new-one-02',decision:'distinct',reason:'不同種類個人偏好。'},{left:'new-one-02',right:'source-01',decision:'distinct',reason:'動物偏好與姓名不同。'});
  for(let n=1;n<=3;n++) {
    f.question.explanation=`第${n}次確認顏色偏好的開放判準。`;f.request.evidence[0]!.attempt=n;f.request.evidence[0]!.decision=n===3?'accept':'reject';f.request.evidence[0]!.explanation=f.question.explanation;
    if(n===3){second.sampleAnswer='I like blue.';f.request.evidence[1]!.attempt=2;f.request.evidence[1]!.decision='reject';f.request.evidence[1]!.explanation='Blue 不是動物，需重出。';}
    writeFileSync(f.candidate,stringify({questions:[f.question,second]}));f.save();
    const result=run('generate-questions',f.path);expect(result.status,result.output).toBe(1);expect(JSON.parse(result.stdout).state).toBe('rejected');
  }
  second.sampleAnswer='I like dogs.';f.request.evidence[1]!.attempt=3;f.request.evidence[1]!.decision='accept';f.request.evidence[1]!.explanation='Dogs 是動物，符合開放判準。';
  writeFileSync(f.candidate,stringify({questions:[f.question,second]}));f.save();
  const result=run('generate-questions',f.path);expect(result.status,result.output).toBe(0);expect(JSON.parse(result.stdout).added).toBe(2);
});

it('已核對但發布前中斷後，改成拒絕的請求不會悄悄發布舊候選',()=>{
  const f=fixture();const preload=join(f.work,'ready-crash.mjs');
  writeFileSync(preload,"import fs from 'node:fs';import {syncBuiltinESMExports} from 'node:module';const rename=fs.renameSync;fs.renameSync=(a,b)=>{const r=rename(a,b);if(String(b).endsWith('/generations/english-one.json')&&JSON.parse(fs.readFileSync(b,'utf8')).data.attempts.at(-1).state==='ready')process.kill(process.pid,'SIGKILL');return r;};syncBuiltinESMExports();");
  expect(spawnSync(process.execPath,['--import',preload,'scripts/generate-questions.ts',f.path],{encoding:'utf8'}).signal).toBe('SIGKILL');
  f.request.evidence[0]!.decision='reject';f.save();
  const result=run('generate-questions',f.path);expect(result.status,result.output).toBe(1);expect(result.output).toContain('衝突');
  expect(readdirSync(join(f.data,'bank'))).toEqual(['source.yaml']);
});
