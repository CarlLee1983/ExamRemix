// All managed readers and writers use the canonical data root's control directory.
// Local filesystems only: hard links and file/directory fsync must be supported.
import { closeSync, existsSync, fsyncSync, linkSync, mkdirSync, openSync, readFileSync, realpathSync, unlinkSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { dirname, join } from 'node:path';

export function canonicalRoot(root: string) { return realpathSync(root); }
export function controlDir(root: string) { return `${canonicalRoot(root)}.examremix-operations`; }
export function syncDirectory(path: string) {
  const fd = openSync(path, 'r');
  try { fsyncSync(fd); } finally { closeSync(fd); }
}
export function durableWrite(path: string, content: string) {
  const fd = openSync(path, 'wx', 0o600);
  try { writeFileSync(fd, content); fsyncSync(fd); } finally { closeSync(fd); }
  syncDirectory(dirname(path));
}

function reclaimDeadLock(control: string) {
  const lock = join(control, 'lock');
  if (!existsSync(lock)) return;
  const owner = JSON.parse(readFileSync(lock, 'utf8'));
  if (owner.host !== hostname() || !Number.isSafeInteger(owner.pid) || owner.pid <= 0) throw new Error('無法確認鎖擁有者；停止並保留鎖');
  try { process.kill(owner.group === owner.pid ? -owner.pid : owner.pid, 0); throw new Error(`資料目錄忙碌：writer/reader PID ${owner.pid}`); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; }
  // Reclamation is itself exclusive. A crash here fails closed for operator inspection.
  const recovery = join(control, 'lock-recovery');
  durableWrite(recovery, JSON.stringify(owner));
  try {
    if (readFileSync(lock, 'utf8') !== JSON.stringify(owner)) throw new Error('鎖已改變');
    unlinkSync(lock);
    syncDirectory(control);
  } finally { unlinkSync(recovery); syncDirectory(control); }
}

export interface BankLease { root: string; control: string; token: string; release: () => void }
export function acquireBank(root: string, mode: 'read' | 'write', recovery = false): BankLease {
  root = canonicalRoot(root);
  const control = controlDir(root);
  mkdirSync(control, { recursive: true, mode: 0o700 });
  syncDirectory(dirname(control));
  if (existsSync(join(control, 'lock-recovery'))) throw new Error('鎖恢復未完成；停止並檢查操作紀錄');
  // A parent CLI may keep the lease for a child validation/build process.
  const inherited = process.env.EXAMREMIX_BANK_LEASE;
  if (inherited && existsSync(join(control, 'lock'))) {
    const owner = JSON.parse(readFileSync(join(control, 'lock'), 'utf8'));
    if (inherited === owner.token && owner.host === hostname()) {
      process.kill(owner.pid, 0);
      if (mode === 'write') throw new Error('受管子行程不可巢狀取得寫鎖');
      return { root, control, token: inherited, release() {} };
    }
  }
  reclaimDeadLock(control);
  const token = randomUUID();
  const claim = join(control, `claim-${token}`);
  durableWrite(claim, JSON.stringify({ pid: process.pid, host: hostname(), token, mode,
    ...(process.env.EXAMREMIX_BANK_GROUP === String(process.pid) ? {group:process.pid} : {}) }));
  try { linkSync(claim, join(control, 'lock')); syncDirectory(control); }
  finally { unlinkSync(claim); }
  const release = () => {
    const owner = JSON.parse(readFileSync(join(control, 'lock'), 'utf8'));
    if (owner.token !== token) throw new Error('鎖所有權衝突');
    unlinkSync(join(control, 'lock'));
    syncDirectory(control);
  };
  if (existsSync(join(control, 'maintenance.json')) && !recovery) {
    release();
    throw new Error('持久維護標記存在；請先恢復未完成的受管操作');
  }
  return { root, control, token, release };
}

export function withBankRead<T>(root: string, read: () => T): T {
  const lease = acquireBank(root, 'read');
  try { return read(); } finally { lease.release(); }
}
