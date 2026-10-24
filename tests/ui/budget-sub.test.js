import test from 'node:test';
import assert from 'node:assert/strict';
import { boot, realState } from './harness.js';
import { exampleBudget } from '../../app/js/budget.js';

const DEV = 'http://localhost/?unlock=dev';

test('budget: bill checkboxes and goal amount fields have names that include the item', async () => {
  const page = await boot({
    url: DEV,
    seed: realState((S) => {
      S.workplaces[0].setupDone = true;
      S.budget = exampleBudget();
    }),
  });
  try {
    page.tab('budget');
    const labels = page.$$('input[type=checkbox]').map((c) => c.getAttribute('aria-label') || '');
    assert.ok(
      labels.some((l) => /^.+ paid$/.test(l)),
      'a bill checkbox is named',
    );
    assert.ok(
      page
        .$$('input')
        .some((i) => /^Amount saved for .+ from the .+ check$/.test(i.getAttribute('aria-label') || '')),
      'a goal amount field is named',
    );
    assert.match(page.text(), /After payday \(/);
    assert.doesNotMatch(page.text(), /Next paycheck, /);
  } finally {
    await page.close();
  }
});

test('budget: an unlocked user who has not finished setup can still manage the subscription', async () => {
  const was = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new TypeError('Failed to fetch'); // payments are on: a recheck must never reach the real service
  };
  const page = await boot({
    url: 'http://localhost/',
    payments: true,
    seed: realState((S) => {
      S.profileExample = true;
      S.workplaces[0].setupDone = false;
      S.settings.entitlement = {
        status: 'active',
        instanceId: 'inst-1',
        validatedAt: new Date().toISOString(),
        plan: 'monthly',
        key: 'ABCD-1234-EFGH-5678',
      };
    }),
  });
  try {
    page.tab('budget');
    const t = page.text();
    assert.match(t, /Finish setup first/);
    assert.match(t, /Subscription/);
    assert.match(t, /Manage subscription/);
    assert.ok(page.button('Remove from this device'), 'remove button reachable');
    assert.doesNotMatch(t, /ABCD-1234-EFGH-5678/, 'key is masked');
  } finally {
    await page.settle();
    globalThis.fetch = was;
    await page.close();
  }
});

test('budget: "Remove from this device" while offline keeps the key, says so, and offers Remove anyway', async () => {
  const was = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    throw new TypeError('Failed to fetch');
  };
  const page = await boot({
    url: 'http://localhost/',
    payments: true,
    seed: realState((S) => {
      S.workplaces[0].setupDone = true;
      S.settings.entitlement = {
        status: 'active',
        instanceId: 'inst-1',
        validatedAt: new Date().toISOString(),
        plan: 'monthly',
        key: 'ABCD-1234-EFGH-5678',
      };
    }),
  });
  try {
    page.tab('budget');
    const remove = page.$('#sub-remove');
    page.click(remove);
    page.click(remove);
    await page.settle();
    assert.ok(calls >= 1, 'the service was asked');
    assert.ok(page.state().settings.entitlement, 'key kept');
    assert.match(
      page.$('#sub-remove-msg').textContent,
      /^You’re offline\. Connect to remove this device from your subscription\..*device slots/,
    );
    assert.doesNotMatch(page.text(), /Removed\. Your budget/);
    assert.equal(remove.disabled, false, 'can try again');
    const anyway = page.$('#sub-remove-anyway');
    assert.equal(anyway.hidden, false);
    page.click(anyway);
    assert.equal(page.state().settings.entitlement, undefined, 'removed on request');
  } finally {
    globalThis.fetch = was;
    await page.close();
  }
});

test('budget: after the Jan 1, 2027 price change the Subscription card shows the plan with no amount', async () => {
  const { BILLING } = await import('../../app/js/billing.js');
  const was = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new TypeError('Failed to fetch'); // a recheck must never reach the real service
  };
  for (const plan of ['monthly', 'yearly']) {
    const page = await boot({
      url: 'http://localhost/',
      payments: true,
      seed: realState((S) => {
        S.workplaces[0].setupDone = true;
        S.settings.entitlement = {
          status: 'active',
          instanceId: 'inst-1',
          validatedAt: new Date().toISOString(),
          plan,
          key: 'ABCD-1234-EFGH-5678',
        };
      }),
    });
    try {
      // the price change has happened (the harness clears it at the next boot)
      BILLING.products.budget.after = {
        at: '2020-01-01T00:00:00Z',
        prices: { monthly: '$3.99', yearly: '$30' },
      };
      page.tab('budget');
      const card = page.$$('section.card').find((s) => /^Subscription/.test(page.text(s)));
      assert.ok(card, 'the Subscription card');
      const t = page.text(card);
      assert.match(t, plan === 'monthly' ? /Plan\s*Monthly\s*Status/ : /Plan\s*Yearly\s*Status/);
      assert.doesNotMatch(t, /\$/, 'no price: an existing subscriber may still pay $1.99 / $20');
    } finally {
      await page.settle();
      await page.close();
    }
  }
  globalThis.fetch = was;
});
