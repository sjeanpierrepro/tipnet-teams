# Payments (TipNet Teams and TipNet Budget)

Two products are sold, both through **Lemon Squeezy** (LS), which is the only payment service in use. Customers pay on LS's checkout page, LS emails them a license key, they paste the key into the app and the product unlocks. You run no server.

| Product | Sold to | Price | LS product id |
| --- | --- | --- | --- |
| **TipNet Teams** | venues (managers), per location, up to 50 staff | $59 a month or $500 a year, no setup fee | `1467595` |
| **TipNet Budget** ("Staff Budget") | individual staff | $1.99 a month or $20 a year through Dec 31, 2026 11:59 PM ET; $3.99 a month or $30 a year from Jan 1, 2027 | `1467608` |

A Teams plan covers **up to 50 staff per location**. A bigger venue emails hello@tipmynet.com for a larger plan; the price is on request (no price is set: quote each one).

Payments are **ON** in `app/js/billing-config.js` (`provider: 'lemonsqueezy'`). The app decides which product a key unlocks from the `meta.product_id` in LS's reply, and refuses a key for any other product or store with a plain message. Each product has its own license on the device, its own "Remove from this device", its own daily recheck, and its own 14-day offline grace.

## What LS does for you
- It is the "merchant of record": it sells to your customers, collects and pays sales tax and VAT, and handles receipts and chargebacks. You do not register for sales tax.
- Fees: see LS's pricing page.
- Payouts go to the bank account you connect in the LS dashboard (Settings > Payouts).

## What is already done in Lemon Squeezy
Store: **tipnet.lemonsqueezy.com**, store id `487063`, live mode.

| | Teams | Budget |
| --- | --- | --- |
| Product id | `1467595` | `1467608` |
| Monthly variant | `2288791`, $59/month | `2288812`, $1.99/month |
| Yearly variant | `2288799`, $500/year | `2288818`, $20/year |
| License keys | on | on |
| Activation limit | 3 (the manager's devices) | 3 |

Checkout links (in `app/js/billing-config.js`, all `/checkout/buy/<id>?enabled=<variant>` links; the app ignores anything else, such as a `?cart=` link, on purpose):
- Teams monthly: `https://tipnet.lemonsqueezy.com/checkout/buy/9433ca2a-f18f-4f78-aaaa-b256c9339582?enabled=2288791`
- Teams yearly: `https://tipnet.lemonsqueezy.com/checkout/buy/2aa30b1d-617c-4eab-932b-774fd6319fe1?enabled=2288799`
- Budget monthly: `https://tipnet.lemonsqueezy.com/checkout/buy/5860d305-25d3-4e75-80d4-2af7ab13a410?enabled=2288812`
- Budget yearly: `https://tipnet.lemonsqueezy.com/checkout/buy/7960a69b-bd73-40f2-b12d-5e4efdb51063?enabled=2288818`

## What is left for you (owner)
1. **Confirmation-modal and receipt button link.** In LS, on each product (Products > the product > **Confirmation modal** and **Receipt button**), set the link to `https://teams.tipmynet.com/` (DEPLOY.md). Until the DNS record exists, leave the default.
2. **Payout bank account.** Settings > Payouts: connect the bank account.
3. **A 100% discount code** for the test purchase below (Store > Discounts).
4. **The Jan 1, 2027 Budget price change** (steps below).
5. Run the test purchase once for each product before telling anyone the links are live.

## Setting up a product from scratch (reference)
Click by click, if you ever need to redo or add one.
1. LS dashboard > **Products** > **New product**. Name it (TipNet Teams or TipNet Budget). Pricing: **Subscription**.
2. Make two **variants**: Monthly (billed every 1 month) and Yearly (every 1 year), each with its price. Name them "Monthly" and "Yearly": the app reads "month" or "year" in the variant name to label the plan.
3. In the product's **License keys** section turn **Generate license keys** on. **Activation limit: 3.** Never leave it blank: the app unlocks a device by activating the key, and without a limit field LS has nothing to count. License length: leave **unlimited** (the key follows the subscription; LS marks it expired or disabled when the subscription ends or is refunded).
4. **Publish** the product (status Published).
5. Get the checkout links: Products > the product > each variant's **Share** (or the product's share button) > **Copy link**. It must look like `https://STORE.lemonsqueezy.com/checkout/buy/<id>`. Add `?enabled=<variant id>` to make it open on that variant. Never use a `?cart=` link.
6. Where the ids go, in `app/js/billing-config.js`: the product id under `teams.productId` / `budget.productId`, the four links under `checkout.monthly` / `checkout.yearly`, the store id under `storeId`. The product id is in the product's URL in the dashboard (and in every license reply as `meta.product_id`). The variant ids are the numbers after `enabled=`.
7. Keep the old Budget price on its variants until Jan 1, 2027; see "The Jan 1, 2027 price change".
8. Commit, bump `VERSION` in `app/sw.js` (optional for this one file, recommended), push.

## Important: don't edit the app on GitHub's website
Edit files in the project folder on your computer, then use GitHub Desktop to commit and push, as in DEPLOY.md. Editing on the GitHub website at the same time as your computer creates conflicts.

## Testing a purchase without paying
Do this for each product.
1. In LS: **Store > Discounts > New discount**. Make a 100% discount with a code, limited to 1 redemption (apply it to that product's variants).
2. Open the checkout link (or in the app: Setup > "Teams" for Teams, or Budget > a price), enter the code on LS's page, finish with your email. Total $0.
3. Open the email, copy the license key, and paste it in the app (Setup > Teams > "I have a team key", or Budget > "I have a license key", either box works for either key). Tap "Unlock with key". Teams unlocks Teams, Budget unlocks Budget. Also try "Remove from this device".
4. A key from the other product, from another store, or a typo, shows a plain message instead.
5. To test the Staff Perks Credit link: in the app, give an establishment a venue (Phase 2's venue setup), open Budget, tap a price. The address should end with `checkout[custom][venue_id]=<the venue id>`. After the test order, open it in the LS dashboard and see whether the custom data is visible there (the docs do not say it is; see the runbook).
6. The code only covers the first period: cancel the test subscription afterwards (Customers > the customer > subscription > Cancel), unless you want to keep it.

## How customers get their key
- Right after paying, LS emails a receipt that includes the license key.
- They can also sign in at https://app.lemonsqueezy.com/my-orders with the same email, or at your store's billing page (https://tipnet.lemonsqueezy.com/billing), to see orders and keys.
- In the app they paste the key and tap "Unlock with key". This needs a connection once. After that it works offline, and the app quietly rechecks about once a day when online. If a device is offline for more than 14 days the product locks until it is online again. The free app is never locked.

## Cancellations and refunds
- The terms: customers can cancel any time; no refunds. LS's own buyer terms, and any rights local law gives the customer, still apply.
- Cancel: customers cancel on the store billing page (the link is in their receipt email). They keep access until the end of the period they paid for; then the key expires and the product locks on the next recheck.
- If you refund an order in the LS dashboard, the key is disabled and the product locks on the next recheck (or after the 14-day grace if the device is offline).
- A customer stuck at the device limit can tap "Remove from this device" on the old device, or you can remove the activation in the LS dashboard (License keys > the key > its instances).

## Privacy note
The app sends only the license key and a random device name to LS, and only when someone activates, removes a device, or once a day to recheck. No budget, pay or night data ever leaves the device. At Budget checkout the venue code is added to the link as order custom data (the Staff Perks Credit); the Privacy page says so.

## The Jan 1, 2027 price change (Budget: $1.99/$20 to $3.99/$30)
Owner decision: **existing subscribers keep $1.99 a month / $20 a year; new subscribers pay $3.99 / $30** from Jan 1, 2027.

What LS does (its Subscriptions help page, docs.lemonsqueezy.com/help/products/subscriptions, checked Oct 24, 2026): changing a subscription variant's price **does not change existing subscriptions**; they are always charged the price they were created with. Only new subscriptions get the new price. (Moving an existing subscriber to another price takes a plan change, which we never do here.) So the same variants can simply be repriced and no new variants or new checkout links are needed.

The app already switches what it shows at **Jan 1, 2027 00:00 Eastern (05:00 UTC)**: the `after` block of `budget` in `app/js/billing-config.js`. Do the matching LS work **on that day**:
1. In LS, Products > TipNet Budget: edit the **Monthly** variant (`2288812`) price to $3.99 and the **Yearly** variant (`2288818`) price to $30. Save. Existing subscribers stay on $1.99 / $20 automatically. The app only shows prices; it never charges.
2. Open a Budget checkout link in a private window and check it shows $3.99 / $30. Do not pay.
3. Update the written prices in README.md and STAFF-GUIDE.md if you want them to say "now $3.99".
4. License keys: the app accepts any key whose `meta.product_id` is the Budget product (`1467608`), whatever its variant or price, so keys bought at $1.99/$20 and at $3.99/$30 both keep working (tests/teams-billing.test.js checks it). If you ever do make new variants instead, keep them in the same product, put their links under `after.checkout` in the config and keep the old variants (hidden) for the existing subscribers.
5. The Staff Perks Credit uses **what each subscriber actually pays**: an existing $1.99 subscriber still earns $0.50 a month, a new $3.99 one $1.00; yearly $20 earns $0.42 a month, yearly $30 $0.63. In the dashboard, read the price from the subscription (its variant price is the new one, so look at the subscription's own invoice amount).

## Staff Perks Credit: monthly runbook
The rule (also in the Terms and on the manager page): every staff member at a venue who keeps a Budget subscription earns that venue a credit of **25% of what that person pays** ($0.50 a month at $1.99, $1.00 at $3.99; yearly: yearly price / 12 x 25% a month). **Once a month the credit is given as a partial refund on the venue's most recent TipNet Teams payment, to the card that paid it, never more than that payment.** It counts at most **50 staff subscribers per venue** (the plan covers up to 50 staff), so it can never exceed the bill: 50 x $0.50 = $25 now and 50 x $1.00 = $50 from Jan 1, 2027, both under the $59 monthly payment. It counts only active Budget subscriptions, counted monthly, and only while the venue's Teams subscription is active. Managers see only a count, never names.

**What LS supports (checked against LS's docs on Oct 24, 2026):**
- The `checkout[custom][venue_id]=<id>` the app adds to the Budget checkout link comes back as `meta.custom_data.venue_id` in the **webhooks** for orders, subscriptions and license keys (https://docs.lemonsqueezy.com/help/checkout/passing-custom-data).
- The docs do **not** say the custom data is shown in the LS dashboard, and the subscription object in the API does not list it. So you cannot count per venue from the dashboard alone unless your test purchase shows it there. Check that first (Testing a purchase, step 5).
- LS supports a **partial refund of a subscription invoice** through its API (`POST /v1/subscription-invoices/{id}/refund` with an `amount` in cents; docs.lemonsqueezy.com/api/subscription-invoices/issue-refund). The docs do not describe a dashboard button for it on subscription payments (one-time orders can be partly refunded from the Orders page). I found no documented way to put a credit on a subscription's next invoice, or to apply a discount code to a renewal.

**Plain answer: this is a manual monthly step until Phase 3** (a small webhook receiver that records each subscription's `venue_id` and status, and a script that totals the credit). Until then, once a month:
1. **Count.** For each venue, count its Budget subscriptions that are **active** that day (not cancelled, expired, paused or past due) and that carry that `venue_id`. If the dashboard shows the custom data, filter on it. If it does not, create a webhook (Settings > Webhooks) to an endpoint you control (a request-bin page works for a pilot), subscribed to `subscription_created`, `subscription_updated`, `subscription_cancelled`, `subscription_expired`; the saved payloads hold `meta.custom_data.venue_id`, the variant and the status. Those payloads contain customer emails: keep them private and never give a venue anything but the count.
2. **Check the venue** is paying: its Teams subscription must be active that day. If not, no credit that month.
3. **Work out the credit** for each subscription, rounded to the nearest cent, then add them: monthly subscriber = the price that person pays x 25% ($1.99 -> $0.50, $3.99 -> $1.00); yearly subscriber = price / 12 x 25% ($20 -> $0.42, $30 -> $0.63). Count **at most 50** subscriptions per venue; if more than 50 carry the venue's id, count the 50 with the highest credit. Example: 6 monthly at $1.99 and 2 yearly at $20 = 6 x $0.50 + 2 x $0.42 = $3.84.
4. **Record it** in a simple sheet: month, venue id, venue name, count, credit, applied (yes/no), amount applied. Keep it with the count only; never write staff names.
5. **Refund it.** Find the venue's **most recent paid TipNet Teams payment** (its latest subscription invoice) and issue a **partial refund** of the credit amount with the LS API **issue-refund** endpoint: `POST https://api.lemonsqueezy.com/v1/subscription-invoices/{invoice id}/refund`, headers `Accept` and `Content-Type` `application/vnd.api+json` and `Authorization: Bearer <API key>`, body `{"data":{"type":"subscription-invoices","id":"<invoice id>","attributes":{"amount":<credit in cents>}}}` (docs.lemonsqueezy.com/api/subscription-invoices/issue-refund; the docs' example sends 100 and reports $1.00, so the amount is in cents; leaving `amount` out refunds the **whole** invoice, so never leave it out). The money goes back to the card that paid. The API key is made in Settings > API; keep it private.
6. **Never more than that payment.** The refund is capped at the amount of that payment. With the 50-subscriber cap this cannot happen on a monthly plan; for a yearly plan, refund the month's credit on the yearly payment (it is far larger). Nothing carries over and nothing is paid any other way.
7. Tell the venue the **count** and the amount refunded. Not names.

This stays a manual step, once a month, until Phase 3 automates the count and the refund call.
