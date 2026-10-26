import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { courseOptions, groupTypes, semesterSessions, courseInSemester, clashIndexes, allowedGroups, eligibleCourse, toMin, LECTURE, PBL } from '../public/js/model.js';
import { solve } from '../public/js/optimizer.js';

const DATA_FILE = new URL('../public/data/2027.json', import.meta.url);
const data = fs.existsSync(DATA_FILE) ? JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')) : null;
const SEM = '1';

function slotsOf(course, picks) {
  return Object.values(picks).flatMap(iid => {
    const g = course.groups.find(x => x.iid === iid);
    return semesterSessions(g, SEM).map(s => [s.day, toMin(s.start), toMin(s.end), g.typeCode]);
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
      const [d1, s1, e1, t1, c1] = all[i], [d2, s2, e2, t2, c2] = all[j];
      if (c1 === c2 && (t1 === PBL || t2 === PBL)) continue; // PBL may run inside its own lecture
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

test('real data: courses are separated by semester', { skip: !data }, () => {
  const semA = data.semesters.find(s => s.code === '1');
  const semB = data.semesters.find(s => s.code === '2');
  assert.ok(semA?.hasHours, 'semester A has published hours');
  assert.ok(semB, 'semester B is selectable once it has groups');
  // a course taught only in semester B must not be offered in semester A, and vice versa
  const onlyB = data.courses.filter(c => !courseInSemester(c, '1') && courseInSemester(c, '2'));
  assert.ok(onlyB.length > 0);
  for (const c of onlyB) assert.equal(groupTypes(c, '1').length, 0, `${c.id} leaks into semester A`);
  // semester A groups never show semester B sessions on the board
  for (const c of data.courses) for (const g of c.groups) for (const s of semesterSessions(g, '1')) assert.equal(s.sem, '1');
  // while semester B hours are unpublished, its groups exist but have no sessions
  if (!semB.hasHours) assert.ok(data.courses.every(c => c.groups.filter(g => g.sem === '2').every(g => !g.sessions.length)));
});

test('real data: 11003 lecture and tutorial at the same hour is a clash (regression)', { skip: !data }, () => {
  const calc = data.courses.find(c => c.id === 11003);
  const options = courseOptions(calc, SEM);
  // the yedion links every lecture to all 10 tutorials, so some combinations overlap in time
  assert.ok(options.some(o => o.selfOverlap), 'expected overlapping combinations in the real data');

  // the board flags a lecture + tutorial of the same course at the same hour
  const bad = options.find(o => o.selfOverlap);
  const items = bad.slots.map(([day, start, end]) => ({ courseId: 11003, day, start, end }));
  assert.ok(clashIndexes(items).size > 0, 'same-course overlap must be flagged');

  // the optimizer never returns such a combination...
  const out = solve([{ id: 11003, name: calc.name, options }], { mode: 'balanced', topK: 50 });
  assert.ok(out.results.length > 0);
  for (const r of out.results) assertValid([calc], r, {});
  // ...unless the user explicitly allowed overlap for the course
  const loose = solve([{ id: 11003, name: calc.name, options, allowOverlap: true }], { topK: 50 });
  assert.ok(loose.results.length >= out.results.length);

  // a lecture group with 2 weekly sessions contributes both sessions
  const twoSession = calc.groups.find(g => g.typeCode === LECTURE && semesterSessions(g, SEM).length === 2);
  const opt = options.find(o => o.picks[LECTURE] === twoSession.iid && !o.selfOverlap);
  const lectureSlots = semesterSessions(twoSession, SEM).map(s => [s.day, toMin(s.start), toMin(s.end)].join('-'));
  for (const s of lectureSlots) assert.ok(opt.slots.some(x => x.slice(0, 3).join('-') === s), 'both lecture sessions are placed');

  // only tutorials linked to the chosen lecture are offered
  const allowed = allowedGroups(calc, SEM, '9', { [LECTURE]: twoSession.iid }).map(g => g.iid);
  assert.ok(allowed.every(iid => twoSession.links.includes(iid)));
});

test('real data: 51104 PBL may overlap its own lecture, but not other courses', { skip: !data }, () => {
  const course = data.courses.find(c => c.id === 51104);
  const options = courseOptions(course, SEM);
  // PBL groups 1-6 meet inside the Sunday lecture hours; combinations with them are valid
  const nested = options.filter(o => o.slots.some((a, i) => o.slots.some((b, j) => j > i && a[0] === b[0] && a[1] < b[2] && b[1] < a[2])));
  assert.ok(nested.length > 0, 'expected PBL sessions inside the lecture slot');
  assert.ok(nested.every(o => !o.selfOverlap), 'PBL inside its own lecture is not a self-clash');
  const out = solve([{ id: 51104, name: course.name, options }], { topK: 50 });
  assert.equal(out.results.length, options.length, 'every combination is schedulable');

  // board: same-course PBL overlap is not a clash...
  const lecture = { courseId: 51104, typeCode: LECTURE, day: 0, start: 690, end: 830 };
  const pbl = { courseId: 51104, typeCode: PBL, day: 0, start: 690, end: 740 };
  assert.equal(clashIndexes([lecture, pbl]).size, 0);
  // ...but PBL against another course still is
  const other = { courseId: 11003, typeCode: LECTURE, day: 0, start: 700, end: 760 };
  assert.ok(clashIndexes([pbl, other]).has(0));
  // and a regular same-course overlap (lecture + tutorial) remains a clash
  assert.equal(clashIndexes([lecture, { ...pbl, typeCode: '9' }]).size, 2);
});

test('real data: 61903 lecture -> lab -> tutorial on Monday follows the link chain (regression)', { skip: !data }, () => {
  // Official: lecture 2 requires tutorial 2 or 3; tutorial 3 requires lab 2, 4 or 5 (lab 5 = Monday 10:30).
  const course = data.courses.find(c => c.id === 61903);
  const g = (type, sub) => course.groups.find(x => x.sem === SEM && x.typeCode === type && x.sub === sub);
  const lecture2 = g('1', '2'), lab5 = g('8', '5'), tut3 = g('9', '3');
  assert.deepEqual(new Set(lecture2.links), new Set([g('9', '2').iid, tut3.iid]), 'lecture 2 links tutorials, not labs');
  assert.ok(tut3.links.includes(lab5.iid), 'tutorial 3 links lab 5');

  const picks = { 1: lecture2.iid, 9: tut3.iid };
  assert.ok(allowedGroups(course, SEM, '8', picks).some(x => x.iid === lab5.iid), 'Monday lab is allowed');
  const monday = courseOptions(course, SEM).find(o => o.picks[1] === lecture2.iid && o.picks[9] === tut3.iid && o.picks[8] === lab5.iid);
  assert.ok(monday, 'the all-Monday combination is a valid option');
  assert.ok(monday.slots.every(s => s[0] === 1) && !monday.selfOverlap, 'all on Monday, back to back without clash');
  // every option respects every link in the chain
  for (const o of courseOptions(course, SEM)) {
    const picked = Object.values(o.picks).map(iid => course.groups.find(x => x.iid === iid));
    for (const p of picked) for (const q of picked) {
      if (p !== q && course.groups.some(x => x.typeCode === q.typeCode && p.links.includes(x.iid))) assert.ok(p.links.includes(q.iid));
    }
  }
});

test('real data: by default only the student\'s own degree groups are offered', { skip: !data }, () => {
  const cohortDegree = new Map(data.degrees.flatMap(d => d.cohorts.map(c => [c.code.slice(0, 6), d.code])));
  const degreeOf = g => cohortDegree.get(g.cohort.slice(0, 6)) ?? null;
  const course = id => data.courses.find(c => c.id === id);
  const lectures = c => groupTypes(c, SEM).find(t => t.code === LECTURE).groups;

  // 61761 is scheduled for software (271060...) and information systems (271070...): each sees its own lecture
  const sw = eligibleCourse(course(61761), SEM, { degree: '6', degreeOf });
  const is = eligibleCourse(course(61761), SEM, { degree: '7', degreeOf });
  assert.deepEqual(lectures(sw).map(g => g.cohort.slice(0, 6)), ['271060']);
  assert.deepEqual(lectures(is).map(g => g.cohort.slice(0, 6)), ['271070']);
  // tutorials linked from the own lecture stay available (official linkage), others are not invented
  const swLecture = lectures(sw)[0];
  for (const g of groupTypes(sw, SEM).find(t => t.code === '9').groups) assert.ok(degreeOf(g) === '6' || swLecture.links.includes(g.iid));
  assert.ok(courseOptions(sw, SEM).length < courseOptions(course(61761), SEM).length);

  // the global / per-course toggle brings other degrees' groups back
  assert.equal(lectures(eligibleCourse(course(61761), SEM, { degree: '6', degreeOf, showOther: true })).length, 2);

  // service courses (shared cohort) have no dedicated group: everything stays, flagged
  const skills = eligibleCourse(course(251961), SEM, { degree: '5', degreeOf });
  assert.ok(skills.noDedicated.length > 0);
  assert.equal(groupTypes(skills, SEM)[0].groups.length, groupTypes(course(251961), SEM)[0].groups.length);
  // ...and the student can mark the groups the official system does not offer them
  const all = groupTypes(course(251961), SEM)[0].groups;
  const onlyMine = eligibleCourse(course(251961), SEM, { degree: '5', degreeOf, hidden: all.slice(1).map(g => g.iid) });
  assert.deepEqual(groupTypes(onlyMine, SEM)[0].groups.map(g => g.iid), [all[0].iid]);
  assert.equal(courseOptions(onlyMine, SEM).length, 1);
});
