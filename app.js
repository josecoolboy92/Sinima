/* Sinima — free, open-source movie app.
 *
 * Tabs:
 *   1. Free films   – public-domain films from the Internet Archive (archive.org)
 *   2. Services     – legal services that work in Ethiopia (sources/ethiopia.json)
 *   3. My sources   – sources the user adds. Each one gets its own screen.
 *
 * How sources work
 * ----------------
 * Every source type has an "adapter" (see ADAPTERS below). An adapter turns a
 * link into a list of items that the shared source screen can show:
 *
 *   item = {
 *     title, poster, year, info,
 *     kind: 'movie' | 'series',
 *     play:     { type: 'file' | 'embed', url }      // a movie that plays directly
 *     episodes: [ { title, play } ]                  // a series with its episodes
 *     open:     async () => ({ play } | { episodes }) // loaded only when tapped
 *   }
 *
 * Everything runs in the browser. User sources are kept in localStorage.
 */

'use strict';

/* ================================================================ helpers */

const $ = (sel) => document.querySelector(sel);

// Build an element: el('p', {class: 'x', onclick: fn}, 'text', childEl)
function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue;
    if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === '') continue;
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

const naturalSort = (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });

function minutes(seconds) {
  if (!seconds) return '';
  const m = Math.round(seconds / 60);
  return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`;
}

async function getJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.json();
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

/* ================================================================ screens */

const views = {
  free: $('#view-free'),
  services: $('#view-services'),
  mine: $('#view-mine'),
  source: $('#view-source'),
  series: $('#view-series'),
  web: $('#view-web'),
};
const TAB_OF = { source: 'mine', series: 'mine', web: 'mine' };

function showView(name) {
  for (const [key, view] of Object.entries(views)) view.hidden = key !== name;
  if (name !== 'web') $('#web-frame').removeAttribute('src');
  if (name !== 'source') $('#source-embed').replaceChildren();
  const tab = TAB_OF[name] || name;
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

/* ================================================================ player */

const player = $('#player');
const video = $('#video');
const embed = $('#embed');
let hls = null;
let queue = null; // { episodes, index } while watching a series

// play = { type: 'file' | 'embed', url }
function openPlayer(title, play, info, episodeQueue) {
  $('#player-title').textContent = title;
  $('#player-info').textContent = info || '';
  $('#player-error').hidden = true;
  player.hidden = false;
  stopVideo();
  queue = episodeQueue || null;
  updateEpisodeButtons();
  if (!play || !isWebUrl(play.url)) return;

  if (play.type === 'embed') {
    video.hidden = true;
    embed.hidden = false;
    embed.src = play.url;
    return;
  }

  video.hidden = false;
  embed.hidden = true;
  const isHls = /\.m3u8(\?|$)/i.test(play.url);
  if (isHls && !video.canPlayType('application/vnd.apple.mpegurl') && window.Hls && window.Hls.isSupported()) {
    hls = new window.Hls();
    hls.loadSource(play.url);
    hls.attachMedia(video);
    hls.on(window.Hls.Events.ERROR, (_e, data) => { if (data.fatal) showPlayerError(); });
  } else {
    video.src = play.url;
  }
  video.play().catch(() => { /* the user can press play */ });
}

function stopVideo() {
  if (hls) { hls.destroy(); hls = null; }
  video.pause();
  video.removeAttribute('src');
  video.load();
  embed.removeAttribute('src');
  embed.hidden = true;
  video.hidden = false;
}

function showPlayerError(message) {
  const err = $('#player-error');
  err.textContent = message ||
    "This video couldn't be played. The link may be broken, or the site may not allow other apps to play its videos.";
  err.hidden = false;
}

function updateEpisodeButtons() {
  $('#player-nav').hidden = !queue;
  if (!queue) return;
  $('#player-prev').disabled = queue.index <= 0;
  $('#player-next').disabled = queue.index >= queue.episodes.length - 1;
}

function playEpisode(episodes, index, seriesTitle) {
  const ep = episodes[index];
  openPlayer(ep.title, ep.play, `${seriesTitle} · Episode ${index + 1} of ${episodes.length}`,
    { episodes, index, seriesTitle });
}

$('#player-prev').addEventListener('click', () => {
  if (queue && queue.index > 0) playEpisode(queue.episodes, queue.index - 1, queue.seriesTitle);
});
$('#player-next').addEventListener('click', () => {
  if (queue && queue.index < queue.episodes.length - 1) playEpisode(queue.episodes, queue.index + 1, queue.seriesTitle);
});
// Go to the next episode automatically when one ends
video.addEventListener('ended', () => {
  if (queue && queue.index < queue.episodes.length - 1) playEpisode(queue.episodes, queue.index + 1, queue.seriesTitle);
});
video.addEventListener('error', () => { if (video.getAttribute('src')) showPlayerError(); });
$('#player-close').addEventListener('click', closePlayer);
function closePlayer() { stopVideo(); queue = null; player.hidden = true; }

/* ================================================================ items: tiles, series screen */

let seriesReturn = 'source';

function itemTile(item, sourceName) {
  return el('button', { class: 'film', type: 'button', onclick: () => openItem(item, sourceName) },
    item.poster && isWebUrl(item.poster)
      ? el('img', { class: 'poster', loading: 'lazy', alt: '', src: item.poster })
      : el('div', { class: 'poster' }),
    el('div', { class: 't' }, item.title),
    el('div', { class: 'y' }, item.year || ''),
    item.kind === 'series' ? el('span', { class: 'kind' }, 'Series') : null);
}

async function openItem(item, sourceName) {
  if (item.play) { openPlayer(item.title, item.play, item.info); return; }
  if (item.episodes) { showSeries(item, sourceName); return; }
  if (item.open) {
    openPlayer(item.title, null, 'Loading…');
    try {
      const result = await item.open();
      if (result.episodes && result.episodes.length > 1) {
        closePlayer();
        showSeries({ ...item, ...result, kind: 'series' }, sourceName);
      } else {
        const play = result.play || (result.episodes && result.episodes[0] && result.episodes[0].play);
        if (!play) throw new Error('nothing to play');
        openPlayer(item.title, play, result.info || item.info);
      }
    } catch {
      $('#player-info').textContent = '';
      showPlayerError("This title has no video that Sinima can play.");
    }
  }
}

function showSeries(item, sourceName) {
  seriesReturn = views.source.hidden ? (views.free.hidden ? 'source' : 'free') : 'source';
  $('#series-h').textContent = item.title;
  $('#series-info').textContent = [item.year, `${item.episodes.length} episodes`, sourceName].filter(Boolean).join(' · ');
  const poster = $('#series-poster');
  if (item.poster && isWebUrl(item.poster)) poster.src = item.poster; else poster.removeAttribute('src');
  $('#series-list').replaceChildren(...item.episodes.map((ep, i) => el('button', {
    type: 'button',
    onclick: () => playEpisode(item.episodes, i, item.title),
  }, el('span', { class: 'ep-n' }, String(i + 1)), el('span', {}, ep.title))));
  showView('series');
}

$('#series-back').addEventListener('click', () => showView(seriesReturn));

/* ================================================================ 1. FREE FILMS */

const IA = 'https://archive.org';
const IA_SAFE = ' AND -subject:(sex OR adult OR erotic OR nudity OR exploitation) AND -title:(sex)';
const IA_PLAYABLE = ' AND format:("h.264" OR "MPEG4" OR "512Kb MPEG4")';

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
  $('#genres').replaceChildren(...GENRES.map((g) => el('button', {
    type: 'button',
    'aria-pressed': String(g === free.genre),
    onclick: () => { free.genre = g; free.text = ''; $('#free-q').value = ''; renderGenres(); loadFree(true); },
  }, g.label)));
}

// Search archive.org; used by Free films and by Internet Archive sources
async function archiveSearch(query, page, rows = 30) {
  const params = new URLSearchParams({ q: query, rows: String(rows), page: String(page), output: 'json' });
  ['identifier', 'title', 'year'].forEach((f) => params.append('fl[]', f));
  params.append('sort[]', 'downloads desc');
  const data = await getJSON(`${IA}/advancedsearch.php?${params}`);
  return {
    more: page * rows < data.response.numFound,
    items: data.response.docs.map((doc) => {
      const title = (Array.isArray(doc.title) ? doc.title[0] : doc.title) || doc.identifier;
      return {
        title,
        year: doc.year,
        poster: `${IA}/services/img/${encodeURIComponent(doc.identifier)}`,
        kind: 'movie',
        open: () => archiveItem(doc.identifier),
      };
    }),
  };
}

// Read one archive.org item and find its videos. One video = a film, several = a series.
async function archiveItem(id) {
  const meta = await getJSON(`${IA}/metadata/${encodeURIComponent(id)}`);
  const files = meta.files || [];
  const groups = new Map();
  for (const f of files) {
    if (!/\.(mp4|webm|ogv)$/i.test(f.name)) continue;
    const key = f.original || f.name; // derivatives point to their source file
    const rank = f.format === 'h.264' ? 0 : /\.mp4$/i.test(f.name) ? 1 : /\.webm$/i.test(f.name) ? 2 : 3;
    const best = groups.get(key);
    if (!best || rank < best.rank) groups.set(key, { rank, file: f });
  }
  const fileUrl = (name) => `${IA}/download/${encodeURIComponent(id)}/${name.split('/').map(encodeURIComponent).join('/')}`;
  const episodes = [...groups.values()]
    .sort((a, b) => naturalSort(a.file.name, b.file.name))
    .map(({ file }) => ({
      title: file.title || file.name.split('/').pop().replace(/\.(mp4|webm|ogv)$/i, '').replace(/[_]+/g, ' '),
      play: { type: 'file', url: fileUrl(file.name) },
    }));
  const year = meta.metadata && (meta.metadata.year || (meta.metadata.date || '').slice(0, 4));
  const info = [year, 'via the Internet Archive'].filter(Boolean).join(' · ');
  if (episodes.length === 1) return { play: episodes[0].play, info };
  return { episodes, info };
}

async function loadFree(reset) {
  if (free.loading) return;
  free.loading = true;
  const grid = $('#free-grid');
  const more = $('#free-more');
  if (reset) { free.page = 1; grid.replaceChildren(...skeletons()); }
  more.hidden = true;

  let q = 'collection:(feature_films) AND mediatype:(movies)' + IA_PLAYABLE + IA_SAFE;
  if (free.genre.q) q += ' AND ' + free.genre.q;
  if (free.text) q += ' AND title:(' + cleanSearch(free.text) + ')';

  try {
    const { items, more: hasMore } = await archiveSearch(q, free.page);
    if (reset) grid.replaceChildren();
    if (reset && items.length === 0) grid.append(el('p', { class: 'empty' }, 'No films found. Try another word.'));
    grid.append(...items.map((it) => itemTile(it, 'Free films')));
    more.hidden = !hasMore;
  } catch {
    if (reset) grid.replaceChildren();
    grid.append(el('p', { class: 'empty' }, "Couldn't reach the Internet Archive. Check your internet and try again."));
  } finally {
    free.loading = false;
  }
}

const cleanSearch = (text) => text.replace(/[^\p{L}\p{N} ]/gu, ' ').trim();
const skeletons = () => Array.from({ length: 12 }, () => el('div', { class: 'film skeleton' }, el('div', { class: 'poster' })));

$('#free-search').addEventListener('submit', (e) => {
  e.preventDefault();
  free.text = $('#free-q').value.trim();
  free.genre = GENRES[0];
  renderGenres();
  loadFree(true);
});
$('#free-more').addEventListener('click', () => { free.page += 1; loadFree(false); });

/* ================================================================ 2. SERVICES IN ETHIOPIA */

async function loadServices() {
  const list = $('#svc-list');
  try {
    const data = await getJSON('sources/ethiopia.json');
    $('#svc-note').textContent = `${data.note} Last checked: ${data.lastChecked}.`;
    list.replaceChildren(...data.services.map((s) => el('article', { class: 'card' },
      el('div', { class: 'row-between' },
        el('h3', {}, s.name),
        el('span', { class: 'badge' + (s.kind === 'free' ? ' free' : '') }, s.kind)),
      el('p', {}, s.description),
      el('p', {}, s.language),
      el('div', { class: 'actions' },
        isWebUrl(s.url) ? el('a', { class: 'primary', href: s.url, target: '_blank', rel: 'noopener' }, 'Open') : null,
        el('button', {
          class: 'ghost', type: 'button',
          onclick: () => { addSource({ type: 'website', name: s.name, url: s.url }); showView('mine'); },
        }, 'Add to My sources')))));
  } catch {
    list.replaceChildren(el('p', { class: 'empty' }, "Couldn't load the services list."));
  }
}

/* ================================================================ 3. SOURCE ADAPTERS */

const ADAPTERS = {
  /* ---- Internet Archive: a collection (many titles) or a single item ---- */
  archive: {
    label: 'Internet Archive',
    async create(url) {
      const u = new URL(url);
      const query = u.searchParams.get('query');
      const id = decodeURIComponent((u.pathname.match(/\/details\/([^/?#]+)/) || [])[1] || '');
      if (!id && !query) throw new Error('Use a link like https://archive.org/details/classic_tv');

      if (id) {
        const meta = await getJSON(`${IA}/metadata/${encodeURIComponent(id)}`);
        if (!meta.metadata) throw new Error("That archive.org page wasn't found.");
        const name = meta.metadata.title || id;
        if (meta.metadata.mediatype !== 'collection') {
          // A single item: show it as one title (a film, or a series of episodes)
          const item = { title: name, poster: `${IA}/services/img/${encodeURIComponent(id)}`, kind: 'movie', open: () => archiveItem(id) };
          return { name, searchable: false, page: async () => ({ items: [item], more: false }) };
        }
        return {
          name,
          searchable: true,
          page: (n, text) => archiveSearch(
            `collection:(${id}) AND mediatype:(movies)` + IA_SAFE + (text ? ` AND title:(${cleanSearch(text)})` : ''), n, 30),
        };
      }
      return {
        name: `"${query}" on the Internet Archive`,
        searchable: true,
        page: (n, text) => archiveSearch(
          `(${cleanSearch(query)}) AND mediatype:(movies)` + IA_PLAYABLE + IA_SAFE + (text ? ` AND title:(${cleanSearch(text)})` : ''), n, 30),
      };
    },
  },

  /* ---- PeerTube: an open video network. Channel, account, playlist or a whole site ---- */
  peertube: {
    label: 'PeerTube',
    async create(url) {
      const u = new URL(url);
      const host = u.origin;
      const p = u.pathname.replace(/\/+$/, '');
      let m;
      let endpoint;
      let name = u.hostname;
      let playlist = false;
      if ((m = p.match(/^\/(?:c|video-channels)\/([^/]+)/))) {
        endpoint = `/api/v1/video-channels/${m[1]}/videos`;
        name = await getJSON(`${host}/api/v1/video-channels/${m[1]}`).then((c) => c.displayName, () => m[1]);
      } else if ((m = p.match(/^\/(?:a|accounts)\/([^/]+)/))) {
        endpoint = `/api/v1/accounts/${m[1]}/videos`;
        name = await getJSON(`${host}/api/v1/accounts/${m[1]}`).then((a) => a.displayName, () => m[1]);
      } else if ((m = p.match(/^\/(?:w\/p|videos\/watch\/playlist|video-playlists)\/([^/]+)/))) {
        endpoint = `/api/v1/video-playlists/${m[1]}/videos`;
        playlist = true;
        name = await getJSON(`${host}/api/v1/video-playlists/${m[1]}`).then((pl) => pl.displayName, () => 'Playlist');
      } else if ((m = p.match(/^\/(?:w|videos\/watch)\/([^/]+)$/))) {
        const v = await getJSON(`${host}/api/v1/videos/${m[1]}`);
        const item = peertubeItem(host, v);
        return { name: v.name, searchable: false, page: async () => ({ items: [item], more: false }) };
      } else {
        endpoint = '/api/v1/videos';
        name = await getJSON(`${host}/api/v1/config`).then((c) => c.instance.name, () => u.hostname);
      }
      // Check it really is PeerTube before saving
      await getJSON(`${host}${endpoint}?count=1`);

      const count = 24;
      const fetchPage = async (n) => {
        const params = new URLSearchParams({ start: String((n - 1) * count), count: String(count), nsfw: 'false' });
        if (!playlist) params.set('sort', '-publishedAt');
        const data = await getJSON(`${host}${endpoint}?${params}`);
        const videos = data.data.map((d) => (playlist ? d.video : d)).filter(Boolean);
        return { items: videos.map((v) => peertubeItem(host, v)), more: n * count < data.total };
      };
      if (playlist) {
        // A playlist is shown as one series with every video as an episode
        return {
          name,
          searchable: false,
          page: async () => {
            const all = [];
            for (let n = 1; n <= 20; n++) {
              const { items, more } = await fetchPage(n);
              all.push(...items);
              if (!more) break;
            }
            return {
              items: [{ title: name, kind: 'series', poster: all[0] && all[0].poster,
                episodes: all.map((it) => ({ title: it.title, play: it.play })) }],
              more: false,
            };
          },
        };
      }
      return { name, searchable: 'local', page: (n) => fetchPage(n) };
    },
  },

  /* ---- YouTube: shown with YouTube's official player ---- */
  youtube: {
    label: 'YouTube',
    async create(url) {
      const u = new URL(url);
      const list = u.searchParams.get('list');
      const v = u.hostname === 'youtu.be' ? u.pathname.slice(1) : u.searchParams.get('v');
      const channel = (u.pathname.match(/^\/channel\/(UC[\w-]{22})/) || [])[1];
      let embedUrl;
      let name;
      if (list) {
        embedUrl = `https://www.youtube-nocookie.com/embed/videoseries?list=${encodeURIComponent(list)}`;
        name = await youtubeTitle(`https://www.youtube.com/playlist?list=${list}`) || 'YouTube playlist';
      } else if (channel) {
        // Every channel has an "uploads" playlist: UC… becomes UU…
        embedUrl = `https://www.youtube-nocookie.com/embed/videoseries?list=UU${channel.slice(2)}`;
        name = 'YouTube channel';
      } else if (v) {
        embedUrl = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(v)}`;
        name = await youtubeTitle(`https://www.youtube.com/watch?v=${v}`) || 'YouTube video';
      } else {
        throw new Error('Use a playlist link (with "list=" in it), a video link, or a channel link that has "/channel/UC…" in it. Links with "@name" can\'t be used: open the channel\'s Videos tab, tap "Play all" and copy that link instead.');
      }
      return { name, searchable: false, embed: embedUrl };
    },
  },

  /* ---- Sinima catalog file (.json): movies and series ---- */
  catalog: {
    label: 'Catalog',
    async create(url) {
      const data = await getJSON(url);
      const items = parseCatalog(data);
      if (items.length === 0) throw new Error('This catalog has no movies or series in it.');
      return { name: data.name || 'Catalog', searchable: 'local', page: async () => ({ items, more: false }) };
    },
  },

  /* ---- .m3u playlist file. Entries that share a group-title become a series ---- */
  m3u: {
    label: 'Playlist',
    async create(url) {
      const res = await fetch(url);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const items = parseM3U(await res.text());
      if (items.length === 0) throw new Error('No videos were found in this playlist.');
      return { name: 'Playlist', searchable: 'local', page: async () => ({ items, more: false }) };
    },
  },

  /* ---- One video file ---- */
  video: {
    label: 'Video',
    async create(url) {
      return { name: decodeURIComponent(new URL(url).pathname.split('/').pop()) || 'Video', single: { type: 'file', url } };
    },
  },

  /* ---- Any website, shown inside the app ---- */
  website: {
    label: 'Website',
    async create(url) {
      return { name: new URL(url).hostname.replace(/^www\./, ''), website: url };
    },
  },
};

function peertubeItem(host, v) {
  const thumb = v.previewPath || v.thumbnailPath;
  return {
    title: v.name,
    year: (v.originallyPublishedAt || v.publishedAt || '').slice(0, 4),
    poster: thumb ? host + thumb : '',
    kind: 'movie',
    info: [minutes(v.duration), v.channel && v.channel.displayName].filter(Boolean).join(' · '),
    play: { type: 'embed', url: `${host}/videos/embed/${v.uuid}?autoplay=1&title=0&warningTitle=0&peertubeLink=0` },
  };
}

async function youtubeTitle(pageUrl) {
  try {
    const data = await getJSON(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(pageUrl)}`);
    return data.title;
  } catch {
    return '';
  }
}

// Sinima catalog: { "name", "movies": [ {title,url,poster,year,description} ],
//                   "series": [ {title,poster,year,description, "episodes": [ {title,url} ] } ] }
function parseCatalog(data) {
  const list = Array.isArray(data) ? data : [];
  const movies = Array.isArray(data.movies) ? data.movies : list;
  const series = Array.isArray(data.series) ? data.series : [];
  const playOf = (url) => ({ type: /youtube\.com\/embed|\/videos\/embed\//.test(url) ? 'embed' : 'file', url });
  const out = [];
  for (const m of movies) {
    if (!m || typeof m.title !== 'string' || !isWebUrl(m.url)) continue;
    out.push({ title: m.title, poster: m.poster, year: m.year, kind: 'movie', play: playOf(m.url),
      info: [m.year, m.description].filter(Boolean).join(' · ') });
  }
  for (const s of series) {
    if (!s || typeof s.title !== 'string' || !Array.isArray(s.episodes)) continue;
    const episodes = s.episodes
      .filter((e) => e && isWebUrl(e.url))
      .map((e, i) => ({ title: typeof e.title === 'string' ? e.title : `Episode ${i + 1}`, play: playOf(e.url) }));
    if (episodes.length) out.push({ title: s.title, poster: s.poster, year: s.year, kind: 'series', episodes });
  }
  return out;
}

// .m3u: "#EXTINF:-1 tvg-logo="…" group-title="Show",Title" then the link on the next line
function parseM3U(text) {
  const movies = [];
  const groups = new Map();
  let pending = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith('#EXTINF')) {
      const comma = line.indexOf(',');
      pending = {
        title: comma >= 0 ? line.slice(comma + 1).trim() : '',
        poster: (/tvg-logo="([^"]*)"/.exec(line) || [])[1] || '',
        group: (/group-title="([^"]*)"/.exec(line) || [])[1] || '',
      };
    } else if (line && !line.startsWith('#')) {
      if (isWebUrl(line)) {
        const entry = { title: (pending && pending.title) || line.split('/').pop(), play: { type: 'file', url: line } };
        if (pending && pending.group) {
          if (!groups.has(pending.group)) groups.set(pending.group, { title: pending.group, poster: pending.poster, kind: 'series', episodes: [] });
          groups.get(pending.group).episodes.push(entry);
        } else {
          movies.push({ ...entry, poster: pending && pending.poster, kind: 'movie' });
        }
      }
      pending = null;
    }
  }
  // A group with only one entry is really a movie
  const series = [...groups.values()].map((g) => (g.episodes.length === 1
    ? { title: g.episodes[0].title, poster: g.poster, kind: 'movie', play: g.episodes[0].play } : g));
  return [...movies, ...series];
}

// Guess the source type from a link
async function detectType(url) {
  const u = new URL(url);
  const host = u.hostname.replace(/^www\./, '');
  if (host === 'archive.org') return 'archive';
  if (/(^|\.)youtube\.com$|^youtu\.be$|^youtube-nocookie\.com$/.test(host)) return 'youtube';
  if (/\.json(\?|$)/i.test(u.pathname)) return 'catalog';
  if (/\.m3u(\?|$)/i.test(u.pathname)) return 'm3u';
  if (/\.(mp4|webm|ogv|m3u8|mov)(\?|$)/i.test(u.pathname)) return 'video';
  // PeerTube sites answer at /api/v1/config
  try {
    const cfg = await getJSON(`${u.origin}/api/v1/config`);
    if (cfg && cfg.instance) return 'peertube';
  } catch { /* not PeerTube */ }
  return 'website';
}

/* ================================================================ 3. MY SOURCES */

const KEY = 'sinima.sources.v1';
let sources = storage.get(KEY, []);

const TYPE_HELP = {
  auto: 'Paste any link and Sinima works out what it is.',
  archive: 'An archive.org collection (like archive.org/details/classic_tv) shows all its titles. A single item shows as one film or a series.',
  peertube: 'A PeerTube channel (/c/…), account (/a/…), playlist (/w/p/…) or a whole PeerTube site.',
  youtube: 'A playlist link (with "list=" in it), a video link, or a channel link with "/channel/UC…". It plays with YouTube\'s own player.',
  catalog: 'A Sinima catalog file (.json) with movies and series. See the README for the format.',
  m3u: 'An .m3u playlist. Entries with the same group-title become a series.',
  video: 'A direct link to one video file, like https://example.com/film.mp4.',
  website: 'Any website. It opens inside the app. Some sites block this, then use "Open in browser".',
};

function addSource(src) {
  const s = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), ...src };
  sources.push(s);
  persist();
  return s;
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
        el('span', { class: 'badge' }, (ADAPTERS[s.type] || {}).label || s.type)),
      el('p', {}, s.url),
      el('div', { class: 'actions' },
        el('button', { class: 'primary', type: 'button', onclick: () => openSource(s) }, s.type === 'video' ? 'Play' : 'Open'),
        el('button', { class: 'ghost', type: 'button', onclick: () => removeSource(s.id) }, 'Remove')))));
  }
  $('#backup-text').value = JSON.stringify(sources.map(({ type, name, url }) => ({ type, name, url })), null, 1);
}

function removeSource(id) {
  sources = sources.filter((s) => s.id !== id);
  persist();
}

/* ---- the shared source screen ---- */

const screen = { source: null, conn: null, page: 1, text: '', items: [], kind: 'all', loading: false };

async function openSource(s) {
  if (!isWebUrl(s.url) || !ADAPTERS[s.type]) return;

  if (s.type === 'website') {
    $('#web-h').textContent = s.name;
    $('#web-out').href = s.url;
    $('#web-frame').src = s.url;
    showView('web');
    return;
  }
  if (s.type === 'video') { openPlayer(s.name, { type: 'file', url: s.url }); return; }

  Object.assign(screen, { source: s, conn: null, page: 1, text: '', items: [], kind: 'all' });
  $('#source-h').textContent = s.name;
  $('#source-badge').textContent = ADAPTERS[s.type].label;
  $('#source-q').value = '';
  $('#source-search').hidden = true;
  $('#source-kinds').hidden = true;
  $('#source-more').hidden = true;
  $('#source-grid').replaceChildren(...skeletons());
  showView('source');

  try {
    screen.conn = await ADAPTERS[s.type].create(s.url);
  } catch (err) {
    $('#source-grid').replaceChildren(el('p', { class: 'empty' }, sourceError(err)));
    return;
  }
  if (screen.source !== s) return; // the user left while it was loading

  if (screen.conn.embed) {
    // YouTube: its own player, which has its own episode list
    $('#source-grid').replaceChildren();
    $('#source-embed').replaceChildren(
      el('iframe', { class: 'embed-frame', title: s.name, src: screen.conn.embed,
        allow: 'autoplay; fullscreen; encrypted-media; picture-in-picture', allowfullscreen: true,
        referrerpolicy: 'strict-origin-when-cross-origin' }),
      el('p', { class: 'hint' }, 'Use the list button in the top corner of the player to pick an episode.'));
    $('#source-embed').hidden = false;
    return;
  }
  $('#source-embed').hidden = true;
  $('#source-search').hidden = !screen.conn.searchable;
  loadSourcePage(true);
}

function sourceError(err) {
  const msg = err && err.message;
  if (msg && !/^HTTP|Failed to fetch|NetworkError|Load failed|JSON/i.test(msg)) return msg;
  return "Couldn't open this source. The link may be wrong, or the site may not let other apps read it. Try adding it as a Website instead.";
}

async function loadSourcePage(reset) {
  if (screen.loading || !screen.conn) return;
  screen.loading = true;
  const grid = $('#source-grid');
  const s = screen.source;
  if (reset) { screen.page = 1; screen.items = []; grid.replaceChildren(...skeletons()); }
  $('#source-more').hidden = true;
  try {
    const serverSearch = screen.conn.searchable === true ? screen.text : '';
    const { items, more } = await screen.conn.page(screen.page, serverSearch);
    if (screen.source !== s) return;
    screen.items.push(...items);
    renderSourceGrid();
    $('#source-more').hidden = !more;
  } catch (err) {
    if (reset) grid.replaceChildren(el('p', { class: 'empty' }, sourceError(err)));
  } finally {
    screen.loading = false;
  }
}

function renderSourceGrid() {
  const hasMovies = screen.items.some((i) => i.kind === 'movie');
  const hasSeries = screen.items.some((i) => i.kind === 'series');
  const kinds = $('#source-kinds');
  kinds.hidden = !(hasMovies && hasSeries);
  if (!kinds.hidden) {
    kinds.replaceChildren(...[['all', 'All'], ['movie', 'Movies'], ['series', 'Series']].map(([k, label]) =>
      el('button', { type: 'button', 'aria-pressed': String(screen.kind === k),
        onclick: () => { screen.kind = k; renderSourceGrid(); } }, label)));
  }
  const local = screen.conn.searchable === 'local' ? screen.text.toLowerCase() : '';
  const shown = screen.items.filter((i) =>
    (screen.kind === 'all' || i.kind === screen.kind) && (!local || i.title.toLowerCase().includes(local)));
  const grid = $('#source-grid');
  if (shown.length === 0) {
    grid.replaceChildren(el('p', { class: 'empty' }, screen.text ? 'Nothing matches that search.' : 'This source has no videos yet.'));
  } else {
    grid.replaceChildren(...shown.map((it) => itemTile(it, screen.source.name)));
  }
}

$('#source-search').addEventListener('submit', (e) => {
  e.preventDefault();
  screen.text = $('#source-q').value.trim();
  if (screen.conn && screen.conn.searchable === true) loadSourcePage(true);
  else renderSourceGrid();
});
$('#source-more').addEventListener('click', () => { screen.page += 1; loadSourcePage(false); });
$('#source-back').addEventListener('click', () => { screen.source = null; showView('mine'); });
$('#web-back').addEventListener('click', () => showView('mine'));

/* ================================================================ add-source form */

const addDialog = $('#add');
function updateHelp() { $('#add-help').textContent = TYPE_HELP[$('#add-type').value]; }
$('#add-type').addEventListener('change', updateHelp);
$('#add-open').addEventListener('click', () => {
  $('#add-form').reset();
  $('#add-error').hidden = true;
  updateHelp();
  addDialog.hidden = false;
  $('#add-url').focus();
});
$('#add-close').addEventListener('click', () => { addDialog.hidden = true; });

$('#add-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const error = $('#add-error');
  const save = $('#add-form button[type=submit]');
  const url = $('#add-url').value.trim();
  error.hidden = true;
  if (!isWebUrl(url)) {
    error.textContent = 'Please enter a link that starts with https://';
    error.hidden = false;
    return;
  }
  save.disabled = true;
  save.textContent = 'Checking…';
  try {
    let type = $('#add-type').value;
    if (type === 'auto') type = await detectType(url);
    // Open the source once, to check it works and to get its name
    const conn = await ADAPTERS[type].create(url);
    const name = $('#add-name').value.trim() || (conn.name || '').slice(0, 80) || new URL(url).hostname;
    const s = addSource({ type, name, url });
    addDialog.hidden = true;
    openSource(s);
  } catch (err) {
    error.textContent = sourceError(err);
    error.hidden = false;
  } finally {
    save.disabled = false;
    save.textContent = 'Save';
  }
});

/* ================================================================ backup / import */

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
    const valid = incoming.filter((s) => s && ADAPTERS[s.type] && typeof s.name === 'string' && isWebUrl(s.url));
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

/* ================================================================ keyboard */

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (!player.hidden) closePlayer();
  else if (!addDialog.hidden) addDialog.hidden = true;
});

/* ================================================================ start */

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
