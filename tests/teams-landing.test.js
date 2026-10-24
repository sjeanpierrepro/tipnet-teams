// The manager landing page (app/teams/index.html): static and CSP-safe, and its prices, Buy buttons and worked example
// come from billing-config.js (through billing.js), never typed twice.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Window } from 'happy-dom';
import { BILLING as SHIPPED } from '../app/js/billing-config.js';
import { staffCreditCents, dollars, priceCents } from '../app/js/billing.js';

globalThis.document = { querySelectorAll: () => [] }; // legal.js and landing.js fill the page they are loaded in
const { fillLanding, creditExample } = await import('../app/teams/landing.js');

const html = readFileSync(new URL('../app/teams/index.html', import.meta.url), 'utf8');
const page = () => {
  const win = new Window({ url: 'http://localhost/teams/index.html' });
  win.document.body.innerHTML = html
    .replace(/^[\s\S]*<body[^>]*>/i, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '');
  return win.document;
};
const text = (doc) => doc.body.textContent.replace(/\s+/g, ' ');
const buy = (doc, which) => doc.querySelector(`a[data-buy="teams-${which}"]`);

test('landing page: static, CSP-safe, phone-first, relative links only', () => {
  assert.match(html, /http-equiv="Content-Security-Policy"/);
  assert.match(html, /name="viewport" content="width=device-width, initial-scale=1/);
  assert.doesNotMatch(html, /<style/i, 'no inline styles');
  assert.doesNotMatch(html, /\sstyle=/i, 'no style attributes');
  assert.doesNotMatch(html, /\son[a-z]+=/i, 'no inline handlers');
  assert.doesNotMatch(html, /innerHTML/);
  for (const s of html.match(/<script[^>]*>/g)) assert.match(s, /src="/, 'scripts are files');
  assert.doesNotMatch(html, /tipmynet\.com/);
  assert.doesNotMatch(
    html.replace(/https:\/\/(api\.lemonsqueezy|api\.polar)\.[a-z]+/g, ''),
    /href="https?:\/\/(?!app\.lemonsqueezy\.com\/my-orders)/,
  );
  // uses the app's own CSS tokens and components, nothing else
  assert.match(html, /href="\.\.\/css\/tokens\.css"/);
  assert.match(html, /href="\.\.\/css\/components\.css"/);
});

test('landing page: the pitch, what managers get, what staff get, Budget and the credit, FAQ', () => {
  const t = text(page());
  assert.match(t, /Your tip software shows what staff earned\. TipNet Teams shows what they keep\./);
  for (const w of [/Venue setup QR/, /Tip-pool calculator/, /Tip sheets/, /unlock with TipNet Teams/])
    assert.match(t, w);
  assert.match(t, /What your staff get, free/);
  assert.match(t, /Staff Perks Credit/);
  assert.match(t, /25%/);
  assert.match(t, /partial refund/i);
  assert.match(t, /Up to 50 staff/);
  assert.match(t, /No setup fee/);
  assert.match(t, /Already bought\?/);
  assert.match(t, /enter your team key/);
  assert.match(t, /Manage subscription/);
  for (const q of [
    'Can I see what my staff earn',
    'Can I cancel',
    'refunds',
    'How many devices',
    'Staff Perks Credit applied',
    'Do staff have to buy',
  ])
    assert.match(t, new RegExp(q));
  assert.match(t, /never see what any staff member earns/);
});

test('landing page: prices, links and the example are read from the config', () => {
  const doc = page();
  fillLanding(doc, SHIPPED, Date.parse('2026-11-01T00:00:00Z'));
  const t = text(doc);
  assert.match(t, /\$59 a month/);
  assert.match(t, /\$500 a year/);
  assert.match(t, /\$1\.99 a month or \$20 a year/);
  assert.equal(buy(doc, 'monthly').getAttribute('href'), SHIPPED.teams.checkout.monthly);
  assert.equal(buy(doc, 'yearly').getAttribute('href'), SHIPPED.teams.checkout.yearly);
  assert.equal(buy(doc, 'monthly').getAttribute('target'), '_blank');
  assert.match(buy(doc, 'monthly').getAttribute('rel'), /noopener/);
  assert.equal(
    doc.querySelector('a[data-manage]').getAttribute('href'),
    'https://tipnet.lemonsqueezy.com/billing',
  );
  assert.match(
    t,
    /10 staff keep a Budget subscription at \$1\.99 a month\. Each earns your venue \$0\.50 a month, so your venue gets \$5\.00 back that month, as a partial refund on its most recent TipNet Teams payment/,
  );

  // change the config, and the page follows
  const changed = { ...SHIPPED, teams: { ...SHIPPED.teams, prices: { monthly: '$79', yearly: '$700' } } };
  const d2 = page();
  fillLanding(d2, changed, Date.parse('2026-11-01T00:00:00Z'));
  assert.match(text(d2), /\$79 a month/);
  assert.match(text(d2), /\$700 a year/);
  assert.doesNotMatch(text(d2), /\$59/);
});

test('landing page: the Budget price change and its example switch on Jan 1, 2027 (Eastern)', () => {
  const before = page();
  fillLanding(before, SHIPPED, Date.parse('2027-01-01T04:59:59Z'));
  assert.match(text(before), /\$1\.99 a month or \$20 a year/);
  const after = page();
  fillLanding(after, SHIPPED, Date.parse('2027-01-01T05:00:00Z'));
  assert.match(text(after), /\$3\.99 a month or \$30 a year/);
  assert.match(
    text(after),
    /at \$3\.99 a month\. Each earns your venue \$1\.00 a month, so your venue gets \$10\.00 back that month/,
  );
});

test('landing page: Teams payments off shows Coming soon, no buy links', () => {
  for (const cfg of [
    { ...SHIPPED, provider: null },
    { ...SHIPPED, teams: { ...SHIPPED.teams, productId: '' } },
    { ...SHIPPED, teams: { ...SHIPPED.teams, checkout: { monthly: '', yearly: '' } } },
  ]) {
    const doc = page();
    fillLanding(doc, cfg);
    for (const w of ['monthly', 'yearly']) {
      const a = buy(doc, w);
      assert.equal(a.textContent, 'Coming soon');
      assert.equal(a.getAttribute('href'), null);
      assert.equal(a.getAttribute('aria-disabled'), 'true');
    }
    assert.equal(doc.querySelector('[data-buy-note]').hidden, true);
  }
});

test('landing page: a ?cart= link in the config never becomes a Buy button', () => {
  const bad = {
    ...SHIPPED,
    teams: {
      ...SHIPPED.teams,
      checkout: {
        monthly: 'https://tipnet.lemonsqueezy.com/checkout/?cart=abc',
        yearly: SHIPPED.teams.checkout.yearly,
      },
    },
  };
  const doc = page();
  fillLanding(doc, bad);
  assert.equal(buy(doc, 'monthly').textContent, 'Coming soon');
  assert.equal(buy(doc, 'yearly').getAttribute('href'), SHIPPED.teams.checkout.yearly);
});

test('Staff Perks Credit amounts: 25% of what each pays, yearly price / 12 first', () => {
  assert.equal(priceCents('$1.99'), 199);
  assert.equal(priceCents('$20'), 2000);
  assert.equal(priceCents('free'), null);
  assert.equal(staffCreditCents('$1.99', 'monthly'), 50);
  assert.equal(staffCreditCents('$3.99', 'monthly'), 100);
  assert.equal(staffCreditCents('$20', 'yearly'), 42); // 20 / 12 * 25% = 0.4167
  assert.equal(staffCreditCents('$30', 'yearly'), 63); // 30 / 12 * 25% = 0.625
  assert.equal(staffCreditCents('oops'), null);
  assert.equal(dollars(50), '$0.50');
  assert.equal(dollars(500), '$5.00');
  assert.equal(creditExample('nope'), '');
});
