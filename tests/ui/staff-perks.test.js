// Staff Perks Credit at checkout: the venue goes into the Budget checkout link as Lemon Squeezy custom data, the plain
// credit line shows, and with several venues a "Credit goes to" choice picks one. Plus the managers card in Setup.
import test from 'node:test';
import assert from 'node:assert/strict';
import { boot, realState } from './harness.js';
import { BILLING } from '../../app/js/billing.js';

const M = 'https://shop.lemonsqueezy.com/checkout/buy/11111111-2222-3333-4444-555555555555?enabled=1';
const Y = 'https://shop.lemonsqueezy.com/checkout/buy/66666666-7777-8888-9999-000000000000?enabled=2';
const V1 = { id: 'venueAAAA111', name: 'The Pour House' };
const V2 = { id: 'venue_BBBB-22', name: 'Harbor Grill' };

function seed(venues) {
  return realState((S) => {
    S.workplaces[0].setupDone = true;
    if (venues[0]) S.workplaces[0].venue = venues[0];
    if (venues[1]) {
      S.workplaces.push({
        ...JSON.parse(JSON.stringify(S.workplaces[0])),
        id: 'w2',
        name: 'Second job',
        venue: venues[1],
      });
    }
  });
}
const links = (page) => page.$$('a', page.$('#budget-upgrade')).map((a) => a.getAttribute('href'));
async function open(venues, fn) {
  const page = await boot({ seed: seed(venues), payments: true });
  try {
    BILLING.products.budget.checkout.monthly = M;
    BILLING.products.budget.checkout.yearly = Y;
    page.tab('budget');
    await fn(page);
  } finally {
    BILLING.products.budget.checkout.monthly = '';
    BILLING.products.budget.checkout.yearly = '';
    await page.close();
  }
}

test('one venue: both prices carry checkout[custom][venue_id], enabled is kept, one plain credit line', async () => {
  await open([V1], (page) => {
    assert.deepEqual(links(page), [
      M + '&checkout[custom][venue_id]=venueAAAA111',
      Y + '&checkout[custom][venue_id]=venueAAAA111',
    ]);
    assert.equal(
      page.text(page.$('#credit-line')),
      'The Pour House gets a small credit (a refund on its TipNet Teams payment) when you subscribe.',
    );
    assert.equal(page.$('#credit-venue'), null, 'no choice with one venue');
  });
});

test('no venue: plain links, no param, no credit line', async () => {
  await open([], (page) => {
    assert.deepEqual(links(page), [M, Y]);
    assert.equal(page.$('#credit-line'), null);
    assert.doesNotMatch(page.text(), /small credit/);
  });
});

test('several venues: "Credit goes to" defaults to the active establishment and changes the links and the line', async () => {
  await open([V1, V2], (page) => {
    const sel = page.$('#credit-venue');
    assert.ok(sel, 'a native select');
    assert.equal(sel.tagName, 'SELECT');
    assert.match(page.text(page.$('#budget-upgrade')), /Credit goes to:/);
    assert.deepEqual(
      Array.from(sel.options).map((o) => o.textContent),
      ['The Pour House', 'Harbor Grill'],
    );
    assert.equal(sel.value, V1.id, 'the active (first) establishment');
    assert.equal(links(page)[0], M + '&checkout[custom][venue_id]=venueAAAA111');
    sel.value = V2.id;
    page.change(sel);
    assert.equal(links(page)[0], M + '&checkout[custom][venue_id]=venue_BBBB-22');
    assert.equal(links(page)[1], Y + '&checkout[custom][venue_id]=venue_BBBB-22');
    assert.match(page.text(page.$('#credit-line')), /^Harbor Grill gets a small credit/);
  });
});

test('managers card: bottom of Setup while Teams is locked, links to the manager page, hidden once unlocked', async () => {
  const page = await boot({ seed: seed([]), payments: 'both' });
  try {
    page.tab('setup');
    const card = page.$('#managers-card');
    assert.ok(card);
    assert.match(page.text(card), /Teams/);
    assert.equal(page.$('#managers-card-h').textContent, 'Teams');
    assert.match(page.text(card), /Tip pools, tip sheets and a venue QR for your bar or restaurant\./);
    assert.doesNotMatch(page.text(card), /managers/i);
    assert.equal(page.$('#managers-see').textContent, 'See Teams');
    assert.match(page.text(card), /\$59 a month or \$500 a year per location, up to 50 staff/);
    assert.equal(page.$('#managers-see').getAttribute('href'), 'teams/index.html');
    assert.ok(page.$('#license-key', card), 'a team key can be entered');
    assert.doesNotMatch(page.text(card), /Coming soon/);
  } finally {
    await page.close();
  }
  const dev = await boot({ url: 'http://localhost/?unlock=dev', seed: seed([]), payments: 'both' });
  try {
    dev.tab('setup');
    assert.equal(dev.$('#managers-card'), null, 'Teams unlocked: no card');
    assert.ok(dev.byText('button', 'TipNet Teams subscription'), 'its subscription row is there');
  } finally {
    await dev.close();
  }
});

test('managers card: Coming soon while Teams payments are off, no key box', async () => {
  const page = await boot({ seed: seed([]), payments: true }); // Budget on, Teams has no product id
  try {
    page.tab('setup');
    const card = page.$('#managers-card');
    assert.match(page.text(card), /Coming soon/);
    assert.equal(page.$('#license-key', card), null);
  } finally {
    await page.close();
  }
});
