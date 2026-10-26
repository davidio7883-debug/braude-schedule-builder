import fs from 'fs'; import {setYear,post,get} from './ff.mjs';
await setYear(2027);
const h=await get('prgname=S_SHOW_PROGS&arguments=-N2025,-N60752');fs.writeFileSync('research/samples/ff_show_progs_2025_60752.html',h);
