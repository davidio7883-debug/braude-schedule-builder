// Firefly (Michlol yedion) client with cookie jar. usage: node ff.mjs <outfile> <year|-> PRGNAME ARGUMENTS [field=value ...]
import fs from 'fs';
const U='https://info.braude.ac.il/yedion/fireflyweb.aspx'; let jar={};
const ck=()=>Object.entries(jar).map(([k,v])=>k+'='+v).join('; ');
const save=r=>{for(const c of r.headers.getSetCookie?.()||[]){const [kv]=c.split(';');const i=kv.indexOf('=');jar[kv.slice(0,i)]=kv.slice(i+1);}};
export async function post(fields){const r=await fetch(U,{method:'POST',redirect:'manual',headers:{'user-agent':'Mozilla/5.0 (research; braude-schedule)','content-type':'application/x-www-form-urlencoded',cookie:ck()},body:new URLSearchParams(fields)});save(r);
 let t=await r.text(); if(r.status>=300&&r.status<400){const l=r.headers.get('location');const r2=await fetch(new URL(l,U),{headers:{cookie:ck()}});save(r2);t=await r2.text();} return t;}
export async function get(q){const r=await fetch(U+'?'+q,{headers:{'user-agent':'Mozilla/5.0',cookie:ck()}});save(r);return r.text();}
export async function setYear(y){await get('prgname=Enter_Search');return post({PRGNAME:'Enter_Search',ARGUMENTS:'-A,,-A,ChangeYear',ChangeYear:String(y)});}
if(process.argv[1]?.endsWith('ff.mjs')&&process.argv[2]){const [,,out,year,P,A,...kv]=process.argv;
 if(year!=='-')await setYear(year); else await get('prgname=Enter_Search');
 const f={PRGNAME:P,ARGUMENTS:A};for(const x of kv){const i=x.indexOf('=');f[x.slice(0,i)]=x.slice(i+1);}
 const t=await post(f);fs.writeFileSync(out,t);console.error('len',t.length,'cookies',Object.keys(jar).join(','));}
