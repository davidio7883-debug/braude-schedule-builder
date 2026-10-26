import fs from 'fs'; import {setYear,post} from './ff.mjs';
await setYear(2027);
const h=await post({PRGNAME:'S_YFineDate',ARGUMENTS:'R1C7,R1C5,R1C6',R1C7:'1',R1C5:'7',R1C6:'1'});fs.writeFileSync('research/samples/ff_dayhour_A_all.html',h);
console.log(h.length,(h.match(/פרטים נוספים/g)||[]).length);
