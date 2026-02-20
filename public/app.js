const state = {
  anime: [],
  episodes: [],
  reminders: [],
  syncStatus: null,
  episodeFilter: '24h',
  episodeSort: 'release',
};

const elements = {
  daysSelect: document.getElementById('daysSelect'),
  sortSelect: document.getElementById('sortSelect'),
  episodesGrid: document.getElementById('episodesGrid'),
  episodeFilters: document.getElementById('episodeFilters'),
  animeSelect: document.getElementById('animeSelect'),
  reminderForm: document.getElementById('reminderForm'),
  remindersList: document.getElementById('remindersList'),
  calendarBtn: document.getElementById('calendarBtn'),
  syncBtn: document.getElementById('syncBtn'),
  syncStatus: document.getElementById('syncStatus'),
};

function timeUntil(dateIso) {
  const diffMs = new Date(dateIso).getTime() - Date.now();
  if (diffMs <= 0) return 'Released';

  const totalSeconds = Math.floor(diffMs / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);

  return `${days}d ${hours}h ${minutes}m`;
}

function toDateKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function isTomorrow(date) {
  const tomorrow = new Date();
  tomorrow.setHours(0, 0, 0, 0);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const nextDay = new Date(tomorrow);
  nextDay.setDate(nextDay.getDate() + 1);

  return date >= tomorrow && date < nextDay;
}

function filterEpisodes() {
  const now = Date.now();

  return state.episodes.filter((episode) => {
    const release = new Date(episode.releaseAt).getTime();
    if (release < now) return false;

    const diffMs = release - now;
    switch (state.episodeFilter) {
      case '24h':
        return diffMs <= 24 * 60 * 60 * 1000;
      case 'tomorrow':
        return isTomorrow(new Date(release));
      case '3d':
        return diffMs <= 3 * 24 * 60 * 60 * 1000;
      case '7d':
        return diffMs <= 7 * 24 * 60 * 60 * 1000;
      case 'all':
      default:
        return true;
    }
  });
}

function sortEpisodes(episodes) {
  const copy = [...episodes];

  if (state.episodeSort === 'popularity') {
    copy.sort((a, b) => {
      const dayA = toDateKey(new Date(a.releaseAt));
      const dayB = toDateKey(new Date(b.releaseAt));
      if (dayA !== dayB) return dayA.localeCompare(dayB);

      const popularityDiff = (Number(b.animePopularity) || 0) - (Number(a.animePopularity) || 0);
      if (popularityDiff !== 0) return popularityDiff;

      const releaseDiff = new Date(a.releaseAt).getTime() - new Date(b.releaseAt).getTime();
      if (releaseDiff !== 0) return releaseDiff;

      return a.animeTitle.localeCompare(b.animeTitle);
    });

    return copy;
  }

  copy.sort((a, b) => new Date(a.releaseAt).getTime() - new Date(b.releaseAt).getTime());
  return copy;
}

function groupEpisodesByDay(episodes) {
  const groups = new Map();

  episodes.forEach((episode) => {
    const release = new Date(episode.releaseAt);
    const key = toDateKey(release);

    if (!groups.has(key)) {
      groups.set(key, []);
    }

    groups.get(key).push(episode);
  });

  return groups;
}

function renderEpisodeCard(episode, index) {
  const template = document.getElementById('episodeCardTemplate');
  const fragment = template.content.cloneNode(true);
  const card = fragment.querySelector('.episode-card');
  card.dataset.releaseAt = episode.releaseAt;

  const sourceLabel = episode.source === 'anilist' ? 'AniList' : 'Local';
  const popularity = Number(episode.animePopularity) || 0;
  fragment.querySelector('.chip').textContent = `#${index + 1} · ${sourceLabel}`;
  fragment.querySelector('.pop-badge').textContent = '';
  fragment.querySelector('h3').textContent = `${episode.animeTitle} · Ep ${episode.episodeNumber}`;
  fragment.querySelector('.episode-title').textContent = `${episode.title} · Popularity ${popularity.toLocaleString()}`;
  fragment.querySelector('.release-at').textContent = `Release: ${new Date(episode.releaseAt).toLocaleString()}`;
  fragment.querySelector('.countdown').textContent = `Countdown: ${timeUntil(episode.releaseAt)}`;

  return fragment;
}

function assignPopularityTileClasses(container, episodes) {
  if (!episodes.length) return;

  const popularities = episodes.map((episode) => Number(episode.animePopularity) || 0);
  const maxPopularity = Math.max(...popularities, 0);
  if (maxPopularity <= 0) return;

  const cards = container.querySelectorAll('.episode-card');
  const ranked = popularities
    .map((popularity, index) => ({ popularity, index }))
    .sort((a, b) => b.popularity - a.popularity);
  const rankByIndex = new Map(ranked.map((item, rank) => [item.index, rank + 1]));

  cards.forEach((card, index) => {
    const popularity = popularities[index] || 0;
    const ratio = popularity / maxPopularity;
    const rank = rankByIndex.get(index) || 0;
    const badge = card.querySelector('.pop-badge');

    if (ratio >= 0.75) {
      card.classList.add('tile-xl');
    } else if (ratio >= 0.45) {
      card.classList.add('tile-l');
    }

    if (rank === 1) {
      card.classList.add('popular-hero');
      badge.textContent = 'Trending #1';
    } else if (rank === 2 || rank === 3) {
      card.classList.add('popular-hot');
      badge.textContent = `Top ${rank}`;
    } else if (ratio >= 0.5) {
      badge.textContent = 'Popular';
    }
  });
}

async function api(path, options) {
  const response = await fetch(path, options);
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `Request failed: ${response.status}`);
  }

  if (response.status === 204) return null;
  return response.json();
}

function renderAnimeSelect() {
  elements.animeSelect.innerHTML = '';

  const allOption = document.createElement('option');
  allOption.value = '';
  allOption.textContent = 'All Anime';
  elements.animeSelect.appendChild(allOption);

  state.anime.forEach((anime) => {
    const option = document.createElement('option');
    option.value = anime.id;
    option.textContent = `${anime.title}${anime.source === 'anilist' ? ' (AniList)' : ''}`;
    elements.animeSelect.appendChild(option);
  });
}

function renderEpisodes() {
  elements.episodesGrid.innerHTML = '';
  const filtered = sortEpisodes(filterEpisodes());

  if (!filtered.length) {
    elements.episodesGrid.innerHTML = '<p class="muted">No episodes match this filter.</p>';
    return;
  }

  const groups = groupEpisodesByDay(filtered);

  Array.from(groups.entries()).forEach(([dateKey, groupEpisodes]) => {
    const group = document.createElement('section');
    group.className = 'episode-day-group';

    const heading = document.createElement('h3');
    heading.textContent = new Date(`${dateKey}T00:00:00`).toLocaleDateString(undefined, {
      weekday: 'long',
      month: 'short',
      day: 'numeric',
    });

    const cards = document.createElement('div');
    cards.className = 'episode-day-cards';

    groupEpisodes.forEach((episode, index) => {
      cards.appendChild(renderEpisodeCard(episode, index));
    });
    assignPopularityTileClasses(cards, groupEpisodes);

    group.appendChild(heading);
    group.appendChild(cards);
    elements.episodesGrid.appendChild(group);
  });
}

function refreshCountdowns() {
  const cards = elements.episodesGrid.querySelectorAll('.episode-card');
  cards.forEach((card) => {
    const countdown = card.querySelector('.countdown');
    countdown.textContent = `Countdown: ${timeUntil(card.dataset.releaseAt)}`;
  });
}

function renderReminders() {
  elements.remindersList.innerHTML = '';

  if (!state.reminders.length) {
    elements.remindersList.innerHTML = '<li class="muted">No reminders yet.</li>';
    return;
  }

  state.reminders.forEach((reminder) => {
    const item = document.createElement('li');
    const target = reminder.animeTitle || 'All anime';
    const channels = [
      reminder.email ? `Email: ${reminder.email}` : null,
      reminder.discordWebhookUrl ? 'Discord: enabled' : null,
    ].filter(Boolean).join(' | ');

    item.innerHTML = `
      <span>
        <strong>${target}</strong><br />
        <small>${reminder.minutesBefore} min before | ${channels}</small>
      </span>
    `;

    const removeBtn = document.createElement('button');
    removeBtn.className = 'danger';
    removeBtn.textContent = 'Delete';
    removeBtn.onclick = async () => {
      await api(`/api/reminders/${reminder.id}`, { method: 'DELETE' });
      await loadReminders();
    };

    item.appendChild(removeBtn);
    elements.remindersList.appendChild(item);
  });
}

function renderSyncStatus() {
  if (!state.syncStatus) {
    elements.syncStatus.textContent = 'Sync status unavailable.';
    return;
  }

  const { lastSyncAt, lastResult, lastError } = state.syncStatus;
  if (lastError) {
    elements.syncStatus.textContent = `Last sync error: ${lastError}`;
    return;
  }

  if (!lastSyncAt) {
    elements.syncStatus.textContent = 'No AniList sync has run yet.';
    return;
  }

  const synced = new Date(lastSyncAt).toLocaleString();
  const details = lastResult
    ? `Rows: ${lastResult.fetchedRows}, episodes synced: ${lastResult.syncedEpisodes}`
    : 'Completed.';
  elements.syncStatus.textContent = `Last sync: ${synced}. ${details}`;
}

function setEpisodeFilter(filterValue) {
  state.episodeFilter = filterValue;
  const chips = elements.episodeFilters.querySelectorAll('.filter-chip');
  chips.forEach((chip) => {
    chip.classList.toggle('active', chip.dataset.filter === filterValue);
  });
  renderEpisodes();
}

function setEpisodeSort(sortValue) {
  state.episodeSort = sortValue;
  renderEpisodes();
}

async function loadAnime() {
  state.anime = await api('/api/anime');
  renderAnimeSelect();
}

async function loadEpisodes() {
  const days = elements.daysSelect.value;
  state.episodes = await api(`/api/episodes/upcoming?days=${days}`);
  renderEpisodes();
}

async function loadReminders() {
  state.reminders = await api('/api/reminders');
  renderReminders();
}

async function loadSyncStatus() {
  state.syncStatus = await api('/api/sync/status');
  renderSyncStatus();
}

function registerEvents() {
  elements.daysSelect.addEventListener('change', loadEpisodes);
  elements.sortSelect.addEventListener('change', (event) => {
    setEpisodeSort(event.target.value);
  });

  elements.episodeFilters.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLButtonElement)) return;
    if (!target.dataset.filter) return;
    setEpisodeFilter(target.dataset.filter);
  });

  elements.reminderForm.addEventListener('submit', async (event) => {
    event.preventDefault();

    const payload = {
      animeId: document.getElementById('animeSelect').value || null,
      minutesBefore: document.getElementById('minutesBefore').value,
      email: document.getElementById('email').value,
      discordWebhookUrl: document.getElementById('discordWebhookUrl').value,
    };

    try {
      await api('/api/reminders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      elements.reminderForm.reset();
      document.getElementById('minutesBefore').value = 60;
      await loadReminders();
    } catch (error) {
      alert(error.message);
    }
  });

  elements.calendarBtn.addEventListener('click', () => {
    const animeId = elements.animeSelect.value;
    const url = animeId ? `/api/calendar.ics?animeId=${animeId}` : '/api/calendar.ics';
    window.location.href = url;
  });

  elements.syncBtn.addEventListener('click', async () => {
    elements.syncBtn.disabled = true;
    elements.syncBtn.textContent = 'Syncing...';

    try {
      await api('/api/sync/anilist', { method: 'POST' });
      await Promise.all([loadAnime(), loadEpisodes(), loadSyncStatus()]);
    } catch (error) {
      alert(error.message);
      await loadSyncStatus();
    } finally {
      elements.syncBtn.disabled = false;
      elements.syncBtn.textContent = 'Sync from AniList';
    }
  });
}

async function bootstrap() {
  registerEvents();
  await Promise.all([loadAnime(), loadEpisodes(), loadReminders(), loadSyncStatus()]);
  setInterval(refreshCountdowns, 1000 * 30);
}

bootstrap().catch((error) => {
  console.error(error);
  alert('Failed to load dashboard. Check server logs.');
});
