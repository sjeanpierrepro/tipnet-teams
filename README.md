# TipNet Teams

TipNet Teams is the business edition of TipNet, a free app that helps hospitality employees see their estimated take-home pay at the end of a shift. You enter your credit card tips, your cash tips and the hours you worked (it adds your hourly pay), and it shows how much cash you're taking home and how much will appear on your paycheck after taxes and deductions.

All the numbers stay on your phone or computer. Your bar cannot see them. No accounts to create. Your pay and budget data never leave your device; the only thing the app ever sends is a license key check to Lemon Squeezy (the payment provider), and only if you use a paid product (TipNet Teams for venues, or TipNet Budget for staff).

> Your tip software shows what staff earned. TipNet Teams shows what they keep.

## TipNet Teams overview

There are three kinds of people and two paid products. It is one static app (no server, no accounts), and the manager page is `app/teams/index.html`.

- **Staff use the app free.** Tips, take-home estimates, pay periods, tip-outs and backups are free, always. A staff member can join a venue by scanning the venue's QR poster; joining shares none of their pay with the venue.
- **TipNet Budget** (the "Staff Budget") is an optional add-on a staff member buys for themselves: $1.99 a month or $20 a year through Dec 31, 2026 11:59 PM ET, then $3.99 a month or $30 a year from Jan 1, 2027. It adds the Budget tab and up to 5 establishments.
- **TipNet Teams** is what a venue buys: $59 a month or $500 a year per location, for up to 50 staff, no setup fee (a bigger venue emails hello@tipmynet.com for a larger plan, price on request). It unlocks the manager tools (venue setup QR, tip-pool calculator, tip sheets). Managers never see staff pay. The venue code and tip sheets hold only what the manager typed, and they are worked out on the device.
- **Staff Perks Credit.** Every staff member at a venue who keeps a Budget subscription earns that venue a credit worth 25% of what they pay ($0.50 a month at $1.99, $1.00 at $3.99; a yearly subscriber counts as the yearly price / 12 x 25% a month). Once a month it is given as a partial refund on the venue's most recent TipNet Teams payment; the refunds on one payment never add up to more than that payment. It counts at most 50 staff subscribers per venue, so on a monthly plan it is always less than the bill ($0.50 x 50 = $25 now, $1 x 50 = $50 from Jan 1, 2027, both under $59). On a yearly plan ($500), twelve months at the most could reach $600, so the refunds stop once they reach the yearly payment. It counts only active subscriptions, counted monthly, and only while the venue's Teams subscription is active. Managers see a count, never names. Staff are told at checkout. Budget can never be required for the job or deducted from wages or tips. How to work it out each month: the runbook in [PAYMENTS.md](PAYMENTS.md).
- **Payments** are Lemon Squeezy only, set in `app/js/billing-config.js` (prices, checkout links, product ids). A key entered anywhere in the app is activated with Lemon Squeezy, and the product id in its reply decides whether it unlocks Budget or Teams. Each product has its own license state, "Remove from this device", daily recheck and 14-day offline grace. See [PAYMENTS.md](PAYMENTS.md).

## What you can do with TipNet

- **Record your shift**: Type your **CC tips** and **Cash tips** (before tip-outs) and your hours; TipNet adds your hourly pay and takes out your tip-outs. Both boxes are needed: type 0 if you had none. Nights saved by earlier versions keep their numbers.
- **Start with your paystub**: A new install opens in Setup. Tonight and Pay periods show no numbers until setup is done (or a backup is restored), so no estimate is ever based on example taxes. "See an example first" shows made-up numbers, clearly marked.
- **Hide the explanations**: Once you know your way around, Setup > **Explanations** > **Hide** keeps the screens short. Each how-it-works line leaves a small ⓘ you can tap to read just that one; errors, warnings and all your numbers always stay. After 10 saved nights Tonight offers it once.
- **Save to iCloud or Google Drive**: Where your phone allows it, a button next to **Save a backup file** opens the share menu so you can keep the backup in iCloud Drive (Save to Files) or Google Drive.
- **See your split**: Find out instantly how much is cash in hand and how much hits your check.
- **Set up once**: Tell TipNet about your pay schedule (weekly, every two weeks, twice a month, or monthly), your gross pay, your deductions (taxes, health insurance, etc.) and how many shifts you work in a pay period. Every night follows that Setup; a finished pay period keeps the numbers it was paid with.
- **Work at more than one establishment**: In Setup, tap **+ Set up another establishment**, give it a name and go through the same three steps with a paystub from there. Each establishment keeps its own pay schedule, paystub, jobs, tip-outs (you can tip out several people, each a percent of your tips or a flat amount a night) and accuracy history. On Tonight, you pick where you worked under **Working at:** at the top every night (nothing is picked until you do, and after you save it is cleared for the next night); a half-typed entry at each establishment is kept while the app is open. Pay periods can show all establishments or one, and Budget counts every establishment's paychecks. Late nights, appearance, explanations and backups are shared. The free app allows up to 3 establishments, and 5 with TipNet Budget. With one establishment nothing changes.
- **Setup stays tidy**: once set up, Setup shows each establishment as one line with a short summary. Tap it to edit, then **Save** (or **Cancel**); leaving with unsaved changes asks first. Shared settings are one line each and apply right away.
- **Non-taxable earnings**: reimbursements and allowances your stub lists as non-taxable are left out of the tax rate; the ones on every check are added to your estimate without tax.
- **Track accuracy**: At the end of a pay period, enter your actual paycheck and let TipNet learn. Each check you compare brings the next estimate closer.
- **So far this pay period**: a card at the bottom of Pay periods shows the estimated take-home, cash you keep, what is on your check and the nights logged so far in the pay period in progress, with the same numbers as that period above (one line per establishment when you show all). With TipNet Budget, a **Budget goal** card under it compares your take-home so far with what your budget needs at a steady pace: your monthly bills plus the savings planned for your goals, turned into a monthly amount and spread over your pay period (x 12 / pay periods a year). With several establishments on different schedules it shows the calendar month instead. An optional **Extra goal**, a month or a week, is added on top on that card only.
- **Payday is required**: Setup asks for the pay date on your stub for every establishment. A save made before this keeps working as it did, and its Setup row says **Add your payday**.
- **Finished pay periods keep their numbers**: a raise or a new deduction in Setup only changes the running pay period. To bring a finished one up to date, tap **Update this pay period to today's Setup** under it in Pay periods: TipNet shows the take-home (and check) before and after, asks first, and offers **Undo**.
- **Nightly reminder**: in Setup, pick a time and the nights you work and tap **Add to my calendar**. Your phone's calendar then reminds you after each of those nights to log in TipNet: a time before noon, like 2:00 AM, goes off the morning after each night you work, and a time from noon on goes off that evening (TipNet has no server, so the reminder is a calendar event).
- **Install like an app**: Tap "Install to home screen" in your browser. It works on iPhone, Android, Windows, and Mac. The first-time Setup offers it as an extra step (first on iPhone, last elsewhere, always skippable).

## How to run TipNet

### On your phone or computer
Open the link your bar or venue gives you (the address where TipNet Teams is published). The first time, you may see a prompt to "Install app" or "Add to home screen"—tap it. After that, open it from your home screen or desktop like any app. It works offline.

### On your own computer (testing or setup)
You need Node 20.19 or newer 20.x, 22.13 or newer 22.x, or Node 24 or higher (the "engines" line in package.json). In your terminal, from the TipNet folder, first install test dependencies once:

```
npm ci
```

Then run all the tests:

```
npm test
```

To check that no test depends on today's date, run the same tests as if today were a few awkward dates (right after a pay period ends, New Year's Day, a leap day, January 31 and the March daylight-saving switch). The publishing check runs this too:

```
npm run test:dates
```

(`npm test` runs `tests/**/*.test.js`; the date check is tools/run-dates.mjs and prints the test count per date.)

Tests must not depend on the real clock. `npm run test:dates` reruns the whole suite with a fake clock on several awkward dates and two times of day (01:30, before the 6 a.m. Late-nights cutoff, and 23:30); GitHub Actions runs in UTC, so a late-evening push in Eastern time lands in those early hours. To fake one moment yourself: `node tools/run-dates.mjs 2026-10-05T01:30` (a date alone means noon). The screen-test harness (`tests/ui/harness.js`) boots at 14:00 local time unless a test passes `boot({ time: '01:30' })`, or `time: null` when it fakes the clock itself with `mock.timers`.

To see TipNet running locally:

```
npx --yes serve app
```

Then open the address it prints (like `http://localhost:3000`).

A plain refresh does **not** always show your changes, because the service worker serves the saved copy of the app. After an update is deployed, the app shows "Update available: Refresh" at the bottom of the page, just above the TipNet Budget card; tap it to load the new version. For local development, either bump `VERSION` in `app/sw.js`, or open DevTools > Application > Service workers and tick **Update on reload**.

## How to deploy TipNet

See [DEPLOY.md](DEPLOY.md) for click-by-click steps. You have two free options:

1. **GitHub Pages** (takes 5 minutes, requires a free GitHub account)
2. **Netlify Drop** (drag and drop; make a free account to keep the link)

Both give you an https link that works on any device.

## Project folders

- `app/` — the TipNet website. Everything you deploy goes here.
- `tests/` — automated tests: the money math, storage, budget and the screens.
- `tools/` — build and check scripts (make-icons.ps1, check-version.mjs, run-dates.mjs, and fake-today.mjs, which run-dates preloads to fake the date).
- `app/js/math.js` — pure math functions (no buttons or screens). This is what the tests check.
- `integrations/` — the "Toast seam" (kept outside `app/` so it isn't published). TipNet has no spreadsheet (CSV) import. Toast has no built-in support yet (see `integrations/README.md`). A live Toast connection would need a server and is not part of this app.
- `archive/` — the original approved prototype, kept for reference.

## How your staff installs TipNet

See [STAFF-GUIDE.md](STAFF-GUIDE.md) for a one-page printable guide. It covers:

- Opening the link
- Installing to home screen (iPhone, Android, Windows, Mac)
- Setting up with your paystub
- Using it every night

## What devices it works on

TipNet is built for current versions of Safari (iPhone and Mac), Chrome (Android, Windows, Mac), Edge, and Firefox.

**What was and was not tested**: The money math is covered by automated tests (`npm test`). The screens were checked in a desktop Chromium browser at phone and desktop sizes, in both themes. The service worker was verified in desktop Chrome on Windows 11: it registers, the app works offline after the local server is stopped, the install prompt fires, and the update bar appears after a `VERSION` bump.

**Also tested in real Edge on Windows (desktop)**: the v37 to v38 upgrade, offline use, and the update bar.

**Not tested**: a Lighthouse audit, real phones (the iPhone home-screen app and Android Chrome), and macOS. TipNet is deployed on GitHub Pages, but the live site has not been checked on real phones yet. Before the pilot, install it on one iPhone and one Android phone, turn on airplane mode, and reopen it to confirm it works offline.

## Releasing an update

When you change any file in `app/`, also change the `VERSION` line at the top of `app/sw.js` (for example `tipnetteams-v1` to `tipnetteams-v2`). That is how phones learn there is a new version; they then show "Update available: Refresh". The one exception is `app/js/billing-config.js` on its own (switching payments on): installed apps refresh it in the background, so the bump is optional there, though still recommended.

## Privacy

Your numbers stay on your device. A Content Security Policy in `app/index.html` makes the browser enforce that TipNet only talks to its own site and to Lemon Squeezy (`api.lemonsqueezy.com`, for license checks); the manager page talks to nothing outside its own site. When you enter a Budget or Teams key, the app sends only your license key and a random device name to Lemon Squeezy, the payment provider (once when you activate the key, and about once a day to check it is still valid). Your pay data and budget never leave your device.

## Legal

Changing the contact email: edit `CONTACT_EMAIL` in `app/js/legal.js` (the Privacy and Terms pages show it), then bump `VERSION` in `app/sw.js` and push.

TipNet gives estimates, not tax advice. Your numbers stay on your device. It does not collect your name, Social Security number, or any personal information beyond what you voluntarily type into it.

## Budget (optional paid add-on)
The Budget tab helps plan money between paychecks: "safe to spend until payday", next paycheck, bills, spending categories and savings goals. Budget never projects: it uses only the numbers you type and the estimates TipNet makes from the nights you logged (a check is "from 3 nights logged so far", or $0 when none are logged). With more than one establishment it counts all of them: safe to spend runs until the next check from any establishment (and says whose), the after-payday view lists each check that arrives, and each goal is saved from one establishment's paychecks ("Save from which paycheck?"). It costs $1.99 a month or $20 a year through Dec 31, 2026, then $3.99 a month or $30 a year from Jan 1, 2027 (the prices live in `app/js/billing-config.js`, which switches what the app shows on that date); everything else stays free. Budget data stays on the device like everything else.

A calm **TipNet Budget** card at the bottom of Tonight, Pay periods and Setup shows the price and opens a preview of Budget ("Coming soon" while payments are off); it disappears once Budget is unlocked on that device. The Budget tab itself is hidden until you switch on payments (in `app/js/billing-config.js`; click-by-click steps are in `PAYMENTS.md`). Once payments are on, customers can buy a license key and paste it into the Budget tab to unlock the feature.

To try it locally, open the app on localhost with `?unlock=dev` on the end of the address.

## TipNet Teams (manager tools)

TipNet Teams is the business edition. A manager gets a **Teams** tab, just before Setup in the nav (`app/js/ui/team.js`, shown only when `teamsUnlocked()` from `app/js/entitlements.js` is true; on localhost, `?unlock=dev` turns it on) with two tools. See `MANAGER-GUIDE.md` for how to use them.

- **Venue setup code.** The manager fills in the venue name, pay schedule, the current pay period and payday, jobs with rates and tip-outs. TipNet makes a link (`#join=...`), a QR code and a printable poster. Staff open the link or paste the code in Setup under **Join your venue**, see a preview, and set up (or add an establishment, or update the jobs and tip-outs of one with the same venue id). The code has no personal pay data. The venue is stored on the establishment as `workplace.venue = {id, name}`.
- **Tip pool and tip sheets.** Up to 50 people a sheet. Four split methods (by hours, points x hours, equal, role %), worked out in whole cents by the largest-remainder method (`app/js/pool.js`) so each column adds up to the pool exactly. A sheet can be printed or shared as a link or QR (`#sheet=...`); a worker opens it, picks their name and logs their share on Tonight, with nothing saved until they tap Save night.

How the codes work: compact JSON with short keys and a version field, as UTF-8 then base64url, in the URL fragment (`app/js/codec.js`, `venue.js`, `sheet.js`). The fragment never reaches a server and the app works offline. The app reads the fragment, removes it at once with `history.replaceState`, and validates it strictly (version, types, lengths, ranges, enums, real dates, no `__proto__`, `constructor` or `prototype` keys, capped sizes: 1,500 bytes for a venue code, 2,500 for a tip sheet). The QR code is an SVG built with `createElementNS` from the vendored qrcode-generator 1.4.4 (MIT) in `app/js/vendor/qrcode.js`, which is left out of lint and format checks.

The manager's venue id, the last venue code made and the staff list (names, roles, points) are kept in `settings.team` on the manager's device and are included in backups.

### Manager page and the Teams card
The manager page is `app/teams/index.html` (open it at `/teams/` on your site). It is static: the pitch, what managers and staff get, Budget and the Staff Perks Credit with a worked example, the price, Buy buttons, "Manage subscription" and the FAQ. Its prices, Buy links and example numbers are read from `app/js/billing-config.js`, so they live in one place; while a product has no checkout link the button says "Coming soon". It is not precached by the service worker (see DECISIONS.md).

In the app, a calm **Teams** card sits near the bottom of Setup while Teams is not unlocked on the device. It links to the manager page and holds the box for a team key (a key pasted in any key box is matched to its product). `app/js/entitlements.js` exports `budgetUnlocked()` and `teamsUnlocked()`, plain yes/no answers read from the license stored on the device (`?unlock=dev` on localhost opens both). An establishment that joined a venue stores `venue = { id, name }`; the Budget checkout link then carries `checkout[custom][venue_id]=<id>` so the venue can be credited.
