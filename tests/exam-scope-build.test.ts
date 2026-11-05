import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { it, expect } from 'vitest';
import { stringify } from 'yaml';

it('分類未知／疑點卷不輸出、無殘留連結，補分類解除疑點後才恢復', () => {
  const root=mkdtempSync(join(tmpdir(),'examremix-scope-'));
  const data=join(root,'data'), out=join(root,'output');
  mkdirSync(join(data,'bank'),{recursive:true});mkdirSync(join(data,'papers'));
  const scope={semester:1,stage:'midterm'};
  const q={no:1,type:'choice',subject:'數學',grade:3,examScope:scope,stem:'1+1？',options:['2','3'],answer:1,explanation:'1+1=2',source:{originalPaper:'合成',number:1}};
  const paper={title:'只供資格驗收的合成卷',subject:'數學',grade:3,examScope:scope,sections:[{title:'一',questions:['sample-01']}]};
  const write=(question:object, p:object)=>{
    writeFileSync(join(data,'bank/sample.yaml'),stringify({questions:[question]}));
    writeFileSync(join(data,'papers/test.yaml'),stringify(p));
  };
  const build=()=>{
    const r=spawnSync('pnpm',['exec','astro','build','--outDir',out],{env:{...process.env,EXAMREMIX_DATA_DIR:data},encoding:'utf8'});
    expect(r.status,`${r.stdout}\n${r.stderr}`).toBe(0);
  };
  try {
    write(q,paper);build();expect(existsSync(join(out,'papers/test/index.html'))).toBe(true);
    const {examScope,...unknown}=q;
    write(unknown,paper);build();
    expect(existsSync(join(out,'papers/test/index.html'))).toBe(false);
    for(const page of ['index.html','bank/index.html','papers/index.html']) expect(readFileSync(join(out,page),'utf8')).not.toContain('href="/papers/test/');
    expect(readFileSync(join(out,'index.html'),'utf8')).toContain('沒有可用題目');
    write({...q,doubt:'需要核對'},paper);build();expect(existsSync(join(out,'papers/test/index.html'))).toBe(false);
    write(q,paper);build();expect(existsSync(join(out,'papers/test/index.html'))).toBe(true);
    expect(readFileSync(join(out,'index.html'),'utf8')).toContain('完整卷規則尚未配置');
  } finally {rmSync(root,{recursive:true,force:true});}
},60000);
