/** Capture banks, profile, conflicts and image bytes under the same managed read lease. */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { parse } from 'yaml';
import { bankFileSchema } from '../domain/schema.ts';
import type { MathCompositionInput } from '../domain/paper-composition.ts';
import { acquireBank } from './bank-access.ts';
import { readDataDir } from './data-dir.ts';

export function readMathCompositionInput(root:string,profileName:string):MathCompositionInput {
  if(!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(profileName))throw new Error('配置名稱只能使用小寫英數及連字號');
  const lease=acquireBank(root,'read');
  const previous=process.env.EXAMREMIX_BANK_LEASE;
  process.env.EXAMREMIX_BANK_LEASE=lease.token;
  try {
    const contents=readDataDir(lease.root);
    if(contents.problems.length)throw new Error(contents.problems.map(p=>p.message).join('；'));
    const banks=contents.banks.map(b=>({name:b.name,file:b.file,data:bankFileSchema.parse(b.raw)}));
    const profilePath=join(lease.root,'profiles',`${profileName}.yaml`);
    const conflictPath=join(lease.root,'selection-conflicts.yaml');
    const profile=existsSync(profilePath)?parse(readFileSync(profilePath,'utf8')):undefined;
    const scopeKey=(raw:unknown)=>{
      if(!raw || typeof raw!=='object' || !('scope' in raw) || !raw.scope || typeof raw.scope!=='object')return undefined;
      const scope=raw.scope;
      if(!('grade' in scope) || !('subject' in scope) || !('semester' in scope) || !('stage' in scope))return undefined;
      return JSON.stringify([scope.grade,scope.subject,scope.semester,scope.stage]);
    };
    const scope=scopeKey(profile);
    if(scope) {
      const matching=readdirSync(join(lease.root,'profiles')).filter(name=>name.endsWith('.yaml')).filter(name=>scopeKey(parse(readFileSync(join(lease.root,'profiles',name),'utf8')))===scope);
      if(matching.length!==1)throw new Error(`同一考試範圍只能有一份配置：${matching.sort().join('、')}`);
    }
    return {banks,images:contents.images,
      imageHashes:Object.fromEntries(contents.images.map(path=>[path,createHash('sha256').update(readFileSync(join(lease.root,'bank',path))).digest('hex')])),
      profile,
      conflicts:existsSync(conflictPath)?parse(readFileSync(conflictPath,'utf8')):undefined};
  } finally {
    if(previous===undefined)delete process.env.EXAMREMIX_BANK_LEASE;else process.env.EXAMREMIX_BANK_LEASE=previous;
    lease.release();
  }
}
