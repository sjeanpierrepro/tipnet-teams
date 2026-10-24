// Staff side: opening a venue link. Read strictly, removed from the address, shown first, and only then applied:
// no setup yet (guided setup starts filled in), an existing setup (a new establishment), or the same venue (update).
import test from 'node:test';
import assert from 'node:assert/strict';
import { boot, realState } from './harness.js';
import { VID, venue, joinUrl, DEV, fill } from './teams-util.js';
import { encodeVenue, BAD_LINK_MSG } from '../../app/js/venue.js';
import { addDays, todayISO, exampleProfile } from '../../app/js/math.js';

const today = todayISO();
const clone = (o) => JSON.parse(JSON.stringify(o));
const setUpState = (mutate) =>
  realState((S) => {
    S.workplaces[0].setupDone = true;
    S.workplaces[0].name = 'Voodoo Bayou';
    if (mutate) mutate(S);
  });
const tabNow = (page) => page.$('#tabs [aria-selected="true"]').dataset.tab;

test('a link is read, taken out of the address at once, and shown before anything is changed', async () => {
  const page = await boot({ url: joinUrl() });
  try {
    assert.equal(page.win.location.hash, '', 'the fragment is gone from the address');
    assert.ok(!page.win.location.href.includes('join='));
    const v = venue();
    assert.match(page.text(page.$('#join-h1')), /^Join The Corner Bar$/);
    const t = page.text(page.$('#join-preview'));
    assert.match(t, /Every two weeks/);
    assert.match(t, /Payday/);
    assert.match(t, /Bartender\s*\$12\.00 an hour/);
    assert.match(t, /Door\s*\$15\.00 a shift/);
    assert.match(t, /Barback\s*15% of tips, from cash/);
    assert.match(t, /Host\s*\$20\.00 flat, through payroll/);
    assert.ok(
      t.includes(
        new Date(v.start + 'T00:00:00Z').toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          timeZone: 'UTC',
        }),
      ),
    );
    // nothing changed or stored yet
    assert.equal(page.state().workplaces[0].venue, undefined);
    assert.equal(page.state().settings.guidedDraft, undefined);
    // Not now: nothing changed, the normal screen is back
    page.click(page.$('#join-not-now'));
    assert.equal(page.$('#join-screen'), null);
    assert.equal(page.state().workplaces[0].venue, undefined);
    assert.equal(page.state().workplaces.length, 1);
  } finally {
    await page.close();
  }
});

test('a link opened while the app is open (only the fragment changes) is read the same way', async () => {
  const page = await boot({ seed: setUpState() });
  try {
    assert.equal(page.$('#join-screen'), null);
    page.win.location.hash = '#join=' + encodeVenue(venue());
    page.win.dispatchEvent(new page.win.Event('hashchange'));
    await page.settle();
    assert.ok(page.$('#join-screen'));
    assert.equal(page.win.location.hash, '');
  } finally {
    await page.close();
  }
});

test('no setup yet: "Set up with these" starts the guided setup filled in, with the venue kept; the worker adds their own numbers', async () => {
  const v = venue();
  const page = await boot({ url: joinUrl(v) });
  try {
    assert.match(page.text(page.$('#join-screen')), /still add your own gross pay, deductions and shifts/);
    assert.match(
      page.text(page.$('#join-screen')),
      /TipNet sets up The Corner Bar with these./,
      'it names what it fills in',
    );
    assert.equal(page.$('#managers-card'), null, 'no Teams card under the Join screen');
    page.click(page.$('#join-start'));
    await page.settle();
    assert.equal(tabNow(page), 'setup');
    assert.equal(page.$('#join-screen'), null);
    // venue stored on the establishment, named after the venue
    const w = page.state().workplaces[0];
    assert.deepEqual(w.venue, { id: VID, name: 'The Corner Bar' });
    assert.equal(w.name, 'The Corner Bar');
    // step 1: the schedule is filled in; gross pay and shifts are not
    const dates = page.$$('input[type=date]', page.app);
    assert.equal(dates[0].value, v.start);
    assert.equal(dates[1].value, v.end);
    assert.equal(dates[2].value, addDays(v.end, 5));
    assert.equal(page.$('input[placeholder="e.g. 2,000"]', page.app).value, '');
    page.type(page.$('input[placeholder="e.g. 2,000"]', page.app), '900');
    page.type(page.$('input[placeholder="e.g. 10"]', page.app), '10');
    page.click(page.button('Next'));
    // step 2: deductions are the worker's own
    page.type(page.$$('input[id^="da-"]', page.app)[0], '60');
    page.click(page.button('Next'));
    // step 3: the venue's jobs and tip-outs are filled in
    assert.equal(page.$('#pr-p1').value, '12');
    assert.ok(page.$('#pr-p2'), 'the second job');
    assert.match(page.text(page.$('#app')), /Barback/);
    assert.match(page.text(page.$('#app')), /Host/);
    page.click(page.button('Finish setup'));
    await page.settle();
    const S = page.state();
    const p = S.workplaces[0].profile;
    assert.equal(S.workplaces[0].setupDone, true);
    assert.equal(S.profileExample, false);
    assert.deepEqual(S.workplaces[0].venue, { id: VID, name: 'The Corner Bar' });
    assert.equal(p.freq, 14);
    assert.equal(p.periodStart, v.start);
    assert.equal(p.payDelay, 5);
    assert.equal(p.gross, 900);
    assert.deepEqual(
      p.payTypes.map((t) => [t.k, t.name, t.rate, t.unit]),
      [
        ['bartender', 'Bartender', 12, 'hr'],
        ['otherjob', 'Door', 15, 'shift'],
      ],
    );
    assert.deepEqual(
      p.tipouts.map((r) => [r.k, r.mode, r.value, r.from]),
      [
        ['barback', 'pctTips', 15, 'cash'],
        ['host', 'flat', 20, 'payroll'],
      ],
    );
    assert.equal(p.tipout.on, true);
  } finally {
    await page.close();
  }
});

test('no setup yet: the filled-in guided setup survives a reload (the venue stays)', async () => {
  const page = await boot({ url: joinUrl() });
  try {
    page.click(page.$('#join-start'));
    await page.settle();
    const again = await boot({ seed: clone(page.state()) });
    try {
      assert.equal(tabNow(again), 'setup');
      assert.equal(again.$$('input[type=date]', again.app)[0].value, venue().start);
      assert.equal(again.state().workplaces[0].venue.id, VID);
    } finally {
      await again.close();
    }
  } finally {
    await page.close();
  }
});

test('existing establishments: "Add as a new establishment" starts its own guided setup with the venue filled in', async () => {
  const page = await boot({ seed: setUpState(), url: joinUrl() });
  try {
    assert.ok(page.$('#join-add'));
    assert.equal(page.$('#join-update'), null);
    assert.equal(page.$('#join-start'), null);
    page.click(page.$('#join-add'));
    await page.settle();
    const S = page.state();
    assert.equal(S.workplaces.length, 2);
    const w = S.workplaces[1];
    assert.equal(w.name, 'The Corner Bar');
    assert.deepEqual(w.venue, { id: VID, name: 'The Corner Bar' });
    assert.equal(w.setupDone, false);
    assert.equal(w.profile.payTypes[0].rate, 12);
    assert.equal(w.profile.tipouts.length, 2);
    assert.equal(S.settings.activeWorkplaceId, w.id);
    assert.equal(tabNow(page), 'setup');
    assert.match(page.text(page.$('#app h1')), /Set up The Corner Bar/);
    // the first establishment is untouched
    assert.equal(S.workplaces[0].venue, undefined);
    assert.equal(S.workplaces[0].name, 'Voodoo Bayou');
  } finally {
    await page.close();
  }
});

test('existing establishments: a name already taken gets a number', async () => {
  const page = await boot({
    seed: setUpState((S) => (S.workplaces[0].name = 'The Corner Bar')),
    url: joinUrl(),
  });
  try {
    page.click(page.$('#join-add'));
    assert.equal(page.state().workplaces[1].name, 'The Corner Bar 2');
  } finally {
    await page.close();
  }
});

const threePlaces = () =>
  setUpState((S) => {
    for (const i of [2, 3])
      S.workplaces.push({
        id: 'w' + i,
        name: 'Bar ' + i,
        profile: exampleProfile(today),
        calib: [],
        setupDone: true,
      });
  });

test('the limit is respected: 3 free, with the existing message, and nothing is added', async () => {
  const page = await boot({ seed: threePlaces(), url: joinUrl() });
  try {
    const add = page.$('#join-add');
    assert.equal(add.disabled, true);
    assert.match(
      page.$('#wp-limit').textContent,
      /^You can have up to 3 establishments in the free app\. TipNet Budget \(coming soon\) will allow up to 5\./,
    );
    page.click(add);
    assert.equal(page.state().workplaces.length, 3);
  } finally {
    await page.close();
  }
});

test('the limit is 5 with Budget unlocked', async () => {
  const S = threePlaces();
  const page = await boot({ seed: S, url: 'http://localhost/?unlock=dev#join=' + encodeVenue(venue()) });
  try {
    assert.equal(page.$('#join-add').disabled, false);
    page.click(page.$('#join-add'));
    assert.equal(page.state().workplaces.length, 4);
  } finally {
    await page.close();
  }
});

const BARBACK = { id: 't1', k: 'barback', who: 'Barback', mode: 'pctTips', value: 10, from: 'cash' };
const start = addDays(today, -28);
/** An establishment from this venue: a finished pay period with a locked night, and a night in the running one. */
const sameVenueState = () =>
  realState((S) => {
    const w = S.workplaces[0];
    w.setupDone = true;
    w.name = 'Corner';
    w.venue = { id: VID, name: 'Old Corner Name' };
    Object.assign(w.profile, {
      periodStart: start,
      periodEnd: addDays(start, 13),
      freq: 14,
      shifts: 10,
      gross: 1500,
      tipout: { on: true },
      tipouts: [{ ...BARBACK }],
    });
    w.profile.payTypes = [
      { id: 'p1', k: 'bartender', name: 'Bartender', rate: 9, unit: 'hr', usual: 7 },
      { id: 'p2', k: 'training', name: 'Training', rate: 9, unit: 'hr', usual: 0 },
      { id: 'p3', k: 'bonus', name: 'Bonus', rate: 0, unit: 'amt', usual: 0, supp: 1 },
    ];
    const night = (id, ago, pay) => ({
      id,
      date: addDays(today, -ago),
      total: 400,
      tips: 300,
      cash: 100,
      pay,
      barback: true,
      tipouts: { t1: true },
      tipoutOn: true,
      workplaceId: 'w1',
    });
    S.nights = [night(1, 22, { p1: 8 }), night(2, 20, { p1: 6, p2: 2 }), night(3, 0, { p1: 5 })];
  });

test('the same venue id: offers an update (two taps), changes only jobs and tip-outs, never a finished pay period', async () => {
  const page = await boot({ seed: sameVenueState(), url: joinUrl() });
  try {
    assert.equal(page.$('#join-add'), null, 'no second copy of the same venue');
    const btn = page.must(page.$('#join-update'), 'update button');
    assert.equal(btn.textContent, 'Update jobs and tip-outs from The Corner Bar');
    assert.match(
      page.text(page.$('#join-screen')),
      /pay periods that have ended keep the pay they were saved with/,
    );
    const before = clone(page.state());
    const lockedBefore = clone(before.nights[1]);
    assert.ok(lockedBefore.snap, 'the finished pay period is locked');
    page.click(btn);
    assert.match(btn.textContent, /Tap again to update Corner/);
    assert.deepEqual(
      page.state().workplaces[0].profile.payTypes,
      before.workplaces[0].profile.payTypes,
      'one tap changes nothing',
    );
    page.click(btn);
    await page.settle();
    const S = page.state();
    const w = S.workplaces[0];
    assert.deepEqual(w.venue, { id: VID, name: 'The Corner Bar' });
    assert.equal(w.name, 'Corner', 'the name the worker gave stays');
    assert.deepEqual(
      w.profile.payTypes.map((t) => [t.id, t.k, t.rate, t.retired || 0]),
      [
        ['p1', 'bartender', 12, 0],
        ['p2', 'training', 9, 1],
        ['p4', 'otherjob', 15, 0],
        ['p3', 'bonus', 0, 0],
      ],
      'Bartender keeps its id and gets the venue rate, Bonus stays, Training is retired (a night used it), Door is new',
    );
    assert.deepEqual(
      w.profile.tipouts.map((r) => [r.id, r.k, r.value, r.mode]),
      [
        ['t1', 'barback', 15, 'pctTips'],
        ['t2', 'host', 20, 'flat'],
      ],
      'the barback keeps its id, the rate follows the venue',
    );
    // what is not the venue's stays
    assert.equal(w.profile.gross, 1500);
    assert.equal(w.profile.periodStart, start);
    assert.equal(w.profile.deductions.length, before.workplaces[0].profile.deductions.length);
    // finished pay periods are exactly as they were
    assert.deepEqual(
      S.nights.find((n) => n.id === 2),
      lockedBefore,
    );
    assert.deepEqual(S.nights.find((n) => n.id === 1).snap, before.nights[0].snap);
    assert.equal(
      S.nights.find((n) => n.id === 1).snap.pay[0].rate,
      9,
      'the locked night still has the rate it was saved with',
    );
  } finally {
    await page.close();
  }
});

test('bad links: the plain message, nothing changed, OK goes back', async () => {
  const cases = [
    'http://localhost/#join=%%%garbage',
    'http://localhost/#join=',
    'http://localhost/#join=' + Buffer.from('{"v":2}').toString('base64url'),
    'http://localhost/#join=' + Buffer.from(JSON.stringify({ v: 1 })).toString('base64url'),
    'http://localhost/#join=' + 'A'.repeat(4000),
    'http://localhost/#sheet=zzzz',
  ];
  for (const url of cases) {
    const page = await boot({ seed: setUpState(), url });
    try {
      assert.equal(page.win.location.hash, '', 'removed even when it is bad');
      const msg = page.text(page.$('#link-bad'));
      assert.ok(msg.includes(url.includes('#sheet') ? 'isn’t a TipNet Teams tip sheet' : BAD_LINK_MSG), msg);
      assert.equal(page.state().workplaces.length, 1);
      assert.equal(page.state().workplaces[0].venue, undefined);
      page.click(page.$('#link-bad-ok'));
      assert.equal(page.$('#link-bad'), null);
    } finally {
      await page.close();
    }
  }
  assert.equal(
    BAD_LINK_MSG,
    'This link isn’t a TipNet Teams venue code (or it’s from a newer version). Nothing was changed.',
  );
});

test('a link with a prototype key is refused and pollutes nothing', async () => {
  const w = JSON.parse(Buffer.from(encodeVenue(venue()), 'base64url').toString('utf8'));
  const text = JSON.stringify(w).slice(0, -1) + ',"__proto__":{"polluted":"yes"}}';
  const page = await boot({
    seed: setUpState(),
    url: 'http://localhost/#join=' + Buffer.from(text).toString('base64url'),
  });
  try {
    assert.match(page.text(page.$('#link-bad')), /Nothing was changed/);
    assert.equal({}.polluted, undefined);
  } finally {
    await page.close();
  }
});

test('Setup > Join your venue: paste a link or a bare code; a bad paste says so', async () => {
  const page = await boot({ seed: setUpState() });
  try {
    page.tab('setup');
    page.click(page.byText('button.fold-head', 'Join your venue'));
    fill(page, '#join-code', 'hello there');
    page.click(page.$('#join-go'));
    assert.match(
      page.text(page.$('#join-code').parentNode.parentNode),
      /This isn’t a TipNet Teams venue code or tip sheet link/,
    );
    assert.equal(page.$('#join-screen'), null);
    fill(page, '#join-code', joinUrl());
    page.click(page.$('#join-go'));
    assert.match(page.text(page.$('#join-h1')), /Join The Corner Bar/);
    page.click(page.$('#join-not-now'));
    page.tab('setup');
    page.click(page.byText('button.fold-head', 'Join your venue'));
    fill(page, '#join-code', encodeVenue(venue()));
    page.click(page.$('#join-go'));
    assert.ok(page.$('#join-add'));
  } finally {
    await page.close();
  }
});

test('first run: "Joining a venue? Paste its link or code" is on the first guided step', async () => {
  const page = await boot();
  try {
    page.tab('setup');
    page.click(page.$('#join-link'));
    fill(page, '#join-code', joinUrl());
    page.click(page.$('#join-go'));
    page.click(page.$('#join-start'));
    await page.settle();
    assert.equal(page.state().workplaces[0].venue.id, VID);
  } finally {
    await page.close();
  }
});

test('a change typed in Setup and not saved is never lost to a join: it asks first', async () => {
  const page = await boot({ seed: setUpState(), url: DEV });
  try {
    page.openSetup();
    page.type(page.$('input[id^="pr-"]', page.app), '14');
    page.win.location.hash = '#join=' + encodeVenue(venue());
    page.win.dispatchEvent(new page.win.Event('hashchange'));
    await page.settle();
    page.click(page.$('#join-add'));
    assert.match(page.text(page.$('#join-screen')), /changes in Setup that aren’t saved/);
    assert.equal(page.state().workplaces.length, 1);
  } finally {
    await page.close();
  }
});

test('picking a tab puts a waiting link aside; nothing was changed', async () => {
  const page = await boot({ seed: setUpState(), url: joinUrl() });
  try {
    assert.ok(page.$('#join-screen'));
    page.tab('periods');
    assert.equal(page.$('#join-screen'), null);
    assert.equal(tabNow(page), 'periods');
    assert.equal(page.state().workplaces.length, 1);
    assert.equal(page.state().workplaces[0].venue, undefined);
  } finally {
    await page.close();
  }
});
