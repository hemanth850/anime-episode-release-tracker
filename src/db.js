const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const config = require('./config');

const resolvedPath = path.resolve(config.dbPath);
fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });

const db = new Database(resolvedPath);
db.pragma('journal_mode = WAL');

function hasColumn(tableName, columnName) {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all();
  return columns.some((column) => column.name === columnName);
}

function ensureColumn(tableName, columnName, definition) {
  if (!hasColumn(tableName, columnName)) {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
  }
}

function initDb() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS anime (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      cover_image_url TEXT,
      synopsis TEXT,
      total_episodes INTEGER,
      source TEXT NOT NULL DEFAULT 'local',
      external_id TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS episodes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      anime_id INTEGER NOT NULL,
      episode_number INTEGER NOT NULL,
      title TEXT,
      release_at TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'local',
      external_id TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (anime_id) REFERENCES anime(id) ON DELETE CASCADE,
      UNIQUE(anime_id, episode_number)
    );

    CREATE TABLE IF NOT EXISTS reminders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      anime_id INTEGER,
      email TEXT,
      discord_webhook_url TEXT,
      minutes_before INTEGER NOT NULL DEFAULT 60,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (anime_id) REFERENCES anime(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS notification_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      reminder_id INTEGER NOT NULL,
      episode_id INTEGER NOT NULL,
      channel TEXT NOT NULL,
      sent_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (reminder_id) REFERENCES reminders(id) ON DELETE CASCADE,
      FOREIGN KEY (episode_id) REFERENCES episodes(id) ON DELETE CASCADE,
      UNIQUE(reminder_id, episode_id, channel)
    );

    CREATE TABLE IF NOT EXISTS sync_state (
      state_key TEXT PRIMARY KEY,
      state_value TEXT,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_episodes_release_at ON episodes(release_at);
    CREATE INDEX IF NOT EXISTS idx_reminders_active ON reminders(is_active);
  `);

  ensureColumn('anime', 'source', "TEXT NOT NULL DEFAULT 'local'");
  ensureColumn('anime', 'external_id', 'TEXT');
  ensureColumn('episodes', 'source', "TEXT NOT NULL DEFAULT 'local'");
  ensureColumn('episodes', 'external_id', 'TEXT');

  db.exec(`
    DROP INDEX IF EXISTS idx_anime_source_external;
    DROP INDEX IF EXISTS idx_episode_source_external;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_anime_source_external ON anime(source, external_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_episode_source_external ON episodes(source, external_id);
  `);

  const animeCount = db.prepare('SELECT COUNT(*) AS count FROM anime').get().count;
  if (animeCount === 0) {
    seedData();
  }
}

function seedData() {
  const now = new Date();
  const animeInsert = db.prepare(`
    INSERT INTO anime (title, cover_image_url, synopsis, total_episodes, source)
    VALUES (?, ?, ?, ?, 'local')
  `);

  const episodeInsert = db.prepare(`
    INSERT INTO episodes (anime_id, episode_number, title, release_at, source)
    VALUES (?, ?, ?, ?, 'local')
  `);

  const animes = [
    {
      title: 'Skybound Blades',
      cover: 'https://images.unsplash.com/photo-1519861531473-9200262188bf?w=640&q=80&auto=format&fit=crop',
      synopsis: 'A fallen knight and a rogue pilot chase relics hidden above a floating archipelago.',
      totalEpisodes: 12,
      days: [1, 8, 15],
    },
    {
      title: 'Neon Ramen Club',
      cover: 'https://images.unsplash.com/photo-1543353071-10c8ba85a904?w=640&q=80&auto=format&fit=crop',
      synopsis: 'Three students solve city mysteries one midnight ramen stall at a time.',
      totalEpisodes: 10,
      days: [3, 10, 17],
    },
    {
      title: 'Clockwork Familiar',
      cover: 'https://images.unsplash.com/photo-1517336714739-489689fd1ca8?w=640&q=80&auto=format&fit=crop',
      synopsis: 'A watchmaker binds a mechanical spirit to reverse a timeline fracture.',
      totalEpisodes: 13,
      days: [2, 9, 16],
    },
  ];

  const tx = db.transaction(() => {
    for (const anime of animes) {
      const result = animeInsert.run(anime.title, anime.cover, anime.synopsis, anime.totalEpisodes);
      const animeId = result.lastInsertRowid;

      anime.days.forEach((offset, index) => {
        const releaseAt = new Date(now.getTime() + offset * 24 * 60 * 60 * 1000);
        releaseAt.setUTCHours(16 + index, 0, 0, 0);
        episodeInsert.run(
          animeId,
          index + 1,
          `Episode ${index + 1}: ${anime.title} Arc ${index + 1}`,
          releaseAt.toISOString()
        );
      });
    }
  });

  tx();
}

module.exports = {
  db,
  initDb,
};
