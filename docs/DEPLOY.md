# Deployment (draft — D-015, awaiting VPS + domain credentials)

Single VPS running Docker Compose: `caddy` (TLS, reverse proxy) → `api` (Fastify + WebSocket) and `web` (Next.js), with `postgres` 16 and `redis` 7. Everything is defined in `docker-compose.yml`, `Caddyfile` and `apps/api/Dockerfile`.

> Status: the API image and compose file have not yet been built on a real host. The API itself boots with `node --import tsx src/server.ts` (verified locally in demo mode). `apps/web/Dockerfile` belongs to the web workstream.

## 1. Prerequisites
- A VPS with Docker Engine and the Compose plugin (2 vCPU / 4 GB RAM is enough for the MVP).
- DNS: `APP_DOMAIN` (web) and `API_DOMAIN` (api) A/AAAA records pointing at the VPS. Caddy obtains certificates automatically.
- Provider keys (optional; without them the API runs with deterministic fakes only if `DEMO_MODE=1` or `ALLOW_FAKE_PROVIDERS=1`).

## 2. Configure
```bash
cp .env.example .env
# Required
openssl rand -base64 32          # → JWT_SIGNING_KEY
openssl rand -base64 24          # → POSTGRES_PASSWORD
# Set APP_DOMAIN, API_DOMAIN, ACME_EMAIL, OWNER_EMAIL, WIKIMEDIA_CONTACT
# Optional: OPENAI_API_KEY, GEMINI_API_KEY, ANTHROPIC_API_KEY, GOOGLE_MAPS_SERVER_KEY, EMAIL_PROVIDER/EMAIL_API_KEY/EMAIL_FROM
```
`.env` is git-ignored. Never commit keys; the API never logs them (pino redaction plus URL token stripping; Caddy access logs drop `Authorization`/`Cookie` and redact `token`/`code` query params).

## 3. Start
```bash
docker compose build
docker compose up -d
docker compose logs -f api        # migrations apply automatically on start (SKIP_MIGRATIONS=1 to disable)
curl -s https://$API_DOMAIN/readyz
```
`/readyz` reports `status: ok | degraded | unavailable`, whether the API is in **reduced mode** (Redis down: stricter discovery throttle, in-process session state, F5), which providers are configured (and whether any are fakes), and the circuit-breaker states.

## 4. First owner (D-013)
```bash
docker compose exec api node --import tsx src/cli/admin-bootstrap.ts
```
This prints a one-time code, valid for 30 minutes and tied to `OWNER_EMAIL`. Open the admin console, choose "Set up passkey", then enter the email address and the code. After that, invite other admins from the console (`POST /v1/admin/users/invites`). Pair a phone from the console (Pairing → QR), then scan the QR code in the mobile app. Revoke devices at any time.

## 5. Scheduled jobs
- **Retention (D-012):** run daily.
  `docker compose exec -T api node --import tsx src/cli/retention.ts` (host cron or a systemd timer). It deletes events and latency samples older than 13 months, the cost ledger and audit log older than 25 months, and guest journey memory older than 90 days.
- **Backups:** nightly `docker compose exec -T postgres pg_dump -U city city | gzip > /backups/city-$(date +%F).sql.gz`, rotated after 14 days. TTS audio (`audio` volume) is a cache and can be rebuilt, so it does not need backing up.

## 6. Upgrades and rollback
CI (`.github/workflows/ci.yml`) typechecks, runs every test suite against Postgres and Redis service containers, runs the replay suite and the provider benchmark harness, and pushes `ghcr.io/<owner>/telvey-api:<sha>` from `main`. To deploy, set `API_IMAGE=ghcr.io/<owner>/telvey-api:<sha>` and run `docker compose pull api && docker compose up -d api`. To roll back, set the previous tag and run `up -d` again. Migrations are forward-only and additive, so the previous image keeps working.
SSH-based deploy from CI is still a TODO: it needs the VPS host and key as repository secrets.

## 7. Operations
- Budgets and kill switches: `GET/PUT /v1/admin/config/budgets` (owner, audited). Examples: `{"killed":["llm"]}` falls back to template narration, and `{"killed":["realtime"]}` disables realtime tokens.
- Provider model ids are env-configurable (`OPENAI_*_MODEL`, `GEMINI_*_MODEL`, `ANTHROPIC_STORY_MODEL`). Before switching, run `pnpm bench:providers`: it checks the configured ids against each provider's model list and writes `benchmark/providers/<timestamp>.json`.
- Wikimedia (default discovery/knowledge source) requires a descriptive User-Agent with contact info. Set `WIKIMEDIA_CONTACT`.
- Google Places content must be displayed on a Google map, and only place IDs may be stored long-term (lat/lng ≤ 30 days). The API never puts Places results into the shared discovery cache.
