# syntax=docker/dockerfile:1

# ---- Build: compile the static site -------------------------------------------
FROM node:22-alpine AS build
WORKDIR /app

# Use the same npm major as the lockfile was written with (see "packageManager"
# in package.json). node:22 ships npm 10, which rejects npm 11 lockfiles.
RUN npm install -g npm@11.6.2

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
# VITE_* values are baked into the bundle at build time. They are read from a
# .env file in the build context, or can be passed with --build-arg.
RUN npm run build

# ---- Serve: Caddy serves dist/ with automatic HTTPS ---------------------------
FROM caddy:2-alpine
COPY Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/dist /srv

EXPOSE 80 443 443/udp
