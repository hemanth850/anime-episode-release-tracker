const cron = require('node-cron');

const config = require('../config');
const { db } = require('../db');
const { runAniListSyncSafe } = require('../services/anilistSyncService');
const { sendEmailReminder } = require('../services/emailService');
const { sendDiscordReminder } = require('../services/discordService');

let statements = null;

function getStatements() {
  if (statements) return statements;

  statements = {
    selectReminders: db.prepare(`
      SELECT r.*, u.email AS user_email, a.title AS anime_title
      FROM reminders r
      JOIN users u ON u.id = r.user_id
      LEFT JOIN anime a ON a.id = r.anime_id
      WHERE r.is_active = 1
    `),
    selectCandidateEpisodes: db.prepare(`
      SELECT e.id, e.anime_id, e.episode_number, e.title, e.release_at, a.title AS anime_title
      FROM episodes e
      JOIN anime a ON a.id = e.anime_id
      WHERE e.release_at BETWEEN ? AND ?
      ORDER BY e.release_at ASC
    `),
    wasSentStmt: db.prepare(`
      SELECT 1
      FROM notification_log
      WHERE reminder_id = ? AND episode_id = ? AND channel = ?
    `),
    insertLogStmt: db.prepare(`
      INSERT INTO notification_log (reminder_id, episode_id, channel)
      VALUES (?, ?, ?)
    `),
  };

  return statements;
}

async function runReminderScan() {
  const { selectCandidateEpisodes, selectReminders, wasSentStmt, insertLogStmt } = getStatements();
  const now = new Date();
  const lookahead = new Date(now.getTime() + 48 * 60 * 60 * 1000);
  const candidates = selectCandidateEpisodes.all(now.toISOString(), lookahead.toISOString());
  const reminders = selectReminders.all();

  for (const reminder of reminders) {
    for (const episode of candidates) {
      if (reminder.anime_id && reminder.anime_id !== episode.anime_id) {
        continue;
      }

      const releaseAt = new Date(episode.release_at);
      const triggerAt = new Date(releaseAt.getTime() - reminder.minutes_before * 60 * 1000);
      const diffMs = now.getTime() - triggerAt.getTime();

      if (diffMs < 0 || diffMs > 60 * 1000) {
        continue;
      }

      const message = `${episode.anime_title} - Episode ${episode.episode_number} releases at ${releaseAt.toUTCString()}.`;

      const emailTarget = reminder.email || reminder.user_email;
      if (emailTarget && !wasSentStmt.get(reminder.id, episode.id, 'email')) {
        try {
          await sendEmailReminder(emailTarget, 'Anime Episode Reminder', message);
          insertLogStmt.run(reminder.id, episode.id, 'email');
        } catch (error) {
          console.error('Failed to send email reminder:', error.message);
        }
      }

      if (reminder.discord_webhook_url && !wasSentStmt.get(reminder.id, episode.id, 'discord')) {
        try {
          await sendDiscordReminder(reminder.discord_webhook_url, `:tv: ${message}`);
          insertLogStmt.run(reminder.id, episode.id, 'discord');
        } catch (error) {
          console.error('Failed to send Discord reminder:', error.message);
        }
      }
    }
  }
}

function startScheduler() {
  if (config.jobs.disableStartup) {
    console.log('Scheduler disabled via DISABLE_STARTUP_JOBS');
    return;
  }

  cron.schedule('* * * * *', () => {
    runReminderScan().catch((error) => {
      console.error('Reminder job failed:', error.message);
    });
  });

  runReminderScan().catch((error) => {
    console.error('Initial reminder scan failed:', error.message);
  });

  cron.schedule(config.anilist.syncCron, () => {
    runAniListSyncSafe().catch((error) => {
      console.error('AniList sync failed:', error.message);
    });
  });

  runAniListSyncSafe().catch((error) => {
    console.error('Initial AniList sync failed:', error.message);
  });
}

module.exports = {
  startScheduler,
  runReminderScan,
};
