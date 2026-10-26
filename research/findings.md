# Braude Schedule Builder: Research Findings

Date: 2026-10-26. Scope: research only, no app code yet.
Samples are in `research/samples/`. Helper scripts (Node 24, no dependencies) are in `research/tools/`.

## TL;DR

- **braude.top** is a SvelteKit SSR app. It has no public REST API. All data comes from SvelteKit `__data.json` loaders, encoded in the `devalue` format (decoder: `tools/decode.mjs`). Its data is good: groups, sessions, rooms, exams, syllabus link, per-degree prerequisites, and **`co_requirement_instance_ids`**, which is the lecture↔tutorial/lab linking rule. The catch: search returns **at most 5 courses** and there is **no "list all" call**, so we can't enumerate the catalog through it.
- **2027 סמסטר א exists** on both braude.top and the official yedion. braude.top `availableTimeSpans` = `2026:[א,ב,קיץ,שנתי]`, `2027:[א]`.
- The **official yedion** (`info.braude.ac.il/yedion/fireflyweb.aspx`, Michlol "Firefly") is public with no login. It gives us everything braude.top has, plus the missing pieces:
  - the full semester timetable in **one request** (`S_YFineDate` with "all days");
  - **degree → cohort groups** (`S_GROUP`);
  - **the full curriculum per degree and start year**, with mandatory courses per study year and elective clusters (`S_PROG` → `S_SHOW_PROGS`);
  - per-course details with room, co-requisite groups and descriptions (`S_LOOK_FOR_NOSE`, `S_CourseDetails`);
  - syllabus PDFs at a predictable URL.
- **Neither site sends CORS headers**, and the yedion needs a session cookie to pick the year. **Recommendation: a build-time Node scraper that produces static JSON** (refreshed by a scheduled job), served with the app. No runtime proxy is needed except as an optional "refresh one course" fallback.

---

## 1. braude.top (friend's site)

Stack: SvelteKit (Svelte 5), nginx/Ubuntu, GoatCounter analytics (`stats.braude.top`). Routes come from `entry/app.*.js`:

| Route | Purpose |
|---|---|
| `/` | institute picker (multi-university) |
| `/[institute]` | main timetable plus course search |
| `/[institute]/course/[course_id]` | course info page (syllabus, credits, official link, comments) |
| `/[institute]/rooms` | empty rooms |
| `/[institute]/contact`, `/settings`, `/admin` | misc |
| `/login/google` | Google OAuth; only used to sync saved timetables |

### Endpoints

All of these are `GET`, with `?year=YYYY&semester=<א|ב|קיץ|שנתי>` (URL-encoded Hebrew). The response is `{"type":"data","nodes":[...]}`, where each node's `data` is a devalue-flattened array; run it through `tools/decode.mjs`.

| URL | Params | Response (decoded) | Notes |
|---|---|---|---|
| `https://braude.top/braude/__data.json` | `year`, `semester`, `name-query` (substring), `id-query` (exact course id) | node1: `{availableTimeSpans:[[year,[sem...]]...], year, semester, institute, user, settings}`; node2: `{full_courses: Course[], time_spans: ["08:30",...,"23:50"]}` | **Max 5 results.** `id-query` needs an exact id (`617` returns nothing; `61761` works). Empty query returns `full_courses:[]`. Samples: `search_2027A_netunim*.json`, `search_id_61761.json` |
| `https://braude.top/braude/course/{course_id}/__data.json` | `year`, `semester` | node3: `{course: Course}` with **all** instances, including next semester's | Sample: `course_61761_2027A*.json` |
| `https://braude.top/braude/rooms/__data.json` | `year`, `semester` | `{rooms:[{year,semester,week_day,start_time,end_time,room}]}`: occupied slots per room. The client computes "empty" | Sample: `rooms_2027A*.json` |
| `/braude/api/user/get/data?data_types=["courses","instances","active_instance_ids"]` | cookie | user's saved selections | auth only |
| `/braude/api/user/update/data`, `/api/user/update/settings`, `/braude/api/error` | POST (sendBeacon) | — | auth/telemetry; not needed |

`Course` shape (decoded):

```jsonc
{
  "course_id": 61761, "year": 2027, "name": "כריית נתונים ומערכות לומדות", "description": "",
  "origin_url": "https://info.braude.ac.il/yedion/fireflyweb.aspx?PRGNAME=S_LOOK_FOR_NOSE&ARGUMENTS=-N61761",
  "instances": [{
    "instance_id": "-N61761,-N1,-N1,-N271060430,-N",   // == yedion S_CourseDetails ARGUMENTS
    "instructor": "...", "type": "הרצאה|תרגיל|מעבדה|...", "hours": 3,
    "group_name": "271060430", "credit": 4, "language": "עברית",
    "syllabus_link": "https://info.braude.ac.il/info/2027/0061761.pdf",
    "pre_requirements": [{"major": "הנדסת תוכנה", "options": ["אלגוריתמים"]}],   // per degree; options = OR
    "co_requirement_instance_ids": ["-N61761,-N1,-N9,-N271060430,-N1", ...],   // must take ONE of these with this lecture
    "sessions": [{"semester": "א", "week_day": "ג", "start_time": "14:50", "end_time": "17:50", "room": "702  L"}],
    "exams": [{"exam_round": 1, "date": "2027-2-22 08:30", "exam_type": "בחינה רגילה", "course_type": "הרצאה"}]
  }]
}
```

Semester identity on braude.top is `year` (the Gregorian end-year of the academic year, so 2027 = תשפ"ז) plus `semester` in Hebrew (`א`/`ב`/`קיץ`/`שנתי`).

The official link format is the course's `origin_url`: `https://info.braude.ac.il/yedion/fireflyweb.aspx?PRGNAME=S_LOOK_FOR_NOSE&ARGUMENTS=-N{course_id}`. Its known flaw: with no session it shows the yedion's **default year**, which is 2026 (תשפ"ו) today, not 2027. A per-group deep link is `...PRGNAME=S_CourseDetails&ARGUMENTS={instance_id}`.

The "full syllabus" link on braude.top is just the PDF link (`syllabus_link`) plus `description`. `description` was empty in every sample. The official "פרשיית לימוד" text is richer (see §2).

---

## 2. Official yedion: `https://info.braude.ac.il/yedion/fireflyweb.aspx`

Michlol Firefly is classic form-POST HTML. Request mechanics:
- Every action is a `POST` (form-urlencoded) with `PRGNAME=<program>`, `ARGUMENTS=<comma list of field names>`, plus those fields. Simple GETs like `?prgname=X&arguments=-N...` also work.
- **Year selection is session-scoped.** To get 2027, first call `GET ?prgname=Enter_Search`, then `POST PRGNAME=Enter_Search&ARGUMENTS=-A,,-A,ChangeYear&ChangeYear=2027`, and keep cookies `Yedion.MySession` and `TS0188c6f2` (an F5 bot cookie). Implemented in `tools/ff.mjs`. Without this, pages show 2026.
- Semester codes: `1`=א, `2`=ב, `3`=קיץ, `0`=all. Day codes: `1..6`=א..ו, and `7` = all days and hours.

| PRGNAME | Fields | Returns | Use |
|---|---|---|---|
| `Enter_Search` | — / `ChangeYear` | search home; lists years 2014–2027 and degrees (מגמות) | year switch; degree code list |
| `S_YFineDate` | `R1C7`=sem, `R1C5`=day (7=all), `R1C6`=hour slot | **Whole semester timetable**: one row per session (course id, name, type, semester, day, start, end, lecturer, `S_CourseDetails` link with instance id). 2027א: 1,162 rows, 410 courses, ~800 KB. Additional meeting days appear as "יום נוסף לקורס" sub-rows. **No room column.** | bulk sessions, 1 request |
| `S_LOOK_FOR_NOSE` | `SubjectCode` or `ARGUMENTS=-N{id}` | all groups of the course (both semesters) with session table **including room**, lecturer, "related groups" list, full-flag, language, and the **פרשיית לימוד** (catalog description) | per-course detail; the "official page" |
| `S_CourseDetails` | `ARGUMENTS={instance_id}` | one group: credits, weekly hours, syllabus link, description, **prerequisites per degree**, and **"תנאי קשר לתרגיל/מעבדה"** (the co-requisite group list) | link rule plus prereqs |
| `S_LOOK_FOR_NOSE_AB` | `R1C2`=first letter (א..ת, A..Z) | course id, name, "נלמד / לא נלמד" | full catalog enumeration (about 48 requests) |
| `S_GROUP` | `R1C8`=degree code | cohort groups of that degree, e.g. `271060310 הנדסת תכנה ג` | degree → cohorts |
| `S_GROUP_HOURS` | `ARGUMENTS=-N{cohort}` | weekly grid for that cohort | "recommended timetable" per year |
| `S_MASLUL` | `R1C9`=degree code | form: starting year → `S_PROG` | — |
| `S_PROG` | `HUG`=degree, `R1C1`=start year, `R1C2`=(empty OK) | list of program sections: "תוכנה שנה א..ד חובה", "אשכול אלגוריתמים", "אשכול מעבדות", ... each with `S_SHOW_PROGS -N{startYear},-N{progCode}` | **curriculum** |
| `S_SHOW_PROGS` | `ARGUMENTS=-N{startYear},-N{progCode}` | course list of that section (id, name, offered this year?, description) | degree ↔ course mapping |
| `S_EXAMS` | `R1C28` degree, `R1C29` sem, `R1C30` study year | exam dates (returned no data for 2027א yet) | exams |
| `S_Room_Order`, `S_GROUP` (date variant: `R1C20,R1C21,R1C22`) | room/date | room bookings by date | optional |
| `JSON` `Action=700` | `Faculty`, `Year` | meant to list tracks. **Currently returns a server error even from the site's own page**; `S_PROG` works with an empty `R1C2` anyway | ignore |

Degree codes (`R1C8`/`HUG`): 2 מכונות, 3 חשמל ואלקטרוניקה, 4 ביוטכנולוגיה, 5 תעשייה וניהול, 6 תוכנה, 7 מערכות מידע, 8 הוראה, 20 מתמטיקה שימושית, 39 אופטית, 24 חוג כללי; M.Sc.: 51, 52, 54, 55, 56; 50 השלמה. Full cohort list for 2027: `samples/degree_groups_2027.json`.

**Cohort/group code anatomy** (from samples): `27 1 06 0 3 10` is the year (27), level (1=B.Sc., 3=M.Sc.), degree (06=software, 07=IS, 02=mech, 03=EE, 04x=biotech, 05=IEM, 20=math), study year (3), and track/sub-cohort (10/30=fall/spring intake). A course group's `group_name` (before `/`) **is the cohort code it is scheduled for**. For example, 61761 has groups `271060430` (software, year 4) and `271070430` (IS, year 4), so one course maps to several degrees.

Instance id anatomy: `-N{course},-N{semester 1/2/3},-N{type 1=lecture, 8=lab, 9=tutorial, ...},-N{cohort},-N{subgroup}`.

Syllabus PDF: `https://info.braude.ac.il/info/{year}/{course_id zero-padded to 7}.pdf`, e.g. `/info/2027/0061761.pdf` (application/pdf, ~200 KB, publicly fetchable).

Semester ב 2027: `S_YFineDate` returns 0 rows so far, but per-course pages already list some `-N2` groups. So it is partially published.

---

## 3. Gap analysis

| Goal | braude.top | Gap | Official source and approach |
|---|---|---|---|
| **(a) Filter by degree, course in several degrees** | Only indirect: `pre_requirements[].major` (missing for courses with no prereqs) | No degree→course list; can't enumerate courses at all (5-result cap) | **Primary:** `S_PROG`(degree, start year) → `S_SHOW_PROGS` per section, which gives mandatory courses per study year plus elective clusters. **Secondary (always available):** cohort code in each group's `group_name`, mapped through `S_GROUP`. A course belongs to every degree whose cohort appears in its groups, which gives degree **and** study year for free. Merge both. |
| **(b) Full syllabus in-app plus official link** | `syllabus_link` (PDF) and `origin_url` | `description` empty; the official link opens the wrong year | Description: "פרשיית לימוד" from `S_LOOK_FOR_NOSE`/`S_SHOW_PROGS`. Syllabus: embed the PDF in `<iframe>`/pdf.js through our proxy or a cached copy, because the yedion sends no CORS and an iframe may hit X-Frame/F5 limits (untested), or link out. Official link: use `S_CourseDetails&ARGUMENTS={instance_id}`, which encodes the year in the cohort, or keep `S_LOOK_FOR_NOSE` and note the year caveat. |
| **(c) Auto optimizer** | Has sessions per group and `co_requirement_instance_ids` | Only per course on demand | Bulk: `S_YFineDate` (all sessions, one request) plus `S_LOOK_FOR_NOSE` per selected course for rooms and linked groups (or braude.top's `/course/{id}/__data.json`, which already has `co_requirement_instance_ids`). **Rule:** a student picks one lecture group per course (type 1). If that lecture has `co_requirement_instance_ids`, they must pick exactly one of them. Linked groups are listed per required type, so if a lecture links both tutorials (type 9) and labs (type 8), pick one per type. Groups of other types that no lecture links are standalone (one per type). Groups with several sessions (the "יום נוסף" rows) must be taken whole. |

---

## 4. Rate limits, auth, CORS

- **CORS:** neither `braude.top` nor `info.braude.ac.il` returns `Access-Control-Allow-Origin`, so a browser app on our domain **cannot** call either directly.
- **Auth:** none for any data endpoint we need. The yedion year switch needs a session cookie, and there is an F5 BIG-IP ASM cookie (`TS0188c6f2`), so keep a cookie jar, a normal UA, and low concurrency.
- **Rate:** no published limits, no robots.txt on either host (404). I used about 1–2 requests/second; please keep the scraper at **≤1 request/second, sequential**. A full scrape is about 48 letter pages + ~450 course pages + ~15 degrees × ~10 program pages ≈ 650 requests (≈11 min at 1 r/s). Run it nightly or weekly at most.
- braude.top is a friend's personal server. Use it as a cross-check or fallback, not as the primary bulk source.

## 5. Recommended data architecture

```
scraper (Node, scheduled e.g. GitHub Action nightly)
  1. setYear(Y) per target year (default 2027)
  2. S_YFineDate sem=1,2,3 day=7         -> sessions skeleton + instance ids
  3. S_LOOK_FOR_NOSE per course id       -> rooms, linked groups, description, full flag
     (or S_CourseDetails per lecture instance -> co-requisites + prereqs)
  4. S_GROUP per degree                  -> cohorts {code, name, degree, studyYear}
  5. S_PROG/S_SHOW_PROGS per degree x start year -> curriculum sections (mandatory per year, clusters)
  6. build syllabus URL /info/{Y}/{id:07}.pdf (HEAD-check)
  -> emit static JSON: data/{year}-{sem}/courses.json, degrees.json, curriculum/{degree}-{startYear}.json, rooms.json
static frontend (any framework) loads JSON, runs the optimizer client-side (Web Worker)
optional tiny proxy (Cloudflare Worker) for syllabus PDF / on-demand refresh of one course
```

Normalized model: `Course{id,name,credits,description,syllabusUrl,officialUrl,degrees[{degree,studyYear,mandatory|cluster}]}` → `Group{instanceId,courseId,semester,type,cohort,subgroup,lecturer,language,full,links:[instanceId]}` → `Session{day,start,end,room}`. The optimizer chooses one lecture group per course plus the required linked groups, using hard constraints (no overlap, user's blocked day) and soft scoring (fewer days, gaps, earliest/latest hour, balance).

Default semester in the app: **2027 / א**.

## Files

- `samples/braude_page.html`, `bundles/` (all 30 JS chunks), and the braude.top `__data.json` samples (raw plus `.decoded.json`)
- `samples/ff_*.html`, which are yedion pages: `ff_dayhour_A_all.html` (whole 2027א timetable), `ff_nose_2027.html`, `yedion_coursedetails.html`, `ff_group_*`, `ff_prog_*`, `ff_show_progs_2025_60752.html`, `ff_letter_kaf_2027.html`
- `samples/degree_groups_2027.json`, `samples/syllabus_0061761_2027.pdf`
- `tools/ff.mjs` (Firefly client with year switch), `decode.mjs` (devalue), `parse_all.mjs` (timetable parser, which does not yet handle "יום נוסף" rows)
