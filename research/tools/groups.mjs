import fs from 'fs'; import {setYear,post,get} from './ff.mjs';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
await setYear(2027); const res={};
for(const m of [54,8,39,4,3,2,52,51,7,6,56,5,55,50,20]){const h=await post({PRGNAME:'S_GROUP',ARGUMENTS:'R1C8',R1C8:String(m)});
 res[m]=[...h.matchAll(/<div class="col">([^<]+)<\/div>\s*<div class="col"><a href="fireflyweb\.aspx\?prgname=S_GROUP_HOURS&amp;arguments=-N(\d+)"/g)].map(x=>({name:x[1].trim(),group:x[2]}));
 await sleep(400);}
fs.writeFileSync('research/samples/degree_groups_2027.json',JSON.stringify(res,null,1));
for(const k in res)console.log(k,res[k].map(g=>g.group+':'+g.name).join(' | '));
const h=await get('prgname=S_GROUP_HOURS&arguments=-N271060430');fs.writeFileSync('research/samples/ff_group_hours_271060430.html',h);
