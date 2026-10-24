// TipNet Teams, staff side: what happens when someone opens (or pastes) a venue link or a tip sheet link.
// The link was read and taken out of the address by codec.takeFragment (app.js); here it is shown first, and nothing is
// changed or saved until the person taps a button.
import { addDays } from '../math.js';
import { businessDate, cutoffFromSettings, dateProblem } from '../inputs.js';
import { decodeVenue, BAD_LINK_MSG } from '../venue.js';
import { decodeSheet, BAD_SHEET_MSG, METHOD_TEXT } from '../sheet.js';
import { hoursLabel } from '../pool.js';
import {
  isSetUp,
  isWorkplaceSetUp,
  canAddWorkplace,
  findWorkplace,
  activeWorkplace,
  FIRST_WORKPLACE_NAME,
} from '../storage.js';
import { isUnlocked } from '../billing.js';
import { el, clear, toast, arm, bus, getState, money, fmtDate } from './common.js';
import { startVenueSetup, addVenueEstablishment, updateFromVenue, limitLine, joinBlocked } from './setup.js';
import { openSheetNight, tipoutHow } from './tonight.js';

/** What was opened and is waiting for an answer: {kind: 'join', venue} | {kind: 'sheet', sheet} | {kind: 'bad', message}. */
let pending = null;
/** The tip sheet screen's picks: {row: index of the person's name, wp: establishment id}. */
let sel = { row: null, wp: null };
export const pendingLink = () => pending;
export function reset() {
  pending = null;
  sel = { row: null, wp: null };
}

/** A link was opened: kind 'join' or 'sheet', data the code after the "=". Anything that does not read says so and changes nothing. */
export function openFragment({ kind, data }) {
  sel = { row: null, wp: null };
  if (kind === 'join') {
    const venue = decodeVenue(data);
    pending = venue ? { kind: 'join', venue } : { kind: 'bad', message: BAD_LINK_MSG };
  } else {
    const sheet = decodeSheet(data);
    pending = sheet ? { kind: 'sheet', sheet } : { kind: 'bad', message: BAD_SHEET_MSG };
  }
}
/** Something pasted in Setup that already read as a venue (see setup.js joinCard). */
export function openParsed(p) {
  sel = { row: null, wp: null };
  pending = p;
}
const close = () => {
  pending = null;
  bus.rerender();
};

const FREQ_TEXT = {
  7: 'Every week',
  14: 'Every two weeks',
  15: 'Every 15 days',
  30: 'Every 30 days',
  semimonthly: 'Twice a month',
  monthly: 'Once a month',
};
const row = (a, b) =>
  el(
    'div',
    { class: 'spread', style: 'align-items:flex-start' },
    el('strong', null, a),
    el('span', { style: 'text-align:right' }, b),
  );

/** The venue as the worker sees it before saying yes: schedule, payday, jobs and tip-outs. */
export function venuePreview(v) {
  const rate = (j) => money(j.rate / 100) + (j.unit === 'hr' ? ' an hour' : ' a shift');
  return el(
    'section',
    { class: 'card stack', id: 'join-preview', 'aria-label': 'What ' + v.name + ' shared' },
    el('h2', null, 'What ' + v.name + ' shared'),
    el(
      'div',
      { class: 'stack-sm' },
      row('You get paid', FREQ_TEXT[v.freq]),
      row('Pay period', fmtDate(v.start) + ' to ' + fmtDate(v.end)),
      row('Payday', fmtDate(addDays(v.end, v.delay))),
    ),
    el('p', { class: 'label' }, 'Jobs'),
    el(
      'div',
      { class: 'stack-sm' },
      v.jobs.map((j) => row(j.name, rate(j))),
    ),
    el('p', { class: 'label' }, 'You tip out'),
    v.tipouts.length
      ? el(
          'div',
          { class: 'stack-sm' },
          v.tipouts.map((t) =>
            row(
              t.who,
              tipoutHow({ mode: t.mode, value: t.value / 100 }) +
                (t.from === 'payroll' ? ', through payroll' : ', from cash'),
            ),
          ),
        )
      : el('p', { class: 'note' }, 'Nobody. This venue has no tip-outs.'),
  );
}

/**
 * Which establishment "Set up with these" fills in, in words. One still named by default (My establishment,
 * Establishment 2...) takes the venue's name; one the person named keeps its name and gets the venue's numbers.
 */
function venueTarget(S, v) {
  const w = activeWorkplace(S);
  if (!w || w.name === FIRST_WORKPLACE_NAME || /^Establishment [0-9]+$/.test(w.name))
    return 'TipNet sets up ' + v.name + ' with these.';
  return 'TipNet fills these in for ' + w.name + ', which isn’t set up yet.';
}

/** Sets up from the venue, in the way that fits what is on this device. */
function joinScreen(root, v) {
  const S = getState();
  const unlocked = isUnlocked(S.settings.entitlement);
  const same = S.workplaces.find((w) => w.venue && w.venue.id === v.id);
  const blocked = el('p', { class: 'field-error', role: 'alert', hidden: true });
  // A change typed in Setup and not saved yet would be lost when Setup is redrawn: ask for Save or Discard first.
  const guard = (fn) => () => {
    if (joinBlocked()) {
      blocked.textContent =
        'You have changes in Setup that aren’t saved. Save or discard them first, then come back.';
      blocked.hidden = false;
      return;
    }
    fn();
  };
  const notNow = el('button', { type: 'button', class: 'btn-link', id: 'join-not-now' }, 'Not now');
  notNow.addEventListener('click', () => {
    toast('Nothing was changed.');
    close();
  });
  let body;
  if (!isSetUp(S)) {
    // no setup yet: the guided setup starts with the venue's numbers in
    const go = el('button', { type: 'button', class: 'btn', id: 'join-start' }, 'Set up with these');
    go.addEventListener(
      'click',
      guard(() => {
        startVenueSetup(S, v);
        pending = null;
        bus.go('setup');
      }),
    );
    body = [
      el(
        'p',
        { class: 'note' },
        venueTarget(S, v) +
          ' You still add your own gross pay, deductions and shifts from your paystub, and you can change anything.',
      ),
      el('div', { class: 'cluster' }, go),
    ];
  } else if (same) {
    const note = el(
      'p',
      { class: 'note' },
      'You already set up ' +
        same.name +
        ' from ' +
        same.venue.name +
        '. This replaces its jobs and tip-outs with the ones above. Your pay schedule, paystub numbers and other pay stay, and pay periods that have ended keep the pay they were saved with.',
    );
    const up = el('button', { type: 'button', class: 'btn', id: 'join-update' });
    arm(up, {
      label: 'Update jobs and tip-outs from ' + v.name,
      armedLabel: 'Tap again to update ' + same.name,
      before: () => {
        if (!joinBlocked()) return true;
        guard(() => {})();
        return false;
      },
      onConfirm: () => {
        updateFromVenue(S, same, v);
        pending = null;
        bus.go('setup');
        toast('Updated ' + same.name + ' from ' + v.name + '.');
      },
    });
    body = [note, el('div', { class: 'cluster' }, up)];
  } else {
    const room = canAddWorkplace(S, unlocked);
    const add = el(
      'button',
      {
        type: 'button',
        class: 'btn',
        id: 'join-add',
        disabled: !room,
        'aria-describedby': room ? null : 'wp-limit',
      },
      'Add as a new establishment',
    );
    add.addEventListener(
      'click',
      guard(() => {
        if (!addVenueEstablishment(S, v)) return bus.rerender();
        pending = null;
        bus.go('setup');
      }),
    );
    body = [
      el(
        'p',
        { class: 'note' },
        'This adds ' +
          v.name +
          ' next to what you already have. Its own guided setup starts with these numbers filled in; your other establishments aren’t touched.',
      ),
      el('div', { class: 'cluster' }, add),
      room ? null : el('p', { class: 'hint', id: 'wp-limit' }, limitLine(unlocked)),
    ];
  }
  root.append(
    el(
      'div',
      { class: 'stack', id: 'join-screen' },
      el('h1', { tabindex: '-1', id: 'join-h1' }, 'Join ' + v.name),
      el('p', { class: 'note' }, 'Your manager shared this. It has no pay or personal information in it.'),
      venuePreview(v),
      body,
      blocked,
      el('div', null, notNow),
    ),
  );
}

/** One person's line of a sheet, for the pick list: "Sam · 7:30". */
const rowLabel = (r) => r.name + ' · ' + hoursLabel(r.minutes);

/** A tip sheet: the worker picks their name (and the establishment when it is not clear), then Tonight opens with their numbers. */
function sheetScreen(root, sheet) {
  const S = getState();
  const head = [el('h1', { tabindex: '-1', id: 'sheet-h1' }, 'Tip sheet for ' + sheet.venue.name)];
  const notNow = el('button', { type: 'button', class: 'btn-link', id: 'sheet-not-now' }, 'Not now');
  notNow.addEventListener('click', () => {
    toast('Nothing was saved.');
    close();
  });
  if (!isSetUp(S)) {
    const go = el('button', { type: 'button', class: 'btn', id: 'sheet-setup' }, 'Set up now');
    go.addEventListener('click', () => {
      pending = null;
      bus.startSetup();
    });
    root.append(
      el(
        'div',
        { class: 'stack', id: 'sheet-screen' },
        head,
        el(
          'section',
          { class: 'card stack' },
          el(
            'p',
            { class: 'note' },
            'Set up TipNet first (about 3 minutes), then open this tip sheet link again. Nothing was saved.',
          ),
          el('div', { class: 'cluster' }, go),
        ),
        el('div', null, notNow),
      ),
    );
    return;
  }
  const ready = S.workplaces.filter((w) => isWorkplaceSetUp(S, w));
  const matches = ready.filter((w) => w.venue && w.venue.id === sheet.venue.id);
  const options = matches.length ? matches : ready;
  if (options.length === 1) sel.wp = options[0].id;
  if (sel.wp && !options.some((w) => w.id === sel.wp)) sel.wp = null;
  const today = businessDate(new Date(), cutoffFromSettings(S.settings));
  const dateBad = dateProblem(sheet.date, today);
  const chosen = sel.row == null ? null : sheet.rows[sel.row];
  const radio = (labelText, items, current, onPick, key) => {
    const group = el('div', { class: 'wp-switch', role: 'radiogroup', 'aria-label': labelText });
    items.forEach(([id, text]) => {
      const on = id === current;
      const b = el(
        'button',
        { type: 'button', role: 'radio', 'aria-checked': String(on), 'data-focus-key': key + '-' + id },
        text,
      );
      b.addEventListener('click', () => {
        onPick(id);
        bus.rerender();
      });
      group.append(b);
    });
    return group;
  };
  const open = el(
    'button',
    { type: 'button', class: 'btn', id: 'sheet-open', disabled: !chosen || !sel.wp || !!dateBad },
    'Open Tonight with my numbers',
  );
  open.addEventListener('click', () => {
    const w = findWorkplace(S, sel.wp);
    const r = sheet.rows[sel.row];
    if (!w || !r) return;
    openSheetNight(S, w, {
      date: sheet.date,
      cc: r.cc,
      cash: r.cash,
      minutes: r.minutes,
      note:
        'From the tip sheet for ' +
        sheet.venue.name +
        ', ' +
        fmtDate(sheet.date) +
        '. Tip-outs are unticked: the pool was already split.',
    });
    pending = null;
    bus.go('tonight');
  });
  root.append(
    el(
      'div',
      { class: 'stack', id: 'sheet-screen' },
      head,
      el(
        'p',
        { class: 'note' },
        fmtDate(sheet.date) +
          ', split ' +
          METHOD_TEXT[sheet.method] +
          '. Pick your name to log your share on Tonight.',
      ),
      dateBad
        ? el(
            'p',
            { class: 'field-error', role: 'alert' },
            'This sheet’s date is outside the dates TipNet accepts. ' + dateBad,
          )
        : null,
      el(
        'section',
        { class: 'card stack' },
        el('p', { class: 'label', id: 'sheet-name-label' }, 'Which one is you?'),
        radio(
          'Your name',
          sheet.rows.map((r, i) => [i, rowLabel(r)]),
          sel.row,
          (i) => (sel.row = i),
          'sheet-name',
        ),
        chosen
          ? el(
              'p',
              { class: 'note', id: 'sheet-yours' },
              'Your share: ' +
                money(chosen.cc / 100) +
                ' credit card tips, ' +
                money(chosen.cash / 100) +
                ' cash tips, ' +
                hoursLabel(chosen.minutes) +
                ' hours.',
            )
          : null,
        options.length > 1
          ? el(
              'div',
              { class: 'stack-sm' },
              el('p', { class: 'label' }, 'Which establishment is this for?'),
              radio(
                'Establishment',
                options.map((w) => [w.id, w.name]),
                sel.wp,
                (id) => (sel.wp = id),
                'sheet-wp',
              ),
            )
          : null,
        el('div', { class: 'cluster' }, open),
        el(
          'p',
          { class: 'hint' },
          'You look it over on Tonight first. Nothing is saved until you tap Save night.',
        ),
      ),
      el('div', null, notNow),
    ),
  );
}

/** The screen for what was opened (app.js draws it in place of the tab while something is waiting). */
export function render(root) {
  const p = pending;
  clear(root);
  if (p.kind === 'join') return joinScreen(root, p.venue);
  if (p.kind === 'sheet') return sheetScreen(root, p.sheet);
  const ok = el('button', { type: 'button', class: 'btn', id: 'link-bad-ok' }, 'OK');
  ok.addEventListener('click', close);
  root.append(
    el(
      'div',
      { class: 'stack', id: 'link-bad' },
      el('h1', { tabindex: '-1' }, 'TipNet Teams link'),
      el(
        'section',
        { class: 'card stack' },
        el('p', { class: 'note', role: 'alert' }, p.message),
        el('div', { class: 'cluster' }, ok),
      ),
    ),
  );
}
