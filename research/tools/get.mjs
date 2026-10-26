// usage: node get.mjs <url> [outfile]
import fs from 'fs';
const [,,url,out]=process.argv;
const r=await fetch(url,{headers:{'user-agent':'Mozilla/5.0 (research; braude-schedule)'}});
const t=await r.text();
console.error(r.status, r.headers.get('content-type'), t.length, 'ACAO=',r.headers.get('access-control-allow-origin'));
if(out) fs.writeFileSync(out,t); else process.stdout.write(t.slice(0,4000));
