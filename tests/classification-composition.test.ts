import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { stringify } from 'yaml';
import { mathFixture } from './fixtures/composition/math.ts';

it('分類快照拒絕配分不合格的完整卷配置',()=>{
  const work=mkdtempSync(join(tmpdir(),'examremix-classify-profile-'));
  try {
    const input=mathFixture();
    for(const folder of ['bank','papers','profiles'])mkdirSync(join(work,folder));
    for(const bank of input.banks)writeFileSync(join(work,bank.file),stringify(bank.data));
    input.profile.sections[0]!.slots[0]!.points=3;
    writeFileSync(join(work,'profiles/math.yaml'),stringify(input.profile));
    writeFileSync(join(work,'selection-conflicts.yaml'),stringify(input.conflicts));
    const result=spawnSync(process.execPath,['scripts/classify-bank.ts','inspect',work],{encoding:'utf8'});
    expect(result.status,result.stdout+result.stderr).toBe(1);
    expect(result.stderr).toContain('完整卷配置');
  } finally {
    rmSync(work,{recursive:true,force:true});
    rmSync(`${work}.examremix-operations`,{recursive:true,force:true});
  }
});

it('分類隔離建置保留完整卷與近重配置的原始位元',()=>{
  const work=mkdtempSync(join(tmpdir(),'examremix-classify-profile-build-'));
  const data=join(work,'data');
  try {
    const input=mathFixture();
    for(const folder of ['bank','papers','profiles'])mkdirSync(join(data,folder),{recursive:true});
    for(const bank of input.banks)writeFileSync(join(data,bank.file),stringify(bank.data));
    writeFileSync(join(data,'bank/extra.yaml'),stringify({questions:[{...input.banks[0]!.data.questions[0],no:1,examScope:undefined,source:{originalPaper:'額外原卷',number:1}}]}));
    const profile=stringify(input.profile),conflicts=stringify(input.conflicts);
    writeFileSync(join(data,'profiles/math.yaml'),profile);
    writeFileSync(join(data,'selection-conflicts.yaml'),conflicts);
    const inspected=spawnSync(process.execPath,['scripts/classify-bank.ts','inspect',data],{encoding:'utf8'});
    expect(inspected.status,inspected.stderr).toBe(0);
    const version=JSON.parse(inspected.stdout),source=join(work,'original.txt'),evidence='三年級數學上學期期中';
    writeFileSync(source,evidence);
    const request=join(work,'request.json');
    writeFileSync(request,JSON.stringify({version:'classification-v1',batchId:'extra-original',batch:'額外原卷',dataDir:data,programHash:version.programHash,dataHash:version.dataHash,
      evidence:[{file:source,hash:createHash('sha256').update(evidence).digest('hex'),location:'標題',reason:'標題明示範圍',originalPaper:'額外原卷',ids:['extra-01'],scope:{grade:3,subject:'數學',semester:1,stage:'midterm'}}],papers:[]}));
    const preview=spawnSync(process.execPath,['scripts/classify-bank.ts','preview',request,'--build'],{encoding:'utf8'});
    expect(preview.status,preview.stdout+preview.stderr).toBe(0);
    const planHash=JSON.parse(preview.stdout).planHash;
    const receipt=JSON.parse(readFileSync(`${data}.examremix-operations/classification-previews/${planHash}.json`,'utf8')).data;
    const isolated=join(receipt.directory,'data');
    expect(existsSync(join(isolated,'profiles/math.yaml'))).toBe(true);
    expect(readFileSync(join(isolated,'profiles/math.yaml'),'utf8')).toBe(profile);
    expect(readFileSync(join(isolated,'selection-conflicts.yaml'),'utf8')).toBe(conflicts);
  } finally {rmSync(work,{recursive:true,force:true});}
},30000);

it('分類預覽把過期的配置核對雜湊列為未配置',()=>{
  const work=mkdtempSync(join(tmpdir(),'examremix-classify-stale-profile-'));
  try {
    const input=mathFixture();
    for(const folder of ['bank','papers','profiles'])mkdirSync(join(work,folder));
    for(const bank of input.banks)writeFileSync(join(work,bank.file),stringify(bank.data));
    input.profile.reviewedSnapshotHash='0'.repeat(64);
    writeFileSync(join(work,'profiles/math.yaml'),stringify(input.profile));
    writeFileSync(join(work,'selection-conflicts.yaml'),stringify(input.conflicts));
    const result=spawnSync(process.execPath,['scripts/classify-bank.ts','inspect',work],{encoding:'utf8'});
    expect(result.status,result.stderr).toBe(0);
    expect(JSON.parse(result.stdout).configurations).toEqual([{file:'profiles/math.yaml',state:'unconfigured',diagnostics:[{message:'題庫或圖片核對版本尚未提供或已過期'}]}]);
  } finally {
    rmSync(work,{recursive:true,force:true});rmSync(`${work}.examremix-operations`,{recursive:true,force:true});
  }
});

it('分類快照拒絕同一範圍的兩份配置',()=>{
  const work=mkdtempSync(join(tmpdir(),'examremix-classify-duplicate-profile-'));
  try {
    const input=mathFixture();
    for(const folder of ['bank','papers','profiles'])mkdirSync(join(work,folder));
    for(const bank of input.banks)writeFileSync(join(work,bank.file),stringify(bank.data));
    writeFileSync(join(work,'profiles/math.yaml'),stringify(input.profile));
    writeFileSync(join(work,'profiles/another.yaml'),stringify({...input.profile,id:'another'}));
    writeFileSync(join(work,'selection-conflicts.yaml'),stringify(input.conflicts));
    const result=spawnSync(process.execPath,['scripts/classify-bank.ts','inspect',work],{encoding:'utf8'});
    expect(result.status,result.stderr).toBe(1);expect(result.stderr).toContain('同一考試範圍');
  } finally {
    rmSync(work,{recursive:true,force:true});rmSync(`${work}.examremix-operations`,{recursive:true,force:true});
  }
});
