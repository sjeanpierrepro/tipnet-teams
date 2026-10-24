// Shared bits for the TipNet Teams UI tests (not a test file itself).
import { addDays, todayISO } from '../../app/js/math.js';
import { encodeVenue } from '../../app/js/venue.js';
import { encodeSheet } from '../../app/js/sheet.js';

export const VID = 'VenueId012345';
export const DEV = 'http://localhost/?unlock=dev';

/** A venue (readable form) whose pay period is the one before today's, so the dates are always fine. */
export function venue(over = {}) {
  const start = addDays(todayISO(), -10);
  return {
    id: VID,
    name: 'The Corner Bar',
    freq: 14,
    start,
    end: addDays(start, 13),
    delay: 5,
    jobs: [
      { k: 'bartender', name: 'Bartender', rate: 1200, unit: 'hr' },
      { k: 'otherjob', name: 'Door', rate: 1500, unit: 'shift' },
    ],
    tipouts: [
      { k: 'barback', who: 'Barback', mode: 'pctTips', value: 1500, from: 'cash' },
      { k: 'host', who: 'Host', mode: 'flat', value: 2000, from: 'payroll' },
    ],
    ...over,
  };
}
export const joinUrl = (v = venue()) => 'http://localhost/#join=' + encodeVenue(v);

/** A tip sheet dated yesterday (always inside the dates Tonight accepts). */
export function sheet(over = {}) {
  return {
    venue: { id: VID, name: 'The Corner Bar' },
    date: addDays(todayISO(), -1),
    method: 'hours',
    rows: [
      { name: 'Sam', minutes: 450, cc: 12345, cash: 2050 },
      { name: 'Alex', minutes: 300, cc: 8000, cash: 1000 },
    ],
    ...over,
  };
}
export const sheetUrl = (s = sheet()) => 'http://localhost/#sheet=' + encodeSheet(s);

/** Fill a text box the way typing does. */
export const fill = (page, sel, value) => page.type(page.must(page.$(sel), sel), value);

/** Wait for a typing pause to pass (the harness's timers don't keep Node alive, so a ref'ed interval does). */
export const pause = (ms = 420) =>
  new Promise((resolve) => {
    const keep = setInterval(() => {}, 20);
    setTimeout(() => {
      clearInterval(keep);
      resolve();
    }, ms);
  });
