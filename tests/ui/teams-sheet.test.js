// Staff side: opening a tip sheet link. The worker picks their name; Tonight opens for that date at the matching
// establishment with their numbers filled in and tip-outs unticked; nothing is saved until Save night.
import test from 'node:test';
import assert from 'node:assert/strict';
import { boot, realState } from './harness.js';
import { VID, sheet, sheetUrl } from './teams-util.js';
import { addDays, todayISO, exampleProfile } from '../../app/js/math.js';
import { encodeSheet } from '../../app/js/sheet.js';

const today = todayISO();
const yesterday = addDays(today, -1);
const BARBACK = { id: 't1', k: 'barback', who: 'Barback', mode: 'pctTips', value: 15, from: 'cash' };
const key = (page, k) => page.must(page.$('[data-focus-key="' + k + '"]'), k);
const pickName = (page, i) => page.click(key(page, 'sheet-name-' + i));
const tabNow = (page) => page.$('#tabs [aria-selected="true"]').dataset.tab;
const seed = (mutate) =>
  realState((S) => {
    const w = S.workplaces[0];
    w.setupDone = true;
    w.name = 'Corner';
    w.venue = { id: VID, name: 'The Corner Bar' };
    w.profile.tipout = { on: true };
    w.profile.tipouts = [{ ...BARBACK }];
    if (mutate) mutate(S);
  });
const second = (S, name = 'Bar 2', venueId) =>
  S.workplaces.push({
    id: 'w2',
    name,
    profile: { ...exampleProfile(today), payDelay: 1, tipout: { on: false }, tipouts: [] },
    calib: [],
    setupDone: true,
    ...(venueId ? { venue: { id: venueId, name: 'The Corner Bar' } } : {}),
  });

test('a sheet link: removed from the address, shown with the names; nothing saved', async () => {
  const page = await boot({ seed: seed(), url: sheetUrl() });
  try {
    assert.equal(page.win.location.hash, '');
    assert.match(page.text(page.$('#sheet-h1')), /Tip sheet for The Corner Bar/);
    assert.match(page.text(page.$('#sheet-screen')), /split by hours/);
    assert.equal(page.$$('button[data-focus-key^="sheet-name-"]').length, 2);
    assert.equal(page.$('[data-focus-key="sheet-name-0"]').textContent, 'Sam · 7:30');
    assert.equal(page.$('#sheet-open').disabled, true, 'pick a name first');
    assert.equal(
      page.$('[data-focus-key^="sheet-wp-"]'),
      null,
      'one establishment matches the venue: nothing to ask',
    );
    pickName(page, 0);
    assert.match(
      page.text(page.$('#sheet-yours')),
      /Your share: \$123\.45 credit card tips, \$20\.50 cash tips, 7:30 hours/,
    );
    assert.equal(page.$('#sheet-open').disabled, false);
    assert.equal(page.state().nights.length, 0);
    page.click(page.$('#sheet-not-now'));
    assert.equal(page.$('#sheet-screen'), null);
    assert.equal(page.state().nights.length, 0);
  } finally {
    await page.close();
  }
});

test('opening Tonight: the date, tips and hours are filled in, tip-outs are unticked, a note says where it is from, and Save night is a tap', async () => {
  const page = await boot({ seed: seed(), url: sheetUrl() });
  try {
    pickName(page, 0);
    page.click(page.$('#sheet-open'));
    await page.settle();
    assert.equal(tabNow(page), 'tonight');
    assert.match(page.text(page.$('#sheet-note')), /^From the The Corner Bar tip sheet for /);
    assert.match(page.$('#sheet-note').textContent, /Tip-outs are unticked/);
    assert.equal(key(page, 'night-cc').value, '123.45');
    assert.equal(key(page, 'night-cash').value, '20.5');
    assert.equal(key(page, 'night-pay-p1').value, '7:30');
    assert.equal(key(page, 'night-date').value, yesterday);
    const box = key(page, 'night-tipout-t1');
    assert.equal(box.checked, false, 'the pool was already split: no tip-out to tick');
    // not saved yet
    assert.equal(page.state().nights.length, 0);
    assert.ok(page.$('#night-quick-net, .quick-net'), 'the estimate shows');
    page.click(page.button('Save night'));
    await page.settle();
    const n = page.state().nights;
    assert.equal(n.length, 1);
    assert.equal(n[0].date, yesterday);
    assert.equal(n[0].cash, 20.5);
    assert.equal(n[0].tipouts.t1, false, 'no tip-out was taken out');
    assert.equal(Math.round(n[0].total * 100), 12345 + 2050 + 7.5 * 12 * 100, 'tips plus 7.5 hours at $12');
    assert.equal(page.$('#sheet-note'), null, 'the note goes with the entry');
  } finally {
    await page.close();
  }
});

test('the same-date question still applies: nothing is saved until the worker chooses', async () => {
  const S = seed((S) => {
    S.nights = [
      {
        id: 'n1',
        date: yesterday,
        total: 300,
        cash: 50,
        pay: { p1: 6 },
        barback: false,
        tipouts: { t1: false },
        tipoutOn: true,
        workplaceId: 'w1',
      },
    ];
  });
  const page = await boot({ seed: S, url: sheetUrl() });
  try {
    pickName(page, 1);
    page.click(page.$('#sheet-open'));
    await page.settle();
    assert.equal(key(page, 'night-cc').value, '80');
    assert.equal(key(page, 'night-pay-p1').value, '5:00');
    page.click(page.button('Save night'));
    await page.settle();
    assert.equal(page.state().nights.length, 1, 'asked first, nothing saved');
    assert.ok(page.button('Add to that night'));
    assert.ok(page.button('Replace it'));
    page.click(page.button('Save as a separate night'));
    await page.settle();
    assert.equal(page.state().nights.length, 2);
  } finally {
    await page.close();
  }
});

test('which establishment: asked when none or several have the venue; one match or one establishment is not asked', async () => {
  // two establishments, neither from this venue: ask
  const none = await boot({
    seed: seed((S) => {
      delete S.workplaces[0].venue;
      second(S);
    }),
    url: sheetUrl(),
  });
  try {
    pickName(none, 0);
    assert.equal(none.$('#sheet-open').disabled, true, 'also pick the establishment');
    assert.match(none.text(none.$('#sheet-screen')), /Which establishment is this for\?/);
    none.click(key(none, 'sheet-wp-w2'));
    none.click(none.$('#sheet-open'));
    await none.settle();
    assert.equal(tabNow(none), 'tonight');
    assert.match(none.text(none.$('#tonight-picker [aria-checked="true"]')), /Bar 2/);
    assert.equal(none.state().settings.activeWorkplaceId, 'w2');
  } finally {
    await none.close();
  }
  // two establishments, one from this venue: that one, no question
  const one = await boot({ seed: seed((S) => second(S)), url: sheetUrl() });
  try {
    pickName(one, 0);
    assert.equal(one.$('[data-focus-key^="sheet-wp-"]'), null);
    one.click(one.$('#sheet-open'));
    await one.settle();
    assert.match(one.text(one.$('#tonight-picker [aria-checked="true"]')), /Corner/);
  } finally {
    await one.close();
  }
  // both from this venue: ask, among those two
  const both = await boot({ seed: seed((S) => second(S, 'Corner patio', VID)), url: sheetUrl() });
  try {
    pickName(both, 0);
    assert.equal(both.$$('[data-focus-key^="sheet-wp-"]').length, 2);
  } finally {
    await both.close();
  }
  // one establishment, not linked to a venue: it is the one
  const lone = await boot({ seed: seed((S) => delete S.workplaces[0].venue), url: sheetUrl() });
  try {
    pickName(lone, 0);
    assert.equal(lone.$('#sheet-open').disabled, false);
  } finally {
    await lone.close();
  }
});

test('an establishment paid per shift gets the tips and no hours', async () => {
  const S = seed((S) => {
    S.workplaces[0].profile.payTypes[0] = {
      id: 'p1',
      k: 'shift',
      name: 'Flat',
      rate: 100,
      unit: 'shift',
      usual: 1,
    };
  });
  const page = await boot({ seed: S, url: sheetUrl() });
  try {
    pickName(page, 0);
    page.click(page.$('#sheet-open'));
    await page.settle();
    assert.equal(key(page, 'night-cc').value, '123.45');
    assert.equal(key(page, 'night-pay-p1').value, '1', 'one shift, as on any new night');
  } finally {
    await page.close();
  }
});

test('before setup: says to set up first and offers Setup', async () => {
  const page = await boot({ url: sheetUrl() });
  try {
    assert.match(page.text(page.$('#sheet-screen')), /Set up TipNet first/);
    assert.equal(page.$('button[data-focus-key^="sheet-name-"]'), null);
    page.click(page.$('#sheet-setup'));
    assert.equal(tabNow(page), 'setup');
    assert.equal(page.$('#sheet-screen'), null);
  } finally {
    await page.close();
  }
});

test('a sheet with a date TipNet won’t take can’t be opened', async () => {
  const page = await boot({ seed: seed(), url: sheetUrl(sheet({ date: addDays(today, 30) })) });
  try {
    pickName(page, 0);
    assert.equal(page.$('#sheet-open').disabled, true);
    assert.match(page.text(page.$('#sheet-screen')), /outside the dates TipNet accepts/);
  } finally {
    await page.close();
  }
});

test('a sheet from the manager’s tip pool reads back on a worker’s phone, to the cent', async () => {
  const { computePool } = await import('../../app/js/pool.js');
  const res = computePool({
    method: 'hours',
    cc: 100001,
    cash: 5001,
    rows: [
      { name: 'Ann', role: '', minutes: 480, points: 100 },
      { name: 'Bo', role: '', minutes: 450, points: 100 },
      { name: 'Cy', role: '', minutes: 300, points: 100 },
    ],
  });
  const url =
    'http://localhost/#sheet=' +
    encodeSheet({
      venue: { id: VID, name: 'The Corner Bar' },
      date: yesterday,
      method: 'hours',
      rows: res.rows.map((r) => ({ name: r.name, minutes: r.minutes, cc: r.cc, cash: r.cash })),
    });
  const page = await boot({ seed: seed(), url });
  try {
    pickName(page, 1);
    page.click(page.$('#sheet-open'));
    await page.settle();
    assert.equal(key(page, 'night-cc').value, '365.86');
    assert.equal(key(page, 'night-cash').value, '18.3');
    assert.equal(key(page, 'night-pay-p1').value, '7:30');
  } finally {
    await page.close();
  }
});
