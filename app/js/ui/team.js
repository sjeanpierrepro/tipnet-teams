// The Teams tab (TipNet Teams, manager side): a venue setup code staff can join, and a tip-pool calculator with tip sheets.
// Only shown when entitlements.teamsUnlocked() is true (app.js). Nothing here is sent anywhere: links carry their data in
// the part after "#", which never reaches a server.
import {
  JOB_PRESETS,
  TIPOUT_PRESETS,
  parseISO,
  dayDiff,
  addDays,
  periodRange,
  calendarMode,
  toCents,
} from '../math.js';
import {
  readMoney,
  moneyTypo,
  percentTypo,
  businessDate,
  cutoffFromSettings,
  dateProblem,
} from '../inputs.js';
import {
  checkVenue,
  venueLink,
  newVenueId,
  cleanStaff,
  NAMED_JOB_KEYS,
  MAX_VENUE_JOBS,
  MAX_VENUE_TIPOUTS,
  MAX_VENUE_NAME,
  MAX_RATE_CENTS,
  MAX_FLAT_CENTS,
  MAX_STAFF,
  MAX_STAFF_NAME,
  TOO_BIG_VENUE,
} from '../venue.js';
import {
  METHODS,
  computePool,
  minutesFromText,
  centsFromText,
  hundredthsFromText,
  hoursLabel,
} from '../pool.js';
import { encodeSheet, sheetLink, TOO_BIG_SHEET, SHARE_WARNING, METHOD_TEXT } from '../sheet.js';
import { qrSvg } from '../qr.js';
import { badChars } from '../codec.js';
import {
  el,
  clear,
  field,
  moneyInput,
  select,
  money,
  fmtDate,
  toast,
  bus,
  getState,
  save,
  debounce,
} from './common.js';

/* ---------- memory (this screen only; the venue, its id and the staff list are kept in settings.team) ---------- */
let section = null; // 'venue' | 'pool'
let V = null; // the venue form, every box as typed
let P = null; // the tip pool form
let printCleanup = null;
export function reset() {
  section = null;
  V = null;
  P = null;
}

const FREQ_OPTIONS = [
  [7, 'Every week'],
  [14, 'Every two weeks'],
  ['semimonthly', 'Twice a month'],
  [15, 'Every 15 days'],
  ['monthly', 'Once a month (same day each month)'],
  [30, 'Every 30 days'],
];
const freqValue = (s) => (/^[0-9]+$/.test(s) ? Number(s) : s);
const presetName = (list, k) => (list.find((x) => x.k === k) || {}).name || '';

const team = () => {
  const S = getState();
  if (!S.settings.team || typeof S.settings.team !== 'object') S.settings.team = {};
  return S.settings.team;
};
/** The venue's id: made once, from crypto.getRandomValues, and kept on this device, so a code made again is the same venue. */
function venueId() {
  const t = team();
  if (!t.venueId) {
    t.venueId = newVenueId();
    save();
  }
  return t.venueId;
}

/* ---------- the venue form ---------- */
/**
 * A new stable id for a venue job ('j') or tip-out ('t'): the next number after the last one handed out on this device
 * (settings.team.jSeq / tSeq), so an id is never used twice, even after a row is removed. used: ids on the form now.
 */
export function newRowId(prefix, used) {
  const t = team();
  const key = prefix + 'Seq';
  const taken = new Set(used);
  let n = t[key] || 0;
  do n++;
  while (taken.has(prefix + n) && n < 999);
  if (taken.has(prefix + n)) {
    // all 999 numbers went by: take the smallest one that is free now
    n = 1;
    while (taken.has(prefix + n)) n++;
  }
  t[key] = Math.min(n, 999);
  save();
  return prefix + n;
}
const idsOf = (rows) => rows.map((r) => r.id).filter(Boolean);
/** The row's id, or a new one when a venue made before ids existed is opened (ids are then kept from here on). */
function idFor(row, prefix, ids) {
  if (row.id) return row.id;
  const id = newRowId(prefix, ids);
  ids.push(id);
  return id;
}
function formFromVenue(v) {
  const jobIds = idsOf(v.jobs);
  const tipIds = idsOf(v.tipouts);
  return {
    name: v.name,
    freq: v.freq,
    start: v.start,
    end: v.end,
    endAuto: false,
    payday: addDays(v.end, v.delay),
    jobs: v.jobs.map((j) => ({
      id: idFor(j, 'j', jobIds),
      k: j.k,
      name: NAMED_JOB_KEYS.includes(j.k) ? j.name : '',
      rate: String(j.rate / 100),
      unit: j.unit,
    })),
    tipouts: v.tipouts.map((t) => ({
      id: idFor(t, 't', tipIds),
      k: t.k,
      who: t.who,
      mode: t.mode,
      value: String(t.value / 100),
      from: t.from,
    })),
  };
}
function blankForm(name) {
  return {
    name,
    freq: 14,
    start: '',
    end: '',
    endAuto: true,
    payday: '',
    jobs: [{ id: newRowId('j', []), k: 'bartender', name: '', rate: '', unit: 'hr' }],
    tipouts: [],
  };
}
const jobLabel = (j) =>
  (NAMED_JOB_KEYS.includes(j.k) ? j.name.trim() : '') || presetName(JOB_PRESETS, j.k) || 'the job';

/**
 * Reads the form with the rules Setup uses (its date, payday, rate and tip-out checks). Returns {venue} when it is good, or
 * {problems: [plain sentences]}. The venue is the one that gets encoded, after checkVenue (the check staff's phones make too).
 */
export function readForm(F, id) {
  const problems = [];
  const name = F.name.trim();
  if (!name) problems.push('Give the venue a name.');
  else if (Array.from(name).length > MAX_VENUE_NAME)
    problems.push('The venue name can be ' + MAX_VENUE_NAME + ' characters at most.');
  const startOk = Number.isFinite(parseISO(F.start));
  if (!startOk) problems.push('Pick the day the current pay period started.');
  let end = F.end;
  let endOk = false;
  if (startOk) {
    if (calendarMode({ periodStart: F.start, freq: F.freq })) {
      end = periodRange({ periodStart: F.start, freq: F.freq }, 0).end; // the calendar sets it, as in Setup
      endOk = true;
    } else if (!Number.isFinite(parseISO(end))) problems.push('Pick the day the current pay period ends.');
    else {
      const len = dayDiff(F.start, end) + 1;
      if (!(len >= 1)) problems.push('The end date has to be on or after the start date.');
      else if (len > 62) problems.push('Pay periods are 62 days or shorter. Check the end date.');
      else endOk = true;
    }
  }
  let delay;
  if (!Number.isFinite(parseISO(F.payday))) problems.push('Pick the payday for this pay period.');
  else if (endOk) {
    delay = dayDiff(end, F.payday);
    if (!(delay >= 0 && delay <= 21)) {
      problems.push('The payday has to be 0 to 21 days after the pay period ends.');
      delay = undefined;
    }
  }
  if (!F.jobs.length) problems.push('Add at least one job.');
  const jobs = F.jobs.map((j) => {
    const label = jobLabel(j);
    const named = NAMED_JOB_KEYS.includes(j.k);
    if (named && !j.name.trim())
      problems.push('Give the ' + presetName(JOB_PRESETS, j.k).toLowerCase() + ' a name.');
    const n = readMoney(j.rate);
    let rate;
    if (moneyTypo(j.rate)) problems.push('Rate for ' + label + ': ' + moneyTypo(j.rate));
    else if (!(n > 0)) problems.push('Enter a rate for ' + label + '.');
    else if (toCents(n) > MAX_RATE_CENTS) problems.push('Rate for ' + label + ' can’t be more than $10,000.');
    else rate = toCents(n);
    return { id: j.id, k: j.k, name: j.name, rate, unit: j.unit };
  });
  const tipouts = F.tipouts.map((t) => {
    const who = t.who.trim() || presetName(TIPOUT_PRESETS, t.k);
    const flat = t.mode === 'flat';
    const n = readMoney(t.value, { percent: !flat });
    const typo = flat ? moneyTypo(t.value) : percentTypo(t.value);
    let value;
    if (typo) problems.push('Tip-out for ' + who + ': ' + typo);
    else if (!(n > 0)) problems.push('Enter how much you tip out ' + who + ', or remove them.');
    else if (!flat && n > 100) problems.push('A tip-out can’t be more than 100%.');
    else if (flat && toCents(n) > MAX_FLAT_CENTS)
      problems.push('A flat tip-out can’t be more than $1,000 a night.');
    else value = Math.round(n * 100);
    return { id: t.id, k: t.k, who, mode: t.mode, value, from: t.from };
  });
  if (problems.length) return { problems };
  const venue = checkVenue({ id, name, freq: F.freq, start: F.start, end, delay, jobs, tipouts });
  if (!venue)
    return {
      problems: [
        'Something in the form isn’t allowed. Check the dates (years 2000 to 2100), names and amounts.',
      ],
    };
  return { venue };
}

/* ---------- copy, share, print ---------- */
async function copyText(value, box, say) {
  try {
    await navigator.clipboard.writeText(value);
    say('Copied.');
  } catch (e) {
    box.focus();
    box.select();
    say('Selected. Copy it by hand.');
  }
}
const canShare = () => typeof navigator !== 'undefined' && typeof navigator.share === 'function';
async function shareLink(title, url, say) {
  try {
    await navigator.share({ title, url });
  } catch (e) {
    if (!e || e.name !== 'AbortError') say('Couldn’t open sharing. Copy the link instead.');
  }
}
/** A link, with Copy and Share (where the phone has sharing), and its QR code. */
function shareBlock({ url, title, qrLabel, idp }) {
  const box = el('textarea', {
    id: idp + '-link',
    rows: '3',
    readonly: true,
    spellcheck: 'false',
    'aria-label': 'Link',
  });
  box.value = url;
  const msg = el('p', { class: 'hint', role: 'status', 'aria-live': 'polite', id: idp + '-msg' });
  const say = (t) => (msg.textContent = t);
  const copy = el(
    'button',
    { type: 'button', class: 'btn btn-secondary btn-small', id: idp + '-copy' },
    'Copy link',
  );
  copy.addEventListener('click', () => copyText(url, box, say));
  const kids = [copy];
  if (canShare()) {
    const sh = el(
      'button',
      { type: 'button', class: 'btn btn-secondary btn-small', id: idp + '-share' },
      'Share',
    );
    sh.addEventListener('click', () => shareLink(title, url, say));
    kids.push(sh);
  }
  const qr = qrSvg(url, qrLabel);
  return {
    qr,
    node: el(
      'div',
      { class: 'stack' },
      box,
      el('div', { class: 'cluster' }, kids),
      msg,
      qr
        ? el('div', { class: 'qr-box', id: idp + '-qr' }, qr)
        : el(
            'p',
            { class: 'note', id: idp + '-noqr' },
            'This is too much for a QR code. Share the link instead.',
          ),
    ),
  };
}
/**
 * Prints a block (the poster, a tip sheet): it is drawn into #print-area, which only shows on paper (css), then the
 * browser's print box opens. The block is removed again when printing ends.
 */
export function printBlock(node) {
  if (printCleanup) printCleanup();
  const area = el('div', { class: 'print-area', id: 'print-area' }, node);
  document.body.append(area);
  const done = () => {
    window.removeEventListener('afterprint', done);
    area.remove();
    printCleanup = null;
  };
  printCleanup = done;
  window.addEventListener('afterprint', done);
  if (typeof window.print === 'function') window.print();
}
/** The poster for the wall: venue name, a big QR code, what to do. */
export function posterNode(venue, url) {
  const qr = qrSvg(url, 'QR code to set up TipNet Teams at ' + venue.name);
  return el(
    'div',
    { class: 'poster' },
    el('h1', { class: 'poster-title' }, venue.name),
    qr ? el('div', { class: 'poster-qr' }, qr) : el('p', null, 'Ask your manager for the link.'),
    el('p', { class: 'poster-scan' }, 'Scan to set up TipNet Teams at ' + venue.name),
    el(
      'ol',
      { class: 'poster-steps' },
      el('li', null, 'Point your phone camera at the code and tap the link.'),
      el('li', null, 'Check the pay schedule, jobs and tip-outs TipNet shows.'),
      el('li', null, 'Tap “Set up with these”, then add your own paystub numbers.'),
    ),
    el('p', { class: 'poster-small' }, 'TipNet works offline and keeps your numbers on your phone.'),
  );
}

/* ---------- section 1: venue setup code ---------- */
function venueSection() {
  const F = V;
  const out = el('div', { class: 'stack', id: 'venue-out', 'aria-live': 'polite' });
  const jobsHost = el('div', { class: 'stack' });
  const tipHost = el('div', { class: 'stack' });
  let lastSaved = '';

  const refresh = () => {
    const r = readForm(F, team().venueId || 'pending0000');
    clear(out);
    if (r.problems) {
      out.append(
        el(
          'div',
          { class: 'note', id: 'venue-problems' },
          el('p', null, 'To make the code:'),
          el(
            'ul',
            null,
            r.problems.map((p) => el('li', null, p)),
          ),
        ),
      );
      return;
    }
    // good: the id is made now (once), and this venue is remembered for next time
    const venue = checkVenue({ ...r.venue, id: venueId() });
    let url;
    try {
      url = venueLink(venue, location);
    } catch (e) {
      out.append(el('p', { class: 'field-error', role: 'alert', id: 'venue-toobig' }, TOO_BIG_VENUE));
      return;
    }
    const sig = JSON.stringify(venue);
    if (sig !== lastSaved) {
      lastSaved = sig;
      const t = team();
      t.venue = venue;
      t.name = venue.name;
      save();
    }
    const block = shareBlock({
      url,
      title: 'Set up TipNet Teams at ' + venue.name,
      qrLabel: 'QR code to join ' + venue.name,
      idp: 'venue',
    });
    const poster = el('button', { type: 'button', class: 'btn', id: 'venue-poster' }, 'Print the poster');
    poster.addEventListener('click', () => printBlock(posterNode(venue, url)));
    const join = el(
      'button',
      { type: 'button', class: 'btn btn-secondary btn-small', id: 'venue-join-here' },
      'Join this venue on this device',
    );
    join.addEventListener('click', () => bus.openLink({ kind: 'join', venue }));
    out.append(
      el('h3', { class: 'label' }, 'Your venue code'),
      el(
        'p',
        { class: 'note' },
        'Staff open this link, or scan the code, and see ' +
          venue.name +
          '’s pay schedule, jobs and tip-outs before anything is set up. It has no pay or personal information in it.',
      ),
      block.node,
      el('div', { class: 'cluster' }, poster, join),
    );
  };
  const later = debounce(refresh, 350);
  const touch = () => later();

  // basics
  const name = el('input', {
    type: 'text',
    id: 'venue-name',
    value: F.name,
    maxlength: '40',
    autocomplete: 'off',
    placeholder: 'e.g. The Corner Bar',
  });
  name.addEventListener('input', () => {
    F.name = name.value;
    if (P) P.venueName = name.value;
    touch();
  });
  const freq = select(FREQ_OPTIONS, F.freq, { id: 'venue-freq' });
  const start = el('input', { type: 'date', id: 'venue-start', value: F.start });
  const end = el('input', { type: 'date', id: 'venue-end', value: F.end });
  const payday = el('input', { type: 'date', id: 'venue-payday', value: F.payday });
  const hint = el('p', { class: 'hint', id: 'venue-end-hint' });
  const syncEnd = () => {
    const cal = Number.isFinite(parseISO(F.start)) && calendarMode({ periodStart: F.start, freq: F.freq });
    if (cal) {
      F.end = periodRange({ periodStart: F.start, freq: F.freq }, 0).end;
      F.endAuto = true;
    } else if (Number.isFinite(parseISO(F.start)) && typeof F.freq === 'number' && (!F.end || F.endAuto)) {
      F.end = addDays(F.start, F.freq - 1);
      F.endAuto = true;
    }
    end.value = F.end;
    end.disabled = !!cal;
    hint.textContent = cal ? 'The calendar sets the end date for this schedule.' : '';
  };
  freq.addEventListener('change', () => {
    F.freq = freqValue(freq.value);
    syncEnd();
    touch();
  });
  start.addEventListener('input', () => {
    F.start = start.value;
    syncEnd();
    touch();
  });
  end.addEventListener('input', () => {
    F.end = end.value;
    F.endAuto = false;
    touch();
  });
  payday.addEventListener('input', () => {
    F.payday = payday.value;
    touch();
  });
  syncEnd();

  // jobs
  const drawJobs = (focusLast = false) => {
    clear(jobsHost);
    F.jobs.forEach((j, i) => {
      const kind = select(
        JOB_PRESETS.map((x) => [x.k, x.name]),
        j.k,
        { id: 'vj-kind-' + i },
      );
      const nm = el('input', {
        type: 'text',
        id: 'vj-name-' + i,
        value: j.name,
        maxlength: '40',
        autocomplete: 'off',
        placeholder: 'Name of the job',
      });
      const rate = moneyInput({ id: 'vj-rate-' + i, value: j.rate, placeholder: 'e.g. 12' });
      const unit = select(
        [
          ['hr', 'per hour'],
          ['shift', 'per shift'],
        ],
        j.unit,
        { id: 'vj-unit-' + i },
      );
      const rm = el(
        'button',
        { type: 'button', class: 'btn btn-secondary btn-small', 'aria-label': 'Remove ' + jobLabel(j) },
        'Remove',
      );
      kind.addEventListener('change', () => {
        j.k = kind.value;
        const pr = JOB_PRESETS.find((x) => x.k === j.k);
        if (pr) j.unit = pr.unit === 'shift' ? 'shift' : 'hr';
        drawJobs();
        document.getElementById('vj-kind-' + i).focus();
        touch();
      });
      nm.addEventListener('input', () => {
        j.name = nm.value;
        rm.setAttribute('aria-label', 'Remove ' + jobLabel(j));
        touch();
      });
      rate.addEventListener('input', () => {
        j.rate = rate.value;
        touch();
      });
      unit.addEventListener('change', () => {
        j.unit = unit.value;
        touch();
      });
      rm.addEventListener('click', () => {
        F.jobs.splice(i, 1);
        drawJobs();
        touch();
      });
      jobsHost.append(
        el(
          'div',
          { class: 'job-row' },
          field('Job', kind),
          NAMED_JOB_KEYS.includes(j.k) ? field('Name', nm) : null,
          el('div', { class: 'grid-2' }, field('Rate', rate), field('Paid', unit)),
          F.jobs.length > 1 ? el('div', { class: 'row-actions' }, rm) : null,
        ),
      );
    });
    if (focusLast) {
      const last = document.getElementById('vj-kind-' + (F.jobs.length - 1));
      if (last) last.focus();
    }
  };
  const addJob = el(
    'button',
    { type: 'button', class: 'btn btn-secondary btn-small', id: 'venue-add-job' },
    '+ Add a job',
  );
  addJob.addEventListener('click', () => {
    if (F.jobs.length >= MAX_VENUE_JOBS)
      return toast('A venue code holds up to ' + MAX_VENUE_JOBS + ' jobs.');
    const used = F.jobs.map((j) => j.k);
    const pr = JOB_PRESETS.find((x) => !used.includes(x.k)) || JOB_PRESETS[0];
    F.jobs.push({
      id: newRowId('j', idsOf(F.jobs)),
      k: pr.k,
      name: '',
      rate: '',
      unit: pr.unit === 'shift' ? 'shift' : 'hr',
    });
    drawJobs(true);
    touch();
  });

  // tip-outs
  const drawTips = (focusLast = false) => {
    clear(tipHost);
    F.tipouts.forEach((t, i) => {
      const who = select(
        TIPOUT_PRESETS.map((x) => [x.k, x.name]),
        t.k,
        { id: 'vt-kind-' + i },
      );
      const nm = el('input', {
        type: 'text',
        id: 'vt-who-' + i,
        value: t.who,
        maxlength: '40',
        autocomplete: 'off',
        placeholder: presetName(TIPOUT_PRESETS, t.k),
      });
      const mode = select(
        [
          ['pctTips', '% of tips'],
          ['flat', '$ flat a night'],
        ],
        t.mode,
        { id: 'vt-mode-' + i },
      );
      const val = moneyInput({
        id: 'vt-value-' + i,
        value: t.value,
        placeholder: t.mode === 'flat' ? 'e.g. 20' : 'e.g. 15',
      });
      const from = select(
        [
          ['cash', 'From cash'],
          ['payroll', 'Through payroll'],
        ],
        t.from,
        { id: 'vt-from-' + i },
      );
      const rm = el(
        'button',
        {
          type: 'button',
          class: 'btn btn-secondary btn-small',
          'aria-label': 'Remove ' + (t.who.trim() || presetName(TIPOUT_PRESETS, t.k)),
        },
        'Remove',
      );
      who.addEventListener('change', () => {
        const wasDefault = !t.who.trim() || t.who === presetName(TIPOUT_PRESETS, t.k);
        t.k = who.value;
        if (wasDefault) t.who = presetName(TIPOUT_PRESETS, t.k);
        nm.value = t.who;
        nm.placeholder = presetName(TIPOUT_PRESETS, t.k);
        touch();
      });
      nm.addEventListener('input', () => {
        t.who = nm.value;
        rm.setAttribute('aria-label', 'Remove ' + (t.who.trim() || presetName(TIPOUT_PRESETS, t.k)));
        touch();
      });
      mode.addEventListener('change', () => {
        t.mode = mode.value;
        val.placeholder = t.mode === 'flat' ? 'e.g. 20' : 'e.g. 15';
        touch();
      });
      val.addEventListener('input', () => {
        t.value = val.value;
        touch();
      });
      from.addEventListener('change', () => {
        t.from = from.value;
        touch();
      });
      rm.addEventListener('click', () => {
        F.tipouts.splice(i, 1);
        drawTips();
        touch();
      });
      tipHost.append(
        el(
          'div',
          { class: 'job-row' },
          field('Who', who),
          field('Name', nm),
          el('div', { class: 'grid-2' }, field('How', mode), field('Amount', val)),
          field('Paid', from),
          el('div', { class: 'row-actions' }, rm),
        ),
      );
    });
    if (focusLast) {
      const last = document.getElementById('vt-kind-' + (F.tipouts.length - 1));
      if (last) last.focus();
    }
  };
  const addTip = el(
    'button',
    { type: 'button', class: 'btn btn-secondary btn-small', id: 'venue-add-tipout' },
    '+ Add someone staff tip out',
  );
  addTip.addEventListener('click', () => {
    if (F.tipouts.length >= MAX_VENUE_TIPOUTS)
      return toast('A venue code holds up to ' + MAX_VENUE_TIPOUTS + ' tip-outs.');
    const used = F.tipouts.map((t) => t.k);
    const pr =
      TIPOUT_PRESETS.find((x) => x.k !== 'other' && !used.includes(x.k)) ||
      TIPOUT_PRESETS[TIPOUT_PRESETS.length - 1];
    F.tipouts.push({
      id: newRowId('t', idsOf(F.tipouts)),
      k: pr.k,
      who: pr.name,
      mode: 'pctTips',
      value: '',
      from: 'cash',
    });
    drawTips(true);
    touch();
  });
  drawJobs();
  drawTips();
  refresh(); // shows the code at once when what was last made is still good

  return el(
    'div',
    { class: 'stack', id: 'venue-section' },
    el(
      'section',
      { class: 'card stack' },
      el('h2', null, 'Venue setup code'),
      el(
        'p',
        { class: 'note' },
        'Fill in how your venue pays. Staff scan the code or open the link and set up with it. Their own pay stays on their phones.',
      ),
      field('Venue name', name),
      field('Staff get paid', freq),
      el(
        'div',
        { class: 'grid-2' },
        field('Current pay period started', start),
        field('Current pay period ends', end),
      ),
      hint,
      field('Payday for this pay period', payday, { hint: 'The pay date for these dates, as on a paystub.' }),
    ),
    el(
      'section',
      { class: 'card stack' },
      el('h2', null, 'Jobs and rates'),
      jobsHost,
      el('div', null, addJob),
    ),
    el(
      'section',
      { class: 'card stack' },
      el('h2', null, 'Tip-outs'),
      el('p', { class: 'note' }, 'Who staff tip out, and how much. Leave it empty if there are none.'),
      tipHost,
      el('div', null, addTip),
    ),
    el('section', { class: 'card stack' }, out),
  );
}

/* ---------- section 2: tip pool ---------- */
function poolSection(S) {
  const t = team();
  const staff = cleanStaff(t.staff);
  /** The venue's jobs (with their stable ids), as last made in the Venue code tab. */
  const venueJobs = () => ((t.venue && t.venue.jobs) || []).filter((j) => j.id);
  const jobKey = (s) => s.trim().toLowerCase();
  if (!P.rows) {
    // A person whose role is a venue job follows that job by its id: rename the job in the Venue code tab and their
    // role shows the new name (the tip sheet carries the id, so a worker's phone can find their own job).
    P.rows = staff.map((s) => {
      const job = s.vj ? venueJobs().find((j) => j.id === s.vj) : null;
      const row = { name: s.name, role: job ? job.name : s.role, points: String(s.points / 100), hours: '' };
      if (job) row.vj = job.id;
      return row;
    });
    if (!P.rows.length) P.rows.push({ name: '', role: '', points: '1', hours: '' });
  }
  const venueRoles = (t.venue ? t.venue.jobs.map((j) => j.name) : []).concat(
    (t.venue ? t.venue.tipouts : []).map((x) => x.who),
  );
  const resultHost = el('div', { class: 'stack', id: 'pool-result', 'aria-live': 'polite' });
  const rowsHost = el('div', { class: 'stack', id: 'pool-rows' });
  const sharesHost = el('div', { class: 'stack', id: 'pool-shares' });
  const shareHost = el('div', { class: 'stack', id: 'pool-share' });
  const today = businessDate(new Date(), cutoffFromSettings(S.settings));

  const saveStaff = debounce(() => {
    const list = P.rows
      .map((r) => ({
        name: r.name.trim(),
        role: r.role.trim(),
        points: pointsOf(r).hundredths,
        vj: r.vj,
      }))
      .filter((r) => r.name);
    // a name or role TipNet can't use is named on screen (read); the saved list waits until it is fixed, so nothing
    // is ever dropped from it quietly
    if (list.some((r) => textProblem(r.name) || textProblem(r.role) || r.points == null)) return;
    const keep = cleanStaff(list);
    const tt = team();
    if (JSON.stringify(tt.staff || []) === JSON.stringify(keep)) return;
    if (keep.length) tt.staff = keep;
    else delete tt.staff;
    save();
  }, 500);

  const roleKey = (r) => r.trim().toLowerCase();
  /** The venue job a typed role is (same name, any case), or undefined: its id travels on the tip sheet. */
  const jobOfRole = (role) => venueJobs().find((j) => jobKey(j.name) === jobKey(role));
  /** Blank points mean the default, 1 (the box is filled back with 1 when it is left). */
  const pointsOf = (r) =>
    String(r.points).trim() === '' ? { hundredths: 100 } : hundredthsFromText(r.points, 1000);
  /** What is wrong with a name or role's characters, in words, or ''. */
  const textProblem = (s) =>
    badChars(s.trim()).length
      ? 'has a character TipNet can’t use (a tab, a line break or an invisible character). Retype it.'
      : '';
  /** A name as it can be shown in a message (without the characters that are the problem). */
  const shown = (s) => {
    const bad = new Set(badChars(s));
    return Array.from(s.trim())
      .filter((ch) => !bad.has(ch))
      .join('');
  };
  const rolesInUse = () => {
    const seen = new Map();
    P.rows.forEach((r) => {
      const k = roleKey(r.role);
      if (k && !seen.has(k)) seen.set(k, r.role.trim());
    });
    return seen;
  };

  /** Reads every box; {errors} or {input}. */
  const read = () => {
    const errors = [];
    const dp = dateProblem(P.date, today);
    if (dp) errors.push(dp);
    const cc = centsFromText(P.cc);
    if (cc.error) errors.push('Credit card tips: ' + cc.error);
    const cash = centsFromText(P.cash);
    if (cash.error) errors.push('Cash tips: ' + cash.error);
    const rows = [];
    P.rows.forEach((r, i) => {
      const hasAny = r.name.trim() || r.hours.trim();
      if (!hasAny) return; // a blank row is ignored
      const who = r.name.trim() || 'Row ' + (i + 1);
      if (!r.name.trim()) errors.push('Row ' + (i + 1) + ' needs a name.');
      if (textProblem(r.name)) errors.push('The name “' + shown(r.name) + '” ' + textProblem(r.name));
      if (textProblem(r.role)) errors.push('The role “' + shown(r.role) + '” ' + textProblem(r.role));
      const m = minutesFromText(r.hours);
      if (m.error) errors.push('Hours for ' + who + ': ' + m.error);
      const pts = P.method === 'points' ? pointsOf(r) : { hundredths: 100 };
      if (pts.error) errors.push('Points for ' + who + ': ' + pts.error);
      const job = jobOfRole(r.role);
      rows.push({
        name: r.name.trim(),
        role: r.role.trim(),
        minutes: m.minutes || 0,
        points: pts.hundredths || 0,
        vj: job ? job.id : undefined,
        job: job ? job.name : undefined,
      });
    });
    const shares = {};
    if (P.method === 'role') {
      rolesInUse().forEach((label, k) => {
        const s = hundredthsFromText(P.shares[k] || '', 100, { percent: true });
        if (s.error) errors.push('Share for ' + label + ': ' + s.error);
        shares[k] = s.hundredths || 0;
      });
    }
    if (errors.length) return { errors };
    return { input: { method: P.method, cc: cc.cents, cash: cash.cents, rows, shares } };
  };

  const venueName = () => (P.venueName || t.name || '').trim();

  const tableNode = (res, cls = 'table') =>
    el(
      'div',
      { class: 'table-wrap' },
      el(
        'table',
        { class: cls },
        el(
          'thead',
          null,
          el(
            'tr',
            null,
            ['Name', 'Hours', 'Credit card', 'Cash', 'Total'].map((h, i) =>
              el('th', { class: i ? 'r' : null }, h),
            ),
          ),
        ),
        el(
          'tbody',
          null,
          res.rows.map((r) =>
            el(
              'tr',
              null,
              el('td', null, r.name),
              el('td', { class: 'r' }, hoursLabel(r.minutes)),
              el('td', { class: 'r' }, money(r.cc / 100)),
              el('td', { class: 'r' }, money(r.cash / 100)),
              el('td', { class: 'r' }, money(r.total / 100)),
            ),
          ),
        ),
        el(
          'tfoot',
          null,
          el(
            'tr',
            null,
            el('th', null, 'Total'),
            el('th', { class: 'r' }, hoursLabel(res.totals.minutes)),
            el('th', { class: 'r' }, money(res.totals.cc / 100)),
            el('th', { class: 'r' }, money(res.totals.cash / 100)),
            el('th', { class: 'r' }, money(res.totals.total / 100)),
          ),
        ),
      ),
    );

  const sheetOf = (res) => ({
    venue: { id: venueId(), name: venueName() },
    date: P.date,
    method: P.method,
    rows: res.rows.map((r, i) => {
      const o = { name: r.name, minutes: r.minutes, cc: r.cc, cash: r.cash };
      const src = inputRows[i];
      if (src && src.vj) {
        o.vj = src.vj; // the venue job picked as this person's role
        o.job = src.job;
      }
      return o;
    }),
  });

  let last = null; // the latest good result
  let inputRows = []; // the rows it was worked out from (same order)
  const drawShare = () => {
    clear(shareHost);
    if (!P.sharing || !last) return;
    if (!venueName()) {
      shareHost.append(
        el(
          'p',
          { class: 'field-error', role: 'alert', id: 'pool-share-noname' },
          'Type the venue name above first. Staff see it on the sheet.',
        ),
      );
      return;
    }
    let url;
    try {
      encodeSheet(sheetOf(last));
      url = sheetLink(sheetOf(last), location);
    } catch (e) {
      // say what is wrong: too big for a link, or something in it a link can't carry
      const tooBig = e && e.message === 'too-big';
      const why = tooBig
        ? TOO_BIG_SHEET
        : textProblem(venueName())
          ? 'The venue name ' + textProblem(venueName())
          : 'This sheet can’t be shared as a link. Check the venue name, the names and the night above.';
      shareHost.append(
        el(
          'p',
          { class: 'field-error', role: 'alert', id: tooBig ? 'pool-share-toobig' : 'pool-share-error' },
          why,
        ),
      );
      return;
    }
    if (t.name !== venueName()) {
      team().name = venueName(); // remembered for the next sheet
      save();
    }
    const block = shareBlock({
      url,
      title: venueName() + ' tip sheet, ' + fmtDate(P.date),
      qrLabel: 'QR code for the tip sheet',
      idp: 'sheet',
    });
    shareHost.append(
      el('p', { class: 'note', id: 'pool-share-warning', role: 'alert' }, SHARE_WARNING),
      block.node,
    );
  };

  const update = () => {
    clear(resultHost);
    last = null;
    const r = read();
    if (r.errors) {
      resultHost.append(
        el(
          'div',
          { class: 'note', id: 'pool-problems' },
          el('p', null, 'To work out the split:'),
          el(
            'ul',
            null,
            r.errors.map((e) => el('li', null, e)),
          ),
        ),
      );
      drawShare();
      return;
    }
    const res = computePool(r.input);
    if (!res.ok) {
      resultHost.append(el('p', { class: 'field-error', role: 'alert', id: 'pool-error' }, res.error));
      drawShare();
      return;
    }
    last = res;
    inputRows = r.input.rows;
    const print = el(
      'button',
      { type: 'button', class: 'btn btn-secondary btn-small', id: 'pool-print' },
      'Print the tip sheet',
    );
    print.addEventListener('click', () => {
      const name = venueName();
      printBlock(
        el(
          'div',
          { class: 'sheet-print' },
          el('h1', null, (name ? name + ' ' : '') + 'tip sheet'),
          el('p', null, fmtDate(P.date) + ', split ' + METHOD_TEXT[P.method] + '.'),
          tableNode(res, 'table print-table'),
        ),
      );
    });
    const share = el(
      'button',
      { type: 'button', class: 'btn btn-secondary btn-small', id: 'pool-share-btn' },
      P.sharing ? 'Hide the link and QR' : 'Share as a link or QR',
    );
    share.addEventListener('click', () => {
      P.sharing = !P.sharing;
      share.textContent = P.sharing ? 'Hide the link and QR' : 'Share as a link or QR';
      drawShare();
    });
    resultHost.append(
      el('h3', { class: 'label' }, 'Tip sheet'),
      tableNode(res),
      el(
        'p',
        { class: 'hint', id: 'pool-check' },
        'Credit card ' +
          money(res.totals.cc / 100) +
          ' + cash ' +
          money(res.totals.cash / 100) +
          ' = ' +
          money(res.totals.total / 100) +
          ', all handed out.',
      ),
      el('div', { class: 'cluster' }, print, share),
    );
    drawShare();
  };
  const later = debounce(update, 250);

  const drawShares = () => {
    clear(sharesHost);
    if (P.method !== 'role') return;
    const roles = rolesInUse();
    if (!roles.size) {
      sharesHost.append(el('p', { class: 'hint' }, 'Give each person a role to set each role’s share.'));
      return;
    }
    let sum = 0;
    const total = el('p', { class: 'hint', id: 'pool-shares-total' });
    const showTotal = () => {
      sum = 0;
      roles.forEach(
        (label, k) => (sum += hundredthsFromText(P.shares[k] || '', 100, { percent: true }).hundredths || 0),
      );
      total.textContent = 'Shares add up to ' + sum / 100 + '%. They need to add up to 100%.';
    };
    sharesHost.append(el('p', { class: 'label' }, 'Share of the pool for each role'));
    const usedIds = new Set(); // two roles that differ only in punctuation must not share an id (labels point at ids)
    roles.forEach((label, k) => {
      let id = 'pool-share-' + k.replace(/[^a-z0-9]/g, '_');
      for (let n = 2; usedIds.has(id); n++) id = 'pool-share-' + k.replace(/[^a-z0-9]/g, '_') + '-' + n;
      usedIds.add(id);
      const box = moneyInput({
        id,
        value: P.shares[k] || '',
        placeholder: 'e.g. 60',
      });
      box.addEventListener('input', () => {
        P.shares[k] = box.value;
        showTotal();
        later();
      });
      sharesHost.append(field(label + ' %', box));
    });
    showTotal();
    sharesHost.append(total);
  };

  const dl = el(
    'datalist',
    { id: 'pool-roles' },
    Array.from(new Set(venueRoles)).map((r) => el('option', { value: r })),
  );
  const drawRows = (focusIdx) => {
    clear(rowsHost);
    P.rows.forEach((r, i) => {
      const name = el('input', {
        type: 'text',
        id: 'pr-name-' + i,
        value: r.name,
        maxlength: String(MAX_STAFF_NAME),
        autocomplete: 'off',
        placeholder: 'Name',
      });
      const role = el('input', {
        type: 'text',
        id: 'pr-role-' + i,
        value: r.role,
        maxlength: String(MAX_STAFF_NAME),
        autocomplete: 'off',
        list: 'pool-roles',
        placeholder: 'e.g. Bartender',
      });
      const hours = el('input', {
        type: 'text',
        id: 'pr-hours-' + i,
        value: r.hours,
        inputmode: 'text',
        autocomplete: 'off',
        autocapitalize: 'off',
        spellcheck: 'false',
        placeholder: 'e.g. 7:30',
      });
      const pts = moneyInput({ id: 'pr-points-' + i, value: r.points });
      const rm = el(
        'button',
        {
          type: 'button',
          class: 'btn btn-secondary btn-small',
          'aria-label': 'Remove ' + (r.name.trim() || 'row ' + (i + 1)),
        },
        'Remove',
      );
      name.addEventListener('input', () => {
        r.name = name.value;
        rm.setAttribute('aria-label', 'Remove ' + (r.name.trim() || 'row ' + (i + 1)));
        saveStaff();
        later();
      });
      role.addEventListener('input', () => {
        r.role = role.value;
        const job = jobOfRole(r.role);
        if (job) r.vj = job.id;
        else delete r.vj;
        saveStaff();
        drawShares();
        later();
      });
      hours.addEventListener('input', () => {
        r.hours = hours.value;
        later();
      });
      pts.addEventListener('input', () => {
        r.points = pts.value;
        saveStaff();
        later();
      });
      // left blank: back to the default, 1, shown and stored
      pts.addEventListener('change', () => {
        if (pts.value.trim() !== '') return;
        pts.value = r.points = '1';
        saveStaff();
        later();
      });
      rm.addEventListener('click', () => {
        P.rows.splice(i, 1);
        if (!P.rows.length) P.rows.push({ name: '', role: '', points: '1', hours: '' });
        saveStaff();
        drawRows(Math.min(i, P.rows.length - 1));
        drawShares();
        update();
      });
      rowsHost.append(
        el(
          'div',
          { class: 'job-row' },
          el('div', { class: 'grid-2' }, field('Name', name), field('Role', role)),
          el(
            'div',
            { class: 'grid-2' },
            field('Hours', hours),
            P.method === 'points' ? field('Points', pts) : el('div'),
          ),
          el('div', { class: 'row-actions' }, rm),
        ),
      );
    });
    if (focusIdx != null) {
      const f = document.getElementById('pr-name-' + focusIdx);
      if (f) f.focus();
    }
  };
  const add = el(
    'button',
    { type: 'button', class: 'btn btn-secondary btn-small', id: 'pool-add-person' },
    '+ Add a person',
  );
  add.addEventListener('click', () => {
    if (P.rows.length >= MAX_STAFF)
      return toast('A tip sheet holds up to ' + MAX_STAFF + ' people. For more, make a second sheet.');
    P.rows.push({ name: '', role: '', points: '1', hours: '' });
    drawRows(P.rows.length - 1);
    update();
  });

  const vname = el('input', {
    type: 'text',
    id: 'pool-venue-name',
    value: P.venueName || t.name || '',
    maxlength: '40',
    autocomplete: 'off',
    placeholder: 'e.g. The Corner Bar',
  });
  vname.addEventListener('input', () => {
    P.venueName = vname.value;
    if (V) V.name = vname.value;
    later();
  });
  const date = el('input', { type: 'date', id: 'pool-date', value: P.date });
  date.addEventListener('input', () => {
    P.date = date.value;
    later();
  });
  const cc = moneyInput({ id: 'pool-cc', value: P.cc, placeholder: '0' });
  cc.addEventListener('input', () => {
    P.cc = cc.value;
    later();
  });
  const cash = moneyInput({ id: 'pool-cash', value: P.cash, placeholder: '0' });
  cash.addEventListener('input', () => {
    P.cash = cash.value;
    later();
  });
  const method = select(METHODS, P.method, { id: 'pool-method' });
  method.addEventListener('change', () => {
    P.method = method.value;
    drawRows();
    drawShares();
    update();
  });

  drawRows();
  drawShares();
  update();
  return el(
    'div',
    { class: 'stack', id: 'pool-section' },
    el(
      'section',
      { class: 'card stack' },
      el('h2', null, 'Tip pool'),
      el(
        'p',
        { class: 'note' },
        'Enter the night’s pooled tips and each person’s hours. Tips are split in whole cents, so the totals match exactly.',
      ),
      field('Venue name', vname, { hint: 'Shown on the tip sheet when you share it.' }),
      field('Night', date),
      el('div', { class: 'grid-2' }, field('Pooled credit card tips', cc), field('Pooled cash tips', cash)),
      field('Split', method, {
        hint:
          P.method === 'role'
            ? 'Each role gets its share of the pool, then it is split by hours inside the role.'
            : P.method === 'points'
              ? 'Each person’s hours × their points. Points are for the role or the person (1 or 1.5, for example).'
              : P.method === 'equal'
                ? 'Everyone who worked any hours gets the same.'
                : 'Each person’s share of the hours worked.',
      }),
    ),
    el(
      'section',
      { class: 'card stack' },
      el('h2', null, 'Staff'),
      rowsHost,
      dl,
      el('div', null, add),
      sharesHost,
    ),
    el('section', { class: 'card stack' }, resultHost, shareHost),
  );
}

/* ---------- the tab ---------- */
export function render(root) {
  const S = getState();
  const t = S.settings.team || {};
  if (!V) V = t.venue ? formFromVenue(t.venue) : blankForm(t.name || '');
  if (!P)
    P = {
      date: businessDate(new Date(), cutoffFromSettings(S.settings)),
      cc: '',
      cash: '',
      method: 'hours',
      shares: {},
      venueName: t.name || '',
    };
  if (!section) section = t.venue ? 'pool' : 'venue';
  const pick = (which) => {
    section = which;
    bus.rerender();
    const h = document.getElementById('team-' + which + '-tab');
    if (h) h.focus();
  };
  const tab = (id, label) => {
    const b = el(
      'button',
      {
        type: 'button',
        class: 'btn btn-secondary btn-small',
        id: 'team-' + id + '-tab',
        'aria-pressed': String(section === id),
      },
      label,
    );
    b.addEventListener('click', () => section !== id && pick(id));
    return b;
  };
  root.append(
    el(
      'div',
      { class: 'stack' },
      el('h1', null, 'Teams'),
      el(
        'div',
        { class: 'cluster', role: 'group', 'aria-label': 'Teams tools' },
        tab('venue', 'Venue code'),
        tab('pool', 'Tip pool'),
      ),
      section === 'venue' ? venueSection() : poolSection(S),
    ),
  );
}
