// Tip pool math for managers. Pure (no DOM), all money in whole cents, so every column adds up to the pool exactly.
// Credit card (CC) tips and cash tips are split separately, with the same weights, by the largest-remainder method:
// everyone gets their share rounded down, then the cents left over go one each to the biggest fractions (a tie goes to
// the person higher in the list).
import { readMoney, parseHoursInput, hoursTypo, hasHoursText } from './inputs.js';
import { toCents } from './math.js';

export const METHODS = [
  ['hours', 'By hours'],
  ['points', 'By points × hours'],
  ['equal', 'Equal'],
  ['role', 'By role %'],
];
export const MAX_POOL_CENTS = 10000000; // $100,000 a night: more is a typo
export const MAX_MINUTES = 1440; // 24 hours
const roleKey = (r) =>
  String(r || '')
    .trim()
    .toLowerCase();

/**
 * Splits total (cents, a whole number >= 0) by weights (whole numbers >= 0), largest remainder, ties by position.
 * Returns the shares (they add up to total), or null when every weight is 0. A weight of 0 always gets 0.
 */
export function splitCents(total, weights) {
  const w = weights.map((x) => BigInt(x));
  const sum = w.reduce((a, b) => a + b, 0n);
  if (sum === 0n) return null;
  const T = BigInt(total);
  const base = w.map((x) => (T * x) / sum);
  const rem = w.map((x) => (T * x) % sum);
  let left = Number(T - base.reduce((a, b) => a + b, 0n));
  const order = Array.from(rem.keys())
    .filter((i) => rem[i] > 0n)
    .sort((a, b) => (rem[a] === rem[b] ? a - b : rem[a] > rem[b] ? -1 : 1));
  const out = base.map((x) => Number(x));
  for (let k = 0; k < left; k++) out[order[k]] += 1;
  return out;
}

/** Hours typed ("8", "7.5", "7:30", "45 min") as whole minutes: {minutes} or {error}. Blank is 0. */
export function minutesFromText(text) {
  if (!hasHoursText(text)) return { minutes: 0 };
  if (hoursTypo(text)) return { error: 'That isn’t a number of hours. Use something like 7.5 or 7:30.' };
  const h = parseHoursInput(text);
  if (h < 0) return { error: 'Hours can’t be below 0.' };
  const minutes = Math.round(h * 60);
  return minutes > MAX_MINUTES ? { error: 'That is more than 24 hours.' } : { minutes };
}
/** A money box as cents: {cents} or {error}. Blank is 0. */
export function centsFromText(text) {
  const n = readMoney(text);
  if (n === null) return { cents: 0 };
  if (Number.isNaN(n))
    return { error: 'That isn’t an amount. Use numbers and one decimal point, like 12.50.' };
  if (n < 0) return { error: 'An amount can’t be below $0.' };
  const cents = toCents(n);
  return cents > MAX_POOL_CENTS ? { error: 'That is more than $100,000. Check the amount.' } : { cents };
}
/** A number with up to 2 decimals as hundredths ("1.5" = 150): {hundredths} or {error}. Blank is 0. max in whole units. */
export function hundredthsFromText(text, max, { percent = false } = {}) {
  const n = readMoney(text, { percent });
  if (n === null) return { hundredths: 0 };
  if (Number.isNaN(n)) return { error: 'That isn’t a number. Use something like 1.5.' };
  if (n < 0) return { error: 'It can’t be below 0.' };
  if (n > max) return { error: 'It can’t be more than ' + max + '.' };
  return { hundredths: Math.round(n * 100) };
}

/**
 * Works out a night's tip pool.
 *   input: {method, cc, cash (cents), rows: [{name, role, minutes, points (hundredths)}], shares: {<role, lower case>: hundredths of a
 *   percent}} (shares only for 'role').
 * Returns {ok: true, rows: [{name, role, minutes, cc, cash, total}], totals: {minutes, cc, cash, total}} or {ok: false, error}.
 * The CC column and the cash column each add up to exactly the pool.
 */
export function computePool({ method, cc, cash, rows, shares = {} }) {
  const fail = (error) => ({ ok: false, error });
  if (!rows.length) return fail('Add at least one person.');
  const mins = rows.map((r) => r.minutes);
  let weights;
  let ccShare;
  let cashShare;
  if (method === 'hours') weights = mins;
  else if (method === 'points') weights = rows.map((r) => r.minutes * r.points);
  else if (method === 'equal') weights = mins.map((m) => (m > 0 ? 1 : 0));
  else if (method === 'role') weights = null;
  else return fail('Pick how to split.');
  if (weights) {
    ccShare = splitCents(cc, weights);
    cashShare = splitCents(cash, weights);
    if (!ccShare)
      return fail(
        method === 'points'
          ? 'Everyone’s hours × points come to 0, so there is nothing to split by. Check the hours and points.'
          : 'Nobody has any hours yet, so there is nothing to split by. Add the hours worked.',
      );
  } else {
    // By role %: the roles' shares must total 100%; each role's share is then split by hours within the role.
    const roles = [];
    rows.forEach((r) => {
      if (!roleKey(r.role)) return;
      if (!roles.includes(roleKey(r.role))) roles.push(roleKey(r.role));
    });
    const blank = rows.find((r) => !roleKey(r.role));
    if (blank) return fail('Give ' + blank.name + ' a role, or pick another way to split.');
    const pcts = roles.map((k) => shares[k] || 0);
    if (pcts.reduce((a, b) => a + b, 0) !== 10000) return fail('The role shares have to add up to 100%.');
    const byRole = roles.map((k) => rows.map((r) => (roleKey(r.role) === k ? r.minutes : 0)));
    const empty = roles.findIndex((k, i) => pcts[i] > 0 && byRole[i].every((m) => m === 0));
    if (empty >= 0) {
      const name = rows.find((r) => roleKey(r.role) === roles[empty]).role.trim();
      return fail(
        'Nobody worked any hours as ' + name + ', but it has a share. Add hours or change its share.',
      );
    }
    const spread = (total) => {
      const perRole = splitCents(total, pcts);
      const out = rows.map(() => 0);
      roles.forEach((k, i) => {
        if (!perRole[i]) return;
        const part = splitCents(perRole[i], byRole[i]);
        part.forEach((c, j) => (out[j] += c));
      });
      return out;
    };
    ccShare = spread(cc);
    cashShare = spread(cash);
  }
  const out = rows.map((r, i) => ({
    name: r.name,
    role: r.role || '',
    minutes: r.minutes,
    cc: ccShare[i],
    cash: cashShare[i],
    total: ccShare[i] + cashShare[i],
  }));
  const sum = (f) => out.reduce((a, r) => a + r[f], 0);
  const totals = { minutes: sum('minutes'), cc: sum('cc'), cash: sum('cash'), total: sum('total') };
  // The one rule of this screen: what is shown adds up to the pool.
  if (totals.cc !== cc || totals.cash !== cash)
    return fail('Those numbers could not be split exactly. Check them.');
  return { ok: true, rows: out, totals };
}

/** Hours as the app writes them: 450 minutes = "7:30", 480 = "8:00". */
export const hoursLabel = (minutes) => Math.floor(minutes / 60) + ':' + String(minutes % 60).padStart(2, '0');
