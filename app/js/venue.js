// The venue setup code: what a manager shares so staff can set up with the venue's pay schedule, jobs and tip-outs.
// It carries NO personal pay data (no gross pay, deductions or staff names). Pure (no DOM); the screens are ui/team.js
// (the manager) and ui/join.js (staff).
//
// A venue, as the app uses it (readable keys), and as it travels (short keys, version 1):
//   {id, name, freq, start, end, delay, jobs: [{k, name, rate (cents), unit: 'hr'|'shift'}],
//    tipouts: [{k, who, mode: 'pctTips'|'flat', value (hundredths: 1500 = 15% or $15.00), from: 'cash'|'payroll'}]}
//   {v:1, i, n, f, s, e, d, j: [{k, n?, r, u: 'h'|'s'}], t: [{k, w, m: 'p'|'f', a, c: 'c'|'p'}]}
import { parseISO, periodRange, calendarMode, dayDiff, JOB_PRESETS, TIPOUT_PRESETS } from './math.js';
import { b64urlEncode, bytesToB64url, readCode, intIn, nameIn, dateIn } from './codec.js';

export const VENUE_VERSION = 1;
/** The most a venue code may hold (the JSON, in bytes). A bigger one is refused when made and when read. */
export const MAX_VENUE_BYTES = 1500;
export const MAX_VENUE_JOBS = 8;
export const MAX_VENUE_TIPOUTS = 10;
export const MAX_VENUE_NAME = 40;
export const MAX_RATE_CENTS = 1000000; // $10,000 an hour or a shift: more is a typo
export const MAX_FLAT_CENTS = 100000; // $1,000 flat a night
export const MAX_PCT_HUNDREDTHS = 10000; // 100%
export const FREQS = [7, 14, 15, 30, 'semimonthly', 'monthly'];
export const VENUE_ID_RE = /^[A-Za-z0-9_-]{10,16}$/;
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

/** A venue reference kept on an establishment ({id, name}), or null when it is not valid. */
export function cleanVenueRef(v) {
  if (!isObj(v)) return null;
  const name = nameIn(v.name, MAX_VENUE_NAME);
  return typeof v.id === 'string' && VENUE_ID_RE.test(v.id) && name ? { id: v.id, name } : null;
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
  for (const j of raw.jobs) {
    if (!isObj(j) || !JOB_KEYS.includes(j.k)) return null;
    const rate = intIn(j.rate, 1, MAX_RATE_CENTS);
    if (rate === undefined || (j.unit !== 'hr' && j.unit !== 'shift')) return null;
    let jobName = presetName(j.k);
    if (NAMED_JOB_KEYS.includes(j.k)) {
      jobName = nameIn(j.name, MAX_VENUE_NAME);
      if (!jobName) return null;
    }
    jobs.push({ k: j.k, name: jobName, rate, unit: j.unit });
  }
  if (!Array.isArray(raw.tipouts) || raw.tipouts.length > MAX_VENUE_TIPOUTS) return null;
  const tipouts = [];
  for (const t of raw.tipouts) {
    if (!isObj(t) || !TIPOUT_KEYS.includes(t.k)) return null;
    const who = nameIn(t.who, MAX_VENUE_NAME);
    if (!who || (t.mode !== 'pctTips' && t.mode !== 'flat') || (t.from !== 'cash' && t.from !== 'payroll'))
      return null;
    const value = intIn(t.value, 1, t.mode === 'flat' ? MAX_FLAT_CENTS : MAX_PCT_HUNDREDTHS);
    if (value === undefined) return null;
    tipouts.push({ k: t.k, who, mode: t.mode, value, from: t.from });
  }
  return { id, name, freq, start, end, delay, jobs, tipouts };
}

/** The venue in its short travelling form. */
function toWire(v) {
  return {
    v: VENUE_VERSION,
    i: v.id,
    n: v.name,
    f: v.freq,
    s: v.start,
    e: v.end,
    d: v.delay,
    j: v.jobs.map((j) => {
      const o = { k: j.k, r: j.rate, u: j.unit === 'hr' ? 'h' : 's' };
      if (NAMED_JOB_KEYS.includes(j.k)) o.n = j.name;
      return o;
    }),
    t: v.tipouts.map((t) => ({
      k: t.k,
      w: t.who,
      m: t.mode === 'flat' ? 'f' : 'p',
      a: t.value,
      c: t.from === 'payroll' ? 'p' : 'c',
    })),
  };
}
/** The short form back to readable keys (checkVenue then decides whether it is allowed). */
function fromWire(w) {
  if (!Array.isArray(w.j) || !Array.isArray(w.t)) return null;
  const unit = (u) => (u === 'h' ? 'hr' : u === 's' ? 'shift' : null);
  const jobs = w.j.map((j) => (isObj(j) ? { k: j.k, name: j.n, rate: j.r, unit: unit(j.u) } : null));
  const tipouts = w.t.map((t) =>
    isObj(t)
      ? {
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
  if (!w || w.v !== VENUE_VERSION) return null;
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
 * is updated, isJob(type, index) says which of them are jobs. A job already there with the same name keeps its id (so
 * the nights that used it still count); every pay type that is not a job (overtime, bonus...) stays after the venue's jobs.
 */
export function venuePayTypes(venue, existing = [], isJob = () => false) {
  const old = Array.isArray(existing) ? existing : [];
  const kept = new Set();
  const matched = venue.jobs.map((j) => {
    const at = old.findIndex(
      (t, n) => !kept.has(t.id) && isJob(t, n) && key(t.name || presetName(t.k)) === key(j.name),
    );
    if (at >= 0) kept.add(old[at].id);
    return at >= 0 ? old[at].id : null;
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
    return { id, k: j.k, name: j.name, rate: j.rate / 100, unit: j.unit, usual: 0 };
  });
  old.forEach((t, i) => {
    if (!isJob(t, i)) out.push(t);
  });
  return out;
}
/**
 * The venue's tip-outs as Setup stores them: {on, list} (on when there is anyone). A person already there (same kind and
 * name) keeps their id, so their ticks on saved nights carry over.
 */
export function venueTipouts(venue, existing = []) {
  const old = Array.isArray(existing) ? existing : [];
  const used = new Set();
  const taken = new Set(old.map((t) => t.id));
  let n = 1;
  const list = venue.tipouts.map((t) => {
    const at = old.findIndex((o) => !used.has(o.id) && o.k === t.k && key(o.who) === key(t.who));
    let id;
    if (at >= 0) {
      id = old[at].id;
      used.add(id);
    } else {
      while (taken.has('t' + n)) n++;
      id = 't' + n;
      taken.add(id);
    }
    return { id, k: t.k, who: t.who, mode: t.mode, value: t.value / 100, from: t.from };
  });
  return { on: list.length > 0, list };
}

/* ---------- what a manager's device keeps (settings.team) ---------- */
export const MAX_STAFF = 60;
export const MAX_STAFF_NAME = 24;
export const MAX_POINTS = 100000; // hundredths: 1000 points

/** The staff list kept on the manager's device: [{name, role, points (hundredths)}], cleaned. */
export function cleanStaff(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const s of list) {
    if (!isObj(s) || out.length >= MAX_STAFF) continue;
    const name = nameIn(s.name, MAX_STAFF_NAME);
    if (!name) continue;
    const role = s.role === '' || s.role == null ? '' : nameIn(s.role, MAX_STAFF_NAME);
    out.push({ name, role: role || '', points: intIn(s.points, 0, MAX_POINTS) ?? 100 });
  }
  return out;
}
/**
 * settings.team: {venueId?, venue? (the last venue code made, as it was), staff?: [...]}. Anything not valid is dropped;
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
  return Object.keys(out).length ? out : null;
}
