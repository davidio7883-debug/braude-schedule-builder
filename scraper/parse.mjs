// HTML parsers for the yedion pages. The markup is regular: tables are <article class="row"> with <div class="col"> cells.

const ENTITIES = { nbsp: ' ', quot: '"', amp: '&', lt: '<', gt: '>', apos: "'", '#39': "'" };

export function text(html) {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(#\d+|[a-z]+);/gi, (m, e) => ENTITIES[e.toLowerCase()] ?? (e.startsWith('#') ? String.fromCharCode(+e.slice(1)) : m))
    .replace(/[ \t\u00a0]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .trim();
}

const oneLine = s => text(s).replace(/\s+/g, ' ').trim();

export function rows(html) {
  return [...html.matchAll(/<article class="row">([\s\S]*?)<\/article>/g)].map(m => ({
    html: m[1],
    cols: [...m[1].matchAll(/<div class="col[^"]*">([\s\S]*?)<\/div>/g)].map(c => oneLine(c[1])),
  }));
}

export function selectOptions(html, id) {
  const m = html.match(new RegExp(`<select[^>]*id="${id}"[^>]*>([\\s\\S]*?)</select>`));
  if (!m) return [];
  return [...m[1].matchAll(/<option[^>]*value="([^"]*)"[^>]*>([\s\S]*?)<\/option>/g)]
    .map(o => ({ value: o[1].trim(), label: oneLine(o[2]) }))
    // drop placeholders such as "בחר את המגמה הרצוי" (their value is the long label itself)
    .filter(o => o.value && (o.value.length <= 2 || /^\d+$/.test(o.value)));
}

/** S_LOOK_FOR_NOSE_AB / S_SHOW_PROGS: course id, name, offered flag, optional description. */
export function courseList(html) {
  return rows(html)
    .filter(r => /^\d{3,7}$/.test(r.cols[0]))
    .map(r => ({
      id: r.cols[0],
      name: r.cols[1],
      offered: r.cols[2] === 'נלמד',
      ...syllabusBlock(r.html),
    }));
}

/** S_YFineDate: one row per session of the whole semester. */
export function timetableRows(html) {
  return rows(html)
    .filter(r => /^\d{3,7}$/.test(r.cols[0]))
    .map(r => ({ id: r.cols[0], name: r.cols[1], type: r.cols[2] }));
}

/** S_GROUP: cohort groups of a degree. */
export function cohorts(html) {
  return [...html.matchAll(/<div class="col">([^<]+)<\/div>\s*<div class="col"><a href="fireflyweb\.aspx\?prgname=S_GROUP_HOURS&amp;arguments=-N(\d+)"/gi)]
    .map(m => ({ name: oneLine(m[1]), code: m[2] }));
}

/** S_PROG: curriculum sections (mandatory per study year, elective clusters). */
export function programSections(html) {
  return rows(html)
    .map(r => ({ name: r.cols[0], m: r.html.match(/S_SHOW_PROGS&amp;arguments=-N(\d+),-N(\d+)/i) }))
    .filter(x => x.m)
    .map(x => ({ name: x.name, startYear: x.m[1], code: x.m[2] }));
}

/** "פרשיית לימוד" block: hours line + catalog description. */
export function syllabusBlock(html) {
  const m = html.match(/<details id="Details_\d+">[\s\S]*?<\/summary>\s*<div>([\s\S]*?)<\/div>\s*<\/details>/);
  if (!m) return {};
  const lines = text(m[1]).split('\n').map(s => s.trim());
  // lines[0] = "<id> <name>", lines[1] = "3 2 - - 4.0 נ\"ז" (lecture/tutorial/lab hours ... credits)
  const hoursLine = (lines[1] || '').replace(/נ"ז/, '').trim();
  const nums = hoursLine.split(/\s+/).filter(t => /^\d+(\.\d+)?$/.test(t));
  const credits = nums.length ? Number(nums[nums.length - 1]) : null;
  const description = lines.slice(2).join('\n').trim();
  return { hoursLine, credits, description };
}

const DAYS = { 'ראשון': 0, 'שני': 1, 'שלישי': 2, 'רביעי': 3, 'חמישי': 4, 'שישי': 5, 'שבת': 6 };
const SEM_LETTER = { 'א': '1', 'ב': '2', 'קיץ': '3' };

export function parseInstanceId(iid) {
  const [course, sem, typeCode, cohort, sub] = iid.split(',').map(p => p.replace(/^-N/, ''));
  return { course, sem, typeCode, cohort, sub: sub || '' };
}

/** S_LOOK_FOR_NOSE: every group of a course (all semesters) with sessions, rooms and linked groups. */
export function courseGroups(html) {
  const title = html.match(/<h2 class="TextAlignCenter">\s*קורס\s*([\s\S]*?)שנה"ל/);
  const chunks = html.split(/<div class="TextAlignRight">\s*קורס מסוג/).slice(1);
  const groups = chunks.map(chunk => {
    const iid = chunk.match(/data-progname="S_CourseDetails" data-arguments="([^"]+)"/)?.[1];
    if (!iid) return null;
    const id = parseInstanceId(iid);
    const head = chunk.slice(0, chunk.indexOf('<button'));
    const type = oneLine(head.split(/&nbsp;|<span/)[0]);
    const lecturer = oneLine(head.match(/מרצה הקורס\s*:([\s\S]*)$/)?.[1] ?? '');
    const lang = oneLine(chunk.match(/שפת הוראה של הקורס\s*:([^&<]*)/)?.[1] ?? '');
    const full = chunk.slice(0, chunk.indexOf('</div>')).includes('הקורס מלא');
    const linkText = chunk.match(/קבוצות הקשורות לקורס זה\s*:([^)]*)\)/)?.[1] ?? '';
    const linkedTo = linkText.split(',').map(s => s.replace(/\s+/g, '')).filter(Boolean)
      .map(s => { const [cohort, sub = ''] = s.split('/'); return { cohort, sub }; });
    const sessions = rows(chunk.slice(chunk.indexOf('MasterTable')))
      .filter(r => r.cols.length >= 6 && r.cols[0] !== 'סמסטר')
      .map(r => ({
        sem: SEM_LETTER[r.cols[0]] ?? r.cols[0],
        day: DAYS[r.cols[1].replace('יום', '').trim()] ?? -1,
        start: r.cols[2],
        end: r.cols[3],
        lecturer: r.cols[4],
        room: r.cols[5].replace(/\s+/g, ' '),
      }))
      .filter(s => s.day >= 0 && /^\d\d:\d\d$/.test(s.start) && /^\d\d:\d\d$/.test(s.end));
    return { iid, ...id, type, lecturer, lang, full, linkedTo, sessions };
  }).filter(Boolean);
  return { name: title ? oneLine(title[1]) : null, groups, ...syllabusBlock(html) };
}
