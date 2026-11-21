# Auto Budget: web app specification

Build a mobile-first personal budgeting web app called **Auto Budget**. It runs in the browser, installs to a phone's Home Screen as a PWA, and works offline.

## The problem it solves

The user gets paid on a schedule (monthly, twice a month, weekly or daily) and wants to know where their money can go without running short. Auto Budget generates a budget for every spending category automatically from the transactions they log, so they never allocate by hand. Users who carry a credit card balance (for example ₱50,000) can switch on one more number in Settings: **how much they can safely pay on their credit card this month** (for example ₱15,000), worked out from their pay, fixed bills and last month's spending. It is off by default.

Target users: anyone with regular pay who wants a simple, automatic budget, wherever they live. Amounts are shown in pesos (₱) for now. Language is English.

## Tech stack

- React + Vite + TypeScript (strict mode)
- React Router for screens
- Tailwind CSS, with the design tokens below set in the Tailwind config
- shadcn/ui for UI components (see "UI components" below)
- Dexie (IndexedDB) for local storage, with `useLiveQuery` from `dexie-react-hooks` so screens update automatically when data changes
- React Hook Form with Zod for form validation (add/edit transaction, settings)
- vite-plugin-pwa for the manifest, service worker and offline caching
- Vitest for unit tests
- Deploy target: Vercel (static build) now, a VPS with Docker and Caddy later (see "Portability")

No backend in version 1. All data stays on the device. Cloud sync with accounts (Supabase) comes later as a paid feature, so the code must be ready for it without being built now.

## Architecture rules

1. **Core logic is framework-free.** Put every calculation in `src/core/` as pure TypeScript functions with no React, DOM or storage imports. This code will later be reused unchanged in a React Native app.
2. **Storage sits behind an interface.** Define a `Repository` interface in `src/data/` (for example `listTransactions`, `addTransaction`, `updateTransaction`, `deleteTransaction`, and the same for accounts, bills, categories and settings). Implement it with Dexie. Screens and hooks call the repository, never Dexie directly.
3. **Money is stored as integer centavos.** Never use floating point for amounts. Format for display with a helper (`₱15,000`, `₱1,234.50`).
4. **Sync-ready records.** Every record has `id` (UUID), `createdAt`, `updatedAt` and `deletedAt` (soft delete). Deleting sets `deletedAt` instead of removing the row.
5. **Unit tests cover all of `src/core/`**, including edge cases listed below.

## Data model

- **Settings**: `monthlySalary` (legacy, unused: income comes from logged income transactions), `payFrequency` (`"monthly"` now; keep the field so `"semimonthly"` can be added later), `paydayDay` (1–31), `bufferAmount` (default ₱3,000), `theme` (`"light" | "dark" | "system"`), `onboardingComplete` (set automatically when the budget is first created), `safePaymentEnabled` (optional, off when missing), `carryOverEnabled` (optional, off when missing: adds income − spending − payments to cards, loans and debts from all earlier budget months to this month's income; negative when overspent).
- **Account**: `name`, `type` (`"cash" | "bank" | "credit_card"`), `openingBalance`. Credit card accounts also have `statementDay`, `dueDay`, `minimumDue`, `monthlyInterestRate` (percent, for example 3).
- **Category**: `name`, `kind` (`"essential" | "optional"`), `sortOrder`, `archived`. Seed with: Groceries, Food, Transport, Load and data (essential); Dining out, Shopping (optional).
- **FixedBill**: `name`, `amount`, `dueDay`. Seed none; the user adds them in Settings (examples: Rent, Electricity, Internet, Water).
- **Transaction**: `type` (`"expense" | "income" | "transfer"`), `amount`, `date`, `categoryId` (expenses only), `accountId`, `toAccountId` (transfers only), `note`, optional `fixedBillId`, optional `isOneTime` flag for unusual expenses.
- **SpendingEstimate**: legacy per-category amounts from the removed setup screens. Kept so older backups and synced data still load; no calculation uses it.

### Credit card rules (important)

- A **purchase on the credit card** is an `expense` with `accountId` = the card. It counts as spending in its category and increases the card balance.
- A **payment to the credit card** is a `transfer` from a bank or cash account to the card. It is **not** an expense and must never be counted as spending. Getting this wrong makes last month look more expensive and the next recommendation too low.
- Card balance = opening balance + card expenses − transfers into the card.

## Budget month

- The budget month runs from payday to the day before the next payday. Payday on the 30th means Oct 30 – Nov 29.
- If `paydayDay` is greater than the days in a month, use the last day of that month.
- Provide `getBudgetPeriod(date, paydayDay)` returning `{ start, end, dayIndex, totalDays }`.

## Core calculations (`src/core/`)

### Spending baseline
- `getCategoryBaseline(categoryId)`: total expenses in that category during the **previous** budget month, excluding transactions flagged `isOneTime`.
- Only logged transactions count. If the previous month has no expenses, every baseline is ₱0 and the flag `isEstimate: true` lets the UI say there is no history yet.

### Safe credit card payment
```
safe = income logged this budget month
     − sum of fixed bills
     − sum of essential baselines
     − sum of optional baselines
     − one-time expenses already logged this month
     − buffer
result = clamp(safe, 0, cardBalance)
```
Return an object with every input line (so the UI can show the breakdown), the final amount, and:
- `belowMinimum: boolean` when the result is less than the card's `minimumDue`
- `shortfall` = minimumDue − result when below minimum
- `isEstimate` when any category budget has no spending history behind it yet

Only computed when `safePaymentEnabled` is on. When it is off, the card balance and minimum count as ₱0, the plan has no "Credit card payment" line, and the breakdown screen is not reachable.

If the user has more than one credit card, compute per card in version 1 by splitting the safe amount across cards in order of highest interest rate first, never below each card's minimum when possible. Keep this in a separate function so it can be refined later.

### Interest and payoff
- `estimateNextMonthInterest(balance, payment, monthlyRate)` = (balance − payment) × rate.
- `simulatePayoff(balance, monthlyPayment, monthlyRate)` returns `{ months, totalInterest }`. Each month: subtract the payment, then add interest on the remaining balance. Assume no new card spending. Cap at 120 months and return `neverPaysOff: true` if the payment doesn't exceed the interest.

### What-if
- `whatIf(cutOptionalBy)` recomputes the safe payment and payoff with optional spending reduced by that amount, and returns the difference in months and interest versus the current plan.

### Category budgets for this month
- Essential categories: budget = baseline, rounded up to the nearest ₱100.
- Optional categories: budget = baseline, rounded up to the nearest ₱100.
- Credit card payment: budget = safe payment.
- The plan must total the salary. Show any rounding difference as "unassigned".
- When the user edits one category's budget, reduce or increase the **credit card payment** line by the same amount, never below the card minimum. If that limit is hit, show a message instead of saving.

### Status per category
- `ok` below 80% used, `near` from 80% to 100%, `over` above 100%.

### Overspending suggestion
- When a category is `over`, suggest moving the overage from the optional category with the most remaining budget. If none has enough, suggest reducing the buffer.

### Below-minimum suggestions
Return up to three options to close the shortfall: use part of the buffer, cut optional spending, or split evenly between both. Each option shows the amount and its effect.

### Edge cases to test
- No transactions at all (new user): no income means no buffer is set aside, Budget shows "Add your income to see your plan" (never "Over by"), and Home shows "No bills set up yet" with no bills warning
- Bills set up but no income yet: Home warns that bills still to pay are more than what is left (unpaid bills > ₱0 and > remaining)
- Salary lower than fixed bills (safe payment 0, below minimum)
- Card balance smaller than the safe amount (pay in full)
- Payday on the 31st in February
- A card payment transfer must not affect any category total
- Payment equal to or lower than monthly interest (never pays off)
- Soft-deleted transactions are ignored everywhere

## Screens

Build mobile-first, then adapt the layout for tablet, laptop and desktop as described in "Responsive layout" below. Navigation destinations everywhere: Home, Transactions, Budget, Accounts, Settings. The screen descriptions below give the content of each screen; the responsive section says how it is arranged at each size.

1. **No onboarding.** On first launch the app creates default settings plus a Cash and a Bank account and opens Home. Pay schedule, bills and cards are set in Settings and Accounts.
2. **Home**: period and day count; when Safe to pay is on and a card exists, hero card "Safe to pay on your credit card this month" with the amount, bill total, due date and minimum due, and a "Why this amount?" link (otherwise the hero shows the amount not yet given a job); month summary (salary, spent so far, remaining); category list with progress bars and status colours; "+" button.
3. **Add transaction**: Expense / Income / Transfer switch; large amount display with an on-screen number pad (also accept keyboard input on desktop); category chips (expense only); account selector; "to account" for transfers; optional note; date defaulting to today; "One-time expense" toggle; Save. Must be possible in 2–3 taps for a typical expense.
4. **Credit card payment breakdown**: the recommendation; the calculation as a stack of labelled lines ending in the safe amount; "If you pay this" card with unpaid balance, interest next month and payoff timeline; what-if slider for cutting optional spending (₱0–₱3,000 in ₱500 steps) with live results; disclaimer text.
5. **Budget plan**: sections "Set aside first" (fixed bills, credit card payment, buffer), "Essential" and "Optional", each row showing last month's amount and this month's editable budget; allocation summary showing unassigned amount.
6. **Transactions**: search, category filter chips, list grouped by day, income in green with "+", tap to edit, swipe or button to delete.
7. **Accounts**: cash and bank balances; credit card detail (balance, statement day, due date, minimum due, interest rate) with a link to the breakdown; add account.
8. **Settings**: payday, pay frequency (no pay amount: income is taken from logged income transactions), "Safe to pay on your credit card" switch (off by default), "Carry-over" switch (off by default), categories (add, rename, set essential or optional, archive), fixed bills, buffer amount, appearance (light, dark, system), export data, import data, "Cloud sync" row with a "Paid" badge that shows "Coming soon", delete all data (with confirmation).

## Responsive layout

Use Tailwind's breakpoints. Every screen must work at every width from 360px to 1920px, in portrait and landscape, with no horizontal scrolling of the page.

| Size | Width | Navigation | Layout |
|---|---|---|---|
| Phone | below 640px (default) | Bottom tab bar; floating "+" button on Home | Single column, full width with 20px side padding |
| Tablet | `sm` 640px and `md` 768px | Bottom tab bar below `md`; from `md`, a left navigation rail (icons with short labels) and an "Add" button at the top of the rail | Content up to 720px wide, centred; two columns where noted below from `md` |
| Laptop | `lg` 1024px | Left sidebar about 240px wide with app name, full labels, and an "Add transaction" button | Content up to 1100px; dashboard grids |
| Desktop | `xl` 1280px and `2xl` 1536px | Same sidebar | Content up to 1280px, centred; never stretch text lines beyond about 75 characters |

### Screen arrangements on wider screens

- **Home (`md` and up):** two-column grid. Left: the safe-payment hero card and the month summary. Right: category budgets. From `lg`, add a "Recent transactions" card (last 8) and a "Bills due this month" card below or beside them.
- **Add transaction:** a full screen on phones; a centred Dialog (about 480px wide) from `md`. On devices with a physical keyboard (`pointer: fine`), show a normal amount input that accepts typing and hide the on-screen number pad; keep the pad on touch devices.
- **Edit transaction:** a bottom Drawer on phones; a right-side Sheet from `md`.
- **Credit card payment breakdown (`lg` and up):** two columns. Left: the recommendation and the calculation stack. Right: "If you pay this", the payoff timeline and the what-if slider.
- **Budget plan (`lg` and up):** "Set aside first" in the left column; "Essential" and "Optional" in the right column. Show last month and this month as aligned columns.
- **Transactions (`lg` and up):** filters in a toolbar above the list (search, category, account, date range). Rows show date, note, category, account and amount in aligned columns. Selecting a row opens its details in a side panel instead of a new screen.
- **Accounts (`md` and up):** account cards in a grid, two columns at `md`, three at `xl`; the credit card card spans the full width.
- **Settings (`lg` and up):** section list on the left, the selected section's settings on the right.
- **Special states:** alerts span the content width at the top of the screen at every size.

### Input and interaction on larger screens

- Keyboard shortcuts on devices with a keyboard: `N` opens Add transaction, `/` focuses search on the Transactions screen, `Esc` closes dialogs and sheets. Show them as hints in the sidebar or tooltips.
- Visible focus rings on all interactive elements; logical tab order.
- Hover states on rows, cards and buttons, used only from `pointer: fine` devices.
- Touch targets stay at least 44px at every size, since tablets are touch devices.
- Charts and progress bars resize with their container; no fixed pixel widths.

### Testing widths

Check every screen at 360, 390, 768 (portrait tablet), 1024 (landscape tablet and small laptop), 1280, 1440 and 1920 pixels wide, and on a phone in landscape.

## Special states

- **New user, no transactions**: Home shows the amount not yet given a job (or, with Safe to pay on, the recommendation with an "Estimate" badge and a line saying no spending was logged last month yet), ₱0 spent, and an empty card with "Add your first transaction".
- **Overspent category**: a red alert at the top of Home naming the category and amount over, with the suggested fix as a button ("Move ₱350 from Shopping") and "Choose another category". The category row shows an "Over by ₱350" tag and a full red bar.
- **Safe payment below minimum due**: the breakdown screen switches the hero to a red warning showing the amount the budget can cover, the minimum due and the shortfall, followed by the suggestions with "Apply" buttons. Include the text "If you cannot reach the minimum, contact your bank before the due date."

## Data export and import

- Export all records as one JSON file (with a schema version number) and transactions as CSV.
- Import accepts the JSON export, validates it, and asks before replacing existing data.
- This is the free backup method, so make it easy to find.

## Design

Calm, trustworthy, plain language, no finance jargon. The recommended card payment is the most prominent element on Home.

Fonts (Google Fonts): **Space Grotesk** for headings and all money amounts, **Inter** for everything else.

| Token | Light | Dark |
|---|---|---|
| Background | `#F3F5F4` | `#0E1512` |
| Card surface | `#FFFFFF` | `#18221D` |
| Text | `#14201B` | `#E8EFEB` |
| Secondary text | `#55635D` | `#A9B8B1` |
| Divider | `#E1E6E3` | `#2A3731` |
| Input border | `#B9C3BE` | `#3A4A43` |
| Primary (hero card, buttons) | `#0F6B4F` | `#0F6B4F` |
| Primary text/links | `#0F6B4F` | `#5CC6A0` |
| Progress fill | `#0F6B4F` | `#3DB389` |
| Success tint | `#E3F1EB` | `#12382C` |
| Warning tint / text | `#FBEFD9` / `#7A4700` | `#3A2A0C` / `#F2C16B` |
| Warning bar | `#C77700` | `#C77700` |
| Danger tint / text | `#FBE4E1` / `#8A1C12` | `#3D1612` / `#FFB4AB` |
| Danger bar / amount | `#B42318` | `#FF8A7D` |

## UI components

- Initialise shadcn/ui with the CLI and add components as needed. Use a shadcn component wherever one fits instead of building from scratch: Button, Card, Input, Label, Form, Switch, Slider, Tabs or ToggleGroup (Expense / Income / Transfer), Badge, Progress, Dialog, AlertDialog (destructive confirmations), Sheet or Drawer (edit transaction), Select, Sonner toasts (saved, deleted, imported).
- Map the design tokens below onto shadcn's CSS variables (`--background`, `--card`, `--foreground`, `--muted-foreground`, `--border`, `--input`, `--primary`, `--destructive`, and so on) for both light and dark themes, so components pick up the palette without per-component overrides.
- Set shadcn's `--radius` to 12px.
- Do not use TanStack Query, Router, Table or Form in version 1.

## Visual details

- Corner radius: 20px hero cards, 16px cards, 12–14px buttons and inputs.
- Touch targets at least 44px. Text contrast at least 4.5:1.
- Icons: Lucide (lucide-react), which ships with shadcn/ui. No emoji.
- Use real `<button>`, `<a>`, `<input>` and `<label>` elements; add `aria-label` to icon-only buttons.

## Copy

- Use "Safe to pay on your credit card this month" for the main recommendation.
- Show this disclaimer on the breakdown screen: "These are estimates from your own entries, not financial advice. Paying your bill in full avoids interest."

## PWA

- Manifest with name "Auto Budget", short name "Auto Budget", theme colour `#0F6B4F`, standalone display, `"orientation": "any"` (do not lock to portrait, so tablets and laptops can use landscape), icons at 192 and 512px plus a maskable icon.
- The app must also install as a desktop app from Chrome and Edge on laptops.
- Cache the app shell so it opens offline. All data is local, so the app works fully offline.
- Add an iOS "Add to Home Screen" hint shown once in Safari.

## Portability: Vercel now, VPS later

The app is deployed to Vercel first but must be movable to a self-managed VPS later without code changes.

- **Plain static build only.** `npm run build` must produce a `dist/` folder that any static web server can serve. Do not use Vercel-specific features (serverless or edge functions, Vercel image optimisation, Vercel KV or Edge Config, Vercel Analytics).
- **SPA fallback on both hosts.** Include `vercel.json` with a rewrite of all paths to `/index.html`, and an equivalent rule in the VPS web server config.
- **Relative, configurable paths.** Asset paths and the PWA manifest `start_url` and `scope` must work from the domain root. Read any environment-specific value from `import.meta.env` (`VITE_*` variables) with a documented `.env.example`; hard-code no hostnames.
- **Docker setup for the VPS.** Add:
  - a multi-stage `Dockerfile`: Node image builds the app, then a small Caddy image serves `dist/`
  - a `Caddyfile` with the SPA fallback, gzip/zstd compression, long cache headers for hashed assets, and `Cache-Control: no-cache` for `index.html`, `manifest.webmanifest` and the service worker file (so updates reach users)
  - a `docker-compose.yml` that runs the container on ports 80 and 443 with Caddy's automatic HTTPS for a domain set by an environment variable
  - a short `DEPLOY.md` covering both Vercel and VPS deployment
- **HTTPS is required.** Service workers and installation only work over HTTPS (or localhost), which Caddy provides automatically on the VPS.

### Rules for the later backend (do not build in version 1)

When cloud sync is added, keep it host-independent:

- The sync module talks to **one HTTP sync API defined by this project** (for example `POST /sync/push`, `GET /sync/pull?since=`), never to a vendor SDK from screens or core logic.
- The database is **PostgreSQL**, so it can run on a managed service or on the VPS and be moved with `pg_dump`.
- Authentication uses a library or service that can be self-hosted, so accounts move with the app.

## Build order

Work in this order and keep the app runnable after each step:

1. Scaffold the project, set up Tailwind and shadcn/ui with the theme tokens, routing, and the responsive app shell (bottom tabs on phones, navigation rail on tablets, sidebar on laptops and desktops).
2. Write `src/core/` with all calculations and full unit tests.
3. Data layer: Dexie schema, repository interface and implementation, seed categories.
4. First-launch defaults (settings, Cash and Bank accounts).
5. Home and Add transaction.
6. Credit card breakdown, including what-if, and Budget plan.
7. Transactions, Accounts and Settings.
8. Special states, then a pass through every screen at the testing widths to fix layout issues.
9. Export and import.
10. Dark mode and theme setting.
11. PWA setup and a Vercel-ready production build.
12. Dockerfile, Caddyfile, docker-compose.yml and DEPLOY.md for VPS hosting.

## Out of scope for version 1

User accounts, cloud sync, payments and subscriptions, bank connections, notifications, multiple currencies, twice-a-month pay, ads.

## Version 1.2.0 changes (Nov 2026)

- **Look:** futuristic theme. Faint 32px grid background with a mint glow (top left) and a violet glow (right); glass cards (`--card` is translucent, with a thin edge); the hero card is dark in both themes with a mint-to-violet gradient edge, gradient amount text and a neon button; primary buttons and progress bars use gradients with a glow; the add button is a glowing orb; dialogs stay solid. JetBrains Mono, uppercase, for small labels (the period line, summary labels, section labels).
- **Type:** one step smaller across the app (Tailwind text scale overridden in `index.css`; fixed sizes reduced by 1px up to 14px and by 12.5% above).
- **Scrollbars:** hidden everywhere; scrolling still works by touch, wheel and keyboard.
- **Safe to pay off:** Home says nothing about it. The hero shows what is not yet given a job, with "Open budget plan" (or "Log your income" when there is no income yet).
- **Account transactions (`/accounts/:id`):** every account on Accounts opens its own transactions (paid from it, paid into it, transfers either way, fees included), with balance, in and out this month, "This budget month" / "All time", a pencil button in the header to edit the account, and a + button that opens Add transaction with that account selected (`?from=<id>`).
- **Version button:** at the very bottom of each tab screen on phones and tablets, and at the bottom of the sidebar on laptops.
