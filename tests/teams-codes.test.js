// TipNet Teams share codes: encode/decode round trips, and strict reading of untrusted venue and sheet codes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { b64urlEncode, b64urlDecode, readCode, nameIn, dateIn, takeFragment } from '../app/js/codec.js';
import {
  checkVenue,
  encodeVenue,
  decodeVenue,
  venueLink,
  venueFromText,
  newVenueId,
  VENUE_ID_RE,
  MAX_VENUE_BYTES,
  venuePayTypes,
  venueTipouts,
  cleanTeam,
  cleanStaff,
  cleanVenueRef,
} from '../app/js/venue.js';
import { encodeSheet, decodeSheet, sheetLink, MAX_SHEET_BYTES } from '../app/js/sheet.js';
import { parseISO, payKind } from '../app/js/math.js';

const ID = 'AbCdEf012345';
const venue = (over = {}) => ({
  id: ID,
  name: 'The Corner Bar',
  freq: 14,
  start: '2026-10-05',
  end: '2026-10-18',
  delay: 5,
  jobs: [
    { k: 'bartender', name: 'Bartender', rate: 1200, unit: 'hr' },
    { k: 'otherjob', name: 'Door', rate: 1500, unit: 'shift' },
  ],
  tipouts: [
    { k: 'barback', who: 'Barback', mode: 'pctTips', value: 1500, from: 'cash' },
    { k: 'host', who: 'Host', mode: 'flat', value: 2000, from: 'payroll' },
  ],
  ...over,
});
const wireOf = (v) => JSON.parse(Buffer.from(encodeVenue(v), 'base64url').toString('utf8'));
const code = (obj) => Buffer.from(JSON.stringify(obj), 'utf8').toString('base64url');

test('base64url: UTF-8 round trip, no padding or plus/slash, strict decoding', () => {
  const s = 'Café ☕ Ñandú {"a":1}';
  const e = b64urlEncode(s);
  assert.match(e, /^[A-Za-z0-9_-]+$/);
  assert.equal(b64urlDecode(e, 1000), s);
  assert.equal(b64urlDecode(e + '=', 1000), null, 'padding is not base64url');
  assert.equal(b64urlDecode('ab+/', 1000), null);
  assert.equal(b64urlDecode('a', 1000), null, 'a length no base64 text has');
  assert.equal(b64urlDecode(b64urlEncode('x'.repeat(200)), 100), null, 'over the byte cap');
  assert.equal(b64urlDecode('_w', 100), null, 'not UTF-8');
  assert.equal(b64urlDecode(42, 100), null);
});

test('venue ids: 12 characters of base64url, different every time', () => {
  const ids = new Set(Array.from({ length: 50 }, newVenueId));
  assert.equal(ids.size, 50);
  ids.forEach((i) => assert.match(i, /^[A-Za-z0-9_-]{12}$/));
  assert.ok(VENUE_ID_RE.test('a'.repeat(10)) && VENUE_ID_RE.test('a'.repeat(16)));
  assert.ok(
    !VENUE_ID_RE.test('a'.repeat(9)) &&
      !VENUE_ID_RE.test('a'.repeat(17)) &&
      !VENUE_ID_RE.test('abc def ghij'),
  );
});

test('venue code: round trip keeps everything, in short keys with a version, and carries no personal pay data', () => {
  const v = venue();
  const data = encodeVenue(v);
  assert.deepEqual(decodeVenue(data), v);
  const w = wireOf(v);
  assert.equal(w.v, 1);
  assert.deepEqual(Object.keys(w).sort(), ['d', 'e', 'f', 'i', 'j', 'n', 's', 't', 'v']);
  assert.ok(!/gross|deduct|nights|staff|wage/i.test(JSON.stringify(w)));
  const link = venueLink(v, { origin: 'https://tipmynet.com', pathname: '/app/' });
  assert.equal(link, 'https://tipmynet.com/app/#join=' + data);
  assert.deepEqual(venueFromText(link), v);
  assert.deepEqual(
    venueFromText('  ' + data.slice(0, 20) + '\n' + data.slice(20) + ' '),
    v,
    'a bare code, wrapped by a chat app',
  );
  assert.equal(venueFromText('hello'), null);
  assert.equal(venueFromText(''), null);
});

test('venue code: calendar schedules take their end date from the calendar, as Setup does', () => {
  const v = checkVenue(venue({ freq: 'monthly', start: '2026-10-05', end: '2026-10-09' }));
  assert.equal(v.end, '2026-11-04');
  assert.deepEqual(decodeVenue(encodeVenue(v)), v);
});

test('venue code: every field is checked (types, lengths, ranges, enums, dates)', () => {
  const bad = (over, why) => assert.equal(checkVenue(venue(over)), null, why);
  const tip = (o) => [{ k: 'bar', who: 'Bar', mode: 'flat', value: 100, from: 'cash', ...o }];
  bad({ id: 'short' }, 'id too short');
  bad({ id: 'has space!!!' }, 'id characters');
  bad({ id: 12345678901 }, 'id type');
  bad({ name: '' }, 'name empty');
  bad({ name: 'x'.repeat(41) }, 'name too long');
  bad({ name: 'Bad\u0007Name' }, 'control character');
  bad({ name: 'Flip‮ed' }, 'direction override');
  bad({ name: 42 }, 'name type');
  bad({ freq: 13 }, 'freq enum');
  bad({ freq: '14' }, 'freq as text');
  bad({ start: '2026-02-30' }, 'impossible date');
  bad({ start: '2026-13-01' }, 'month 13');
  bad({ start: '1999-12-31', end: '2000-01-05' }, 'year before 2000');
  bad({ start: '2026-10-05T00:00', end: '2026-10-18' }, 'not a plain date');
  bad({ end: '2026-10-04' }, 'end before start');
  bad({ end: '2026-12-31' }, 'longer than 62 days');
  bad({ delay: 22 }, 'payday more than 21 days after');
  bad({ delay: -1 }, 'payday before the end');
  bad({ delay: 2.5 }, 'payday not whole');
  bad({ delay: '5' }, 'payday as text');
  bad({ jobs: [] }, 'no jobs');
  bad(
    { jobs: Array.from({ length: 9 }, () => ({ k: 'bartender', rate: 100, unit: 'hr' })) },
    'too many jobs',
  );
  bad({ jobs: [{ k: 'nope', rate: 100, unit: 'hr' }] }, 'job kind');
  bad({ jobs: [{ k: 'ot', rate: 100, unit: 'hr' }] }, 'overtime is not a job');
  bad({ jobs: [{ k: 'bartender', rate: 0, unit: 'hr' }] }, 'rate 0');
  bad({ jobs: [{ k: 'bartender', rate: 12.5, unit: 'hr' }] }, 'rate not whole cents');
  bad({ jobs: [{ k: 'bartender', rate: '1200', unit: 'hr' }] }, 'rate as text');
  bad({ jobs: [{ k: 'bartender', rate: 1e9, unit: 'hr' }] }, 'rate too big');
  bad({ jobs: [{ k: 'bartender', rate: 100, unit: 'week' }] }, 'job unit');
  bad({ jobs: [{ k: 'otherjob', name: '', rate: 100, unit: 'hr' }] }, 'named job without a name');
  bad({ jobs: 'bartender' }, 'jobs not a list');
  bad({ tipouts: Array.from({ length: 11 }, () => tip({})[0]) }, 'too many tip-outs');
  bad({ tipouts: tip({ mode: 'pctTips', value: 10001 }) }, 'over 100%');
  bad({ tipouts: tip({ value: 100001 }) }, 'flat over $1,000');
  bad({ tipouts: tip({ mode: 'pctTips', value: 0 }) }, 'value 0');
  bad({ tipouts: tip({ mode: 'other' }) }, 'mode');
  bad({ tipouts: tip({ from: 'venmo' }) }, 'from');
  bad({ tipouts: tip({ k: 'zzz' }) }, 'tip-out kind');
  bad({ tipouts: null }, 'tip-outs not a list');
  assert.equal(checkVenue(null), null);
  assert.equal(checkVenue([]), null);
  assert.equal(checkVenue('x'), null);
  assert.ok(checkVenue(venue({ tipouts: [] })), 'no tip-outs is fine');
});

test('venue code: wrong versions, wrong shapes and plain junk are refused whole', () => {
  const w = wireOf(venue());
  assert.ok(decodeVenue(code(w)));
  assert.equal(decodeVenue(code({ ...w, v: 2 })), null, 'a newer version');
  assert.equal(decodeVenue(code({ ...w, v: '1' })), null);
  assert.equal(decodeVenue(code({ ...w, v: undefined })), null);
  assert.equal(decodeVenue(code({ ...w, j: 'x' })), null);
  assert.equal(decodeVenue(code({ ...w, j: [null] })), null);
  assert.equal(decodeVenue(code({ ...w, t: [5] })), null);
  assert.equal(decodeVenue(code({ ...w, j: [{ ...w.j[0], u: 'x' }] })), null);
  assert.equal(decodeVenue(code([1, 2, 3])), null, 'a list');
  assert.equal(decodeVenue(Buffer.from('null').toString('base64url')), null);
  assert.equal(decodeVenue(Buffer.from('not json').toString('base64url')), null);
  assert.equal(decodeVenue('%%%'), null);
  assert.equal(decodeVenue(''), null);
  assert.equal(decodeVenue(undefined), null);
  assert.equal(decodeVenue(123), null);
  assert.equal(decodeVenue('A'.repeat(5000)), null, 'oversized text is refused before it is decoded');
  assert.equal(
    decodeVenue(b64urlEncode('{"v":1,"pad":"' + 'x'.repeat(MAX_VENUE_BYTES) + '"}')),
    null,
    'over the byte cap',
  );
});

test('venue code: unknown keys are ignored, but a prototype-reaching key anywhere refuses the whole code', () => {
  const w = wireOf(venue());
  assert.deepEqual(decodeVenue(code({ ...w, extra: 1, z: [1, 2] })), venue(), 'unknown keys are ignored');
  const raw = JSON.stringify(w).slice(0, -1);
  for (const k of ['__proto__', 'constructor', 'prototype']) {
    const top = Buffer.from(raw + ',"' + k + '":{"x":1}}').toString('base64url');
    assert.equal(decodeVenue(top), null, k + ' at the top');
    const job = JSON.stringify(w.j[0]).slice(0, -1) + ',"' + k + '":1}';
    const deep = raw.replace(JSON.stringify(w.j[0]), job);
    assert.notEqual(deep, raw);
    assert.equal(decodeVenue(Buffer.from(deep + '}').toString('base64url')), null, k + ' inside a job');
  }
  const polluted = Buffer.from('{"v":1,"__proto__":{"polluted":true}}').toString('base64url');
  assert.equal(decodeVenue(polluted), null);
  assert.equal({}.polluted, undefined, 'Object.prototype is untouched');
});

test('venue code: too big is refused when made', () => {
  const v = venue({
    jobs: Array.from({ length: 8 }, (_, i) => ({
      k: 'otherjob',
      name: 'Job number ' + i + 'x'.repeat(20),
      rate: 1000 + i,
      unit: 'hr',
    })),
    tipouts: Array.from({ length: 10 }, (_, i) => ({
      k: 'other',
      who: 'Person ' + i + ' ' + 'y'.repeat(30),
      mode: 'flat',
      value: 100 + i,
      from: 'cash',
    })),
  });
  assert.throws(() => encodeVenue(v), /too-big/);
  assert.throws(() => encodeVenue({ ...venue(), freq: 3 }), /bad-venue/);
});

test('venue ref and team data are cleaned', () => {
  assert.deepEqual(cleanVenueRef({ id: ID, name: ' Bar ', extra: 1 }), { id: ID, name: 'Bar' });
  assert.equal(cleanVenueRef({ id: 'x', name: 'Bar' }), null);
  assert.equal(cleanVenueRef({ id: ID, name: '' }), null);
  assert.equal(cleanVenueRef(null), null);
  assert.equal(cleanVenueRef([]), null);
  assert.equal(cleanTeam(null), null);
  assert.equal(cleanTeam({ junk: 1 }), null);
  const t = cleanTeam({
    venueId: ID,
    venue: venue(),
    name: 'Bar',
    staff: [{ name: 'Sam', role: 'Bar', points: 150 }, { name: '' }, 5],
    x: 1,
  });
  assert.deepEqual(t, {
    venue: venue(),
    venueId: ID,
    name: 'Bar',
    staff: [{ name: 'Sam', role: 'Bar', points: 150 }],
  });
  assert.deepEqual(
    cleanTeam({ venueId: ID, venue: { id: ID } }),
    { venueId: ID },
    'a bad venue is dropped, the id stays',
  );
  assert.equal(cleanTeam({ venueId: 'bad id' }), null);
  assert.equal(cleanStaff(Array.from({ length: 80 }, (_, i) => ({ name: 'P' + i }))).length, 50);
  assert.equal(cleanStaff([{ name: 'x'.repeat(25) }]).length, 0, 'a name over 24 characters');
  assert.deepEqual(cleanStaff([{ name: 'A', points: -3 }]), [{ name: 'A', role: '', points: 100 }]);
});

test('a venue as a pay setup: jobs and tip-outs, ids kept on update, other pay stays', () => {
  const v = venue();
  const fresh = venuePayTypes(v);
  assert.deepEqual(
    fresh.map((t) => [t.id, t.k, t.name, t.rate, t.unit]),
    [
      ['p1', 'bartender', 'Bartender', 12, 'hr'],
      ['p2', 'otherjob', 'Door', 15, 'shift'],
    ],
  );
  const existing = [
    { id: 'p1', k: 'bartender', name: 'Bartender', rate: 9, unit: 'hr', usual: 7 },
    { id: 'p2', k: 'training', name: 'Training', rate: 9, unit: 'hr' },
    { id: 'p3', k: 'bonus', name: 'Bonus', rate: 0, unit: 'amt' },
  ];
  const upd = venuePayTypes(v, existing, (t, i) => payKind(t, i) === 'job');
  assert.deepEqual(
    upd.map((t) => [t.id, t.k, t.rate]),
    [
      ['p1', 'bartender', 12],
      ['p4', 'otherjob', 15],
      ['p3', 'bonus', 0],
    ],
    'the matching job keeps its id, the new one gets a free id, the bonus stays, the old Training job is dropped',
  );
  const to = venueTipouts(v, [
    { id: 't9', k: 'barback', who: 'barback', mode: 'flat', value: 5, from: 'cash' },
  ]);
  assert.equal(to.on, true);
  assert.deepEqual(
    to.list.map((r) => [r.id, r.k, r.mode, r.value, r.from]),
    [
      ['t9', 'barback', 'pctTips', 15, 'cash'],
      ['t1', 'host', 'flat', 20, 'payroll'],
    ],
  );
  assert.deepEqual(venueTipouts(venue({ tipouts: [] })), { on: false, list: [] });
});

const sheetOf = (over = {}) => ({
  venue: { id: ID, name: 'Bar' },
  date: '2026-10-09',
  method: 'hours',
  rows: [{ name: 'Sam', minutes: 60, cc: 100, cash: 0 }],
  ...over,
});

test('sheet code: round trip, short keys with a version, money in cents, names and hours', () => {
  const s = sheetOf({
    method: 'role',
    rows: [
      { name: 'Sam', minutes: 450, cc: 12345, cash: 600 },
      { name: 'Zoë Ñ', minutes: 0, cc: 0, cash: 0 },
    ],
  });
  const data = encodeSheet(s);
  assert.deepEqual(decodeSheet(data), s);
  const w = JSON.parse(Buffer.from(data, 'base64url').toString('utf8'));
  assert.equal(w.v, 1);
  assert.deepEqual(w.r[0], ['Sam', 450, 12345, 600]);
  assert.equal(sheetLink(s, { origin: 'https://x.test', pathname: '/' }), 'https://x.test/#sheet=' + data);
});

test('sheet code: strict reading (wrong types, ranges, dates, prototype keys, size)', () => {
  const w = JSON.parse(Buffer.from(encodeSheet(sheetOf()), 'base64url').toString('utf8'));
  assert.ok(decodeSheet(code(w)));
  const refuse = (o, why) => assert.equal(decodeSheet(code({ ...w, ...o })), null, why);
  refuse({ v: 2 }, 'newer version');
  refuse({ i: 'bad' }, 'venue id');
  refuse({ n: '' }, 'venue name');
  refuse({ d: '2026-02-31' }, 'bad date');
  refuse({ d: '1999-01-01' }, 'date before 2000');
  refuse({ m: 'z' }, 'method');
  refuse({ m: '__proto__' }, 'method as a prototype key');
  refuse({ r: [] }, 'no rows');
  refuse({ r: 'x' }, 'rows type');
  refuse({ r: [['Sam', 60, 100]] }, 'row length');
  refuse({ r: [['Sam', '60', 100, 0]] }, 'minutes as text');
  refuse({ r: [['Sam', 1441, 100, 0]] }, 'more than 24 hours');
  refuse({ r: [['Sam', 60, -1, 0]] }, 'negative money');
  refuse({ r: [['Sam', 60, 1.5, 0]] }, 'fraction of a cent');
  refuse({ r: [['Sam', 60, 1e12, 0]] }, 'too much money');
  refuse({ r: [['', 60, 100, 0]] }, 'no name');
  refuse({ r: [['x'.repeat(25), 60, 100, 0]] }, 'name over 24');
  refuse({ r: [[7, 60, 100, 0]] }, 'name type');
  refuse({ r: Array.from({ length: 51 }, () => ['A', 1, 1, 1]) }, 'more than 50 people');
  assert.equal(decodeSheet(code([])), null);
  assert.equal(decodeSheet('A'.repeat(6000)), null);
  assert.equal(decodeSheet(code({ ...w, pad: 'x'.repeat(MAX_SHEET_BYTES) })), null, 'over the byte cap');
  const proto = Buffer.from(JSON.stringify(w).slice(0, -1) + ',"constructor":{}}').toString('base64url');
  assert.equal(decodeSheet(proto), null);
  assert.deepEqual(decodeSheet(code({ ...w, extra: 1 })), sheetOf(), 'unknown keys are ignored');
});

test('sheet code: too big is refused when made (split the staff)', () => {
  // 50 people (the most a sheet holds) with long names in accented letters (2 bytes each) is over 2,500 bytes
  const rows = Array.from({ length: 50 }, (_, i) => ({
    name: ('Zoë ' + (i + 1) + ' ').padEnd(24, 'é'),
    minutes: 480,
    cc: 1234567,
    cash: 765432,
  }));
  assert.throws(() => encodeSheet(sheetOf({ rows })), /too-big/);
  assert.ok(encodeSheet(sheetOf({ rows: rows.slice(0, 20) })));
});

test('helpers: names, dates, code reading', () => {
  assert.equal(nameIn('  Sam ', 24), 'Sam');
  assert.equal(nameIn('😀'.repeat(3), 3), '😀😀😀', 'counted as people see them');
  assert.equal(nameIn('a\nb', 24), undefined);
  assert.equal(nameIn('a​b', 24), undefined);
  assert.equal(nameIn(null, 24), undefined);
  assert.equal(dateIn('2026-10-09', parseISO), '2026-10-09');
  assert.equal(dateIn('2101-01-01', parseISO), undefined);
  assert.equal(dateIn(20261009, parseISO), undefined);
  assert.equal(readCode(code({ a: { b: { c: { d: { e: { f: 1 } } } } } }), 1000), null, 'too deep');
});

test('fragment: #join= and #sheet= are read and taken out of the address; other fragments stay', () => {
  const calls = [];
  const mk = (hash) => ({
    location: { hash, pathname: '/app/', search: '?x=1' },
    history: { state: { s: 1 }, replaceState: (...a) => calls.push(a) },
  });
  assert.deepEqual(takeFragment(mk('#join=abc')), { kind: 'join', data: 'abc' });
  assert.deepEqual(calls[0], [{ s: 1 }, '', '/app/?x=1']);
  assert.deepEqual(takeFragment(mk('#sheet=def_-')), { kind: 'sheet', data: 'def_-' });
  assert.equal(calls.length, 2);
  assert.equal(takeFragment(mk('#top')), null);
  assert.equal(takeFragment(mk('')), null);
  assert.equal(calls.length, 2, 'nothing removed for other fragments');
  assert.equal(takeFragment({}), null);
});
