/* Sinima — free, open-source movie app.
 *
 * Three parts:
 *   1. Free films   – public-domain films from the Internet Archive (archive.org)
 *   2. Services     – legal services that work in Ethiopia (sources/ethiopia.json)
 *   3. My sources   – videos, playlists, catalogs and websites the user adds
 *
 * Everything runs in the browser. User sources are kept in localStorage.
 */

'use strict';

/* ---------- small helpers ---------- */

const $ = (sel) => document.querySelector(sel);

// Build an element: el('p', {class: 'x'}, 'text', childEl)
function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue;
    if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

// Only allow web links (blocks javascript: and other unsafe link types)
function isWebUrl(text) {
  try {
    const u = new URL(text);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
}

const storage = {
  get(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  },
};

/* ---------- tabs ---------- */

const views = {
  free: $('#view-free'),
  services: $('#view-services'),
  mine: $('#view-mine'),
  source: $('#view-source'),
};

function showView(name) {
  for (const [key, view] of Object.entries(views)) view.hidden = key !== name;
  const tab = name === 'source' ? 'mine' : name;
  document.querySelectorAll('.tabs button').forEach((b) => {
    if (b.dataset.tab === tab) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  });
  window.scrollTo(0, 0);
}

document.querySelectorAll('.tabs button').forEach((b) => {
  b.addEventListener('click', () => {
    showView(b.dataset.tab);
    if (location.hash !== '#' + b.dataset.tab) history.replaceState(null, '', '#' + b.dataset.tab);
  });
});

/* ---------- player ---------- */

const player = $('#player');
const video = $('#video');
let hls = null;

function openPlayer({ title, url, info }) {
  $('#player-title').textContent = title;
  $('#player-info').textContent = info || '';
  $('#player-error').hidden = true;
  player.hidden = false;
  stopVideo();

  const isHls = /\.m3u8(\?|$)/i.test(url);
  if (isHls && !video.canPlayType('application/vnd.apple.mpegurl') && window.Hls && window.Hls.isSupported()) {
    hls = new window.Hls();
    hls.loadSource(url);
    hls.attachMedia(video);
    hls.on(window.Hls.Events.ERROR, (_e, data) => {
      if (data.fatal) showPlayerError();
    });
  } else {
    video.src = url;
  }
  video.play().catch(() => { /* the user can press play */ });
}

function stopVideo() {
  if (hls) { hls.destroy(); hls = null; }
  video.pause();
  video.removeAttribute('src');
  video.load();
}

function showPlayerError() {
  const err = $('#player-error');
  err.textContent = "This video couldn't be played. The link may be broken, or the site may not allow other apps to play its videos.";
  err.hidden = false;
}

video.addEventListener('error', () => { if (video.getAttribute('src')) showPlayerError(); });
$('#player-close').addEventListener('click', closePlayer);
function closePlayer() { stopVideo(); player.hidden = true; }

/* ---------- 1. FREE FILMS (Internet Archive) ---------- */

const IA = 'https://archive.org';
// Only films that have a playable video file, and leave out adult titles.
const IA_BASE_QUERY =
  'collection:(feature_films) AND mediatype:(movies) AND format:("h.264" OR "MPEG4")' +
  ' AND -subject:(sex OR adult OR erotic OR nudity OR exploitation) AND -title:(sex)';

const GENRES = [
  { label: 'Popular', q: '' },
  { label: 'Comedy', q: 'subject:(comedy)' },
  { label: 'Drama', q: 'subject:(drama)' },
  { label: 'Western', q: 'subject:(western)' },
  { label: 'Mystery', q: 'subject:(mystery OR noir OR crime)' },
  { label: 'Sci-Fi', q: 'subject:("science fiction" OR sci-fi)' },
  { label: 'Horror', q: 'subject:(horror)' },
  { label: 'Silent', q: 'subject:(silent)' },
];

const free = { page: 1, genre: GENRES[0], text: '', loading: false };

function renderGenres() {
  const box = $('#genres');
  box.replaceChildren(...GENRES.map((g) => el('button', {
    type: 'button',
    'aria-pressed': String(g === free.genre),
    onclick: () => { free.genre = g; free.text = ''; $('#free-q').value = ''; renderGenres(); loadFree(true); },
  }, g.label)));
}

async function loadFree(reset) {
  if (free.loading) return;
  free.loading = true;
  const grid = $('#free-grid');
  const more = $('#free-more');
  if (reset) {
    free.page = 1;
    grid.replaceChildren(...Array.from({ length: 12 }, () =>
      el('div', { class: 'film skeleton' }, el('div', { class: 'poster' }))));
  }
  more.hidden = true;

  let q = IA_BASE_QUERY;
  if (free.genre.q) q += ' AND ' + free.genre.q;
  if (free.text) q += ' AND title:(' + free.text.replace(/[^\p{L}\p{N} ]/gu, ' ') + ')';

  const params = new URLSearchParams({ q, rows: '30', page: String(free.page), output: 'json' });
  ['identifier', 'title', 'year', 'description'].forEach((f) => params.append('fl[]', f));
  params.append('sort[]', 'downloads desc');

  try {
    const res = await fetch(`${IA}/advancedsearch.php?${params}`);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    const docs = data.response.docs;
    if (reset) grid.replaceChildren();
    if (reset && docs.length === 0) {
      grid.append(el('p', { class: 'empty' }, 'No films found. Try another word.'));
    }
    grid.append(...docs.map(filmTile));
    more.hidden = free.page * 30 >= data.response.numFound;
  } catch {
    if (reset) grid.replaceChildren();
    grid.append(el('p', { class: 'empty' }, "Couldn't reach the Internet Archive. Check your internet and try again."));
  } finally {
    free.loading = false;
  }
}

function filmTile(doc) {
  const title = Array.isArray(doc.title) ? doc.title[0] : doc.title;
  return el('button', { class: 'film', type: 'button', onclick: () => playArchiveFilm(doc.identifier, title, doc.year) },
    el('img', { class: 'poster', loading: 'lazy', alt: '', src: `${IA}/services/img/${encodeURIComponent(doc.identifier)}` }),
    el('div', { class: 't' }, title || doc.identifier),
    el('div', { class: 'y' }, doc.year || ''));
}

// Find the best video file for an archive.org film, then play it
async function playArchiveFilm(id, title, year) {
  openPlayer({ title, url: '', info: 'Loading…' });
  try {
    const res = await fetch(`${IA}/metadata/${encodeURIComponent(id)}`);
    const meta = await res.json();
    const files = meta.files || [];
    const pick =
      files.find((f) => f.format === 'h.264' && /\.mp4$/i.test(f.name)) ||
      files.find((f) => f.format === '512Kb MPEG4') ||
      files.find((f) => /\.mp4$/i.test(f.name));
    if (!pick) throw new Error('no video');
    const url = `${IA}/download/${encodeURIComponent(id)}/${pick.name.split('/').map(encodeURIComponent).join('/')}`;
    openPlayer({ title, url, info: (year ? year + ' · ' : '') + 'Public domain, via the Internet Archive' });
  } catch {
    showPlayerError();
    $('#player-info').textContent = '';
  }
}

$('#free-search').addEventListener('submit', (e) => {
  e.preventDefault();
  free.text = $('#free-q').value.trim();
  free.genre = GENRES[0];
  renderGenres();
  loadFree(true);
});
$('#free-more').addEventListener('click', () => { free.page += 1; loadFree(false); });

/* ---------- 2. SERVICES IN ETHIOPIA ---------- */

async function loadServices() {
  const list = $('#svc-list');
  try {
    const res = await fetch('sources/ethiopia.json');
    const data = await res.json();
    $('#svc-note').textContent = `${data.note} Last checked: ${data.lastChecked}.`;
    list.replaceChildren(...data.services.map((s) => el('article', { class: 'card' },
      el('div', { class: 'row-between' },
        el('h3', {}, s.name),
        el('span', { class: 'badge' + (s.kind === 'free' ? ' free' : '') }, s.kind)),
      el('p', {}, s.description),
      el('p', {}, s.language),
      el('div', { class: 'actions' },
        isWebUrl(s.url) ? el('a', { class: 'primary', href: s.url, target: '_blank', rel: 'noopener' }, 'Open') : null,
        el('button', { class: 'ghost', type: 'button', onclick: () => saveService(s) }, 'Add to My sources')))));
  } catch {
    list.replaceChildren(el('p', { class: 'empty' }, "Couldn't load the services list."));
  }
}

function saveService(s) {
  addSource({ type: 'website', name: s.name, url: s.url });
  showView('mine');
}

/* ---------- 3. MY SOURCES ---------- */

const KEY = 'sinima.sources.v1';
let sources = storage.get(KEY, []);

const TYPE_LABEL = { video: 'Video', m3u: 'Playlist', catalog: 'Catalog', website: 'Website' };
const TYPE_HELP = {
  video: 'A direct link to one video file, like https://example.com/film.mp4. It plays inside the app.',
  m3u: 'A link to an .m3u playlist. Each entry in the list shows up and plays inside the app.',
  catalog: 'A link to a Sinima catalog file (.json). See README for the format, so you can make your own.',
  website: 'Any website. Tapping it opens the site in your browser, like a bookmark.',
};

function addSource(src) {
  sources.push({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), ...src });
  persist();
}

function persist() {
  storage.set(KEY, sources);
  renderMine();
}

function renderMine() {
  const list = $('#mine-list');
  if (sources.length === 0) {
    list.replaceChildren(el('p', { class: 'empty' }, 'Nothing here yet. Tap "+ Add" to add your first source.'));
  } else {
    list.replaceChildren(...sources.map((s) => el('article', { class: 'card' },
      el('div', { class: 'row-between' },
        el('h3', {}, s.name),
        el('span', { class: 'badge' }, TYPE_LABEL[s.type] || s.type)),
      el('p', {}, s.url),
      el('div', { class: 'actions' },
        el('button', { class: 'primary', type: 'button', onclick: () => openSource(s) },
          s.type === 'website' ? 'Open site' : s.type === 'video' ? 'Play' : 'Browse'),
        el('button', { class: 'ghost', type: 'button', onclick: () => removeSource(s.id) }, 'Remove')))));
  }
  $('#backup-text').value = JSON.stringify(sources, null, 1);
}

function removeSource(id) {
  sources = sources.filter((s) => s.id !== id);
  persist();
}

async function openSource(s) {
  if (!isWebUrl(s.url)) return;
  if (s.type === 'website') { window.open(s.url, '_blank', 'noopener'); return; }
  if (s.type === 'video') { openPlayer({ title: s.name, url: s.url }); return; }

  // Playlist or catalog: download it and show its items
  $('#source-h').textContent = s.name;
  const list = $('#source-list');
  list.replaceChildren(el('p', { class: 'hint' }, 'Loading…'));
  showView('source');
  try {
    const res = await fetch(s.url);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const text = await res.text();
    const items = s.type === 'm3u' ? parseM3U(text) : parseCatalog(text);
    if (items.length === 0) throw new Error('empty');
    list.replaceChildren(...items.map((item) => el('button', {
      type: 'button',
      onclick: () => openPlayer({ title: item.title, url: item.url, info: item.info }),
    },
      item.poster && isWebUrl(item.poster) ? el('img', { src: item.poster, alt: '', loading: 'lazy' }) : null,
      el('span', {}, item.title))));
  } catch {
    list.replaceChildren(el('p', { class: 'empty' },
      "Couldn't open this list. The link may be wrong, or the site may block other apps from reading it."));
  }
}

// .m3u playlist: "#EXTINF:-1 tvg-logo="…",Title" followed by the link on the next line
function parseM3U(text) {
  const items = [];
  let pending = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith('#EXTINF')) {
      const comma = line.indexOf(',');
      const logo = /tvg-logo="([^"]*)"/.exec(line);
      pending = { title: comma >= 0 ? line.slice(comma + 1).trim() : '', poster: logo ? logo[1] : '' };
    } else if (line && !line.startsWith('#')) {
      if (isWebUrl(line)) items.push({ title: pending?.title || line.split('/').pop(), url: line, poster: pending?.poster });
      pending = null;
    }
  }
  return items;
}

// Sinima catalog: { "name": "...", "movies": [ { "title", "url", "poster", "year", "description" } ] }
function parseCatalog(text) {
  const data = JSON.parse(text);
  const movies = Array.isArray(data) ? data : data.movies || [];
  return movies
    .filter((m) => m && typeof m.title === 'string' && isWebUrl(m.url))
    .map((m) => ({
      title: m.title,
      url: m.url,
      poster: typeof m.poster === 'string' ? m.poster : '',
      info: [m.year, m.description].filter(Boolean).join(' · '),
    }));
}

$('#source-back').addEventListener('click', () => showView('mine'));

/* ---------- add-source form ---------- */

const addDialog = $('#add');
function updateHelp() { $('#add-help').textContent = TYPE_HELP[$('#add-type').value]; }
$('#add-type').addEventListener('change', updateHelp);
$('#add-open').addEventListener('click', () => {
  $('#add-form').reset();
  $('#add-error').hidden = true;
  updateHelp();
  addDialog.hidden = false;
  $('#add-name').focus();
});
$('#add-close').addEventListener('click', () => { addDialog.hidden = true; });
$('#add-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const url = $('#add-url').value.trim();
  if (!isWebUrl(url)) {
    $('#add-error').textContent = 'Please enter a link that starts with https://';
    $('#add-error').hidden = false;
    return;
  }
  addSource({ type: $('#add-type').value, name: $('#add-name').value.trim(), url });
  addDialog.hidden = true;
});

/* ---------- backup / import ---------- */

$('#backup-copy').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText($('#backup-text').value);
    $('#backup-msg').textContent = 'Copied.';
  } catch {
    $('#backup-text').select();
    $('#backup-msg').textContent = 'Select the text above and copy it.';
  }
});

$('#backup-import').addEventListener('click', () => {
  try {
    const incoming = JSON.parse($('#backup-text').value);
    if (!Array.isArray(incoming)) throw new Error();
    const valid = incoming.filter((s) => s && TYPE_LABEL[s.type] && typeof s.name === 'string' && isWebUrl(s.url));
    const known = new Set(sources.map((s) => s.type + s.url));
    let added = 0;
    for (const s of valid) {
      if (known.has(s.type + s.url)) continue;
      addSource({ type: s.type, name: s.name.slice(0, 80), url: s.url });
      added++;
    }
    $('#backup-msg').textContent = `Imported ${added} new source${added === 1 ? '' : 's'}.`;
  } catch {
    $('#backup-msg').textContent = "That text isn't a valid Sinima backup.";
  }
});

/* ---------- keyboard: Esc closes dialogs ---------- */

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (!player.hidden) closePlayer();
  if (!addDialog.hidden) addDialog.hidden = true;
});

/* ---------- start ---------- */

renderGenres();
loadFree(true);
loadServices();
renderMine();
const start = location.hash.slice(1);
if (['free', 'services', 'mine'].includes(start)) showView(start);

// Offline support + installable app (PWA)
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
