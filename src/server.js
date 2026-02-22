const express = require('express');
const path = require('path');
const cors = require('cors');
const ical = require('ical-generator').default;

const config = require('./config');
const { db, initDb } = require('./db');
const { startScheduler, runReminderScan } = require('./jobs/scheduler');
const { runAniListSyncSafe, getAniListSyncStatus } = require('./services/anilistSyncService');
const { hashPassword, verifyPassword, createSessionToken } = require('./services/authService');
const { sendEmailReminder } = require('./services/emailService');

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
  VALUES (?, ?, ?, ?)
`);

const findUserByEmailStmt = db.prepare(`
  SELECT id, email, password_hash AS passwordHash, display_name AS displayName,
         timezone, email_verified AS emailVerified, created_at AS createdAt
  FROM users
  WHERE email = ?
`);
const findUserByIdStmt = db.prepare(`
  SELECT id, email, password_hash AS passwordHash, display_name AS displayName,
         timezone, email_verified AS emailVerified, created_at AS createdAt
  FROM users
  WHERE id = ?
`);
const updateUserTimezoneStmt = db.prepare(`
  UPDATE users
  SET timezone = ?
  WHERE id = ?
`);
const updateUserEmailVerifiedStmt = db.prepare(`
  UPDATE users
  SET email_verified = 1
  WHERE id = ?
`);
const updateUserPasswordStmt = db.prepare(`
  UPDATE users
  SET password_hash = ?
  WHERE id = ?
`);

const createSessionStmt = db.prepare(`
  INSERT INTO user_sessions (token, user_id, expires_at)
  VALUES (?, ?, ?)
`);
const deleteSessionsByUserStmt = db.prepare('DELETE FROM user_sessions WHERE user_id = ?');

const findSessionUserStmt = db.prepare(`
  SELECT u.id, u.email, u.display_name AS displayName, u.timezone,
         u.email_verified AS emailVerified,
         s.token, s.expires_at AS expiresAt
  FROM user_sessions s
  JOIN users u ON u.id = s.user_id
  WHERE s.token = ?
`);

const deleteSessionStmt = db.prepare('DELETE FROM user_sessions WHERE token = ?');
const deleteExpiredSessionsStmt = db.prepare('DELETE FROM user_sessions WHERE expires_at <= ?');
const deleteExpiredEmailVerificationTokensStmt = db.prepare(`
  DELETE FROM email_verification_tokens
  WHERE expires_at <= ? OR used_at IS NOT NULL
`);
const deleteExpiredPasswordResetTokensStmt = db.prepare(`
  DELETE FROM password_reset_tokens
  WHERE expires_at <= ? OR used_at IS NOT NULL
`);
const insertEmailVerificationTokenStmt = db.prepare(`
  INSERT INTO email_verification_tokens (token, user_id, expires_at)
  VALUES (?, ?, ?)
`);
const findEmailVerificationTokenStmt = db.prepare(`
  SELECT token, user_id AS userId, expires_at AS expiresAt, used_at AS usedAt
  FROM email_verification_tokens
  WHERE token = ?
`);
const consumeEmailVerificationTokenStmt = db.prepare(`
  UPDATE email_verification_tokens
  SET used_at = ?
  WHERE token = ?
`);
const deleteEmailVerificationByUserStmt = db.prepare('DELETE FROM email_verification_tokens WHERE user_id = ?');
const insertPasswordResetTokenStmt = db.prepare(`
  INSERT INTO password_reset_tokens (token, user_id, expires_at)
  VALUES (?, ?, ?)
`);
const findPasswordResetTokenStmt = db.prepare(`
  SELECT token, user_id AS userId, expires_at AS expiresAt, used_at AS usedAt
  FROM password_reset_tokens
  WHERE token = ?
`);
const consumePasswordResetTokenStmt = db.prepare(`
  UPDATE password_reset_tokens
  SET used_at = ?
  WHERE token = ?
`);
const deletePasswordResetByUserStmt = db.prepare('DELETE FROM password_reset_tokens WHERE user_id = ?');

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

function createExpiry(hours) {
  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
}

function isValidTimeZone(timezone) {
  try {
    Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(new Date());
    return true;
  } catch (_error) {
    return false;
  }
}

async function issueEmailVerification(user) {
  deleteExpiredEmailVerificationTokensStmt.run(new Date().toISOString());
  deleteEmailVerificationByUserStmt.run(user.id);

  const token = createSessionToken();
  const expiresAt = createExpiry(24);
  insertEmailVerificationTokenStmt.run(token, user.id, expiresAt);

  const verifyUrl = `${config.appBaseUrl}/?verifyToken=${encodeURIComponent(token)}`;
  const message = [
    `Hi ${user.displayName},`,
    '',
    'Please verify your email to activate your account:',
    verifyUrl,
    '',
    'This link expires in 24 hours.',
  ].join('\n');

  await sendEmailReminder(user.email, 'Verify your Anime Tracker email', message);
}

async function issuePasswordReset(user) {
  deleteExpiredPasswordResetTokensStmt.run(new Date().toISOString());
  deletePasswordResetByUserStmt.run(user.id);

  const token = createSessionToken();
  const expiresAt = createExpiry(1);
  insertPasswordResetTokenStmt.run(token, user.id, expiresAt);

  const resetUrl = `${config.appBaseUrl}/?resetToken=${encodeURIComponent(token)}`;
  const message = [
    `Hi ${user.displayName},`,
    '',
    'You requested a password reset:',
    resetUrl,
    '',
    'This link expires in 1 hour.',
  ].join('\n');

  await sendEmailReminder(user.email, 'Anime Tracker password reset', message);
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
    emailVerified: Boolean(user.emailVerified),
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
  const timezone = String(req.body.timezone || 'UTC').trim() || 'UTC';

  if (!email || !email.includes('@')) {
    return res.status(400).json({ error: 'Enter a valid email address.' });
  }

  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  }

  if (displayName.length < 2) {
    return res.status(400).json({ error: 'Display name must be at least 2 characters.' });
  }

  if (!isValidTimeZone(timezone)) {
    return res.status(400).json({ error: 'Invalid IANA timezone.' });
  }

  const existing = findUserByEmailStmt.get(email);
  if (existing) {
    return res.status(409).json({ error: 'Email already exists.' });
  }

  const passwordHash = hashPassword(password);
  const result = createUserStmt.run(email, passwordHash, displayName, timezone);
  const user = findUserByIdStmt.get(result.lastInsertRowid);

  issueEmailVerification(user).catch((error) => {
    console.error('Failed to send verification email:', error.message);
  });

  return res.status(201).json({
    ok: true,
    requiresEmailVerification: true,
    message: 'Account created. Please verify your email before logging in.',
  });
});

app.post('/api/auth/login', (req, res) => {
  const email = normalizeEmail(req.body.email);
  const password = String(req.body.password || '');
  const timezone = String(req.body.timezone || '').trim();

  const user = findUserByEmailStmt.get(email);
  if (!user || !verifyPassword(password, user.passwordHash)) {
    return res.status(401).json({ error: 'Invalid email or password.' });
  }

  if (!user.emailVerified) {
    return res.status(403).json({
      error: 'Please verify your email before logging in.',
      requiresEmailVerification: true,
    });
  }

  if (timezone && isValidTimeZone(timezone) && timezone !== user.timezone) {
    updateUserTimezoneStmt.run(timezone, user.id);
    user.timezone = timezone;
  }

  const session = createSessionForUser(user.id);
  return res.json({
    token: session.token,
    expiresAt: session.expiresAt,
    user: sanitizeUser(user),
  });
});

app.post('/api/auth/resend-verification', async (req, res) => {
  const email = normalizeEmail(req.body.email);
  const user = findUserByEmailStmt.get(email);

  if (!user || user.emailVerified) {
    return res.json({ ok: true });
  }

  try {
    await issueEmailVerification(user);
  } catch (error) {
    console.error('Failed to resend verification email:', error.message);
  }

  return res.json({ ok: true });
});

app.post('/api/auth/verify-email', (req, res) => {
  const token = String(req.body.token || '').trim();
  if (!token) return res.status(400).json({ error: 'Token is required.' });

  const row = findEmailVerificationTokenStmt.get(token);
  if (!row || row.usedAt || new Date(row.expiresAt).getTime() <= Date.now()) {
    return res.status(400).json({ error: 'Invalid or expired verification token.' });
  }

  const now = new Date().toISOString();
  consumeEmailVerificationTokenStmt.run(now, token);
  updateUserEmailVerifiedStmt.run(row.userId);

  return res.json({ ok: true, message: 'Email verified. You can now log in.' });
});

app.post('/api/auth/forgot-password', async (req, res) => {
  const email = normalizeEmail(req.body.email);
  const user = findUserByEmailStmt.get(email);

  if (user) {
    try {
      await issuePasswordReset(user);
    } catch (error) {
      console.error('Failed to send password reset email:', error.message);
    }
  }

  return res.json({ ok: true, message: 'If the account exists, a reset email was sent.' });
});

app.post('/api/auth/reset-password', (req, res) => {
  const token = String(req.body.token || '').trim();
  const newPassword = String(req.body.newPassword || '');

  if (!token) {
    return res.status(400).json({ error: 'Token is required.' });
  }

  if (newPassword.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  }

  const row = findPasswordResetTokenStmt.get(token);
  if (!row || row.usedAt || new Date(row.expiresAt).getTime() <= Date.now()) {
    return res.status(400).json({ error: 'Invalid or expired reset token.' });
  }

  const passwordHash = hashPassword(newPassword);
  const now = new Date().toISOString();
  updateUserPasswordStmt.run(passwordHash, row.userId);
  consumePasswordResetTokenStmt.run(now, token);
  deleteSessionsByUserStmt.run(row.userId);

  return res.json({ ok: true, message: 'Password reset successful. Please log in again.' });
});

app.get('/api/auth/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

app.patch('/api/auth/me', requireAuth, (req, res) => {
  const timezone = String(req.body.timezone || '').trim();
  if (!timezone) {
    return res.status(400).json({ error: 'Timezone is required.' });
  }

  if (!isValidTimeZone(timezone)) {
    return res.status(400).json({ error: 'Invalid IANA timezone.' });
  }

  updateUserTimezoneStmt.run(timezone, req.user.id);
  const refreshed = findSessionUserStmt.get(req.user.token);
  return res.json({ user: sanitizeUser(refreshed) });
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
