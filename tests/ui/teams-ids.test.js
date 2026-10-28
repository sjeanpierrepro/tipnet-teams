// Teams tab: every venue job and tip-out gets a short stable id when the manager adds the row, kept when it is renamed
// and kept in settings.team; a person's role can be a venue job, and the tip sheet carries it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { boot, realState } from './harness.js';
import { DEV, fill, pause } from './teams-util.js';
import { decodeVenue } from '../../app/js/venue.js';
import { decodeSheet } from '../../app/js/sheet.js';
import { addDays, todayISO } from '../../app/js/math.js';

const seed = () => realState((S) => (S.workplaces[0].setupDone = true));
const later = () => pause(620);
const start = addDays(todayISO(), -10);
const end = addDays(start, 13);
const yesterday = addDays(todayISO(), -1);
const venueOf = (page) => decodeVenue(page.$('#venue-link').value.split('#join=')[1]);

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

test('the venue code gives each job and tip-out an id; renaming keeps it; a removed id is never handed out again', async () => {
  const page = await boot({ seed: seed(), url: DEV });
  try {
    page.tab('team');
    await fillVenue(page);
    let v = venueOf(page);
    assert.deepEqual(
      v.jobs.map((j) => j.id),
      ['j1'],
    );
    assert.deepEqual(
      v.tipouts.map((t) => t.id),
      ['t1'],
    );
    // a second job, then a rename of the first (an "Other job" with a name of its own)
    page.click(page.$('#venue-add-job'));
    fill(page, '#vj-rate-1', '9');
    const kind = page.$('#vj-kind-0');
    kind.value = 'otherjob';
    page.change(kind);
    fill(page, '#vj-name-0', 'Bar staff');
    await later();
    v = venueOf(page);
    assert.deepEqual(
      v.jobs.map((j) => [j.id, j.name]),
      [
        ['j1', 'Bar staff'],
        ['j2', v.jobs[1].name],
      ],
      'the renamed job is still j1',
    );
    // remove the second and add another: it is j3, not j2 again
    page.click(page.byLabel('Remove ' + v.jobs[1].name));
    page.click(page.$('#venue-add-job'));
    fill(page, '#vj-rate-1', '11');
    await later();
    v = venueOf(page);
    assert.deepEqual(
      v.jobs.map((j) => j.id),
      ['j1', 'j3'],
    );
    // kept on the device, with the counters
    const team = page.state().settings.team;
    assert.deepEqual(
      team.venue.jobs.map((j) => j.id),
      ['j1', 'j3'],
    );
    assert.equal(team.jSeq, 3);
    assert.equal(team.tSeq, 1);
  } finally {
    await page.close();
  }
});

test('a venue kept from before ids existed gets ids when the Teams tab opens it', async () => {
  const s = seed();
  s.settings.team = {
    venueId: 'AbCdEf012345',
    name: 'The Corner Bar',
    venue: {
      id: 'AbCdEf012345',
      name: 'The Corner Bar',
      freq: 14,
      start,
      end,
      delay: 5,
      jobs: [{ k: 'bartender', name: 'Bartender', rate: 1200, unit: 'hr' }],
      tipouts: [{ k: 'barback', who: 'Barback', mode: 'pctTips', value: 1500, from: 'cash' }],
    },
  };
  const page = await boot({ seed: s, url: DEV });
  try {
    page.tab('team');
    page.click(page.$('#team-venue-tab'));
    await later();
    const v = venueOf(page);
    assert.deepEqual([v.jobs[0].id, v.tipouts[0].id], ['j1', 't1']);
  } finally {
    await page.close();
  }
});

test('a person whose role is a venue job: the tip sheet carries the job, and it follows a rename', async () => {
  const page = await boot({ seed: seed(), url: DEV });
  try {
    page.tab('team');
    await fillVenue(page);
    page.click(page.$('#team-pool-tab'));
    fill(page, '#pool-date', yesterday);
    fill(page, '#pool-cc', '100');
    fill(page, '#pool-cash', '20');
    fill(page, '#pr-name-0', 'Ann');
    fill(page, '#pr-role-0', ' bartender ');
    fill(page, '#pr-hours-0', '8');
    page.click(page.$('#pool-add-person'));
    fill(page, '#pr-name-1', 'Bo');
    fill(page, '#pr-role-1', 'Floater');
    fill(page, '#pr-hours-1', '4');
    fill(page, '#pool-venue-name', 'The Corner Bar');
    await later();
    page.click(page.$('#pool-share-btn'));
    const sheet = decodeSheet(page.$('#sheet-link').value.split('#sheet=')[1]);
    assert.deepEqual(
      sheet.rows.map((r) => [r.name, r.vj, r.job]),
      [
        ['Ann', 'j1', 'Bartender'],
        ['Bo', undefined, undefined],
      ],
      'a role that is not a venue job carries nothing extra',
    );
    // the staff list remembers the venue job
    assert.equal(page.state().settings.team.staff[0].vj, 'j1');
    assert.equal(page.state().settings.team.staff[1].vj, undefined);
    // the manager renames the job in the Venue code tab; Ann's role follows by id the next time the pool opens
    page.click(page.$('#team-venue-tab'));
    const kind = page.$('#vj-kind-0');
    kind.value = 'otherjob';
    page.change(kind);
    fill(page, '#vj-name-0', 'Bar staff');
    await later();
    page.tab('tonight');
    page.tab('team');
    page.click(page.$('#team-pool-tab'));
    assert.equal(page.$('#pr-role-0').value, 'Bar staff');
    assert.equal(page.$('#pr-role-1').value, 'Floater');
  } finally {
    await page.close();
  }
});

test('ids never grow past 4 characters: after j999 the smallest free number is used', async () => {
  const { newRowId } = await import('../../app/js/ui/team.js');
  const page = await boot({ seed: realState((S) => (S.settings.team = { jSeq: 998 })), url: DEV });
  try {
    assert.equal(newRowId('j', []), 'j999');
    assert.equal(newRowId('j', ['j1', 'j2']), 'j3', 'all 999 went by: the smallest free one');
    assert.ok(/^[a-z0-9]{1,4}$/.test(newRowId('j', ['j1', 'j2', 'j3'])));
  } finally {
    await page.close();
  }
});
