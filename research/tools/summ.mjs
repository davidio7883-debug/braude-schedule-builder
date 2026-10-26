import fs from 'fs'; import {decodeData} from './decode.mjs';
const d=decodeData(JSON.parse(fs.readFileSync(process.argv[2],'utf8')));const p=d[2];
if(p?.full_courses){console.log('count',p.full_courses.length);console.log(p.full_courses.slice(0,15).map(c=>c.course_id+' '+c.name+' inst='+c.instances.length).join('\n'));} else console.log(JSON.stringify(d).slice(0,500));
