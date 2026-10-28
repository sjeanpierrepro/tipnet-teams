// Staff side: "Update from <Venue>" is a preview the worker confirms. Jobs are matched by the venue's job id, then by name;
// a matched job keeps the worker's own name and rate unless they choose the venue's; the worker's other jobs stay;
// tip-outs follow the venue and keep their ids and ticks; nothing changes until "Apply these changes".
import test from 'node:test';
import assert from 'node:assert/strict';
import { boot, realState } from './harness.js';
import { VID, venue, withIds, joinUrl } from './teams-util.js';
import { addDays, todayISO } from '../../app/js/math.js';

const today = todayISO();
const clone = (o) => JSON.parse(JSON.stringify(o));
const start = addDays(today, -28);
const key = (page, k) => page.must(page.$('[data-focus-key="' + k + '"]'), k);
const pick = (page, id, value) => {
  const s = page.must(page.$('#' + id), id);
  s.value = value;
  page.change(s);
};
const text = (page) => page.text(page.$('#join-screen'));

const BARBACK = { id: 'tx', k: 'barback', who: 'Barback', mode: 'pctTips', value: 10, from: 'cash' };
/** A worker who set up from this venue: Bartender at $14 (the venue pays $12), plus their own Private event job. */
const state = (mutate) =>
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
      tipouts: [{ ...BARBACK, vt: 't1' }],
    });
    w.profile.payTypes = [
      { id: 'p1', k: 'bartender', name: 'Bartender', rate: 14, unit: 'hr', usual: 7, vj: 'j1' },
      { id: 'p2', k: 'otherjob', name: 'Private event', rate: 20, unit: 'hr', usual: 0 },
      { id: 'p3', k: 'bonus', name: 'Bonus', rate: 0, unit: 'amt', usual: 0, supp: 1 },
    ];
    if (mutate) mutate(S, w);
  });
const night = (id, ago, pay, tipouts = { tx: true }) => ({
  id,
  date: addDays(today, -ago),
  total: 400,
  tips: 300,
  cash: 100,
  pay,
  tipouts,
  tipoutOn: true,
  workplaceId: 'w1',
});
const jobs = (page) => page.state().workplaces[0].profile.payTypes;

test('nothing changes while the preview is open; one button applies it', async () => {
  const page = await boot({ seed: state(), url: joinUrl(withIds()) });
  try {
    const before = clone(page.state());
    assert.equal(page.$('#join-update').textContent, 'Apply these changes');
    assert.equal(page.$('#join-update').getAttribute('aria-pressed'), null);
    assert.deepEqual(page.state().workplaces[0], before.workplaces[0]);
    page.click(page.$('#join-update'));
    await page.settle();
    // one tap: applied, back to Setup
    assert.equal(page.$('#join-screen'), null);
    assert.equal(page.state().workplaces[0].venue.name, 'The Corner Bar');
  } finally {
    await page.close();
  }
});

test('matched by id after the manager renamed the job, and the worker keeps their own name and rate', async () => {
  // the venue now calls its first job "Bar staff"; the worker's job still carries id j1
  const v = withIds();
  v.jobs[0] = { id: 'j1', k: 'otherjob', name: 'Bar staff', rate: 1300, unit: 'hr' };
  const page = await boot({ seed: state(), url: joinUrl(v) });
  try {
    assert.equal(
      key(page, 'upd-match-0') && page.$('#upd-match-0').value,
      'p1',
      'lined up by id, not by name',
    );
    assert.match(text(page), /Bar staff · \$13\.00\/h/);
    assert.match(page.text(page.$('#upd-keeps-0')), /Stays “Bartender” at your rate/);
    assert.match(page.text(page.$('#upd-rates-0')), /The Corner Bar: \$13\.00\/h · yours: \$14\.00\/h/);
    // the words follow the choice: the venue's rate, then back to mine
    page.click(page.byText('#upd-job-0 button', 'Use The Corner Bar’s'));
    assert.match(
      page.text(page.$('#upd-keeps-0')),
      /Stays “Bartender”, at The Corner Bar’s rate \(\$13\.00\/h\)/,
    );
    page.click(page.byText('#upd-job-0 button', 'Keep mine'));
    assert.match(page.text(page.$('#upd-keeps-0')), /Stays “Bartender” at your rate/);
    page.click(page.$('#join-update'));
    await page.settle();
    const pay = jobs(page);
    assert.deepEqual(
      pay.map((t) => [t.id, t.name, t.rate, t.vj]),
      [
        ['p1', 'Bartender', 14, 'j1'],
        ['p2', 'Private event', 20, undefined],
        ['p4', 'Door', 15, 'j2'],
        ['p3', 'Bonus', 0, undefined],
      ],
      'no second Bartender, the old one is not retired, the rate is still the worker’s own',
    );
  } finally {
    await page.close();
  }
});

test('matched by id when the worker named their job differently', async () => {
  const s = state((S, w) => {
    w.profile.payTypes[0].name = 'Bar lead';
  });
  const page = await boot({ seed: s, url: joinUrl(withIds()) });
  try {
    assert.equal(page.$('#upd-match-0').value, 'p1');
    page.click(page.$('#join-update'));
    await page.settle();
    assert.equal(jobs(page)[0].name, 'Bar lead');
    assert.equal(jobs(page).filter((t) => t.vj === 'j1').length, 1);
  } finally {
    await page.close();
  }
});

test('matched by name (any case) when the worker’s job has no venue id yet; the link is stored', async () => {
  const s = state((S, w) => {
    delete w.profile.payTypes[0].vj;
    w.profile.payTypes[0].name = ' bartender ';
  });
  const page = await boot({ seed: s, url: joinUrl(withIds()) });
  try {
    assert.equal(page.$('#upd-match-0').value, 'p1');
    page.click(page.$('#join-update'));
    await page.settle();
    assert.equal(jobs(page)[0].vj, 'j1', 'later renames line up');
  } finally {
    await page.close();
  }
});

test('a wrong match is fixed with the select: "Same as my job" or "New job"', async () => {
  const s = state((S, w) => {
    w.profile.payTypes[0].vj = undefined;
    w.profile.payTypes[0].name = 'Bar lead'; // matches nothing by name
  });
  const page = await boot({ seed: s, url: joinUrl(withIds()) });
  try {
    // nothing lined up by name or id: both venue jobs are new
    assert.equal(page.$('#upd-match-0').value, 'new');
    assert.equal(page.$('#upd-match-1').value, 'new');
    assert.deepEqual(
      Array.from(page.$('#upd-match-0').options).map((o) => o.textContent),
      ['Bar lead', 'Private event', 'New job'],
    );
    assert.match(page.text(page.$('#upd-new-note-0')), /New job: added to your list/);
    // the worker says the venue's Bartender is their Bar lead
    pick(page, 'upd-match-0', 'p1');
    await page.settle();
    assert.equal(page.$('#upd-match-0').value, 'p1');
    assert.equal(page.$('#upd-new-0'), null, 'no new job for it any more');
    // and Door is their Private event
    pick(page, 'upd-match-1', 'p2');
    await page.settle();
    assert.equal(page.$('#upd-kept'), null, 'nothing is left over');
    // picking Bar lead for Door too sends Bartender back to a new job (a job matches one venue job only)
    pick(page, 'upd-match-1', 'p1');
    await page.settle();
    assert.equal(page.$('#upd-match-0').value, 'new');
    assert.equal(page.$('#upd-match-1').value, 'p1');
    pick(page, 'upd-match-0', 'p1');
    await page.settle();
    pick(page, 'upd-match-1', 'p2');
    await page.settle();
    page.click(page.$('#join-update'));
    await page.settle();
    assert.deepEqual(
      jobs(page).map((t) => [t.id, t.name, t.rate, t.vj]),
      [
        ['p1', 'Bar lead', 14, 'j1'],
        ['p2', 'Private event', 20, 'j2'],
        ['p3', 'Bonus', 0, undefined],
      ],
    );
  } finally {
    await page.close();
  }
});

test('a new venue job is added with its rate shown and editable; a bad rate is refused', async () => {
  const page = await boot({ seed: state(), url: joinUrl(withIds()) });
  try {
    const box = page.must(page.$('#upd-new-1'), 'rate of the new job');
    assert.equal(box.value, '15', 'the venue’s rate is the start');
    page.type(box, '0');
    page.click(page.$('#join-update'));
    await page.settle();
    assert.ok(page.$('#join-screen'), 'still here');
    assert.match(text(page), /Enter a rate for Door/);
    assert.equal(jobs(page).length, 3, 'nothing was changed');
    page.type(page.$('#upd-new-1'), '17.5');
    page.click(page.$('#join-update'));
    await page.settle();
    const door = jobs(page).find((t) => t.vj === 'j2');
    assert.deepEqual([door.name, door.rate, door.unit], ['Door', 17.5, 'shift']);
  } finally {
    await page.close();
  }
});

test('the rate choice: Keep mine is the default; Use the venue’s takes its rate', async () => {
  const page = await boot({ seed: state(), url: joinUrl(withIds()) });
  try {
    assert.equal(key(page, 'upd-rate-0-mine').getAttribute('aria-checked'), 'true');
    assert.equal(key(page, 'upd-rate-0-venue').getAttribute('aria-checked'), 'false');
    assert.equal(key(page, 'upd-rate-0-venue').textContent, 'Use The Corner Bar’s');
    page.click(key(page, 'upd-rate-0-venue'));
    await page.settle();
    assert.equal(key(page, 'upd-rate-0-venue').getAttribute('aria-checked'), 'true');
    page.click(page.$('#join-update'));
    await page.settle();
    assert.equal(jobs(page)[0].rate, 12);
    assert.equal(jobs(page)[0].name, 'Bartender', 'the worker’s name stays');
  } finally {
    await page.close();
  }
});

test('the worker’s own jobs the venue does not list stay; Remove takes one out and retires it when a night used it', async () => {
  const used = state((S) => {
    S.nights = [night(1, 5, { p1: 6, p2: 3 })];
  });
  const page = await boot({ seed: used, url: joinUrl(withIds()) });
  try {
    assert.match(page.text(page.$('#upd-kept-p2')), /Not in The Corner Bar’s list: Private event — kept/);
    assert.equal(page.$('#upd-remove-p1'), null, 'the main job is not offered');
    page.click(page.$('#upd-remove-p2'));
    await page.settle();
    assert.match(page.text(page.$('#upd-kept-p2')), /will be removed/);
    page.click(page.$('#join-update'));
    await page.settle();
    const p2 = jobs(page).find((t) => t.id === 'p2');
    assert.equal(p2.retired, 1, 'a night used it: kept for that night, off the list');
  } finally {
    await page.close();
  }
  // not used by any night: gone; and unticked it simply stays
  const page2 = await boot({ seed: state(), url: joinUrl(withIds()) });
  try {
    page2.click(page2.$('#upd-remove-p2'));
    await page2.settle();
    page2.click(page2.$('#join-update'));
    await page2.settle();
    assert.equal(
      jobs(page2).some((t) => t.id === 'p2'),
      false,
    );
  } finally {
    await page2.close();
  }
  const page3 = await boot({ seed: state(), url: joinUrl(withIds()) });
  try {
    page3.click(page3.$('#join-update'));
    await page3.settle();
    assert.ok(
      jobs(page3).some((t) => t.id === 'p2' && !t.retired),
      'kept by default',
    );
  } finally {
    await page3.close();
  }
});

test('tip-outs follow the venue: added, changed and removed are listed; ids and ticks carry over', async () => {
  const s = state((S, w) => {
    w.profile.tipouts = [
      { ...BARBACK, vt: 't1' },
      { id: 'tz', k: 'runner', who: 'Runner', mode: 'flat', value: 5, from: 'cash' },
    ];
    S.nights = [night(1, 5, { p1: 6 }, { tx: true, tz: true })];
  });
  // the manager renamed the barback tip-out (a name of its own) and raised it to 20%
  const v = withIds();
  v.tipouts[0] = { id: 't1', k: 'other', who: 'Bar back', mode: 'pctTips', value: 2000, from: 'cash' };
  const page = await boot({ seed: s, url: joinUrl(v) });
  try {
    const t = page.text(page.$('#upd-tipouts'));
    assert.match(t, /Added: Host, \$20\.00 flat, through payroll/);
    assert.match(t, /Changed: Barback, 10% of tips, from cash → Bar back, 20% of tips, from cash/);
    assert.match(t, /Removed: Runner/);
    page.click(page.$('#join-update'));
    await page.settle();
    const S = page.state();
    assert.deepEqual(
      S.workplaces[0].profile.tipouts.map((r) => [r.id, r.vt, r.who, r.value]),
      [
        ['tx', 't1', 'Bar back', 20],
        ['t1', 't2', 'Host', 20],
      ],
      'the barback kept its id (matched by the venue’s id after the rename)',
    );
    assert.equal(S.nights[0].tipouts.tx, true, 'the tick on the saved night carries over');
    assert.equal(S.workplaces[0].profile.tipout.on, true);
  } finally {
    await page.close();
  }
});

test('"Nothing to update" when there are no differences, with no button', async () => {
  const s = state((S, w) => {
    w.profile.payTypes = [
      { id: 'p1', k: 'bartender', name: 'Bartender', rate: 12, unit: 'hr', usual: 7, vj: 'j1' },
      { id: 'p2', k: 'otherjob', name: 'Door', rate: 15, unit: 'shift', usual: 0, vj: 'j2' },
    ];
    w.profile.tipouts = [
      { id: 'a', k: 'barback', who: 'Barback', mode: 'pctTips', value: 15, from: 'cash', vt: 't1' },
      { id: 'b', k: 'host', who: 'Host', mode: 'flat', value: 20, from: 'payroll', vt: 't2' },
    ];
    w.venue = { id: VID, name: 'The Corner Bar' };
  });
  const page = await boot({ seed: s, url: joinUrl(withIds()) });
  try {
    assert.equal(page.text(page.$('#join-nothing')), 'Nothing to update.');
    assert.equal(page.$('#join-update'), null);
    assert.deepEqual(jobs(page), s.workplaces[0].profile.payTypes);
    assert.deepEqual(page.state().workplaces[0].profile.tipouts, s.workplaces[0].profile.tipouts);
  } finally {
    await page.close();
  }
});

test('finished pay periods are locked first and keep the pay they were saved with', async () => {
  const s = state((S) => {
    S.nights = [night(1, 22, { p1: 8 }), night(2, 20, { p1: 6, p2: 2 }), night(3, 0, { p1: 5 })];
  });
  const page = await boot({ seed: s, url: joinUrl(withIds()) });
  try {
    page.click(page.$('#join-update'));
    await page.settle();
    const S = page.state();
    const old = S.nights.find((n) => n.id === 2);
    assert.ok(old.snap, 'the finished pay period is locked');
    assert.equal(old.snap.pay.find((p) => p.id === 'p1').rate, 14, 'it keeps the rate it was saved with');
    assert.equal(S.nights.find((n) => n.id === 1).snap.pay[0].rate, 14);
  } finally {
    await page.close();
  }
});

test('a version 1 venue code (no ids) still updates, by name', async () => {
  const s = state((S, w) => {
    delete w.profile.payTypes[0].vj;
  });
  const page = await boot({ seed: s, url: joinUrl(venue()) });
  try {
    assert.equal(page.$('#upd-match-0').value, 'p1');
    page.click(page.$('#join-update'));
    await page.settle();
    assert.equal(jobs(page)[0].vj, undefined, 'a version 1 code has no ids to store');
    assert.ok(jobs(page).some((t) => t.name === 'Door'));
  } finally {
    await page.close();
  }
});
