// TipNet Teams, job titles that line up: venue codes version 2 (stable job and tip-out ids), tip sheets version 2 (the
// venue job a person worked as), the storage of vj / vt, and the update plan (planVenueUpdate / applyVenueUpdate).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  checkVenue,
  encodeVenue,
  decodeVenue,
  cleanTeam,
  cleanStaff,
  venuePayTypes,
  venueTipouts,
  autoMatchJobs,
  planVenueUpdate,
  applyVenueUpdate,
  MAX_VENUE_BYTES,
  MAX_VENUE_JOBS,
  MAX_VENUE_TIPOUTS,
} from '../app/js/venue.js';
import { encodeSheet, decodeSheet, checkSheet, MAX_SHEET_BYTES, MAX_SHEET_ROWS } from '../app/js/sheet.js';
import { migrate, seedState, encodeBackup, decodeBackup } from '../app/js/storage.js';
import { payKind, isRetired, keepUsedPay } from '../app/js/math.js';

const ID = 'AbCdEf012345';
const venue = (over = {}) => ({
  id: ID,
  name: 'The Corner Bar',
  freq: 14,
  start: '2026-10-05',
  end: '2026-10-18',
  delay: 5,
  jobs: [
    { id: 'j1', k: 'bartender', name: 'Bartender', rate: 1200, unit: 'hr' },
    { id: 'j2', k: 'otherjob', name: 'Door', rate: 1500, unit: 'shift' },
  ],
  tipouts: [
    { id: 't1', k: 'barback', who: 'Barback', mode: 'pctTips', value: 1500, from: 'cash' },
    { id: 't2', k: 'host', who: 'Host', mode: 'flat', value: 2000, from: 'payroll' },
  ],
  ...over,
});
const noIds = (v) => ({
  ...v,
  jobs: v.jobs.map(({ id, ...j }) => j),
  tipouts: v.tipouts.map(({ id, ...t }) => t),
});
const wireOf = (v) => JSON.parse(Buffer.from(encodeVenue(v), 'base64url').toString('utf8'));
const code = (obj) => Buffer.from(JSON.stringify(obj), 'utf8').toString('base64url');

/* ---------- venue codes ---------- */
test('venue code version 2: ids travel as x, round trip, renaming keeps the id', () => {
  const v = venue();
  const w = wireOf(v);
  assert.equal(w.v, 2);
  assert.deepEqual(
    w.j.map((j) => j.x),
    ['j1', 'j2'],
  );
  assert.deepEqual(
    w.t.map((t) => t.x),
    ['t1', 't2'],
  );
  assert.deepEqual(decodeVenue(encodeVenue(v)), v);
  // (a preset job's name is its kind's; a name of its own comes with "Other job")
  const renamed = venue({ jobs: [{ ...v.jobs[0], k: 'otherjob', name: 'Bar staff' }, v.jobs[1]] });
  assert.equal(decodeVenue(encodeVenue(renamed)).jobs[0].id, 'j1', 'the id stays when the job is renamed');
  assert.equal(decodeVenue(encodeVenue(renamed)).jobs[0].name, 'Bar staff');
});

test('venue code version 1 (no ids) is still made and read', () => {
  const v1 = noIds(venue());
  const w = wireOf(v1);
  assert.equal(w.v, 1);
  assert.equal(w.j[0].x, undefined);
  assert.deepEqual(decodeVenue(encodeVenue(v1)), v1);
  // a version 1 code made by an older copy
  const old = {
    v: 1,
    i: ID,
    n: 'Bar',
    f: 14,
    s: '2026-10-05',
    e: '2026-10-18',
    d: 5,
    j: [{ k: 'bartender', r: 1200, u: 'h' }],
    t: [],
  };
  const got = decodeVenue(code(old));
  assert.equal(got.jobs[0].id, undefined);
  assert.equal(got.jobs[0].name, 'Bartender');
  // an id sent in a version 1 code is not read (version 1 has none)
  assert.equal(
    decodeVenue(code({ ...old, j: [{ x: 'j1', k: 'bartender', r: 1200, u: 'h' }] })).jobs[0].id,
    undefined,
  );
  // an unknown version is refused
  assert.equal(decodeVenue(code({ ...old, v: 3 })), null);
});

test('venue ids are checked strictly: short a-z0-9, unique, all or none', () => {
  const base = wireOf(venue());
  const withJobIds = (ids) => ({ ...base, j: base.j.map((j, i) => ({ ...j, x: ids[i] })) });
  assert.ok(decodeVenue(code(withJobIds(['a', 'zz09']))), 'one to four characters');
  for (const bad of ['J1', 'j-1', 'j_1', 'j 1', 'abcde', '', 'é1', null, 7, ['j1'], { a: 1 }, 'j1\n']) {
    assert.equal(decodeVenue(code(withJobIds([bad, 'j2']))), null, JSON.stringify(bad));
  }
  assert.equal(decodeVenue(code(withJobIds(['j1', 'j1']))), null, 'duplicate job ids');
  const dupTip = { ...base, t: base.t.map((t) => ({ ...t, x: 't1' })) };
  assert.equal(decodeVenue(code(dupTip)), null, 'duplicate tip-out ids');
  // the same text for a job and a tip-out is fine: they are separate lists
  assert.ok(decodeVenue(code({ ...base, t: base.t.map((t, i) => ({ ...t, x: base.j[i].x })) })));
  // a version 2 code where one row has no id
  const missing = { ...base, j: [base.j[0], { ...base.j[1], x: undefined }] };
  assert.equal(decodeVenue(code(missing)), null, 'version 2 rows all have an id');
  const noTipId = { ...base, t: [{ ...base.t[0], x: undefined }, base.t[1]] };
  assert.equal(decodeVenue(code(noTipId)), null);
  // readable form: some rows with ids and some without is not a venue
  const half = venue();
  delete half.tipouts[1].id;
  assert.equal(checkVenue(half), null);
  assert.equal(checkVenue({ ...venue(), jobs: [{ ...venue().jobs[0], id: 'J1' }, venue().jobs[1]] }), null);
});

test('a full venue code (8 jobs, 10 tip-outs, ids) still fits', () => {
  const jobs = Array.from({ length: MAX_VENUE_JOBS }, (_, i) => ({
    id: 'j' + (i + 1),
    k: 'otherjob',
    name: 'Job number ' + (i + 1) + ' x',
    rate: 1250,
    unit: 'hr',
  }));
  const tipouts = Array.from({ length: MAX_VENUE_TIPOUTS }, (_, i) => ({
    id: 't' + (i + 1),
    k: 'other',
    who: 'Person ' + (i + 1),
    mode: 'pctTips',
    value: 150,
    from: 'cash',
  }));
  const text = encodeVenue(venue({ jobs, tipouts }));
  assert.ok(Buffer.from(text, 'base64url').length <= MAX_VENUE_BYTES);
  assert.equal(decodeVenue(text).tipouts.length, 10);
});

test('settings.team keeps a venue with ids, drops a bad one, and keeps the id counters', () => {
  const t = cleanTeam({ venue: venue(), jSeq: 5, tSeq: 2 });
  assert.deepEqual(t.venue, venue());
  assert.equal(t.jSeq, 5);
  assert.equal(t.tSeq, 2);
  assert.equal(
    cleanTeam({ venue: venue({ jobs: [{ ...venue().jobs[0], id: 'BAD' }, venue().jobs[1]] }), venueId: ID })
      .venue,
    undefined,
  );
  assert.equal(cleanTeam({ venueId: ID, jSeq: 0 }).jSeq, undefined);
  assert.equal(cleanTeam({ venueId: ID, jSeq: 1000 }).jSeq, undefined);
  assert.equal(cleanTeam({ venueId: ID, jSeq: '5' }).jSeq, undefined);
  assert.deepEqual(
    cleanStaff([
      { name: 'Sam', vj: 'j1' },
      { name: 'Al', vj: 'BAD' },
    ]),
    [
      { name: 'Sam', role: '', points: 100, vj: 'j1' },
      { name: 'Al', role: '', points: 100 },
    ],
  );
});

test('a pay type made from a venue job stores its id as vj, a tip-out as vt', () => {
  const pay = venuePayTypes(venue());
  assert.deepEqual(
    pay.map((t) => t.vj),
    ['j1', 'j2'],
  );
  assert.deepEqual(
    venueTipouts(venue()).list.map((r) => r.vt),
    ['t1', 't2'],
  );
  assert.equal(venuePayTypes(noIds(venue()))[0].vj, undefined, 'a version 1 venue has none');
  assert.equal(venueTipouts(noIds(venue())).list[0].vt, undefined);
});

/* ---------- storage ---------- */
const real = (mutate) => {
  const S = seedState();
  S.profileExample = false;
  S.nightsExample = false;
  S.nights = [];
  S.workplaces[0].setupDone = true;
  mutate(S);
  return migrate(JSON.parse(JSON.stringify(S)), { today: '2026-10-01' });
};
test('storage keeps vj and vt when valid and drops them otherwise; they travel in backups', () => {
  const S = real((x) => {
    const p = x.workplaces[0].profile;
    p.payTypes = [
      { id: 'p1', k: 'bartender', name: 'Bartender', rate: 12, unit: 'hr', usual: 7, vj: 'j1' },
      { id: 'p2', k: 'otherjob', name: 'Door', rate: 15, unit: 'shift', usual: 0, vj: 'J-2' },
      { id: 'p3', k: 'otherjob', name: 'Patio', rate: 10, unit: 'hr', usual: 0, vj: 'j1' },
      { id: 'p4', k: 'otherjob', name: 'Host', rate: 10, unit: 'hr', usual: 0, vj: 'abcde' },
      { id: 'p5', k: 'otherjob', name: 'Food', rate: 10, unit: 'hr', usual: 0, vj: 5 },
    ];
    p.tipout = { on: true };
    p.tipouts = [
      { id: 't1', k: 'barback', who: 'Barback', mode: 'pctTips', value: 15, from: 'cash', vt: 't1' },
      { id: 't2', k: 'host', who: 'Host', mode: 'flat', value: 20, from: 'cash', vt: 'T2' },
      { id: 't3', k: 'runner', who: 'Runner', mode: 'flat', value: 5, from: 'cash', vt: 't1' },
    ];
  });
  const p = S.workplaces[0].profile;
  assert.deepEqual(
    p.payTypes.map((t) => t.vj),
    ['j1', undefined, undefined, undefined, undefined],
    'a bad, a repeated and a non-text vj are dropped',
  );
  assert.deepEqual(
    p.tipouts.map((r) => r.vt),
    ['t1', undefined, undefined],
  );
  for (const back of [decodeBackup(encodeBackup(S))]) {
    const bp = back.workplaces[0].profile;
    assert.equal(bp.payTypes[0].vj, 'j1');
    assert.equal(bp.tipouts[0].vt, 't1');
  }
});

/* ---------- tip sheets ---------- */
const sheetOf = (over = {}) => ({
  venue: { id: ID, name: 'Bar' },
  date: '2026-10-09',
  method: 'hours',
  rows: [{ name: 'Sam', minutes: 60, cc: 100, cash: 0 }],
  ...over,
});
const sheetWire = (s) => JSON.parse(Buffer.from(encodeSheet(s), 'base64url').toString('utf8'));
const scode = (obj) => Buffer.from(JSON.stringify(obj), 'utf8').toString('base64url');

test('sheet version 2: rows carry the venue job (id and name) through a short table; version 1 still reads', () => {
  const s = sheetOf({
    rows: [
      { name: 'Sam', minutes: 450, cc: 12345, cash: 600, vj: 'j1', job: 'Bartender' },
      { name: 'Alex', minutes: 300, cc: 8000, cash: 1000 },
      { name: 'Jo', minutes: 60, cc: 100, cash: 0, vj: 'j2', job: 'Door' },
      { name: 'Kim', minutes: 60, cc: 100, cash: 0, vj: 'j1', job: 'Bartender' },
    ],
  });
  const w = sheetWire(s);
  assert.equal(w.v, 2);
  assert.deepEqual(w.j, [
    ['j1', 'Bartender'],
    ['j2', 'Door'],
  ]);
  assert.deepEqual(w.r[0], ['Sam', 450, 12345, 600, 0]);
  assert.deepEqual(w.r[1], ['Alex', 300, 8000, 1000]);
  assert.deepEqual(w.r[3], ['Kim', 60, 100, 0, 0], 'the job name is sent once');
  assert.deepEqual(decodeSheet(encodeSheet(s)), s);
  // nobody has a venue job: version 1 (older copies read it)
  const plain = sheetOf();
  assert.equal(sheetWire(plain).v, 1);
  assert.equal(sheetWire(plain).j, undefined);
  assert.deepEqual(decodeSheet(encodeSheet(plain)), plain);
  // a version 1 code made by an older copy
  const got = decodeSheet(
    scode({ v: 1, i: ID, n: 'Bar', d: '2026-10-09', m: 'h', r: [['Sam', 60, 100, 0]] }),
  );
  assert.deepEqual(got.rows, [{ name: 'Sam', minutes: 60, cc: 100, cash: 0 }]);
});

test('sheet ids and job names are read strictly', () => {
  const ok = {
    v: 2,
    i: ID,
    n: 'Bar',
    d: '2026-10-09',
    m: 'h',
    j: [['j1', 'Bartender']],
    r: [['Sam', 60, 100, 0, 0]],
  };
  assert.ok(decodeSheet(scode(ok)));
  const bad = (over) => decodeSheet(scode({ ...ok, ...over }));
  assert.equal(bad({ j: [['J1', 'Bartender']] }), null, 'bad id');
  assert.equal(bad({ j: [['abcde', 'Bartender']] }), null, 'oversized id');
  assert.equal(bad({ j: [['', 'Bartender']] }), null, 'empty id');
  assert.equal(
    bad({
      j: [
        ['j1', 'Bartender'],
        ['j1', 'Door'],
      ],
    }),
    null,
    'duplicate id',
  );
  assert.equal(bad({ j: [['j1', '']] }), null, 'no job name');
  assert.equal(bad({ j: [['j1', 'x'.repeat(41)]] }), null, 'job name too long');
  assert.equal(bad({ j: [['j1', 'Bar\u0007']] }), null, 'control character');
  assert.equal(bad({ j: [['j1']] }), null);
  assert.equal(bad({ j: [] }), null, 'version 2 has a table');
  assert.equal(bad({ j: undefined }), null);
  assert.equal(bad({ j: 'j1' }), null);
  assert.equal(bad({ r: [['Sam', 60, 100, 0, 1]] }), null, 'a place outside the table');
  assert.equal(bad({ r: [['Sam', 60, 100, 0, -1]] }), null);
  assert.equal(bad({ r: [['Sam', 60, 100, 0, '0']] }), null);
  assert.equal(bad({ r: [['Sam', 60, 100, 0, 0, 0]] }), null, 'too many items');
  assert.equal(bad({ v: 1 }), null, 'version 1 has no table');
  assert.equal(bad({ v: 3 }), null);
  const nine = Array.from({ length: 9 }, (_, i) => ['j' + i, 'Job ' + i]);
  assert.equal(bad({ j: nine }), null, 'more jobs than a venue has');
  // readable form: both or neither, one name per id
  const row = { name: 'Sam', minutes: 60, cc: 100, cash: 0 };
  assert.equal(checkSheet(sheetOf({ rows: [{ ...row, vj: 'j1' }] })), null);
  assert.equal(checkSheet(sheetOf({ rows: [{ ...row, job: 'Bartender' }] })), null);
  assert.equal(
    checkSheet(
      sheetOf({
        rows: [
          { ...row, vj: 'j1', job: 'Bartender' },
          { ...row, name: 'Al', vj: 'j1', job: 'Door' },
        ],
      }),
    ),
    null,
    'one id, two names',
  );
});

test('50 rows still fit: with venue jobs on a sheet, and the existing message when names are long', () => {
  const rows = (n, name, job, big) =>
    Array.from({ length: n }, (_, i) => {
      const r = big
        ? { name: name(i), minutes: 1439, cc: 1234567, cash: 1234567 }
        : { name: name(i), minutes: 450, cc: 12345, cash: 2050 };
      return job ? { ...r, vj: 'j' + ((i % 4) + 1), job: 'Job ' + ((i % 4) + 1) } : r;
    });
  const short = sheetOf({ rows: rows(MAX_SHEET_ROWS, (i) => 'Person ' + i, true) });
  const text = encodeSheet(short);
  assert.ok(Buffer.from(text, 'base64url').length <= MAX_SHEET_BYTES);
  assert.equal(decodeSheet(text).rows.length, 50);
  // 24-character names and four venue jobs still fit with everyday amounts
  const roomy = encodeSheet(
    sheetOf({ rows: rows(MAX_SHEET_ROWS, (i) => String(i).padStart(2, '0') + 'x'.repeat(22), true) }),
  );
  assert.ok(Buffer.from(roomy, 'base64url').length <= MAX_SHEET_BYTES);
  // 51 is refused whole
  assert.equal(checkSheet(sheetOf({ rows: rows(51, (i) => 'P' + i, true) })), null);
  // 24-character names with 24 hours and big amounts: the existing "too big" error, with or without jobs
  const long = (job) =>
    sheetOf({ rows: rows(MAX_SHEET_ROWS, (i) => String(i).padStart(2, '0') + 'x'.repeat(22), job, true) });
  assert.throws(() => encodeSheet(long(false)), /too-big/);
  assert.throws(() => encodeSheet(long(true)), /too-big/);
});

/* ---------- the update plan ---------- */
const mineJobs = () => [
  { id: 'p1', k: 'bartender', name: 'Bartender', rate: 14, unit: 'hr', usual: 7 },
  { id: 'p2', k: 'otherjob', name: 'Private event', rate: 20, unit: 'hr', usual: 0 },
];
const isJob = (t, i) => payKind(t, i) === 'job' && !isRetired(t);

test('update matching: by id first (a renamed job on either side), then by name, otherwise new', () => {
  const v = venue();
  // the manager renamed Bartender to Bar staff: the worker's job still carries vj j1
  const renamed = venue({ jobs: [{ ...v.jobs[0], k: 'otherjob', name: 'Bar staff' }, v.jobs[1]] });
  const mine = [{ ...mineJobs()[0], vj: 'j1' }, mineJobs()[1]];
  assert.deepEqual(autoMatchJobs(renamed, mine), ['p1', null]);
  // the worker named theirs differently (Bar lead): the id still lines them up
  const lead = [{ ...mineJobs()[0], name: 'Bar lead', vj: 'j1' }, mineJobs()[1]];
  assert.deepEqual(autoMatchJobs(v, lead), ['p1', null]);
  // no id on the worker's job: the name decides, any case, spaces ignored
  const loud = venue({ jobs: [{ ...v.jobs[0], name: ' BARTENDER ' }, v.jobs[1]] });
  assert.deepEqual(autoMatchJobs(loud, mineJobs()), ['p1', null]);
  // a different name and no id: a new job
  assert.deepEqual(autoMatchJobs(renamed, mineJobs()), [null, null]);
  // the id beats a name: j2 is named Bartender by mistake, but p1 carries j1
  const swapped = venue({
    jobs: [
      { ...v.jobs[0], id: 'j9', name: 'Server', k: 'server' },
      { ...v.jobs[1], id: 'j1', name: 'Bartender', k: 'bartender' },
    ],
  });
  assert.deepEqual(autoMatchJobs(swapped, [{ ...mineJobs()[0], vj: 'j1' }]), [null, 'p1']);
  // a version 1 venue (no ids) matches by name only
  assert.deepEqual(autoMatchJobs(noIds(v), [{ ...mineJobs()[0], vj: 'j2' }]), ['p1', null]);
  // a job is matched once
  assert.deepEqual(
    autoMatchJobs(venue({ jobs: [v.jobs[0], { ...v.jobs[1], id: 'j3', name: 'bartender' }] }), mineJobs()),
    ['p1', null],
  );
});

test('update: a mismatch is fixed with the pick; a job can be the match for one venue job only', () => {
  const v = venue();
  const mine = mineJobs();
  // the worker says venue job 2 (Door) is their Private event
  let plan = planVenueUpdate(v, mine, [], { match: [undefined, 'p2'] });
  assert.deepEqual(
    plan.jobs.map((j) => j.matchId),
    ['p1', 'p2'],
  );
  assert.deepEqual(plan.kept, [], 'nothing is left over');
  // picking p1 for both: the later one becomes a new job
  plan = planVenueUpdate(v, mine, [], { match: ['p1', 'p1'] });
  assert.deepEqual(
    plan.jobs.map((j) => j.matchId),
    ['p1', null],
  );
  // 'new' for the first: Bartender is added again as a new job and the worker's stays
  plan = planVenueUpdate(v, mine, [], { match: ['new'] });
  assert.equal(plan.jobs[0].matchId, null);
  assert.deepEqual(
    plan.kept.map((t) => t.id),
    ['p1', 'p2'],
  );
  // an unknown id is a new job
  plan = planVenueUpdate(v, mine, [], { match: ['nope'] });
  assert.equal(plan.jobs[0].matchId, null);
});

test('update: a matched job keeps the worker’s name and rate; the venue rate only when chosen; new jobs get the venue rate (editable)', () => {
  const v = venue();
  const pay = [
    ...mineJobs(),
    { id: 'p3', k: 'bonus', name: 'Bonus', rate: 0, unit: 'amt', usual: 0, supp: 1 },
  ];
  let out = applyVenueUpdate(v, pay, isJob);
  assert.deepEqual(
    out.map((t) => [t.id, t.name, t.rate, t.unit, t.vj]),
    [
      ['p1', 'Bartender', 14, 'hr', 'j1'],
      ['p2', 'Private event', 20, 'hr', undefined],
      ['p4', 'Door', 15, 'shift', 'j2'],
      ['p3', 'Bonus', 0, 'amt', undefined],
    ],
    'Bartender keeps $14 (default: keep mine), Private event stays, Door is new at $15, other pay stays',
  );
  const plan = planVenueUpdate(v, mineJobs(), []);
  assert.equal(plan.jobs[0].differs, true);
  assert.equal(plan.jobs[0].useVenue, false, 'keep mine is the default');
  // use the venue's
  out = applyVenueUpdate(v, pay, isJob, { useVenue: [true] });
  assert.deepEqual([out[0].rate, out[0].unit, out[0].name], [12, 'hr', 'Bartender']);
  // a new job with the worker's own rate
  out = applyVenueUpdate(v, pay, isJob, { newRate: [undefined, 17.5] });
  assert.equal(out.find((t) => t.vj === 'j2').rate, 17.5);
  // a new job's rate that is not a rate falls back to the venue's
  out = applyVenueUpdate(v, pay, isJob, { newRate: [undefined, -3] });
  assert.equal(out.find((t) => t.vj === 'j2').rate, 15);
  // a worker rate of 0 is not a rate yet: the venue's is the default
  const blank = [{ ...mineJobs()[0], rate: 0 }];
  assert.equal(planVenueUpdate(v, blank, []).jobs[0].useVenue, true);
  assert.equal(applyVenueUpdate(v, blank, isJob)[0].rate, 12);
  // the same rate and unit is not a difference
  const same = [{ ...mineJobs()[0], rate: 12 }];
  assert.equal(planVenueUpdate(v, same, []).jobs[0].differs, false);
  // the same number but per shift is
  assert.equal(planVenueUpdate(v, [{ ...same[0], unit: 'shift' }], []).jobs[0].differs, true);
});

test('update: the worker’s own jobs the venue does not list stay; Remove takes one out (never the main job), a used one is retired', () => {
  const v = venue({ jobs: [venue().jobs[0]] });
  const pay = mineJobs();
  let plan = planVenueUpdate(v, pay, []);
  assert.deepEqual(
    plan.kept.map((t) => t.name),
    ['Private event'],
  );
  assert.equal(plan.remove.size, 0);
  assert.deepEqual(
    applyVenueUpdate(v, pay, isJob).map((t) => t.id),
    ['p1', 'p2'],
  );
  assert.deepEqual(
    applyVenueUpdate(v, pay, isJob, { remove: ['p2'] }).map((t) => t.id),
    ['p1'],
  );
  // the main job is never removed, even if asked
  plan = planVenueUpdate(venue({ jobs: [venue().jobs[1]] }), pay, [], { remove: ['p1', 'p2'] });
  assert.deepEqual([...plan.remove], ['p2'], 'p1 is the main job');
  // a removed job a saved night used is kept, retired, exactly as Setup's Save does
  const nights = [{ id: 1, pay: { p2: 5 } }];
  const after = keepUsedPay(pay, applyVenueUpdate(v, pay, isJob, { remove: ['p2'] }), nights);
  assert.deepEqual(
    after.map((t) => [t.id, t.retired || 0]),
    [
      ['p1', 0],
      ['p2', 1],
    ],
  );
});

test('update: "Nothing to update" when there is no difference; a missing link or a rate choice counts', () => {
  const v = venue();
  const settled = [
    { id: 'p1', k: 'bartender', name: 'Bartender', rate: 12, unit: 'hr', usual: 7, vj: 'j1' },
    { id: 'p2', k: 'otherjob', name: 'Door', rate: 15, unit: 'shift', usual: 0, vj: 'j2' },
  ];
  const people = venueTipouts(v).list;
  assert.equal(planVenueUpdate(v, settled, people).changes, 0);
  // only the link is missing: it is still a change (so later renames line up), and it is said
  const unlinked = settled.map(({ vj, ...t }) => t);
  const plan = planVenueUpdate(v, unlinked, people);
  assert.equal(plan.changes, 2);
  assert.deepEqual(
    plan.jobs.map((j) => j.link),
    [true, true],
  );
  // a different rate, kept as the worker's own, is a difference shown but not a change
  const mineRate = settled.map((t, i) => (i === 0 ? { ...t, rate: 14 } : t));
  assert.equal(planVenueUpdate(v, mineRate, people).changes, 0);
  assert.equal(planVenueUpdate(v, mineRate, people, { useVenue: [true] }).changes, 1);
});

test('update: tip-outs follow the venue; ids and ticks carry over (vt first, then kind and name)', () => {
  const v = venue();
  const mine = [
    { id: 'tx', k: 'barback', who: 'Bar back', mode: 'pctTips', value: 10, from: 'cash', vt: 't1' },
    { id: 'ty', k: 'host', who: 'host', mode: 'flat', value: 20, from: 'payroll' },
    { id: 'tz', k: 'runner', who: 'Runner', mode: 'flat', value: 5, from: 'cash' },
  ];
  const plan = planVenueUpdate(v, mineJobs(), mine);
  assert.deepEqual(
    plan.tipouts.changed.map((c) => [c.before.id, c.after.id, c.after.who, c.after.value]),
    [
      ['tx', 'tx', 'Barback', 15],
      ['ty', 'ty', 'Host', 20],
    ],
    'matched by vt (a rename), and by kind and name; the id stays',
  );
  assert.equal(plan.tipouts.added.length, 0);
  assert.deepEqual(
    plan.tipouts.removed.map((r) => r.id),
    ['tz'],
  );
  const to = venueTipouts(v, mine);
  assert.deepEqual(
    to.list.map((r) => [r.id, r.vt]),
    [
      ['tx', 't1'],
      ['ty', 't2'],
    ],
  );
  // a person only in the venue's list is added with a free id
  const added = planVenueUpdate(v, mineJobs(), [mine[0]]);
  assert.deepEqual(
    added.tipouts.added.map((r) => [r.id, r.who]),
    [['t1', 'Host']],
  );
});
