// iPhone: a venue or tip sheet link opens in Safari, but the worker may use the Home Screen app, whose data is separate.
// The Join and Tip sheet screens say so and give the link back; Setup > Join your venue takes both kinds of link.
import test from 'node:test';
import assert from 'node:assert/strict';
import { boot, realState } from './harness.js';
import { VID, venue, sheet, joinUrl, sheetUrl, fill } from './teams-util.js';
import { encodeVenue, decodeVenue } from '../../app/js/venue.js';
import { encodeSheet, decodeSheet } from '../../app/js/sheet.js';
import { IPHONE_HINT } from '../../app/js/ui/join.js';

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Safari/604.1';
const fake = (page, ua, standalone) => {
  if (ua) Object.defineProperty(page.win.navigator, 'userAgent', { configurable: true, value: ua });
  if (standalone !== undefined)
    Object.defineProperty(page.win.navigator, 'standalone', { configurable: true, value: standalone });
};
/** Opens a link the way a tap on it does in an open app (the fragment, then hashchange). */
const open = async (page, hash) => {
  page.win.location.hash = hash;
  page.win.dispatchEvent(new page.win.Event('hashchange'));
  await page.settle();
};
const setUp = (mutate) =>
  realState((S) => {
    S.workplaces[0].setupDone = true;
    S.workplaces[0].name = 'Corner';
    S.workplaces[0].venue = { id: VID, name: 'The Corner Bar' };
    if (mutate) mutate(S);
  });
const codeIn = (url) => /#(?:join|sheet)=([^#]*)/.exec(url)[1];

test('iPhone Safari, nothing set up: the Join screen explains the Home Screen app and gives the link back', async () => {
  const page = await boot();
  try {
    fake(page, IPHONE, false);
    await open(page, '#join=' + encodeVenue(venue()));
    const card = page.must(page.$('#join-iphone'), 'iPhone card');
    assert.equal(page.text(card.querySelector('p')), IPHONE_HINT);
    const link = page.$('#join-iphone-link').value;
    assert.match(link, /#join=/);
    assert.deepEqual(decodeVenue(codeIn(link)), decodeVenue(encodeVenue(venue())), 'the same venue');
    assert.equal(page.$('#join-iphone-link').readOnly, true);
    // the clipboard refuses: the link is selected to copy by hand
    Object.defineProperty(page.win.navigator, 'clipboard', {
      configurable: true,
      value: { writeText: () => Promise.reject(new Error('denied')) },
    });
    page.click(page.$('#join-iphone-copy'));
    await page.settle();
    assert.equal(page.text(page.$('#join-iphone-msg')), 'Selected. Copy it by hand.');
    // the first-run button is the Safari choice, and it answers the home-screen step
    assert.equal(page.$('#join-start').textContent, 'Set up here in Safari instead');
    page.click(page.$('#join-start'));
    await page.settle();
    assert.equal(page.state().settings.installStepSeen, true);
    assert.equal(page.state().workplaces[0].venue.id, VID);
    assert.equal(
      page.byText('button', 'Set up here in Safari instead'),
      null,
      'no home-screen step after it',
    );
    assert.match(page.text(), /Three short steps/);
  } finally {
    await page.close();
  }
});

test('not an iPhone (or the Home Screen app): no card, and the button is "Set up with these"', async () => {
  for (const standalone of [undefined, true]) {
    const page = await boot();
    try {
      if (standalone) fake(page, IPHONE, true);
      await open(page, '#join=' + encodeVenue(venue()));
      assert.ok(page.$('#join-screen'));
      assert.equal(page.$('#join-iphone'), null);
      assert.equal(page.$('#join-start').textContent, 'Set up with these');
      page.click(page.$('#join-start'));
      await page.settle();
      assert.notEqual(page.state().settings.installStepSeen, true);
    } finally {
      await page.close();
    }
  }
});

test('iPhone Safari: the Tip sheet screen (set up or not) has the card with the sheet link', async () => {
  for (const seed of [setUp(), undefined]) {
    const page = await boot(seed ? { seed } : {});
    try {
      fake(page, IPHONE, false);
      await open(page, '#sheet=' + encodeSheet(sheet()));
      assert.ok(page.$('#sheet-screen'));
      const card = page.must(page.$('#sheet-iphone'), 'iPhone card');
      assert.equal(page.text(card.querySelector('p')), IPHONE_HINT);
      const link = page.$('#sheet-iphone-link').value;
      assert.deepEqual(decodeSheet(codeIn(link)), decodeSheet(encodeSheet(sheet())));
    } finally {
      await page.close();
    }
  }
});

test('Setup > Join your venue takes a tip sheet link or a bare sheet code too', async () => {
  const page = await boot({ seed: setUp() });
  try {
    page.tab('setup');
    page.click(page.byText('button.fold-head', 'Join your venue'));
    fill(page, '#join-code', sheetUrl());
    page.click(page.$('#join-go'));
    assert.match(page.text(page.$('#sheet-h1')), /Tip sheet for The Corner Bar/);
    page.click(page.$('#sheet-not-now'));
    page.tab('setup');
    page.click(page.byText('button.fold-head', 'Join your venue'));
    fill(page, '#join-code', encodeSheet(sheet()));
    page.click(page.$('#join-go'));
    assert.ok(page.$('#sheet-screen'));
    page.click(page.$('#sheet-not-now'));
    page.tab('setup');
    page.click(page.byText('button.fold-head', 'Join your venue'));
    fill(page, '#join-code', joinUrl().replace('#join=', '#sheet='));
    page.click(page.$('#join-go'));
    assert.equal(page.$('#sheet-screen'), null, 'a venue code behind #sheet= is not a sheet');
    assert.match(page.text(page.$('#join-code').parentNode.parentNode), /venue code or tip sheet link/);
    assert.equal(page.state().nights.length, 0);
  } finally {
    await page.close();
  }
});

test('a link that reads but cannot be shown gives the plain bad-link screen, never a blank or error screen', async () => {
  const { bus } = await import('../../app/js/ui/common.js');
  const { BAD_LINK_MSG } = await import('../../app/js/venue.js');
  const { BAD_SHEET_MSG } = await import('../../app/js/sheet.js');
  const page = await boot({ seed: setUp() });
  try {
    bus.openLink({ kind: 'join', venue: { id: VID } }); // no name, no jobs: drawing it throws
    assert.ok(page.$('#link-bad'), 'the bad-link screen');
    assert.equal(page.text(page.$('#link-bad [role="alert"]')), BAD_LINK_MSG);
    page.click(page.$('#link-bad-ok'));
    bus.openLink({ kind: 'sheet', sheet: { venue: { id: VID }, rows: null } });
    assert.equal(page.text(page.$('#link-bad [role="alert"]')), BAD_SHEET_MSG);
    page.click(page.$('#link-bad-ok'));
    assert.equal(page.$('#link-bad'), null);
    assert.equal(page.state().nights.length, 0);
  } finally {
    await page.close();
  }
});
