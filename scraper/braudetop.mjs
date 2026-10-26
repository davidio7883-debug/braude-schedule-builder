// Fallback source: braude.top (a friend's SvelteKit site). Its __data.json loaders return "devalue"-packed data.
const BASE = 'https://braude.top/braude';
const SEM_NAME = { '1': 'א', '2': 'ב', '3': 'קיץ' };
const DAYS = { 'א': 0, 'ב': 1, 'ג': 2, 'ד': 3, 'ה': 4, 'ו': 5 };

function unflatten(values) {
  const hydrated = new Array(values.length);
  const hydrate = i => {
    if (i < 0) return undefined;
    if (i in hydrated) return hydrated[i];
    const v = values[i];
    if (!v || typeof v !== 'object') return (hydrated[i] = v);
    if (Array.isArray(v)) {
      if (typeof v[0] === 'string') return (hydrated[i] = v); // special types (Date/Map/...) are not used by these loaders
      const a = (hydrated[i] = []);
      v.forEach((x, k) => (a[k] = hydrate(x)));
      return a;
    }
    const o = (hydrated[i] = {});
    for (const k in v) o[k] = hydrate(v[k]);
    return o;
  };
  return hydrate(0);
}

/** Returns groups in the same shape as parse.courseGroups(), or null. */
export async function fetchCourse(courseId, year, sem = '1') {
  const url = `${BASE}/course/${courseId}/__data.json?year=${year}&semester=${encodeURIComponent(SEM_NAME[sem])}`;
  const res = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 (braude-schedule builder)' } });
  if (!res.ok) return null;
  const json = await res.json();
  const course = json.nodes?.map(n => (n?.type === 'data' ? unflatten(n.data) : null)).find(d => d?.course)?.course;
  if (!course) return null;
  return {
    name: course.name,
    description: course.description || '',
    credits: course.instances.find(i => i.credit)?.credit ?? null,
    groups: course.instances.map(i => {
      const [, semCode, typeCode, cohort, sub] = i.instance_id.split(',').map(p => p.replace(/^-N/, ''));
      return {
        iid: i.instance_id, course: String(courseId), sem: semCode, typeCode, cohort, sub: sub || '',
        type: i.type, lecturer: i.instructor, lang: i.language, full: false,
        linkedIds: i.co_requirement_instance_ids || [],
        sessions: i.sessions.map(s => ({
          sem: Object.keys(SEM_NAME).find(k => SEM_NAME[k] === s.semester) ?? semCode,
          day: DAYS[s.week_day] ?? -1, start: s.start_time, end: s.end_time, lecturer: i.instructor, room: s.room,
        })).filter(s => s.day >= 0),
      };
    }),
  };
}
