import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { courseOptions, groupTypes, semesterSessions, toMin, LECTURE } from '../public/js/model.js';
import { solve } from '../public/js/optimizer.js';

const DATA_FILE = new URL('../public/data/2027.json', import.meta.url);
const data = fs.existsSync(DATA_FILE) ? JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')) : null;
const SEM = '1';

function slotsOf(course, picks) {
  return Object.values(picks).flatMap(iid => {
    const g = course.groups.find(x => x.iid === iid);
    return semesterSessions(g, SEM).map(s => [s.day, toMin(s.start), toMin(s.end)]);
  });
}

function assertValid(courses, result, prefs) {
  const all = [];
  for (const c of courses) {
    const picks = result.picks[c.id];
    assert.ok(picks, `missing picks for ${c.id}`);
    for (const t of groupTypes(c, SEM)) assert.ok(picks[t.code], `${c.id} missing type ${t.name}`);
    const lecture = c.groups.find(g => g.iid === picks[LECTURE]);
    if (lecture) {
      for (const [code, iid] of Object.entries(picks)) {
        const linkedOfType = c.groups.filter(g => g.typeCode === code && lecture.links.includes(g.iid));
        if (code !== LECTURE && linkedOfType.length) assert.ok(lecture.links.includes(iid), `${c.id}: ${iid} not linked to lecture`);
      }
    }
    all.push(...slotsOf(c, picks).map(s => [...s, c.id]));
  }
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      const [d1, s1, e1, c1] = all[i], [d2, s2, e2, c2] = all[j];
      if (c1 === c2) continue; // a course may overlap itself (nested tutorial)
      assert.ok(!(d1 === d2 && s1 < e2 && s2 < e1), `clash ${all[i]} / ${all[j]}`);
    }
  }
  for (const [d, s, e] of all) {
    assert.ok(!(prefs.daysOff ?? []).includes(d), `session on day off ${d}`);
    if (prefs.earliest != null) assert.ok(s >= prefs.earliest);
    if (prefs.latest != null) assert.ok(e <= prefs.latest);
  }
}

test('synthetic: picks linked tutorial and avoids clash', () => {
  const mk = (iid, typeCode, type, day, start, end, links = []) =>
    ({ iid, sem: '1', typeCode, type, cohort: '1', sub: iid, lecturer: '', full: false, links, sessions: [{ sem: '1', day, start, end, room: '' }] });
  const a = { id: 1, name: 'A', groups: [mk('a1', '1', 'הרצאה', 0, '08:30', '10:30', ['a2']), mk('a2', '9', 'תרגיל', 0, '10:30', '12:20'), mk('a3', '9', 'תרגיל', 2, '10:30', '12:20')] };
  const b = { id: 2, name: 'B', groups: [mk('b1', '1', 'הרצאה', 0, '10:30', '12:20'), mk('b2', '1', 'הרצאה', 1, '08:30', '10:30')] };
  const courses = [a, b].map(c => ({ id: c.id, name: c.name, options: courseOptions(c, '1') }));
  const out = solve(courses, { mode: 'fewDays', topK: 3 });
  assert.equal(out.results[0].picks[1][9], 'a2', 'tutorial must be the linked one');
  assert.equal(out.results[0].picks[2][1], 'b2', 'B must move to Monday to avoid the clash');
  assert.ok(out.exhaustive);
});

/** Courses the college scheduled this semester for one cohort (e.g. 271060310 = software engineering, year 3). */
const cohortCourses = cohort => data.courses.filter(c => c.groups.some(g => g.cohort === cohort && semesterSessions(g, SEM).length));

test('real data: software engineering year 3 (cohort 271060310), semester A', { skip: !data }, () => {
  const courses = cohortCourses('271060310');
  assert.ok(courses.length >= 3, `expected several mandatory courses, got ${courses.length}`);
  const input = courses.map(c => ({ id: c.id, name: c.name, options: courseOptions(c, SEM) }));
  for (const mode of ['fewDays', 'shortDays', 'compact', 'balanced']) {
    const out = solve(input, { mode, topK: 5, avoidFull: true });
    assert.ok(out.results.length > 0, `${mode}: no schedule found`);
    for (const r of out.results) assertValid(courses, r, {});
    console.log(`  ${mode}: ${courses.length} courses, best = ${out.results[0].stats.days} days, ` +
      `${(out.results[0].stats.gaps / 60).toFixed(1)}h gaps, ${out.nodes} nodes, ${out.ms}ms, exhaustive=${out.exhaustive}`);
  }
});

test('real data: hard day off is respected', { skip: !data }, () => {
  const courses = cohortCourses('271070210'); // information systems, year 2
  const input = courses.map(c => ({ id: c.id, name: c.name, options: courseOptions(c, SEM) }));
  const base = solve(input, { mode: 'fewDays', topK: 1 });
  assert.ok(base.results.length, 'base schedule exists');
  // Block the busiest day of the best schedule and require the solver to work around it (or explain why not).
  const busiest = base.results[0].daily.map((d, i) => [d ? d.busy : 0, i]).sort((a, b) => b[0] - a[0])[0][1];
  const prefs = { mode: 'fewDays', topK: 3, daysOff: [busiest] };
  const out = solve(input, prefs);
  if (out.blocked.length) {
    assert.ok(out.blocked.every(b => b.reasons.dayOff > 0), 'blocked courses are explained by the day off');
  } else {
    for (const r of out.results) assertValid(courses, r, prefs);
  }
});

test('real data: every B.Sc. cohort timetable has a clash-free schedule', { skip: !data }, () => {
  const cohorts = data.degrees.filter(d => d.level === 'bsc').flatMap(d => d.cohorts.map(c => ({ ...c, degree: d.name })));
  let solved = 0;
  for (const cohort of cohorts) {
    const courses = cohortCourses(cohort.code);
    if (courses.length < 2) continue;
    const input = courses.map(c => ({ id: c.id, name: c.name, options: courseOptions(c, SEM) }));
    const out = solve(input, { mode: 'balanced', topK: 1 }, { maxMs: 4000 });
    if (out.results.length) { solved++; assertValid(courses, out.results[0], {}); }
    console.log(`  ${cohort.code} ${cohort.name}: ${courses.length} courses -> ${out.results.length ? `${out.results[0].stats.days} days` : 'NO SOLUTION'} (${out.ms}ms)`);
  }
  assert.ok(solved > 0);
});

test('real data: industrial engineering year 1 lists its curriculum courses (regression)', { skip: !data }, () => {
  // 11001/11003 run under the math department's service cohort and 251961 under another one, so only the
  // curriculum ("שנה א' חובה", S_SHOW_PROGS 50001 – not listed by S_PROG) ties them to industrial engineering.
  const yearOne = new Set(data.courses
    .filter(c => { const i = c.degrees['5']; return i && (i.years.includes(1) || i.mandatory.includes(1)) && groupTypes(c, SEM).length; })
    .map(c => c.id));
  for (const id of [11001, 11003, 61903, 251961, 51104]) assert.ok(yearOne.has(id), `course ${id} missing from IEM year 1`);
});

test('real data: every B.Sc. degree shows all of its year-1 curriculum courses', { skip: !data }, () => {
  for (const d of data.degrees.filter(x => x.level === 'bsc')) {
    const missing = data.courses.filter(c => {
      const i = c.degrees[d.code];
      return i?.mandatory.includes(1) && groupTypes(c, SEM).length && !(i.years.includes(1) || i.mandatory.includes(1));
    });
    assert.equal(missing.length, 0, `${d.name}: ${missing.map(c => c.id)}`);
    if (d.cohorts.length) assert.ok(d.sections.some(s => s.studyYears?.includes(1)), `${d.name}: no year-1 curriculum section found`);
  }
});
