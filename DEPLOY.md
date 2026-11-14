# Deploying Auto Budget

Auto Budget is a plain static site. `npm run build` writes everything to `dist/`, and any static web server that falls back to `index.html` for unknown paths can host it. Without a backend, all data stays in the user's browser. Sign-in, online backup and Auto Budget Premium are optional and need the Supabase backend described in [Backend](#backend-sign-in-online-backup-and-premium-optional).

HTTPS is required in production: the service worker (offline mode) and "Add to Home Screen" only work over HTTPS or on `localhost`.

## Environment variables

Copy `.env.example` to `.env`. The app needs no `VITE_*` values to run on the device alone; the backend and Premium settings are explained in `.env.example` and below. `DOMAIN` is only used by the VPS setup below.

`VITE_*` values are baked into the bundle when you build, so set them before building and never put secrets in them.

## Option 1: Vercel

1. Push the repository to GitHub, GitLab or Bitbucket.
2. In Vercel, choose **Add New → Project** and import the repository.
3. Vercel reads `vercel.json`: build command `npm run build`, output `dist`. Leave the defaults.
4. Add any `VITE_*` variables under **Settings → Environment Variables** (none are needed without the backend).
5. Deploy. Vercel provides HTTPS automatically.

`vercel.json` rewrites every path to `/index.html` so routes such as `/budget` work on reload. It also caches hashed assets for a year and sends `no-cache` for `index.html`, the manifest and the service worker, so updates reach users.

No Vercel-only features are used (the server functions run on Supabase, not Vercel; no image optimisation, KV, Edge Config or Analytics), so the same build runs anywhere.

## Option 2: VPS with Docker and Caddy

### What you need

- A Linux server with Docker and the Docker Compose plugin
- A domain (or subdomain) whose DNS `A`/`AAAA` record points at the server
- Ports 80 and 443 open in the server's firewall

### Steps

```sh
git clone <your-repo-url> auto-budget
cd auto-budget
cp .env.example .env
# edit .env and set DOMAIN=budget.example.com
docker compose up -d --build
```

Caddy requests and renews an HTTPS certificate for `DOMAIN` automatically. Certificates are kept in the `caddy_data` volume, so they survive restarts and rebuilds.

### Updating

```sh
git pull
docker compose up -d --build
```

Users get the new version the next time they open the app. The service worker checks for updates because `sw.js` is served with `Cache-Control: no-cache`.

### What the files do

| File | Purpose |
|---|---|
| `Dockerfile` | Stage 1 (Node 22) runs `npm ci` and `npm run build`. Stage 2 (Caddy) serves `dist/` from `/srv`. |
| `Caddyfile` | SPA fallback to `index.html`, zstd/gzip compression, one-year cache for `/assets/*`, `no-cache` for everything else (including `index.html`, `manifest.webmanifest` and `sw.js`). |
| `docker-compose.yml` | Runs the container on ports 80 and 443 (plus 443/udp for HTTP/3) with `DOMAIN` from `.env`. |

### Trying the container locally

```sh
docker compose up --build
```

With `DOMAIN` unset, Caddy serves `https://localhost` with a locally trusted certificate. Your browser may ask you to trust it the first time.

## Any other static host

Upload the contents of `dist/` and configure:

1. A fallback that serves `/index.html` for paths that are not files.
2. `Cache-Control: no-cache` for `index.html`, `manifest.webmanifest` and `sw.js`.
3. Long-lived caching for `/assets/*` (file names include a content hash).
4. HTTPS.

## Backend: sign-in, online backup and Premium (optional)

The app works with no backend at all. Sign-in, online backup and sync, and Auto Budget Premium run on [Supabase](https://supabase.com): PostgreSQL with row-level security, Supabase Auth, and the server functions in `supabase/functions/`. Payments go through PayMongo hosted Checkout, so the app never sees card or wallet details.

| Function | What it does |
|---|---|
| `sync` | Pushes and pulls the user's records. |
| `delete-account` | Deletes the account and its online data. |
| `premium` | `GET /premium/status` (entitlement, price, receipts) and `POST /premium/start-trial`. |
| `create-checkout` | Loads the price from `products`, records a `pending` purchase and returns the PayMongo checkout URL. Refuses accounts that already own Premium. |
| `payment-webhook` | Verifies PayMongo's signature, processes each event once, grants Premium on payment and removes it on refund, and emails the receipt. The only code that can grant Premium. |
| `trial-reminders` | Run hourly by a scheduler: emails users whose trial ends within 24 hours, once. |

All functions check the caller themselves (`verify_jwt = false` in `supabase/config.toml` lets the webhook and the scheduler reach them).

### 1. Create the project and database

```sh
npx supabase login
npx supabase link --project-ref <your-project-ref>
npx supabase db push          # applies supabase/migrations/*, in order
```

Migrations are additive: never edit one that has already been applied; add a new file instead. The Premium migration seeds `products` with `premium_lifetime` at ₱399 (39900 centavos).

Write the project's region into `docs/PRIVACY.md` (`[SUPABASE REGION]`).

### 2. Auth

In the Supabase dashboard, under **Authentication**:

- **URL configuration:** set the Site URL to your app's address and add it to the redirect URLs.
- **Email:** enable email sign-in with a one-time code, and paste `supabase/templates/sign-in-code.html` into the "Magic link" template. Set up custom SMTP (for example Resend) so codes are not rate-limited.
- **Google (optional):** enable the Google provider, then build with `VITE_GOOGLE_SIGN_IN=true`.

### 3. Deploy the functions and set their secrets

```sh
npx supabase functions deploy sync delete-account premium create-checkout payment-webhook trial-reminders

npx supabase secrets set \
  APP_URL=https://budget.example.com \
  APP_ORIGINS=https://budget.example.com \
  PAYMONGO_SECRET_KEY=sk_test_xxx \
  PAYMONGO_WEBHOOK_SECRET=whsk_xxx \
  RESEND_API_KEY=re_xxx \
  EMAIL_FROM="Auto Budget <no-reply@budget.example.com>" \
  SUPPORT_EMAIL=support@budget.example.com \
  CRON_SECRET=<a long random string>
```

`supabase/functions/.env.example` describes each one. These are server secrets: never put them in a `VITE_*` variable.

### 4. PayMongo webhook

In the PayMongo dashboard (**Developers → Webhooks**), in **test mode** first:

1. Add an endpoint: `https://<your-project-ref>.supabase.co/functions/v1/payment-webhook`
2. Subscribe to `checkout_session.payment.paid` and `payment.refund.updated`.
3. Copy the endpoint's secret key into `PAYMONGO_WEBHOOK_SECRET` and run `npx supabase secrets set` again.

Webhook failures (bad signature, unknown purchase, amount mismatch) are logged to the `payment_webhook_log` table and the function logs.

### 5. Hourly trial reminder

Call `trial-reminders` every hour with the cron secret. With Supabase's `pg_cron` and `pg_net` extensions enabled, run this once in the SQL editor:

```sql
select cron.schedule(
  'trial-reminders', '0 * * * *',
  $ select net.http_post(
       url := 'https://<your-project-ref>.supabase.co/functions/v1/trial-reminders',
       headers := jsonb_build_object('Authorization', 'Bearer <CRON_SECRET>')
     ) $
);
```

Any other scheduler works too, for example a cron job on the VPS:

```sh
0 * * * * curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET" https://<your-project-ref>.supabase.co/functions/v1/trial-reminders
```

### 6. Build the app against the backend

Set these before building (Vercel: **Settings → Environment Variables**; VPS: in `.env`, which the Docker build reads):

```sh
VITE_SUPABASE_URL=https://<your-project-ref>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_xxx
VITE_SUPPORT_EMAIL=support@budget.example.com
# VITE_PREMIUM_ENABLED=true   # only after step 7
```

With `VITE_PREMIUM_ENABLED` unset, the app shows no Premium entry points, badges or paywall, and behaves like version 1 apart from the loan account type.

### 7. Test Premium end to end (test keys)

Build a staging copy with `VITE_PREMIUM_ENABLED=true` and check:

- A guest opens a locked feature, signs in, starts the trial, and the feature unlocks without a reload. A second trial is refused.
- Paying with a PayMongo test method unlocks Premium permanently, the receipt appears under **Premium → Receipts**, and the receipt email arrives.
- The success page shows "Confirming your payment…" and then the unlocked state.
- An account that already owns Premium cannot start another checkout.
- A refund from the PayMongo dashboard returns the account to free, and nothing is deleted.

### 8. Going live

1. Complete every `[PLACEHOLDER]` in `docs/TERMS.md`, `docs/REFUNDS.md` and `docs/PRIVACY.md`, and have them reviewed.
2. Activate your PayMongo account and switch to live mode.
3. Create a **live** webhook endpoint (same URL and events) and set the live keys:
   `npx supabase secrets set PAYMONGO_SECRET_KEY=sk_live_xxx PAYMONGO_WEBHOOK_SECRET=whsk_live_xxx`
4. Set `VITE_PREMIUM_ENABLED=true` in production and rebuild.
5. Make one small real payment, check it, and refund it.

### Running Premium

- **Change the price** without a release: `update products set amount = 49900 where code = 'premium_lifetime';` (centavos). The app always reads the price from the server.
- **Grant Premium** for a support case (SQL editor, service role): `select grant_premium('<user-uuid>');`
- **Measure uptake** (the app has no analytics): count rows in `entitlements` by `source`, and `purchases` by `status`.

### Local development

```sh
npx supabase start            # local stack; this project uses ports 54331–54334
cp supabase/functions/.env.example supabase/functions/.env
npx supabase functions serve
```

Put the local URL and publishable key that `npx supabase start` prints into `.env.local` as `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`, then `npm run dev`. Emails are caught by the local mail viewer (Mailpit) at http://localhost:54334. Stop the stack with `npx supabase stop`.

## Moving between hosts

Data lives on each user's device (and, for signed-in users, in Supabase, which does not move), so switching from Vercel to the VPS loses nothing. Point the domain at the new host. If the domain changes, the browser treats it as a different site with separate storage, so users should use **Settings → Export data** first and **Import data** on the new address.
