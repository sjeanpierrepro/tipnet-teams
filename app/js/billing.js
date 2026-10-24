// TipNet Teams billing: license-key entitlements for two products, TipNet Budget (staff) and TipNet Teams (venues). Each
// product has its own stored license state. No server of our own.
// Pure logic (isUnlocked, needsRevalidate, maskKey, parsers, provider) works in Node with fetch injected.
// The only network calls ever made go to the payment provider, and only when the user
// activates a key or a revalidation is due (at most once per 24 hours). They send the
// license key and a random device name, never budget or pay data.
import * as configModule from './billing-config.js';

const WRONG_PRODUCT =
  'This key is real, but it is for a different product, not TipNet Teams or TipNet Budget.';
// A Lemon Squeezy checkout link must be a /checkout/buy/<uuid> link (optionally with ?enabled=<variant id>). A ?cart= link
// or anything else is dropped, so the buttons stay off rather than send a customer somewhere unexpected.
const LS_BUY_LINK =
  /^https:\/\/[a-z0-9-]+\.lemonsqueezy\.com\/checkout\/buy\/[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}(\?enabled=\d+)?$/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The two things on sale. budget: TipNet Budget for staff. teams: TipNet Teams for venues. */
export const PRODUCTS = ['budget', 'teams'];
const DEFAULT_PRICES = {
  budget: { monthly: '$1.99', yearly: '$20' },
  teams: { monthly: '$59', yearly: '$500' },
};

/**
 * billing-config.js is served from the cache and refreshed in the background (see sw.js), so it and this file can be from
 * different versions. Read the config defensively: missing or extra fields are fine, and a missing export is too.
 * Shape: { provider, allowTestMode, proxyUrl, portalUrl, budget: {productId, prices, checkout, after?}, teams: {...} }.
 * The older flat Budget fields (productIds, prices, checkout) still read as the budget product.
 * The result also keeps budget's checkout, prices and productIds at the top, for the code that predates two products.
 */
export function readConfig(raw) {
  const c = raw && typeof raw === 'object' ? raw : {};
  const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
  const str = (v) => (typeof v === 'string' ? v : '');
  const idOk = (v) =>
    (typeof v === 'number' || (typeof v === 'string' && v.trim() !== '')) && Number.isFinite(Number(v));
  // Product ids are mandatory: without one, a license key from ANY Lemon Squeezy store would unlock the product, so
  // that product counts as OFF (locked, no network calls) until the owner fills its id in.
  const legacyIds = (Array.isArray(c.productIds) ? c.productIds : []).filter(idOk);
  const product = (name) => {
    const p = obj(c[name] || obj(c.products)[name]); // c.products: an already-read config reads back the same
    const base = DEFAULT_PRICES[name];
    const flat = name === 'budget'; // the old flat fields belong to Budget
    const ids = flat ? legacyIds : [];
    const productId = idOk(p.productId) ? String(p.productId).trim() : ids.length ? String(ids[0]) : '';
    // Lemon Squeezy links are checked (see LS_BUY_LINK); other providers' links are taken as typed.
    const link = (v) => (c.provider === 'lemonsqueezy' ? (LS_BUY_LINK.test(str(v)) ? str(v) : '') : str(v));
    const links = obj(p.checkout || (flat ? c.checkout : null));
    const out = {
      productId,
      prices: { ...base, ...obj(p.prices || (flat ? c.prices : null)) },
      checkout: { monthly: link(links.monthly), yearly: link(links.yearly) },
    };
    // A scheduled price change: from `at` on, the screens show these prices (and checkout links, when given).
    const after = obj(p.after);
    if (Number.isFinite(Date.parse(after.at)) && obj(after.prices)) {
      const ac = obj(after.checkout);
      out.after = {
        at: after.at,
        prices: { ...out.prices, ...obj(after.prices) },
        checkout: {
          monthly: link(ac.monthly) || out.checkout.monthly,
          yearly: link(ac.yearly) || out.checkout.yearly,
        },
      };
    }
    return out;
  };
  const products = { budget: product('budget'), teams: product('teams') };
  // Polar needs both ids (a key from another Polar organization or benefit must never unlock Budget). Polar sells Budget only.
  const organizationId = str(c.organizationId).trim();
  const benefitId = str(c.benefitId).trim();
  const polarOk = UUID.test(organizationId) && UUID.test(benefitId);
  const lsOk = !!(products.budget.productId || products.teams.productId);
  const provider =
    c.provider === 'lemonsqueezy' && lsOk
      ? 'lemonsqueezy'
      : c.provider === 'polar' && polarOk
        ? 'polar'
        : null; // unknown providers, or missing ids, count as off
  return {
    provider,
    products,
    // budget's, shared (same objects) so a change to one shows in the other
    prices: products.budget.prices,
    checkout: products.budget.checkout,
    productIds: [products.budget.productId, products.teams.productId].filter(Boolean),
    storeId: /^d+$/.test(String(c.storeId || '').trim()) ? String(c.storeId).trim() : '',
    organizationId,
    benefitId,
    portalUrl: str(c.portalUrl),
    allowTestMode: c.allowTestMode === true, // only an explicit true; anything else is false
    proxyUrl: str(c.proxyUrl),
  };
}
export const BILLING = readConfig(configModule.BILLING);

/**
 * Re-read billing-config.js after the service worker says it changed (the app started with the cached copy so the first
 * screen never waits on the network). A fresh ?query makes the browser load the module again; the service worker
 * answers with the copy it just stored. Updates BILLING in place. Resolves true when the new file was read.
 * load: for tests.
 */
export async function reloadConfig(load = () => import('./billing-config.js?fresh=' + Date.now())) {
  try {
    const mod = await load();
    Object.assign(BILLING, readConfig(mod && mod.BILLING));
    return true;
  } catch (e) {
    return false; // keep what we have
  }
}

export const GRACE_MS = 14 * 24 * 3600 * 1000; // offline grace after last successful validation
export const REVALIDATE_MS = 24 * 3600 * 1000; // at most one silent check per day
const LS_API = 'https://api.lemonsqueezy.com/v1/licenses';
const POLAR_API = 'https://api.polar.sh/v1/customer-portal/license-keys';
const LS_PORTAL = 'https://app.lemonsqueezy.com/my-orders';
const POLAR_PORTAL = 'https://polar.sh/tipnet/portal';

/**
 * Name and links of the payment provider in use, for wording in the app and on the Privacy and Terms pages.
 * While payments are off it describes Lemon Squeezy, which is the wording the pages have always had.
 */
export function providerInfo(rawConfig = BILLING) {
  const config = readConfig(rawConfig);
  if (config.provider === 'polar')
    return {
      id: 'polar',
      name: 'Polar',
      privacyUrl: 'https://polar.sh/legal/privacy',
      privacyLabel: 'polar.sh/legal/privacy',
      manageUrl: config.portalUrl.startsWith('https://') ? config.portalUrl : POLAR_PORTAL,
      cancelWhere: 'the Polar customer portal',
    };
  return {
    id: 'lemonsqueezy',
    name: 'Lemon Squeezy',
    privacyUrl: 'https://www.lemonsqueezy.com/privacy',
    privacyLabel: 'lemonsqueezy.com/privacy',
    // portalUrl may hold the store's own billing page (https://STORE.lemonsqueezy.com/billing); My Orders works for any store.
    manageUrl: config.portalUrl.startsWith('https://') ? config.portalUrl : LS_PORTAL,
    cancelWhere: "Lemon Squeezy's My Orders page",
  };
}

/* ---------- pure helpers ---------- */

/** "abcd-1234-efgh-5678" -> "••••-••••-••••-5678". For display only; the full key is stored. */
export function maskKey(key) {
  const k = String(key || '');
  if (!k) return '';
  if (k.length <= 4) return k;
  return k.slice(0, -4).replace(/[^-\s]/g, '•') + k.slice(-4);
}

/** A random, non-identifying name for this device, e.g. "tipnet-k3j9x2ab". */
export function randomInstanceName() {
  const c = globalThis.crypto;
  let s;
  if (c && c.getRandomValues)
    s = Array.from(c.getRandomValues(new Uint8Array(5)), (b) => b.toString(36).padStart(2, '0')).join('');
  else s = Math.random().toString(36).slice(2, 12);
  return 'tipnet-' + s.slice(0, 10);
}

const ACTIVE = new Set(['active', 'on_trial']);
const CLOCK_SKEW_MS = 5 * 60 * 1000; // a check that claims to be from the future (beyond clock drift) is not trusted
const toMs = (v) => {
  const t = typeof v === 'number' ? v : Date.parse(v);
  return Number.isFinite(t) ? t : null;
};

/**
 * Is the product unlocked right now? ent: that product's stored entitlement (state.settings.entitlement for Budget,
 * state.settings.teamsEntitlement for Teams) or null. now: ms.
 * Two ways in: (1) a dev entitlement, honored only on localhost; (2) a real one, which needs a license key AND
 * the device seat (instanceId) the payment service handed back, payments switched on, status active/on_trial,
 * and a last check within 14 days that is not in the future. Anything hand-made fails at least one of these.
 * opts: { loc, config, product } for tests; product is 'budget' (default) or 'teams' and must be switched on in the config.
 */
export function isUnlocked(ent, now = Date.now(), opts = {}) {
  if (!ent || typeof ent !== 'object') return false;
  const loc = 'loc' in opts ? opts.loc : globalThis.location;
  if (ent.plan === 'dev') return isDevHost(loc);
  const config = 'config' in opts ? readConfig(opts.config) : BILLING;
  if (!productOn(opts.product || 'budget', config)) return false;
  if (
    typeof ent.key !== 'string' ||
    !ent.key ||
    (typeof ent.instanceId !== 'string' && typeof ent.instanceId !== 'number') ||
    ent.instanceId === ''
  )
    return false;
  if (!ACTIVE.has(ent.status)) return false;
  const v = toMs(ent.validatedAt);
  if (v === null || now - v > GRACE_MS || v - now > CLOCK_SKEW_MS) return false;
  return true;
}

/**
 * Is this product on sale? Payments need a provider, and Lemon Squeezy also needs the product's id (so a key from another
 * product, or another store, never unlocks it). Polar sells Budget only.
 */
export function productOn(product, rawConfig = BILLING) {
  const config = readConfig(rawConfig);
  if (!config.provider) return false;
  if (config.provider === 'polar') return product === 'budget';
  return !!(config.products[product] && config.products[product].productId);
}

/** Should the Budget tab be visible? Only when payments are on, or this device already has an unlocked add-on (or dev unlock). */
export function budgetVisible(ent, now = Date.now(), opts = {}) {
  const config = 'config' in opts ? readConfig(opts.config) : BILLING;
  return productOn('budget', config) || isUnlocked(ent, now, opts);
}

/** True when a silent recheck is due: has a real key, online, and last check is 24h+ old. */
export function needsRevalidate(ent, now = Date.now(), online = true) {
  if (!ent || ent.plan === 'dev' || !ent.key || !ent.instanceId) return false;
  if (!online) return false;
  const v = toMs(ent.validatedAt);
  return v === null || now - v >= REVALIDATE_MS || v > now;
}

/**
 * Turns a Lemon Squeezy activate/validate JSON body into {ok, status, expiresAt?, instanceId?, error?}.
 * ok means "this key is good for use right now". productIds rejects keys from other products (the app always passes them,
 * see readConfig). A test-mode key (from Lemon Squeezy's Test mode) is rejected unless allowTestMode is true.
 */
export function parseLemonSqueezy(body, productIds = [], allowTestMode = false, storeId = '') {
  const b = body && typeof body === 'object' ? body : {};
  const lk = b.license_key || {};
  const status = lk.status || null;
  const out = { ok: false, status: status || 'invalid' };
  if (lk.expires_at) out.expiresAt = lk.expires_at;
  if (b.instance && b.instance.id) out.instanceId = String(b.instance.id);
  const vn = String((b.meta && b.meta.variant_name) || '').toLowerCase();
  if (vn.includes('year') || vn.includes('annual')) out.plan = 'yearly';
  else if (vn.includes('month')) out.plan = 'monthly';
  const good = b.activated === true || b.valid === true;
  // Only say "wrong product" when the service found the key and it belongs to a different product.
  // A key it did not find at all is a typo, and gets the "not found" message below.
  if (productIds && productIds.length && b.license_key && typeof b.license_key === 'object') {
    const pid = b.meta && b.meta.product_id;
    if (!productIds.map(Number).includes(Number(pid))) {
      return {
        ok: false,
        status: 'invalid',
        error: WRONG_PRODUCT,
      };
    }
  }
  // With a store id configured, a reply that names another store is refused too (Lemon Squeezy sends meta.store_id).
  if (
    storeId &&
    b.license_key &&
    typeof b.license_key === 'object' &&
    b.meta &&
    b.meta.store_id !== undefined
  ) {
    if (String(b.meta.store_id) !== String(storeId))
      return { ok: false, status: 'invalid', error: WRONG_PRODUCT };
  }
  // Test-mode keys cost nothing to make, so they never unlock a live app. The flag can be on the key or in the meta block.
  const test = (b.license_key && b.license_key.test_mode === true) || (b.meta && b.meta.test_mode === true);
  if (test && !allowTestMode) {
    return {
      ok: false,
      status: 'invalid',
      error: 'This is a test key. Use the key from a real purchase.',
    };
  }
  if (good && ACTIVE.has(status)) {
    out.ok = true;
    return out;
  }
  if (status === 'expired') out.error = 'This subscription has ended. Renew it to unlock again.';
  else if (status === 'disabled') out.error = 'This key was turned off (refunded or cancelled).';
  else out.error = friendlyError(b.error);
  return out;
}

/**
 * Turns a Polar customer-portal activate/validate JSON body into the same {ok, status, expiresAt?, instanceId?, error?}
 * shape as parseLemonSqueezy. Polar answers 200 only for a granted key (a revoked or disabled key is a 404 or 403, see
 * polarProvider), but a body that says revoked or disabled is refused here too. A granted key is trusted as is, even
 * past its expires_at by this device's clock (Polar's own reply is the judge). A granted key is reported as
 * 'active'. benefitId and organizationId reject keys from another benefit or organization (the app always passes them).
 * An activate body has the key under license_key and the activation id in id; a validate body is the key itself, with
 * the activation under activation.
 */
export function parsePolar(body, benefitId = '', organizationId = '') {
  const b = body && typeof body === 'object' ? body : {};
  const isActivation = !!(b.license_key && typeof b.license_key === 'object');
  const lk = isActivation ? b.license_key : b;
  const found = typeof lk.status === 'string' && lk.status !== '';
  const out = { ok: false, status: found ? lk.status : 'invalid' };
  if (lk.expires_at) out.expiresAt = lk.expires_at;
  const inst = isActivation ? b.id : b.activation && b.activation.id;
  if (inst) out.instanceId = String(inst);
  const differs = (want, got) => !!want && String(got || '').toLowerCase() !== String(want).toLowerCase();
  if (found && (differs(benefitId, lk.benefit_id) || differs(organizationId, lk.organization_id))) {
    return {
      ok: false,
      status: 'invalid',
      error: WRONG_PRODUCT,
    };
  }
  // Polar checks expiry itself (an expired key is a 404 or 403), so expires_at is never compared with this device's
  // clock: a phone set to the wrong date must not lock a payer.
  if (lk.status === 'granted') {
    out.ok = true;
    out.status = 'active';
    return out;
  }
  if (lk.status === 'revoked')
    out.error = 'This subscription has ended or was refunded. Renew it to unlock again.';
  else if (lk.status === 'disabled') out.error = 'This key was turned off (refunded or cancelled).';
  else {
    out.status = 'invalid';
    out.error = 'That key did not work. Check it and try again.';
  }
  return out;
}

function friendlyError(msg) {
  const m = String(msg || '').toLowerCase();
  if (!m) return 'That key did not work. Check it and try again.';
  if (m.includes('not found')) return 'That key was not found. Check it and try again.';
  if (m.includes('limit'))
    return 'This key is already on the most devices it allows. Turn it off on another device first.';
  return 'That key did not work. Check it and try again.';
}

/* ---------- providers ---------- */

/**
 * Lemon Squeezy License API. Public endpoints, no secret key. Verified to send CORS headers
 * (access-control-allow-origin: *), so browsers can call it directly. If proxyUrl is set, calls go there instead.
 * deps: { fetch, productIds, proxyUrl }
 */
export function lemonSqueezyProvider(deps = {}) {
  const f = deps.fetch || ((...a) => globalThis.fetch(...a));
  // products: { budget: id, teams: id }. Their ids are the whole allow-list; productIds is the older Budget-only form.
  const products = deps.products || (deps.productIds ? { budget: (deps.productIds || [])[0] } : {});
  const productIds = Object.values(products).filter(Boolean);
  const allowTestMode = deps.allowTestMode === true;
  const storeId = deps.storeId || '';
  const productOf = (body) => {
    const pid = body && body.meta && body.meta.product_id;
    return PRODUCTS.find((p) => products[p] && Number(products[p]) === Number(pid)) || null;
  };
  const base = (deps.proxyUrl || LS_API).replace(/\/$/, '');
  async function call(path, fields, expected = null) {
    let res;
    try {
      res = await f(`${base}/${path}`, {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(fields).toString(),
      });
    } catch (e) {
      return {
        ok: false,
        status: 'network',
        error: 'Could not reach the payment service. Check your connection.',
        unreachable: true, // no reply at all (offline or blocked), not a busy service
      };
    }
    // A server error or rate limit is not an answer about the key: treat it like being offline.
    if (res && (res.status >= 500 || res.status === 429)) {
      return {
        ok: false,
        status: 'network',
        error: 'The payment service is busy. Try again in a few minutes.',
      };
    }
    let body = null;
    try {
      body = await res.json();
    } catch (e) {
      /* not JSON */
    }
    if (!body)
      return {
        ok: false,
        status: 'network',
        error: 'The payment service sent an unexpected reply. Try again later.',
      };
    const r = parseLemonSqueezy(body, productIds, allowTestMode, storeId);
    const product = productOf(body);
    if (product) r.product = product; // the id in the reply decides which product this key is for
    // A recheck says which product it expects: a key that is really for the other one does not count.
    if (expected && r.ok && productIds.length && product !== expected)
      return { ok: false, status: 'invalid', error: WRONG_PRODUCT };
    return r;
  }
  return {
    id: 'lemonsqueezy',
    activate: (key, instanceName) =>
      call('activate', {
        license_key: String(key || '').trim(),
        instance_name: instanceName || randomInstanceName(),
      }),
    validate: (key, instanceId, expected = null) =>
      call('validate', { license_key: String(key || '').trim(), instance_id: instanceId }, expected),
    deactivate: (key, instanceId) =>
      call('deactivate', { license_key: String(key || '').trim(), instance_id: instanceId }),
  };
}

/**
 * Polar customer-portal license API. Public endpoints that need no token (only the organization id and the key), and they
 * send access-control-allow-origin: *, so browsers can call them directly. JSON in, JSON out. Polar answers 200 for a
 * granted key; a revoked, disabled, expired or unknown key (or a removed activation) is a 404 on validate, and a 403 on
 * activate (which also covers the device limit). 5xx and 429 count as a busy service, like Lemon Squeezy.
 * deps: { fetch, organizationId, benefitId, proxyUrl }
 */
export function polarProvider(deps = {}) {
  const f = deps.fetch || ((...a) => globalThis.fetch(...a));
  const organizationId = deps.organizationId || '';
  const benefitId = deps.benefitId || '';
  const base = (deps.proxyUrl || POLAR_API).replace(/\/$/, '');
  const unexpected = {
    ok: false,
    status: 'network',
    error: 'The payment service sent an unexpected reply. Try again later.',
  };
  async function call(path, fields) {
    let res;
    try {
      res = await f(`${base}/${path}`, {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...fields, organization_id: organizationId }),
      });
    } catch (e) {
      return {
        ok: false,
        status: 'network',
        error: 'Could not reach the payment service. Check your connection.',
        unreachable: true, // no reply at all (offline or blocked), not a busy service
      };
    }
    const code = res && res.status;
    if (code >= 500 || code === 429)
      return {
        ok: false,
        status: 'network',
        error: 'The payment service is busy. Try again in a few minutes.',
      };
    if (code === 204) return { ok: true, status: 'deactivated' };
    let body = null;
    try {
      body = await res.json();
    } catch (e) {
      /* not JSON */
    }
    if (!body || typeof body !== 'object') return unexpected;
    // Definite answers about the key. A 422 means our own request was malformed, which says nothing about the key:
    // it never locks anyone (on validate) and is just "did not work" on activate.
    // A 404 is an answer about the key only in Polar's own not-found shape ({"error":"ResourceNotFound"}); any other
    // 404 (a moved endpoint, a proxy or CDN page) says nothing about the key, so it never locks: the grace applies.
    if (code === 404 && body.error !== 'ResourceNotFound') return unexpected;
    if (code === 404 && path === 'validate')
      return {
        ok: false,
        status: 'invalid',
        error: 'This key is no longer valid. The subscription may have ended.',
      };
    if (code === 404)
      return { ok: false, status: 'invalid', error: 'That key was not found. Check it and try again.' };
    if (code === 403)
      return {
        ok: false,
        status: 'invalid',
        error:
          'This key can’t be used: its subscription has ended, or it is already on the most devices it allows. Turn it off on another device first.',
      };
    if (code === 422) {
      if (path === 'validate') return unexpected;
      return { ok: false, status: 'invalid', error: 'That key did not work. Check it and try again.' };
    }
    if (!(code >= 200 && code < 300)) return unexpected;
    // A 200 with no key status is not an answer about the key (never lock on it).
    const key = body.license_key && typeof body.license_key === 'object' ? body.license_key : body;
    if (typeof key.status !== 'string' || !key.status) return unexpected;
    return parsePolar(body, benefitId, organizationId);
  }
  return {
    id: 'polar',
    activate: (key, instanceName) =>
      call('activate', { key: String(key || '').trim(), label: instanceName || randomInstanceName() }),
    validate: (key, instanceId) =>
      call('validate', { key: String(key || '').trim(), activation_id: instanceId }),
    deactivate: (key, instanceId) =>
      call('deactivate', { key: String(key || '').trim(), activation_id: instanceId }),
  };
}

/** Provider chosen in billing-config.js, or null while payments are switched off (which includes: no product id filled in). */
export function getProvider(rawConfig = BILLING, deps = {}) {
  const config = readConfig(rawConfig);
  if (config.provider === 'lemonsqueezy') {
    return lemonSqueezyProvider({
      products: { budget: config.products.budget.productId, teams: config.products.teams.productId },
      allowTestMode: config.allowTestMode,
      storeId: config.storeId,
      proxyUrl: config.proxyUrl,
      ...deps,
    });
  }
  if (config.provider === 'polar') {
    return polarProvider({
      organizationId: config.organizationId,
      benefitId: config.benefitId,
      proxyUrl: config.proxyUrl,
      ...deps,
    });
  }
  return null;
}

/* ---------- entitlement flow (state.settings.entitlement) ---------- */

/**
 * User pastes a key. Returns {ok, entitlement?, error?}. On ok, the caller stores entitlement in
 * state.settings.entitlement (Budget) or state.settings.teamsEntitlement (Teams), as `product` says, and saves. plan ('monthly'|'yearly') is optional and stored as given. Never throws.
 */
export async function activateKey(
  key,
  { provider = getProvider(), plan = null, now = Date.now(), instanceName } = {},
) {
  if (!provider) return { ok: false, error: 'Payments are not switched on yet.' };
  const k = String(key || '').trim();
  if (!k) return { ok: false, error: 'Paste your license key first.' };
  const r = await provider.activate(k, instanceName || randomInstanceName());
  if (!r.ok) return { ok: false, error: r.error || 'That key did not work.' };
  return {
    ok: true,
    product: r.product || 'budget',
    entitlement: {
      product: r.product || 'budget',
      plan: plan || r.plan || null,
      key: k,
      instanceId: r.instanceId || null,
      status: r.status,
      validatedAt: new Date(now).toISOString(),
      expiresAt: r.expiresAt || null,
    },
  };
}

/**
 * Silent daily recheck. Returns the entitlement to store, or null for "no change" (not due, offline,
 * or a network failure: the 14-day grace covers that). A definite answer from the provider
 * (expired, disabled, not found) is stored so the add-on locks. Never throws.
 */
export async function revalidate(
  ent,
  {
    provider = getProvider(),
    now = Date.now(),
    online = typeof navigator === 'undefined' ? true : navigator.onLine,
    product = 'budget',
  } = {},
) {
  if (!provider || !needsRevalidate(ent, now, online)) return null;
  const r = await provider.validate(ent.key, ent.instanceId, product);
  if (r.status === 'network') return null;
  // A definite "no" (valid:false) locks even if the key itself is still active, e.g. this device's instance was
  // removed. 'invalid' is not an unlocking status, so isUnlocked treats it as locked.
  const status = r.ok ? r.status : ACTIVE.has(r.status) ? 'invalid' : r.status;
  return {
    ...ent,
    status,
    validatedAt: new Date(now).toISOString(),
    expiresAt: r.expiresAt || ent.expiresAt || null,
  };
}

/**
 * Frees this device's seat. Never throws. Returns {ok: true} when the caller may delete settings.entitlement (the
 * service answered, or there is no seat to free: dev unlock, no instance, payments off). {ok: false, offline, error}
 * when the service could not be reached (offline, network error, server busy): the seat is still used, so the caller
 * keeps the key unless the person chooses to remove it anyway.
 */
export async function deactivate(
  ent,
  {
    provider = getProvider(),
    online = typeof navigator === 'undefined' ? true : navigator.onLine !== false,
  } = {},
) {
  if (!(provider && provider.deactivate && ent && ent.key && ent.instanceId)) return { ok: true };
  const offline = {
    ok: false,
    offline: true,
    error: 'You’re offline. Connect to remove this device from your subscription.',
  };
  if (!online) return offline;
  let r;
  try {
    r = await provider.deactivate(ent.key, ent.instanceId);
  } catch (e) {
    return offline;
  }
  if (r && r.status === 'network' && r.unreachable) return offline;
  if (r && r.status === 'network')
    return {
      ok: false,
      offline: false,
      error:
        'The payment service didn’t answer. Try again in a few minutes to remove this device from your subscription.',
    };
  return { ok: true };
}

/** For UI display: entitlement with the key masked. Does not change what is stored. */
export function displayEntitlement(ent) {
  return ent ? { ...ent, key: maskKey(ent.key) } : null;
}

/**
 * Dev unlock, only on localhost / 127.0.0.1 with ?unlock=dev in the URL. Returns an entitlement or null.
 * loc: {hostname, search}. Never returns anything on other hosts.
 */
export function devEntitlement(loc = globalThis.location) {
  if (!loc) return null;
  if (!isDevHost(loc)) return null;
  if (new URLSearchParams(loc.search || '').get('unlock') !== 'dev') return null;
  return {
    plan: 'dev',
    key: '',
    instanceId: null,
    status: 'active',
    validatedAt: new Date().toISOString(),
    expiresAt: null,
  };
}

/** True on localhost / 127.0.0.1 only. A stored dev entitlement is dropped anywhere else. */
export function isDevHost(loc = globalThis.location) {
  return !!loc && (loc.hostname === 'localhost' || loc.hostname === '127.0.0.1');
}

/** True from the moment a product's scheduled price change takes effect. */
const changed = (p, now) => !!p.after && now >= Date.parse(p.after.at);

/** What the screens show for a product right now: { monthly, yearly } (the scheduled change applies from its date). */
export function displayPrices(product = 'budget', rawConfig = BILLING, now = Date.now()) {
  const p = readConfig(rawConfig).products[product];
  return { ...(changed(p, now) ? p.after.prices : p.prices) };
}

/** Checkout link for a plan ('monthly'|'yearly') of a product (default Budget), or '' if not set up yet. */
export function checkoutUrl(plan, rawConfig = BILLING, product = 'budget', now = Date.now()) {
  const p = readConfig(rawConfig).products[product];
  return (changed(p, now) ? p.after.checkout : p.checkout)[plan] || '';
}

/* ---------- Staff Perks Credit: which venue a Budget payment is for ---------- */

/**
 * The venues the establishments have joined (workplace.venue = {id, name}, set by the venue code in TipNet Teams), one entry
 * per venue id, in establishment order, and the one to credit by default: the active establishment's venue, else the first.
 * Returns { list: [{id, name}], defaultId } (defaultId '' when none).
 */
export function venueChoices(workplaces, activeId) {
  const list = [];
  let defaultId = '';
  for (const w of Array.isArray(workplaces) ? workplaces : []) {
    const v = w && w.venue;
    if (!v || typeof v.id !== 'string' || !v.id || list.some((x) => x.id === v.id)) continue;
    list.push({ id: v.id, name: String(v.name || '') });
  }
  const mine = (Array.isArray(workplaces) ? workplaces : []).find((w) => w && w.id === activeId);
  if (mine && mine.venue && list.some((x) => x.id === mine.venue.id)) defaultId = mine.venue.id;
  else if (list.length) defaultId = list[0].id;
  return { list, defaultId };
}

/**
 * Adds Lemon Squeezy custom data to a checkout link: checkout[custom][venue_id]=<id> (the format in Lemon Squeezy's
 * "Passing custom data" help page). The brackets stay as the page writes them, the id is URL-encoded. It comes back in
 * the order, subscription and license-key webhooks as meta.custom_data.venue_id. With no venue id or no link, the link is
 * returned as it is.
 */
export function venueCheckoutUrl(url, venueId) {
  if (!url || !venueId) return url || '';
  const hash = url.indexOf('#');
  const base = hash < 0 ? url : url.slice(0, hash);
  const tail = hash < 0 ? '' : url.slice(hash);
  return (
    base +
    (base.includes('?') ? '&' : '?') +
    'checkout[custom][venue_id]=' +
    encodeURIComponent(venueId) +
    tail
  );
}
