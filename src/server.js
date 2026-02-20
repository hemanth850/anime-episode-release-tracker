const express = require('express');
const path = require('path');
const cors = require('cors');
const ical = require('ical-generator').default;

const config = require('./config');
const { db, initDb } = require('./db');
const { startScheduler, runReminderScan } = require('./jobs/scheduler');
const { runAniListSyncSafe, getAniListSyncStatus } = require('./services/anilistSyncService');

initDb();

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

const listAnimeStmt = db.prepare(`
  SELECT id, title, cover_image_url AS coverImageUrl, synopsis, total_episodes AS totalEpisodes, source
  FROM anime
  ORDER BY title ASC
`);

const listUpcomingEpisodesStmt = db.prepare(`
  SELECT e.id, e.anime_id AS animeId, a.title AS animeTitle,
         e.episode_number AS episodeNumber, e.title, e.release_at AS releaseAt,
         e.source, a.source AS animeSource
  FROM episodes e
  JOIN anime a ON a.id = e.anime_id
  WHERE e.release_at BETWEEN ? AND ?
  ORDER BY e.release_at ASC
`);

const insertReminderStmt = db.prepare(`
  INSERT INTO reminders (anime_id, email, discord_webhook_url, minutes_before)
  VALUES (?, ?, ?, ?)
`);

const listRemindersStmt = db.prepare(`
  SELECT r.id, r.anime_id AS animeId, a.title AS animeTitle, r.email,
         r.discord_webhook_url AS discordWebhookUrl,
         r.minutes_before AS minutesBefore, r.is_active AS isActive, r.created_at AS createdAt
  FROM reminders r
  LEFT JOIN anime a ON a.id = r.anime_id
  ORDER BY r.created_at DESC
`);

const deleteReminderStmt = db.prepare('DELETE FROM reminders WHERE id = ?');

app.get('/api/health', (_, res) => {
  res.json({ ok: true, now: new Date().toISOString() });
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

app.post('/api/reminders', (req, res) => {
  const animeId = req.body.animeId ? Number(req.body.animeId) : null;
  const email = req.body.email ? String(req.body.email).trim() : null;
  const discordWebhookUrl = req.body.discordWebhookUrl ? String(req.body.discordWebhookUrl).trim() : null;
  const minutesBefore = Math.max(5, Math.min(1440, Number(req.body.minutesBefore) || 60));

  if (!email && !discordWebhookUrl) {
    return res.status(400).json({ error: 'Provide at least one channel: email or Discord webhook URL.' });
  }

  const result = insertReminderStmt.run(animeId, email, discordWebhookUrl, minutesBefore);
  const reminder = db.prepare('SELECT * FROM reminders WHERE id = ?').get(result.lastInsertRowid);
  return res.status(201).json(reminder);
});

app.get('/api/reminders', (_, res) => {
  res.json(listRemindersStmt.all());
});

app.delete('/api/reminders/:id', (req, res) => {
  const id = Number(req.params.id);
  const result = deleteReminderStmt.run(id);
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
