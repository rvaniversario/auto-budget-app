# Auto Budget version 2: Premium

Version 1 (see `SPEC.md`) is deployed and in use. Version 2 adds **Auto Budget Premium**: a set of new paid features, a paywall that explains them, a single one-time payment through a Philippine payment gateway that unlocks them for good, and the entitlement system that locks and unlocks them.

Everything in `SPEC.md` still applies (architecture rules, design tokens, responsive layout, portability, privacy). Where this document and `SPEC.md` disagree, this document wins for version 2 work.

## Principles

1. **Nothing free becomes paid.** Every feature that exists in version 1 stays free forever, including optional sign-in, online backup and sync, the safe credit card payment, the breakdown with what-if slider and single-card payoff schedule, the auto-generated budget, and export/import.
2. **Premium is only new features.** Each one either costs money to run or goes beyond everyday budgeting.
3. **Locked features are visible, not hidden.** Free users see an entry point with a "Premium" badge. Opening it shows what the feature does and a Subscribe button, never the feature itself.
4. **The user's data is always theirs.** If a free trial ends or a purchase is refunded, premium features lock again but no data is deleted, and export keeps working.
5. **Premium requires an account.** The entitlement lives on the server, tied to the signed-in user. Guests are asked to sign in first.
6. **Never trust the client for payment state.** Only server code, after a verified gateway webhook, can grant Premium.

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

Premium is a **one-time payment that unlocks all premium features permanently** for that account. There are no plans to choose between, no renewals and no expiry.

| Product code | Price | Shown as |
|---|---|---|
| `premium_lifetime` | ₱399 | "₱399 once" |

- The price is the owner's decision; ₱399 is a default kept in one server-side config so it can change without a code release. Never hard-code it in the client.
- **Free trial:** 14 days, once per account, no payment details. It starts when the user taps "Start 14-day free trial". When it ends without a purchase, premium features lock.
- Paying during a trial unlocks Premium permanently straight away.
- A paid account cannot buy again; the paywall is replaced by the Premium status screen.
- Add `VITE_PREMIUM_ENABLED`. When it is not `true`, the app shows no premium entry points, badges or paywall and behaves exactly like version 1.

## Entitlements

### Server (PostgreSQL, new migrations only; never edit version 1 migrations)

- `entitlements`: `user_id` (primary key, references the auth user), `plan` (`free` | `premium`), `source` (`trial` | `purchase` | `grant`), `starts_at`, `expires_at` (set for a trial; **null means permanent**), `trial_used` (boolean), `updated_at`.
- `purchases`: `id`, `user_id`, `provider`, `provider_payment_id` (unique), `product_code`, `amount` (integer centavos), `currency`, `status` (`pending` | `paid` | `failed` | `refunded`), `paid_at`, `created_at`, `raw` (the provider's event, JSON).
- `products`: `code`, `amount`, `active`. Seed with the table above.
- Row-level security: a user may **select** only their own rows in `entitlements` and `purchases`. No client may insert, update or delete in these tables. Only server functions using the service role write to them. `products` is readable by everyone.
- `start_trial()`: a security-definer function. If the caller has not used a trial, set `plan = premium`, `source = trial`, `expires_at = now() + 14 days`, `trial_used = true`. Otherwise raise an error.
- `grant_premium(user_id)`: service role only, for support cases; sets a permanent entitlement with `source = grant`.
- Add tests that a user cannot write to `entitlements` or `purchases` and cannot read another user's rows.

### Client

- `src/premium/features.ts` is the single registry of premium features: `id`, `name`, one-line `benefit`, longer `description`, icon. The paywall, locked screens and Settings all read from it, so the list of benefits is written once.
- `useEntitlement()` returns `{ isPremium, source, expiresAt, daysLeft, trialAvailable, loading }`. `isPremium` is true when `plan = premium` and `expires_at` is either null (purchased) or in the future (trial). Also return `isLifetime`.
- Cache the last known entitlement in IndexedDB. Offline, a purchased Premium keeps working indefinitely; a trial keeps working until the cached `expiresAt`, then locks.
- `<PremiumGate feature="reports">` renders its children for Premium users and the locked view otherwise. Use it for every premium screen and control. Do not scatter `isPremium` checks through components.
- Refresh the entitlement on app open, after sign-in, after returning from checkout, and when the app regains focus.
- All premium features run on the device and are gated in the interface. The server's only premium job is granting the entitlement.

### When a trial ends or a purchase is refunded

- Premium screens return to their locked view.
- Data created with premium features is kept and still syncs: loans stay as accounts, recurring templates are kept but stop creating transactions.
- Show one dismissible notice on Home: "Your free trial ended on [date]. Everything free still works." with an "Unlock Premium" button.
- Show an in-app notice 3 days before a trial ends, and send one email the day before.

## Payments

### Approach

- Use **PayMongo hosted Checkout** for one-time payments with GCash, Maya, cards and QR Ph. The app never sees or stores card or wallet details.
- Put all gateway code behind a `PaymentProvider` interface on the server so the gateway can be replaced.
- **Read PayMongo's current API documentation before writing this code** and follow it for endpoints, payload shapes, webhook event names and signature verification. Do not rely on memory.
- Secret keys live only in server environment variables. Use test keys in development and document the switch to live keys in `DEPLOY.md`.

### Flow

1. The signed-in user taps Pay. The client calls the server function `create-checkout`.
2. `create-checkout` checks the user's session, refuses if the user already owns Premium, loads the price from `products` (never from the client), inserts a `pending` purchase, creates a checkout session with the purchase id and user id in its metadata, and returns the checkout URL.
3. The browser goes to the hosted checkout page. Success returns to `/premium/success`, cancel returns to `/premium`.
4. The gateway calls the `payment-webhook` server function. It verifies the signature, ignores events it has already processed (`provider_payment_id` is unique), marks the purchase `paid`, and sets the entitlement to `plan = premium`, `source = purchase`, `expires_at = null`.
5. `/premium/success` shows "Confirming your payment…" and re-checks the entitlement every 2 seconds for up to 60 seconds. When Premium is active it shows the success state. If it times out, it says the payment is still being confirmed, that Premium will unlock automatically, and gives the support email.
6. On a refund event, mark the purchase `refunded` and set the entitlement back to `free`.

### Other requirements

- A "Receipts" list on the Premium status screen, read from `purchases`: date, item, amount, payment method if provided, status.
- Email a receipt after each successful payment.
- All amounts are integer centavos in PHP.
- Log webhook failures on the server so they can be investigated.
- If the app is later wrapped for the Google Play or Apple stores, in-app digital purchases generally must use the store's own billing. Keep `PaymentProvider` and the product config abstract enough that a store billing provider can be added.

## Paywall and locked states

### Entry points (all hidden when `VITE_PREMIUM_ENABLED` is off)

- **Settings:** a prominent "Auto Budget Premium" card at the top. Free: "Try free for 14 days" (or "Unlock for ₱399, one time" when the trial is used). Trial: "Free trial: [N] days left". Purchased: "Unlocked".
- **Home:** a "Reports" card with a Premium badge.
- **Credit card breakdown:** a "Plan all your debts" card with a Premium badge under the payoff schedule.
- **Add transaction:** a "Repeat" row with a Premium badge.
- **Navigation on `lg` and up:** "Reports" and "Debt planner" in the sidebar with a small lock icon for free users.

Tapping any locked entry opens that feature's locked view.

### Locked feature view

- The feature name with a "Premium" badge and a lock icon.
- Two or three sentences on what it does for the user, in terms of their own data where possible ("See how your spending in each category changed over your last 6 months").
- A static, non-interactive preview illustration of the feature. Never render the user's real premium results behind a blur.
- Primary button "See Premium" opening the paywall with this feature listed first.

### Paywall screen (`/premium`)

In this order:

1. Title "Auto Budget Premium" and one line of value: "Clear your debts faster and see where your money goes."
2. The benefits list from the feature registry: name and one-line benefit for each, with a check icon.
3. One price card: "One-time payment", the price, and "Pay once, keep it for good. No monthly fees."
4. Payment note: "Pay with GCash, Maya, card or QR Ph."
5. Primary button. If the trial is available: "Start 14-day free trial", with "No payment needed" under it and a secondary "Skip trial and pay ₱399". If the trial is running or used: "Unlock Premium for ₱399".
6. Reassurance: "Everything you use today stays free."
7. Links to Terms, Refund policy and Privacy Policy.

If the user is a guest, the primary button first opens Sign in with the message "Sign in so your Premium is saved to your account", then returns to the paywall.

On `md` and larger the paywall is a centred card up to 560px wide, with benefits and the price card side by side from `lg`.

### Premium status screen (signed in with Premium or a trial)

- **Purchased:** "Premium unlocked" badge, "Yours for good", and "One-time payment · nothing to renew".
- **Trial:** "Free trial" badge, "Ends [date]", days left, and an "Unlock Premium for ₱399" button with "Pay once, keep it for good".
- The benefits list, each linking to its feature.
- Receipts list.

### Copy rules

- Say "Premium" for the product and "one-time payment" for the purchase. Never say "subscription", "subscribe", "plan" or "renew" in the interface. Use "Unlock Premium" or "Pay" on buttons.
- No countdown timers, fake discounts or pressure wording.
- Show prices with the peso sign and no decimals when whole.

## Premium features

All calculation code goes in `src/core/` as pure TypeScript with unit tests, as in version 1.

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

- Add `/terms` (Terms of Service) and `/refunds` (Refund policy) pages rendering `TERMS.md` and `REFUNDS.md` from the project root. Create both files with clear section headings and `[PLACEHOLDER]` markers for the owner to complete; do not invent legal terms or a refund period.
- `PRIVACY.md` has been updated for payments; render it as before.
- The app still has no analytics or tracking. Measure Premium uptake from the `entitlements` and `purchases` tables.

## Compatibility with version 1

- Existing users and data must keep working with no action on their part.
- Server changes are additive migrations. The local database gets a new Dexie version with an upgrade step; never drop or rename existing stores or fields.
- A version 1 client that has not updated yet must still sync correctly with the version 2 server.
- With `VITE_PREMIUM_ENABLED` off, the deployed app is indistinguishable from version 1 apart from the new `loan` account type.

## Build order

Keep the app deployable after each step, with premium hidden behind the flag until step 5 is verified with test payments.

1. Migrations for `products`, `entitlements`, `purchases`, the trial and grant functions, and their security tests.
2. Feature registry, `useEntitlement`, entitlement cache, `PremiumGate`, and the flag.
3. Paywall, locked feature view, Premium status screen and all entry points, with the trial working end to end.
4. `PaymentProvider`, `create-checkout` and `payment-webhook` with PayMongo test keys, the success page, receipts and the receipt email.
5. Trial end and refunds: locking, notices, the trial-ending email, and blocking a second purchase.
6. Debt payoff planner.
7. Reports and trends.
8. Recurring transactions.
9. Terms and refund pages, `DEPLOY.md` updates (keys, webhook URL, going live), and a full pass of free and premium flows at all testing widths in light and dark.

## Test scenarios

- Guest taps a locked feature, signs in, starts the trial, and the feature unlocks without a reload.
- Trial cannot be started twice on one account.
- Paying during a trial unlocks Premium permanently at once.
- An account that already owns Premium cannot start a second checkout.
- A duplicate webhook is processed only once.
- A webhook with a bad signature is rejected.
- A tampered client cannot grant itself Premium on the server.
- A trial ends while the app is offline: features lock at the cached expiry time. A purchased Premium keeps working offline indefinitely.
- After a trial ends: loans and recurring templates still exist; nothing is deleted.
- A refund returns the account to free.
- With the flag off, no premium interface appears anywhere.
