import fs from 'fs'; import {setYear,post,get} from './ff.mjs';
const W=f=>'research/samples/'+f; const sl=()=>new Promise(r=>setTimeout(r,500));
await setYear(2027);
let h=await post({PRGNAME:'S_LOOK_FOR_NOSE_AB',ARGUMENTS:'R1C2',R1C2:'כ'});fs.writeFileSync(W('ff_letter_kaf_2027.html'),h);
const ids=[...h.matchAll(/prgname=([A-Za-z_]+)&amp;arguments=([^"]+)"/gi)].map(m=>m[1]+' '+m[2]);console.log('letter links',ids.length,ids.slice(0,5));
await sl(); h=await post({PRGNAME:'S_EXAMS',ARGUMENTS:'R1C28,R1C29,R1C30',R1C28:'6',R1C29:'1',R1C30:'3'});fs.writeFileSync(W('ff_exams_sw_y3_semA.html'),h);
await sl(); h=await post({PRGNAME:'S_YFineDate',ARGUMENTS:'R1C7,R1C5,R1C6',R1C7:'1',R1C5:'1',R1C6:'1'});fs.writeFileSync(W('ff_dayhour_A_sun_0830.html'),h);
