// What this device has unlocked. A stub for now: the real version (billing) replaces this file.
import { isUnlocked, devEntitlement, isDevHost } from './billing.js';
import { getState } from './storage.js';

/** TipNet Budget (the staff add-on): the existing unlock check. */
export function budgetUnlocked() {
  return isUnlocked(getState().settings.entitlement);
}

/** TipNet Teams manager tools. For now only the localhost dev unlock (?unlock=dev) turns them on. */
export function teamsUnlocked() {
  const ent = getState().settings.entitlement;
  return !!devEntitlement() || (!!ent && ent.plan === 'dev' && isDevHost());
}
