// Team tab, tip pool: the manager's night, the four split methods, the tip sheet (totals equal the pool), print, share.
import test from 'node:test';
import assert from 'node:assert/strict';
import { boot, realState } from './harness.js';
import { DEV, fill, pause } from './teams-util.js';
import { decodeSheet, SHARE_WARNING } from '../../app/js/sheet.js';
import { addDays, todayISO } from '../../app/js/math.js';

const seed = (mutate) =>
  realState((S) => {
    S.workplaces[0].setupDone = true;
    if (mutate) mutate(S);
  });
const later = () => pause(620);
const yesterday = addDays(todayISO(), -1);

async function openPool(page) {
  page.tab('team');
  if (page.$('#team-pool-tab')) page.click(page.$('#team-pool-tab'));
}
/** Fill person i (rows 0..). */
function person(page, i, name, role, hours, points) {
  if (!page.$('#pr-name-' + i)) page.click(page.$('#pool-add-person'));
  fill(page, '#pr-name-' + i, name);
  fill(page, '#pr-role-' + i, role);
  fill(page, '#pr-hours-' + i, hours);
  if (points != null && page.$('#pr-points-' + i)) fill(page, '#pr-points-' + i, points);
}
const cells = (page) =>
  page.$$('#pool-result tbody tr').map((tr) => page.$$('td', tr).map((td) => td.textContent));
const foot = (page) => page.$$('#pool-result tfoot th').map((th) => th.textContent);

test('by hours: the tip sheet splits CC and cash separately, and the totals equal the pool exactly', async () => {
  const page = await boot({ seed: seed(), url: DEV });
  try {
    await openPool(page);
    assert.match(page.text(page.$('#pool-result')), /Add at least one person/);
    fill(page, '#pool-date', yesterday);
    fill(page, '#pool-cc', '1000.01');
    fill(page, '#pool-cash', '50.01');
    person(page, 0, 'Ann', 'Bartender', '8');
    person(page, 1, 'Bo', 'Bartender', '7:30');
    person(page, 2, 'Cy', 'Server', '5');
    await later();
    assert.deepEqual(cells(page), [
      ['Ann', '8:00', '$390.25', '$19.51', '$409.76'],
      ['Bo', '7:30', '$365.86', '$18.30', '$384.16'],
      ['Cy', '5:00', '$243.90', '$12.20', '$256.10'],
    ]);
    assert.deepEqual(foot(page), ['Total', '20:30', '$1,000.01', '$50.01', '$1,050.02']);
    assert.match(
      page.text(page.$('#pool-check')),
      /Credit card \$1,000\.01 \+ cash \$50\.01 = \$1,050\.02, all handed out/,
    );
    // typing more hours changes it at once
    fill(page, '#pr-hours-2', '0');
    await later();
    assert.equal(cells(page)[2][4], '$0.00', 'zero hours is a zero share');
    assert.deepEqual(foot(page).slice(2), ['$1,000.01', '$50.01', '$1,050.02']);
  } finally {
    await page.close();
  }
});

test('typos are named, and nothing is worked out until they are fixed', async () => {
  const page = await boot({ seed: seed(), url: DEV });
  try {
    await openPool(page);
    fill(page, '#pool-date', yesterday);
    fill(page, '#pool-cc', '12.3.4');
    fill(page, '#pool-cash', '-5');
    person(page, 0, 'Ann', '', 'abc');
    person(page, 1, '', '', '6');
    await later();
    const t = page.text(page.$('#pool-problems'));
    assert.match(t, /Credit card tips: That isn’t an amount/);
    assert.match(t, /Cash tips: An amount can’t be below \$0/);
    assert.match(t, /Hours for Ann: That isn’t a number of hours/);
    assert.match(t, /Row 2 needs a name/);
    assert.equal(page.$('#pool-result table'), null);
    fill(page, '#pool-date', '1990-01-01');
    await later();
    assert.match(page.text(page.$('#pool-problems')), /Pick a date between Jan 1, 2000/);
  } finally {
    await page.close();
  }
});

test('equal and points × hours', async () => {
  const page = await boot({ seed: seed(), url: DEV });
  try {
    await openPool(page);
    fill(page, '#pool-date', yesterday);
    fill(page, '#pool-cc', '100');
    fill(page, '#pool-cash', '0');
    person(page, 0, 'Ann', 'Bartender', '8');
    person(page, 1, 'Bo', 'Runner', '2');
    person(page, 2, 'Cy', 'Host', '0');
    page.$('#pool-method').value = 'equal';
    page.change(page.$('#pool-method'));
    await later();
    assert.deepEqual(
      cells(page).map((r) => r[4]),
      ['$50.00', '$50.00', '$0.00'],
    );
    page.$('#pool-method').value = 'points';
    page.change(page.$('#pool-method'));
    assert.ok(page.$('#pr-points-0'), 'points boxes show for this method');
    fill(page, '#pr-points-0', '1');
    fill(page, '#pr-points-1', '2.5');
    fill(page, '#pr-points-2', '1');
    await later();
    // weights 8*1 = 8 and 2*2.5 = 5: $61.54 and $38.46
    assert.deepEqual(
      cells(page).map((r) => r[4]),
      ['$61.54', '$38.46', '$0.00'],
    );
    fill(page, '#pr-points-0', '0');
    fill(page, '#pr-points-1', '0');
    await later();
    assert.match(page.text(page.$('#pool-error')), /hours × points come to 0/);
  } finally {
    await page.close();
  }
});

test('by role %: shares must be 100%, then by hours inside each role', async () => {
  const page = await boot({ seed: seed(), url: DEV });
  try {
    await openPool(page);
    fill(page, '#pool-date', yesterday);
    fill(page, '#pool-cc', '1000');
    fill(page, '#pool-cash', '100');
    person(page, 0, 'Ann', 'Bartender', '8');
    person(page, 1, 'Bo', 'Bartender', '4');
    person(page, 2, 'Cy', 'Server', '6');
    page.$('#pool-method').value = 'role';
    page.change(page.$('#pool-method'));
    await later();
    assert.match(page.text(page.$('#pool-error')), /add up to 100%/);
    assert.match(page.text(page.$('#pool-shares')), /Bartender %/);
    fill(page, '#pool-share-bartender', '60');
    fill(page, '#pool-share-server', '30');
    await later();
    assert.match(page.text(page.$('#pool-shares-total')), /add up to 90%/);
    assert.match(page.text(page.$('#pool-error')), /add up to 100%/);
    fill(page, '#pool-share-server', '40');
    await later();
    assert.deepEqual(
      cells(page).map((r) => r.slice(2)),
      [
        ['$400.00', '$40.00', '$440.00'],
        ['$200.00', '$20.00', '$220.00'],
        ['$400.00', '$40.00', '$440.00'],
      ],
    );
    assert.deepEqual(foot(page).slice(2), ['$1,000.00', '$100.00', '$1,100.00']);
    // a person with no role
    fill(page, '#pr-role-2', '');
    await later();
    assert.match(page.text(page.$('#pool-error')), /Give Cy a role/);
  } finally {
    await page.close();
  }
});

test('the staff list (names, roles, points) is remembered; hours are not', async () => {
  const page = await boot({ seed: seed(), url: DEV });
  try {
    await openPool(page);
    person(page, 0, 'Ann', 'Bartender', '8', '1.5');
    page.$('#pool-method').value = 'points';
    page.change(page.$('#pool-method'));
    fill(page, '#pr-points-0', '1.5');
    person(page, 1, 'Bo', 'Server', '4', '1');
    await later();
    assert.deepEqual(page.state().settings.team.staff, [
      { name: 'Ann', role: 'Bartender', points: 150 },
      { name: 'Bo', role: 'Server', points: 100 },
    ]);
    const again = await boot({ seed: JSON.parse(JSON.stringify(page.state())), url: DEV });
    try {
      await openPool(again);
      assert.equal(again.$('#pr-name-0').value, 'Ann');
      assert.equal(again.$('#pr-role-1').value, 'Server');
      assert.equal(again.$('#pr-hours-0').value, '', 'tonight’s hours are typed each night');
      again.$('#pool-method').value = 'points';
      again.change(again.$('#pool-method'));
      assert.equal(again.$('#pr-points-0').value, '1.5');
    } finally {
      await again.close();
    }
    // removing a person updates what is remembered
    page.click(page.byLabel('Remove Bo'));
    await later();
    assert.equal(page.state().settings.team.staff.length, 1);
  } finally {
    await page.close();
  }
});

test('sharing a sheet: the warning first, a link and a QR code that read back to the same sheet', async () => {
  const page = await boot({ seed: seed(), url: DEV });
  try {
    await openPool(page);
    fill(page, '#pool-date', yesterday);
    fill(page, '#pool-cc', '200.50');
    fill(page, '#pool-cash', '30');
    person(page, 0, 'Ann', 'Bartender', '8');
    person(page, 1, 'Bo', 'Server', '4:30');
    await later();
    page.click(page.$('#pool-share-btn'));
    assert.match(
      page.text(page.$('#pool-share')),
      /Type the venue name above first/,
      'a sheet needs a venue name',
    );
    fill(page, '#pool-venue-name', 'The Corner Bar');
    await later();
    assert.equal(page.text(page.$('#pool-share-warning')), SHARE_WARNING);
    assert.equal(SHARE_WARNING, 'Anyone with this link or QR sees everyone’s share.');
    const link = page.$('#sheet-link').value;
    assert.match(link, /#sheet=/);
    const sheet = decodeSheet(link.split('#sheet=')[1]);
    assert.equal(sheet.venue.name, 'The Corner Bar');
    assert.equal(sheet.venue.id, page.state().settings.team.venueId, 'the same venue id as the venue code');
    assert.equal(sheet.date, yesterday);
    assert.equal(sheet.method, 'hours');
    assert.equal(
      sheet.rows.reduce((a, r) => a + r.cc, 0),
      20050,
    );
    assert.equal(
      sheet.rows.reduce((a, r) => a + r.cash, 0),
      3000,
    );
    assert.deepEqual(
      sheet.rows.map((r) => [r.name, r.minutes]),
      [
        ['Ann', 480],
        ['Bo', 270],
      ],
    );
    assert.ok(page.$('#sheet-qr svg'));
    // the table on screen is the sheet
    assert.deepEqual(
      cells(page).map((r) => r[4]),
      sheet.rows.map((r) => '$' + ((r.cc + r.cash) / 100).toFixed(2)),
    );
    // Hide
    page.click(page.$('#pool-share-btn'));
    assert.equal(page.$('#sheet-link'), null);
  } finally {
    await page.close();
  }
});

test('a sheet that is too big to share says to split the staff into two sheets', async () => {
  const page = await boot({ seed: seed(), url: DEV });
  try {
    await openPool(page);
    fill(page, '#pool-venue-name', 'The Corner Bar');
    fill(page, '#pool-date', yesterday);
    fill(page, '#pool-cc', '99999.99');
    fill(page, '#pool-cash', '88888.88');
    for (let i = 0; i < 60; i++)
      person(page, i, 'Person number ' + (i + 1) + ' ab', '', '7:' + String(10 + (i % 50)));
    await later();
    assert.ok(page.$('#pool-result table'), 'the sheet itself works out');
    assert.equal(page.$$('#pool-result tbody tr').length, 60);
    page.click(page.$('#pool-share-btn'));
    assert.match(page.text(page.$('#pool-share-toobig')), /Split the staff into two sheets/);
    assert.equal(page.$('#sheet-link'), null);
    page.click(page.$('#pool-add-person'));
    assert.match(page.text(page.$('.toast')), /up to 60 people/);
  } finally {
    await page.close();
  }
});

test('print the tip sheet: a print-only block with the table and its totals', async () => {
  const page = await boot({ seed: seed(), url: DEV });
  try {
    let area = null;
    page.win.print = () => {
      area = page.text(page.$('#print-area'));
    };
    await openPool(page);
    fill(page, '#pool-venue-name', 'The Corner Bar');
    fill(page, '#pool-date', yesterday);
    fill(page, '#pool-cc', '100');
    fill(page, '#pool-cash', '10');
    person(page, 0, 'Ann', '', '8');
    person(page, 1, 'Bo', '', '8');
    await later();
    page.click(page.$('#pool-print'));
    assert.match(area, /The Corner Bar tip sheet/);
    assert.match(area, /split by hours/);
    assert.match(area, /Ann8:00\$50\.00\$5\.00\$55\.00/);
    assert.match(area, /Total16:00\$100\.00\$10\.00\$110\.00/);
  } finally {
    await page.close();
  }
});
