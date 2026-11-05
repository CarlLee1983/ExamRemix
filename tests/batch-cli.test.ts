import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
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

function injected(f: ReturnType<typeof fixture>, code: string) {
  const preload=join(f.work,'inject.mjs');
  writeFileSync(preload,`import fs from 'node:fs'; import {syncBuiltinESMExports} from 'node:module';\n${code}\nsyncBuiltinESMExports();`);
  return spawnSync(process.execPath,['--import',preload,'scripts/bank-batch.ts','publish',f.requestPath],{encoding:'utf8'});
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

it('完整混合題型題組一次發布；缺成員或錯誤順序拒絕', () => {
  for (const variant of ['complete','missing','order']) {
    const f=fixture();
    const source=parse(f.source);
    source.groups=[{no:1,paragraphs:['合成材料：三加四等於七。'],members:[1,2]}];
    source.questions.push({...source.questions[0],no:2,type:'choice',stem:'三加四的結果是？',options:['七','八'],answer:1});
    writeFileSync(join(f.data,'bank/original.yaml'),stringify(source));
    const candidate=parse(f.candidate);
    candidate.groups=[{no:1,paragraphs:['合成材料：五加二等於七。'],members:variant==='order'?[2,1]:[1,2],derivedFrom:'original#1'}];
    if (variant!=='missing') candidate.questions.push({...candidate.questions[0],no:2,type:'choice',stem:'五加二的結果是？',options:['七','八'],answer:1,derivedFrom:['original-02']});
    const content=stringify(candidate);
    writeFileSync(f.candidatePath,content);
    Object.assign(f.request,{candidateHash:hash(content),targetHash:JSON.parse(cli('inspect',f.data).stdout).targetHash,
      sourceIds:['original-01','original-02'],quantity:{count:1,unit:'groups'},
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
    await new Promise<void>((res,rej)=>{child.stdout.once('data',()=>res());child.once('error',rej);});
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

it('同指紋換 batchId 回傳既有 ID，不新增後綴', () => {
  const f=fixture();
  const first=cli('publish',f.requestPath);
  f.request.batchId='batch-two';
  writeFileSync(f.requestPath,JSON.stringify(f.request));
  expect(cli('publish',f.requestPath)).toEqual(first);
});
