// TipNet Teams data in the saved state: workplace.venue and settings.team survive loading and backups, and junk is dropped.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  migrate,
  seedState,
  encodeBackup,
  decodeBackup,
  backupFileText,
  decodeBackupFile,
  mergeStates,
} from '../app/js/storage.js';

const TODAY = '2026-10-01';
const ID = 'AbCdEf012345';
const VENUE = {
  id: ID,
  name: 'The Corner Bar',
  freq: 14,
  start: '2026-09-07',
  end: '2026-09-20',
  delay: 5,
  jobs: [{ k: 'bartender', name: 'Bartender', rate: 1200, unit: 'hr' }],
  tipouts: [{ k: 'barback', who: 'Barback', mode: 'pctTips', value: 1500, from: 'cash' }],
};
const real = (mutate) => {
  const S = seedState();
  S.profileExample = false;
  S.nightsExample = false;
  S.nights = [];
  S.workplaces[0].setupDone = true;
  if (mutate) mutate(S);
  return migrate(JSON.parse(JSON.stringify(S)), { today: TODAY });
};

test('a valid venue on an establishment is kept (and cleaned)', () => {
  const S = real((x) => (x.workplaces[0].venue = { id: ID, name: '  The Corner Bar ', extra: 1 }));
  assert.deepEqual(S.workplaces[0].venue, { id: ID, name: 'The Corner Bar' });
});

test('an invalid venue is dropped, the establishment is untouched', () => {
  const bad = [
    { id: 'short', name: 'Bar' },
    { id: ID, name: '' },
    { id: ID, name: 'x'.repeat(401) },
    { id: ID },
    { name: 'Bar' },
    { id: 12345678901234, name: 'Bar' },
    { id: 'has space in it', name: 'Bar' },
    'The Corner Bar',
    [],
    null,
    { id: ID, name: 'Bad\u0007' },
  ];
  for (const v of bad) {
    const S = real((x) => (x.workplaces[0].venue = v));
    assert.equal('venue' in S.workplaces[0], false, JSON.stringify(v));
    assert.equal(S.workplaces[0].name, 'My establishment');
  }
});

test('a venue name over 40 characters is cut to 40, not dropped (one rule with Phase 1)', () => {
  const S = real((x) => (x.workplaces[0].venue = { id: ID, name: 'x'.repeat(41) }));
  assert.deepEqual(S.workplaces[0].venue, { id: ID, name: 'x'.repeat(40) });
});

test('settings.team keeps the venue id, the last venue code made and the staff list; junk is dropped', () => {
  const S = real(
    (x) =>
      (x.settings.team = {
        venueId: ID,
        venue: VENUE,
        name: 'The Corner Bar',
        staff: [
          { name: 'Sam', role: 'Bartender', points: 150 },
          { name: '', role: 'x', points: 1 },
          { name: 'Alex', role: '', points: -5 },
          'junk',
        ],
        junk: 1,
      }),
  );
  assert.deepEqual(S.settings.team, {
    venue: VENUE,
    venueId: ID,
    name: 'The Corner Bar',
    staff: [
      { name: 'Sam', role: 'Bartender', points: 150 },
      { name: 'Alex', role: '', points: 100 },
    ],
  });
  for (const t of [null, 5, 'x', [], {}, { venueId: 'bad' }, { venue: { id: ID } }, { staff: 'x' }]) {
    const T = real((x) => (x.settings.team = t));
    assert.equal('team' in T.settings, false, JSON.stringify(t));
  }
  assert.deepEqual(real((x) => (x.settings.team = { venueId: ID })).settings.team, { venueId: ID });
});

test('the Teams tab is a valid last tab; unknown tabs still fall back to Tonight', () => {
  assert.equal(real((x) => (x.settings.lastTab = 'team')).settings.lastTab, 'team');
  assert.equal(real((x) => (x.settings.lastTab = 'managers')).settings.lastTab, 'tonight');
});

test('backups carry the venue, the venue id and the staff list (code and file)', () => {
  const S = real((x) => {
    x.workplaces[0].venue = { id: ID, name: 'The Corner Bar' };
    x.settings.team = { venueId: ID, venue: VENUE, staff: [{ name: 'Sam', role: 'Bar', points: 100 }] };
    x.settings.entitlement = { plan: 'dev', key: 'k', instanceId: 'i', status: 'active', validatedAt: 'x' };
  });
  for (const back of [decodeBackup(encodeBackup(S)), decodeBackupFile(backupFileText(S))]) {
    assert.deepEqual(back.workplaces[0].venue, { id: ID, name: 'The Corner Bar' });
    assert.equal(back.settings.team.venueId, ID);
    assert.deepEqual(back.settings.team.venue, VENUE);
    assert.deepEqual(back.settings.team.staff, [{ name: 'Sam', role: 'Bar', points: 100 }]);
    assert.equal(back.settings.entitlement, undefined, 'the license still stays on the device');
  }
});

test('a hand-made backup with a bad venue loses only the bad venue', () => {
  const S = real((x) => {
    x.workplaces[0].venue = { id: ID, name: 'Bar' };
  });
  const raw = JSON.parse(backupFileText(S));
  raw.workplaces[0].venue = { id: '<script>', name: 'Bar' };
  raw.settings.team = { venueId: '<script>', staff: [{ name: '<b>Sam</b>', role: 'x', points: 100 }] };
  const back = decodeBackupFile(JSON.stringify(raw));
  assert.equal('venue' in back.workplaces[0], false);
  assert.equal(back.settings.team.venueId, undefined);
  assert.equal(
    back.settings.team.staff[0].name,
    '<b>Sam</b>',
    'a name is text: it is only ever shown as text',
  );
  assert.equal(back.workplaces[0].profile.payTypes.length > 0, true);
});

test('two open copies: a venue set in one window is kept when the other saves', () => {
  const base = real();
  const mine = JSON.parse(JSON.stringify(base));
  mine.workplaces[0].venue = { id: ID, name: 'The Corner Bar' };
  mine.settings.team = { venueId: ID };
  const theirs = JSON.parse(JSON.stringify(base));
  theirs.settings.theme = 'dark';
  const merged = mergeStates(base, mine, theirs);
  assert.deepEqual(merged.workplaces[0].venue, { id: ID, name: 'The Corner Bar' });
  assert.deepEqual(merged.settings.team, { venueId: ID });
  assert.equal(merged.settings.theme, 'dark');
});
