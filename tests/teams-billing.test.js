// TipNet Teams billing: two products (Budget, Teams), product-id mapping, per-product license state, checkout links with
// the venue attached, scheduled Budget price change, entitlements.js, and storage keeping a joined venue.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  readConfig,
  productOn,
  isUnlocked,
  GRACE_MS,
  lemonSqueezyProvider,
  getProvider,
  activateKey,
  revalidate,
  displayPrices,
  checkoutUrl,
  venueChoices,
  venueCheckoutUrl,
  providerInfo,
} from '../app/js/billing.js';
import { BILLING as SHIPPED } from '../app/js/billing-config.js';
import { migrate, seedState, backupData, decodeBackup, encodeBackup, cleanVenue } from '../app/js/storage.js';
import { setState } from '../app/js/storage.js';

const TEAMS_ID = 1467595;
const BUDGET_ID = 1467608;
const CFG = SHIPPED;
const NOW = Date.parse('2026-11-01T12:00:00Z');
const DAY = 24 * 3600 * 1000;
const body = (productId, extra = {}, meta = {}) => ({
  activated: true,
  valid: true,
  license_key: { status: 'active', test_mode: false },
  instance: { id: 'inst-1' },
  meta: { store_id: 487063, product_id: productId, variant_name: 'Monthly', ...meta },
  ...extra,
});
const reply = (b) => async () => ({ status: 200, json: async () => b });
const prov = (b) => getProvider(CFG, { fetch: reply(b) });
const ent = (o = {}) => ({
  key: 'AAAA-BBBB',
  instanceId: 'i1',
  status: 'active',
  validatedAt: new Date(NOW - DAY / 2).toISOString(),
  ...o,
});
const away = { hostname: 'tipnet.example' };

test('shipped config: Lemon Squeezy, both products on, real ids and /checkout/buy/ links', () => {
  const c = readConfig(CFG);
  assert.equal(c.provider, 'lemonsqueezy');
  assert.equal(c.storeId, '487063');
  assert.equal(c.products.teams.productId, String(TEAMS_ID));
  assert.equal(c.products.budget.productId, String(BUDGET_ID));
  assert.equal(productOn('teams', CFG), true);
  assert.equal(productOn('budget', CFG), true);
  for (const p of ['teams', 'budget'])
    for (const plan of ['monthly', 'yearly']) {
      const link = c.products[p].checkout[plan];
      assert.match(link, /^https:\/\/tipnet\.lemonsqueezy\.com\/checkout\/buy\/[0-9a-f-]{36}\?enabled=\d+$/);
    }
  assert.deepEqual(c.products.teams.prices, { monthly: '$59', yearly: '$500' });
});

test('checkout links: only /checkout/buy/ links count; ?cart= and other hosts are dropped', () => {
  const uuid = '11111111-2222-3333-4444-555555555555';
  const mk = (monthly) =>
    readConfig({ provider: 'lemonsqueezy', teams: { productId: '1', checkout: { monthly, yearly: '' } } })
      .products.teams.checkout.monthly;
  assert.equal(
    mk(`https://s.lemonsqueezy.com/checkout/buy/${uuid}`),
    `https://s.lemonsqueezy.com/checkout/buy/${uuid}`,
  );
  assert.equal(
    mk(`https://s.lemonsqueezy.com/checkout/buy/${uuid}?enabled=123`),
    `https://s.lemonsqueezy.com/checkout/buy/${uuid}?enabled=123`,
  );
  assert.equal(mk(`https://s.lemonsqueezy.com/checkout/?cart=${uuid}`), '');
  assert.equal(mk(`https://s.lemonsqueezy.com/checkout/buy/${uuid}?cart=1`), '');
  assert.equal(mk(`https://s.lemonsqueezy.com/checkout/buy/${uuid}?enabled=12&x=1`), '');
  assert.equal(mk(`https://evil.example/checkout/buy/${uuid}`), '');
  assert.equal(mk(`http://s.lemonsqueezy.com/checkout/buy/${uuid}`), '');
  assert.equal(mk(`https://s.lemonsqueezy.com.evil.example/checkout/buy/${uuid}`), '');
});

test('a product with no id is off; with no provider both are off', () => {
  const onlyBudget = { provider: 'lemonsqueezy', budget: { productId: '5' } };
  assert.equal(productOn('budget', onlyBudget), true);
  assert.equal(productOn('teams', onlyBudget), false);
  assert.equal(productOn('teams', { ...CFG, provider: null }), false);
  assert.equal(readConfig({ provider: 'lemonsqueezy' }).provider, null, 'no id at all: payments off');
  // the older flat Budget fields still read as Budget
  assert.equal(productOn('budget', { provider: 'lemonsqueezy', productIds: [9] }), true);
  // Polar sells Budget only
  const polar = {
    provider: 'polar',
    organizationId: 'a'.repeat(8) + '-aaaa-aaaa-aaaa-' + 'a'.repeat(12),
    benefitId: 'b'.repeat(8) + '-bbbb-bbbb-bbbb-' + 'b'.repeat(12),
  };
  assert.equal(productOn('budget', polar), true);
  assert.equal(productOn('teams', polar), false);
});

test('activate: the product id in the reply decides which product a key unlocks', async () => {
  const t = await activateKey('KEY-T', { provider: prov(body(TEAMS_ID)), now: NOW });
  assert.equal(t.ok, true);
  assert.equal(t.product, 'teams');
  assert.equal(t.entitlement.product, 'teams');
  const b = await activateKey('KEY-B', { provider: prov(body(BUDGET_ID)), now: NOW });
  assert.equal(b.product, 'budget');
  assert.equal(b.entitlement.product, 'budget');
});

test('Budget keys unlock by product id, whatever the variant: old and new prices both work after Jan 1, 2027', async () => {
  const after = Date.parse('2027-02-01T12:00:00Z');
  const variants = [
    { variant_id: 2288812, variant_name: 'Monthly' }, // $1.99 (kept by existing subscribers)
    { variant_id: 2288818, variant_name: 'Yearly' }, // $20
    { variant_id: 9999901, variant_name: 'Monthly' }, // a new $3.99 variant, if one is ever made
    { variant_id: 9999902, variant_name: 'Yearly' }, // a new $30 variant
  ];
  for (const now of [NOW, after])
    for (const meta of variants) {
      const r = await activateKey('KEY-B', { provider: prov(body(BUDGET_ID, {}, meta)), now });
      assert.equal(r.ok, true, JSON.stringify(meta));
      assert.equal(r.product, 'budget');
    }
});

test('activate: a key for an unknown product, or another store, is refused in plain words', async () => {
  const other = await activateKey('KEY-X', { provider: prov(body(999)), now: NOW });
  assert.equal(other.ok, false);
  assert.match(other.error, /different product, not TipNet Teams or TipNet Budget/);
  const wrongStore = await activateKey('KEY-Y', {
    provider: prov(body(TEAMS_ID, {}, { store_id: 1 })),
    now: NOW,
  });
  assert.equal(wrongStore.ok, false);
  assert.match(wrongStore.error, /different product/);
  const notFound = await activateKey('KEY-Z', {
    provider: prov({ activated: false, error: 'license_key not found.', license_key: null }),
    now: NOW,
  });
  assert.match(notFound.error, /not found/);
});

test('recheck: a key stays tied to its product', async () => {
  const stale = ent({ validatedAt: new Date(NOW - 2 * DAY).toISOString() });
  const asTeams = await revalidate(stale, {
    provider: prov(body(TEAMS_ID)),
    now: NOW,
    online: true,
    product: 'teams',
  });
  assert.equal(asTeams.status, 'active');
  // a Teams key sitting in the Budget slot does not keep Budget unlocked
  const swapped = await revalidate(stale, {
    provider: prov(body(TEAMS_ID)),
    now: NOW,
    online: true,
    product: 'budget',
  });
  assert.equal(swapped.status, 'invalid');
  assert.equal(isUnlocked(swapped, NOW, { config: CFG, loc: away, product: 'budget' }), false);
});

test('each product has its own 14-day offline grace', () => {
  const teamsOld = ent({ validatedAt: new Date(NOW - GRACE_MS - 1000).toISOString() });
  const budgetNew = ent({ validatedAt: new Date(NOW - 3 * DAY).toISOString() });
  const u = (e, product) => isUnlocked(e, NOW, { config: CFG, loc: away, product });
  assert.equal(u(teamsOld, 'teams'), false, 'Teams past its grace locks');
  assert.equal(u(budgetNew, 'budget'), true, 'Budget is judged on its own check');
  const teamsInside = ent({ validatedAt: new Date(NOW - GRACE_MS + 1000).toISOString() });
  assert.equal(u(teamsInside, 'teams'), true);
  // a product that is switched off never unlocks
  assert.equal(
    isUnlocked(budgetNew, NOW, {
      config: { provider: 'lemonsqueezy', teams: { productId: '1' } },
      loc: away,
    }),
    false,
  );
});

test('Budget price change: the app shows $3.99 / $30 from Jan 1, 2027 midnight Eastern', () => {
  const before = Date.parse('2027-01-01T04:59:59Z'); // 11:59:59 PM ET Dec 31
  const after = Date.parse('2027-01-01T05:00:00Z');
  assert.deepEqual(displayPrices('budget', CFG, before), { monthly: '$1.99', yearly: '$20' });
  assert.deepEqual(displayPrices('budget', CFG, after), { monthly: '$3.99', yearly: '$30' });
  assert.deepEqual(displayPrices('teams', CFG, after), { monthly: '$59', yearly: '$500' });
  // the links stay unless the config gives new ones
  assert.equal(checkoutUrl('monthly', CFG, 'budget', after), checkoutUrl('monthly', CFG, 'budget', before));
});

test('venueCheckoutUrl: custom data joins with & after ?enabled=, brackets kept, id encoded', () => {
  const link = readConfig(CFG).products.budget.checkout.monthly;
  const out = venueCheckoutUrl(link, 'venueABC123');
  assert.equal(out, link + '&checkout[custom][venue_id]=venueABC123');
  assert.ok(out.includes('?enabled=2288812&'), 'enabled is kept');
  assert.equal(new URL(out).searchParams.get('checkout[custom][venue_id]'), 'venueABC123');
  // a link with no query gets ?
  assert.equal(
    venueCheckoutUrl('https://s.lemonsqueezy.com/checkout/buy/x', 'abcdefghij'),
    'https://s.lemonsqueezy.com/checkout/buy/x?checkout[custom][venue_id]=abcdefghij',
  );
  // anything unusual in an id is percent-encoded, so it cannot add parameters
  assert.equal(
    venueCheckoutUrl('https://a.test/b?x=1', 'a&b=c d'),
    'https://a.test/b?x=1&checkout[custom][venue_id]=a%26b%3Dc%20d',
  );
  // a #fragment stays at the end
  assert.equal(
    venueCheckoutUrl('https://a.test/b#f', 'id1234567890'),
    'https://a.test/b?checkout[custom][venue_id]=id1234567890#f',
  );
  // no venue: nothing added
  assert.equal(venueCheckoutUrl(link, ''), link);
  assert.equal(venueCheckoutUrl(link, undefined), link);
  assert.equal(venueCheckoutUrl('', 'abc'), '');
});

test('venueChoices: one entry per venue id; the active establishment decides the default', () => {
  const wps = [
    { id: 'w1', name: 'A' },
    { id: 'w2', name: 'B', venue: { id: 'venue-two-aaa', name: 'Two' } },
    { id: 'w3', name: 'C', venue: { id: 'venue-three-b', name: 'Three' } },
    { id: 'w4', name: 'D', venue: { id: 'venue-two-aaa', name: 'Two' } },
  ];
  const r = venueChoices(wps, 'w3');
  assert.deepEqual(
    r.list.map((v) => v.id),
    ['venue-two-aaa', 'venue-three-b'],
  );
  assert.equal(r.defaultId, 'venue-three-b');
  assert.equal(venueChoices(wps, 'w1').defaultId, 'venue-two-aaa', 'active has no venue: the first');
  assert.deepEqual(venueChoices([{ id: 'w1' }], 'w1'), { list: [], defaultId: '' });
  assert.deepEqual(venueChoices(undefined, 'x'), { list: [], defaultId: '' });
});

test('manage link: the store billing page from the config, My Orders otherwise', () => {
  assert.equal(providerInfo(CFG).manageUrl, 'https://tipnet.lemonsqueezy.com/billing');
  assert.equal(
    providerInfo({ provider: 'lemonsqueezy', productIds: [1] }).manageUrl,
    'https://app.lemonsqueezy.com/my-orders',
  );
});

test('lemonSqueezyProvider with two ids still sends form-encoded requests to Lemon Squeezy only', async () => {
  const calls = [];
  const p = lemonSqueezyProvider({
    products: { budget: BUDGET_ID, teams: TEAMS_ID },
    fetch: async (url, init) => {
      calls.push({ url, init });
      return { status: 200, json: async () => body(TEAMS_ID) };
    },
  });
  const r = await p.activate('KEY', 'dev-1');
  assert.equal(r.product, 'teams');
  assert.equal(calls[0].url, 'https://api.lemonsqueezy.com/v1/licenses/activate');
});

test('entitlements.js: budgetUnlocked and teamsUnlocked read their own stored license', async () => {
  const { budgetUnlocked, teamsUnlocked } = await import('../app/js/entitlements.js');
  const was = globalThis.location;
  try {
    const mk = (settings) => {
      const s = seedState();
      Object.assign(s.settings, settings);
      setState(s);
    };
    const fresh = () => ({
      key: 'K',
      instanceId: 'i',
      status: 'active',
      validatedAt: new Date().toISOString(),
    });
    globalThis.location = away;
    mk({});
    assert.equal(budgetUnlocked(), false);
    assert.equal(teamsUnlocked(), false);
    mk({ teamsEntitlement: fresh() });
    assert.equal(teamsUnlocked(), true);
    assert.equal(budgetUnlocked(), false, 'a Teams license does not unlock Budget');
    mk({ entitlement: fresh() });
    assert.equal(budgetUnlocked(), true);
    assert.equal(teamsUnlocked(), false, 'a Budget license does not unlock Teams');
    // a hand-made dev entitlement counts on localhost only
    mk({ teamsEntitlement: { plan: 'dev', status: 'active' } });
    assert.equal(teamsUnlocked(), false);
    globalThis.location = { hostname: 'localhost', search: '' };
    assert.equal(teamsUnlocked(), true);
    // ?unlock=dev on localhost opens both, with nothing stored
    mk({});
    assert.equal(budgetUnlocked(), false);
    globalThis.location = { hostname: 'localhost', search: '?unlock=dev' };
    assert.equal(budgetUnlocked(), true);
    assert.equal(teamsUnlocked(), true);
  } finally {
    globalThis.location = was;
    setState(seedState());
  }
});

test('storage keeps a joined venue (valid shape), drops a bad one, and backups carry it', () => {
  assert.deepEqual(cleanVenue({ id: 'abcdefghij', name: '  The Pour House ' }), {
    id: 'abcdefghij',
    name: 'The Pour House',
  });
  assert.equal(cleanVenue({ id: 'short', name: 'X' }), null, 'id under 10 characters');
  assert.equal(cleanVenue({ id: 'a'.repeat(17), name: 'X' }), null, 'id over 16 characters');
  assert.equal(cleanVenue({ id: 'abcdefghi!', name: 'X' }), null, 'odd characters');
  assert.equal(cleanVenue({ id: 'abcdefghij', name: '   ' }), null);
  assert.equal(cleanVenue({ id: 'abcdefghij', name: 5 }), null);
  assert.equal(cleanVenue('x'), null);
  assert.equal(cleanVenue({ id: 'abcdefghij', name: 'n'.repeat(60) }).name.length, 40);

  const S = seedState();
  S.workplaces[0].venue = { id: 'VENUE_id-123', name: 'Corner Bar', extra: 'x' };
  const m = migrate(JSON.parse(JSON.stringify(S)));
  assert.deepEqual(m.workplaces[0].venue, { id: 'VENUE_id-123', name: 'Corner Bar' });
  S.workplaces[0].venue = { id: '../etc/passwd', name: 'Bad' };
  assert.equal('venue' in migrate(JSON.parse(JSON.stringify(S))).workplaces[0], false);

  S.workplaces[0].venue = { id: 'VENUE_id-123', name: 'Corner Bar' };
  const back = decodeBackup(encodeBackup(S));
  assert.deepEqual(back.workplaces[0].venue, { id: 'VENUE_id-123', name: 'Corner Bar' });
});

test('licenses never travel in a backup: both the Budget and the Teams one stay on the device', () => {
  const S = seedState();
  S.settings.entitlement = { key: 'B', instanceId: 'i', status: 'active', validatedAt: 'x' };
  S.settings.teamsEntitlement = { key: 'T', instanceId: 'i', status: 'active', validatedAt: 'x' };
  const d = backupData(S);
  assert.equal(d.settings.entitlement, undefined);
  assert.equal(d.settings.teamsEntitlement, undefined);
  // a hand-made code that carries one is stripped on the way in
  const code = btoa(JSON.stringify({ ...S, settings: { ...S.settings } }));
  const back = decodeBackup(code);
  assert.equal(back.settings.entitlement, undefined);
  assert.equal(back.settings.teamsEntitlement, undefined);
  // migrate keeps the plain fields of a stored Teams license
  const m = migrate(JSON.parse(JSON.stringify(S)));
  assert.equal(m.settings.teamsEntitlement.key, 'T');
});
