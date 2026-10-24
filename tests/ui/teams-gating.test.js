// The Team tab only exists where TipNet Teams is unlocked (for now: the localhost dev unlock).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { boot, realState, APP_DIR } from './harness.js';
import { teamsUnlocked, budgetUnlocked } from '../../app/js/entitlements.js';
import { DEV } from './teams-util.js';
import path from 'node:path';

const setUp = () => realState((S) => (S.workplaces[0].setupDone = true));

test('Team tab: hidden when not unlocked, and the app works as before', async () => {
  const page = await boot({ seed: setUp() });
  try {
    assert.equal(page.tabHidden('team'), true);
    assert.equal(teamsUnlocked(), false);
    assert.equal(page.$('#tabs').classList.contains('tabs-5'), false);
    page.tab('setup');
    assert.match(page.$('#app h1').textContent, /Setup/);
  } finally {
    await page.close();
  }
});

test('Team tab: ?unlock=dev on localhost shows it; the same address on another site does not', async () => {
  const page = await boot({ seed: setUp(), url: DEV });
  try {
    assert.equal(page.tabHidden('team'), false);
    assert.equal(teamsUnlocked(), true);
    assert.equal(budgetUnlocked(), true, 'the dev unlock opens Budget too');
    page.tab('team');
    assert.equal(page.$('#tabs [aria-selected="true"]').dataset.tab, 'team');
    assert.match(page.$('#app h1').textContent, /Team/);
    assert.equal(page.$('#tabs').classList.contains('tabs-5'), true, 'five tabs: the short labels');
  } finally {
    await page.close();
  }
  const other = await boot({ seed: setUp(), url: 'https://example.com/?unlock=dev' });
  try {
    assert.equal(other.tabHidden('team'), true);
    assert.equal(teamsUnlocked(), false);
  } finally {
    await other.close();
  }
});

test('Team tab: a last tab of "team" on a device where it is locked opens Tonight', async () => {
  const S = setUp();
  S.settings.lastTab = 'team';
  const page = await boot({ seed: S });
  try {
    assert.equal(page.$('#tabs [aria-selected="true"]').dataset.tab, 'tonight');
  } finally {
    await page.close();
  }
});

test('Team tab: arrow keys skip it while it is hidden, and reach it when unlocked', async () => {
  const page = await boot({ seed: setUp() });
  try {
    page.tab('setup');
    page.key(page.$('#tabs [data-tab="setup"]'), 'ArrowRight');
    assert.equal(page.$('#tabs [aria-selected="true"]').dataset.tab, 'tonight', 'wraps past the hidden Team tab');
  } finally {
    await page.close();
  }
  const dev = await boot({ seed: setUp(), url: DEV });
  try {
    dev.tab('setup');
    dev.key(dev.$('#tabs [data-tab="setup"]'), 'ArrowRight');
    assert.equal(dev.$('#tabs [aria-selected="true"]').dataset.tab, 'team');
  } finally {
    await dev.close();
  }
});

test('phone nav: five tabs fit at 375px (short labels and smaller type under 440px)', () => {
  const css = readFileSync(path.join(APP_DIR, 'css/components.css'), 'utf8');
  const block = /@media \(max-width: 440px\) \{[^@]*?\.tabbar\.tabs-5 button[\s\S]*?\.tabbar\.tabs-5 \.tab-short[\s\S]*?\n\}/.exec(css);
  assert.ok(block, 'a rule for .tabbar.tabs-5 under 440px');
  assert.match(block[0], /\.tabs-5 \.tab-full[\s\S]*clip/, 'the long "Pay periods" label is hidden for the short one');
  assert.match(block[0], /\.tabs-5 \.tab-short \{\s*display: inline/);
  const html = readFileSync(path.join(APP_DIR, 'index.html'), 'utf8');
  assert.match(html, /data-tab="team"[\s\S]*?hidden[\s\S]*?Team/);
});
