import type { AstroIntegration } from 'astro';
import { acquireBank } from './bank-access.ts';
import { resolveDataDir } from './data-dir.ts';

/** Keep content collections, cross-file checks, assets and rendering on one version. */
export function bankBuild(): AstroIntegration {
  return {
    name:'examremix-bank-snapshot',
    hooks:{
      'astro:config:setup': ({ command }) => {
        if (command==='preview') return;
        const lease=acquireBank(resolveDataDir(),'read');
        process.env.EXAMREMIX_BANK_LEASE=lease.token;
        process.once('exit',()=>lease.release());
      },
    },
  };
}
