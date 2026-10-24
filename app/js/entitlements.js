// What this device has unlocked. Two answers, both plain yes or no and both read from the license state stored on this
// device (state.settings.entitlement for TipNet Budget, state.settings.teamsEntitlement for TipNet Teams), so screens can
// ask while they draw. Nothing here talks to the network: billing.js does that (activate, daily recheck, 14-day grace).
// On localhost, ?unlock=dev unlocks both, the way the developer unlock always did for Budget.
import { getState } from './storage.js';
import { isUnlocked, devEntitlement } from './billing.js';

function unlockedFor(product, slot) {
  try {
    if (devEntitlement()) return true; // localhost with ?unlock=dev
    const s = getState();
    return isUnlocked(s && s.settings ? s.settings[slot] : null, Date.now(), { product });
  } catch (e) {
    return false; // never throws: a screen that cannot tell shows the locked view
  }
}

/** TipNet Budget (for staff): the Budget tab and up to 5 establishments. */
export const budgetUnlocked = () => unlockedFor('budget', 'entitlement');

/** TipNet Teams (for venues): the manager tools. */
export const teamsUnlocked = () => unlockedFor('teams', 'teamsEntitlement');
