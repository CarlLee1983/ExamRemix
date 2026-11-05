// A foreground process group retains ownership even if its supervising Node process dies.
import { spawn } from 'node:child_process';
import { existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { acquireBank, durableWrite, syncDirectory } from '../src/lib/bank-access.ts';
import { checkManagedRoot, inspectBatchRoot } from '../src/lib/question-batch.ts';
import { resolveDataDir } from '../src/lib/data-dir.ts';

const args=process.argv.slice(2);
const owned=args[0]==='--owned';
if (owned) args.shift();
const [mode,...rest]=args;
const separator=rest.indexOf('--');
const root=mode==='read' && separator===0 ? resolveDataDir()
  : (mode==='read' && separator===1) || (mode==='write' && separator===3 && rest[1]==='--expected') ? resolveDataDir(rest[0]) : undefined;
const expected=mode==='write' ? rest[2] : undefined;
const command=rest.slice(separator+1);
if (!root || !command.length || !['read','write'].includes(mode!)) {
  console.error('用法：pnpm bank:access read [資料目錄] -- <前景指令> | write <資料目錄> --expected <targetHash> -- <前景指令>');
  process.exit(2);
}
if (!owned) {
  const child=spawn(process.execPath,[fileURLToPath(import.meta.url),'--owned',...args],{detached:true,stdio:'inherit'});
  for (const signal of ['SIGINT','SIGTERM'] as const) process.on(signal,()=>{if(child.pid)process.kill(-child.pid,signal);});
  child.once('error',error=>{console.error(error.message);process.exitCode=1;});
  child.once('exit',(code)=>{process.exitCode=code??1;});
} else {
  process.env.EXAMREMIX_BANK_GROUP=String(process.pid);
  try {
    const lease=acquireBank(root,mode as 'read'|'write');
    process.env.EXAMREMIX_BANK_LEASE=lease.token;
    try {
      const marker=join(lease.control,'maintenance.json');
      if (mode==='write') {
        if (inspectBatchRoot(lease.root).targetHash!==expected) throw new Error('來源／目標版本已變動；須重新準備受管修改');
        durableWrite(marker,JSON.stringify({operation:'managed-write',pid:process.pid}));
      }
      const status=await new Promise<number>((res,rej)=>{
        const child=spawn(command[0]!,command.slice(1),{stdio:'inherit',env:{...process.env,EXAMREMIX_DATA_DIR:lease.root}});
        child.once('error',rej);
        child.once('exit',code=>res(code??1));
      });
      if (status!==0) throw new Error(`受管指令失敗（${status}）；${mode==='write'?'維護標記保留，先核對資料再恢復':'讀取結束'}`);
      if (mode==='write') {
        checkManagedRoot(lease.root);
        if (!existsSync(marker)) throw new Error('持久維護標記遭移除；停止');
        unlinkSync(marker);
        syncDirectory(lease.control);
      }
    } finally { lease.release(); }
  } catch(error) { console.error((error as Error).message); process.exitCode=1; }
}
