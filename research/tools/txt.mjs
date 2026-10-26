import fs from 'fs';let h=fs.readFileSync(process.argv[2],'utf8');const n=+process.argv[3]||3000;
let t=h.replace(/<script[\s\S]*?<\/script>/g,'').replace(/<style[\s\S]*?<\/style>/g,'').replace(/<[^>]+>/g,' ').replace(/&nbsp;/g,' ').replace(/&quot;/g,'"').replace(/\s+/g,' ');
const i=t.indexOf('דף הבית');console.log(t.slice(i>0?i:0,(i>0?i:0)+n));
