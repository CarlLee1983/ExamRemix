/** Isolated fixture server: uses Vitest's existing Vite, never Astro production routes/build. */
import { createRequire } from 'node:module';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const {createServer}=await import(createRequire(import.meta.resolve('vitest')).resolve('vite'));
const cacheDir=mkdtempSync(join(tmpdir(),'examremix-redraw-vite-'));
const server=await createServer({configFile:false,root:process.cwd(),cacheDir,server:{host:'127.0.0.1',port:4414,strictPort:true},appType:'mpa'});
await server.listen();
const stop=async()=>{await server.close();rmSync(cacheDir,{recursive:true,force:true});process.exit();};
process.on('SIGTERM',stop);process.on('SIGINT',stop);
