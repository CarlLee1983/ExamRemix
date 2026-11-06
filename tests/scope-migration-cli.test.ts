import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { parse, stringify } from 'yaml';
vi.setConfig({testTimeout:60000});
const dirs: string[]=[];
afterEach(()=>{ for(const d of dirs.splice(0)) rmSync(d,{recursive:true,force:true}); });
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
function cli(...args:string[]) {
  const r=spawnSync(process.execPath,['scripts/classify-bank.ts',...args],{encoding:'utf8'});
  return {...r,output:r.stdout+r.stderr};
}
function fixture() {
  const work=mkdtempSync(join(tmpdir(),'examremix-classify-'));dirs.push(work);
  const data=join(work,'data'); mkdirSync(join(data,'bank'),{recursive:true});mkdirSync(join(data,'papers'));
  const original={no:1,type:'true-false',subject:'數學',grade:3,stem:'三加四等於七。',answer:true,explanation:'3+4=7。',source:{originalPaper:'合成原卷',number:1}};
  writeFileSync(join(data,'bank/original.yaml'),stringify({questions:[original]}));
  writeFileSync(join(data,'bank/new.yaml'),stringify({questions:[{...original,source:undefined,derivedFrom:['original-01'],stem:'五加二等於七。'}]}));
  writeFileSync(join(data,'bank/unknown-midterm.yaml'),stringify({questions:[{...original,source:{originalPaper:'第一次評量',number:1}}]}));
  const evidence=join(work,'source.txt');writeFileSync(evidence,'三年級 數學 上學期 期中；合成測試證據');
  return {work,data,evidence};
}
function request(f:ReturnType<typeof fixture>) {
  const inspected=cli('inspect',f.data); expect(inspected.status,inspected.output).toBe(0);
  const version=JSON.parse(inspected.stdout);
  const r={version:'classification-v1',batchId:'math-one',dataDir:f.data,programHash:version.programHash,dataHash:version.dataHash,batch:'合成原卷',
    evidence:[{file:f.evidence,hash:hash(readFileSync(f.evidence,'utf8')),location:'第1頁標題',reason:'標題明示年級科目學期與期中',originalPaper:'合成原卷',ids:['original-01'],scope:{grade:3,subject:'數學',semester:1,stage:'midterm'}}],papers:[]};
  const path=join(f.work,'request.json');writeFileSync(path,JSON.stringify(r));return {r,path};
}
it('預覽只補有證據原題及繼承新題；未知仍排除，資料不變',()=>{
  const f=fixture(), {path}=request(f);
  const before=readFileSync(join(f.data,'bank/original.yaml'),'utf8');
  const result=cli('preview',path);expect(result.status,result.output).toBe(0);
  const report=JSON.parse(result.stdout);
  expect(report.changes.map((c:{id:string})=>c.id).sort()).toEqual(['new-01','original-01']);
  expect(report.after.capacities.find((c:{scope:{subject:string}})=>c.scope.subject==='數學').count).toBe(2);
  expect(report.before.capacities.find((c:{scope:{subject:string}})=>c.scope.subject==='數學').count).toBe(0);
  expect(report.after.excludedQuestions).toContainEqual({id:'unknown-midterm-01',reasons:['考試範圍未知']});
  expect(readFileSync(join(f.data,'bank/original.yaml'),'utf8')).toBe(before);
  expect(existsSync(`${f.data}.examremix-operations/maintenance.json`)).toBe(false);
});
it('套用預覽後可雜湊核對重跑，回復只還原本批分類',()=>{
  const f=fixture(),{path}=request(f);
  const original=readFileSync(join(f.data,'bank/original.yaml'),'utf8');
  const preview=cli('preview',path,'--build');expect(preview.status,preview.output).toBe(0);
  const expected=JSON.parse(preview.stdout).planHash;
  const applied=cli('apply',path,'--expected',expected);expect(applied.status,applied.output).toBe(0);
  expect(JSON.parse(applied.stdout).state).toBe('applied');
  expect(parse(readFileSync(join(f.data,'bank/new.yaml'),'utf8')).questions[0].examScope).toEqual({semester:1,stage:'midterm'});
  expect(cli('apply',path,'--expected',expected).stdout).toBe(applied.stdout);
  const reverted=cli('rollback',f.data,'math-one');expect(reverted.status,reverted.output).toBe(0);
  expect(JSON.parse(reverted.stdout).state).toBe('reverted');
  expect(readFileSync(join(f.data,'bank/original.yaml'),'utf8')).toBe(original);
  expect(parse(readFileSync(join(f.data,'bank/new.yaml'),'utf8')).questions[0].examScope).toBeUndefined();
  expect(cli('rollback',f.data,'math-one').stdout).toBe(reverted.stdout);
});
function previewed(f:ReturnType<typeof fixture>) {
  const {r,path}=request(f),p=cli('preview',path,'--build');expect(p.status,p.output).toBe(0);
  return {r,path,expected:JSON.parse(p.stdout).planHash};
}
function injected(f:ReturnType<typeof fixture>,code:string,args:string[]) {
  const preload=join(f.work,'inject.mjs');
  writeFileSync(preload,`import fs from 'node:fs';import {syncBuiltinESMExports} from 'node:module';\n${code}\nsyncBuiltinESMExports();`);
  return spawnSync(process.execPath,['--import',preload,'scripts/classify-bank.ts',...args],{encoding:'utf8'});
}
it.each(['before-marker','after-marker','first-file','last-file','before-terminal','after-terminal','after-unlink'])(
  '%s 中斷後維護標記持久阻擋讀者，依紀錄完成整批',point=>{
    const f=fixture(),p=previewed(f);
    const code=point==='before-marker'||point==='after-marker'
      ? `const w=fs.writeFileSync;fs.writeFileSync=(fd,...a)=>{const result=w(fd,...a);return result;};const link=fs.linkSync;fs.linkSync=(a,b)=>{if(String(b).endsWith('/maintenance.json')&&${point==='before-marker'})process.kill(process.pid,'SIGKILL');return link(a,b);};const sync=fs.fsyncSync;fs.fsyncSync=(fd)=>{const r=sync(fd);if(${point==='after-marker'}&&fs.existsSync(${JSON.stringify(`${f.data}.examremix-operations/maintenance.json`)}))process.kill(process.pid,'SIGKILL');return r;};`
      : point==='after-unlink'
      ? `const unlink=fs.unlinkSync;fs.unlinkSync=(p)=>{const r=unlink(p);if(String(p).endsWith('/maintenance.json'))process.kill(process.pid,'SIGKILL');return r;};`
      : `let files=0;const rename=fs.renameSync;fs.renameSync=(a,b)=>{if(String(b).endsWith('/bank/original.yaml')||String(b).endsWith('/bank/new.yaml')){const r=rename(a,b);files++;if(files===${point==='first-file'?1:point==='last-file'?2:999})process.kill(process.pid,'SIGKILL');return r;}if(String(b).endsWith('/record.json')&&files===2){${point==='before-terminal'?"process.kill(process.pid,'SIGKILL');":point==='after-terminal'?"const r=rename(a,b);process.kill(process.pid,'SIGKILL');return r;":""}}return rename(a,b);};`;
    const stop=injected(f,code,['apply',p.path,'--expected',p.expected]);expect(stop.signal,stop.stderr).toBe('SIGKILL');
    const marked=existsSync(`${f.data}.examremix-operations/maintenance.json`);
    const reader=spawnSync(process.execPath,['scripts/check-bank.ts',f.data],{encoding:'utf8'});
    expect(reader.status===0).toBe(!marked);
    const resumed=point==='after-unlink'?cli('apply',p.path,'--expected',p.expected):cli('recover',f.data,'math-one','after');
    expect(resumed.status,resumed.output).toBe(0);
    for(const name of ['original','new'])expect(parse(readFileSync(join(f.data,`bank/${name}.yaml`),'utf8')).questions[0].examScope).toEqual({semester:1,stage:'midterm'});
    expect(existsSync(`${f.data}.examremix-operations/maintenance.json`)).toBe(false);
  });
it('混合版本可恢復完整舊狀態；回復遇後續修改停止且保留內容',()=>{
  const f=fixture(),p=previewed(f),old=readFileSync(join(f.data,'bank/original.yaml'),'utf8');
  const stop=injected(f,`const rename=fs.renameSync;fs.renameSync=(a,b)=>{const r=rename(a,b);if(String(b).endsWith('/bank/original.yaml'))process.kill(process.pid,'SIGKILL');return r;};`,['apply',p.path,'--expected',p.expected]);
  expect(stop.signal).toBe('SIGKILL');
  const recovered=cli('recover',f.data,'math-one','before');expect(recovered.status,recovered.output).toBe(0);
  expect(readFileSync(join(f.data,'bank/original.yaml'),'utf8')).toBe(old);
  expect(parse(readFileSync(join(f.data,'bank/new.yaml'),'utf8')).questions[0].examScope).toBeUndefined();
  const g=fixture(),q=previewed(g);expect(cli('apply',q.path,'--expected',q.expected).status).toBe(0);
  const path=join(g.data,'bank/original.yaml'),edited=readFileSync(path,'utf8')+'# 使用者後續修改\n';writeFileSync(path,edited);
  const rollback=cli('rollback',g.data,'math-one');expect(rollback.status).toBe(1);expect(rollback.output).toContain('後續修改衝突');
  expect(readFileSync(path,'utf8')).toBe(edited);expect(existsSync(`${g.data}.examremix-operations/maintenance.json`)).toBe(false);
});
it.each(['evidence','data','program','preview','same-batch'])(
  '%s 版本或請求衝突在寫入前拒絕',kind=>{
    const f=fixture(),p=previewed(f),original=readFileSync(join(f.data,'bank/original.yaml'),'utf8');
    if(kind==='evidence')writeFileSync(f.evidence,'證據已變');
    if(kind==='data')writeFileSync(join(f.data,'bank/unknown-midterm.yaml'),readFileSync(join(f.data,'bank/unknown-midterm.yaml'),'utf8')+'# changed\n');
    if(kind==='program'){p.r.programHash='0'.repeat(64);writeFileSync(p.path,JSON.stringify(p.r));}
    if(kind==='same-batch'){
      expect(cli('apply',p.path,'--expected',p.expected).status).toBe(0);
      p.r.batch='另一批';writeFileSync(p.path,JSON.stringify(p.r));
    }
    const r=cli('apply',p.path,'--expected',kind==='preview'?'0'.repeat(64):p.expected);
    expect(r.status,r.output).toBe(1);
    if(kind!=='same-batch')expect(readFileSync(join(f.data,'bank/original.yaml'),'utf8')).toBe(original);
    expect(existsSync(`${f.data}.examremix-operations/maintenance.json`)).toBe(false);
  });
it('多來源缺證據拒絕；同原卷矛盾分類拒絕',()=>{
  const f=fixture();
  const path=join(f.data,'bank/new.yaml'),bank=parse(readFileSync(path,'utf8'));
  bank.questions[0].derivedFrom.push('unknown-midterm-01');writeFileSync(path,stringify(bank));
  const p=request(f),r=cli('preview',p.path);expect(r.status).toBe(1);expect(r.output).toContain('多來源');
  const g=fixture(),q=request(g);q.r.evidence.push({...q.r.evidence[0]!,scope:{...q.r.evidence[0]!.scope,stage:'final'}});
  writeFileSync(q.path,JSON.stringify(q.r));const conflict=cli('preview',q.path);expect(conflict.status).toBe(1);expect(conflict.output).toContain('原卷分類衝突');
});
it('完整題組連同新組傳遞、列出試卷且保留材料圖片及引用順序',()=>{
  const f=fixture();
  for(const name of ['original','new']){
    const path=join(f.data,`bank/${name}.yaml`),bank=parse(readFileSync(path,'utf8'));
    bank.questions.push({...bank.questions[0],no:2,...(name==='new'?{derivedFrom:['original-02']}:{source:{originalPaper:'合成原卷',number:2}})});
    bank.groups=[{no:1,paragraphs:[name==='original'?'三加四等於七。':'五加二等於七。'],members:[1,2],...(name==='new'?{derivedFrom:'original#1'}:{source:{originalPaper:'合成原卷',section:'閱讀'}})}];
    writeFileSync(path,stringify(bank));
  }
  writeFileSync(join(f.data,'bank/preserved.svg'),'<svg xmlns="http://www.w3.org/2000/svg"/>');
  writeFileSync(join(f.data,'papers/practice.yaml'),stringify({title:'合成試卷',grade:3,subject:'數學',sections:[{title:'一',questions:['new-02','new-01']}]}));
  const p=request(f);p.r.evidence[0]!.ids.push('original-02');
  const requestWithPaper={...p.r,papers:[{file:'papers/practice.yaml',scope:p.r.evidence[0]!.scope,reason:'完整引用本批已核對來源'}]};writeFileSync(p.path,JSON.stringify(requestWithPaper));
  const preview=cli('preview',p.path,'--build');expect(preview.status,preview.output).toBe(0);const report=JSON.parse(preview.stdout);
  expect(report.groups.sort()).toEqual(['new#1','original#1']);expect(report.affectedPapers).toEqual(['papers/practice.yaml']);
  expect(report.after.capacities.find((c:{scope:{subject:string}})=>c.scope.subject==='數學')).toMatchObject({count:4,groups:2});
  expect(cli('apply',p.path,'--expected',report.planHash).status).toBe(0);
  expect(parse(readFileSync(join(f.data,'papers/practice.yaml'),'utf8')).sections[0].questions).toEqual(['new-02','new-01']);
  expect(readFileSync(join(f.data,'bank/preserved.svg'),'utf8')).toBe('<svg xmlns="http://www.w3.org/2000/svg"/>');
});
it('新增引用阻擋回復；無關新檔保留',()=>{
  const f=fixture(),p=previewed(f);expect(cli('apply',p.path,'--expected',p.expected).status).toBe(0);
  writeFileSync(join(f.data,'papers/later.yaml'),stringify({title:'後續試卷',grade:3,subject:'數學',examScope:{semester:1,stage:'midterm'},sections:[{title:'一',questions:['original-01']}]}));
  const conflict=cli('rollback',f.data,'math-one');expect(conflict.status).toBe(1);expect(conflict.output).toContain('後續依賴衝突');
  expect(existsSync(join(f.data,'papers/later.yaml'))).toBe(true);
  const g=fixture(),q=previewed(g);expect(cli('apply',q.path,'--expected',q.expected).status).toBe(0);
  const unrelated=join(g.data,'note.txt');writeFileSync(unrelated,'保留我');
  const rollback=cli('rollback',g.data,'math-one');expect(rollback.status,rollback.output).toBe(0);expect(readFileSync(unrelated,'utf8')).toBe('保留我');
});
it.each(['before','after'])('回復中斷可依 %s 方向續行，禁止反向覆蓋',point=>{
  const f=fixture(),p=previewed(f);expect(cli('apply',p.path,'--expected',p.expected).status).toBe(0);
  const stopped=injected(f,`const rename=fs.renameSync;fs.renameSync=(a,b)=>{if(String(b).endsWith('/bank/original.yaml')){${point==='before'?"process.kill(process.pid,'SIGKILL');":"const r=rename(a,b);process.kill(process.pid,'SIGKILL');return r;"}}return rename(a,b);};`,['rollback',f.data,'math-one']);
  expect(stopped.signal,stopped.stderr).toBe('SIGKILL');
  expect(cli('recover',f.data,'math-one','after').status).toBe(1);
  const recover=cli('recover',f.data,'math-one','before');expect(recover.status,recover.output).toBe(0);
  expect(parse(readFileSync(join(f.data,'bank/new.yaml'),'utf8')).questions[0].examScope).toBeUndefined();
});
it('中斷後未知內容與損毀紀錄維持封鎖',()=>{
  const f=fixture(),p=previewed(f);
  injected(f,`const rename=fs.renameSync;fs.renameSync=(a,b)=>{const r=rename(a,b);if(String(b).endsWith('/bank/original.yaml'))process.kill(process.pid,'SIGKILL');return r;};`,['apply',p.path,'--expected',p.expected]);
  const path=join(f.data,'bank/original.yaml'),edited=readFileSync(path,'utf8')+'# 第三種內容\n';writeFileSync(path,edited);
  const recovery=cli('recover',f.data,'math-one','after');expect(recovery.status).toBe(1);expect(recovery.output).toContain('雜湊衝突');expect(readFileSync(path,'utf8')).toBe(edited);
  const record=`${f.data}.examremix-operations/classifications/math-one/record.json`;writeFileSync(record,'{"broken":true}');
  expect(cli('recover',f.data,'math-one','before').status).toBe(1);expect(existsSync(`${f.data}.examremix-operations/maintenance.json`)).toBe(true);
});
it('遷移中的繼承權杖不能讓查題、檢查、writer 或建置讀取混合版本',()=>{
  const f=fixture(),p=previewed(f);
  const astroPackage=JSON.parse(readFileSync('node_modules/astro/package.json','utf8'));
  const astroBin=typeof astroPackage.bin==='string'?astroPackage.bin:astroPackage.bin.astro;
  const stopped=injected(f,`import {spawnSync} from 'node:child_process';const rename=fs.renameSync;fs.renameSync=(a,b)=>{const r=rename(a,b);if(String(b).endsWith('/bank/original.yaml')){const commands=[['scripts/check-bank.ts',${JSON.stringify(f.data)}],['scripts/list-questions.ts',${JSON.stringify(f.data)}],['scripts/bank-batch.ts','inspect',${JSON.stringify(f.data)}],['scripts/classify-bank.ts','inspect',${JSON.stringify(f.data)}],['scripts/classify-bank.ts','apply',${JSON.stringify(p.path)},'--expected',${JSON.stringify(p.expected)}],['scripts/bank-access.ts','write',${JSON.stringify(f.data)},'--expected','unused','--',process.execPath,'-e','process.exit(0)'],[${JSON.stringify(join(process.cwd(),'node_modules/astro',astroBin))},'build','--outDir',${JSON.stringify(join(f.work,'inherited-build'))}]];for(const args of commands){const x=spawnSync(process.execPath,args,{encoding:'utf8',env:{...process.env,EXAMREMIX_DATA_DIR:${JSON.stringify(f.data)}}});console.log(JSON.stringify({args,status:x.status,output:x.stdout+x.stderr}));}process.kill(process.pid,'SIGKILL');}return r;};`,['apply',p.path,'--expected',p.expected]);
  expect(stopped.signal,stopped.stderr).toBe('SIGKILL');
  for(const line of stopped.stdout.trim().split('\n')){const r=JSON.parse(line);expect(r.status).not.toBe(0);expect(r.output).toContain('維護標記');}
  const build=spawnSync('pnpm',['exec','astro','build','--outDir',join(f.work,'blocked-output')],{encoding:'utf8',env:{...process.env,EXAMREMIX_DATA_DIR:f.data}});
  expect(build.status).not.toBe(0);expect(build.stdout+build.stderr).toContain('維護標記');
  expect(cli('recover',f.data,'math-one','after').status).toBe(0);
},30000);
it.each(['file','directory'])('%s 同步失敗保留標記，恢復必須重試同步',kind=>{
  const f=fixture(),p=previewed(f);
  const code=`let mutated=false;const rename=fs.renameSync;fs.renameSync=(a,b)=>{const r=rename(a,b);if(String(b).endsWith('/bank/original.yaml'))mutated=true;return r;};const sync=fs.fsyncSync;fs.fsyncSync=(fd)=>{if(mutated&&fs.fstatSync(fd).${kind==='file'?'isFile':'isDirectory'}())throw new Error('injected fsync failure');return sync(fd);};`;
  const failed=injected(f,code,['apply',p.path,'--expected',p.expected]);expect(failed.status).toBe(1);expect(failed.stderr).toContain('injected fsync failure');
  expect(existsSync(`${f.data}.examremix-operations/maintenance.json`)).toBe(true);
  const recovery=cli('recover',f.data,'math-one','after');expect(recovery.status,recovery.output).toBe(0);
});
it('資料預覽不能代替隔離建置；建置產物遭修改時拒絕套用',()=>{
  const f=fixture(),p=request(f),preview=cli('preview',p.path);expect(preview.status).toBe(0);
  const missing=cli('apply',p.path,'--expected',JSON.parse(preview.stdout).planHash);expect(missing.status).toBe(1);expect(missing.output).toContain('隔離建置');
  const verified=cli('preview',p.path,'--build');expect(verified.status,verified.output).toBe(0);
  const planHash=JSON.parse(verified.stdout).planHash;
  const receipt=JSON.parse(readFileSync(`${f.data}.examremix-operations/classification-previews/${planHash}.json`,'utf8')).data;
  writeFileSync(join(receipt.directory,'output','index.html'),'tampered');
  const changed=cli('apply',p.path,'--expected',planHash);expect(changed.status).toBe(1);expect(changed.output).toContain('產物已變動');
  expect(parse(readFileSync(join(f.data,'bank/original.yaml'),'utf8')).questions[0].examScope).toBeUndefined();
});
it('隔離建置不寫共用 .astro，收據寫入中斷仍可重試',()=>{
  const f=fixture(),p=request(f),preload=join(f.work,'build-isolation.mjs');
  const shared=join(process.cwd(),'.astro');
  writeFileSync(preload,`import fs from 'node:fs';import {syncBuiltinESMExports} from 'node:module';const write=fs.writeFileSync;fs.writeFileSync=(p,...args)=>{if(String(p).startsWith(${JSON.stringify(shared)}))throw new Error('shared .astro write');return write(p,...args);};syncBuiltinESMExports();`);
  const isolated=spawnSync(process.execPath,['scripts/classify-bank.ts','preview',p.path,'--build'],{encoding:'utf8',env:{...process.env,NODE_OPTIONS:`--import=${preload}`}});
  expect(isolated.status,isolated.stdout+isolated.stderr).toBe(0);
  const g=fixture(),q=request(g);
  const stopped=injected(g,`let receipt;const open=fs.openSync;fs.openSync=(p,...a)=>{const fd=open(p,...a);if(String(p).includes('/classification-previews/')&&!String(p).includes('/view-')&&/\\.(json|tmp)$/.test(String(p)))receipt=fd;return fd;};const write=fs.writeFileSync;fs.writeFileSync=(p,v,...a)=>{if(p===receipt){write(p,'{',...a);process.kill(process.pid,'SIGKILL');}return write(p,v,...a);};`,['preview',q.path,'--build']);
  expect(stopped.signal,stopped.stderr).toBe('SIGKILL');
  const retry=cli('preview',q.path,'--build');expect(retry.status,retry.output).toBe(0);
});
it('補齊題組影響未變成員的試卷；後續引用該成員仍阻擋回復',()=>{
  const f=fixture();unlinkSync(join(f.data,'bank/new.yaml'));
  const file=join(f.data,'bank/original.yaml'),bank=parse(readFileSync(file,'utf8'));
  bank.questions.push({...bank.questions[0],no:2,source:{originalPaper:'合成原卷',number:2}});
  bank.questions[0].examScope={semester:1,stage:'midterm'};
  bank.groups=[{no:1,paragraphs:['三加四等於七。'],members:[1,2],source:{originalPaper:'合成原卷',section:'閱讀'}}];
  writeFileSync(file,stringify(bank));
  const paper={title:'節選已知成員',grade:3,subject:'數學',examScope:{semester:1,stage:'midterm'},sections:[{title:'一',questions:['original-01']}]};
  writeFileSync(join(f.data,'papers/existing.yaml'),stringify(paper));
  const p=request(f);p.r.evidence[0]!.ids=['original-02'];writeFileSync(p.path,JSON.stringify(p.r));
  const preview=cli('preview',p.path,'--build');expect(preview.status,preview.output).toBe(0);
  const report=JSON.parse(preview.stdout);expect(report.affectedPapers).toEqual(['papers/existing.yaml']);
  expect(cli('apply',p.path,'--expected',report.planHash).status).toBe(0);
  writeFileSync(join(f.data,'papers/later.yaml'),stringify(paper));
  const rollback=cli('rollback',f.data,'math-one');expect(rollback.status).toBe(1);expect(rollback.output).toContain('後續依賴衝突');
  expect(parse(readFileSync(file,'utf8')).questions[1].examScope).toEqual({semester:1,stage:'midterm'});
});

it('後續完整卷配置引用本批分類時拒絕回復，保留配置及分類',()=>{
  const f=fixture(),p=previewed(f);
  expect(cli('apply',p.path,'--expected',p.expected).status).toBe(0);
  mkdirSync(join(f.data,'profiles'));
  const profile=join(f.data,'profiles/math.yaml');
  const contents=stringify({sections:[{slots:[{referenceIds:['original-01'],candidates:[{id:'new-01',evidence:'已核對'}]}]}]});
  writeFileSync(profile,contents);
  const rollback=cli('rollback',f.data,'math-one');
  expect(rollback.status,rollback.output).toBe(1);
  expect(rollback.output).toContain('後續依賴衝突');
  expect(readFileSync(profile,'utf8')).toBe(contents);
  expect(parse(readFileSync(join(f.data,'bank/original.yaml'),'utf8')).questions[0].examScope).toEqual({semester:1,stage:'midterm'});
});

it('分類預覽列出受影響的近重配置而不修改它',()=>{
  const f=fixture();
  const file=join(f.data,'selection-conflicts.yaml');
  const content=stringify({schemaVersion:1,revision:'1',pairs:[{kind:'question',ids:['original-01','new-01'],reason:'合成核對紀錄'}]});
  writeFileSync(file,content);
  const p=request(f),preview=cli('preview',p.path);
  expect(preview.status,preview.output).toBe(0);
  expect(JSON.parse(preview.stdout).affectedConfigurations).toEqual(['selection-conflicts.yaml']);
  expect(readFileSync(file,'utf8')).toBe(content);
});
