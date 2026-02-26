# Anime Episode Release Tracker

Dashboard showing upcoming anime episode releases, live countdowns, reminders, account-based subscriptions, and calendar export.

## Phase 1 + Phase 2 + Phase 3 + Phase 4 (Implemented)
- Full-stack app with Express + SQLite
- Upcoming episode dashboard with live countdowns
- Popularity-driven card emphasis and sorting
- Reminder automation via email (SMTP) and Discord webhooks
- Background jobs:
  - reminder dispatch every minute
  - AniList sync on startup + cron schedule
- Real upstream sync from AniList GraphQL airing schedule
- Manual sync button in dashboard
- Sync status API + UI feedback
- Account system:
  - register/login/logout
  - token-based sessions
  - private per-user reminders
  - automatic browser timezone detection
  - email verification (required before login)
  - forgot password + reset password flow
  - OAuth sign-in (Google + GitHub)
- Production/deployment readiness:
  - Dockerfile + docker-compose
  - security middleware (helmet, compression)
  - API rate limiting
  - configurable CORS/proxy/env settings
- Quality gates:
  - integration tests (auth, verification, reset, oauth availability)
  - GitHub Actions CI on push/PR
  - GitHub Actions CD (staging/prod image publish + optional deploy hooks)
- `.ics` calendar export endpoint
- Seeded local demo data (kept alongside synced data)

## Stack
- Backend: Node.js, Express, better-sqlite3, node-cron, nodemailer, ical-generator
- Frontend: Vanilla JS, HTML, CSS
- Storage: SQLite (`data/tracker.db`)

## Run Locally
1. Install dependencies:
   ```bash
   npm install
   ```
2. Copy env file:
   ```bash
   copy .env.example .env
   ```
3. Start app:
   ```bash
   npm run dev
   ```
4. Open `http://localhost:4000`

## Run Tests
```bash
npm test
```

## Environment Variables
See `.env.example`.

- `PORT`: API/web server port
- `DB_PATH`: SQLite file path
- `APP_BASE_URL`: Base URL used in calendar events
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`: Optional email settings
- `ANILIST_SYNC_CRON`: Cron for background AniList sync (default `15 */6 * * *`)
- `ANILIST_PAGE_LIMIT`: Number of AniList pages to fetch per sync (default `3`)
- `ANILIST_PER_PAGE`: Items per AniList page (default `50`, max `50`)
- `AUTH_SESSION_DAYS`: Session duration in days (default `30`)
- `NODE_ENV`: runtime mode (`development`/`production`)
- `CORS_ORIGIN`: `*` or comma-separated allowed origins
- `TRUST_PROXY`: proxy hops count (set `1` behind reverse proxy)
- `RATE_LIMIT_WINDOW_MS`: rate-limit window in ms
- `RATE_LIMIT_MAX`: max requests per window per IP
- `OAUTH_GOOGLE_CLIENT_ID`, `OAUTH_GOOGLE_CLIENT_SECRET`: Google OAuth credentials
- `OAUTH_GITHUB_CLIENT_ID`, `OAUTH_GITHUB_CLIENT_SECRET`: GitHub OAuth credentials

## API Endpoints
- `GET /api/health`
- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/resend-verification`
- `POST /api/auth/verify-email`
- `POST /api/auth/forgot-password`
- `POST /api/auth/reset-password`
- `GET /api/auth/oauth/providers`
- `GET /api/auth/oauth/google/start`
- `GET /api/auth/oauth/google/callback`
- `GET /api/auth/oauth/github/start`
- `GET /api/auth/oauth/github/callback`
- `GET /api/auth/me`
- `POST /api/auth/logout`
- `GET /api/anime`
- `GET /api/episodes/upcoming?days=14`
- `GET /api/reminders` (auth required)
- `POST /api/reminders` (auth required)
- `DELETE /api/reminders/:id` (auth required)
- `POST /api/jobs/reminders/run`
- `GET /api/sync/status`
- `POST /api/sync/anilist`
- `GET /api/calendar.ics`

## Notes
- Reminder emails run in dry-run log mode unless SMTP is configured.
- AniList sync writes anime/episodes with `source='anilist'` and upserts by external IDs.
- Local seeded data remains available (`source='local'`).
- Reminder ownership is scoped to signed-in users.
- Episode release timestamps in UI default to the user/browser timezone automatically.
- Verification/reset emails are sent through the existing email transport (or dry-run logs if SMTP is not configured).
- OAuth callbacks redirect back to `APP_BASE_URL` with a short-lived app session token.

## Deploy With Docker
1. Build and run:
   ```bash
   docker compose up -d --build
   ```
2. Open:
   - `http://localhost:4000`
3. Check logs:
   ```bash
   docker compose logs -f web
   ```
4. Stop:
   ```bash
   docker compose down
   ```

## Deploy To Cloud (Quick Checklist)
1. Set production env vars:
   - `NODE_ENV=production`
   - `APP_BASE_URL=https://your-domain`
   - `CORS_ORIGIN=https://your-domain`
   - SMTP vars for real emails
   - OAuth vars for Google/GitHub (if enabled)
2. Put app behind HTTPS reverse proxy (Nginx/Cloud load balancer).
3. Set `TRUST_PROXY=1` when behind proxy.
4. Persist `data/` storage (volume/disk mount).
5. OAuth redirect URI setup:
   - Google: `https://your-domain/api/auth/oauth/google/callback`
   - GitHub: `https://your-domain/api/auth/oauth/github/callback`

## CI/CD Pipeline
- CI workflow: `.github/workflows/ci.yml`
  - Runs tests on push + PR.
- CD workflow: `.github/workflows/cd.yml`
  - On `main`: builds/pushes `ghcr.io/<owner>/<repo>:staging-latest`
  - On tag `v*`: builds/pushes production image tags (`latest`, tag, sha)
  - Manual dispatch supports `staging`, `production`, `both`
  - Optional deploy hooks for platform-specific rollout

### Required GitHub Setup
1. Enable GitHub Actions environments:
   - `staging`
   - `production`
2. Configure secrets:
   - `STAGING_DEPLOY_HOOK` (optional)
   - `PRODUCTION_DEPLOY_HOOK` (optional)
3. Ensure `GITHUB_TOKEN` has package write permission (workflow already requests it).
4. If using protected production deploys, add required reviewers on the `production` environment.

## Suggested Phase 5
- Observability (structured logs + error tracking + uptime checks)
