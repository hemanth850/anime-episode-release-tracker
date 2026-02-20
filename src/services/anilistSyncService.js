const config = require('../config');
const { db } = require('../db');

const ANILIST_URL = 'https://graphql.anilist.co';

let statements = null;

function getStatements() {
  if (statements) return statements;

  statements = {
    upsertAnimeStmt: db.prepare(`
      INSERT INTO anime (title, cover_image_url, synopsis, total_episodes, source, external_id)
      VALUES (?, ?, ?, ?, 'anilist', ?)
      ON CONFLICT(source, external_id) DO UPDATE SET
        title = excluded.title,
        cover_image_url = excluded.cover_image_url,
        synopsis = excluded.synopsis,
        total_episodes = excluded.total_episodes
    `),
    findAnimeStmt: db.prepare(`
      SELECT id
      FROM anime
      WHERE source = 'anilist' AND external_id = ?
    `),
    upsertEpisodeStmt: db.prepare(`
      INSERT INTO episodes (anime_id, episode_number, title, release_at, source, external_id)
      VALUES (?, ?, ?, ?, 'anilist', ?)
      ON CONFLICT(source, external_id) DO UPDATE SET
        anime_id = excluded.anime_id,
        episode_number = excluded.episode_number,
        title = excluded.title,
        release_at = excluded.release_at
    `),
    setSyncStateStmt: db.prepare(`
      INSERT INTO sync_state (state_key, state_value, updated_at)
      VALUES (?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(state_key) DO UPDATE SET
        state_value = excluded.state_value,
        updated_at = CURRENT_TIMESTAMP
    `),
    getSyncStateStmt: db.prepare(`
      SELECT state_key AS stateKey, state_value AS stateValue, updated_at AS updatedAt
      FROM sync_state
      WHERE state_key IN ('anilist_last_sync', 'anilist_last_result', 'anilist_last_error')
    `),
  };

  return statements;
}

function sanitizeText(value) {
  if (!value) return null;
  const cleaned = String(value)
    .replace(/<br\s*\/?>(\s*)/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();

  return cleaned.length ? cleaned : null;
}

async function fetchAiringSchedulePage(page, perPage) {
  const query = `
    query ($page: Int, $perPage: Int) {
      Page(page: $page, perPage: $perPage) {
        airingSchedules(notYetAired: true, sort: TIME) {
          id
          episode
          airingAt
          media {
            id
            type
            title {
              english
              romaji
              native
            }
            coverImage {
              large
              medium
            }
            description(asHtml: false)
            episodes
            status
          }
        }
      }
    }
  `;

  const response = await fetch(ANILIST_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ query, variables: { page, perPage } }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`AniList request failed (${response.status}): ${body}`);
  }

  const json = await response.json();
  if (json.errors) {
    throw new Error(`AniList GraphQL error: ${JSON.stringify(json.errors)}`);
  }

  return json?.data?.Page?.airingSchedules || [];
}

async function runAniListSync() {
  const { upsertAnimeStmt, findAnimeStmt, upsertEpisodeStmt, setSyncStateStmt } = getStatements();
  const now = new Date();
  const rows = [];

  for (let page = 1; page <= config.anilist.pageLimit; page += 1) {
    const pageRows = await fetchAiringSchedulePage(page, config.anilist.perPage);
    if (!pageRows.length) break;
    rows.push(...pageRows);
  }

  let insertedAnime = 0;
  let syncedEpisodes = 0;

  const tx = db.transaction((items) => {
    for (const item of items) {
      if (!item?.media || item.media.type !== 'ANIME') continue;
      if (!item.episode || !item.airingAt) continue;

      const externalAnimeId = String(item.media.id);
      const externalEpisodeId = String(item.id);
      const title = item.media.title.english || item.media.title.romaji || item.media.title.native || `Anime ${externalAnimeId}`;
      const synopsis = sanitizeText(item.media.description);
      const cover = item.media.coverImage?.large || item.media.coverImage?.medium || null;

      const upsertAnimeResult = upsertAnimeStmt.run(
        title,
        cover,
        synopsis,
        item.media.episodes || null,
        externalAnimeId
      );

      if (upsertAnimeResult.changes > 0) {
        insertedAnime += 1;
      }

      const anime = findAnimeStmt.get(externalAnimeId);
      if (!anime) continue;

      upsertEpisodeStmt.run(
        anime.id,
        item.episode,
        `Episode ${item.episode}`,
        new Date(item.airingAt * 1000).toISOString(),
        externalEpisodeId
      );

      syncedEpisodes += 1;
    }
  });

  tx(rows);

  const result = {
    source: 'anilist',
    fetchedRows: rows.length,
    syncedEpisodes,
    touchedAnime: insertedAnime,
    syncedAt: now.toISOString(),
  };

  setSyncStateStmt.run('anilist_last_sync', result.syncedAt);
  setSyncStateStmt.run('anilist_last_result', JSON.stringify(result));
  setSyncStateStmt.run('anilist_last_error', '');

  return result;
}

function getAniListSyncStatus() {
  const { getSyncStateStmt } = getStatements();
  const rows = getSyncStateStmt.all();
  const map = Object.fromEntries(rows.map((row) => [row.stateKey, row.stateValue]));

  let lastResult = null;
  if (map.anilist_last_result) {
    try {
      lastResult = JSON.parse(map.anilist_last_result);
    } catch (_error) {
      lastResult = null;
    }
  }

  return {
    lastSyncAt: map.anilist_last_sync || null,
    lastResult,
    lastError: map.anilist_last_error || null,
  };
}

async function runAniListSyncSafe() {
  const { setSyncStateStmt } = getStatements();
  try {
    return await runAniListSync();
  } catch (error) {
    setSyncStateStmt.run('anilist_last_error', error.message);
    throw error;
  }
}

module.exports = {
  runAniListSync,
  runAniListSyncSafe,
  getAniListSyncStatus,
};
