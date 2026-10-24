// The calm "For managers: TipNet Teams" card at the very bottom of Setup, only while TipNet Teams is not unlocked on this
// device. It points to the manager page (teams/index.html) and holds the box for a team key. One card, no popups.
import { productOn, displayPrices } from '../billing.js';
import { teamsUnlocked } from '../entitlements.js';
import { licenseKeyForm } from './budget.js';
import { el } from './common.js';

export function managersCard() {
  if (teamsUnlocked()) return null;
  const p = displayPrices('teams');
  return el(
    'section',
    { class: 'card stack', id: 'managers-card', 'aria-labelledby': 'managers-card-h' },
    el('h2', { id: 'managers-card-h' }, 'For managers: TipNet Teams'),
    el(
      'p',
      null,
      'Set up your venue once, hand your staff a QR code, split the tip pool and print tip sheets. Your staff keep their pay private.',
    ),
    el('p', null, el('strong', null, p.monthly + ' a month or ' + p.yearly + ' a year per location')),
    productOn('teams')
      ? null
      : el(
          'p',
          { class: 'hint' },
          el('strong', null, 'Coming soon. '),
          'You’ll be able to buy it here soon.',
        ),
    el(
      'div',
      { class: 'stack-sm' },
      el(
        'a',
        { class: 'btn btn-secondary btn-block', id: 'managers-see', href: 'teams/index.html' },
        'See TipNet Teams',
      ),
    ),
    // A team key works from anywhere; this box is only shown once Teams can be bought.
    productOn('teams')
      ? el(
          'details',
          { class: 'card' },
          el('summary', null, 'I have a team key'),
          el(
            'div',
            { style: 'padding-top:var(--s-2)' },
            licenseKeyForm('Paste it here to unlock TipNet Teams on this device.'),
          ),
        )
      : null,
  );
}
