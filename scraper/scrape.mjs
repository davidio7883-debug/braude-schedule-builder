// Builds public/data/<year>.json from Braude's public yedion (braude.top is used as a fallback).
// Usage: node scraper/scrape.mjs [--year 2027] [--delay 1000] [--fresh] [--limit 20]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Firefly } from './firefly.mjs';
import * as P from './parse.mjs';
import * as braudeTop from './braudetop.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const arg = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i < 0 ? def : args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true;
};

const YEAR = Number(arg('year', 2027));
const LIMIT = Number(arg('limit', 0)) || Infinity;
const ff = new Firefly({
  year: YEAR,
  cacheDir: path.join(ROOT, 'cache'),
  delayMs: Number(arg('delay', 1000)),
  fresh: Boolean(arg('fresh', false)),
});
const log = (...a) => console.log(`[${new Date().toLocaleTimeString('he-IL')}]`, ...a);
const SEMESTERS = [{ code: '1', name: 'א' }, { code: '2', name: 'ב' }, { code: '3', name: 'קיץ' }];
const HEB_YEAR = { 'א': 1, 'ב': 2, 'ג': 3, 'ד': 4 };

function cohortStudyYear(code, name = '') {
  const m = name.match(/(?:^|\s)(?:שנה\s*)?([אבגד])['׳]?(?=\d|\s|$|-|\+)/);
  if (m) return HEB_YEAR[m[1]];
  const d = Number(code[6]);
  return d >= 1 && d <= 4 ? d : d > 4 ? 4 : null;
}

/** Curriculum section names vary: "תוכנה שנה ב חובה", "ביוטכנולוגיה א' (חובה)", "חובה ג+ד", "הנדסת חשמל ואלק' שנה א'"... */
function sectionInfo(name) {
  const studyYears = [];
  for (const m of name.matchAll(/(?:^|[\s(\-])(?:שנה\s*)?([אבגד])(?:['׳]|(?=[\s+)]|$))(?:\s*\+\s*([אבגד]))?/g)) {
    studyYears.push(HEB_YEAR[m[1]]);
    if (m[2]) studyYears.push(HEB_YEAR[m[2]]);
  }
  const elective = /בחירה|אשכול|העשרה|יזמות|ספורט|מיומנויות/.test(name);
  return { kind: !elective && (/חובה/.test(name) || studyYears.length) ? 'mandatory' : 'elective', studyYears };
}

async function main() {
  log(`סורק את שנת ${YEAR} מתוך הידיעון של בראודה (השהיה ${ff.delayMs}ms בין בקשות)`);

  // 1. Degrees (מגמות) and the course-name letters, from the search home.
  const home = await ff.home();
  const degreeOpts = new Map();
  for (const o of [...P.selectOptions(home, 'R1C8'), ...P.selectOptions(home, 'R1C9')]) {
    if (!degreeOpts.has(o.value)) degreeOpts.set(o.value, o.label);
  }
  const degrees = [...degreeOpts].map(([code, label]) => {
    const m = label.match(/^(.*?)\s*\(([^)]*)\)\s*$/);
    const name = (m ? m[1] : label).trim();
    const level = m?.[2]?.includes('שני') ? 'msc' : m?.[2]?.includes('ראשון') ? 'bsc' : 'other';
    return { code, name, level, cohorts: [], sections: [] };
  });
  const letters = P.selectOptions(home, 'R1C2').map(o => o.value);
  log(`${degrees.length} מגמות, ${letters.length} אותיות`);

  // 2. Catalog: every course offered this year (by first letter) + every course that has sessions.
  const catalog = new Map();
  for (const letter of letters) {
    for (const c of P.courseList(await ff.post('S_LOOK_FOR_NOSE_AB', { R1C2: letter }))) {
      if (c.offered) catalog.set(c.id, { id: c.id, name: c.name });
    }
  }
  for (const sem of SEMESTERS) {
    const html = await ff.post('S_YFineDate', { R1C7: sem.code, R1C5: '7', R1C6: '1' });
    for (const r of P.timetableRows(html)) if (!catalog.has(r.id)) catalog.set(r.id, { id: r.id, name: r.name });
  }
  log(`${catalog.size} קורסים נלמדים בשנה זו`);

  // 3. Degree cohorts (S_GROUP) and curriculum sections (S_PROG -> S_SHOW_PROGS).
  const cohortDegree = new Map();
  const curriculum = new Map(); // courseId -> [{degree, section}]
  for (const d of degrees) {
    d.cohorts = P.cohorts(await ff.post('S_GROUP', { R1C8: d.code }))
      .map(c => ({ ...c, studyYear: cohortStudyYear(c.code, c.name) }));
    // Group codes are YY L DDD Y TT (year, level, degree, study year, track); the 6-digit prefix identifies the degree.
    for (const c of d.cohorts) if (!cohortDegree.has(c.code.slice(0, 6))) cohortDegree.set(c.code.slice(0, 6), d.code);

    const sections = P.programSections(await ff.post('S_PROG', { HUG: d.code, R1C1: String(YEAR - 1), R1C2: '' }));
    if (d.level === 'bsc' && !sections.some(s => sectionInfo(s.name).studyYears.length)) {
      sections.push(...await findHiddenYearSections(d.code, String(YEAR - 1)));
    }
    for (const s of sections) {
      const info = sectionInfo(s.name);
      const list = s.list ?? P.courseList(await ff.get('S_SHOW_PROGS', `-N${s.startYear},-N${s.code}`));
      d.sections.push({ code: s.code, name: s.name, ...info, courses: list.length });
      for (const c of list) {
        if (!curriculum.has(c.id)) curriculum.set(c.id, []);
        curriculum.get(c.id).push({ degree: d.code, section: s.code, ...info });
      }
    }
    log(`מגמה ${d.code} ${d.name}: ${d.cohorts.length} קבוצות לימוד, ${d.sections.length} חלקי תוכנית`);
  }

  // 4. Per-course detail: groups, sessions, rooms, linked groups, description.
  const courses = [];
  let i = 0, fallbacks = 0, failures = [];
  const ids = [...catalog.keys()].slice(0, LIMIT);
  for (const id of ids) {
    i++;
    if (i % 25 === 0) log(`  קורסים: ${i}/${ids.length} (חי: ${ff.stats.live}, מטמון: ${ff.stats.cached})`);
    let detail;
    try {
      detail = P.courseGroups(await ff.get('S_LOOK_FOR_NOSE', `-N${id}`));
    } catch (err) {
      detail = { groups: [] };
      failures.push(`${id}: ${err.message}`);
    }
    if (!detail.groups.length) {
      const bt = await braudeTop.fetchCourse(id, YEAR).catch(() => null);
      if (bt?.groups.length) { detail = { ...bt, description: detail.description || bt.description }; fallbacks++; }
    }
    courses.push(buildCourse(id, catalog.get(id).name, detail, cohortDegree, curriculum.get(id) || []));
  }

  // 5. Output.
  // A semester is listed once it has groups; hasHours tells whether the college has published its timetable yet
  // (e.g. semester ב 2027 had groups but no hours in October 2026).
  const inSem = (c, code) => c.groups.some(g => g.sem === code || g.sessions.some(x => x.sem === code));
  const semesters = SEMESTERS.filter(s => courses.some(c => inSem(c, s.code))).map(s => ({
    ...s,
    courses: courses.filter(c => inSem(c, s.code)).length,
    hasHours: courses.some(c => c.groups.some(g => g.sessions.some(x => x.sem === s.code))),
  }));
  const out = {
    year: YEAR,
    hebrewYear: P.selectOptions(home, 'ChangeYear').find(o => o.value === String(YEAR))?.label.split('-')[1]?.trim() ?? '',
    generatedAt: new Date().toISOString(),
    source: 'https://info.braude.ac.il/yedion/fireflyweb.aspx',
    semesters,
    degrees: degrees.filter(d => d.cohorts.length || d.sections.length),
    courses,
  };
  const dataDir = path.join(ROOT, 'public', 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(path.join(dataDir, `${YEAR}.json`), JSON.stringify(out));
  updateIndex(dataDir, out);

  log(`סיום: ${courses.length} קורסים, ${courses.reduce((n, c) => n + c.groups.length, 0)} קבוצות, ` +
    `סמסטרים: ${semesters.map(s => `${s.name} (${s.courses})`).join(', ')}`);
  log(`בקשות חיות: ${ff.stats.live}, מהמטמון: ${ff.stats.cached}, גיבוי מ-braude.top: ${fallbacks}`);
  if (failures.length) log(`שגיאות (${failures.length}):\n  ${failures.join('\n  ')}`);
}

/**
 * Some degrees' per-year mandatory sections exist but are not listed by S_PROG (e.g. industrial engineering:
 * "שנה א' חובה" is S_SHOW_PROGS 50001, while S_PROG only returns two elective clusters). Known codes elsewhere
 * look like <degree>000<n> (30001, 40000, 50001) or <degree>00<n> (2005), so probe those shapes.
 */
async function findHiddenYearSections(degree, startYear) {
  const found = [];
  const candidates = [];
  for (let n = 0; n <= 9; n++) candidates.push(`${degree}000${n}`, `${degree}00${n}`);
  for (const code of [...new Set(candidates)]) {
    const html = await ff.get('S_SHOW_PROGS', `-N${startYear},-N${code}`);
    const list = P.courseList(html);
    const name = html.match(/לפי התחום המבוקש\s*:\s*([^,<]+)/)?.[1]?.trim();
    if (list.length && name && sectionInfo(name).studyYears.length) found.push({ name, startYear, code, list });
  }
  if (found.length) log(`  נמצאו ${found.length} חלקי תוכנית חובה שאינם מופיעים ברשימת המסלול (${found.map(s => s.code).join(', ')})`);
  return found;
}

function buildCourse(id, catalogName, detail, cohortDegree, curriculumEntries) {
  const groups = detail.groups.map(g => ({
    iid: g.iid, sem: g.sem, typeCode: g.typeCode, type: g.type || 'אחר',
    cohort: g.cohort, sub: g.sub, lecturer: g.lecturer, lang: g.lang, full: g.full,
    links: g.linkedIds ?? [], linkedTo: g.linkedTo ?? [],
    sessions: g.sessions.map(({ sem, day, start, end, room, lecturer }) => ({ sem, day, start, end, room, lecturer })),
  }));
  // Resolve "קבוצות הקשורות" (cohort/sub pairs) into instance ids of the same course & semester.
  for (const g of groups) {
    if (!g.linkedTo.length) continue;
    g.links = groups
      .filter(o => o !== g && o.sem === g.sem && o.typeCode !== g.typeCode &&
        g.linkedTo.some(l => l.cohort === o.cohort && l.sub === o.sub))
      .map(o => o.iid);
  }
  groups.forEach(g => delete g.linkedTo);

  const degrees = {};
  const add = (d, key, value) => {
    degrees[d] ??= { years: [], mandatory: [], sections: [] };
    if (value != null && !degrees[d][key].includes(value)) degrees[d][key].push(value);
  };
  for (const g of groups) {
    const d = cohortDegree.get(g.cohort.slice(0, 6));
    if (d) add(d, 'years', cohortStudyYear(g.cohort));
  }
  for (const e of curriculumEntries) {
    add(e.degree, 'sections', e.section);
    if (e.kind === 'mandatory') {
      degrees[e.degree].core = true;
      for (const y of e.studyYears) add(e.degree, 'mandatory', y);
    }
  }
  // years: study years whose cohort timetable includes the course this year (what students actually take now).
  // mandatory: study years in which the curriculum (catalog of last year) lists it as mandatory; core: mandatory at all.
  for (const d of Object.values(degrees)) { d.years.sort(); d.mandatory.sort(); d.core ??= false; }

  return {
    id: Number(id),
    name: detail.name || catalogName,
    credits: detail.credits ?? null,
    hoursLine: detail.hoursLine || '',
    description: detail.description || '',
    syllabus: `https://info.braude.ac.il/info/${YEAR}/${String(id).padStart(7, '0')}.pdf`,
    degrees,
    groups,
  };
}

function updateIndex(dataDir, out) {
  const file = path.join(dataDir, 'index.json');
  const index = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { years: [] };
  index.years = index.years.filter(y => y.year !== out.year);
  index.years.push({ year: out.year, hebrewYear: out.hebrewYear, file: `${out.year}.json`, semesters: out.semesters, generatedAt: out.generatedAt });
  index.years.sort((a, b) => b.year - a.year);
  index.default = { year: 2027, semester: '1' };
  fs.writeFileSync(file, JSON.stringify(index, null, 2));
}

main().catch(err => { console.error(err); process.exit(1); });
