// Staff side: setting up after joining a venue is ONE short step (the venue filled in the schedule, payday, jobs and
// tip-outs): a summary with "Change these", the rate for each job, and the worker's own paystub numbers. "Change these"
// opens the normal three steps with the values in. Joining with no venue is unchanged.
import test from 'node:test';
import assert from 'node:assert/strict';
import { boot, realState } from './harness.js';
import { VID, venue, withIds, joinUrl } from './teams-util.js';
import { addDays } from '../../app/js/math.js';

const clone = (o) => JSON.parse(JSON.stringify(o));
const GROSS = 'input[placeholder="e.g. 2,000"]';
const SHIFTS = 'input[placeholder="e.g. 10"]';
const summary = (page) => page.text(page.$('#venue-summary'));
const start = async (url) => {
  const page = await boot({ url });
  page.click(page.$('#join-start'));
  await page.settle();
  return page;
};

test('one short step: the summary, your rate for each job, and what comes from your paystub', async () => {
  const v = withIds();
  const page = await start(joinUrl(v));
  try {
    assert.match(summary(page), /The Corner Bar filled in your pay schedule, payday, jobs and tip-outs\./);
    const s = summary(page);
    assert.match(s, /You get paid\s*Every two weeks/);
    assert.match(s, /Payday/);
    assert.ok(
      s.includes(
        new Date(addDays(v.end, 5) + 'T00:00:00Z').toLocaleDateString('en-US', {
          day: 'numeric',
          timeZone: 'UTC',
        }),
      ),
    );
    assert.match(s, /Jobs\s*Bartender, Door/);
    assert.match(s, /You tip out\s*Barback \(15% of tips\), Host \(\$20\.00 flat\)/);
    assert.ok(page.$('#venue-change'), 'Change these');
    // one step, not three
    assert.match(page.text(), /One short step/);
    assert.doesNotMatch(page.text(), /Three short steps/);
    assert.equal(page.$$('.steps li').length, 1);
    assert.equal(page.$('#join-link'), null, 'already joining: no "Joining a venue?" link');
    // your rate for each job, filled in with the venue's, with the paystub hint
    assert.equal(page.$('#pr-p1').value, '12');
    assert.equal(page.$('#pr-p2').value, '15');
    assert.match(page.text(page.$('#venue-rates')), /Your rate for each job/);
    assert.equal(
      page.text(page.$('#venue-rates-hint')),
      'Check this against your paystub; rates can differ per person.',
    );
    assert.match(page.text(page.$('#venue-rates')), /Your rate for Bartender \(\$ per hour\)/);
    assert.match(page.text(page.$('#venue-rates')), /Your rate for Door \(\$ per shift\)/);
    // from your paystub: gross pay, shifts and the deductions rows; no pay period dates
    assert.match(page.text(), /From your paystub/);
    assert.ok(page.$(GROSS, page.app) && page.$(SHIFTS, page.app));
    assert.ok(page.$('input[id^="da-"]', page.app), 'the deductions rows');
    assert.equal(page.$$('input[type=date]', page.app).length, 0);
    assert.ok(page.button('Finish setup'));
    assert.equal(page.byText('button', 'Next'), null);
    assert.equal(page.byText('button', 'Back'), null);
  } finally {
    await page.close();
  }
});

test('finishing: the same checks as the normal steps, the venue’s id on each job, the worker’s own rate and paystub', async () => {
  const page = await start(joinUrl(withIds()));
  try {
    // nothing from the paystub yet: Finish says what is missing and saves nothing
    page.click(page.button('Finish setup'));
    await page.settle();
    assert.equal(page.state().workplaces[0].setupDone, undefined);
    assert.ok(page.$('#venue-summary'), 'still on the step');
    assert.match(page.text(), /Gross pay is needed to work out your tax rate/);
    // a rate the worker changes to match their stub
    page.type(page.$('#pr-p1'), '14.5');
    page.type(page.$(GROSS, page.app), '900');
    page.type(page.$(SHIFTS, page.app), '10');
    page.type(page.$$('input[id^="da-"]', page.app)[0], '60');
    page.click(page.button('Finish setup'));
    await page.settle();
    const S = page.state();
    const w = S.workplaces[0];
    const p = w.profile;
    assert.equal(w.setupDone, true);
    assert.equal(S.profileExample, false);
    assert.equal(S.settings.guidedDraft, undefined);
    assert.deepEqual(w.venue, { id: VID, name: 'The Corner Bar' });
    assert.deepEqual(
      p.payTypes.map((t) => [t.name, t.rate, t.unit, t.vj]),
      [
        ['Bartender', 14.5, 'hr', 'j1'],
        ['Door', 15, 'shift', 'j2'],
      ],
    );
    assert.deepEqual(
      p.tipouts.map((r) => [r.who, r.vt]),
      [
        ['Barback', 't1'],
        ['Host', 't2'],
      ],
    );
    assert.equal(p.gross, 900);
    assert.equal(p.shifts, 10);
    assert.equal(p.payDelay, 5);
    assert.equal(p.deductions.filter((d) => d.amount > 0).length, 1);
    assert.equal(page.$('#tabs [aria-selected="true"]').dataset.tab, 'tonight');
  } finally {
    await page.close();
  }
});

test('a job’s rate cannot be left empty: Finish names it and nothing is saved', async () => {
  const page = await start(joinUrl(withIds()));
  try {
    page.type(page.$(GROSS, page.app), '900');
    page.type(page.$(SHIFTS, page.app), '10');
    page.type(page.$$('input[id^="da-"]', page.app)[0], '60');
    page.type(page.$('#pr-p2'), '');
    page.click(page.button('Finish setup'));
    await page.settle();
    assert.equal(page.state().workplaces[0].setupDone, undefined);
    assert.match(page.text(page.$('#venue-rates')), /Enter the rate from your stub/);
    page.type(page.$('#pr-p2'), '1.2.3');
    page.click(page.button('Finish setup'));
    await page.settle();
    assert.equal(page.state().workplaces[0].setupDone, undefined, 'a typo is not a rate');
    page.type(page.$('#pr-p2'), '16');
    page.click(page.button('Finish setup'));
    await page.settle();
    assert.equal(page.state().workplaces[0].setupDone, true);
    assert.equal(page.state().workplaces[0].profile.payTypes[1].rate, 16);
  } finally {
    await page.close();
  }
});

test('"Change these" opens the normal steps with the values in', async () => {
  const v = withIds();
  const page = await start(joinUrl(v));
  try {
    page.type(page.$('#pr-p1'), '13');
    page.click(page.$('#venue-change'));
    await page.settle();
    assert.equal(page.$('#venue-summary'), null);
    assert.match(page.text(), /Three short steps/);
    const dates = page.$$('input[type=date]', page.app);
    assert.equal(dates[0].value, v.start);
    assert.equal(dates[1].value, v.end);
    assert.equal(dates[2].value, addDays(v.end, 5));
    page.type(page.$(GROSS, page.app), '900');
    page.type(page.$(SHIFTS, page.app), '10');
    page.click(page.button('Next'));
    page.type(page.$$('input[id^="da-"]', page.app)[0], '60');
    page.click(page.button('Next'));
    assert.equal(page.$('#pr-p1').value, '13', 'the rate typed on the short step is kept');
    assert.equal(page.$('#pr-p2').value, '15');
    page.click(page.button('Finish setup'));
    await page.settle();
    const w = page.state().workplaces[0];
    assert.equal(w.setupDone, true);
    assert.deepEqual(
      w.profile.payTypes.map((t) => [t.rate, t.vj]),
      [
        [13, 'j1'],
        [15, 'j2'],
      ],
    );
  } finally {
    await page.close();
  }
});

test('a reload keeps the short step; after "Change these" it keeps the normal steps', async () => {
  const page = await start(joinUrl(withIds()));
  try {
    page.type(page.$('#pr-p1'), '13');
    await page.settle();
    assert.equal(page.state().settings.guidedDraft.venueShort, true);
    const again = await boot({ seed: clone(page.state()) });
    try {
      assert.ok(again.$('#venue-summary'), 'the short step comes back');
      assert.equal(again.$('#pr-p1').value, '13');
      again.click(again.$('#venue-change'));
      await again.settle();
      assert.equal(again.state().settings.guidedDraft.venueShort, undefined);
      const third = await boot({ seed: clone(again.state()) });
      try {
        assert.equal(third.$('#venue-summary'), null);
        assert.match(third.text(), /Three short steps/);
      } finally {
        await third.close();
      }
    } finally {
      await again.close();
    }
  } finally {
    await page.close();
  }
});

test('a new establishment from a venue gets the short step too', async () => {
  const s = realState((S) => {
    S.workplaces[0].setupDone = true;
    S.workplaces[0].name = 'Voodoo Bayou';
  });
  const page = await boot({ seed: s, url: joinUrl(withIds()) });
  try {
    page.click(page.$('#join-add'));
    await page.settle();
    assert.ok(page.$('#venue-summary'));
    assert.equal(page.$$('.steps li').length, 1);
    page.type(page.$(GROSS, page.app), '700');
    page.type(page.$(SHIFTS, page.app), '8');
    page.type(page.$$('input[id^="da-"]', page.app)[0], '50');
    page.click(page.button('Finish setup'));
    await page.settle();
    const S = page.state();
    assert.equal(S.workplaces.length, 2);
    assert.equal(S.workplaces[1].setupDone, true);
    assert.deepEqual(
      S.workplaces[1].profile.payTypes.map((t) => t.vj),
      ['j1', 'j2'],
    );
  } finally {
    await page.close();
  }
});

test('a venue code without ids (version 1) gets the short step as well', async () => {
  const page = await start(joinUrl(venue()));
  try {
    assert.ok(page.$('#venue-summary'));
    page.type(page.$(GROSS, page.app), '900');
    page.type(page.$(SHIFTS, page.app), '10');
    page.type(page.$$('input[id^="da-"]', page.app)[0], '60');
    page.click(page.button('Finish setup'));
    await page.settle();
    assert.equal(page.state().workplaces[0].setupDone, true);
    assert.equal(page.state().workplaces[0].profile.payTypes[0].vj, undefined);
  } finally {
    await page.close();
  }
});

test('with no venue (a normal first run) the three guided steps are unchanged', async () => {
  const page = await boot();
  try {
    page.tab('setup');
    await page.settle();
    assert.equal(page.$('#venue-summary'), null);
    assert.match(page.text(), /Three short steps/);
    assert.ok(page.button('Next'));
  } finally {
    await page.close();
  }
});
