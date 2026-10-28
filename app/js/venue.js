// The venue setup code: what a manager shares so staff can set up with the venue's pay schedule, jobs and tip-outs.
// It carries NO personal pay data (no gross pay, deductions or staff names). Pure (no DOM); the screens are ui/team.js
// (the manager) and ui/join.js (staff).
//
// A venue, as the app uses it (readable keys), and as it travels (short keys):
//   {id, name, freq, start, end, delay, jobs: [{id?, k, name, rate (cents), unit: 'hr'|'shift'}],
//    tipouts: [{id?, k, who, mode: 'pctTips'|'flat', value (hundredths: 1500 = 15% or $15.00), from: 'cash'|'payroll'}]}
//   {v:2, i, n, f, s, e, d, j: [{x, k, n?, r, u: 'h'|'s'}], t: [{x, k, w, m: 'p'|'f', a, c: 'c'|'p'}]}
// Version 2 gives every job and tip-out a short stable id (x: 1 to 4 of a-z, 0-9; j1, j2... t1, t2...), made when the
// manager adds the row and kept when it is renamed, so a worker's phone can tell a renamed job from a new one. Version 1
// (no ids) is still read, and a venue without ids is still made as version 1. Ids are all there or all missing.
import { parseISO, periodRange, calendarMode, dayDiff, JOB_PRESETS, TIPOUT_PRESETS } from './math.js';
import { b64urlEncode, bytesToB64url, readCode, intIn, nameIn, dateIn } from './codec.js';

export const VENUE_VERSION = 2;
export const VENUE_VERSION_1 = 1;
/** The most a venue code may hold (the JSON, in bytes). A bigger one is refused when made and when read. */
export const MAX_VENUE_BYTES = 1500;
export const MAX_VENUE_JOBS = 8;
export const MAX_VENUE_TIPOUTS = 10;
export const MAX_VENUE_NAME = 40;
export const MAX_RATE_CENTS = 1000000; // $10,000 an hour or a shift: more is a typo
export const MAX_FLAT_CENTS = 100000; // $1,000 flat a night
export const MAX_PCT_HUNDREDTHS = 10000; // 100%
export const FREQS = [7, 14, 15, 30, 'semimonthly', 'monthly'];
export const FREQ_TEXT = {
  7: 'Every week',
  14: 'Every two weeks',
  15: 'Every 15 days',
  30: 'Every 30 days',
  semimonthly: 'Twice a month',
  monthly: 'Once a month',
};
export const VENUE_ID_RE = /^[A-Za-z0-9_-]{10,16}$/;
/** A job's or tip-out's stable id inside a venue (and a pay type's `vj`, a tip-out's `vt`): 1 to 4 of a-z and 0-9. */
export const ROW_ID_RE = /^[a-z0-9]{1,4}$/;
export const validRowId = (v) => typeof v === 'string' && ROW_ID_RE.test(v);
export const TOO_BIG_VENUE =
  'This venue code is too long to share. Remove a job or a tip-out, or shorten the names.';
export const BAD_LINK_MSG =
  'This link isn’t a TipNet Teams venue code (or it’s from a newer version). Nothing was changed.';

/** A job kind a venue may use: the job presets Setup offers (Bartender, Server, Other job...). */
const JOB_KEYS = JOB_PRESETS.map((x) => x.k);
/** Job kinds that ask for a name of their own in Setup. */
export const NAMED_JOB_KEYS = ['otherjob', 'hourly', 'shift'];
const TIPOUT_KEYS = TIPOUT_PRESETS.map((x) => x.k);
const presetName = (k) => (JOB_PRESETS.find((x) => x.k === k) || {}).name || '';

/** A new venue id: 12 characters of base64url from crypto.getRandomValues (72 random bits). Made once per manager device. */
export function newVenueId() {
  const bytes = new Uint8Array(9);
  globalThis.crypto.getRandomValues(bytes);
  return bytesToB64url(bytes); // 9 bytes = exactly 12 characters
}

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * A venue reference ({id, name}) or null: the one validator for a venue kept on an establishment (loading, restoring a
 * backup, joining) and for the venue a tip sheet names. id: 10 to 16 characters of letters, digits, _ and -. name: text
 * without control characters, trimmed and cut to 40 characters (never refused for length alone). Anything else is
 * dropped, so a hand-made backup or link cannot put odd text in a checkout link or on a screen.
 */
export function cleanVenueRef(v) {
  if (!isObj(v) || typeof v.id !== 'string' || !VENUE_ID_RE.test(v.id)) return null;
  if (typeof v.name !== 'string' || v.name.length > MAX_VENUE_NAME * 10) return null;
  const name = nameIn(Array.from(v.name.trim()).slice(0, MAX_VENUE_NAME).join(''), MAX_VENUE_NAME);
  return name ? { id: v.id, name } : null;
}

/** A row's stable id: '' when there is none, null when it is not allowed (wrong shape or already used), else the id. */
function rowIdIn(v, seen) {
  if (v === undefined || v === '') return '';
  if (!validRowId(v) || seen.has(v)) return null;
  seen.add(v);
  return v;
}

/**
 * Checks a venue in readable form and returns a clean copy, or null. Strict: every field's type, length, range and
 * allowed values are checked, unknown keys are ignored, dates must be real days. The calendar frequencies (twice a
 * month, once a month) take their period end from the calendar, as Setup does.
 */
export function checkVenue(raw) {
  if (!isObj(raw)) return null;
  const id = typeof raw.id === 'string' && VENUE_ID_RE.test(raw.id) ? raw.id : undefined;
  const name = nameIn(raw.name, MAX_VENUE_NAME);
  const freq = FREQS.includes(raw.freq) ? raw.freq : undefined;
  const start = dateIn(raw.start, parseISO);
  let end = dateIn(raw.end, parseISO);
  const delay = intIn(raw.delay, 0, 21);
  if (!id || !name || freq === undefined || !start || !end || delay === undefined) return null;
  if (calendarMode({ periodStart: start, freq })) end = periodRange({ periodStart: start, freq }, 0).end;
  else {
    const len = dayDiff(start, end) + 1;
    if (!(len >= 1 && len <= 62)) return null;
  }
  if (!Array.isArray(raw.jobs) || raw.jobs.length < 1 || raw.jobs.length > MAX_VENUE_JOBS) return null;
  const jobs = [];
  const jobIds = new Set();
  for (const j of raw.jobs) {
    if (!isObj(j) || !JOB_KEYS.includes(j.k)) return null;
    const rowId = rowIdIn(j.id, jobIds);
    if (rowId === null) return null;
    const rate = intIn(j.rate, 1, MAX_RATE_CENTS);
    if (rate === undefined || (j.unit !== 'hr' && j.unit !== 'shift')) return null;
    let jobName = presetName(j.k);
    if (NAMED_JOB_KEYS.includes(j.k)) {
      jobName = nameIn(j.name, MAX_VENUE_NAME);
      if (!jobName) return null;
    }
    jobs.push(
      rowId
        ? { id: rowId, k: j.k, name: jobName, rate, unit: j.unit }
        : { k: j.k, name: jobName, rate, unit: j.unit },
    );
  }
  if (!Array.isArray(raw.tipouts) || raw.tipouts.length > MAX_VENUE_TIPOUTS) return null;
  const tipouts = [];
  const tipIds = new Set();
  for (const t of raw.tipouts) {
    if (!isObj(t) || !TIPOUT_KEYS.includes(t.k)) return null;
    const rowId = rowIdIn(t.id, tipIds);
    if (rowId === null) return null;
    const who = nameIn(t.who, MAX_VENUE_NAME);
    if (!who || (t.mode !== 'pctTips' && t.mode !== 'flat') || (t.from !== 'cash' && t.from !== 'payroll'))
      return null;
    const value = intIn(t.value, 1, t.mode === 'flat' ? MAX_FLAT_CENTS : MAX_PCT_HUNDREDTHS);
    if (value === undefined) return null;
    tipouts.push(
      rowId
        ? { id: rowId, k: t.k, who, mode: t.mode, value, from: t.from }
        : { k: t.k, who, mode: t.mode, value, from: t.from },
    );
  }
  // ids are all there or all missing: a half-numbered venue is not a venue
  const rows = [...jobs, ...tipouts];
  if (rows.some((r) => r.id) && rows.some((r) => !r.id)) return null;
  return { id, name, freq, start, end, delay, jobs, tipouts };
}

/** The venue in its short travelling form. */
function toWire(v) {
  const ids = [...v.jobs, ...v.tipouts].length > 0 && [...v.jobs, ...v.tipouts].every((r) => r.id);
  const withId = (r, o) => (ids ? { x: r.id, ...o } : o);
  return {
    v: ids ? VENUE_VERSION : VENUE_VERSION_1,
    i: v.id,
    n: v.name,
    f: v.freq,
    s: v.start,
    e: v.end,
    d: v.delay,
    j: v.jobs.map((j) => {
      const o = withId(j, { k: j.k, r: j.rate, u: j.unit === 'hr' ? 'h' : 's' });
      if (NAMED_JOB_KEYS.includes(j.k)) o.n = j.name;
      return o;
    }),
    t: v.tipouts.map((t) =>
      withId(t, {
        k: t.k,
        w: t.who,
        m: t.mode === 'flat' ? 'f' : 'p',
        a: t.value,
        c: t.from === 'payroll' ? 'p' : 'c',
      }),
    ),
  };
}
/** The short form back to readable keys (checkVenue then decides whether it is allowed). */
function fromWire(w) {
  if (!Array.isArray(w.j) || !Array.isArray(w.t)) return null;
  const v2 = w.v === VENUE_VERSION;
  // version 2: every row has an id (a missing one is null, which checkVenue refuses); version 1: none, whatever is sent
  const rid = (r) => (v2 ? (r.x === undefined ? null : r.x) : undefined);
  const unit = (u) => (u === 'h' ? 'hr' : u === 's' ? 'shift' : null);
  const jobs = w.j.map((j) =>
    isObj(j) ? { id: rid(j), k: j.k, name: j.n, rate: j.r, unit: unit(j.u) } : null,
  );
  const tipouts = w.t.map((t) =>
    isObj(t)
      ? {
          id: rid(t),
          k: t.k,
          who: t.w,
          mode: t.m === 'f' ? 'flat' : t.m === 'p' ? 'pctTips' : null,
          value: t.a,
          from: t.c === 'p' ? 'payroll' : t.c === 'c' ? 'cash' : null,
        }
      : null,
  );
  return checkVenue({ id: w.i, name: w.n, freq: w.f, start: w.s, end: w.e, delay: w.d, jobs, tipouts });
}

/** The code (base64url) for a venue, or Error('too-big') when its JSON is over MAX_VENUE_BYTES. */
export function encodeVenue(venue) {
  const v = checkVenue(venue);
  if (!v) throw new Error('bad-venue');
  const text = JSON.stringify(toWire(v));
  if (new TextEncoder().encode(text).length > MAX_VENUE_BYTES) throw new Error('too-big');
  return b64urlEncode(text);
}

/** The venue a code holds (clean, readable form), or null: not a venue code, a newer version, or anything not allowed. */
export function decodeVenue(data) {
  const w = readCode(data, MAX_VENUE_BYTES);
  if (!w || (w.v !== VENUE_VERSION && w.v !== VENUE_VERSION_1)) return null;
  return fromWire(w);
}

/** The share link: the page's address with the code in the fragment. loc: {origin, pathname}. */
export function venueLink(venue, loc = globalThis.location) {
  return loc.origin + loc.pathname + '#join=' + encodeVenue(venue);
}

/** What someone pasted (the whole link, or just the code after #join=) as a venue, or null. */
export function venueFromText(text) {
  const t = String(text == null ? '' : text).replace(/\s+/g, '');
  const m = /#join=([^#]*)/.exec(t);
  return decodeVenue(m ? m[1] : t);
}

/* ---------- a venue as a pay setup ---------- */
const key = (s) =>
  String(s || '')
    .trim()
    .toLowerCase();
/**
 * The venue's jobs as pay types (jobs only: the first is the main job). existing: the establishment's pay types when it
 * is updated, isJob(type, index) says which of them are jobs. A job already there with the same venue id (vj), else the
 * same name, keeps its id (so the nights that used it still count); every pay type that is not a job (overtime, bonus...)
 * stays after the venue's jobs. A job made from a venue job that has an id stores it as vj.
 * (The Update preview, which lets the worker keep their own names and rates, is planVenueUpdate / applyVenueUpdate.)
 */
export function venuePayTypes(venue, existing = [], isJob = () => false) {
  const old = Array.isArray(existing) ? existing : [];
  const kept = new Set();
  const matched = venue.jobs.map(() => null);
  const claim = (at, i) => {
    kept.add(old[at].id);
    matched[i] = old[at].id;
  };
  venue.jobs.forEach((j, i) => {
    const at = j.id ? old.findIndex((t, n) => !kept.has(t.id) && isJob(t, n) && t.vj === j.id) : -1;
    if (at >= 0) claim(at, i);
  });
  venue.jobs.forEach((j, i) => {
    if (matched[i]) return;
    const at = old.findIndex(
      (t, n) => !kept.has(t.id) && isJob(t, n) && key(t.name || presetName(t.k)) === key(j.name),
    );
    if (at >= 0) claim(at, i);
  });
  const taken = new Set(old.map((t) => t.id)); // an old id stays reserved: a removed job may come back retired
  let n = 1;
  const out = venue.jobs.map((j, i) => {
    let id = matched[i];
    if (!id) {
      while (taken.has('p' + n)) n++;
      id = 'p' + n;
      taken.add(id);
    }
    const t = { id, k: j.k, name: j.name, rate: j.rate / 100, unit: j.unit, usual: 0 };
    if (j.id) t.vj = j.id;
    return t;
  });
  old.forEach((t, i) => {
    if (!isJob(t, i)) out.push(t);
  });
  return out;
}
/**
 * The venue's tip-outs as Setup stores them: {on, list} (on when there is anyone). A person already there (the same venue
 * id, vt, else the same kind and name) keeps their id, so their ticks on saved nights carry over. A tip-out made from a
 * venue tip-out that has an id stores it as vt.
 */
export function venueTipouts(venue, existing = []) {
  const old = Array.isArray(existing) ? existing : [];
  const used = new Set();
  const taken = new Set(old.map((t) => t.id));
  const found = venue.tipouts.map(() => -1);
  venue.tipouts.forEach((t, i) => {
    const at = t.id ? old.findIndex((o) => !used.has(o.id) && o.vt === t.id) : -1;
    if (at >= 0) {
      used.add(old[at].id);
      found[i] = at;
    }
  });
  venue.tipouts.forEach((t, i) => {
    if (found[i] >= 0) return;
    const at = old.findIndex((o) => !used.has(o.id) && o.k === t.k && key(o.who) === key(t.who));
    if (at >= 0) {
      used.add(old[at].id);
      found[i] = at;
    }
  });
  let n = 1;
  const list = venue.tipouts.map((t, i) => {
    let id;
    if (found[i] >= 0) id = old[found[i]].id;
    else {
      while (taken.has('t' + n)) n++;
      id = 't' + n;
      taken.add(id);
    }
    const o = { id, k: t.k, who: t.who, mode: t.mode, value: t.value / 100, from: t.from };
    if (t.id) o.vt = t.id;
    return o;
  });
  return { on: list.length > 0, list };
}

/* ---------- updating a worker's setup from a venue: a preview the worker confirms ---------- */
/** How a pay type is called on screen: its own name, else its preset's. */
export const payTypeName = (t) => t.name || presetName(t.k) || 'Job';
const sameRate = (mine, j) =>
  Math.round(Number(mine.rate || 0) * 100) === j.rate && (mine.unit === 'shift' ? 'shift' : 'hr') === j.unit;
/**
 * Which of the worker's jobs each venue job is, before the worker fixes anything: by venue id (vj) first, then by name
 * (case-insensitive, trimmed), else null (a new job). mine: the worker's jobs (not retired, not other pay), in order.
 * Returns one pay type id or null per venue job. A job is matched once.
 */
export function autoMatchJobs(venue, mine) {
  const taken = new Set();
  const out = venue.jobs.map(() => null);
  venue.jobs.forEach((j, i) => {
    if (!j.id) return;
    const t = mine.find((x) => !taken.has(x.id) && x.vj === j.id);
    if (t) {
      taken.add(t.id);
      out[i] = t.id;
    }
  });
  venue.jobs.forEach((j, i) => {
    if (out[i]) return;
    const t = mine.find((x) => !taken.has(x.id) && key(payTypeName(x)) === key(j.name));
    if (t) {
      taken.add(t.id);
      out[i] = t.id;
    }
  });
  return out;
}
/**
 * What an update from a venue would do, for the preview. Pure.
 *  mine: the worker's jobs (pay types that are jobs and not retired, main job first); people: their tip-out list.
 *  choices (all optional): match[i] = a pay type id or 'new' (the worker's pick for venue job i, else the automatic
 *  match), useVenue[i] = true to take the venue's rate, newRate[i] = the rate (dollars) of a new job,
 *  remove = ids of the worker's own jobs to take out.
 * Returns {jobs: [{index, vjob, matchId, mine, differs, useVenue, link, newRate}], kept (the worker's jobs the venue
 *  doesn't list), remove (a Set of ids), tipouts: {added, changed: [{before, after}], removed}, changes (how many things
 *  Apply would do)}. Two venue jobs never end up on the same worker job: the later one is a new job.
 */
export function planVenueUpdate(venue, mine, people, choices = {}) {
  const auto = autoMatchJobs(venue, mine);
  const pick = choices.match || [];
  const taken = new Set();
  const jobs = venue.jobs.map((vjob, index) => {
    let matchId = pick[index] !== undefined ? pick[index] : auto[index];
    if (matchId === 'new' || !mine.some((t) => t.id === matchId) || taken.has(matchId)) matchId = null;
    if (matchId) taken.add(matchId);
    const m = matchId ? mine.find((t) => t.id === matchId) : null;
    const differs = !!m && !sameRate(m, vjob);
    // a rate of 0 is not a rate yet: the venue's is the sensible start
    const useVenue = !!m && differs && ((choices.useVenue || [])[index] ?? !(Number(m.rate) > 0));
    const rate = (choices.newRate || [])[index];
    return {
      index,
      vjob,
      matchId,
      mine: m,
      differs,
      useVenue,
      link: !!m && !!vjob.id && m.vj !== vjob.id,
      newRate: Number.isFinite(rate) && rate > 0 ? Math.round(rate * 100) / 100 : vjob.rate / 100,
    };
  });
  const kept = mine.filter((t) => !taken.has(t.id));
  const main = mine[0] ? mine[0].id : null;
  const remove = new Set((choices.remove || []).filter((id) => id !== main && kept.some((t) => t.id === id)));
  const oldTo = Array.isArray(people) ? people : [];
  const next = venueTipouts(venue, oldTo).list;
  const nextIds = new Set(next.map((r) => r.id));
  const added = next.filter((r) => !oldTo.some((o) => o.id === r.id));
  const changed = next
    .map((after) => ({ before: oldTo.find((o) => o.id === after.id), after }))
    .filter(
      ({ before: o, after: r }) =>
        o &&
        (o.k !== r.k ||
          key(o.who) !== key(r.who) ||
          o.mode !== r.mode ||
          Math.round(Number(o.value || 0) * 100) !== Math.round(r.value * 100) ||
          o.from !== r.from ||
          (r.vt && o.vt !== r.vt)),
    );
  const removed = oldTo.filter((o) => !nextIds.has(o.id));
  const jobChanges = jobs.filter((j) => !j.matchId || j.useVenue || j.link).length + remove.size;
  return {
    jobs,
    kept,
    remove,
    tipouts: { added, changed, removed },
    changes: jobChanges + added.length + changed.length + removed.length,
  };
}
/**
 * The worker's pay types after an update (the same choices as planVenueUpdate). Matched jobs keep their own id, name and
 * rate (the venue's rate and unit only when chosen) and get the venue job's id as vj; new venue jobs are added after the
 * worker's jobs with their (editable) rate; jobs the venue doesn't list stay unless removed; other pay stays. Pure: a new
 * list. The caller retires what a saved night used (math.keepUsedPay).
 */
export function applyVenueUpdate(venue, pay, isJob, choices = {}) {
  const old = Array.isArray(pay) ? pay : [];
  const plan = planVenueUpdate(
    venue,
    old.filter((t, i) => isJob(t, i)),
    [],
    choices,
  );
  const byId = new Map(plan.jobs.filter((j) => j.matchId).map((j) => [j.matchId, j]));
  const taken = new Set(old.map((t) => t.id));
  let n = 1;
  const nextId = () => {
    while (taken.has('p' + n)) n++;
    taken.add('p' + n);
    return 'p' + n;
  };
  const out = [];
  old.forEach((t, i) => {
    if (!isJob(t, i) || plan.remove.has(t.id)) return;
    const j = byId.get(t.id);
    if (!j) return out.push(t);
    const o = { ...t };
    if (j.useVenue) {
      o.rate = j.vjob.rate / 100;
      o.unit = j.vjob.unit;
    }
    if (j.vjob.id) o.vj = j.vjob.id;
    out.push(o);
  });
  plan.jobs
    .filter((j) => !j.matchId)
    .forEach((j) => {
      const t = {
        id: nextId(),
        k: j.vjob.k,
        name: j.vjob.name,
        rate: j.newRate,
        unit: j.vjob.unit,
        usual: 0,
      };
      if (j.vjob.id) t.vj = j.vjob.id;
      out.push(t);
    });
  old.forEach((t, i) => {
    if (!isJob(t, i)) out.push(t);
  });
  return out;
}

/* ---------- what a manager's device keeps (settings.team) ---------- */
/** TipNet Teams covers up to 50 staff per location: the staff list and a tip sheet hold at most 50 people. */
export const MAX_STAFF = 50;
export const MAX_STAFF_NAME = 24;
export const MAX_POINTS = 100000; // hundredths: 1000 points

/** The staff list kept on the manager's device: [{name, role, points (hundredths), vj?}], cleaned. vj: the venue job picked as the role. */
export function cleanStaff(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const s of list) {
    if (!isObj(s) || out.length >= MAX_STAFF) continue;
    const name = nameIn(s.name, MAX_STAFF_NAME);
    if (!name) continue;
    const role = s.role === '' || s.role == null ? '' : nameIn(s.role, MAX_STAFF_NAME);
    const row = { name, role: role || '', points: intIn(s.points, 0, MAX_POINTS) ?? 100 };
    if (validRowId(s.vj)) row.vj = s.vj;
    out.push(row);
  }
  return out;
}
/**
 * settings.team: {venueId?, venue? (the last venue code made, as it was), staff?: [...], jSeq?, tSeq?}. Anything not valid is dropped;
 * null when nothing is left. The id stays with the manager's device so a re-made code keeps the same venue.
 */
export function cleanTeam(t) {
  if (!isObj(t)) return null;
  const out = {};
  const venue = checkVenue(t.venue);
  if (venue) {
    out.venue = venue;
    out.venueId = venue.id;
  } else if (typeof t.venueId === 'string' && VENUE_ID_RE.test(t.venueId)) out.venueId = t.venueId;
  const name = nameIn(t.name, MAX_VENUE_NAME); // the venue name last typed, for a tip sheet made before any venue code
  if (name) out.name = name;
  const staff = cleanStaff(t.staff);
  if (staff.length) out.staff = staff;
  // the last number used for a new job's or tip-out's id (j7, t3...): ids are never handed out twice
  for (const k of ['jSeq', 'tSeq']) {
    const n = intIn(t[k], 1, 999);
    if (n !== undefined) out[k] = n;
  }
  return Object.keys(out).length ? out : null;
}
