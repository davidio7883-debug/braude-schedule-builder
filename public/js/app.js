import { state, save, plan } from './store.js';
import {
  DAY_NAMES, DAY_LETTERS, LECTURE, toMin, fmtMin, fmtHours, range, semesterGroups, semesterSessions, courseInSemester,
  groupTypes, allowedGroups, courseOptions, clashIndexes, scheduleStats, eligibleCourse,
} from './model.js';
import { MODES } from './optimizer.js';
import { renderBoard } from './board.js';
import { esc, $, hueOf, toast, debounce, openOfficial, PALETTE, luminance } from './util.js';

let INDEX = null;     // data/index.json
let DATA = null;      // data/<year>.json
let COURSES = new Map();
let DEGREES = new Map();
let COHORT_DEGREE = new Map(); // 6-digit cohort prefix -> degree code
let activeCourse = null;     // course being edited on the board
let preview = null;          // { index, picks } auto-builder result previewed on the board
let auto = null;             // last auto-builder output
let autoRunning = false;
let modalCourse = null, modalTab = 'info';
let pane = 'panel';
let degreeFirstRun = false;
let sharedOpened = false;
let colorMenuFor = null; // course whose color palette is open
let rooms = { day: new Date().getDay() < 6 ? new Date().getDay() : 0, from: 600, to: 720, q: '' };

const STUDY_YEARS = ['', 'א', 'ב', 'ג', 'ד'];
const TIME_OPTIONS = ['08:30', '09:30', '10:30', '11:30', '12:20', '12:50', '13:50', '14:50', '15:50', '16:50', '17:50', '18:50', '19:50', '20:50', '21:50'];

// ---------------------------------------------------------------- data

async function loadIndex() {
  const res = await fetch('data/index.json', { cache: 'no-cache' });
  if (!res.ok) throw new Error('לא נמצאו נתונים. הריצו קודם: npm run scrape');
  INDEX = await res.json();
}

async function loadYear(year) {
  const entry = INDEX.years.find(y => y.year === year) ?? INDEX.years[0];
  const res = await fetch(`data/${entry.file}`, { cache: 'no-cache' });
  DATA = await res.json();
  COURSES = new Map(DATA.courses.map(c => [c.id, c]));
  DEGREES = new Map(DATA.degrees.map(d => [d.code, d]));
  COHORT_DEGREE = new Map(DATA.degrees.flatMap(d => d.cohorts.map(c => [c.code.slice(0, 6), d.code])));
  state.year = DATA.year;
  if (!DATA.semesters.some(s => s.code === state.sem)) state.sem = DATA.semesters[0]?.code ?? '1';
}

const sem = () => state.sem;
const semName = code => ({ 1: 'א', 2: 'ב', 3: 'קיץ' })[code] ?? code;
const degreeName = code => {
  const d = DEGREES.get(code);
  return d ? `${d.name}${d.level === 'msc' ? ' (תואר שני)' : ''}` : '';
};

// ---------------------------------------------------------------- plan helpers

function picksOf(courseId) {
  return (preview ? preview.picks[courseId] : plan().picks[courseId]) ?? {};
}

/** Course color: the student's choice, else a stable hue per course. */
const courseColor = id => state.courseColors[id] || `hsl(${Math.round(hueOf(id))} 62% 46%)`;

/** CSS vars for a course color; very light custom colors get darker text so it stays readable. */
function colorVars(id) {
  const custom = state.courseColors[id];
  const textMix = custom && luminance(custom) > 0.45 ? 22 : 42;
  return `--c:${courseColor(id)};--tm:${textMix}%`;
}

function colorButton(id) {
  return `<button class="color-dot" style="${colorVars(id)}" data-action="color-menu" data-course="${id}" title="צבע הקורס" aria-label="בחירת צבע לקורס"></button>`;
}

function colorMenu(id) {
  if (colorMenuFor !== id) return '';
  const current = state.courseColors[id];
  return `<div class="color-menu" role="group" aria-label="צבע הקורס">
    ${PALETTE.map(c => `<button class="swatch ${current === c ? 'on' : ''}" style="--c:${c}" data-action="set-color" data-course="${id}" data-color="${c}" aria-label="${c}"></button>`).join('')}
    <label class="swatch custom" title="צבע אחר"><input type="color" data-action="custom-color" data-course="${id}" value="${current || '#2563eb'}" aria-label="צבע אחר"/></label>
    <button class="linkish" data-action="set-color" data-course="${id}" data-color="">ברירת מחדל</button>
  </div>`;
}

/** Friday is shown when the student asked for it, or automatically when a session falls on it. */
const showFridayFor = hasFridaySession => (state.showFriday || hasFridaySession ? 6 : 5);

function requiredTypes(course) {
  const excluded = plan().excluded[course.id] ?? [];
  return groupTypes(course, sem()).filter(t => !excluded.includes(t.code));
}

/** Degree a group is scheduled for (from its cohort code), or null for shared/service cohorts. */
const groupDegree = g => COHORT_DEGREE.get(g.cohort.slice(0, 6)) ?? null;

const showsOtherDegrees = courseId => !state.degree || state.showOtherDegrees || !!state.otherDegreeCourses[courseId];

/** The groups this student can register to (see model.eligibleCourse). */
function eligible(course) {
  return eligibleCourse(course, sem(), {
    degree: state.degree, degreeOf: groupDegree, showOther: showsOtherDegrees(course.id), hidden: plan().hidden[course.id],
  });
}

function placedItems() {
  const items = [];
  for (const id of plan().courses) {
    const course = COURSES.get(id);
    if (!course) continue;
    const picks = picksOf(id);
    for (const t of requiredTypes(course)) {
      const g = course.groups.find(x => x.iid === picks[t.code]);
      if (!g) continue;
      for (const s of semesterSessions(g, sem())) {
        items.push({
          courseId: id, iid: g.iid, day: s.day, start: toMin(s.start), end: toMin(s.end),
          title: course.name, type: g.type, group: g.sub ? `קב׳ ${g.sub}` : '', room: s.room, lecturer: s.lecturer || g.lecturer,
          full: g.full, color: courseColor(id), tm: colorVars(id).split('--tm:')[1], active: activeCourse === id, preview: !!preview, action: 'block',
          overlapOk: !!plan().overlap[id], typeCode: g.typeCode,
        });
      }
    }
  }
  const clashes = clashIndexes(items);
  items.forEach((it, i) => (it.clash = clashes.has(i)));
  // PBL inside its own course's lecture hours is allowed: show a quiet note instead of a clash
  for (const a of items) {
    a.pblOk = items.some(b => b !== a && b.courseId === a.courseId && b.day === a.day && a.start < b.end && b.start < a.end &&
      (a.typeCode === '21' || b.typeCode === '21'));
  }
  return items;
}

function ghostItems() {
  if (!activeCourse || preview) return [];
  if (!COURSES.get(activeCourse)) return [];
  const course = eligible(COURSES.get(activeCourse));
  const picks = plan().picks[course.id] ?? {};
  const ghosts = [];
  for (const t of requiredTypes(course)) {
    const allowed = new Set(allowedGroups(course, sem(), t.code, picks).map(g => g.iid));
    for (const g of t.groups) {
      if (g.iid === picks[t.code]) continue;
      for (const s of semesterSessions(g, sem())) {
        ghosts.push({
          courseId: course.id, iid: g.iid, day: s.day, start: toMin(s.start), end: toMin(s.end),
          title: course.name, type: g.type, group: g.sub ? `קב׳ ${g.sub}` : '', room: s.room, lecturer: s.lecturer || g.lecturer,
          full: g.full, color: courseColor(course.id), tm: colorVars(course.id).split('--tm:')[1], disabled: !allowed.has(g.iid), action: allowed.has(g.iid) ? 'ghost' : '',
        });
      }
    }
  }
  return ghosts;
}

/** Sets a group for a course and keeps the other picks consistent with the link chain (lecture → tutorial → lab). */
function setPick(courseId, iid) {
  const g = COURSES.get(courseId).groups.find(x => x.iid === iid);
  const course = eligible(COURSES.get(courseId));
  const picks = (plan().picks[courseId] ??= {});
  picks[g.typeCode] = iid;
  for (let pass = 0; pass < 2; pass++) {
    for (const t of groupTypes(course, sem())) {
      if (t.code === g.typeCode || !picks[t.code]) continue;
      const allowed = allowedGroups(course, sem(), t.code, picks);
      if (!allowed.some(a => a.iid === picks[t.code])) picks[t.code] = bestFit(allowed, courseId)?.iid ?? null;
    }
  }
  save();
}

/** Group that clashes least with what is already on the board. */
function bestFit(groups, excludeCourse) {
  const others = placedItems().filter(i => i.courseId !== excludeCourse);
  let best = null, bestScore = Infinity;
  for (const g of groups) {
    const sessions = semesterSessions(g, sem());
    const clashes = sessions.filter(s => others.some(o => o.day === s.day && toMin(s.start) < o.end && o.start < toMin(s.end))).length;
    const score = clashes * 100 + (g.full ? 10 : 0);
    if (score < bestScore) { best = g; bestScore = score; }
  }
  return best;
}

/** Adds a course and picks the combination that fits the current board best. */
function addCourse(id) {
  const p = plan();
  if (p.courses.includes(id)) return;
  const course = eligible(COURSES.get(id));
  p.courses.push(id);
  const others = placedItems().map(i => [i.day, i.start, i.end]);
  const options = courseOptions(course, sem(), { avoidFull: true });
  let best = null, bestScore = Infinity;
  for (const o of options) {
    const clash = o.slots.some(([d, s, e]) => others.some(([od, os, oe]) => od === d && s < oe && os < e));
    const st = scheduleStats([...others, ...o.slots]);
    // when other degrees' groups are shown, still prefer the student's own
    const foreign = state.degree ? Object.values(o.picks).filter(iid => {
      const d = groupDegree(course.groups.find(g => g.iid === iid));
      return d && d !== state.degree;
    }).length : 0;
    const score = (clash || o.selfOverlap ? 1e6 : 0) + st.days * 600 + st.gaps + (o.full ? 50 : 0) + foreign * 120;
    if (score < bestScore) { best = o; bestScore = score; }
  }
  p.picks[id] = best ? { ...best.picks } : {};
  save();
  toast(`"${course.name}" נוסף למערכת`);
}

function removeCourse(id) {
  const p = plan();
  const snapshot = JSON.stringify(p);
  p.courses = p.courses.filter(x => x !== id);
  delete p.picks[id]; delete p.excluded[id]; delete p.locked[id];
  if (activeCourse === id) activeCourse = null;
  save();
  toast(`"${COURSES.get(id)?.name}" הוסר`, { label: 'ביטול', run: () => { Object.assign(plan(), JSON.parse(snapshot)); save(); render(); } });
}

// ---------------------------------------------------------------- course filtering

function relevance(course) {
  const info = state.degree ? course.degrees[state.degree] : null;
  if (!info) return null;
  const y = state.studyYear;
  // main list: scheduled for that year's cohort this year, or listed for that year in the curriculum
  const mainHere = y ? info.years.includes(y) || info.mandatory.includes(y) : info.core;
  const inYear = !y || mainHere || (!info.years.length && !info.mandatory.length);
  return { info, mainHere, inYear };
}

function matchesQuery(course, q) {
  if (!q) return true;
  return course.name.includes(q) || String(course.id).startsWith(q) || course.name.toLowerCase().includes(q.toLowerCase());
}

function courseBadges(course) {
  const b = [];
  const r = relevance(course);
  if (r) b.push(degreeTags(r.info));
  const types = groupTypes(course, sem()).map(t => t.name);
  if (types.length) b.push(`<span class="badge">${esc(types.join(' + '))}</span>`);
  const gs = semesterGroups(course, sem());
  if (gs.length && gs.every(g => g.full)) b.push(`<span class="badge full">מלא</span>`);
  if (gs.length && gs.every(g => !g.sessions.some(s => s.sem === sem()))) b.push(`<span class="badge warn">שעות טרם פורסמו</span>`);
  return b.join('');
}

function degreeTags(info) {
  const tags = [];
  if (info.core) tags.push(`<span class="badge must">חובה${info.mandatory.length ? ` · שנה ${info.mandatory.map(y => STUDY_YEARS[y]).join('/')}` : ''}</span>`);
  else tags.push('<span class="badge">בחירה</span>');
  const extra = info.years.filter(y => !info.mandatory.includes(y));
  if (extra.length) tags.push(`<span class="badge" title="הקורס משובץ השנה במערכת של קבוצת שנה זו">במערכת שנה ${extra.map(y => STUDY_YEARS[y]).join('/')}</span>`);
  return tags.join('');
}

function courseCard(course) {
  const selected = plan().courses.includes(course.id);
  return `<div class="course-card ${selected ? 'selected' : ''}">
    <div class="course-name" data-action="details" data-course="${course.id}">${esc(course.name)}</div>
    <div class="course-meta"><span>${course.id}</span>${course.credits ? `<span>· ${course.credits} נ״ז</span>` : ''}${courseBadges(course)}</div>
    <div class="course-actions">
      <button class="add-btn ${selected ? 'on' : ''}" data-action="${selected ? 'remove' : 'add'}" data-course="${course.id}"
        title="${selected ? 'הסרה מהמערכת' : 'הוספה למערכת'}" aria-label="${selected ? 'הסרה' : 'הוספה'}">${selected ? '✓' : '+'}</button>
    </div>
  </div>`;
}

// ---------------------------------------------------------------- panel: courses

function renderCoursesTab() {
  const q = state.query.trim();
  const inSem = DATA.courses.filter(c => courseInSemester(c, sem()));
  let html = `<div class="filters">
    <div class="search">
      <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
      <input id="q" class="input" type="search" placeholder="חיפוש לפי שם או מספר קורס…" value="${esc(state.query)}" autocomplete="off" />
    </div>`;
  if (state.degree) {
    html += `<div class="chips" role="group" aria-label="שנת לימודים">
      ${STUDY_YEARS.map((y, i) => `<button class="chip ${state.studyYear === i ? 'on' : ''}" data-action="study-year" data-year="${i}">${i ? `שנה ${y}` : 'כל השנים'}</button>`).join('')}
    </div>
    <label class="toggle"><input type="checkbox" data-action="show-all" ${state.showAll ? 'checked' : ''}/> הצג קורסים מכל המגמות</label>
    <label class="toggle" title="כברירת מחדל מוצעות רק הקבוצות שמשובצות לתואר שלך, כמו במערכת הרישום"><input type="checkbox" data-action="other-degrees" ${state.showOtherDegrees ? 'checked' : ''}/> הצג קבוצות של תארים אחרים</label>`;
  }
  html += `</div>`;
  if (!hoursPublished()) html += `<div class="notice warn">המכללה עדיין לא פרסמה שעות לסמסטר ${semName(sem())}. הקבוצות כבר ידועות, אז אפשר לבחור קורסים ולתכנן, והשעות יופיעו אחרי הרצה חוזרת של הסורק.</div>`;

  const sorted = list => list.sort((a, b) => a.name.localeCompare(b.name, 'he'));
  const section = (title, list, note = '') => list.length
    ? `<div class="list-head"><span>${title}</span><span>${list.length}${note}</span></div>${list.slice(0, 250).map(courseCard).join('')}${list.length > 250 ? `<div class="muted">מוצגים 250 ראשונים – צמצמו בחיפוש</div>` : ''}`
    : '';

  if (!state.degree || state.showAll) {
    const list = sorted(inSem.filter(c => matchesQuery(c, q)));
    html += section(`כל הקורסים בסמסטר ${semName(sem())}`, list);
    if (!list.length) html += emptyState('לא נמצאו קורסים', q ? 'נסו מילת חיפוש אחרת' : '');
  } else {
    const mine = [], more = [];
    for (const c of inSem) {
      if (!matchesQuery(c, q)) continue;
      const r = relevance(c);
      if (!r || !r.inYear) continue;
      (r.mainHere ? mine : more).push(c);
    }
    html += section(state.studyYear ? `הקורסים של שנה ${STUDY_YEARS[state.studyYear]}` : 'קורסי חובה במגמה', sorted(mine));
    html += section('קורסי בחירה ונוספים במגמה', sorted(more));
    if (q) {
      const elsewhere = sorted(inSem.filter(c => matchesQuery(c, q) && !mine.includes(c) && !more.includes(c)));
      html += section('תוצאות ממגמות אחרות', elsewhere.slice(0, 40));
    }
    if (!mine.length && !more.length && !q) html += emptyState('אין קורסים להצגה', 'נסו לבחור "כל השנים" או סמסטר אחר');

    // curriculum / cohort courses of this degree+year that run in another semester
    const elsewhereSem = sorted(DATA.courses.filter(c => !courseInSemester(c, sem()) && matchesQuery(c, q) && relevance(c)?.mainHere));
    if (elsewhereSem.length) {
      html += `<details class="off-sem"><summary>לא נלמד בסמסטר זה (${elsewhereSem.length})</summary>${elsewhereSem.map(c => {
        const sems = [...new Set(c.groups.map(g => g.sem))].filter(x => x !== sem()).map(semName);
        return `<div class="off-row"><span class="course-name" data-action="details" data-course="${c.id}">${esc(c.name)}</span><span class="muted">${c.id}${sems.length ? ` · נלמד בסמסטר ${sems.join(', ')}` : ''}</span></div>`;
      }).join('')}</details>`;
    }
  }
  const notInSem = DATA.courses.length - inSem.length;
  if (notInSem) html += `<p class="muted" style="font-size:12.5px;margin-top:14px">${notInSem} קורסים נוספים נלמדים בשנה זו בסמסטרים אחרים או שטרם פורסמו להם שעות.</p>`;
  return html;
}

function dedicatedNote(ec) {
  if (!state.degree || showsOtherDegrees(ec.id) || !ec.noDedicated?.length) return '';
  return `<div class="notice" style="font-size:12.5px;padding:6px 10px">אין קבוצה ייעודית לתואר שלך ב${esc(ec.noDedicated.join(', '))} – מוצגות הקבוצות המשותפות. בדף הקורס אפשר לסמן קבוצות שאינן זמינות לך.</div>`;
}

function hoursPublished() {
  return DATA.semesters.find(s => s.code === sem())?.hasHours !== false;
}

function emptyState(title, sub = '', icon = '🔍') {
  return `<div class="empty"><div class="big">${icon}</div><b>${esc(title)}</b><div>${esc(sub)}</div></div>`;
}

// ---------------------------------------------------------------- panel: my courses

function groupLabel(g) {
  const sessions = semesterSessions(g, sem());
  const when = sessions.length
    ? sessions.map(s => `${DAY_LETTERS[s.day]} ${range(s.start, s.end)}`).join(' | ')
    : 'ללא שעות';
  const d = state.degree && groupDegree(g);
  const other = d && d !== state.degree ? ` · ${DEGREES.get(d)?.name ?? 'תואר אחר'}` : '';
  return `${when} · ${g.lecturer || ''}${g.full ? ' · מלא' : ''}${other}`;
}

function renderMineTab() {
  const p = plan();
  if (!p.courses.length) return emptyState('עוד לא בחרתם קורסים', 'הוסיפו קורסים מהלשונית "קורסים" בעזרת הכפתור +', '📚');
  let credits = 0;
  let html = '';
  for (const id of p.courses) {
    const c = COURSES.get(id);
    if (!c) continue;
    credits += c.credits || 0;
    const picks = p.picks[id] ?? {};
    const excluded = p.excluded[id] ?? [];
    const ec = eligible(c);
    const types = groupTypes(ec, sem());
    html += `<div class="mine-card ${activeCourse === id ? 'active' : ''}" style="${colorVars(id)}">
      <div class="mine-head">
        ${colorButton(id)}
        <div class="course-name" data-action="details" data-course="${id}">${esc(c.name)}</div>
        <button class="icon-btn" data-action="lock" data-course="${id}" title="${p.locked[id] ? 'שחרור נעילה' : 'נעילת הקבוצות שנבחרו (הבנייה האוטומטית לא תשנה אותן)'}">${p.locked[id] ? '🔒' : '🔓'}</button>
        <button class="icon-btn" data-action="edit" data-course="${id}" title="בחירת קבוצות על גבי הלוח">✎</button>
        <button class="icon-btn" data-action="remove" data-course="${id}" title="הסרה">✕</button>
      </div>${colorMenu(id)}
      <div class="course-meta">${id}${c.credits ? ` · ${c.credits} נ״ז` : ''}
        <button class="linkish" data-action="overlap" data-course="${id}" title="למשל מעבדה שמתקיימת אחת לשבועיים – הקורס לא ייחשב כמתנגש">${p.overlap[id] ? '✓ מותר לחפוף לקורסים אחרים' : 'לאפשר חפיפה (מעבדה דו-שבועית)'}</button></div>`;
    if (!types.length) html += `<div class="notice warn">הקורס לא נלמד בסמסטר זה</div>`;
    html += dedicatedNote(ec);
    for (const t of types) {
      const isExcluded = excluded.includes(t.code);
      const allowed = allowedGroups(ec, sem(), t.code, picks);
      const missing = !isExcluded && !picks[t.code];
      html += `<div class="pick-row ${isExcluded ? 'excluded' : ''}">
        <span class="pick-type">${esc(t.name)}</span>
        <select class="select" data-action="pick" data-course="${id}" data-type="${t.code}" ${isExcluded ? 'disabled' : ''} aria-label="${esc(t.name)}">
          <option value="">${missing ? '— יש לבחור —' : '— ללא —'}</option>
          ${allowed.map(g => `<option value="${esc(g.iid)}" ${picks[t.code] === g.iid ? 'selected' : ''}>${esc(groupLabel(g))}</option>`).join('')}
        </select>
        ${t.code === LECTURE ? '<span></span>' : `<button class="linkish" data-action="exclude" data-course="${id}" data-type="${t.code}" title="סמנו אם אינכם צריכים ${esc(t.name)} (למשל פטור)">${isExcluded ? 'נדרש' : 'לא נדרש'}</button>`}
      </div>`;
    }
    html += `</div>`;
  }
  return `<div class="row" style="justify-content:space-between;margin-bottom:10px">
      <b>${p.courses.length} קורסים · ${credits} נ״ז</b>
      <button class="btn sm danger" data-action="clear">ניקוי הכול</button>
    </div>${html}
    <button class="btn primary wide" data-action="tab" data-tab="auto">✨ בנו לי את המערכת הטובה ביותר</button>`;
}

// ---------------------------------------------------------------- panel: auto builder

function renderAutoTab() {
  const p = plan();
  const prefs = state.prefs;
  if (!p.courses.length) return emptyState('קודם בוחרים קורסים', 'הוסיפו את הקורסים של הסמסטר בלשונית "קורסים", והבונה ימצא עבורכם את השילוב הטוב ביותר של קבוצות.', '✨');

  const goals = [
    ['fewDays', 'כמה שפחות ימים', 'לרכז את הלימודים במינימום ימים בשבוע'],
    ['shortDays', 'ימים קצרים', 'מינימום שעות בכל יום, גם אם יש יותר ימים'],
    ['compact', 'בלי חלונות', 'כמה שפחות זמן מת בין שיעורים'],
    ['balanced', 'קצת מהכול', 'איזון בין מעט ימים, ימים קצרים ומעט חלונות'],
  ];
  let html = `<div class="section-title">מה חשוב לכם?</div>
  <div class="goal-grid">${goals.map(([k, t, d]) => `<button class="goal ${prefs.mode === k ? 'on' : ''}" data-action="mode" data-mode="${k}"><b>${t}</b><span>${d}</span></button>`).join('')}</div>

  <div class="pref-block">
    <div class="section-title">ימים שלא תגיעו בהם <small>(בשום מקרה)</small></div>
    <div class="chips">${DAY_NAMES.map((d, i) => `<button class="chip ${prefs.daysOff.includes(i) ? 'on' : ''}" data-action="day-off" data-day="${i}">${d}</button>`).join('')}</div>
  </div>

  <div class="pref-block hours-row">
    <label>לא להתחיל לפני
      <select class="select" data-action="earliest"><option value="">ללא הגבלה</option>
        ${TIME_OPTIONS.map(t => `<option value="${toMin(t)}" ${prefs.earliest === toMin(t) ? 'selected' : ''}>${t}</option>`).join('')}</select>
    </label>
    <label>לסיים עד
      <select class="select" data-action="latest"><option value="">ללא הגבלה</option>
        ${TIME_OPTIONS.slice(3).map(t => `<option value="${toMin(t)}" ${prefs.latest === toMin(t) ? 'selected' : ''}>${t}</option>`).join('')}</select>
    </label>
  </div>

  <div class="pref-block" style="display:grid;gap:8px">
    <label class="toggle"><input type="checkbox" data-action="avoid-full" ${prefs.avoidFull ? 'checked' : ''}/> להימנע מקבוצות מלאות (כשיש חלופה)</label>
    <label class="toggle"><input type="checkbox" data-action="respect-locks" ${prefs.respectLocks ? 'checked' : ''}/> לשמור על קורסים שנעלתי 🔒</label>
  </div>

  <button class="btn primary wide" data-action="run-auto" ${autoRunning ? 'disabled' : ''}>${autoRunning ? 'מחפש את השילוב הטוב ביותר…' : `✨ בנו לי מערכת (${p.courses.length} קורסים)`}</button>
  <div id="auto-results">${renderAutoResults()}</div>`;
  return html;
}

function renderAutoResults() {
  if (!auto) return '';
  if (auto.notice) return `<div class="notice warn">${esc(auto.notice)}</div>`;
  if (auto.error) return `<div class="notice err">שגיאה: ${esc(auto.error)}</div>`;
  let html = '';
  if (auto.skipped?.length) html += `<div class="notice warn">לא נכללו (אין קבוצות בסמסטר זה): ${auto.skipped.map(esc).join(', ')}</div>`;
  if (auto.blocked?.length) {
    const why = r => [r.dayOff && 'ימי החופש', r.early && 'שעת ההתחלה', r.late && 'שעת הסיום'].filter(Boolean).join(', ');
    const line = b => b.reasons.selfOverlap === b.total
      ? `"${esc(b.name)}" – בידיעון כל שילוב של הרצאה ותרגול/מעבדה בקורס הזה חופף בשעות. אם זה נכון בפועל, סמנו לקורס "לאפשר חפיפה" בלשונית הקורסים שלי.`
      : `"${esc(b.name)}" – אין קבוצה שמתאימה ל${why(b.reasons) || 'הגבלות'}`;
    return html + `<div class="notice err"><b>לא נמצאה מערכת אפשרית.</b><br>${auto.blocked.map(line).join('<br>')}<br>נסו לוותר על אחת ההגבלות.</div>`;
  }
  if (!auto.results.length) return html + `<div class="notice err"><b>לא נמצא שילוב ללא התנגשויות.</b> נסו להסיר קורס, לבטל יום חופש או לשחרר נעילה.</div>`;
  html += `<div class="list-head"><span>נמצאו ${auto.results.length} המערכות הטובות ביותר</span><span>${auto.exhaustive ? 'חיפוש מלא' : 'חיפוש חלקי'} · ${(auto.ms / 1000).toFixed(1)} שנ׳</span></div>`;
  html += auto.results.map((r, i) => {
    const s = r.stats;
    const off = state.prefs.daysOff;
    return `<div class="result ${preview?.index === i ? 'previewing' : ''}" data-action="preview" data-index="${i}">
      <div class="result-top"><span class="rank">#${i + 1}${i === 0 ? ' · מומלץ' : ''}</span>
        <button class="btn sm primary" data-action="apply" data-index="${i}">החילו על הלוח</button></div>
      <div class="stats">
        <span class="stat"><b>${s.days}</b> ימים</span>
        <span class="stat"><b>${fmtHours(s.busy)}</b> ש׳ לימוד</span>
        <span class="stat"><b>${fmtHours(s.gaps)}</b> ש׳ חלונות</span>
        <span class="stat">יום ארוך: <b>${fmtHours(s.maxSpan)}</b> ש׳</span>
        <span class="stat">${range(fmtMin(s.earliest), fmtMin(s.latest))}</span>
        ${r.fullCount ? `<span class="stat badge full">${r.fullCount === 1 ? 'קבוצה מלאה אחת' : `${r.fullCount} קבוצות מלאות`}</span>` : ''}
      </div>
      <div class="mini-week" style="--days:${showFridayFor(r.daily[5])}">${r.daily.slice(0, showFridayFor(r.daily[5])).map((d, di) => `<div class="mini-day ${off.includes(di) ? 'off' : ''}">${d ? `<i style="top:${Math.min(96, (d.start - 480) / 8.4)}%;height:${Math.max(4, Math.min(d.span, 1320 - d.start) / 8.4)}%"></i>` : ''}</div>`).join('')}</div>
      <div class="mini-labels" style="--days:${showFridayFor(r.daily[5])}">${DAY_LETTERS.slice(0, showFridayFor(r.daily[5])).map(d => `<span>${d}</span>`).join('')}</div>
    </div>`;
  }).join('');
  return html;
}

let worker = null;
function runAuto() {
  const p = plan();
  const prefs = state.prefs;
  const courses = [], skipped = [];
  for (const id of p.courses) {
    const c = COURSES.get(id);
    if (!courseInSemester(c, sem())) { skipped.push(c.name); continue; }
    const locked = prefs.respectLocks && p.locked[id] ? Object.fromEntries(Object.entries(p.picks[id] ?? {}).filter(([, v]) => v)) : {};
    const options = courseOptions(eligible(c), sem(), { excludedTypes: p.excluded[id] ?? [], locked });
    if (options.length) courses.push({ id, name: c.name, options, allowOverlap: !!p.overlap[id] });
    else skipped.push(c.name);
  }
  if (!courses.length) { auto = { results: [], skipped, blocked: [] }; render(); return; }
  if (!courses.some(c => c.options.some(o => o.slots.length))) {
    auto = { notice: `השעות של סמסטר ${semName(sem())} עדיין לא פורסמו, ולכן אין עדיין מה לשבץ. נסו שוב אחרי עדכון הנתונים.` };
    render();
    return;
  }
  autoRunning = true;
  preview = null;
  render();
  worker?.terminate();
  worker = new Worker(new URL('./optimizer.worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = ({ data }) => {
    autoRunning = false;
    auto = data.ok ? { ...data, skipped } : { error: data.error };
    if (auto.results?.length) preview = { index: 0, picks: auto.results[0].picks };
    worker.terminate(); worker = null;
    render();
    if (auto.results?.length) { pane = 'board'; render(); }
  };
  worker.onerror = e => { autoRunning = false; auto = { error: e.message }; render(); };
  worker.postMessage({ courses, prefs: { ...prefs, topK: 8 } });
}

function applyResult(i) {
  const r = auto?.results[i];
  if (!r) return;
  const p = plan();
  const before = JSON.stringify(p.picks);
  for (const [id, picks] of Object.entries(r.picks)) p.picks[id] = { ...p.picks[id], ...picks };
  preview = null;
  save();
  render();
  toast(`מערכת #${i + 1} הוחלה על הלוח`, { label: 'ביטול', run: () => { plan().picks = JSON.parse(before); save(); render(); } });
}

// ---------------------------------------------------------------- summary + edit bar

function renderSummary(items) {
  const p = plan();
  const credits = p.courses.reduce((n, id) => n + (COURSES.get(id)?.credits || 0), 0);
  const st = scheduleStats(items.map(i => [i.day, i.start, i.end]));
  const clashCount = items.filter(i => i.clash).length;
  let missing = 0;
  const unlinked = [], notMine = [];
  for (const id of p.courses) {
    const c = COURSES.get(id);
    if (!c) continue;
    const mine = new Set(eligible(c).groups.map(g => g.iid));
    for (const t of requiredTypes(c)) {
      const iid = picksOf(id)[t.code];
      if (!iid) missing++;
      else if (!mine.has(iid)) notMine.push(`${c.name} (${t.name})`);
      else if (!allowedGroups(c, sem(), t.code, picksOf(id)).some(g => g.iid === iid)) unlinked.push(`${c.name} (${t.name})`);
    }
  }
  const term = `${DATA.hebrewYear || DATA.year} · סמסטר ${semName(sem())}`;
  $('#summary').innerHTML = `
    <div class="sum-item"><b>${p.courses.length}</b>קורסים</div>
    <div class="sum-item"><b>${credits}</b>נ״ז</div>
    <div class="sum-item"><b>${fmtHours(st.busy)}</b>ש׳ שבועיות</div>
    <div class="sum-item"><b>${st.days}</b>ימי לימוד</div>
    <div class="sum-item"><b>${fmtHours(st.gaps)}</b>ש׳ חלונות</div>
    ${clashCount ? `<div class="sum-item bad"><b>${clashCount}</b>מפגשים מתנגשים</div>` : ''}
    ${missing ? `<div class="sum-item warn"><b>${missing}</b>קבוצות חסרות</div>` : ''}
    ${notMine.length ? `<div class="sum-item warn" title="${esc(notMine.join(', '))}"><b>${notMine.length}</b>קבוצות שאינן של התואר שלך</div>` : ''}
    ${unlinked.length ? `<div class="sum-item warn" title="${esc(unlinked.join(', '))}"><b>${unlinked.length}</b>לא מקושרים להרצאה שנבחרה</div>` : ''}
    <span class="spacer"></span>
    <label class="toggle" title="יום שישי מוצג תמיד כשיש בו מפגש"><input type="checkbox" data-action="show-friday" ${state.showFriday ? 'checked' : ''}/> הצג יום שישי${!state.showFriday && items.some(i => i.day === 5) ? ' <span class="badge warn">יש מפגש ביום שישי</span>' : ''}</label>
    <span class="muted" style="font-size:13px">${esc(term)}</span>`;

  const bar = $('#editbar');
  if (preview) {
    bar.hidden = false;
    bar.className = 'previewbar';
    bar.innerHTML = `<span class="grow">תצוגה מקדימה של מערכת <b>#${preview.index + 1}</b> מהבונה האוטומטי</span>
      <button class="btn sm primary" data-action="apply" data-index="${preview.index}">החילו</button>
      <button class="btn sm" data-action="cancel-preview">ביטול</button>`;
  } else if (activeCourse && COURSES.get(activeCourse)) {
    const c = COURSES.get(activeCourse);
    bar.hidden = false;
    bar.className = 'editbar';
    bar.innerHTML = `<span class="grow">עריכת <b>${esc(c.name)}</b>: לחצו על משבצת מקווקוות כדי לעבור לקבוצה אחרת</span>
      <button class="btn sm" data-action="details" data-course="${c.id}">פרטי הקורס</button>
      <button class="btn sm" data-action="lock" data-course="${c.id}">${plan().locked[c.id] ? '🔒 נעול' : '🔓 נעילה'}</button>
      <button class="btn sm danger" data-action="remove" data-course="${c.id}">הסרה</button>
      <button class="btn sm primary" data-action="done-edit">סיום</button>`;
  } else {
    bar.hidden = true;
  }
}

// ---------------------------------------------------------------- rooms

function renderRooms() {
  const roomsMap = new Map();
  for (const c of DATA.courses) for (const g of c.groups) for (const s of g.sessions) {
    if (s.sem !== sem() || !s.room) continue;
    if (!roomsMap.has(s.room)) roomsMap.set(s.room, []);
    roomsMap.get(s.room).push({ day: s.day, start: toMin(s.start), end: toMin(s.end) });
  }
  const { day, from, to, q } = rooms;
  const free = [];
  for (const [room, busy] of roomsMap) {
    if (q && !room.toLowerCase().includes(q.toLowerCase())) continue;
    const today = busy.filter(b => b.day === day);
    if (today.some(b => b.start < to && from < b.end)) continue;
    const next = today.filter(b => b.start >= to).sort((a, b) => a.start - b.start)[0];
    free.push({ room, until: next ? next.start : null });
  }
  free.sort((a, b) => (b.until ?? 9999) - (a.until ?? 9999) || a.room.localeCompare(b.room, 'he'));
  const opts = (sel) => Array.from({ length: 29 }, (_, i) => 480 + i * 30).map(m => `<option value="${m}" ${m === sel ? 'selected' : ''}>${fmtMin(m)}</option>`).join('');
  $('#rooms-area').innerHTML = `<div class="rooms-wrap">
    <h2 style="margin:4px 0 12px">חדרים פנויים · סמסטר ${semName(sem())}</h2>
    <div class="rooms-controls">
      <label>יום<div class="chips">${DAY_NAMES.map((d, i) => `<button class="chip ${day === i ? 'on' : ''}" data-action="room-day" data-day="${i}">${d}</button>`).join('')}</div></label>
      <label>משעה<select class="select" data-action="room-from">${opts(from)}</select></label>
      <label>עד שעה<select class="select" data-action="room-to">${opts(to)}</select></label>
      <label>חיפוש חדר<input class="input" id="room-q" value="${esc(q)}" placeholder="למשל L או 702" /></label>
    </div>
    <p class="muted">${free.length} חדרים פנויים ביום ${DAY_NAMES[day]} בין ${fmtMin(from)} ל-${fmtMin(to)} (לפי מערכת השעות הרשמית – ייתכנו הזמנות נוספות).</p>
    <div class="rooms-grid">${free.map(r => `<div class="room"><b>${esc(r.room)}</b><small>${r.until ? `פנוי עד ${fmtMin(r.until)}` : 'פנוי עד סוף היום'}</small></div>`).join('') || emptyState('אין חדרים פנויים בטווח הזה')}</div>
  </div>`;
}

// ---------------------------------------------------------------- modal

function openModal(html) {
  $('#modal-box').innerHTML = html;
  $('#modal').hidden = false;
}
function closeModal() {
  $('#modal').hidden = true;
  degreeFirstRun = false;
  modalCourse = null;
}

function renderCourseModal() {
  const c = COURSES.get(modalCourse);
  if (!c) return;
  const selected = plan().courses.includes(c.id);
  const degrees = Object.entries(c.degrees).map(([code, info]) => {
    const name = degreeName(code);
    if (!name) return '';
    const parts = [
      info.core ? `חובה${info.mandatory.length ? ` שנה ${info.mandatory.map(y => STUDY_YEARS[y]).join('/')}` : ''}` : 'בחירה',
      info.years.length ? `במערכת שנה ${info.years.map(y => STUDY_YEARS[y]).join('/')}` : '',
    ].filter(Boolean);
    return `<span class="badge ${code === state.degree ? 'must' : ''}">${esc(name)} · ${parts.join(' · ')}</span>`;
  }).join('');
  const [lec, tut, lab] = (c.hoursLine || '').split(/\s+/);
  const hours = c.hoursLine ? ` · ש״ש: ${[lec && lec !== '-' && `${lec} הרצאה`, tut && tut !== '-' && `${tut} תרגול`, lab && lab !== '-' && `${lab} מעבדה`].filter(Boolean).join(', ')}` : '';

  let body = '';
  if (modalTab === 'info') {
    body += `<div class="desc">${c.description ? esc(c.description) : '<span class="muted">אין תיאור קורס בידיעון.</span>'}</div>`;
    const types = groupTypes(c, sem());
    const ec = eligible(c);
    const mine = new Set(ec.groups.map(g => g.iid));
    const hidden = new Set(plan().hidden[c.id] ?? []);
    if (!types.length) body += `<div class="notice warn">הקורס אינו נלמד בסמסטר ${semName(sem())}.</div>`;
    else {
      if (state.degree) {
        body += `<div class="row" style="justify-content:space-between;margin-bottom:8px">
          <span class="muted" style="font-size:13px">${mine.size < c.groups.length ? (n => `${n === 1 ? 'מוצגת במערכת קבוצה אחת שזמינה לך' : `מוצגות במערכת ${n} קבוצות שזמינות לך`} מתוך ${types.reduce((k, t) => k + t.groups.length, 0)}`)(types.reduce((n, t) => n + t.groups.filter(g => mine.has(g.iid)).length, 0)) : 'כל הקבוצות זמינות במערכת'}</span>
          <label class="toggle"><input type="checkbox" data-action="course-other-degrees" data-course="${c.id}" ${state.otherDegreeCourses[c.id] ? 'checked' : ''} ${state.showOtherDegrees ? 'disabled' : ''}/> הצג קבוצות של תארים אחרים בקורס זה</label>
        </div>${dedicatedNote(ec)}`;
      }
      body += `<table class="groups"><thead><tr><th>קבוצה</th><th>מרצה</th><th>מועדים</th><th>סטטוס</th><th>${state.degree ? 'זמינה לי' : ''}</th><th></th></tr></thead><tbody>`;
      for (const t of types) {
        body += `<tr class="type-row"><td colspan="6">${esc(t.name)} · ${t.groups.length} קבוצות</td></tr>`;
        for (const g of t.groups) {
          const sessions = semesterSessions(g, sem());
          const linked = g.links.length ? `<div class="muted" style="font-size:12px">מקושרת ל-${g.links.length} קבוצות ${esc(c.groups.find(x => x.iid === g.links[0])?.type ?? '')}</div>` : '';
          const d = groupDegree(g);
          const degreeTag = d && d !== state.degree ? `<span class="badge">${esc(DEGREES.get(d)?.name ?? 'תואר אחר')}</span>` : d ? '<span class="badge must">התואר שלך</span>' : '';
          const availability = !state.degree ? '' : hidden.has(g.iid) || mine.has(g.iid) || !(d && d !== state.degree)
            ? `<input type="checkbox" data-action="hide-group" data-course="${c.id}" data-iid="${esc(g.iid)}" ${hidden.has(g.iid) ? '' : 'checked'} title="בטלו את הסימון אם הקבוצה לא מוצעת לכם במערכת הרישום">`
            : '<span class="muted" style="font-size:12px">תואר אחר</span>';
          body += `<tr class="${state.degree && !mine.has(g.iid) ? 'not-mine' : ''}">
            <td><span dir="ltr">${esc(g.cohort)}${g.sub ? ` / ${esc(g.sub)}` : ''}</span> ${degreeTag}${linked}</td>
            <td>${esc(g.lecturer)}${g.lang && g.lang !== 'עברית' ? ` <span class="badge">${esc(g.lang)}</span>` : ''}</td>
            <td>${sessions.length ? sessions.map(s => `יום ${DAY_NAMES[s.day]} ${range(s.start, s.end)}${s.room ? ` · ${esc(s.room)}` : ''}`).join('<br>') : '<span class="muted">טרם פורסם</span>'}</td>
            <td>${g.full ? '<span class="badge full">מלא</span>' : '<span class="badge ok">פתוח</span>'}</td>
            <td>${availability}</td>
            <td><button class="linkish" data-action="official-group" data-iid="${esc(g.iid)}">באתר ↗</button></td>
          </tr>`;
        }
      }
      body += `</tbody></table>`;
    }
    const otherSems = [...new Set(c.groups.map(g => g.sem))].filter(s => s !== sem());
    if (otherSems.length) body += `<p class="muted" style="font-size:13px">הקורס מופיע גם בסמסטר ${otherSems.map(semName).join(', ')}.</p>`;
  } else {
    body += `<div class="row" style="margin-bottom:10px"><a class="btn" href="${esc(c.syllabus)}" target="_blank" rel="noopener">פתיחת הסילבוס בלשונית חדשה ↗</a>
      <span class="muted" id="syllabus-status" style="font-size:13px"></span></div>
      <div class="pdf-view" id="pdf-view"><div class="spinner"></div></div>`;
  }

  openModal(`<div class="modal-head">
      ${colorButton(c.id)}
      <div style="flex:1"><h2 id="modal-title">${esc(c.name)}</h2>
        <div class="sub"><span>${c.id}</span>${c.credits ? `<span>· ${c.credits} נ״ז</span>` : ''}<span>${esc(hours)}</span></div>
        <div class="sub">${degrees}</div></div>
      <button class="icon-btn" data-action="close-modal" aria-label="סגירה">✕</button>
    </div>
    ${colorMenu(c.id) ? `<div style="padding:0 22px">${colorMenu(c.id)}</div>` : ''}
    <div class="modal-body" style="padding-bottom:0">
      <div class="modal-actions">
        <button class="btn ${selected ? '' : 'primary'}" data-action="${selected ? 'remove' : 'add'}" data-course="${c.id}">${selected ? '✓ במערכת – הסרה' : '+ הוספה למערכת'}</button>
        <button class="btn" data-action="official" data-course="${c.id}">פתח את דף הקורס באתר המוסד ↗</button>
      </div>
    </div>
    <div class="modal-tabs">
      <button class="tab ${modalTab === 'info' ? 'active' : ''}" data-action="modal-tab" data-tab="info">פרטים וקבוצות</button>
      <button class="tab ${modalTab === 'syllabus' ? 'active' : ''}" data-action="modal-tab" data-tab="syllabus">סילבוס</button>
    </div>
    <div class="modal-body">${body}</div>`);

  if (modalTab === 'syllabus') renderSyllabus(c);
}

const PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168';
let pdfjsLib = null;

/** Renders the syllabus PDF inside the modal with pdf.js (via the local /api/pdf proxy); falls back to an iframe. */
async function renderSyllabus(course) {
  const view = $('#pdf-view');
  const status = $('#syllabus-status');
  const stillHere = () => modalCourse === course.id && modalTab === 'syllabus' && view.isConnected;
  try {
    pdfjsLib ??= await import(`${PDFJS}/pdf.min.mjs`);
    pdfjsLib.GlobalWorkerOptions.workerSrc = `${PDFJS}/pdf.worker.min.mjs`;
    const doc = await pdfjsLib.getDocument({
      url: `api/pdf?url=${encodeURIComponent(course.syllabus)}`,
      cMapUrl: `${PDFJS}/cmaps/`, cMapPacked: true, standardFontDataUrl: `${PDFJS}/standard_fonts/`,
    }).promise;
    if (!stillHere()) return;
    // Braude's syllabi are Word exports without embedded Hebrew glyph metrics, so the text layer reads
    // much better than the rasterized page. Show text first; the original pages are one click away.
    const lines = await syllabusLines(doc);
    if (!stillHere()) return;
    view.innerHTML = `<div class="row" style="justify-content:space-between;width:100%">
        <span class="muted" style="font-size:13px">${doc.numPages} עמודים · תצוגת טקסט</span>
        <button class="btn sm" id="pdf-pages">הצגת העמודים המקוריים</button></div>
      <article class="syl-text">${lines.map(l => (l ? `<p dir="auto">${esc(l)}</p>` : '<br>')).join('')}</article>`;
    $('#pdf-pages').onclick = () => renderPages(doc, view, stillHere);
  } catch (err) {
    if (!stillHere()) return;
    if (/404|Missing PDF|Unexpected server response/i.test(String(err?.message || err))) {
      view.innerHTML = emptyState('לא נמצא סילבוס לשנה זו', 'ייתכן שהמכללה טרם פרסמה אותו. נסו את הקישור לאתר המכללה.', '📄');
    } else {
      // e.g. opened without the local server: let the browser's own PDF viewer try
      status.textContent = 'התצוגה המובנית לא זמינה – מוצג דרך הדפדפן';
      view.innerHTML = `<iframe class="pdf-frame" src="${esc(course.syllabus)}#view=FitH" title="סילבוס ${esc(course.name)}"></iframe>`;
    }
  }
}

/** Text lines of a PDF in logical (content-stream) order, with spaces restored from glyph gaps. */
async function syllabusLines(doc) {
  const lines = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const { items } = await (await doc.getPage(n)).getTextContent();
    let line = '', prev = null;
    for (const it of items) {
      const [, , , h, x, y] = it.transform;
      if (prev && Math.abs(y - prev.y) > Math.max(2, Math.abs(prev.h) * 0.5)) {
        lines.push(line.trim());
        if (prev.y - y > Math.abs(prev.h) * 2.2) lines.push('');
        line = '';
      } else if (prev && it.str && !/\s$/.test(line) && !/^\s/.test(it.str)) {
        const gap = Math.min(Math.abs(x - (prev.x + prev.w)), Math.abs(prev.x - (x + it.width)));
        if (gap > Math.abs(h) * 0.18) line += ' ';
      }
      line += it.str;
      if (it.str || it.hasEOL) prev = { x, y, w: it.width, h: h || prev?.h || 10 };
    }
    lines.push(line.trim(), '');
  }
  return lines.filter((l, i, a) => l || (a[i - 1] && i < a.length - 1));
}

async function renderPages(doc, view, stillHere) {
  view.innerHTML = '';
  const width = view.clientWidth || 800;
  try {
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      if (!stillHere()) return;
      const scale = width / page.getViewport({ scale: 1 }).width;
      const vp = page.getViewport({ scale: scale * devicePixelRatio });
      const canvas = document.createElement('canvas');
      canvas.width = vp.width;
      canvas.height = vp.height;
      canvas.style.width = '100%';
      view.append(canvas);
      await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
    }
  } catch (err) {
    if (stillHere()) view.innerHTML = emptyState('לא ניתן להציג את העמודים', String(err?.message || err), '📄');
  }
}

function renderDegreeModal(first = degreeFirstRun) {
  degreeFirstRun = first;
  const groups = [
    ['תואר ראשון', DATA.degrees.filter(d => d.level === 'bsc')],
    ['תואר שני', DATA.degrees.filter(d => d.level === 'msc')],
    ['אחר', DATA.degrees.filter(d => d.level === 'other')],
  ];
  openModal(`<div class="modal-head"><div style="flex:1"><h2 id="modal-title">${first ? 'ברוכים הבאים! 👋 מה אתם לומדים?' : 'בחירת מגמה'}</h2>
      <div class="sub">נציג לכם רק את הקורסים שרלוונטיים למגמה שלכם. אפשר לשנות בכל רגע.</div></div>
      ${first ? '' : '<button class="icon-btn" data-action="close-modal" aria-label="סגירה">✕</button>'}</div>
    <div class="modal-body">
      ${groups.filter(([, l]) => l.length).map(([title, list]) => `<div class="section-title">${title}</div>
        <div class="degree-list">${list.map(d => `<button class="degree-opt ${state.degree === d.code ? 'on' : ''}" data-action="pick-degree" data-degree="${d.code}">${esc(d.name)}
          <small>${d.cohorts.length ? `${d.cohorts.length} קבוצות לימוד` : ''}${d.sections.length ? ` · ${d.sections.length} חלקי תוכנית` : ''}</small></button>`).join('')}</div>`).join('')}
      <div class="section-title">שנת לימודים</div>
      <div class="chips" style="margin-bottom:18px">${STUDY_YEARS.map((y, i) => `<button class="chip ${state.studyYear === i ? 'on' : ''}" data-action="modal-study-year" data-year="${i}">${i ? `שנה ${y}` : 'לא משנה'}</button>`).join('')}</div>
      <div class="row">
        <button class="btn primary" data-action="close-modal" ${state.degree ? '' : 'disabled'} id="degree-done">המשך</button>
        <button class="btn ghost" data-action="no-degree">דלגו – הציגו את כל הקורסים</button>
      </div>
    </div>`);
}

// ---------------------------------------------------------------- render

function render() {
  document.querySelectorAll('[data-action="tab"]').forEach(b => b.classList.toggle('active', b.dataset.tab === state.tab));
  document.querySelectorAll('.view-btn').forEach(b => b.classList.toggle('active', b.dataset.view === state.view));
  document.querySelectorAll('.mobile-nav button').forEach(b => b.classList.toggle('active', b.dataset.pane === pane));
  $('#app').dataset.pane = pane;
  $('#mine-count').textContent = plan().courses.length || '';
  $('#degree-chip').textContent = state.degree ? `${degreeName(state.degree)}${state.studyYear ? ` · שנה ${STUDY_YEARS[state.studyYear]}` : ''}` : 'בחירת מגמה';

  const term = $('#term-select');
  term.innerHTML = INDEX.years.flatMap(y => y.semesters.map(s =>
    `<option value="${y.year}|${s.code}" ${y.year === state.year && s.code === state.sem ? 'selected' : ''}>${esc(y.hebrewYear || y.year)} (${y.year}) · סמסטר ${s.name}${s.hasHours === false ? ' (שעות טרם פורסמו)' : ''}</option>`)).join('');

  const roomsView = state.view === 'rooms';
  $('#rooms-area').hidden = !roomsView;
  $('#panel').hidden = roomsView;
  $('#board-area').hidden = roomsView;
  if (roomsView) { renderRooms(); return; }

  const body = $('#panel-body');
  const focused = document.activeElement?.id === 'q';
  const caret = focused ? document.activeElement.selectionStart : null;
  const scroll = body.scrollTop;
  body.innerHTML = state.tab === 'mine' ? renderMineTab() : state.tab === 'auto' ? renderAutoTab() : renderCoursesTab();
  body.scrollTop = scroll;
  if (focused) { const q = $('#q'); q.focus(); q.setSelectionRange(caret, caret); }

  const items = placedItems();
  renderSummary(items);
  renderBoard($('#board'), { items, ghosts: ghostItems(), daysOff: state.tab === 'auto' || preview ? state.prefs.daysOff : [],
    days: showFridayFor(items.some(i => i.day === 5)) });
  if (modalCourse) renderCourseModal();
}

// ---------------------------------------------------------------- share links

function shareLink() {
  const p = plan();
  const colors = Object.fromEntries(p.courses.filter(id => state.courseColors[id]).map(id => [id, state.courseColors[id]]));
  const payload = { y: state.year, s: state.sem, c: p.courses.map(id => [id, Object.values(p.picks[id] ?? {}).filter(Boolean)]), k: colors };
  const enc = btoa(unescape(encodeURIComponent(JSON.stringify(payload)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${location.origin}${location.pathname}#share=${enc}`;
}

async function importShare() {
  const m = location.hash.match(/share=([\w-]+)/);
  if (!m) return;
  history.replaceState(null, '', location.pathname);
  try {
    const json = JSON.parse(decodeURIComponent(escape(atob(m[1].replace(/-/g, '+').replace(/_/g, '/')))));
    if (json.y !== state.year) await loadYear(json.y);
    state.sem = json.s;
    const p = plan();
    const before = JSON.stringify(p);
    p.courses = []; p.picks = {};
    for (const [id, iids] of json.c) {
      const c = COURSES.get(id);
      if (!c) continue;
      p.courses.push(id);
      p.picks[id] = Object.fromEntries(iids.map(iid => [c.groups.find(g => g.iid === iid)?.typeCode, iid]).filter(([k]) => k));
      if (json.k?.[id]) state.courseColors[id] = json.k[id];
    }
    save();
    sharedOpened = true;
    toast('נטענה מערכת ששותפה איתכם', { label: 'ביטול', run: () => { Object.assign(plan(), JSON.parse(before)); save(); render(); } });
  } catch {
    toast('קישור השיתוף אינו תקין');
  }
}

// ---------------------------------------------------------------- events

const actions = {
  tab: el => { state.tab = el.dataset.tab; if (state.tab !== 'auto') preview = null; pane = 'panel'; save(); render(); },
  view: el => { state.view = el.dataset.view; save(); render(); },
  mobile: el => { pane = el.dataset.pane; render(); },
  'open-degree': () => renderDegreeModal(false),
  'pick-degree': el => { state.degree = el.dataset.degree; state.showAll = false; save(); renderDegreeModal(); render(); },
  'modal-study-year': el => { state.studyYear = Number(el.dataset.year); save(); renderDegreeModal(); render(); },
  'no-degree': () => { state.degree = null; state.showAll = true; save(); closeModal(); render(); },
  'study-year': el => { state.studyYear = Number(el.dataset.year); save(); render(); },
  'show-all': el => { state.showAll = el.checked; save(); render(); },
  'color-menu': el => { const id = Number(el.dataset.course); colorMenuFor = colorMenuFor === id ? null : id; render(); },
  'set-color': el => {
    const id = Number(el.dataset.course);
    if (el.dataset.color) state.courseColors[id] = el.dataset.color; else delete state.courseColors[id];
    colorMenuFor = null; save(); render();
  },
  'custom-color': el => { state.courseColors[Number(el.dataset.course)] = el.value; save(); render(); },
  'show-friday': el => { state.showFriday = el.checked; save(); render(); },
  'other-degrees': el => { state.showOtherDegrees = el.checked; save(); render(); },
  'course-other-degrees': el => { state.otherDegreeCourses[el.dataset.course] = el.checked; save(); render(); },
  'hide-group': el => {
    const id = Number(el.dataset.course), p = plan();
    const list = new Set(p.hidden[id] ?? []);
    if (el.checked) list.delete(el.dataset.iid); else list.add(el.dataset.iid);
    p.hidden[id] = [...list];
    save(); render();
  },
  add: el => { addCourse(Number(el.dataset.course)); render(); },
  remove: el => { removeCourse(Number(el.dataset.course)); render(); },
  details: el => { modalCourse = Number(el.dataset.course); modalTab = 'info'; renderCourseModal(); },
  'modal-tab': el => { modalTab = el.dataset.tab; renderCourseModal(); },
  'close-modal': () => closeModal(),
  official: el => openOfficial(state.year, 'S_LOOK_FOR_NOSE', `-N${el.dataset.course}`),
  'official-group': el => openOfficial(state.year, 'S_CourseDetails', el.dataset.iid),
  edit: el => { activeCourse = Number(el.dataset.course); pane = 'board'; render(); },
  block: el => { const id = Number(el.dataset.course); activeCourse = activeCourse === id ? null : id; preview = null; render(); },
  ghost: el => { setPick(Number(el.dataset.course), el.dataset.iid); render(); },
  'done-edit': () => { activeCourse = null; render(); },
  lock: el => { const id = Number(el.dataset.course); const p = plan(); p.locked[id] = !p.locked[id]; save(); render(); },
  overlap: el => { const id = Number(el.dataset.course); const p = plan(); p.overlap[id] = !p.overlap[id]; save(); render(); },
  exclude: el => {
    const id = Number(el.dataset.course), t = el.dataset.type, p = plan();
    const list = (p.excluded[id] ??= []);
    p.excluded[id] = list.includes(t) ? list.filter(x => x !== t) : [...list, t];
    save(); render();
  },
  clear: () => {
    const before = JSON.stringify(plan());
    Object.assign(plan(), { courses: [], picks: {}, excluded: {}, locked: {}, overlap: {} });
    activeCourse = null; save(); render();
    toast('המערכת נוקתה', { label: 'ביטול', run: () => { Object.assign(plan(), JSON.parse(before)); save(); render(); } });
  },
  mode: el => { state.prefs.mode = el.dataset.mode; save(); render(); },
  'day-off': el => {
    const d = Number(el.dataset.day), off = state.prefs.daysOff;
    state.prefs.daysOff = off.includes(d) ? off.filter(x => x !== d) : [...off, d].sort();
    save(); render();
  },
  'avoid-full': el => { state.prefs.avoidFull = el.checked; save(); },
  'respect-locks': el => { state.prefs.respectLocks = el.checked; save(); },
  'run-auto': () => runAuto(),
  preview: el => { const i = Number(el.dataset.index); preview = { index: i, picks: auto.results[i].picks }; activeCourse = null; render(); },
  apply: el => applyResult(Number(el.dataset.index)),
  'cancel-preview': () => { preview = null; render(); },
  'room-day': el => { rooms.day = Number(el.dataset.day); render(); },
  share: async () => {
    const url = shareLink();
    try { await navigator.clipboard.writeText(url); toast('הקישור הועתק – שלחו אותו לחברים'); }
    catch { prompt('העתיקו את הקישור:', url); }
  },
  print: () => { state.view = 'board'; render(); setTimeout(() => window.print(), 50); },
  theme: () => {
    const dark = document.documentElement.dataset.theme === 'dark' ||
      (!document.documentElement.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches);
    state.theme = dark ? 'light' : 'dark';
    document.documentElement.dataset.theme = state.theme;
    save();
  },
};

document.addEventListener('click', e => {
  const el = e.target.closest('[data-action]');
  if (e.target.id === 'modal' && !degreeFirstRun) return closeModal();
  if (!el || el.tagName === 'SELECT' || el.tagName === 'INPUT') return;
  const fn = actions[el.dataset.action];
  if (fn) { e.stopPropagation(); fn(el, e); }
});

document.addEventListener('change', e => {
  const el = e.target;
  const a = el.dataset.action;
  if (el.id === 'term-select') return switchTerm(el.value);
  if (a === 'pick') {
    const id = Number(el.dataset.course);
    if (el.value) setPick(id, el.value);
    else {
      delete plan().picks[id]?.[el.dataset.type];
      save();
    }
    render();
  } else if (a === 'earliest' || a === 'latest') {
    state.prefs[a] = el.value ? Number(el.value) : null; save();
  } else if (a === 'room-from' || a === 'room-to') {
    rooms[a === 'room-from' ? 'from' : 'to'] = Number(el.value);
    if (rooms.to <= rooms.from) rooms.to = rooms.from + 30;
    render();
  } else if (a && actions[a] && (el.type === 'checkbox' || el.type === 'color')) {
    actions[a](el);
  }
});

const onSearch = debounce(() => render(), 120);
document.addEventListener('input', e => {
  if (e.target.id === 'q') { state.query = e.target.value; save(); onSearch(); }
  if (e.target.id === 'room-q') { rooms.q = e.target.value; debounce(() => { renderRooms(); const i = $('#room-q'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }, 150)(); }
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    if (!$('#modal').hidden) { if (!degreeFirstRun) closeModal(); }
    else if (preview) { preview = null; render(); }
    else if (activeCourse) { activeCourse = null; render(); }
  }
});

async function switchTerm(value) {
  const [y, s] = value.split('|');
  preview = null; auto = null; activeCourse = null;
  if (Number(y) !== state.year) await loadYear(Number(y));
  state.sem = s;
  save();
  render();
}

// ---------------------------------------------------------------- boot

(async function boot() {
  try {
    await loadIndex();
    const def = INDEX.default ?? { year: INDEX.years[0].year, semester: INDEX.years[0].semesters[0]?.code };
    const year = INDEX.years.some(y => y.year === state.year) ? state.year : def.year;
    if (year !== state.year) state.sem = def.semester;
    state.sem ??= def.semester;
    await loadYear(year);
    await importShare();
    save();
    $('#loading').remove();
    render();
    // someone opening a shared schedule wants to see it first; the degree can be picked later
    if (!state.degree && !state.showAll && !sharedOpened) renderDegreeModal(true);
  } catch (err) {
    $('#loading').innerHTML = `<div class="empty"><div class="big">⚠️</div><b>שגיאה בטעינת הנתונים</b><div>${esc(err.message)}</div></div>`;
  }
})();
