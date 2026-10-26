import fs from 'fs'; import {setYear,post} from './ff.mjs';
await setYear(2027);
for(const [f,y] of [[6,2026],[6,2025],[7,2026]]){const t=await post({PRGNAME:'JSON',Action:'700',Faculty:String(f),Year:String(y)});console.log(f,y,t.slice(0,1500));fs.writeFileSync(`research/samples/json700_fac${f}_${y}.json`,t);await new Promise(r=>setTimeout(r,400));}
