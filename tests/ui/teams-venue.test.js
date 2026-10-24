// Teams tab, venue setup code: the manager fills in the venue, gets a link, a QR code and a poster; the id stays.
import test from 'node:test';
import assert from 'node:assert/strict';
import { boot, realState } from './harness.js';
import { DEV, fill, pause } from './teams-util.js';
import { decodeVenue, VENUE_ID_RE } from '../../app/js/venue.js';
import { addDays, todayISO } from '../../app/js/math.js';
import { encodeBackup, decodeBackup } from '../../app/js/storage.js';

const seed = () => realState((S) => (S.workplaces[0].setupDone = true));
const later = () => pause(420); // the form waits a moment after typing
const start = addDays(todayISO(), -10);
const end = addDays(start, 13);

async function fillVenue(page) {
  fill(page, '#venue-name', 'The Corner Bar');
  fill(page, '#venue-start', start);
  page.change(page.$('#venue-start'));
  fill(page, '#venue-end', end);
  fill(page, '#venue-payday', addDays(end, 5));
  fill(page, '#vj-rate-0', '12');
  page.click(page.$('#venue-add-tipout'));
  fill(page, '#vt-value-0', '15');
  await later();
}
const linkOf = (page) => page.$('#venue-link').value;

test('venue code: problems are listed in plain words until the form is good', async () => {
  const page = await boot({ seed: seed(), url: DEV });
  try {
    page.tab('team');
    assert.ok(page.$('#venue-section'), 'a first visit opens the venue code');
    const p = page.text(page.$('#venue-problems'));
    assert.match(p, /Give the venue a name/);
    assert.match(p, /Pick the day the current pay period started/);
    assert.match(p, /Pick the payday/);
    assert.match(p, /Enter a rate for Bartender/);
    assert.equal(page.$('#venue-link'), null);
    fill(page, '#venue-name', 'The Corner Bar');
    fill(page, '#venue-start', start);
    fill(page, '#venue-end', addDays(start, 80));
    fill(page, '#venue-payday', addDays(start, 50));
    fill(page, '#vj-rate-0', '1.2.3');
    await later();
    const q = page.text(page.$('#venue-problems'));
    assert.match(q, /62 days or shorter/);
    assert.match(q, /Rate for Bartender: That isn’t an amount/);
    fill(page, '#venue-end', end);
    fill(page, '#venue-payday', addDays(end, 22));
    fill(page, '#vj-rate-0', '12');
    await later();
    assert.match(page.text(page.$('#venue-problems')), /payday has to be 0 to 21 days after/);
    page.click(page.$('#venue-add-tipout'));
    await later();
    assert.match(page.text(page.$('#venue-problems')), /Enter how much you tip out Barback/);
    fill(page, '#vt-value-0', '120');
    await later();
    assert.match(page.text(page.$('#venue-problems')), /more than 100%/);
  } finally {
    await page.close();
  }
});

test('venue code: a good form makes a link, a QR code, Copy and the poster; the code holds what was typed', async () => {
  const page = await boot({ seed: seed(), url: DEV });
  try {
    page.tab('team');
    await fillVenue(page);
    assert.equal(page.$('#venue-problems'), null);
    const link = linkOf(page);
    assert.match(link, /^http:\/\/localhost\/\?unlock=dev#join=|^http:\/\/localhost\/#join=/);
    const v = decodeVenue(link.split('#join=')[1]);
    assert.ok(v, 'the staff side reads it');
    assert.equal(v.name, 'The Corner Bar');
    assert.equal(v.start, start);
    assert.equal(v.delay, 5);
    assert.deepEqual(v.jobs, [{ k: 'bartender', name: 'Bartender', rate: 1200, unit: 'hr' }]);
    assert.deepEqual(v.tipouts, [
      { k: 'barback', who: 'Barback', mode: 'pctTips', value: 1500, from: 'cash' },
    ]);
    assert.match(v.id, VENUE_ID_RE);
    assert.equal(v.id.length, 12);
    // QR code: an svg with the module count, black on white
    const svg = page.must(page.$('#venue-qr svg'), 'qr');
    assert.ok(Number(svg.getAttribute('data-modules')) >= 21);
    assert.ok(page.$('path', svg).getAttribute('d').startsWith('M4 4'));
    // Copy
    let copied = '';
    Object.defineProperty(page.win.navigator, 'clipboard', {
      value: { writeText: async (t) => (copied = t) },
      configurable: true,
    });
    page.click(page.$('#venue-copy'));
    await page.settle();
    assert.equal(copied, link);
    assert.match(page.$('#venue-msg').textContent, /Copied/);
    // no Share button where the phone has no sharing
    assert.equal(page.$('#venue-share'), null);
  } finally {
    await page.close();
  }
});

test('venue code: Share appears where navigator.share exists and shares the link', async () => {
  const page = await boot({ seed: seed(), url: DEV });
  try {
    const shared = [];
    Object.defineProperty(page.win.navigator, 'share', {
      value: async (d) => shared.push(d),
      configurable: true,
    });
    page.tab('team');
    await fillVenue(page);
    page.click(page.must(page.$('#venue-share'), 'share'));
    await page.settle();
    assert.equal(shared.length, 1);
    assert.equal(shared[0].url, linkOf(page));
    assert.match(shared[0].title, /The Corner Bar/);
  } finally {
    await page.close();
  }
});

test('venue code: the venue id is made once, kept on the device, and the same after the code is re-made', async () => {
  const page = await boot({ seed: seed(), url: DEV });
  try {
    page.tab('team');
    await fillVenue(page);
    const id1 = decodeVenue(linkOf(page).split('#join=')[1]).id;
    assert.equal(page.state().settings.team.venueId, id1);
    fill(page, '#vj-rate-0', '13.5');
    await later();
    const second = decodeVenue(linkOf(page).split('#join=')[1]);
    assert.equal(second.id, id1, 'a changed rate is the same venue');
    assert.equal(second.jobs[0].rate, 1350);
    // the venue, its id and the name are saved; they come back when the page is opened again
    await page.state();
    const kept = page.state().settings.team;
    assert.equal(kept.venue.name, 'The Corner Bar');
    assert.equal(kept.name, 'The Corner Bar');
    const again = await boot({ seed: JSON.parse(JSON.stringify(page.state())), url: DEV });
    try {
      again.tab('team');
      assert.equal(again.$('#venue-section'), null, 'a saved venue opens the tip pool first');
      again.click(again.byLabel('Venue code'));
      assert.equal(again.$('#venue-name').value, 'The Corner Bar');
      assert.equal(again.$('#vj-rate-0').value, '13.5');
      assert.equal(decodeVenue(again.$('#venue-link').value.split('#join=')[1]).id, id1);
    } finally {
      await again.close();
    }
    // backups carry it
    const back = decodeBackup(encodeBackup(page.state()));
    assert.equal(back.settings.team.venueId, id1);
    assert.equal(back.settings.team.venue.jobs[0].rate, 1350);
  } finally {
    await page.close();
  }
});

test('venue code: calendar schedules take the end date from the calendar; jobs and tip-outs can be added and removed', async () => {
  const page = await boot({ seed: seed(), url: DEV });
  try {
    page.tab('team');
    fill(page, '#venue-start', '2026-10-05');
    page.$('#venue-freq').value = 'monthly';
    page.change(page.$('#venue-freq'));
    assert.equal(page.$('#venue-end').value, '2026-11-04');
    assert.equal(page.$('#venue-end').disabled, true);
    assert.match(page.text(page.$('#venue-end-hint')), /calendar sets the end date/);
    page.$('#venue-freq').value = '7';
    page.change(page.$('#venue-freq'));
    assert.equal(
      page.$('#venue-end').value,
      '2026-10-11',
      'a weekly schedule fills the end the way Setup does',
    );
    assert.equal(page.$('#venue-end').disabled, false);
    // jobs
    assert.equal(page.$$('select[id^="vj-kind-"]').length, 1);
    page.click(page.$('#venue-add-job'));
    assert.equal(page.$$('select[id^="vj-kind-"]').length, 2);
    page.$('#vj-kind-1').value = 'otherjob';
    page.change(page.$('#vj-kind-1'));
    assert.ok(page.$('#vj-name-1'), 'an "Other job" asks for a name');
    page.click(page.byLabel('Remove Other job'));
    assert.equal(page.$$('select[id^="vj-kind-"]').length, 1);
    assert.equal(page.$('button[aria-label^="Remove"]'), null, 'the last job can’t be removed');
    for (let i = 0; i < 12; i++) page.click(page.$('#venue-add-job'));
    assert.equal(page.$$('select[id^="vj-kind-"]').length, 8, 'up to 8 jobs');
  } finally {
    await page.close();
  }
});

test('venue code: a code that is too long says so plainly', async () => {
  const page = await boot({ seed: seed(), url: DEV });
  try {
    page.tab('team');
    await fillVenue(page);
    for (let i = 0; i < 7; i++) {
      page.click(page.$('#venue-add-job'));
      page.$('#vj-kind-' + (i + 1)).value = 'otherjob';
      page.change(page.$('#vj-kind-' + (i + 1)));
      fill(page, '#vj-name-' + (i + 1), 'Job ' + i + ' ' + 'x'.repeat(34));
      fill(page, '#vj-rate-' + (i + 1), '10');
    }
    for (let i = 0; i < 9; i++) {
      page.click(page.$('#venue-add-tipout'));
      fill(page, '#vt-who-' + (i + 1), 'Person ' + i + ' ' + 'y'.repeat(30));
      fill(page, '#vt-value-' + (i + 1), '1');
    }
    await later();
    assert.match(page.text(page.must(page.$('#venue-toobig'), 'too-long line')), /too long to share/);
    assert.equal(page.$('#venue-link'), null);
  } finally {
    await page.close();
  }
});

test('poster: venue name, a big QR code, "Scan to set up", three steps, printed from a print-only block', async () => {
  const page = await boot({ seed: seed(), url: DEV });
  try {
    let printed = 0;
    page.win.print = () => {
      printed++;
      const area = page.$('#print-area');
      assert.ok(area, 'drawn before the print box opens');
      assert.match(page.text(area), /The Corner Bar/);
      assert.match(page.text(area), /Scan to set up TipNet Teams at The Corner Bar/);
      assert.equal(page.$$('ol li', area).length, 3);
      assert.ok(page.$('.poster-qr svg', area), 'a big QR code');
      assert.equal(area.querySelector('script'), null);
    };
    page.tab('team');
    await fillVenue(page);
    page.click(page.$('#venue-poster'));
    assert.equal(printed, 1);
    page.win.dispatchEvent(new page.win.Event('afterprint'));
    assert.equal(page.$('#print-area'), null, 'removed after printing');
  } finally {
    await page.close();
  }
});

test('the manager’s own device can join their venue (it opens the Join screen)', async () => {
  const page = await boot({ seed: seed(), url: DEV });
  try {
    page.tab('team');
    await fillVenue(page);
    page.click(page.$('#venue-join-here'));
    assert.match(page.text(page.$('#join-h1')), /Join The Corner Bar/);
  } finally {
    await page.close();
  }
});
