# Auto Budget

A responsive budgeting web app (phone, tablet, laptop and desktop) for salaried users in the Philippines. Each payday it tells you one number, **how much you can safely pay on your credit card this month**, and builds a budget for every spending category automatically.

It installs to a phone's Home Screen or as a desktop app (Chrome, Edge) as a PWA, and works fully offline. Data lives on the device (IndexedDB); signing in to back it up online and sync between devices is optional.

**Auto Budget Premium** (version 2) adds a debt payoff planner, reports and trends, and recurring transactions, unlocked with a 14-day free trial or a one-time payment through PayMongo. Everything from version 1 stays free. Premium is off unless the app is built with `VITE_PREMIUM_ENABLED=true` and the Supabase backend.

Docs live in [docs/](docs/):

- [SPEC.md](docs/SPEC.md): version 1 specification
- [SPEC-V2.md](docs/SPEC-V2.md): version 2 (Premium) specification
- [PRIVACY.md](docs/PRIVACY.md), [TERMS.md](docs/TERMS.md), [REFUNDS.md](docs/REFUNDS.md): policies shown in the app (complete the `[PLACEHOLDER]`s before going live)

[DEPLOY.md](DEPLOY.md) covers hosting on Vercel or a VPS, and setting up Supabase, PayMongo and going live.

## Getting started

```sh
npm install
npm run dev        # http://localhost:5173
npm test           # unit tests (Vitest)
npm run build      # type-check and build to dist/
npm run preview    # serve the production build locally
```

## Project layout

```
src/
  core/        Pure TypeScript: every calculation. No React, DOM or storage imports.
               Reusable as-is in a future React Native app. Fully unit-tested.
  data/        Repository interface + Dexie (IndexedDB) implementation, seed data,
               backup schema (Zod). Screens never touch Dexie directly.
  hooks/       useAppData: live snapshot of all records + this month's computed model.
               useRecurringRunner: creates recurring transactions as they fall due.
  sync/        Optional sign-in and online backup (Supabase Auth + the sync function).
  premium/     Feature registry, useEntitlement, the offline entitlement cache,
               <PremiumGate>, badges and locked views.
  screens/     One file per screen (Home, Add transaction, Breakdown, Budget, ...).
  components/  Shared UI; components/ui holds the shadcn/ui components.
  lib/         Small browser helpers (theme, downloads, form field schemas).
docs/          Specifications and the policy documents rendered in the app.
supabase/      Migrations, SQL tests and server functions (sync, Premium, payments).
```

Premium calculations are pure functions in `src/core` with unit tests: `debtPlanner.ts` (`simulateDebts`, goal mode), `reports.ts` (budget-month reports, rule-based insights, CSV) and `recurring.ts` (schedules and deterministic occurrence ids). Only the server grants Premium, after a verified payment webhook; screens are gated in the interface with `<PremiumGate>`.

### How the numbers are worked out

`src/core/model.ts` turns the stored records into everything the screens show:

- **Budget month**: payday to the day before the next payday (`getBudgetPeriod`).
- **Baselines**: last budget month's spending per category, excluding one-time expenses, or the onboarding estimates when there is no history yet.
- **Category budgets**: baseline rounded up to the nearest ₱100, unless you've edited it this month.
- **Safe card payment**: salary − fixed bills − essential − optional − one-time expenses − buffer, clamped between ₱0 and the card balance.
- Editing a budget moves money to or from the card payment and is blocked if the payment would fall below the minimum due.

Money is always stored as integer centavos.

### Data and sync

Every record has a UUID `id`, `createdAt`, `updatedAt` and `deletedAt`. Deletes are soft. `updatedAt` is indexed on every table, and when the user is signed in the sync engine in `src/sync/` pushes and pulls changes since a cursor.

## Backups

Settings → Export data saves a full JSON backup (with a schema version) or a CSV of transactions. Import validates the file and asks before replacing local data.
