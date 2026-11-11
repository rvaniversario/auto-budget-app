# Auto Budget

A responsive budgeting web app (phone, tablet, laptop and desktop) for salaried users in the Philippines. Each payday it tells you one number, **how much you can safely pay on your credit card this month**, and builds a budget for every spending category automatically.

It installs to a phone's Home Screen or as a desktop app (Chrome, Edge) as a PWA, and works fully offline. All data stays on the device (IndexedDB).

See [SPEC.md](SPEC.md) for the full specification and [DEPLOY.md](DEPLOY.md) for hosting on Vercel or a VPS.

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
  screens/     One file per screen (Home, Add transaction, Breakdown, Budget, ...).
  components/  Shared UI; components/ui holds the shadcn/ui components.
  lib/         Small browser helpers (theme, downloads, form field schemas).
```

### How the numbers are worked out

`src/core/model.ts` turns the stored records into everything the screens show:

- **Budget month**: payday to the day before the next payday (`getBudgetPeriod`).
- **Baselines**: last budget month's spending per category, excluding one-time expenses, or the onboarding estimates when there is no history yet.
- **Category budgets**: baseline rounded up to the nearest ₱100, unless you've edited it this month.
- **Safe card payment**: salary − fixed bills − essential − optional − one-time expenses − buffer, clamped between ₱0 and the card balance.
- Editing a budget moves money to or from the card payment and is blocked if the payment would fall below the minimum due.

Money is always stored as integer centavos.

### Data and sync readiness

Every record has a UUID `id`, `createdAt`, `updatedAt` and `deletedAt`. Deletes are soft. `updatedAt` is indexed on every table, so a later sync can pull changes since a timestamp. To add cloud sync, implement the `Repository` interface in `src/data/repository.ts` against the project's own sync API and swap it in `src/data/index.ts`.

## Backups

Settings → Export data saves a full JSON backup (with a schema version) or a CSV of transactions. Import validates the file and asks before replacing local data.
