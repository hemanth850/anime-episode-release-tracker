# Anime Episode Release Tracker

Dashboard showing upcoming anime episode releases, live countdowns, reminder automation, and calendar export.

## Phase 1 (Implemented)
- Full-stack app with Express + SQLite
- Upcoming episodes API and dashboard cards
- Live countdown timers in UI
- Reminder creation with:
  - Email notifications (SMTP)
  - Discord webhook notifications
- Background scheduler (runs every minute)
- `.ics` calendar export endpoint
- Seeded sample anime/episode data

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
4. Open:
   - App: http://localhost:4000

## Environment Variables
See `.env.example`.

- `PORT`: API/web server port
- `DB_PATH`: SQLite file path
- `APP_BASE_URL`: Base URL used in calendar events
- `SMTP_*`: Optional email transport settings. If omitted, email reminders run in dry-run mode (logged to console).

## API Endpoints
- `GET /api/health`
- `GET /api/anime`
- `GET /api/episodes/upcoming?days=14`
- `GET /api/reminders`
- `POST /api/reminders`
- `DELETE /api/reminders/:id`
- `POST /api/jobs/reminders/run` (manual trigger)
- `GET /api/calendar.ics`

## Notes
- Reminder scheduler scans every minute.
- For real reminders, configure SMTP and/or provide valid Discord webhook URLs.
- Current data is seeded demo content; next phase can integrate real anime schedule providers.

## Suggested Phase 2
- Add auth + per-user reminders
- Integrate real schedule source (AniList/Jikan)
- Add timezone preferences and recurring sync jobs
- Docker + deployment template
