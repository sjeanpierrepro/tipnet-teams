// TipNet Teams billing settings. The owner edits this file to change prices, links or ids. Installed apps refresh this file
// in the background, so adding 1 to VERSION in app/sw.js is optional for a change here, but recommended (it makes every
// installed copy offer "Refresh" right away). Full click-by-click steps are in PAYMENTS.md.
//
// Two products are sold, both through Lemon Squeezy (the only payment service in use):
//   teams:  TipNet Teams, sold to venues: $59 a month or $500 a year per location.
//   budget: TipNet Budget, sold to staff (the "Staff Budget"): $1.99 a month or $20 a year through Dec 31, 2026, then
//           $3.99 a month or $30 a year (the `after` block below switches what the app shows at that moment).
// A product with no productId stays locked and shows "Coming soon"; set `provider: null` to switch every payment off.
// The ids and checkout links below are public, not secrets. A checkout link must be a /checkout/buy/<id> link: anything
// else (for example a ?cart= link) is ignored by the app on purpose.

export const BILLING = {
  provider: 'lemonsqueezy',

  // Lemon Squeezy store tipnet.lemonsqueezy.com (live mode). A key from any other store is refused.
  storeId: '487063',

  // What "Manage subscription" opens: the store's own billing page (cancel, change card, invoices).
  portalUrl: 'https://tipnet.lemonsqueezy.com/billing',

  teams: {
    productId: '1467595', // TipNet Teams (license keys on, 3 devices)
    prices: { monthly: '$59', yearly: '$500' }, // what the app shows; change only if the price changes in Lemon Squeezy too
    checkout: {
      monthly:
        'https://tipnet.lemonsqueezy.com/checkout/buy/9433ca2a-f18f-4f78-aaaa-b256c9339582?enabled=2288791', // variant 2288791
      yearly:
        'https://tipnet.lemonsqueezy.com/checkout/buy/2aa30b1d-617c-4eab-932b-774fd6319fe1?enabled=2288799', // variant 2288799
    },
  },

  budget: {
    productId: '1467608', // TipNet Budget (license keys on, 3 devices)
    prices: { monthly: '$1.99', yearly: '$20' },
    checkout: {
      monthly:
        'https://tipnet.lemonsqueezy.com/checkout/buy/5860d305-25d3-4e75-80d4-2af7ab13a410?enabled=2288812', // variant 2288812
      yearly:
        'https://tipnet.lemonsqueezy.com/checkout/buy/7960a69b-bd73-40f2-b12d-5e4efdb51063?enabled=2288818', // variant 2288818
    },
    // From Jan 1, 2027 00:00 Eastern (05:00 UTC) the app shows these prices. Change the prices in Lemon Squeezy the same
    // day (PAYMENTS.md). If you sell the new price through new variants, add their links under `checkout` here too.
    after: { at: '2027-01-01T05:00:00Z', prices: { monthly: '$3.99', yearly: '$30' } },
  },

  allowTestMode: false, // true only while testing with Lemon Squeezy's test mode: its keys are refused otherwise
  proxyUrl: '', // leave empty
};

/*
 * POLAR (not used, kept only so the code that reads it stays tested). Polar sells Budget only. Switching also needs
 * https://api.polar.sh back in connect-src on the four pages (index, privacy, terms, teams/index), and a VERSION bump in
 * sw.js. To use it instead, replace the block above with:
 *
 * export const BILLING = {
 *   provider: 'polar',
 *   budget: { prices: { monthly: '$1.99', yearly: '$20' }, checkout: { monthly: '...', yearly: '...' } },
 *   organizationId: '<uuid>',
 *   benefitId: '<uuid>',
 *   portalUrl: 'https://polar.sh/<org>/portal',
 * };
 */
