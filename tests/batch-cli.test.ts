import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';

const dirs: string[] = [];
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
function cli(...args: string[]) {
  const r = spawnSync(process.execPath, ['scripts/bank-batch.ts', ...args], { encoding: 'utf8' });
  return { status: r.status, output: r.stdout + r.stderr, stdout: r.stdout };
}
function fixture() {
  const work = mkdtempSync(join(tmpdir(), 'examremix-batch-'));
  dirs.push(work);
  const data = join(work, 'data');
  mkdirSync(join(data, 'bank'), { recursive: true });
  mkdirSync(join(data, 'papers'));
  const original = { no: 1, type: 'true-false', subject: '數學', grade: 3,
    examScope: { semester: 1, stage: 'midterm' }, stem: '三加四等於七。', answer: true,
    explanation: '3+4=7；7-4=3。', source: { originalPaper: '合成原卷', number: 1 } };
  const source = stringify({ questions: [original] });
  writeFileSync(join(data, 'bank/original.yaml'), source);
  const candidate = stringify({ questions: [{ ...original, source: undefined, derivedFrom: ['original-01'],
    stem: '五加二等於七。', explanation: '5+2=7；7-2=5。' }] });
  const candidatePath = join(work, 'candidate.yaml');
  writeFileSync(candidatePath, candidate);
  const inspection = cli('inspect', data);
  expect(inspection.status, inspection.output).toBe(0);
  const view = JSON.parse(inspection.stdout);
  const request = {
    contractVersion: 'question-batch-v1', batchId: 'batch-one', dataDir: data,
    target: 'new-one.yaml', candidate: candidatePath, candidateHash: hash(candidate),
    targetHash: view.targetHash, pendingHash: view.pendingHash,
    sourceIds: ['original-01'], scope: { grade: 3, subject: '數學', semester: 1, stage: 'midterm' },
    batchScope: '合成原卷', quantity: { count: 1, unit: 'questions' },
    constraints: '個位數不進位加法、以減法回推、維持是非題',
    evidence: [{ id: 'new-one-01', attempt: 1, decision: 'accept', reviewer: 'fixture author',
      solution: '5+2=7', independentCheck: '7-2=5', difficulty: '兩個個位數相加不進位',
      uniqueness: '唯一真假判斷為真', explanation: '解析數字與題幹相符',
      leakage: '題幹是待判斷敘述，沒有額外答案標記',
      nearDuplicates: '與 original-01 比較：實質換數字且重新求解，保留考點' }],
  };
  const requestPath = join(work, 'request.json');
  writeFileSync(requestPath, JSON.stringify(request));
  return { work, data, request, requestPath, source, candidate, candidatePath };
}
afterEach(() => dirs.splice(0).forEach(d => rmSync(d, { recursive: true, force: true })));

it('完整發布與同批重跑只有一份新檔，容量不重複增加，原題不變', () => {
  const f = fixture();
  const published = cli('publish', f.requestPath);
  expect(published.status, published.output).toBe(0);
  expect(JSON.parse(published.stdout)).toMatchObject({ state: 'published', ids: ['new-one-01'], added: 1 });
  expect(cli('inspect',f.data).status).toBe(0);
  expect(readFileSync(join(f.data, 'bank/new-one.yaml'), 'utf8')).toBe(f.candidate);
  expect(cli('publish', f.requestPath)).toEqual(published);
  expect(readdirSync(join(f.data, 'bank')).sort()).toEqual(['new-one.yaml', 'original.yaml']);
  expect(readFileSync(join(f.data, 'bank/original.yaml'), 'utf8')).toBe(f.source);
  const checked = spawnSync(process.execPath, ['scripts/check-bank.ts', resolve(f.data)], { encoding: 'utf8' });
  expect(checked.status, checked.stderr).toBe(0);
  expect(checked.stdout).toContain('數學：2 題');
});

it('發布前拒絕缺證據、來源／目標變動與同名不同內容，容量增加 0', () => {
  for (const failure of ['evidence','source','target'] as const) {
    const f=fixture();
    if (failure==='evidence') f.request.evidence=[];
    if (failure==='source') writeFileSync(join(f.data,'bank/original.yaml'),f.source.replace('三加四','三加五'));
    if (failure==='target') writeFileSync(join(f.data,'bank/new-one.yaml'),'other owner');
    writeFileSync(f.requestPath,JSON.stringify(f.request));
    const r=cli('publish',f.requestPath);
    expect(r.status,r.output).toBe(1);
    if (failure!=='target') expect(readdirSync(join(f.data,'bank'))).toEqual(['original.yaml']);
    else expect(readFileSync(join(f.data,'bank/new-one.yaml'),'utf8')).toBe('other owner');
  }
});

it('非本批已持久化擁有的同內容目的檔也拒絕認領', () => {
  const f=fixture();
  writeFileSync(join(f.data,'bank/new-one.yaml'),f.candidate);
  const inspect=JSON.parse(cli('inspect',f.data).stdout);
  f.request.targetHash=inspect.targetHash;
  writeFileSync(f.requestPath,JSON.stringify(f.request));
  const r=cli('publish',f.requestPath);
  expect(r.status,r.output).toBe(1);
  expect(r.output).toContain('目的');
});

function injected(f: ReturnType<typeof fixture>, code: string, args = ['publish',f.requestPath]) {
  const preload=join(f.work,'inject.mjs');
  writeFileSync(preload,`import fs from 'node:fs'; import {syncBuiltinESMExports} from 'node:module';\n${code}\nsyncBuiltinESMExports();`);
  return spawnSync(process.execPath,['--import',preload,'scripts/bank-batch.ts',...args],{encoding:'utf8'});
}

it.each(['write','sync-file','sync-dir','before-link','after-link','before-result','after-result'])(
  '%s 中斷後只恢復完整的一批；讀者拒絕未完成維護狀態', point => {
    const f=fixture();
    const code=point==='write'
      ? `const open=fs.openSync;let tmp;fs.openSync=(p,...a)=>{const fd=open(p,...a);if(String(p).endsWith('.tmp'))tmp=fd;return fd;};const write=fs.writeFileSync; fs.writeFileSync=(p,v,...a)=>{ if(p===tmp) { write(p,String(v).slice(0,20),...a); process.kill(process.pid,'SIGKILL'); } return write(p,v,...a); };`
      : point==='sync-file' || point==='sync-dir'
      ? `const sync=fs.fsyncSync; let linked=false; const link=fs.linkSync; fs.linkSync=(a,b)=>{const r=link(a,b); if(String(b).endsWith('/new-one.yaml')) linked=true; return r;};const open=fs.openSync;let tmp;fs.openSync=(p,...a)=>{const fd=open(p,...a);if(String(p).endsWith('.tmp'))tmp=fd;return fd;};fs.fsyncSync=(fd)=>{if(${point==='sync-file' ? 'fd===tmp' : 'linked && fs.fstatSync(fd).isDirectory()'})process.kill(process.pid,'SIGKILL');return sync(fd);};`
      : point==='before-link' || point==='after-link'
      ? `const link=fs.linkSync; fs.linkSync=(a,b)=>{if(String(b).endsWith('/new-one.yaml')) {${point==='before-link' ? "process.kill(process.pid,'SIGKILL');" : "const r=link(a,b); process.kill(process.pid,'SIGKILL'); return r;"}} return link(a,b);};`
      : `const rename=fs.renameSync;fs.renameSync=(a,b)=>{if(String(b).endsWith('/record.json')){${point==='before-result' ? "process.kill(process.pid,'SIGKILL');" : "const r=rename(a,b);process.kill(process.pid,'SIGKILL');return r;"}}return rename(a,b);};`;
    const stopped=injected(f,code);
    expect(stopped.signal,stopped.stderr).toBe('SIGKILL');
    const target=join(f.data,'bank/new-one.yaml');
    if (existsSync(target)) expect(readFileSync(target,'utf8')).toBe(f.candidate);
    else expect(readdirSync(join(f.data,'bank'))).toEqual(['original.yaml']);
    const reader=spawnSync(process.execPath,['scripts/check-bank.ts',f.data],{encoding:'utf8'});
    // An interruption before durable intent exposes no changed data; all later
    // interruptions retain the persistent marker and stop managed readers.
    expect(reader.status).not.toBe(0);
    const resumed=cli('publish',f.requestPath);
    expect(resumed.status,resumed.output).toBe(0);
    expect(JSON.parse(resumed.stdout)).toMatchObject({state:'published',ids:['new-one-01'],added:1});
    expect(readFileSync(target,'utf8')).toBe(f.candidate);
    expect(readFileSync(join(f.data,'bank/original.yaml'),'utf8')).toBe(f.source);
    expect(readdirSync(join(f.data,'bank')).sort()).toEqual(['new-one.yaml','original.yaml']);
  });

it('發布後檢查失敗僅撤回自有新檔；有新引用時停止並保留檔案與標記', () => {
  for (const reference of [false,true]) {
    const f=fixture();
    const r=injected(f,`const link=fs.linkSync;fs.linkSync=(a,b)=>{const result=link(a,b);if(String(b).endsWith('/new-one.yaml')) {${reference
      ? `fs.writeFileSync(${JSON.stringify(join(f.data,'papers/conflict.yaml'))},'title: conflict\\nsections:\\n  - questions: [new-one-01]');`
      : ''} fs.writeFileSync(b,${JSON.stringify(f.candidate.replace('answer: true','answer: invalid'))});}return result;};`);
    expect(r.status).not.toBe(0);
    // A modified file is never ours to withdraw, even after failed validation.
    expect(existsSync(join(f.data,'bank/new-one.yaml'))).toBe(true);
    expect(cli('inspect',f.data).status).toBe(1);
    expect(r.stderr).toContain('撤回衝突');
  }
});

it('紀錄損毀停止，完整目的檔不被覆寫', () => {
  const f=fixture();
  expect(cli('publish',f.requestPath).status).toBe(0);
  writeFileSync(`${f.data}.examremix-operations/batches/batch-one/record.json`,'{}');
  expect(cli('publish',f.requestPath).status).toBe(1);
  expect(readFileSync(join(f.data,'bank/new-one.yaml'),'utf8')).toBe(f.candidate);
});

it('發布後暫時驗證讀取失敗會撤回完整自有檔；引用衝突則不刪除', () => {
  for (const reference of [false,true]) {
    const f=fixture();
    const r=injected(f,`let linked=false,failed=false;const link=fs.linkSync;fs.linkSync=(a,b)=>{const r=link(a,b);if(String(b).endsWith('/new-one.yaml')){linked=true;${reference ? `fs.writeFileSync(${JSON.stringify(join(f.data,'papers/conflict.yaml'))},'sections:\\n  - questions: [new-one-01]');` : ''}}return r;};const read=fs.readFileSync;fs.readFileSync=(p,...a)=>{if(linked&&!failed&&String(p).endsWith('/new-one.yaml')){failed=true;throw new Error('injected post-validation read failure');}return read(p,...a);};`);
    expect(r.status).toBe(1);
    expect(readFileSync(join(f.data,'bank/original.yaml'),'utf8')).toBe(f.source);
    if (reference) {
      expect(r.stderr).toContain('引用');
      expect(readFileSync(join(f.data,'bank/new-one.yaml'),'utf8')).toBe(f.candidate);
      expect(cli('inspect',f.data).status).toBe(1);
    } else {
      expect(readdirSync(join(f.data,'bank'))).toEqual(['original.yaml']);
      expect(readFileSync(join(f.data,'.batch-batch-one.withdrawn'),'utf8')).toBe(f.candidate);
      const retry=cli('publish',f.requestPath);
      expect(retry.status,retry.output).toBe(0);
      expect(JSON.parse(retry.stdout)).toMatchObject({state:'reverted',added:0});
    }
  }
});

it.each(['doubt','image','scope','original','duplicate','pending','group','verdict','attempt'])(
  '拒絕不合資格 %s，原題與其他檔案保持不變', failure => {
    const f=fixture();
    if (failure==='doubt' || failure==='image') {
      const source=failure==='doubt' ? f.source+'    doubt: 待核對\n' : f.source+'    image: {src: original/pic.svg, alt: 示意圖}\n';
      writeFileSync(join(f.data,'bank/original.yaml'),source);
      if (failure==='image') { mkdirSync(join(f.data,'bank/original'));writeFileSync(join(f.data,'bank/original/pic.svg'),'<svg/>'); }
      f.request.targetHash=JSON.parse(cli('inspect',f.data).stdout).targetHash;
    }
    if (failure==='scope') f.request.scope.semester=2;
    if (failure==='original') f.request.sourceIds=['missing-01'];
    if (failure==='verdict') f.request.evidence[0]!.decision='reject';
    if (failure==='attempt') f.request.evidence[0]!.attempt=4;
    if (failure==='group') f.request.quantity.unit='groups';
    if (failure==='pending') f.request.pendingHash='0'.repeat(64);
    if (failure==='duplicate') {
      // Use identical visible content while preserving the required new-question provenance.
      const q=parse(f.source).questions[0];delete q.source;q.derivedFrom=['original-01'];
      const duplicate=stringify({questions:[q]});
      writeFileSync(f.candidatePath,duplicate);f.request.candidateHash=hash(duplicate);
    }
    writeFileSync(f.requestPath,JSON.stringify(f.request));
    const before=readFileSync(join(f.data,'bank/original.yaml'),'utf8');
    const r=cli('publish',f.requestPath);
    expect(r.status,r.output).toBe(1);
    expect(existsSync(join(f.data,'bank/new-one.yaml'))).toBe(false);
    expect(readFileSync(join(f.data,'bank/original.yaml'),'utf8')).toBe(before);
    if (failure==='scope') expect(JSON.parse(cli('inspect',f.data).stdout).pending).toEqual([]);
  });

it('兩個 writer 競爭時只有持鎖者可發布，另一個拒絕且不產生新檔', async () => {
  const f=fixture();
  const preload=join(f.work,'hold.mjs');
  writeFileSync(preload,`import fs from 'node:fs';import {syncBuiltinESMExports} from 'node:module';let announced=false;const link=fs.linkSync;fs.linkSync=(a,b)=>{const r=link(a,b);if(String(b).endsWith('/lock')&&!announced){announced=true;process.stdout.write('locked\\n');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,800);}return r;};syncBuiltinESMExports();`);
  const child=spawn(process.execPath,['--import',preload,'scripts/bank-batch.ts','publish',f.requestPath]);
  try {
    await new Promise<void>((res,rej)=>{child.stdout.once('data',()=>res());child.once('error',rej);child.once('exit',code=>{if(code)rej(new Error(`writer exited ${code}`));});});
    expect(cli('publish',f.requestPath).output).toContain('忙碌');
    expect(existsSync(join(f.data,'bank/new-one.yaml'))).toBe(false);
    const done=await new Promise<number|null>(res=>child.once('exit',res));
    expect(done).toBe(0);
    expect(readFileSync(join(f.data,'bank/new-one.yaml'),'utf8')).toBe(f.candidate);
  } finally { if(child.exitCode===null)child.kill('SIGKILL'); }
});

it.each(['complete','missing','order','count','image'])('完整混合題型題組 %s：整批發布或拒絕', variant => {
  const f=fixture();
  const source=parse(f.source);
  source.groups=[{no:1,paragraphs:['合成材料：三加四等於七。'],members:[1,2]}];
  source.questions.push({...source.questions[0],no:2,type:'choice',stem:'三加四的結果是？',options:['七','八'],answer:1});
  writeFileSync(join(f.data,'bank/original.yaml'),stringify(source));
  const candidate=parse(f.candidate);
  candidate.groups=[{no:1,paragraphs:['合成材料：五加二等於七。'],members:variant==='order'?[2,1]:[1,2],derivedFrom:'original#1'}];
  if (variant==='image') {
    writeFileSync(join(f.data,'bank/extra.svg'),'<svg/>');
    candidate.groups[0].image={src:'extra.svg',alt:'合成附圖'};
  }
  if (variant!=='missing') candidate.questions.push({...candidate.questions[0],no:2,type:'choice',stem:'五加二的結果是？',options:['七','八'],answer:1,derivedFrom:['original-02']});
  const content=stringify(candidate);
  writeFileSync(f.candidatePath,content);
  Object.assign(f.request,{candidateHash:hash(content),targetHash:JSON.parse(cli('inspect',f.data).stdout).targetHash,
    sourceIds:['original-01','original-02'],quantity:{count:variant==='count'?2:1,unit:'groups'},
    evidence:['new-one-01','new-one-02','new-one#1'].map(id=>({...f.request.evidence[0],id}))});
  writeFileSync(f.requestPath,JSON.stringify(f.request));
  const r=cli('publish',f.requestPath);
  if (variant==='complete') {
    expect(r.status,r.output).toBe(0);
    expect(JSON.parse(r.stdout)).toMatchObject({ids:['new-one-01','new-one-02'],groups:['new-one#1'],added:2});
    expect(readFileSync(join(f.data,'bank/new-one.yaml'),'utf8')).toBe(content);
  } else {
    expect(r.status,r.output).toBe(1);
    expect(existsSync(join(f.data,'bank/new-one.yaml'))).toBe(false);
  }
});

it('同步 I/O 失敗停止，保留候選後可恢復；未發布時容量不變', () => {
  const f=fixture();
  const r=injected(f,`const open=fs.openSync;let tmp;fs.openSync=(p,...a)=>{const fd=open(p,...a);if(String(p).endsWith('.tmp'))tmp=fd;return fd;};const sync=fs.fsyncSync;fs.fsyncSync=(fd)=>{if(fd===tmp)throw new Error('injected EIO');return sync(fd);};`);
  expect(r.status).toBe(1);
  expect(r.stderr).toContain('injected EIO');
  expect(readdirSync(join(f.data,'bank'))).toEqual(['original.yaml']);
  const result=cli('publish',f.requestPath);
  expect(result.status,result.output).toBe(0);
  expect(readFileSync(join(f.data,'bank/new-one.yaml'),'utf8')).toBe(f.candidate);
});

it('受管修改持鎖時，容量查詢與另一 writer 均被拒絕，完成後可正常讀取', async () => {
  const f=fixture();
  const edit=join(f.work,'edit.mjs');
  writeFileSync(edit,`process.stdout.write('editing\\n');await new Promise(r=>setTimeout(r,1000));`);
  const child=spawn(process.execPath,['scripts/bank-access.ts','write',f.data,'--expected',f.request.targetHash,'--',process.execPath,edit]);
  const exited=new Promise<number|null>(res=>child.once('exit',res));
  let err='';child.stderr.on('data',d=>{err+=d;});
  try {
    await new Promise<void>((res,rej)=>{child.stdout.once('data',()=>res());child.once('error',rej);child.once('exit',code=>rej(new Error(`寫入者在就緒前結束：${code} ${err}`)));});
    const reader=spawnSync(process.execPath,['scripts/list-questions.ts',f.data,'--eligible'],{encoding:'utf8'});
    expect(reader.status).not.toBe(0);
    expect(reader.stderr).toContain('忙碌');
    expect(cli('publish',f.requestPath).output).toContain('忙碌');
    expect(await exited,err).toBe(0);
    expect(cli('inspect',f.data).status).toBe(0);
  } finally { if(child.exitCode===null)child.kill('SIGKILL'); }
});

it('其他待發布批次的相同內容拒絕發布，候選不進容量', () => {
  const f=fixture();
  const stopped=injected(f,`const rename=fs.renameSync;fs.renameSync=(a,b)=>{const r=rename(a,b);if(String(b).endsWith('/batches/batch-one'))process.kill(process.pid,'SIGKILL');return r;};`);
  expect(stopped.signal).toBe('SIGKILL');
  const inspection=cli('inspect',f.data);
  expect(inspection.status,inspection.output).toBe(0);
  const view=JSON.parse(inspection.stdout);
  expect(view.pending).toHaveLength(1);
  Object.assign(f.request,{batchId:'batch-two',target:'new-two.yaml',constraints:'另一個明示擴充請求',pendingHash:view.pendingHash,
    evidence:f.request.evidence.map(e=>({...e,id:'new-two-01'}))});
  writeFileSync(f.requestPath,JSON.stringify(f.request));
  const second=cli('publish',f.requestPath);
  expect(second.status,second.output).toBe(1);
  expect(second.output).toContain('正規化重複');
  expect(readdirSync(join(f.data,'bank'))).toEqual(['original.yaml']);
});

it('撤回移檔後中斷會繼續完成撤回，不把失敗批次重新發布', () => {
  const f=fixture();
  const r=injected(f,`let linked=false,failed=false;const link=fs.linkSync;fs.linkSync=(a,b)=>{const r=link(a,b);if(String(b).endsWith('/new-one.yaml'))linked=true;return r;};const read=fs.readFileSync;fs.readFileSync=(p,...a)=>{if(linked&&!failed&&String(p).endsWith('/new-one.yaml')){failed=true;throw new Error('post-check failure');}return read(p,...a);};const rename=fs.renameSync;fs.renameSync=(a,b)=>{const r=rename(a,b);if(String(b).endsWith('.withdrawn'))process.kill(process.pid,'SIGKILL');return r;};`);
  expect(r.signal,r.stderr).toBe('SIGKILL');
  const resumed=cli('publish',f.requestPath);
  expect(resumed.status,resumed.output).toBe(0);
  expect(JSON.parse(resumed.stdout)).toMatchObject({state:'reverted',added:0});
  expect(readdirSync(join(f.data,'bank'))).toEqual(['original.yaml']);
  expect(readFileSync(join(f.data,'.batch-batch-one.withdrawn'),'utf8')).toBe(f.candidate);
});

it('Astro 正式讀者遇未完成維護標記時拒絕建置', () => {
  const f=fixture();
  expect(injected(f,`const link=fs.linkSync;fs.linkSync=(a,b)=>{if(String(b).endsWith('/new-one.yaml'))process.kill(process.pid,'SIGKILL');return link(a,b);};`).signal).toBe('SIGKILL');
  const r=spawnSync('pnpm',['exec','astro','build','--outDir',join(f.work,'dist')],{encoding:'utf8',env:{...process.env,EXAMREMIX_DATA_DIR:f.data}});
  expect(r.status).not.toBe(0);
  expect(r.stdout+r.stderr).toContain('持久維護標記');
  expect(readdirSync(join(f.data,'bank'))).toEqual(['original.yaml']);
},30000);

it('其他試卷已有錯誤時完整視圖拒絕發布，無可用容量增加', () => {
  const f=fixture();
  writeFileSync(join(f.data,'papers/broken.yaml'),'title: broken\n');
  const r=cli('publish',f.requestPath);
  expect(r.status).toBe(1);
  expect(existsSync(join(f.data,'bank/new-one.yaml'))).toBe(false);
  expect(readFileSync(join(f.data,'bank/original.yaml'),'utf8')).toBe(f.source);
});

it('失敗的受管修改保留維護標記，讀者不能讀取混合版本', () => {
  const f=fixture();
  const r=spawnSync(process.execPath,['scripts/bank-access.ts','write',f.data,'--expected',f.request.targetHash,'--',process.execPath,'-e','process.exit(1)'],{encoding:'utf8'});
  expect(r.status).toBe(1);
  expect(cli('inspect',f.data).output).toContain('持久維護標記');
  expect(cli('publish',f.requestPath).output).toContain('其他操作');
  expect(readdirSync(join(f.data,'bank'))).toEqual(['original.yaml']);
});

it('建置在內容同步後仍持有讀鎖，並拒絕另一個發布者', async () => {
  const f=fixture();
  const bin=JSON.parse(readFileSync('node_modules/astro/package.json','utf8')).bin.astro;
  const child=spawn(process.execPath,[resolve('node_modules/astro',bin),'build','--outDir',join(f.work,'dist')],{
    env:{...process.env,EXAMREMIX_DATA_DIR:f.data},stdio:['ignore','pipe','pipe'],
  });
  const exited=new Promise<number|null>(ok=>child.once('exit',ok));
  let output='',errors='',paused=false;
  child.stderr.on('data',data=>{errors+=data;});
  try {
    await new Promise<void>((ok,fail)=>{
      child.once('error',fail);
      child.once('exit',code=>{if(!paused)fail(new Error(`建置在暫停前結束 ${code}: ${errors}`));});
      child.stdout.on('data',data=>{
        output+=data;
        if (!paused && output.includes('Synced content')) {
          if (!child.kill('SIGSTOP')) return fail(new Error('無法暫停自有建置行程'));
          paused=true;ok();
        }
      });
    });
    const blocked=cli('publish',f.requestPath);
    expect(blocked.status,blocked.output).toBe(1);
    expect(blocked.output).toContain('忙碌');
    expect(readdirSync(join(f.data,'bank'))).toEqual(['original.yaml']);
    child.kill('SIGCONT');
    expect(await exited,errors).toBe(0);
    expect(output).toContain('Complete!');
  } finally {
    if (child.exitCode===null) {child.kill('SIGCONT');child.kill('SIGKILL');await exited;}
  }
},30000);

it('受管讀取支援明示與預設目錄，錯誤參數拒絕執行', () => {
  const f=fixture();
  const reader=join(f.work,'read.mjs');
  writeFileSync(reader,"console.log(process.env.EXAMREMIX_DATA_DIR);");
  for (const root of [[f.data],[]]) {
    const r=spawnSync(process.execPath,['scripts/bank-access.ts','read',...root,'--',process.execPath,reader],{encoding:'utf8',env:{...process.env,EXAMREMIX_DATA_DIR:''}});
    expect(r.status,r.stderr).toBe(0);
    expect(r.stdout.trim()).toBe(realpathSync(root[0]??resolve('examples')));
  }
  for (const args of [[],['other',f.data,'--',process.execPath,reader],['read',f.data,'--']]) {
    const r=spawnSync(process.execPath,['scripts/bank-access.ts',...args],{encoding:'utf8'});
    expect(r.status,r.stderr).toBe(2);
    expect(r.stderr).toContain('用法');
  }
});

it.each(['self','supervisor'])('前景 %s 被訊號中斷不能被當成成功，維護標記須保留', target => {
  const f=fixture();
  const r=spawnSync(process.execPath,['scripts/bank-access.ts','write',f.data,'--expected',f.request.targetHash,'--',process.execPath,'-e',`process.kill(process.${target==='self'?'pid':'ppid'},'SIGTERM')`],{encoding:'utf8'});
  expect(r.status).toBe(1);
  if (target==='self') expect(r.stderr).toContain('受管指令失敗');
  expect(cli('inspect',f.data).output).toContain('持久維護標記');
});

const brokenReferencePaper={title:'合成錯誤引用',subject:'數學',grade:3,examScope:{semester:1,stage:'midterm'},
  sections:[{title:'是非',questions:['missing-01']}]};

it('批次 CLI 多餘參數及非新題命名拒絕發布', () => {
  const f=fixture();
  expect(cli('publish',f.requestPath,'unexpected').status).toBe(1);
  f.request.target='plain.yaml';f.request.evidence[0]!.id='plain-01';
  writeFileSync(f.requestPath,JSON.stringify(f.request));
  expect(cli('publish',f.requestPath).status).toBe(1);
  expect(readdirSync(join(f.data,'bank'))).toEqual(['original.yaml']);
});

it('受管修改即使腳本正常結束，完整跨檔檢查錯誤仍保留維護標記', () => {
  const f=fixture();
  const code=`require('node:fs').writeFileSync(${JSON.stringify(join(f.data,'papers/broken.yaml'))},${JSON.stringify(stringify(brokenReferencePaper))})`;
  const r=spawnSync(process.execPath,['scripts/bank-access.ts','write',f.data,'--expected',f.request.targetHash,'--',process.execPath,'-e',code],{encoding:'utf8'});
  expect(r.status,r.stdout+r.stderr).toBe(1);
  expect(r.stderr).toContain('missing-01');
  expect(cli('inspect',f.data).output).toContain('持久維護標記');
});

it('資料根目錄內的候選不因未被掃描就允許發布', () => {
  const f=fixture();
  const inside=join(f.data,'candidate.yaml');writeFileSync(inside,f.candidate);
  f.request.candidate=inside;writeFileSync(f.requestPath,JSON.stringify(f.request));
  const r=cli('publish',f.requestPath);
  expect(r.status,r.output).toBe(1);
  expect(r.output).toContain('資料根目錄外');
  expect(readdirSync(join(f.data,'bank'))).toEqual(['original.yaml']);
});

it.each(['doubt','image','count'])('候選的 %s 不能以其他合格條件抵銷', failure => {
  const f=fixture();const candidate=parse(f.candidate);
  if(failure==='doubt')candidate.questions[0].doubt='待核對';
  if(failure==='image') {
    writeFileSync(join(f.data,'bank/extra.svg'),'<svg/>');
    candidate.questions[0].image={src:'extra.svg',alt:'合成附圖'};
  }
  if(failure==='count')f.request.quantity.count=2;
  const content=stringify(candidate);writeFileSync(f.candidatePath,content);
  f.request.candidateHash=hash(content);f.request.targetHash=JSON.parse(cli('inspect',f.data).stdout).targetHash;
  writeFileSync(f.requestPath,JSON.stringify(f.request));
  expect(cli('publish',f.requestPath).status).toBe(1);
  expect(existsSync(join(f.data,'bank/new-one.yaml'))).toBe(false);
});

it('既有警告完整保留於發布結果，不能當作錯誤或遺失', () => {
  const f=fixture();const source=parse(f.source);
  source.questions.push({...source.questions[0],no:2,stem:'合成待核對題',doubt:'待核對'});
  writeFileSync(join(f.data,'bank/original.yaml'),stringify(source));
  writeFileSync(join(f.data,'papers/warning.yaml'),stringify({...brokenReferencePaper,title:'既有警告',sections:[{title:'是非',questions:['original-02']}]}));
  f.request.targetHash=JSON.parse(cli('inspect',f.data).stdout).targetHash;
  writeFileSync(f.requestPath,JSON.stringify(f.request));
  const result=cli('publish',f.requestPath);
  expect(result.status,result.output).toBe(0);
  expect(JSON.parse(result.stdout).warnings.join('\n')).toContain('original-02');
  expect(JSON.parse(result.stdout).warnings.join('\n')).toContain('待核對');
});

it('發布後新增跨檔錯誤會撤回本批；其他錯誤未修復前維護狀態持續保留', () => {
  const f=fixture();
  const r=injected(f,`const link=fs.linkSync;fs.linkSync=(a,b)=>{const r=link(a,b);if(String(b).endsWith('/new-one.yaml'))fs.writeFileSync(${JSON.stringify(join(f.data,'papers/broken.yaml'))},${JSON.stringify(stringify(brokenReferencePaper))});return r;};`);
  expect(r.status,r.stderr).toBe(1);
  expect(readdirSync(join(f.data,'bank'))).toEqual(['original.yaml']);
  expect(cli('inspect',f.data).output).toContain('持久維護標記');
  expect(cli('publish',f.requestPath).status).toBe(1);
  expect(cli('inspect',f.data).output).toContain('持久維護標記');
});

it('已發布批次重跑仍須拒絕目標中的新增跨檔錯誤', () => {
  const f=fixture();expect(cli('publish',f.requestPath).status).toBe(0);
  writeFileSync(join(f.data,'papers/broken.yaml'),stringify(brokenReferencePaper));
  const r=cli('publish',f.requestPath);
  expect(r.status,r.output).toBe(1);
  expect(r.output).toContain('完整性檢查失敗');
  expect(readFileSync(join(f.data,'bank/new-one.yaml'),'utf8')).toBe(f.candidate);
});

it('其他題庫引用本批時也不能撤回自有新檔', () => {
  const f=fixture();const other=parse(f.candidate);
  other.questions[0].derivedFrom=['new-one-01'];other.questions[0].stem='合成外部引用';
  const r=injected(f,`const link=fs.linkSync;fs.linkSync=(a,b)=>{const r=link(a,b);if(String(b).endsWith('/new-one.yaml'))fs.writeFileSync(${JSON.stringify(join(f.data,'bank/other.yaml'))},${JSON.stringify(stringify(other))});return r;};`);
  expect(r.status,r.stderr).toBe(1);expect(r.stderr).toContain('引用');
  expect(readFileSync(join(f.data,'bank/new-one.yaml'),'utf8')).toBe(f.candidate);
  expect(readFileSync(join(f.data,'bank/other.yaml'),'utf8')).toBe(stringify(other));
});

it.each(['batchId','fingerprint'])('恢復時維護意圖的 %s 不符就停止且不改寫紀錄', field => {
  const f=fixture();
  expect(injected(f,`const link=fs.linkSync;fs.linkSync=(a,b)=>{if(String(b).endsWith('/new-one.yaml'))process.kill(process.pid,'SIGKILL');return link(a,b);};`).signal).toBe('SIGKILL');
  const marker=`${f.data}.examremix-operations/maintenance.json`;
  const intent=JSON.parse(readFileSync(marker,'utf8'));intent[field]=field==='batchId'?'other-batch':'0'.repeat(64);
  const bytes=JSON.stringify(intent);writeFileSync(marker,bytes);
  expect(cli('publish',f.requestPath).status).toBe(1);
  expect(readFileSync(marker,'utf8')).toBe(bytes);
  expect(readdirSync(join(f.data,'bank'))).toEqual(['original.yaml']);
});

it('發布後目錄同步 EIO 保留錯誤證據及所有權，重跑辨認原檔', () => {
  const f=fixture();
  const r=injected(f,`let linked=false,failed=false;const link=fs.linkSync;fs.linkSync=(a,b)=>{const r=link(a,b);if(String(b).endsWith('/new-one.yaml'))linked=true;return r;};const sync=fs.fsyncSync;fs.fsyncSync=(fd)=>{if(linked&&!failed&&fs.fstatSync(fd).isDirectory()){failed=true;throw new Error('post-link EIO');}return sync(fd);};`);
  expect(r.status,r.stderr).toBe(1);
  expect(readFileSync(`${f.data}.examremix-operations/batches/batch-one/record.json`,'utf8')).toContain('post-link EIO');
  expect(readFileSync(join(f.data,'bank/new-one.yaml'),'utf8')).toBe(f.candidate);
  const resumed=cli('publish',f.requestPath);
  expect(resumed.status,resumed.output).toBe(0);
  expect(JSON.parse(resumed.stdout)).toMatchObject({state:'published',ids:['new-one-01'],added:1});
});

it('撤回檔在中斷後被修改時，恢復須停止並保留維護標記', () => {
  const f=fixture();
  const r=injected(f,`let linked=false,failed=false;const link=fs.linkSync;fs.linkSync=(a,b)=>{const r=link(a,b);if(String(b).endsWith('/new-one.yaml'))linked=true;return r;};const read=fs.readFileSync;fs.readFileSync=(p,...a)=>{if(linked&&!failed&&String(p).endsWith('/new-one.yaml')){failed=true;throw new Error('post-check failure');}return read(p,...a);};const rename=fs.renameSync;fs.renameSync=(a,b)=>{const r=rename(a,b);if(String(b).endsWith('.withdrawn'))process.kill(process.pid,'SIGKILL');return r;};`);
  expect(r.signal,r.stderr).toBe('SIGKILL');
  const quarantine=join(f.data,'.batch-batch-one.withdrawn');
  writeFileSync(quarantine,'modified evidence');
  const resumed=cli('publish',f.requestPath);
  expect(resumed.status,resumed.output).toBe(1);
  expect(resumed.output).toContain('撤回衝突');
  expect(readFileSync(quarantine,'utf8')).toBe('modified evidence');
  expect(cli('inspect',f.data).output).toContain('持久維護標記');
});

it('其他 host 的鎖與錯誤繼承 token 不可被認領；不存在的舊 lease 可重新取得', () => {
  const f=fixture();
  const inherited=spawnSync(process.execPath,['scripts/bank-batch.ts','inspect',f.data],{encoding:'utf8',env:{...process.env,EXAMREMIX_BANK_LEASE:'stale-token'}});
  expect(inherited.status,inherited.stderr).toBe(0);
  const lock=`${f.data}.examremix-operations/lock`;
  for (const owner of [
    {host:'another-host',pid:2147483647,token:'foreign'},
    {host:'another-host',pid:process.pid,token:'foreign'},
    {host:hostname(),pid:process.pid,token:'owner-token'},
  ]) {
    const bytes=JSON.stringify(owner);writeFileSync(lock,bytes);
    const r=spawnSync(process.execPath,['scripts/bank-batch.ts','inspect',f.data],{encoding:'utf8',env:{...process.env,EXAMREMIX_BANK_LEASE:'foreign'}});
    expect(r.status,r.stdout+r.stderr).toBe(1);
    expect(readFileSync(lock,'utf8')).toBe(bytes);
    rmSync(lock);
  }
});

it('鎖的父行程已死但同群組子行程仍活著時，不能回收鎖', async () => {
  const f=fixture();
  const leader=spawn(process.execPath,['-e',"const {spawn}=require('node:child_process');const child=spawn(process.execPath,['-e','setTimeout(()=>{},30000)'],{stdio:'ignore'});child.unref();"],{detached:true,stdio:'ignore'});
  try {
    expect(await new Promise<number|null>(ok=>leader.once('exit',ok))).toBe(0);
    const lock=`${f.data}.examremix-operations/lock`;
    const bytes=JSON.stringify({host:hostname(),pid:leader.pid,group:leader.pid,token:'orphan'});
    writeFileSync(lock,bytes);
    const result=cli('inspect',f.data);
    expect(result.status,result.output).toBe(1);
    expect(result.output).toContain('忙碌');
    expect(readFileSync(lock,'utf8')).toBe(bytes);
    expect(readFileSync(join(f.data,'bank/original.yaml'),'utf8')).toBe(f.source);
  } finally {
    if (leader.pid) {try {process.kill(-leader.pid,'SIGKILL');}catch(error){if((error as NodeJS.ErrnoException).code!=='ESRCH')throw error;}}
  }
});

it.each(['blank','zero-attempt'])('缺少有效品質證據 %s 時整批拒絕', failure => {
  const f=fixture();
  if (failure==='blank') f.request.evidence[0]!.independentCheck='  ';
  else f.request.evidence[0]!.attempt=0;
  writeFileSync(f.requestPath,JSON.stringify(f.request));
  const result=cli('publish',f.requestPath);
  expect(result.status,result.output).toBe(1);
  expect(readdirSync(join(f.data,'bank'))).toEqual(['original.yaml']);
});

it('不同請求指紋能新增不同批次，同批內容衝突不改寫原紀錄', () => {
  const f=fixture();
  expect(cli('publish',f.requestPath).status).toBe(0);
  const firstRecord=`${f.data}.examremix-operations/batches/batch-one/record.json`;
  const originalRecord=readFileSync(firstRecord,'utf8');
  const candidate=f.candidate.replace('五加二','六加一').replace('5+2=7；7-2=5','6+1=7；7-1=6');
  writeFileSync(f.candidatePath,candidate);
  f.request.candidateHash=hash(candidate);
  writeFileSync(f.requestPath,JSON.stringify(f.request));
  expect(cli('publish',f.requestPath).status).toBe(1);
  expect(readFileSync(firstRecord,'utf8')).toBe(originalRecord);
  const view=JSON.parse(cli('inspect',f.data).stdout);
  Object.assign(f.request,{batchId:'batch-two',target:'new-two.yaml',targetHash:view.targetHash,pendingHash:view.pendingHash,
    evidence:f.request.evidence.map(e=>({...e,id:'new-two-01',solution:'6+1=7',independentCheck:'7-1=6'}))});
  writeFileSync(f.requestPath,JSON.stringify(f.request));
  const result=cli('publish',f.requestPath);
  expect(result.status,result.output).toBe(0);
  expect(JSON.parse(result.stdout)).toMatchObject({batchId:'batch-two',ids:['new-two-01'],added:1});
  expect(readFileSync(join(f.data,'bank/new-two.yaml'),'utf8')).toBe(candidate);
  expect(readdirSync(join(f.data,'bank')).sort()).toEqual(['new-one.yaml','new-two.yaml','original.yaml']);
  expect(cli('rollback',f.data,'batch-one').status).toBe(0);
  expect(readFileSync(join(f.data,'bank/new-two.yaml'),'utf8')).toBe(candidate);
  expect(cli('publish',f.requestPath)).toEqual(result);
  expect(readdirSync(join(f.data,'bank')).sort()).toEqual(['new-two.yaml','original.yaml']);
});

it('同指紋換 batchId 回傳既有 ID，不新增後綴', () => {
  const f=fixture();
  const first=cli('publish',f.requestPath);
  f.request.batchId='batch-two';
  writeFileSync(f.requestPath,JSON.stringify(f.request));
  expect(cli('publish',f.requestPath)).toEqual(first);
});

it('使用者回復已發布批次可重跑，發布同指紋不重發，容量歸還且保留證據', () => {
  const f=fixture();
  expect(cli('publish',f.requestPath).status).toBe(0);
  const result=cli('rollback',f.data,f.request.batchId);
  expect(result.status,result.output).toBe(0);
  expect(JSON.parse(result.stdout)).toMatchObject({state:'reverted',ids:['new-one-01'],added:0});
  expect(cli('rollback',f.data,f.request.batchId)).toEqual(result);
  expect(cli('publish',f.requestPath)).toEqual(result);
  f.request.batchId='same-fingerprint';
  writeFileSync(f.requestPath,JSON.stringify(f.request));
  expect(cli('publish',f.requestPath)).toEqual(result);
  expect(readdirSync(join(f.data,'bank'))).toEqual(['original.yaml']);
  expect(readFileSync(join(f.data,'bank/original.yaml'),'utf8')).toBe(f.source);
  expect(readFileSync(join(f.data,'.batch-batch-one.withdrawn'),'utf8')).toBe(f.candidate);
  const checked=spawnSync(process.execPath,['scripts/check-bank.ts',f.data],{encoding:'utf8'});
  expect(checked.status,checked.stderr).toBe(0);
  expect(checked.stdout).toContain('數學：1 題');
});

it.each(['modified','paper','bank','reappeared'])(
  '使用者回復遇 %s 衝突列出檔案及 ID，保留所有內容', kind => {
    const f=fixture();
    expect(cli('publish',f.requestPath).status).toBe(0);
    const target=join(f.data,'bank/new-one.yaml');
    let conflict=target;
    if (kind==='modified') writeFileSync(target,f.candidate.replace('五加二','六加一'));
    else if (kind==='reappeared') {
      expect(cli('rollback',f.data,'batch-one').status).toBe(0);
      writeFileSync(target,f.candidate);
    } else {
      conflict=join(f.data,kind==='paper' ? 'papers/consumer.yaml' : 'bank/consumer.yaml');
      const data=kind==='paper' ? {title:'引用卷',sections:[{questions:['new-one-01']}]}
        : {questions:[{no:1,derivedFrom:['new-one-01']}]};
      writeFileSync(conflict,stringify(data));
    }
    const before=readFileSync(target,'utf8');
    const other=readFileSync(conflict,'utf8');
    const result=cli('rollback',f.data,'batch-one');
    expect(result.status,result.output).toBe(1);
    expect(result.output).toContain(realpathSync(conflict));
    if (['paper','bank'].includes(kind)) expect(result.output).toContain('new-one-01');
    expect(readFileSync(target,'utf8')).toBe(before);
    expect(readFileSync(conflict,'utf8')).toBe(other);
    expect(readFileSync(join(f.data,'bank/original.yaml'),'utf8')).toBe(f.source);
  });


it.each(['intent-before','intent-after','move-before','move-after','sync-bank','sync-root','result-before','result-after','clear-before','clear-after'])(
  '回復在 %s 中斷後能重跑且不重新發布，其他內容不變', point => {
    const f=fixture();
    expect(cli('publish',f.requestPath).status).toBe(0);
    const code=`
      const rename=fs.renameSync, sync=fs.fsyncSync, open=fs.openSync, unlink=fs.unlinkSync;
      const paths=new Map(); let moved=false;
      fs.openSync=(p,...a)=>{const fd=open(p,...a);paths.set(fd,String(p));return fd;};
      fs.renameSync=(a,b)=>{
        const record=String(b).endsWith('/record.json') ? JSON.parse(fs.readFileSync(a,'utf8')).data : null;
        const intent=record?.withdrawal && record?.result?.state==='published';
        const result=record?.result?.state==='reverted';
        const move=String(b).endsWith('.withdrawn');
        if ((${JSON.stringify(point)}==='intent-before' && intent)||(${JSON.stringify(point)}==='result-before' && result)||(${JSON.stringify(point)}==='move-before' && move)) process.kill(process.pid,'SIGKILL');
        const r=rename(a,b); if(move)moved=true;
        if ((${JSON.stringify(point)}==='intent-after' && intent)||(${JSON.stringify(point)}==='result-after' && result)||(${JSON.stringify(point)}==='move-after' && move)) process.kill(process.pid,'SIGKILL');
        return r;
      };
      fs.fsyncSync=fd=>{if(moved && ((${JSON.stringify(point)}==='sync-bank' && paths.get(fd)?.endsWith('/bank')) || (${JSON.stringify(point)}==='sync-root' && paths.get(fd)===${JSON.stringify(realpathSync(f.data))})))process.kill(process.pid,'SIGKILL');return sync(fd);};
      fs.unlinkSync=p=>{if(String(p).endsWith('/maintenance.json') && ${JSON.stringify(point)}==='clear-before')process.kill(process.pid,'SIGKILL');const r=unlink(p);if(String(p).endsWith('/maintenance.json') && ${JSON.stringify(point)}==='clear-after')process.kill(process.pid,'SIGKILL');return r;};
    `;
    const stopped=injected(f,code,['rollback',f.data,'batch-one']);
    expect(stopped.signal,stopped.stderr).toBe('SIGKILL');
    if(point!=='clear-after') expect(cli('inspect',f.data).output).toContain('持久維護標記');
    const result=point==='intent-before' ? cli('rollback',f.data,'batch-one') : cli('publish',f.requestPath);
    expect(result.status,result.output).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({state:'reverted',added:0});
    expect(cli('rollback',f.data,'batch-one')).toEqual(result);
    expect(cli('publish',f.requestPath)).toEqual(result);
    expect(readdirSync(join(f.data,'bank'))).toEqual(['original.yaml']);
    expect(readFileSync(join(f.data,'bank/original.yaml'),'utf8')).toBe(f.source);
    expect(readFileSync(join(f.data,'.batch-batch-one.withdrawn'),'utf8')).toBe(f.candidate);
    expect(cli('inspect',f.data).status).toBe(0);
  });

it('回復後紀錄已寫入但撤回證據遭修改，兩個恢復入口都拒絕成功', () => {
  const f=fixture();
  expect(cli('publish',f.requestPath).status).toBe(0);
  expect(cli('rollback',f.data,'batch-one').status).toBe(0);
  const evidence=join(f.data,'.batch-batch-one.withdrawn');
  writeFileSync(evidence,'modified evidence');
  for(const args of [['rollback',f.data,'batch-one'],['publish',f.requestPath]]) {
    const result=cli(...args);
    expect(result.status,result.output).toBe(1);
    expect(result.output).toContain('撤回衝突');
  }
  expect(readFileSync(evidence,'utf8')).toBe('modified evidence');
  expect(readdirSync(join(f.data,'bank'))).toEqual(['original.yaml']);
});

it('題組引用列出材料 ID 與引用位置，移除引用後整批回復', () => {
  const f=fixture();
  const source=parse(f.source);
  source.groups=[{no:1,paragraphs:['三加四等於七。'],members:[1]}];
  writeFileSync(join(f.data,'bank/original.yaml'),stringify(source));
  const candidate=parse(f.candidate);
  candidate.groups=[{no:1,paragraphs:['五加二等於七。'],members:[1],derivedFrom:'original#1'}];
  const content=stringify(candidate);
  writeFileSync(f.candidatePath,content);
  Object.assign(f.request,{candidateHash:hash(content),targetHash:JSON.parse(cli('inspect',f.data).stdout).targetHash,
    quantity:{count:1,unit:'groups'},evidence:['new-one-01','new-one#1'].map(id=>({...f.request.evidence[0],id}))});
  writeFileSync(f.requestPath,JSON.stringify(f.request));
  expect(cli('publish',f.requestPath).status).toBe(0);
  const consumer=join(f.data,'bank/consumer.yaml');
  writeFileSync(consumer,stringify({questions:[],groups:[{no:1,derivedFrom:'new-one#1'}]}));
  const blocked=cli('rollback',f.data,'batch-one');
  expect(blocked.status,blocked.output).toBe(1);
  expect(blocked.output).toContain(`${realpathSync(consumer)}.groups[0].derivedFrom → new-one#1`);
  expect(readFileSync(join(f.data,'bank/new-one.yaml'),'utf8')).toBe(content);
  rmSync(consumer);
  const result=cli('rollback',f.data,'batch-one');
  expect(result.status,result.output).toBe(0);
  expect(JSON.parse(result.stdout)).toMatchObject({state:'reverted',groups:['new-one#1'],ids:['new-one-01'],added:0});
  expect(readFileSync(join(f.data,'bank/original.yaml'),'utf8')).toBe(stringify(source));
});

it.each(['unknown','invalid-id','unfinished','damaged-record','foreign-maintenance','busy','missing-file','archive-conflict'])(
  '回復拒絕 %s，保留批次與其他內容', kind => {
    const f=fixture();
    const control=`${f.data}.examremix-operations`;
    if(kind!=='unfinished') expect(cli('publish',f.requestPath).status).toBe(0);
    else {
      expect(injected(f,`const link=fs.linkSync;fs.linkSync=(a,b)=>{if(String(b).endsWith('/new-one.yaml'))process.kill(process.pid,'SIGKILL');return link(a,b);};`).signal).toBe('SIGKILL');
    }
    const target=join(f.data,'bank/new-one.yaml');
    if(kind==='damaged-record')writeFileSync(join(control,'batches/batch-one/record.json'),'{}');
    if(kind==='foreign-maintenance')writeFileSync(join(control,'maintenance.json'),'{"batchId":"other","fingerprint":"other"}');
    if(kind==='busy')writeFileSync(join(control,'lock'),JSON.stringify({host:hostname(),pid:process.pid,token:'other'}));
    if(kind==='missing-file')rmSync(target);
    if(kind==='archive-conflict')writeFileSync(join(f.data,'.batch-batch-one.withdrawn'),'other content');
    const before=existsSync(target) ? readFileSync(target,'utf8') : undefined;
    const result=cli('rollback',f.data,kind==='unknown' ? 'unknown' : kind==='invalid-id' ? '../batch-one' : 'batch-one');
    expect(result.status,result.output).toBe(1);
    expect(existsSync(target)).toBe(before!==undefined);
    if(before!==undefined)expect(readFileSync(target,'utf8')).toBe(before);
    expect(readFileSync(join(f.data,'bank/original.yaml'),'utf8')).toBe(f.source);
    if(kind==='foreign-maintenance')expect(readFileSync(join(control,'maintenance.json'),'utf8')).toBe('{"batchId":"other","fingerprint":"other"}');
    if(kind==='archive-conflict')expect(readFileSync(join(f.data,'.batch-batch-one.withdrawn'),'utf8')).toBe('other content');
  });

it('回復移檔後同步失敗與殘留資料錯誤都維持拒讀，修復後才完成', () => {
  const f=fixture();
  expect(cli('publish',f.requestPath).status).toBe(0);
  const failed=injected(f,`let moved=false;const rename=fs.renameSync;fs.renameSync=(a,b)=>{const r=rename(a,b);if(String(b).endsWith('.withdrawn'))moved=true;return r;};const sync=fs.fsyncSync;fs.fsyncSync=fd=>{if(moved){const e=new Error('injected rollback EIO');e.code='EIO';throw e;}return sync(fd);};`,['rollback',f.data,'batch-one']);
  expect(failed.status,failed.stderr).toBe(1);
  expect(failed.stderr).toContain('EIO');
  expect(cli('inspect',f.data).output).toContain('持久維護標記');
  const broken=join(f.data,'papers/broken.yaml');
  writeFileSync(broken,'title: broken\n');
  const retry=cli('rollback',f.data,'batch-one');
  expect(retry.status,retry.output).toBe(1);
  expect(cli('inspect',f.data).output).toContain('持久維護標記');
  rmSync(broken);
  expect(cli('rollback',f.data,'batch-one').status).toBe(0);
  expect(cli('inspect',f.data).status).toBe(0);
  expect(readFileSync(join(f.data,'bank/original.yaml'),'utf8')).toBe(f.source);
  expect(readdirSync(join(f.data,'bank'))).toEqual(['original.yaml']);
});
