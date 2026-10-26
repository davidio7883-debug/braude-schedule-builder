import fs from 'fs'; import {setYear,post} from './ff.mjs';
await setYear(2027);
const h=await post({PRGNAME:'S_YFineDate',ARGUMENTS:'R1C7,R1C5,R1C6',R1C7:'2',R1C5:'7',R1C6:'1'});
console.log('semB rows',(h.match(/S_CourseDetails/g)||[]).length);
