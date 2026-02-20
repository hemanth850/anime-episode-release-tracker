const state = {
  anime: [],
  episodes: [],
  reminders: [],
  syncStatus: null,
};

const elements = {
  daysSelect: document.getElementById('daysSelect'),
  episodesGrid: document.getElementById('episodesGrid'),
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
  const template = document.getElementById('episodeCardTemplate');

  if (!state.episodes.length) {
    elements.episodesGrid.innerHTML = '<p class="muted">No episodes in this time window.</p>';
    return;
  }

  state.episodes.forEach((episode, index) => {
    const fragment = template.content.cloneNode(true);
    const card = fragment.querySelector('.episode-card');
    card.dataset.releaseAt = episode.releaseAt;

    const sourceLabel = episode.source === 'anilist' ? 'AniList' : 'Local';
    fragment.querySelector('.chip').textContent = `#${index + 1} in queue · ${sourceLabel}`;
    fragment.querySelector('h3').textContent = `${episode.animeTitle} · Ep ${episode.episodeNumber}`;
    fragment.querySelector('.episode-title').textContent = episode.title;
    fragment.querySelector('.release-at').textContent = `Release: ${new Date(episode.releaseAt).toLocaleString()}`;
    fragment.querySelector('.countdown').textContent = `Countdown: ${timeUntil(episode.releaseAt)}`;

    elements.episodesGrid.appendChild(fragment);
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
