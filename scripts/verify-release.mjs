import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const cwd=process.cwd();
const required=['index.html','app.js','styles.css','sw.js','manifest.webmanifest','runtime-config.js','core/browser_runtime.mjs','core/engine.mjs','core/local_ai_v09_bridge.mjs','icons/icon-192.png','icons/icon-512.png','.nojekyll'];
const fail=m=>{console.error('RELEASE CHECK FAILED: '+m);process.exitCode=1;};
for(const file of required) if(!fs.existsSync(file)) fail('missing '+file);
if(process.exitCode)process.exit();

function visit(folder){
  return fs.readdirSync(folder,{withFileTypes:true}).flatMap(e=>{
    const name=path.posix.join(folder,e.name);
    return e.isDirectory()?visit(name):[name];
  });
}
const scripts=['app.js','sw.js','runtime-config.js',...visit('core').filter(x=>x.endsWith('.mjs'))];
for(const file of scripts){
  const s=fs.readFileSync(file,'utf8');
  const check=spawnSync(process.execPath,['--check',file],{encoding:'utf8'});
  if(check.status!==0) fail('invalid JS in '+file+': '+(check.stderr||'').trim());
  for(const m of s.matchAll(/\b(?:from\s*|import\s*\(\s*|import\s*)['"](\.[^'"]+)['"]/g)){
    const rel=m[1],target=path.resolve(path.dirname(file),rel);
    if(!target.startsWith(cwd+path.sep) || !fs.existsSync(target)) fail('unresolved/outside import '+file+' -> '+rel);
  }
  if(/\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/.test(s)) fail('provider key pattern in '+file);
}
const config=fs.readFileSync('runtime-config.js','utf8');
if(!/apiBase:\s*''/.test(config)||!/onlineDmGateway:\s*''/.test(config)) fail('public build must keep runtime and provider gateways blank');
for(const name of ['server.mjs','online_dm_server.mjs','core/openai.mjs','core/store.mjs','.env']){
  if(fs.existsSync(name)) fail('server/private file unexpectedly shipped: '+name);
}
const manifest=JSON.parse(fs.readFileSync('manifest.webmanifest','utf8'));
if(manifest.start_url!=='./'||manifest.scope!=='./') fail('PWA manifest does not support subpath Pages deployment');
for(const icon of manifest.icons||[]) if(!fs.existsSync(icon.src))fail('missing manifest icon '+icon.src);
const sw=fs.readFileSync('sw.js','utf8'),list=(sw.match(/const CORE_MODULES=\[([\s\S]*?)\];/)||[])[1];
if(!list)fail('service-worker core list missing');
else for(const found of list.matchAll(/'([^']+\.mjs)'/g))if(!fs.existsSync('core/'+found[1]))fail('service-worker cache module missing '+found[1]);
const html=fs.readFileSync('index.html','utf8');
for(const asset of ['styles.css','app.js','manifest.webmanifest','icons/icon.svg']){
 if(!html.includes('./'+asset))fail('HTML references not found: '+asset);
}
if(!process.exitCode)console.log('Release syntax, relative imports, PWA assets, local-only config and secret screening passed. Core modules: '+scripts.filter(x=>x.startsWith('core/')).length);
