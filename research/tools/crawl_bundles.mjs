import fs from 'fs'; import path from 'path';
const out = process.argv[2]; const base='https://braude.top/_app/immutable/';
const seen=new Set(); const q=['entry/start.DbJOb43X.js','entry/app.B4rBcRNM.js'];
while(q.length){const p=q.shift(); if(seen.has(p))continue; seen.add(p);
 const r=await fetch(base+p,{headers:{'user-agent':'Mozilla/5.0'}}); const t=await r.text();
 fs.writeFileSync(path.join(out,p.replace(/\//g,'_')),t);
 for(const m of t.matchAll(/["'`](\.\.?\/[\w./-]+\.js)["'`]/g)){q.push(path.posix.normalize(path.posix.join(path.posix.dirname(p),m[1])));}
 await new Promise(r=>setTimeout(r,150));}
console.log(seen.size);
