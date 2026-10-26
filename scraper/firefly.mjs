// Client for Braude's public yedion (Michlol "Firefly"): https://info.braude.ac.il/yedion/fireflyweb.aspx
// - The academic year is held in a server session, so we keep a cookie jar and switch year once.
// - Requests are sequential and rate-limited; raw HTML is cached in ./cache so reruns are cheap.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const BASE = 'https://info.braude.ac.il/yedion/fireflyweb.aspx';
const UA = 'Mozilla/5.0 (braude-schedule builder; polite scraper, ~1 req/s)';

export class Firefly {
  constructor({ year, cacheDir, delayMs = 1000, maxAgeHours = 20, fresh = false, log = console.log }) {
    this.year = String(year);
    this.cacheDir = cacheDir;
    this.delayMs = delayMs;
    this.maxAgeMs = maxAgeHours * 3600e3;
    this.fresh = fresh;
    this.log = log;
    this.jar = {};
    this.yearSet = false;
    this.lastRequest = 0;
    this.stats = { live: 0, cached: 0 };
    fs.mkdirSync(cacheDir, { recursive: true });
  }

  cookieHeader() {
    return Object.entries(this.jar).map(([k, v]) => `${k}=${v}`).join('; ');
  }

  storeCookies(res) {
    for (const c of res.headers.getSetCookie?.() ?? []) {
      const kv = c.split(';')[0];
      const i = kv.indexOf('=');
      this.jar[kv.slice(0, i)] = kv.slice(i + 1);
    }
  }

  async throttle() {
    const wait = this.lastRequest + this.delayMs - Date.now();
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    this.lastRequest = Date.now();
  }

  async rawFetch(method, query, fields) {
    for (let attempt = 1; ; attempt++) {
      await this.throttle();
      try {
        const opts = {
          method,
          redirect: 'follow',
          headers: { 'user-agent': UA, cookie: this.cookieHeader() },
        };
        if (fields) {
          opts.headers['content-type'] = 'application/x-www-form-urlencoded';
          opts.body = new URLSearchParams(fields);
        }
        const res = await fetch(query ? `${BASE}?${query}` : BASE, opts);
        this.storeCookies(res);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        this.stats.live++;
        return await res.text();
      } catch (err) {
        if (attempt >= 4) throw err;
        this.log(`  ! ${err.message} - retry ${attempt}`);
        await new Promise(r => setTimeout(r, 2000 * 2 ** attempt));
      }
    }
  }

  async ensureYear() {
    if (this.yearSet) return;
    await this.rawFetch('POST', null, { PRGNAME: 'Enter_Search', ARGUMENTS: '-A,,-A,ChangeYear', ChangeYear: this.year });
    this.yearSet = true;
  }

  cacheFile(key) {
    const h = crypto.createHash('sha1').update(`${this.year}|${key}`).digest('hex').slice(0, 16);
    return path.join(this.cacheDir, `${this.year}-${h}.html`);
  }

  async cached(key, run) {
    const file = this.cacheFile(key);
    if (!this.fresh && fs.existsSync(file) && Date.now() - fs.statSync(file).mtimeMs < this.maxAgeMs) {
      this.stats.cached++;
      return fs.readFileSync(file, 'utf8');
    }
    await this.ensureYear();
    const html = await run();
    fs.writeFileSync(file, html);
    return html;
  }

  /** POST a Firefly program with form fields; ARGUMENTS is the comma list of field names. */
  post(prgname, fields = {}) {
    const body = { PRGNAME: prgname, ARGUMENTS: Object.keys(fields).join(','), ...fields };
    return this.cached(`POST ${JSON.stringify(body)}`, () => this.rawFetch('POST', null, body));
  }

  /** GET a Firefly program with a raw ARGUMENTS string, e.g. "-N61761". */
  get(prgname, args) {
    const q = `prgname=${prgname}&arguments=${args}`;
    return this.cached(`GET ${q}`, () => this.rawFetch('GET', q));
  }

  /** The search home page (lists degrees and letters) for the session year. */
  home() {
    return this.cached('home', () => this.rawFetch('GET', 'prgname=Enter_Search'));
  }
}
