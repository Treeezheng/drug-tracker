import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Plugin } from 'vite';

export function buildMetadata(edition: string): Plugin {
  let root = '', out = '';
  return {
    name: 'drug-build-metadata', enforce: 'post',
    configResolved(config) { root=config.root;out=resolve(root,config.build.outDir); },
    writeBundle() {
      const digest=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
      let sourceCommit:string|null=null,dirty:boolean|null=null;
      const supplied=process.env.SOURCE_VERSION||process.env.GITHUB_SHA;
      if(supplied&&/^[a-f\d]{40}$/.test(supplied))sourceCommit=supplied;
      try {
        if(!sourceCommit)sourceCommit=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();
        dirty=Boolean(execFileSync('git',['status','--porcelain'],{cwd:root,encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim());
      }catch { /* Heroku source archives do not include .git. */ }
      const files:Record<string,{sha256:string;bytes:number}>={};
      function collect(directory:string,prefix='') {
        for(const entry of readdirSync(directory,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name,'en'))) {
          const name=prefix+entry.name;
          if(entry.isDirectory())collect(join(directory,entry.name),name+'/');
          else if(entry.isFile()&&name!=='build-info.json'){const bytes=readFileSync(join(directory,entry.name));files[name]={sha256:digest(bytes),bytes:bytes.length};}
        }
      }
      collect(out);
      const packageJson=JSON.parse(readFileSync(join(root,'package.json'),'utf8'));
      // Explicit public allowlist. Never serialize process.env, runtime config, or secrets.
      writeFileSync(join(out,'build-info.json'),JSON.stringify({schemaVersion:1,sourceCommit,dirty,edition,nodeVersion:process.version,packageManager:packageJson.packageManager,lockfileSha256:digest(readFileSync(join(root,'pnpm-lock.yaml'))),files},null,2)+'\n');
    },
  };
}
