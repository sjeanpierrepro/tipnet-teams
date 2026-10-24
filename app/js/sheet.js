// The tip sheet code: one night's tip pool, shared as a link or QR (#sheet=...) so staff can log their own share.
// Anyone with the link sees everyone's share (the manager is told before sharing). Pure (no DOM).
//
// A sheet (readable): {venue: {id, name}, date, method, rows: [{name, minutes, cc, cash}]} (money in cents).
// Travelling (version 1): {v:1, i, n, d, m: 'h'|'p'|'e'|'r', r: [[name, minutes, cc, cash], ...]}
import { parseISO } from './math.js';
import { b64urlEncode, readCode, intIn, nameIn, dateIn } from './codec.js';
import { VENUE_ID_RE, MAX_VENUE_NAME, cleanVenueRef, MAX_STAFF_NAME, MAX_STAFF } from './venue.js';
import { MAX_POOL_CENTS, MAX_MINUTES } from './pool.js';

export const SHEET_VERSION = 1;
/** The most a sheet code may hold (the JSON, in bytes). A bigger one is refused when made and when read. */
export const MAX_SHEET_BYTES = 2500;
export const MAX_SHEET_ROWS = MAX_STAFF; // 50 people a sheet
export const TOO_BIG_SHEET =
  'This sheet is too big to share as one link or QR code. Split the staff into two sheets and share each one.';
export const BAD_SHEET_MSG =
  'This link isn’t a TipNet Teams tip sheet (or it’s from a newer version). Nothing was changed.';
export const SHARE_WARNING = 'Anyone with this link or QR sees everyone’s share.';
const METHOD_CODES = { hours: 'h', points: 'p', equal: 'e', role: 'r' };
const METHOD_NAMES = { h: 'hours', p: 'points', e: 'equal', r: 'role' };
export const METHOD_TEXT = {
  hours: 'by hours',
  points: 'by points × hours',
  equal: 'equally',
  role: 'by role %',
};

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

/** Checks a sheet in readable form and returns a clean copy, or null. Strict, like checkVenue. */
export function checkSheet(raw) {
  if (!isObj(raw)) return null;
  const venue = cleanVenueRef(raw.venue);
  const date = dateIn(raw.date, parseISO);
  if (
    !venue ||
    !date ||
    typeof raw.method !== 'string' ||
    !Object.prototype.hasOwnProperty.call(METHOD_CODES, raw.method)
  )
    return null;
  if (!Array.isArray(raw.rows) || raw.rows.length < 1 || raw.rows.length > MAX_SHEET_ROWS) return null;
  const rows = [];
  for (const r of raw.rows) {
    if (!isObj(r)) return null;
    const name = nameIn(r.name, MAX_STAFF_NAME);
    const minutes = intIn(r.minutes, 0, MAX_MINUTES);
    const cc = intIn(r.cc, 0, MAX_POOL_CENTS);
    const cash = intIn(r.cash, 0, MAX_POOL_CENTS);
    if (!name || minutes === undefined || cc === undefined || cash === undefined) return null;
    rows.push({ name, minutes, cc, cash });
  }
  return { venue, date, method: raw.method, rows };
}

/** The code (base64url) for a sheet, or Error('too-big') when its JSON is over MAX_SHEET_BYTES. */
export function encodeSheet(sheet) {
  const s = checkSheet(sheet);
  if (!s) throw new Error('bad-sheet');
  const wire = {
    v: SHEET_VERSION,
    i: s.venue.id,
    n: s.venue.name,
    d: s.date,
    m: METHOD_CODES[s.method],
    r: s.rows.map((r) => [r.name, r.minutes, r.cc, r.cash]),
  };
  const text = JSON.stringify(wire);
  if (new TextEncoder().encode(text).length > MAX_SHEET_BYTES) throw new Error('too-big');
  return b64urlEncode(text);
}

/** The sheet a code holds (clean, readable form), or null: not a sheet code, a newer version, or anything not allowed. */
export function decodeSheet(data) {
  const w = readCode(data, MAX_SHEET_BYTES);
  if (!w || w.v !== SHEET_VERSION || !Array.isArray(w.r) || typeof w.i !== 'string') return null;
  if (!VENUE_ID_RE.test(w.i) || nameIn(w.n, MAX_VENUE_NAME) === undefined) return null;
  const rows = w.r.map((x) =>
    Array.isArray(x) && x.length === 4 ? { name: x[0], minutes: x[1], cc: x[2], cash: x[3] } : null,
  );
  return checkSheet({
    venue: { id: w.i, name: w.n },
    date: w.d,
    method:
      typeof w.m === 'string' && Object.prototype.hasOwnProperty.call(METHOD_NAMES, w.m)
        ? METHOD_NAMES[w.m]
        : null,
    rows,
  });
}

/** The share link for a sheet. loc: {origin, pathname}. */
export function sheetLink(sheet, loc = globalThis.location) {
  return loc.origin + loc.pathname + '#sheet=' + encodeSheet(sheet);
}
