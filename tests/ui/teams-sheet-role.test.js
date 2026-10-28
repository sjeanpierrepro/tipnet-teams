// Staff side: a tip sheet that carries the venue job a person worked puts the hours on that job on Tonight (by the
// venue's job id, else by name, else the main job), and the note says where the hours went.
import test from 'node:test';
import assert from 'node:assert/strict';
import { boot, realState } from './harness.js';
import { VID, sheet, sheetUrl } from './teams-util.js';

const key = (page, k) => page.must(page.$('[data-focus-key="' + k + '"]'), k);
const seed = (extra = []) =>
  realState((S) => {
    const w = S.workplaces[0];
    w.setupDone = true;
    w.name = 'Corner';
    w.venue = { id: VID, name: 'The Corner Bar' };
    w.profile.tipout = { on: true };
    w.profile.tipouts = [
      { id: 't1', k: 'barback', who: 'Barback', mode: 'pctTips', value: 15, from: 'cash' },
    ];
    w.profile.payTypes = [
      { id: 'p1', k: 'bartender', name: 'Bartender', rate: 12, unit: 'hr', usual: 7 },
      { id: 'p2', k: 'otherjob', name: 'Bar lead', rate: 18, unit: 'hr', usual: 0, vj: 'j2' },
      { id: 'p3', k: 'server', name: 'Server', rate: 5, unit: 'hr', usual: 0 },
      { id: 'p4', k: 'otherjob', name: 'Door', rate: 30, unit: 'shift', usual: 0, vj: 'j4' },
      ...extra,
    ];
  });
const row = (over) => ({ name: 'Sam', minutes: 450, cc: 12345, cash: 2050, ...over });
const openFor = async (rows, extra) => {
  const page = await boot({ seed: seed(extra), url: sheetUrl(sheet({ rows })) });
  page.click(key(page, 'sheet-name-0'));
  page.click(page.$('#sheet-open'));
  await page.settle();
  return page;
};
const NOTE_TAIL =
  'change it below if you worked a different job. Tip-outs are unticked: the pool was already split.';
const noteOf = (page) => page.$('#sheet-note').textContent.replace(/\s+/g, ' ');

test('the hours go on the job with the sheet’s venue job id, even when the worker named it differently', async () => {
  const page = await openFor([row({ vj: 'j2', job: 'Shift lead' })]);
  try {
    assert.equal(key(page, 'night-pay-p2').value, '7:30');
    assert.equal(page.$('[data-focus-key="night-pay-p1"]'), null, 'the main job is not a row tonight');
    assert.match(
      noteOf(page),
      /^From the tip sheet for The Corner Bar, \w{3}, \w{3} \d+\. Hours are on Bar lead; /,
    );
    assert.ok(noteOf(page).endsWith(NOTE_TAIL), noteOf(page));
    assert.equal(page.$('[data-focus-key="night-tipout-t1"]').checked, false);
    // looking it over saves nothing; saving puts the money on that job
    assert.equal(page.state().nights.length, 0);
    page.click(page.button('Save night'));
    await page.settle();
    const n = page.state().nights[0];
    assert.equal(n.pay.p2, 7.5);
    assert.equal(n.pay.p1 || 0, 0, 'nothing on the main job');
  } finally {
    await page.close();
  }
});

test('else the job with the same name (any case); else the main job', async () => {
  let page = await openFor([row({ vj: 'j9', job: 'server' })]);
  try {
    assert.equal(key(page, 'night-pay-p3').value, '7:30', 'matched by name');
    assert.match(noteOf(page), /Hours are on Server; /);
  } finally {
    await page.close();
  }
  page = await openFor([row({ vj: 'j9', job: 'Runner' })]);
  try {
    assert.equal(key(page, 'night-pay-p1').value, '7:30', 'neither: the main job');
    assert.match(noteOf(page), /Hours are on Bartender; /);
  } finally {
    await page.close();
  }
});

test('a version 1 sheet (no role) still puts the hours on the main job, and the note says so', async () => {
  const page = await openFor([row()]);
  try {
    assert.equal(key(page, 'night-pay-p1').value, '7:30');
    assert.match(noteOf(page), /^From the tip sheet for The Corner Bar, .*\. Hours are on Bartender; /);
    assert.ok(noteOf(page).endsWith(NOTE_TAIL));
  } finally {
    await page.close();
  }
});

test('a job paid by the shift gets no hours, and the note does not claim any', async () => {
  const page = await openFor([row({ vj: 'j4', job: 'Door' })]);
  try {
    assert.equal(key(page, 'night-pay-p4').value, '1', 'one shift');
    assert.doesNotMatch(noteOf(page), /Hours are on/);
    assert.match(noteOf(page), /Tip-outs are unticked: the pool was already split\.$/);
  } finally {
    await page.close();
  }
});

test('a sheet with no hours for the person puts none anywhere', async () => {
  const page = await openFor([row({ minutes: 0, vj: 'j2', job: 'Shift lead' })]);
  try {
    assert.equal(key(page, 'night-pay-p2').value, '');
    assert.doesNotMatch(noteOf(page), /Hours are on/);
  } finally {
    await page.close();
  }
});
