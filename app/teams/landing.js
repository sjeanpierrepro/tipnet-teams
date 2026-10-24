// Fills the manager page (index.html) from billing-config.js, so prices, checkout links and the worked example live in
// one place. The page ships with the launch prices as plain text; this replaces them with what the config says now
// (including TipNet Budget's scheduled price change). While Teams payments are off, the Buy buttons say "Coming soon".
import {
  BILLING,
  displayPrices,
  checkoutUrl,
  productOn,
  providerInfo,
  staffCreditCents,
  dollars,
} from '../js/billing.js';

const STAFF_IN_EXAMPLE = 10;

/** The worked example's sentence for TipNet Budget's price now (monthly). */
export function creditExample(budgetMonthly, staff = STAFF_IN_EXAMPLE) {
  const each = staffCreditCents(budgetMonthly, 'monthly');
  if (each === null) return '';
  return (
    staff +
    ' staff keep a Budget subscription at ' +
    budgetMonthly +
    ' a month. Each earns your venue ' +
    dollars(each) +
    ' a month, so your venue gets ' +
    dollars(each * staff) +
    ' off its next TipNet Teams bill.'
  );
}

/** Fill every hook in doc. config: the raw config (default: the shipped one). now: ms, for the price change. */
export function fillLanding(doc, config = BILLING, now = Date.now()) {
  const teams = displayPrices('teams', config, now);
  const budget = displayPrices('budget', config, now);
  const prices = {
    'teams-monthly': teams.monthly,
    'teams-yearly': teams.yearly,
    'budget-monthly': budget.monthly,
    'budget-yearly': budget.yearly,
  };
  for (const el of doc.querySelectorAll('[data-price]')) {
    const v = prices[el.getAttribute('data-price')];
    if (v) el.textContent = v;
  }
  const sentence = creditExample(budget.monthly);
  for (const el of doc.querySelectorAll('[data-credit-example]')) if (sentence) el.textContent = sentence;

  const on = productOn('teams', config);
  let anyOff = false;
  for (const a of doc.querySelectorAll('a[data-buy]')) {
    const plan = a.getAttribute('data-buy').split('-')[1];
    const href = on ? checkoutUrl(plan, config, 'teams', now) : '';
    if (href) {
      a.setAttribute('href', href);
      a.setAttribute('target', '_blank');
      a.setAttribute('rel', 'noopener noreferrer');
      a.textContent =
        plan === 'yearly'
          ? 'Buy yearly: ' + teams.yearly + ' a year'
          : 'Buy monthly: ' + teams.monthly + ' a month';
      a.removeAttribute('aria-disabled');
    } else {
      anyOff = true;
      a.removeAttribute('href');
      a.removeAttribute('target');
      a.setAttribute('aria-disabled', 'true');
      a.textContent = 'Coming soon';
    }
  }
  for (const n of doc.querySelectorAll('[data-buy-note]')) if (anyOff) n.hidden = true;
  const info = providerInfo(config);
  for (const a of doc.querySelectorAll('a[data-manage]')) a.setAttribute('href', info.manageUrl);
}

if (typeof document !== 'undefined' && document.querySelectorAll) fillLanding(document);
