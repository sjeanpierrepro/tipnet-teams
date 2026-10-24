# Payments (TipNet Teams and TipNet Budget)

Two products are sold, both through **Lemon Squeezy** (LS), which is the only payment service in use. Customers pay on LS's checkout page, LS emails them a license key, they paste the key into the app and the product unlocks. You run no server.

| Product | Sold to | Price | LS product id |
| --- | --- | --- | --- |
| **TipNet Teams** | venues (managers), per location | $59 a month or $500 a year, no setup fee | `1467595` |
| **TipNet Budget** ("Staff Budget") | individual staff | $1.99 a month or $20 a year through Dec 31, 2026 11:59 PM ET; $3.99 a month or $30 a year from Jan 1, 2027 | `1467608` |

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
The app already switches what it shows at **Jan 1, 2027 00:00 Eastern (05:00 UTC)**: the `after` block of `budget` in `app/js/billing-config.js`. Do the matching LS work **on that day**:
1. In LS, edit the Budget Monthly variant price to $3.99 and the Yearly variant price to $30. Decide first whether existing subscribers keep their price: LS asks on the price change whether to apply it to existing subscriptions. The app only shows prices; it never charges.
2. If you prefer new variants instead, create them, then put their links under `after.checkout` in the config (the app uses them from that moment) and publish the old variants as hidden.
3. Update the written prices in README.md and STAFF-GUIDE.md if you want them to say "now $3.99".
4. The Staff Perks Credit follows the new price automatically in the formula below (25% of what each person pays: $1.00 a month at $3.99; yearly $30 / 12 x 25% = $0.63).

## Staff Perks Credit: monthly runbook
The rule (also in the Terms and on the manager page): every staff member at a venue who keeps a Budget subscription earns that venue a credit of **25% of what that person pays** ($0.50 a month at $1.99, $1.00 at $3.99; yearly: yearly price / 12 x 25% a month). The credit applies to the venue's next TipNet Teams bill, down to $0, never as cash. It counts only active Budget subscriptions, counted monthly, and only while the venue's Teams subscription is active. Managers see only a count, never names.

**What LS supports (checked against LS's docs on Oct 24, 2026):**
- The `checkout[custom][venue_id]=<id>` the app adds to the Budget checkout link comes back as `meta.custom_data.venue_id` in the **webhooks** for orders, subscriptions and license keys (https://docs.lemonsqueezy.com/help/checkout/passing-custom-data).
- The docs do **not** say the custom data is shown in the LS dashboard, and the subscription object in the API does not list it. So you cannot count per venue from the dashboard alone unless your test purchase shows it there. Check that first (Testing a purchase, step 5).
- LS supports a **partial refund of a subscription invoice** through its API (`POST /v1/subscription-invoices/{id}/refund` with an `amount` in cents; docs.lemonsqueezy.com/api/subscription-invoices/issue-refund). The docs do not describe a dashboard button for it on subscription payments (one-time orders can be partly refunded from the Orders page). I found no documented way to put a credit on a subscription's next invoice, or to apply a discount code to a renewal.

**Plain answer: this is manual until Phase 3** (a small webhook receiver that records each subscription's `venue_id` and status, and a script that totals the credit). Until then, once a month:
1. **Count.** For each venue, count its Budget subscriptions that are **active** that day (not cancelled, expired, paused or past due) and that carry that `venue_id`. If the dashboard shows the custom data, filter on it. If it does not, create a webhook (Settings > Webhooks) to an endpoint you control (a request-bin page works for a pilot), subscribed to `subscription_created`, `subscription_updated`, `subscription_cancelled`, `subscription_expired`; the saved payloads hold `meta.custom_data.venue_id`, the variant and the status. Those payloads contain customer emails: keep them private and never give a venue anything but the count.
2. **Check the venue** is paying: its Teams subscription must be active that day. If not, no credit that month.
3. **Work out the credit** for each subscription, rounded to the nearest cent, then add them: monthly subscriber = price x 25% ($1.99 -> $0.50, $3.99 -> $1.00); yearly subscriber = price / 12 x 25% ($20 -> $0.42, $30 -> $0.63). Example: 6 monthly at $1.99 and 2 yearly at $20 = 6 x $0.50 + 2 x $0.42 = $3.84.
4. **Record it** in a simple sheet: month, venue id, venue name, count, credit, applied (yes/no), amount applied. Keep it with the count only; never write staff names.
5. **Apply it to the venue's next Teams bill.** The cleanest documented route is the partial refund on the venue's **latest paid Teams invoice**, for the credit amount (capped at that invoice). It nets the same dollars off, but note it returns to the venue's card, not as an account credit: tell the venue "your credit is taken off your bill as a partial refund". Monthly venues: refund up to the credit from the invoice after the month counted. Yearly venues: add each month's credit to the sheet and refund the running total (up to the invoice) right after the renewal.
6. **Down to $0, never cash.** If the credit is more than the bill, refund no more than the invoice amount. The leftover is not paid out; whether it carries to the next month is an owner decision (the Terms do not promise it carries; the sheet should start the next month at $0 unless you decide otherwise).
7. Tell the venue the **count** and the amount taken off. Not names.

If you would rather not refund to a card, the alternative is to bill the venue less by hand (cancel and restart the subscription at a lower price). That changes the subscription and is error prone: use the partial refund until Phase 3 builds something better.
