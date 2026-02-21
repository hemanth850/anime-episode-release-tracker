require('dotenv').config();

function number(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

module.exports = {
  port: number(process.env.PORT, 4000),
  dbPath: process.env.DB_PATH || './data/tracker.db',
  appBaseUrl: process.env.APP_BASE_URL || 'http://localhost:4000',
  smtp: {
    host: process.env.SMTP_HOST || '',
    port: number(process.env.SMTP_PORT, 587),
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.SMTP_FROM || 'anime-tracker@example.com',
  },
  anilist: {
    syncCron: process.env.ANILIST_SYNC_CRON || '15 */6 * * *',
    pageLimit: Math.max(1, Math.min(10, number(process.env.ANILIST_PAGE_LIMIT, 3))),
    perPage: Math.max(10, Math.min(50, number(process.env.ANILIST_PER_PAGE, 50))),
  },
  auth: {
    sessionDays: Math.max(1, Math.min(180, number(process.env.AUTH_SESSION_DAYS, 30))),
  },
};
