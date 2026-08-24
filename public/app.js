const ANILIST_ENDPOINT = 'https://graphql.anilist.co';
const SCHEDULE_QUERY = `query UpcomingAiring($from: Int!, $to: Int!) { Page(page: 1, perPage: 50) { airingSchedules(airingAt_greater: $from, airingAt_lesser: $to, sort: TIME) { episode airingAt media { id title { romaji english native } coverImage { large color } popularity averageScore format siteUrl } } } }`;
const FAVORITES_KEY = 'anitime-favorite-media-ids';
const state = { releases: [], windowHours: 24, sort: 'time', search: '', loadState: 'loading', favorites: loadFavorites() };
const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'your local timezone';
const elements = {
  grid: document.getElementById('releaseGrid'), template: document.getElementById('releaseTemplate'),
  status: document.getElementById('statusMessage'), timezone: document.getElementById('timezoneLabel'),
  updated: document.getElementById('updatedLabel'), search: document.getElementById('searchInput'),
  filters: document.getElementById('dayFilters'), sort: document.getElementById('sortSelect'), export: document.getElementById('calendarExport'), refresh: document.getElementById('refreshSchedule'),
};

function loadFavorites() {
  try { return new Set(JSON.parse(localStorage.getItem(FAVORITES_KEY) || '[]')); } catch { return new Set(); }
}
function persistFavorites() {
  localStorage.setItem(FAVORITES_KEY, JSON.stringify([...state.favorites]));
}

function releaseTitle(release) {
  const title = release.media.title;
  return title.english || title.romaji || title.native || 'Untitled anime';
}
function releaseDate(release) { return new Date(release.airingAt * 1000); }
function formatReleaseTime(release) {
  return new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(releaseDate(release));
}
function countdown(release) {
  const seconds = Math.max(0, Math.floor((releaseDate(release).getTime() - Date.now()) / 1000));
  if (!seconds) return 'Airing now';
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return days ? `In ${days}d ${hours}h` : `In ${hours}h ${minutes}m`;
}
function visibleReleases() {
  const now = Date.now();
  const search = state.search.trim().toLocaleLowerCase();
  const showingFavorites = state.windowHours === 'favorites';
  const limit = now + (showingFavorites ? 14 * 24 : state.windowHours) * 60 * 60 * 1000;
  const releases = state.releases.filter((release) => {
    const timestamp = releaseDate(release).getTime();
    return timestamp >= now && timestamp <= limit && (!showingFavorites || state.favorites.has(release.media.id)) && (!search || releaseTitle(release).toLocaleLowerCase().includes(search));
  });
  return releases.sort((a, b) => {
    if (state.sort === 'popularity') return b.media.popularity - a.media.popularity || a.airingAt - b.airingAt;
    if (state.sort === 'score') return (b.media.averageScore || 0) - (a.media.averageScore || 0) || a.airingAt - b.airingAt;
    return a.airingAt - b.airingAt;
  });
}
function render() {
  const releases = visibleReleases();
  elements.grid.replaceChildren();
  elements.export.disabled = state.loadState !== 'ready' || !releases.length;
  if (state.loadState === 'loading') {
    elements.status.textContent = 'Fetching current release schedules…';
    renderLoadingCards();
    return;
  }
  if (state.loadState === 'error') {
    elements.status.textContent = 'The latest schedule could not be loaded.';
    renderStateCard('Schedule temporarily unavailable', 'AniList did not respond. Your saved releases are still stored in this browser.', 'Try again');
    return;
  }
  if (!releases.length) {
    const savedView = state.windowHours === 'favorites';
    elements.status.textContent = savedView ? 'No saved releases in the next two weeks.' : state.releases.length ? 'No releases match this view.' : 'No upcoming releases were returned.';
    renderStateCard(savedView ? 'No saved releases yet' : 'Nothing in this view', savedView ? 'Use Save on any release to build a personal short list in this browser.' : 'Try a wider time window, another search, or refresh the live schedule.', savedView ? 'Show all releases' : 'Refresh schedule');
    return;
  }
  elements.status.textContent = `${releases.length} upcoming ${releases.length === 1 ? 'episode' : 'episodes'} in this view.`;
  releases.forEach((release) => elements.grid.append(renderCard(release)));
}
function renderLoadingCards() {
  for (let index = 0; index < 8; index += 1) {
    const card = document.createElement('div');
    card.className = 'loading-card';
    card.setAttribute('aria-hidden', 'true');
    card.innerHTML = '<span></span><div><i></i><i></i><i></i></div>';
    elements.grid.append(card);
  }
}
function renderStateCard(title, copy, actionLabel) {
  const panel = document.createElement('div');
  panel.className = 'state-card';
  panel.innerHTML = `<p class="state-card__eyebrow">LIVE SCHEDULE</p><h3>${title}</h3><p>${copy}</p><button type="button">${actionLabel}</button>`;
  panel.querySelector('button').addEventListener('click', () => {
    if (actionLabel === 'Show all releases') {
      state.windowHours = 336;
      elements.filters.querySelectorAll('button').forEach((item) => item.classList.toggle('active', item.dataset.window === '336'));
      render();
      return;
    }
    loadSchedule();
  });
  elements.grid.append(panel);
}
function renderCard(release) {
  const fragment = elements.template.content.cloneNode(true);
  const image = fragment.querySelector('.cover');
  const media = release.media;
  image.src = media.coverImage.large;
  image.alt = `${releaseTitle(release)} cover art`;
  image.style.backgroundColor = media.coverImage.color || '#182031';
  image.addEventListener('error', () => { image.removeAttribute('src'); image.alt = ''; image.classList.add('cover--unavailable'); });
  fragment.querySelector('.episode-label').textContent = `EPISODE ${release.episode}`;
  fragment.querySelector('.format-label').textContent = media.format || 'ANIME';
  fragment.querySelector('.anime-title').textContent = releaseTitle(release);
  fragment.querySelector('.release-time').textContent = formatReleaseTime(release);
  const countdownElement = fragment.querySelector('.countdown');
  countdownElement.dataset.airingAt = String(release.airingAt);
  countdownElement.textContent = countdown(release);
  fragment.querySelector('.score').textContent = media.averageScore ? `${media.averageScore}% score` : 'Score pending';
  const favorite = fragment.querySelector('.favorite-button');
  const isFavorite = state.favorites.has(media.id);
  favorite.classList.toggle('is-saved', isFavorite);
  favorite.setAttribute('aria-pressed', String(isFavorite));
  favorite.innerHTML = `<span aria-hidden="true">${isFavorite ? '✓' : '+'}</span> ${isFavorite ? 'Saved' : 'Save'}`;
  favorite.addEventListener('click', () => {
    if (state.favorites.has(media.id)) state.favorites.delete(media.id);
    else state.favorites.add(media.id);
    persistFavorites();
    render();
  });
  const link = fragment.querySelector('.anilist-link');
  link.href = media.siteUrl;
  return fragment;
}
function refreshCountdowns() {
  document.querySelectorAll('[data-airing-at]').forEach((element) => { element.textContent = countdown({ airingAt: Number(element.dataset.airingAt) }); });
}
function icsEscape(value) { return String(value).replaceAll('\\', '\\\\').replaceAll(';', '\\;').replaceAll(',', '\\,').replaceAll('\n', '\\n'); }
function icsDate(date) { return date.toISOString().replaceAll('-', '').replaceAll(':', '').replace(/\.\d{3}/, ''); }
function downloadCalendar() {
  const events = visibleReleases().map((release) => {
    const start = releaseDate(release);
    const end = new Date(start.getTime() + 30 * 60 * 1000);
    return ['BEGIN:VEVENT', `UID:anitime-${release.media.id}-${release.episode}@hemanthga.com`, `DTSTAMP:${icsDate(new Date())}`, `DTSTART:${icsDate(start)}`, `DTEND:${icsDate(end)}`, `SUMMARY:${icsEscape(`${releaseTitle(release)} - Episode ${release.episode}`)}`, `DESCRIPTION:${icsEscape(`Anime release tracked with ANITIME. ${release.media.siteUrl}`)}`, `URL:${release.media.siteUrl}`, 'END:VEVENT'].join('\r\n');
  });
  const content = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//ANITIME//Anime Release Calendar//EN', 'CALSCALE:GREGORIAN', ...events, 'END:VCALENDAR'].join('\r\n');
  const url = URL.createObjectURL(new Blob([content], { type: 'text/calendar;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'anime-release-calendar.ics';
  link.click();
  URL.revokeObjectURL(url);
}
async function loadSchedule() {
  state.loadState = 'loading';
  elements.refresh.disabled = true;
  elements.refresh.textContent = 'Refreshing…';
  render();
  try {
    const now = Math.floor(Date.now() / 1000);
    const response = await fetch(ANILIST_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ query: SCHEDULE_QUERY, variables: { from: now, to: now + 14 * 86400 } }) });
    if (!response.ok) throw new Error(`AniList responded with ${response.status}`);
    const result = await response.json();
    if (result.errors?.length) throw new Error(result.errors[0].message);
    state.releases = result.data.Page.airingSchedules || [];
    state.loadState = 'ready';
    elements.updated.textContent = 'Updated just now';
  } catch (error) {
    console.error(error);
    state.loadState = 'error';
    elements.updated.textContent = 'Schedule temporarily unavailable';
  } finally {
    elements.refresh.disabled = false;
    elements.refresh.textContent = 'Refresh schedule';
    render();
  }
}
elements.timezone.textContent = timezone;
elements.filters.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-window]');
  if (!button) return;
  state.windowHours = button.dataset.window === 'favorites' ? 'favorites' : Number(button.dataset.window);
  elements.filters.querySelectorAll('button').forEach((item) => item.classList.toggle('active', item === button));
  render();
});
elements.search.addEventListener('input', () => { state.search = elements.search.value; render(); });
elements.sort.addEventListener('change', () => { state.sort = elements.sort.value; render(); });
elements.export.addEventListener('click', downloadCalendar);
elements.refresh.addEventListener('click', loadSchedule);
loadSchedule();
window.setInterval(refreshCountdowns, 30_000);
