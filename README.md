# Anime Episode Release Tracker

Dashboard showing upcoming anime episode releases, live countdowns, reminders, account-based subscriptions, and calendar export.

## Phase 1 + Phase 2 + Phase 3 (Implemented)
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

## API Endpoints
- `GET /api/health`
- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/resend-verification`
- `POST /api/auth/verify-email`
- `POST /api/auth/forgot-password`
- `POST /api/auth/reset-password`
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

## Suggested Phase 4
- Timezone preferences and local-time reminder delivery
- Docker + deployment configuration
- Automated tests (API + sync + auth)
- OAuth sign-in (Google/GitHub)
