import fs from 'fs';
const h=fs.readFileSync(process.argv[2],'utf8');
const rows=[...h.matchAll(/<article class="row">([\s\S]*?)<\/article>/g)].map(m=>{const cols=[...m[1].matchAll(/<div class="col[^"]*">([\s\S]*?)<\/div>/g)].map(c=>c[1].replace(/<[^>]+>/g,'').replace(/&nbsp;/g,' ').replace(/&quot;/g,'"').replace(/\s+/g,' ').trim());const a=(m[1].match(/arguments=([^"]+)"/)||[])[1];return {cols,a};}).filter(r=>/^\d+$/.test(r.cols[0]));
const courses=new Set(rows.map(r=>r.cols[0]));const inst=new Set(rows.map(r=>r.a));
console.log('rows',rows.length,'courses',courses.size,'instances',inst.size);console.log(rows.slice(0,3));
const types={};rows.forEach(r=>types[r.cols[2]]=(types[r.cols[2]]||0)+1);console.log(types);
fs.writeFileSync(process.argv[3],JSON.stringify(rows.slice(0,60),null,1));
