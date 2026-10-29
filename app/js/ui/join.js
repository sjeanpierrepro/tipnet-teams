// TipNet Teams, staff side: what happens when someone opens (or pastes) a venue link or a tip sheet link.
// The link was read and taken out of the address by codec.takeFragment (app.js); here it is shown first, and nothing is
// changed or saved until the person taps a button.
import { addDays } from '../math.js';
import { businessDate, cutoffFromSettings, dateProblem } from '../inputs.js';
import { decodeVenue, venueLink, BAD_LINK_MSG, FREQ_TEXT, payTypeName } from '../venue.js';
import { decodeSheet, sheetLink, BAD_SHEET_MSG, METHOD_TEXT } from '../sheet.js';
import { isIosSafariTab, installStepKind } from './install.js';
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
import { el, clear, field, select, moneyInput, toast, bus, getState, money, fmtDate } from './common.js';
import { readMoney, moneyTypo } from '../inputs.js';
import {
  startVenueSetup,
  addVenueEstablishment,
  updateFromVenue,
  venueUpdatePlan,
  venueRemoveOutcome,
  venueJobChoices,
  limitLine,
  joinBlocked,
} from './setup.js';
import { openSheetNight, tipoutHow } from './tonight.js';

/** What was opened and is waiting for an answer: {kind: 'join', venue} | {kind: 'sheet', sheet} | {kind: 'bad', message}. */
let pending = null;
/* ---------- "Update from <venue>": a preview the worker confirms ---------- */
/** The worker's picks in the update preview (see venue.js planVenueUpdate); cleared whenever another link is opened. */
let rev = { match: [], useVenue: [], newRate: [], remove: [] };
const resetRev = () => {
  rev = { match: [], useVenue: [], newRate: [], remove: [] };
};
const rateText = (dollars, unit) => money(dollars) + (unit === 'shift' ? '/shift' : '/h');
const payLabel = (t) => payTypeName(t);

/** A small group of choices as buttons (role radio), one picked. Same look as the tip sheet's name list. */
function radioGroup(labelText, items, current, onPick, key) {
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
}

/**
 * What "Update from <venue>" would change at establishment w, in words, with the worker's choices. Nothing changes until
 * the one "Apply these changes" button. A venue job is matched to the worker's own job (by the venue's id, then by name),
 * and the worker can fix a wrong match; a matched job keeps the worker's name and rate unless they choose the venue's rate.
 */
function updatePanel(S, w, v, isBlocked) {
  const plan = venueUpdatePlan(w, v, { ...rev });
  // what Apply really does to the jobs the worker removes (from the same steps Apply takes), so the words match it
  const outcome = venueRemoveOutcome(S, w, v, { ...rev });
  const mine = venueJobChoices(w);
  const replacedNotes = []; // {i, note, t}: lines that name the new job's rate, kept in step with its rate box
  const venueName = v.name;
  const kids = [];
  kids.push(
    el(
      'p',
      { class: 'note', id: 'join-update-note' },
      (w.name === w.venue.name
        ? 'You already joined ' + w.name
        : 'You already set up ' + w.name + ' from ' + w.venue.name) +
        '. Here is what would change. Nothing changes until you tap Apply these changes. Your pay schedule, paystub numbers and other pay stay, and pay periods that have ended keep the pay they were saved with.',
    ),
  );
  // the venue's jobs
  const rateBoxes = [];
  plan.jobs.forEach((j, i) => {
    const m = j.mine;
    const pick = select([...mine.map((t) => [t.id, payLabel(t)]), ['new', 'New job']], j.matchId || 'new', {
      id: 'upd-match-' + i,
    });
    pick.addEventListener('change', () => {
      const val = pick.value;
      // a job of mine can be the match for one venue job only: the other one becomes a new job
      plan.jobs.forEach((o) => {
        if (o.index !== i && val !== 'new' && o.matchId === val) rev.match[o.index] = 'new';
      });
      rev.match[i] = val;
      delete rev.useVenue[i];
      bus.rerender();
    });
    const block = [
      el('p', { class: 'label' }, j.vjob.name + ' · ' + rateText(j.vjob.rate / 100, j.vjob.unit)),
      field('Same as my job', pick),
    ];
    if (m) {
      block.push(
        el(
          'p',
          { class: 'note', id: 'upd-keeps-' + i },
          'Stays “' +
            payLabel(m) +
            (j.useVenue
              ? '”, at ' + venueName + '’s rate (' + rateText(j.vjob.rate / 100, j.vjob.unit) + ')'
              : '” at your rate') +
            (j.link ? ', linked to ' + venueName + '’s job' : '') +
            '.',
        ),
      );
      if (j.differs) {
        block.push(
          el(
            'p',
            { class: 'note', id: 'upd-rates-' + i },
            venueName +
              ': ' +
              rateText(j.vjob.rate / 100, j.vjob.unit) +
              ' · yours: ' +
              rateText(Number(m.rate) || 0, m.unit),
          ),
          radioGroup(
            'Rate for ' + payLabel(m),
            [
              ['mine', 'Keep mine'],
              ['venue', 'Use ' + venueName + '’s'],
            ],
            j.useVenue ? 'venue' : 'mine',
            (val) => (rev.useVenue[i] = val === 'venue'),
            'upd-rate-' + i,
          ),
        );
      }
    } else {
      const rt = moneyInput({
        id: 'upd-new-' + i,
        value: String(rev.newRate[i] !== undefined ? rev.newRate[i] : j.newRate),
      });
      const fr = field(
        'Your rate for ' + j.vjob.name + (j.vjob.unit === 'shift' ? ' ($ per shift)' : ' ($ per hour)'),
        rt,
      );
      rt.addEventListener('input', () => {
        rev.newRate[i] = rt.value;
        replacedNotes.forEach((r) => r.i === i && (r.note.textContent = replacedText(r.t, i)));
      });
      rateBoxes.push({ rt, fr, i, j });
      const into = outcome.mergedInto[i];
      const old = into !== undefined ? mine.find((t) => t.id === into) : null;
      block.push(
        el(
          'p',
          { class: 'note', id: 'upd-new-note-' + i },
          old
            ? 'Takes the place of your ' + payLabel(old) + ' (see below). You can change its rate.'
            : 'New job: added to your list. You can change its rate.',
        ),
        fr,
      );
    }
    kids.push(el('section', { class: 'card stack', id: 'upd-job-' + i }, block));
  });
  // a removed job that a saved night used and a new venue job is the same job: it carries on as that job
  const rateOf = (i) => {
    const box = rateBoxes.find((b) => b.i === i);
    const n = box ? readMoney(box.rt.value) : null;
    return n > 0 ? n : null;
  };
  function replacedText(t, i) {
    const as = outcome.removed[t.id].as;
    const r = rateOf(i);
    return (
      'Your ' +
      payLabel(t) +
      ' becomes ' +
      venueName +
      '’s ' +
      payLabel(as) +
      (r ? ' at ' + rateText(r, as.unit) : '') +
      '; this pay period’s nights on it follow the new rate.'
    );
  }
  const fate = (t) => {
    const o = outcome.removed[t.id];
    if (!o) return 'kept';
    if (o.how === 'retired') return 'will be removed from your list; nights you saved with it keep it';
    return 'will be removed';
  };
  // the worker's jobs the venue doesn't list
  if (plan.kept.length) {
    const main = mine[0];
    const rows = plan.kept.map((t) => {
      const gone = plan.remove.has(t.id);
      const o = outcome.removed[t.id];
      const replacedBy =
        o && o.how === 'replaced'
          ? Object.keys(outcome.mergedInto).find((k) => outcome.mergedInto[k] === t.id)
          : undefined;
      const note = el('p', { class: 'note', id: 'upd-kept-' + t.id });
      if (o && o.how === 'replaced') {
        const i = replacedBy === undefined ? -1 : Number(replacedBy);
        replacedNotes.push({ i, note, t });
        note.textContent = replacedText(t, i);
      } else note.textContent = 'Not in ' + venueName + '’s list: ' + payLabel(t) + ' — ' + fate(t);
      const row = [note];
      if (t !== main) {
        const box = el('input', {
          type: 'checkbox',
          id: 'upd-remove-' + t.id,
          checked: gone,
        });
        box.addEventListener('change', () => {
          rev.remove = box.checked ? [...plan.remove, t.id] : [...plan.remove].filter((x) => x !== t.id);
          bus.rerender();
        });
        row.push(el('label', { class: 'check', for: 'upd-remove-' + t.id }, box, ' Remove ' + payLabel(t)));
      }
      return row;
    });
    kids.push(el('section', { class: 'card stack', id: 'upd-kept' }, rows));
  }
  // tip-outs: the venue's policy
  const to = plan.tipouts;
  if (to.added.length + to.changed.length + to.removed.length) {
    const how = (r) =>
      tipoutHow({ mode: r.mode, value: r.value }) +
      (r.from === 'payroll' ? ', through payroll' : ', from cash');
    kids.push(
      el(
        'section',
        { class: 'card stack', id: 'upd-tipouts' },
        el('h3', { class: 'label' }, 'Tip-outs'),
        el(
          'p',
          { class: 'note' },
          'Tip-outs follow ' + venueName + '’s list. Your ticks on saved nights carry over.',
        ),
        to.added.map((r) => el('p', { class: 'note' }, 'Added: ' + r.who + ', ' + how(r))),
        to.changed.map(({ before, after }) => {
          const same = how(before) === how(after) && before.who === after.who;
          return el(
            'p',
            { class: 'note' },
            same
              ? 'Linked: ' + after.who + ' (no change to the amount)'
              : 'Changed: ' + before.who + ', ' + how(before) + ' → ' + after.who + ', ' + how(after),
          );
        }),
        to.removed.map((r) => el('p', { class: 'note' }, 'Removed: ' + r.who)),
      ),
    );
  }
  const status = el('p', { class: 'field-error', role: 'alert', hidden: true });
  if (!plan.changes) {
    kids.push(el('p', { class: 'note', id: 'join-nothing' }, 'Nothing to update.'));
    return kids;
  }
  const up = el('button', { type: 'button', class: 'btn', id: 'join-update' }, 'Apply these changes');
  up.addEventListener('click', () => {
    if (isBlocked()) return;
    // a new job's rate: the same money checks as Setup's rate boxes
    const bad = rateBoxes.find(({ rt }) => moneyTypo(rt.value) || !(readMoney(rt.value) > 0));
    if (bad) {
      status.textContent = 'Enter a rate for ' + bad.j.vjob.name + ' (or pick which of your jobs it is).';
      status.hidden = false;
      return bad.rt.focus();
    }
    const newRate = [];
    rateBoxes.forEach(({ rt, i }) => (newRate[i] = readMoney(rt.value)));
    updateFromVenue(S, w, v, { ...rev, newRate });
    pending = null;
    resetRev();
    bus.go('setup');
    toast('Updated ' + w.name + ' from ' + venueName + '.');
  });
  kids.push(el('div', { class: 'cluster' }, up), status);
  return kids;
}

/** The tip sheet screen's picks: {row: index of the person's name, wp: establishment id}. */
let sel = { row: null, wp: null };
export const pendingLink = () => pending;
export function reset() {
  pending = null;
  sel = { row: null, wp: null };
  resetRev();
}

/** A link was opened: kind 'join' or 'sheet', data the code after the "=". Anything that does not read says so and changes nothing. */
export function openFragment({ kind, data }) {
  sel = { row: null, wp: null };
  resetRev();
  const bad = { kind: 'bad', message: kind === 'join' ? BAD_LINK_MSG : BAD_SHEET_MSG };
  try {
    if (kind === 'join') {
      const venue = decodeVenue(data);
      pending = venue ? { kind: 'join', venue } : bad;
    } else {
      const sheet = decodeSheet(data);
      pending = sheet ? { kind: 'sheet', sheet } : bad;
    }
  } catch (e) {
    pending = bad; // anything that fails to read is a bad link, never a blank or broken screen
  }
}
/** Shown when a link cannot be read or shown at all (kind decides which plain message). */
export function openBad(kind) {
  sel = { row: null, wp: null };
  resetRev();
  pending = { kind: 'bad', message: kind === 'sheet' ? BAD_SHEET_MSG : BAD_LINK_MSG };
}
/** Something pasted in Setup that already read as a venue (see setup.js joinCard). */
export function openParsed(p) {
  sel = { row: null, wp: null };
  resetRev();
  pending = p;
}
const close = () => {
  pending = null;
  bus.rerender();
};

export const IPHONE_HINT =
  'On iPhone, Safari and the Home Screen app keep separate data. Using TipNet Teams from your Home Screen? Copy this link, open the app from its icon, and paste it in Setup > Join your venue.';
/**
 * iPhone/iPad Safari only: links open in Safari, but the worker may use the Home Screen app, whose data is separate.
 * The card says so and gives the link back (Copy link, with the link itself in a box to copy by hand). makeLink builds
 * the link from the code that was opened; null on any other device.
 */
function iphoneCard(makeLink, idp) {
  if (!isIosSafariTab()) return null;
  let url = '';
  try {
    url = makeLink();
  } catch (e) {
    url = '';
  }
  const box = el('textarea', {
    id: idp + '-iphone-link',
    rows: '2',
    readonly: true,
    spellcheck: 'false',
    'aria-label': 'Link',
  });
  box.value = url;
  const msg = el('p', { class: 'hint', role: 'status', 'aria-live': 'polite', id: idp + '-iphone-msg' });
  const copy = el(
    'button',
    { type: 'button', class: 'btn btn-secondary btn-small', id: idp + '-iphone-copy' },
    'Copy link',
  );
  copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(url);
      msg.textContent = 'Copied.';
    } catch (e) {
      box.focus();
      box.select();
      msg.textContent = 'Selected. Copy it by hand.';
    }
  });
  return el(
    'section',
    { class: 'card stack', id: idp + '-iphone' },
    el('p', { class: 'note' }, IPHONE_HINT),
    url ? box : null,
    url ? el('div', { class: 'cluster' }, copy) : null,
    msg,
  );
}

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
  const isBlocked = () => {
    if (!joinBlocked()) return false;
    blocked.textContent =
      'You have changes in Setup that aren’t saved. Save or discard them first, then come back.';
    blocked.hidden = false;
    return true;
  };
  const guard = (fn) => () => {
    if (isBlocked()) return;
    fn();
  };
  const notNow = el('button', { type: 'button', class: 'btn-link', id: 'join-not-now' }, 'Not now');
  notNow.addEventListener('click', () => {
    toast('Nothing was changed.');
    close();
  });
  let body;
  if (!isSetUp(S)) {
    // no setup yet: the guided setup starts with the venue's numbers in. In iPhone Safari (whose first guided step is
    // "home screen first") tapping here is choosing Safari, so that step is answered; the card below offers the other way.
    const inSafari = installStepKind(S.settings) === 'ios';
    const go = el(
      'button',
      { type: 'button', class: 'btn', id: 'join-start' },
      inSafari ? 'Set up here in Safari instead' : 'Set up with these',
    );
    go.addEventListener(
      'click',
      guard(() => {
        if (inSafari) S.settings.installStepSeen = true;
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
    body = updatePanel(S, same, v, isBlocked);
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
      iphoneCard(() => venueLink(v), 'join'),
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
        iphoneCard(() => sheetLink(sheet), 'sheet'),
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
      vj: r.vj,
      job: r.job,
      venueName: sheet.venue.name,
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
      iphoneCard(() => sheetLink(sheet), 'sheet'),
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
  if (p.kind === 'join' || p.kind === 'sheet') {
    try {
      return p.kind === 'join' ? joinScreen(root, p.venue) : sheetScreen(root, p.sheet);
    } catch (e) {
      // a link that read but cannot be shown: the plain bad-link screen, nothing changed
      clear(root);
      openBad(p.kind);
      return render(root);
    }
  }
  const ok = el('button', { type: 'button', class: 'btn', id: 'link-bad-ok' }, 'OK');
  ok.addEventListener('click', close);
  root.append(
    el(
      'div',
      { class: 'stack', id: 'link-bad' },
      el('h1', { tabindex: '-1', id: 'link-bad-h1' }, 'TipNet Teams link'),
      el(
        'section',
        { class: 'card stack' },
        el('p', { class: 'note', role: 'alert' }, p.message),
        el('div', { class: 'cluster' }, ok),
      ),
    ),
  );
}
