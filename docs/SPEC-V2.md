# Auto Budget version 2: Premium

Version 1 (see `SPEC.md`) is deployed and in use. Version 2 adds **Auto Budget Premium**: a set of new paid features, a paywall that explains them, a single one-time purchase through **Google Play's in-app billing** that unlocks them for good, and the entitlement system that locks and unlocks them.

Premium is **bought only in the Android app** (see `SPEC-NATIVE.md`). The web app and the Android app share one backend and one database, so a purchase made on Android unlocks Premium on the web too when the user signs in with the same account. The web app never sells Premium.

Everything in `SPEC.md` still applies (architecture rules, design tokens, responsive layout, portability, privacy). The Google Play purchase flow, verification and release steps are specified in `SPEC-NATIVE.md`. Where this document and `SPEC.md` disagree, this document wins for version 2 work.

## Principles

1. **Nothing free becomes paid.** Every feature that exists in version 1 stays free forever, including optional sign-in, online backup and sync, the safe credit card payment, the breakdown with what-if slider and single-card payoff schedule, the auto-generated budget, and export/import.
2. **Premium is only new features.** Each one either costs money to run or goes beyond everyday budgeting.
3. **Locked features are visible, not hidden.** Free users see an entry point with a "Premium" badge. Opening it shows what the feature does and a "See Premium" button, never the feature itself.
4. **The user's data is always theirs.** If a free trial ends or a purchase is refunded, premium features lock again but no data is deleted, and export keeps working.
5. **Premium requires an account.** The entitlement lives on the server, tied to the signed-in user. Guests are asked to sign in first.
6. **Never trust the client for payment state.** Only server code, after verifying the purchase with the Google Play Developer API, can grant Premium.
7. **One entitlement everywhere.** Premium is stored once per user in the shared database and read by both the web and Android apps.

## Free and Premium

| Area | Free | Premium |
|---|---|---|
| Tracking, accounts, categories, fixed bills | Yes | Yes |
| Auto-generated monthly budget | Yes | Yes |
| Safe credit card payment, breakdown, what-if slider | Yes | Yes |
| Payoff schedule for one card at a fixed payment | Yes | Yes |
| Sign-in, online backup and sync | Yes | Yes |
| Export and import | Yes | Yes |
| **Debt payoff planner** (all cards and loans, strategies, debt-free date goal) | Locked | Yes |
| **Reports and trends** (month-to-month comparisons, yearly summary, PDF export) | Locked | Yes |
| **Recurring transactions** | Locked | Yes |

Planned for a later release, also Premium, not built now: shared budget with a partner, savings goals, AI budget advice. Email or push reminders are deliberately excluded: with a one-time price they would be an open-ended running cost.

## Price and trial

Premium is a **one-time purchase that unlocks all premium features permanently** for that account. There are no plans to choose between, no renewals and no expiry.

- **Google Play product:** one one-time (non-consumable) product, ID `premium_unlock`. Its price is set in Play Console (default suggestion ₱399), so it can change without an app release. The Android app always shows the localised price returned by Google Play; never hard-code it.
- **Free trial:** 14 days, once per account, no payment details. It can be started in **either app**, because it is granted by our own server, not by Google Play. When it ends without a purchase, premium features lock.
- Buying during a trial unlocks Premium permanently straight away.
- An account that owns Premium cannot buy again; the paywall is replaced by the Premium status screen.
- Feature flags: `VITE_PREMIUM_ENABLED` (web) and `EXPO_PUBLIC_PREMIUM_ENABLED` (Android). When a flag is not `true`, that app shows no premium entry points, badges or paywall and behaves like version 1.

## Entitlements

### Server (PostgreSQL, new migrations only; never edit version 1 migrations)

- `entitlements`: `user_id` (primary key, references the auth user), `plan` (`free` | `premium`), `source` (`trial` | `purchase` | `grant`), `starts_at`, `expires_at` (set for a trial; **null means permanent**), `trial_used` (boolean), `updated_at`.
- `purchases`: `id`, `user_id`, `provider` (`google_play`), `provider_payment_id` (the Google Play purchase token, unique), `order_id`, `product_id`, `amount_micros` and `currency` (as reported by Google, for records only), `status` (`pending` | `paid` | `refunded`), `acknowledged` (boolean), `is_test` (boolean, true for Google Play test purchases), `paid_at`, `created_at`, `raw` (Google's response, JSON).
- Row-level security: a user may **select** only their own rows in `entitlements` and `purchases`. No client may insert, update or delete in these tables. Only server functions using the service role write to them.
- `start_trial()`: a security-definer function. If the caller has not used a trial, set `plan = premium`, `source = trial`, `expires_at = now() + 14 days`, `trial_used = true`. Otherwise raise an error.
- `grant_premium(user_id, expires_at)`: service role only, for support cases and testers; sets `source = grant`, with `expires_at` null for permanent.
- `tester_grants`, `revoke_tester_grants()` and `revoke_test_entitlements()`: see "Premium for testers" in `SPEC-NATIVE.md`. Service role only.
- Add tests that a user cannot write to `entitlements` or `purchases` and cannot read another user's rows.

### Client

- `packages/premium/features.ts` (shared by both apps) is the single registry of premium features: `id`, `name`, one-line `benefit`, longer `description`, icon. The paywall, locked screens and Settings all read from it, so the list of benefits is written once.
- `useEntitlement()` returns `{ isPremium, source, expiresAt, daysLeft, trialAvailable, loading }`. `isPremium` is true when `plan = premium` and `expires_at` is either null (purchased) or in the future (trial). Also return `isLifetime`.
- Cache the last known entitlement locally (IndexedDB on web, SQLite on Android). Offline, a purchased Premium keeps working indefinitely; a trial keeps working until the cached `expiresAt`, then locks.
- `<PremiumGate feature="reports">` renders its children for Premium users and the locked view otherwise. Use it for every premium screen and control. Do not scatter `isPremium` checks through components.
- Refresh the entitlement on app open, after sign-in, after a purchase or restore, and when the app returns to the foreground.
- All premium features run on the device and are gated in the interface. The server's only premium job is granting the entitlement.

### When a trial ends or a purchase is refunded

- Premium screens return to their locked view.
- Data created with premium features is kept and still syncs: loans stay as accounts, recurring templates are kept but stop creating transactions.
- Show one dismissible notice on Home: "Your free trial ended on [date]. Everything free still works." with an "Unlock Premium" button.
- Show an in-app notice 3 days before a trial ends, and send one email the day before.

## Payments

- Premium is sold only through **Google Play Billing in the Android app**. `SPEC-NATIVE.md` ("Google Play billing") defines the Play Console product, the `StoreBilling` interface, the purchase flow, the `verify-play-purchase` and `play-notifications` server functions, restore, refunds and tester setup.
- The web app has no checkout, no payment provider and no payment links. Its paywall explains that Premium is unlocked in the Android app (see "Web paywall" below).
- In the Android app, do not mention or link to any other way of paying.
- Google Play sends the purchase receipt; the app does not email receipts.
- Log verification and notification failures on the server so they can be investigated.

## Paywall and locked states

### Entry points (all hidden when `VITE_PREMIUM_ENABLED` is off)

- **Settings:** a prominent "Auto Budget Premium" card at the top. Free: "Try free for 14 days" (or, when the trial is used, "Unlock for [price], one time" on Android and "Unlock in the Android app" on web). Trial: "Free trial: [N] days left". Purchased: "Unlocked".
- **Home:** a "Reports" card with a Premium badge.
- **Credit card breakdown:** a "Plan all your debts" card with a Premium badge under the payoff schedule.
- **Add transaction:** a "Repeat" row with a Premium badge.
- **Navigation on wider screens:** a "Premium" section with "Reports" and "Debt planner" in the sidebar or navigation rail, with a small lock icon for free users.

Tapping any locked entry opens that feature's locked view.

### Locked feature view

- The feature name with a "Premium" badge and a lock icon.
- Two or three sentences on what it does for the user, in terms of their own data where possible ("See how your spending in each category changed over your last 6 months").
- A static, non-interactive preview illustration of the feature. Never render the user's real premium results behind a blur.
- Primary button "See Premium" opening the paywall with this feature listed first.

### Android paywall

In this order:

1. Title "Auto Budget Premium" and one line of value: "Clear your debts faster and see where your money goes."
2. The benefits list from the feature registry: name and one-line benefit for each, with a check icon.
3. One price card: "One-time purchase", the localised price from Google Play, and "Pay once, keep it for good. No monthly fees."
4. Payment note: "Paid securely through Google Play."
5. Primary button. If the trial is available: "Start 14-day free trial", with "No payment needed" under it and a secondary "Skip trial and buy for [price]". If the trial is running or used: "Unlock Premium for [price]".
6. "Restore purchase" link.
7. Reassurance: "Everything you use today stays free."
8. Links to Terms, Refunds and Privacy Policy.

If the user is a guest, the primary button first opens Sign in with the message "Sign in so your Premium is saved to your account", then returns to the paywall. If Google Play is unavailable, show "Google Play isn't available right now" and disable the purchase button (the trial button still works).

### Web paywall (`/premium`)

1. The same title, value line and benefits list.
2. If the trial is available: "Start 14-day free trial" with "No payment needed".
3. An explanation card: "Premium is unlocked in the Auto Budget Android app. Buy it once there and it works here too when you sign in with the same account."
4. A "Get the Android app" button linking to the Google Play listing (`VITE_PLAY_STORE_URL`), and for signed-in users a "Already bought it? Refresh" link that re-checks the entitlement.
5. Reassurance: "Everything you use today stays free." No price is shown on the web.

On `md` and larger both paywalls are centred cards up to 560px wide, with benefits and the price or explanation side by side from `lg`.

### Premium status screen (signed in with Premium or a trial)

- **Purchased:** "Premium unlocked" badge, "Yours for good", and "One-time payment · nothing to renew".
- **Trial:** "Free trial" badge, "Ends [date]", days left, and an "Unlock Premium for ₱399" button with "Pay once, keep it for good".
- The benefits list, each linking to its feature.
- Purchase record: "Bought through Google Play on [date]" with the order ID, and a note that refunds are requested through Google Play. On the web, the same record without the Restore link.

### Copy rules

- Say "Premium" for the product and "one-time purchase" for the purchase. Never say "subscription", "subscribe", "plan" or "renew" in the interface. Use "Unlock Premium" or "Buy" on buttons.
- No countdown timers, fake discounts or pressure wording.
- Show prices with the peso sign and no decimals when whole.

## Premium features

All calculation code goes in `packages/core/` as pure TypeScript with unit tests, shared by both apps.

### 1. Debt payoff planner

- **Debts covered:** every credit card, plus a new account type `loan` with `balance`, `monthlyInterestRate`, `minimumPayment` and `dueDay`. Creating and tracking a loan account is free; planning across debts is Premium.
- **Monthly amount for debts:** defaults to the safe credit card payment; the user can change it. It can never be below the sum of minimum payments, and the planner warns when the safe amount does not cover them.
- **Strategies:** highest interest first, smallest balance first, or a custom order set by dragging. Pay every debt's minimum, then put the remainder toward the first debt in the order; when one is cleared, its payment rolls to the next.
- **One-off extra payments:** amount and month (for example 13th-month pay in December).
- **Results:** payoff month for each debt, the debt-free date, total interest, and a comparison against paying only minimums (months and interest saved). Show a month-by-month schedule and a simple balance-over-time chart.
- **Goal mode:** the user picks a debt-free date; the planner returns the monthly amount required and, if it is above the safe amount, how much optional spending would need to be cut.
- `simulateDebts(debts, monthlyAmount, strategy, extras)` is pure and capped at 360 months, returning `neverPaysOff` when payments do not exceed interest.
- This month's planned payment per debt appears on Home in place of the single card payment row when the planner is in use.

### 2. Reports and trends

- **Periods:** budget months (payday to payday), last 3, 6 or 12, and a calendar-year summary.
- **Views:** spending by category per month (stacked bars); income against spending per month; one category over time with its budget line; biggest increases and decreases versus the previous month; total card and loan balance over time; planned versus actual for a chosen month.
- **Insights in plain sentences**, generated by rules, not AI: for example "Dining out rose 3 months in a row" or "You stayed within budget in 5 of the last 6 months".
- **Export:** the current report as PDF and its figures as CSV.
- Charts follow the app's colour tokens in light and dark, never rely on colour alone, and have text alternatives.
- Free users keep the current month's summary on Home.

### 3. Recurring transactions

- **Template:** type, amount, category, account, note, schedule (monthly on a day, twice a month, weekly, every N weeks), start date, optional end date, optional link to a fixed bill.
- **Creation:** when the app opens or syncs, create any due occurrences up to today. Each occurrence has a deterministic id from the template id and date, so two devices cannot create duplicates.
- **Control:** each template can be paused, edited (future occurrences only) or deleted (past transactions stay). Created transactions are marked "Recurring" and can be edited individually.
- Templates are a new synced table with the same sync fields as other records.

## Legal and policy pages

- Add `/terms` (Terms of Service) and `/refunds` pages in both apps, rendering `TERMS.md` and `REFUNDS.md` from the repository root. Create both with clear section headings and `[PLACEHOLDER]` markers for the owner to complete; do not invent legal terms. The refunds page explains that purchases are made through Google Play and refunds are requested through Google Play under its policies.
- `PRIVACY.md` has been updated for Google Play purchases; render it as before in both apps.
- The app still has no analytics or tracking. Measure Premium uptake from the `entitlements` and `purchases` tables.

## Compatibility with version 1

- Existing users and data must keep working with no action on their part.
- Server changes are additive migrations in the shared `supabase/migrations/`. The web app's local database gets a new Dexie version with an upgrade step; never drop or rename existing stores or fields.
- A version 1 web client that has not updated yet must still sync correctly with the version 2 server, as must older Android versions.
- With the premium flag off, each app is indistinguishable from version 1 apart from the new `loan` account type.

## Design reference

The design canvas "Auto Budget mobile app" includes version 2 screens. Treat them as the visual reference; where they disagree with this document, this document wins.

- **Phone (Light and Dark pages):** the Android paywall, the web paywall, a locked feature (Reports), Premium unlocked, the debt payoff planner, reports and trends, and recurring transactions. Home, the credit card breakdown and Add transaction show the free-user entry points ("Reports and trends", "Plan all your debts", "Repeat"), each with a Premium badge.
- **Tablet and desktop pages:** the Android paywall on tablet, the web paywall on desktop, the debt payoff planner and reports, plus a "Premium" section in the sidebar and navigation rail.

Sample figures for the debt planner, usable as a test fixture: credit card ₱50,000 at 3% a month with a ₱2,500 minimum; personal loan ₱30,000 at 1.5% a month with a ₱2,000 minimum; ₱15,000 a month toward debts; one extra payment of ₱10,000 in December 2026; first payment in November 2026. Each month, pay every minimum, put the remainder toward the first debt in the order, then add interest on what is left. Expected results:

- Highest interest first: card cleared Feb 2027, loan Mar 2027; debt-free in 5 months; about ₱3,020 interest.
- Smallest balance first: loan cleared Dec 2026, card Mar 2027; debt-free in 5 months; about ₱4,190 interest.
- Minimums only: 30 months; about ₱27,400 interest.

## Build order

This work runs alongside `SPEC-NATIVE.md`: its steps 1 to 5 (monorepo, Android app, shared sign-in and sync, first test release) come first, then the steps below, then its Google Play billing step.

1. Migrations for `entitlements`, `purchases`, the trial and grant functions, and their security tests.
2. Feature registry, entitlement logic, local entitlement cache and `PremiumGate` in `packages/premium`, used by both apps, plus the flags.
3. Paywalls (Android and web), locked feature view, Premium status screen and all entry points, with the trial working end to end in both apps.
4. Trial end and refunds: locking, notices, the trial-ending email, and blocking a second purchase.
5. Debt payoff planner.
6. Reports and trends.
7. Recurring transactions.
8. Google Play billing (from `SPEC-NATIVE.md`), tested with license testers.
9. Terms and refunds pages, `DEPLOY.md` updates, and a full pass of free and premium flows in both apps at all testing widths in light and dark.

## Test scenarios

- Guest taps a locked feature, signs in, starts the trial, and the feature unlocks without a reload, in both apps.
- Trial cannot be started twice on one account, even across web and Android.
- Buying during a trial unlocks Premium permanently at once.
- An account that already owns Premium cannot start a second purchase.
- Buying on Android unlocks Premium on the web after signing in with the same account.
- The same purchase token sent twice is processed only once.
- A purchase token belonging to another account is refused.
- A tampered client cannot grant itself Premium on the server.
- A trial ends while the app is offline: features lock at the cached expiry time. A purchased Premium keeps working offline indefinitely.
- After a trial ends: loans and recurring templates still exist; nothing is deleted.
- A Google Play refund returns the account to free in both apps.
- The web app shows no price, checkout or payment link anywhere.
- With the flag off, no premium interface appears anywhere.
- A license tester's test purchase grants Premium and is stored with `is_test = true`.
- A tester grant applies on first sign-in with the matching email, and is removed by `revoke_tester_grants()`.
