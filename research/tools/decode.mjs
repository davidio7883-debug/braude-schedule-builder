// Decode SvelteKit __data.json (devalue flattened format) -> plain JSON
import fs from 'fs';
export function unflatten(values){const h=new Array(values.length);const hy=i=>{if(i===-1)return undefined;if(i===-3)return NaN;if(i===-4)return Infinity;if(i===-5)return -Infinity;if(i===-6)return -0;if(i in h)return h[i];const v=values[i];if(!v||typeof v!=='object'){h[i]=v;return v;}
 if(Array.isArray(v)){if(typeof v[0]==='string'){const t=v[0];if(t==='Date'){return h[i]=new Date(v[1]).toISOString();}if(t==='Set'){const s=[];h[i]=s;for(let k=1;k<v.length;k++)s.push(hy(v[k]));return s;}if(t==='Map'){const m={};h[i]=m;for(let k=1;k<v.length;k+=2)m[hy(v[k])]=hy(v[k+1]);return m;}if(t==='null'){const o=Object.create(null);h[i]=o;for(let k=1;k<v.length;k+=2)o[v[k]]=hy(v[k+1]);return o;}return h[i]=v; }
  const a=new Array(v.length);h[i]=a;for(let k=0;k<v.length;k++){a[k]=v[k]===-2?undefined:hy(v[k]);}return a;}
 const o={};h[i]=o;for(const k in v)o[k]=hy(v[k]);return o;};return hy(0);}
export function decodeData(json){return json.nodes.map(n=>n&&n.type==='data'?unflatten(n.data):n);}
if(process.argv[2]){const j=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));const d=decodeData(j);const out=process.argv[3];const s=JSON.stringify(d,null,1);if(out)fs.writeFileSync(out,s);else console.log(s.slice(0,6000));}
