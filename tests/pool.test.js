// Tip pool math: every method, exact sums (largest remainder), ties, zero hours, role % errors.
import test from 'node:test';
import assert from 'node:assert/strict';
import { splitCents, computePool, minutesFromText, centsFromText, hundredthsFromText, hoursLabel } from '../app/js/pool.js';

const row = (name, minutes, o = {}) => ({ name, role: '', minutes, points: 100, ...o });
const col = (res, f) => res.rows.map((r) => r[f]);
const sum = (a) => a.reduce((x, y) => x + y, 0);

test('splitCents: always adds up, zero weight gets zero, ties go to the earlier row', () => {
  assert.deepEqual(splitCents(100, [1, 1, 1]), [34, 33, 33], 'equal fractions: the first gets the spare cent');
  assert.deepEqual(splitCents(1, [1, 1, 1]), [1, 0, 0]);
  assert.deepEqual(splitCents(2, [1, 1, 1]), [1, 1, 0]);
  assert.deepEqual(splitCents(0, [3, 4]), [0, 0]);
  assert.deepEqual(splitCents(1000, [0, 5, 0, 5]), [0, 500, 0, 500]);
  assert.deepEqual(splitCents(100, [0, 0]), null, 'all weights 0');
  assert.deepEqual(splitCents(5, [60, 120]), [2, 3], 'the bigger fraction gets the spare cent');
  // random-ish stress: the sum is exact and nobody is off by more than a cent from the exact share
  let seed = 12345;
  const rnd = (n) => ((seed = (seed * 1103515245 + 12345) % 2147483648), seed % n);
  for (let k = 0; k < 400; k++) {
    const w = Array.from({ length: 1 + rnd(12) }, () => rnd(5) * rnd(1441) * rnd(500));
    const total = rnd(5000000);
    const out = splitCents(total, w);
    if (!sum(w)) {
      assert.equal(out, null);
      continue;
    }
    assert.equal(sum(out), total);
    out.forEach((c, i) => {
      assert.ok(c >= 0);
      if (!w[i]) assert.equal(c, 0);
      assert.ok(Math.abs(c - (total * w[i]) / sum(w)) < 1, 'within a cent of the exact share');
    });
  }
  // big numbers stay exact (BigInt inside)
  const big = splitCents(10000000, [1440 * 100000, 1440 * 99999, 1]);
  assert.equal(sum(big), 10000000);
});

test('by hours: CC and cash are split separately with the same weights, each column adds up to its pool', () => {
  const r = computePool({
    method: 'hours',
    cc: 100001,
    cash: 5001,
    rows: [row('A', 480), row('B', 450), row('C', 300)],
  });
  assert.equal(r.ok, true);
  assert.equal(sum(col(r, 'cc')), 100001);
  assert.equal(sum(col(r, 'cash')), 5001);
  assert.equal(r.totals.cc, 100001);
  assert.equal(r.totals.cash, 5001);
  assert.equal(r.totals.total, 105002);
  assert.equal(r.totals.minutes, 1230);
  r.rows.forEach((x) => assert.equal(x.total, x.cc + x.cash));
  // exact shares of 100001: 39024.39, 36585.37 and 24390.24; the two spare cents go to the two biggest fractions
  assert.deepEqual(col(r, 'cc'), [39025, 36586, 24390]);
});

test('zero hours is a zero share, in every method', () => {
  for (const method of ['hours', 'points', 'equal']) {
    const r = computePool({ method, cc: 1000, cash: 333, rows: [row('A', 60), row('Off', 0), row('B', 60)] });
    assert.equal(r.ok, true, method);
    assert.equal(r.rows[1].total, 0, method);
    assert.equal(sum(col(r, 'cc')), 1000);
    assert.equal(sum(col(r, 'cash')), 333);
  }
});

test('by points × hours: weight is minutes times points; points 0 is a zero share', () => {
  const r = computePool({
    method: 'points',
    cc: 1000,
    cash: 0,
    rows: [row('Bar', 60, { points: 200 }), row('Runner', 60, { points: 100 }), row('Host', 60, { points: 0 })],
  });
  assert.deepEqual(col(r, 'cc'), [667, 333, 0]);
  assert.deepEqual(col(r, 'cash'), [0, 0, 0]);
  const half = computePool({ method: 'points', cc: 900, cash: 0, rows: [row('A', 60, { points: 150 }), row('B', 60, { points: 150 })] });
  assert.deepEqual(col(half, 'cc'), [450, 450]);
});

test('equal: everyone who worked gets the same; ties go in list order', () => {
  const r = computePool({ method: 'equal', cc: 1000, cash: 1, rows: [row('A', 30), row('B', 600), row('C', 5)] });
  assert.deepEqual(col(r, 'cc'), [334, 333, 333]);
  assert.deepEqual(col(r, 'cash'), [1, 0, 0]);
});

test('by role %: shares must be 100, then by hours inside each role, exact sums', () => {
  const rows = [
    row('Ann', 480, { role: 'Bartender' }),
    row('Bo', 240, { role: 'bartender ' }),
    row('Cy', 360, { role: 'Server' }),
    row('Di', 360, { role: 'Server' }),
    row('Ed', 120, { role: 'Runner' }),
  ];
  const shares = { bartender: 5000, server: 4000, runner: 1000 };
  const r = computePool({ method: 'role', cc: 100001, cash: 7777, rows, shares });
  assert.equal(r.ok, true, r.error);
  assert.equal(sum(col(r, 'cc')), 100001);
  assert.equal(sum(col(r, 'cash')), 7777);
  // runner: 10% of 100001 = 10000.1 -> the role gets 10000 (largest remainder across roles), Ed gets it all
  const roleTotal = (role) => sum(r.rows.filter((x) => x.role.trim().toLowerCase() === role).map((x) => x.cc));
  assert.equal(roleTotal('bartender') + roleTotal('server') + roleTotal('runner'), 100001);
  assert.ok(Math.abs(roleTotal('bartender') - 50000.5) <= 1);
  assert.ok(Math.abs(roleTotal('server') - 40000.4) <= 1);
  assert.equal(r.rows[2].cc - r.rows[3].cc, 0, 'same role, same hours, same share');
  assert.ok(r.rows[0].cc > r.rows[1].cc, 'more hours in the role, more tips');
});

test('by role %: errors say what is wrong', () => {
  const rows = [row('Ann', 60, { role: 'Bar' }), row('Cy', 60, { role: 'Server' })];
  const not100 = computePool({ method: 'role', cc: 100, cash: 0, rows, shares: { bar: 5000, server: 4000 } });
  assert.equal(not100.ok, false);
  assert.match(not100.error, /add up to 100%/);
  const over = computePool({ method: 'role', cc: 100, cash: 0, rows, shares: { bar: 6000, server: 5000 } });
  assert.match(over.error, /100%/);
  const none = computePool({ method: 'role', cc: 100, cash: 0, rows, shares: {} });
  assert.match(none.error, /100%/);
  const blank = computePool({ method: 'role', cc: 100, cash: 0, rows: [row('Ann', 60), rows[1]], shares: { server: 10000 } });
  assert.match(blank.error, /Give Ann a role/);
  const empty = computePool({
    method: 'role',
    cc: 100,
    cash: 0,
    rows: [row('Ann', 0, { role: 'Bar' }), rows[1]],
    shares: { bar: 5000, server: 5000 },
  });
  assert.match(empty.error, /Nobody worked any hours as Bar/);
  // a role with 0% and hours is fine: those people get nothing
  const zero = computePool({
    method: 'role',
    cc: 100,
    cash: 50,
    rows: [row('Ann', 60, { role: 'Bar' }), rows[1]],
    shares: { bar: 0, server: 10000 },
  });
  assert.equal(zero.ok, true);
  assert.deepEqual(col(zero, 'total'), [0, 150]);
});

test('errors: nobody, every weight 0, no method', () => {
  assert.match(computePool({ method: 'hours', cc: 1, cash: 0, rows: [] }).error, /at least one person/);
  assert.match(computePool({ method: 'hours', cc: 1, cash: 0, rows: [row('A', 0), row('B', 0)] }).error, /Nobody has any hours/);
  assert.match(computePool({ method: 'equal', cc: 1, cash: 0, rows: [row('A', 0)] }).error, /Nobody has any hours/);
  assert.match(
    computePool({ method: 'points', cc: 1, cash: 0, rows: [row('A', 60, { points: 0 })] }).error,
    /hours × points come to 0/,
  );
  assert.match(computePool({ method: 'nope', cc: 1, cash: 0, rows: [row('A', 60)] }).error, /Pick how to split/);
});

test('both pools 0 is fine: everyone gets $0', () => {
  const r = computePool({ method: 'hours', cc: 0, cash: 0, rows: [row('A', 60), row('B', 60)] });
  assert.equal(r.ok, true);
  assert.deepEqual(col(r, 'total'), [0, 0]);
});

test('a person with only a cash pool or only a CC pool still gets exact sums', () => {
  const r = computePool({ method: 'hours', cc: 0, cash: 10001, rows: [row('A', 100), row('B', 200), row('C', 300)] });
  assert.equal(sum(col(r, 'cash')), 10001);
  assert.deepEqual(col(r, 'cc'), [0, 0, 0]);
});

test('typed boxes: hours, money, points', () => {
  assert.deepEqual(minutesFromText('8'), { minutes: 480 });
  assert.deepEqual(minutesFromText('7.5'), { minutes: 450 });
  assert.deepEqual(minutesFromText('7:30'), { minutes: 450 });
  assert.deepEqual(minutesFromText('45 min'), { minutes: 45 });
  assert.deepEqual(minutesFromText(''), { minutes: 0 });
  assert.ok(minutesFromText('abc').error);
  assert.ok(minutesFromText('-2').error);
  assert.ok(minutesFromText('25').error);
  assert.deepEqual(centsFromText('$1,234.56'), { cents: 123456 });
  assert.deepEqual(centsFromText('0.29'), { cents: 29 });
  assert.deepEqual(centsFromText(''), { cents: 0 });
  assert.ok(centsFromText('1.2.3').error);
  assert.ok(centsFromText('-5').error);
  assert.ok(centsFromText('999999999').error);
  assert.deepEqual(hundredthsFromText('1.5', 1000), { hundredths: 150 });
  assert.deepEqual(hundredthsFromText('60%', 100, { percent: true }), { hundredths: 6000 });
  assert.ok(hundredthsFromText('x', 100).error);
  assert.ok(hundredthsFromText('101', 100).error);
  assert.equal(hoursLabel(450), '7:30');
  assert.equal(hoursLabel(480), '8:00');
  assert.equal(hoursLabel(5), '0:05');
});
