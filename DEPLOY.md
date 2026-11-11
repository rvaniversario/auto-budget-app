# Deploying Auto Budget

Auto Budget is a plain static site. `npm run build` writes everything to `dist/`, and any static web server that falls back to `index.html` for unknown paths can host it. There is no backend in version 1; all data stays in the user's browser.

HTTPS is required in production: the service worker (offline mode) and "Add to Home Screen" only work over HTTPS or on `localhost`.

## Environment variables

Copy `.env.example` to `.env`. Version 1 needs no `VITE_*` values; the app works from the domain root without configuration. `DOMAIN` is only used by the VPS setup below.

`VITE_*` values are baked into the bundle when you build, so set them before building and never put secrets in them.

## Option 1: Vercel

1. Push the repository to GitHub, GitLab or Bitbucket.
2. In Vercel, choose **Add New → Project** and import the repository.
3. Vercel reads `vercel.json`: build command `npm run build`, output `dist`. Leave the defaults.
4. Add any `VITE_*` variables under **Settings → Environment Variables** (none are needed today).
5. Deploy. Vercel provides HTTPS automatically.

`vercel.json` rewrites every path to `/index.html` so routes such as `/budget` work on reload. It also caches hashed assets for a year and sends `no-cache` for `index.html`, the manifest and the service worker, so updates reach users.

No Vercel-only features are used (no serverless or edge functions, image optimisation, KV, Edge Config or Analytics), so the same build runs anywhere.

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

## Moving between hosts

Data lives on each user's device, not on the server, so switching from Vercel to the VPS loses nothing. Point the domain at the new host. If the domain changes, the browser treats it as a different site with separate storage, so users should use **Settings → Export data** first and **Import data** on the new address.
