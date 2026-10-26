// Collect the per-cell notes ("מתש א1", "הק. 3", ...) from every cohort's weekly grid (S_GROUP_HOURS).
import fs from 'node:fs'; import path from 'node:path';
import { Firefly } from '../../scraper/firefly.mjs'; import * as P from '../../scraper/parse.mjs';
const ff = new Firefly({ year: 2027, cacheDir: path.resolve('cache'), delayMs: 900, log: () => {} });
const d = JSON.parse(fs.readFileSync('public/data/2027.json', 'utf8'));
const cohorts = [...new Set(d.courses.flatMap(c => c.groups.filter(g => g.sem === '1').map(g => g.cohort)))];
const notes = new Map(); const cells = [];
for (const coh of cohorts) {
  const h = await ff.get('S_GROUP_HOURS', `-N${coh}`);
  for (const m of h.matchAll(/<div class="col">([^<]*)<br>([^<]*)<br>([^<]*?)(\d\d:\d\d)-(\d\d:\d\d)\s+(\d{4,7})\s+([^&<]+)&nbsp;/g)) {
    const [, name, who, room, start, end, id, type] = m.map(x => P.text(x));
    cells.push({ cohort: coh, id: +id, type: type.trim(), start, end, room: room.trim(), who: who.trim() });
  }
}
for (const c of cells) {
  const course = d.courses.find(x => x.id === c.id);
  const lecturers = new Set(course?.groups.flatMap(g => [g.lecturer, ...g.sessions.map(s => s.lecturer)]) ?? []);
  let note = c.who;
  for (const l of [...lecturers].sort((a, b) => b.length - a.length)) if (l && note.startsWith(l)) { note = note.slice(l.length).trim(); break; }
  c.note = note;
  notes.set(note, (notes.get(note) || 0) + 1);
}
fs.writeFileSync('research/samples/cohort_cells_2027A.json', JSON.stringify(cells, null, 1));
console.log('cohorts', cohorts.length, 'cells', cells.length);
console.log([...notes].sort((a, b) => b[1] - a[1]).slice(0, 80).map(([n, k]) => `${k}\t${n || '(none)'}`).join('\n'));
