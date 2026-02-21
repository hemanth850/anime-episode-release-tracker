const express = require('express');
const path = require('path');
const cors = require('cors');
const ical = require('ical-generator').default;

const config = require('./config');
const { db, initDb } = require('./db');
const { startScheduler, runReminderScan } = require('./jobs/scheduler');
const { runAniListSyncSafe, getAniListSyncStatus } = require('./services/anilistSyncService');
const { hashPassword, verifyPassword, createSessionToken } = require('./services/authService');

initDb();

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

const listAnimeStmt = db.prepare(`
  SELECT id, title, cover_image_url AS coverImageUrl, synopsis, total_episodes AS totalEpisodes, popularity, source
  FROM anime
  ORDER BY title ASC
`);

const listUpcomingEpisodesStmt = db.prepare(`
  SELECT e.id, e.anime_id AS animeId, a.title AS animeTitle,
         e.episode_number AS episodeNumber, e.title, e.release_at AS releaseAt,
         e.source, a.source AS animeSource, a.popularity AS animePopularity,
         a.cover_image_url AS animeCoverImage
  FROM episodes e
  JOIN anime a ON a.id = e.anime_id
  WHERE e.release_at BETWEEN ? AND ?
  ORDER BY e.release_at ASC
`);

const createUserStmt = db.prepare(`
  INSERT INTO users (email, password_hash, display_name, timezone)
  VALUES (?, ?, ?, 'UTC')
`);

const findUserByEmailStmt = db.prepare(`
  SELECT id, email, password_hash AS passwordHash, display_name AS displayName, timezone, created_at AS createdAt
  FROM users
  WHERE email = ?
`);

const createSessionStmt = db.prepare(`
  INSERT INTO user_sessions (token, user_id, expires_at)
  VALUES (?, ?, ?)
`);

const findSessionUserStmt = db.prepare(`
  SELECT u.id, u.email, u.display_name AS displayName, u.timezone,
         s.token, s.expires_at AS expiresAt
  FROM user_sessions s
  JOIN users u ON u.id = s.user_id
  WHERE s.token = ?
`);

const deleteSessionStmt = db.prepare('DELETE FROM user_sessions WHERE token = ?');
const deleteExpiredSessionsStmt = db.prepare('DELETE FROM user_sessions WHERE expires_at <= ?');

const insertReminderStmt = db.prepare(`
  INSERT INTO reminders (user_id, anime_id, email, discord_webhook_url, minutes_before)
  VALUES (?, ?, ?, ?, ?)
`);

const listRemindersStmt = db.prepare(`
  SELECT r.id, r.anime_id AS animeId, a.title AS animeTitle, r.email,
         r.discord_webhook_url AS discordWebhookUrl,
         r.minutes_before AS minutesBefore, r.is_active AS isActive, r.created_at AS createdAt
  FROM reminders r
  LEFT JOIN anime a ON a.id = r.anime_id
  WHERE r.user_id = ?
  ORDER BY r.created_at DESC
`);

const deleteReminderByUserStmt = db.prepare('DELETE FROM reminders WHERE id = ? AND user_id = ?');

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function createSessionForUser(userId) {
  const token = createSessionToken();
  const expiresAt = new Date(Date.now() + config.auth.sessionDays * 24 * 60 * 60 * 1000).toISOString();
  createSessionStmt.run(token, userId, expiresAt);
  return { token, expiresAt };
}

function sanitizeUser(user) {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    timezone: user.timezone,
  };
}

function getBearerToken(req) {
  const authHeader = req.header('authorization') || '';
  const [scheme, token] = authHeader.split(' ');
  if (!scheme || scheme.toLowerCase() !== 'bearer' || !token) return null;
  return token.trim();
}

function getCurrentUserFromRequest(req) {
  deleteExpiredSessionsStmt.run(new Date().toISOString());

  const token = getBearerToken(req);
  if (!token) return null;

  const row = findSessionUserStmt.get(token);
  if (!row) return null;

  if (new Date(row.expiresAt).getTime() <= Date.now()) {
    deleteSessionStmt.run(token);
    return null;
  }

  return {
    ...sanitizeUser(row),
    token,
  };
}

function requireAuth(req, res, next) {
  const user = getCurrentUserFromRequest(req);
  if (!user) {
    return res.status(401).json({ error: 'Authentication required.' });
  }

  req.user = user;
  return next();
}

app.get('/api/health', (_, res) => {
  res.json({ ok: true, now: new Date().toISOString() });
});

app.post('/api/auth/register', (req, res) => {
  const email = normalizeEmail(req.body.email);
  const password = String(req.body.password || '');
  const displayName = String(req.body.displayName || '').trim();

  if (!email || !email.includes('@')) {
    return res.status(400).json({ error: 'Enter a valid email address.' });
  }

  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  }

  if (displayName.length < 2) {
    return res.status(400).json({ error: 'Display name must be at least 2 characters.' });
  }

  const existing = findUserByEmailStmt.get(email);
  if (existing) {
    return res.status(409).json({ error: 'Email already exists.' });
  }

  const passwordHash = hashPassword(password);
  const result = createUserStmt.run(email, passwordHash, displayName);
  const session = createSessionForUser(result.lastInsertRowid);
  const user = findSessionUserStmt.get(session.token);

  return res.status(201).json({
    token: session.token,
    expiresAt: session.expiresAt,
    user: sanitizeUser(user),
  });
});

app.post('/api/auth/login', (req, res) => {
  const email = normalizeEmail(req.body.email);
  const password = String(req.body.password || '');

  const user = findUserByEmailStmt.get(email);
  if (!user || !verifyPassword(password, user.passwordHash)) {
    return res.status(401).json({ error: 'Invalid email or password.' });
  }

  const session = createSessionForUser(user.id);
  return res.json({
    token: session.token,
    expiresAt: session.expiresAt,
    user: sanitizeUser(user),
  });
});

app.get('/api/auth/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

app.post('/api/auth/logout', requireAuth, (req, res) => {
  deleteSessionStmt.run(req.user.token);
  res.status(204).send();
});

app.get('/api/anime', (_, res) => {
  res.json(listAnimeStmt.all());
});

app.get('/api/episodes/upcoming', (req, res) => {
  const days = Math.max(1, Math.min(60, Number(req.query.days) || 14));
  const start = new Date();
  const end = new Date(start.getTime() + days * 24 * 60 * 60 * 1000);

  const rows = listUpcomingEpisodesStmt.all(start.toISOString(), end.toISOString());
  res.json(rows);
});

app.post('/api/reminders', requireAuth, (req, res) => {
  const animeId = req.body.animeId ? Number(req.body.animeId) : null;
  const email = req.body.email ? String(req.body.email).trim() : null;
  const discordWebhookUrl = req.body.discordWebhookUrl ? String(req.body.discordWebhookUrl).trim() : null;
  const minutesBefore = Math.max(5, Math.min(1440, Number(req.body.minutesBefore) || 60));

  if (!email && !discordWebhookUrl) {
    return res.status(400).json({ error: 'Provide at least one channel: email or Discord webhook URL.' });
  }

  const result = insertReminderStmt.run(req.user.id, animeId, email, discordWebhookUrl, minutesBefore);
  const reminder = db.prepare('SELECT * FROM reminders WHERE id = ?').get(result.lastInsertRowid);
  return res.status(201).json(reminder);
});

app.get('/api/reminders', requireAuth, (req, res) => {
  res.json(listRemindersStmt.all(req.user.id));
});

app.delete('/api/reminders/:id', requireAuth, (req, res) => {
  const id = Number(req.params.id);
  const result = deleteReminderByUserStmt.run(id, req.user.id);
  if (!result.changes) {
    return res.status(404).json({ error: 'Reminder not found.' });
  }
  return res.status(204).send();
});

app.post('/api/jobs/reminders/run', async (_, res) => {
  await runReminderScan();
  res.json({ ok: true });
});

app.get('/api/sync/status', (_, res) => {
  res.json(getAniListSyncStatus());
});

app.post('/api/sync/anilist', async (_, res) => {
  try {
    const result = await runAniListSyncSafe();
    return res.json({ ok: true, result });
  } catch (error) {
    return res.status(502).json({ error: `Sync failed: ${error.message}` });
  }
});

app.get('/api/calendar.ics', (req, res) => {
  const animeId = req.query.animeId ? Number(req.query.animeId) : null;
  const start = new Date();
  const end = new Date(start.getTime() + 30 * 24 * 60 * 60 * 1000);

  const rows = animeId
    ? db.prepare(`
      SELECT e.episode_number AS episodeNumber, e.title, e.release_at AS releaseAt, a.title AS animeTitle
      FROM episodes e
      JOIN anime a ON a.id = e.anime_id
      WHERE e.anime_id = ? AND e.release_at BETWEEN ? AND ?
      ORDER BY e.release_at ASC
    `).all(animeId, start.toISOString(), end.toISOString())
    : listUpcomingEpisodesStmt.all(start.toISOString(), end.toISOString());

  const calendar = ical({
    name: 'Anime Episode Releases',
    prodId: { company: 'anime-tracker', product: 'episode-calendar' },
    timezone: 'UTC',
  });

  rows.forEach((episode) => {
    const startAt = new Date(episode.releaseAt);
    const endAt = new Date(startAt.getTime() + 30 * 60 * 1000);

    calendar.createEvent({
      start: startAt,
      end: endAt,
      summary: `${episode.animeTitle} - Episode ${episode.episodeNumber}`,
      description: episode.title,
      url: config.appBaseUrl,
    });
  });

  res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="anime-episode-releases.ics"');
  res.send(calendar.toString());
});

app.use((req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'Not found' });
  }

  return res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

app.listen(config.port, () => {
  console.log(`Anime tracker listening on port ${config.port}`);
  startScheduler();
});
