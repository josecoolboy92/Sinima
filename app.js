/* Sinima — free, open-source movie app.
 *
 * Screens (bottom tabs): Home · Search · My list · Sources · More
 * Inner screens: grid (a source / "See all"), detail (one title), web (a website)
 *
 * Every title in the app is an "item":
 *   {
 *     title, poster, year, info, kind: 'movie' | 'series',
 *     archiveId,                       // archive.org item (details loaded on demand)
 *     play:     { type: 'file' | 'embed', url },
 *     episodes: [ { title, play, subs: [{label, url}] } ],
 *   }
 * Items are plain data, so they can be saved in My list and Continue watching.
 *
 * Saved on this device (localStorage):
 *   sinima.sources.v1   the user's sources
 *   sinima.mylist.v1    saved titles
 *   sinima.progress.v1  where each video was stopped
 *   sinima.settings.v1  autoplay + speed
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
const cleanSearch = (text) => text.replace(/[^\p{L}\p{N} ]/gu, ' ').trim();
const stripHtml = (html) => {
  const d = document.createElement('div');
  d.innerHTML = String(html || '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n');
  return d.textContent.replace(/\n{3,}/g, '\n\n').trim();
};

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

// A stable id for an item, used by My list
const itemKey = (item) => item.archiveId ? 'ia:' + item.archiveId
  : item.play ? 'p:' + item.play.url
  : 'e:' + item.title + ':' + ((item.episodes && item.episodes[0] && item.episodes[0].play.url) || '');

// Keep only the data part of an item (no functions), so it can be saved
const snapshot = (item) => ({
  title: item.title, poster: item.poster, year: item.year, info: item.info, kind: item.kind,
  archiveId: item.archiveId, play: item.play, episodes: item.episodes,
});

/* ================================================================ navigation
 * A small stack of screens. The phone's back button goes back one screen,
 * and closes the player first if it's open. */

const views = {
  home: $('#view-home'), search: $('#view-search'), mylist: $('#view-mylist'),
  sources: $('#view-sources'), more: $('#view-more'),
  grid: $('#view-grid'), detail: $('#view-detail'), web: $('#view-web'),
};
const TABS = ['home', 'search', 'mylist', 'sources', 'more'];
let stack = [{ name: 'home' }];
const shownBy = {};       // which stack entry filled each inner screen
const scrollPos = [];
let jumping = false;      // true while switching tabs drops old history entries
let closingPlayer = false;

function render(name) {
  for (const [key, view] of Object.entries(views)) view.hidden = key !== name;
  if (name !== 'web') { $('#web-frame').removeAttribute('src'); shownBy.web = null; }
  if (name !== 'grid') $('#grid-embed').replaceChildren();
  const tab = stack[0].name;
  document.querySelectorAll('.tabs button').forEach((b) => {
    if (b.dataset.tab === tab) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  });
  if (name === 'mylist') renderMyList();
  if (name === 'home') refreshPersonalRows();
}

// Open an inner screen. show() fills it, and runs again if we come back to it later.
function open(name, show) {
  scrollPos[stack.length - 1] = window.scrollY;
  const entry = { name, show };
  stack.push(entry);
  history.pushState({ depth: stack.length }, '');
  render(name);
  window.scrollTo(0, 0);
  if (show) { shownBy[name] = entry; show(); }
}

function back() { history.back(); }

window.addEventListener('popstate', () => {
  if (closingPlayer) { closingPlayer = false; return; }
  if (jumping) { jumping = false; history.replaceState({ depth: 1 }, '', '#' + stack[0].name); return; }
  if (!player.hidden) { closePlayer(true); return; }
  if (stack.length > 1) {
    stack.pop();
    const top = stack[stack.length - 1];
    render(top.name);
    if (top.show && shownBy[top.name] !== top) { shownBy[top.name] = top; top.show(); }
    window.scrollTo(0, scrollPos[stack.length - 1] || 0);
  }
});

function switchTab(tab) {
  const extra = stack.length - 1;
  stack = [{ name: tab }];
  render(tab);
  window.scrollTo(0, 0);
  if (extra > 0) { jumping = true; history.go(-extra); }
  else history.replaceState({ depth: 1 }, '', '#' + tab);
}

document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => switchTab(b.dataset.tab)));
document.querySelectorAll('.back').forEach((b) => b.addEventListener('click', back));

/* ================================================================ settings */

const settings = Object.assign({ autoplay: true, speed: 1 }, storage.get('sinima.settings.v1', {}));
const saveSettings = () => storage.set('sinima.settings.v1', settings);

$('#set-autoplay').checked = settings.autoplay;
$('#set-speed').value = String(settings.speed);
$('#set-autoplay').addEventListener('change', (e) => { settings.autoplay = e.target.checked; saveSettings(); });
$('#set-speed').addEventListener('change', (e) => { settings.speed = Number(e.target.value); saveSettings(); });

/* ================================================================ watch progress */

let progress = storage.get('sinima.progress.v1', {});
const saveProgress = () => storage.set('sinima.progress.v1', progress);

function progressOf(url) {
  const p = progress[url];
  return p && p.d ? Math.min(1, p.t / p.d) : 0;
}

// Continue watching: most recent first, one entry per title, not finished
function continueList() {
  const seen = new Set();
  return Object.values(progress)
    .filter((p) => p.d && p.t > 15 && p.t < p.d * 0.95 && p.item)
    .sort((a, b) => b.at - a.at)
    .filter((p) => { const k = itemKey(p.item); if (seen.has(k)) return false; seen.add(k); return true; })
    .slice(0, 20);
}

$('#clear-history').addEventListener('click', () => {
  progress = {};
  saveProgress();
  $('#settings-msg').textContent = 'Watch history cleared.';
});

/* ================================================================ My list */

let mylist = storage.get('sinima.mylist.v1', []);
const inMyList = (item) => mylist.some((m) => itemKey(m) === itemKey(item));

function toggleMyList(item) {
  if (inMyList(item)) mylist = mylist.filter((m) => itemKey(m) !== itemKey(item));
  else mylist.unshift(snapshot(item));
  storage.set('sinima.mylist.v1', mylist);
  updateBackup();
}

function renderMyList() {
  const body = $('#mylist-body');
  const cont = continueList();
  body.replaceChildren(...[
    cont.length ? el('h2', { class: 'section-gap' }, 'Continue watching') : null,
    cont.length ? el('div', { class: 'grid' }, cont.map(continueTile)) : null,
    el('h2', { class: 'section-gap' }, 'Saved'),
    mylist.length
      ? el('div', { class: 'grid' }, mylist.map((it) => itemTile(it)))
      : el('p', { class: 'empty' }, 'Nothing saved yet. Open any title and tap "+ My list".'),
  ].filter(Boolean));
}

/* ================================================================ tiles */

function itemTile(item, extra, onClick) {
  return el('button', { class: 'film', type: 'button', onclick: onClick || (() => openDetail(item)) },
    item.poster && isWebUrl(item.poster)
      ? el('img', { class: 'poster', loading: 'lazy', alt: '', src: item.poster })
      : el('div', { class: 'poster' }),
    extra || null,
    el('div', { class: 't' }, item.title),
    el('div', { class: 'y' }, item.year || ''),
    item.kind === 'series' ? el('span', { class: 'kind' }, 'Series') : null);
}

function progressBar(fraction) {
  return el('div', { class: 'progress' }, el('span', { style: `width:${Math.round(fraction * 100)}%` }));
}

function continueTile(p) {
  // Tapping resumes straight away
  const tile = itemTile(p.item, progressBar(p.t / p.d), () => resume(p));
  tile.querySelector('.y').textContent = p.label || '';
  return tile;
}

const skeletons = (n = 12) => Array.from({ length: n }, () => el('div', { class: 'film skeleton' }, el('div', { class: 'poster' })));

/* ================================================================ Internet Archive */

const IA = 'https://archive.org';
const IA_SAFE = ' AND -subject:(sex OR adult OR erotic OR nudity OR exploitation) AND -title:(sex)';
const IA_PLAYABLE = ' AND format:("h.264" OR "MPEG4" OR "512Kb MPEG4")';
const Q_FILMS = 'collection:(feature_films) AND mediatype:(movies)' + IA_PLAYABLE + IA_SAFE;
const Q_TV = 'collection:(classic_tv) AND licenseurl:(*publicdomain*) AND mediatype:(movies)' + IA_PLAYABLE + IA_SAFE;
const Q_CARTOONS = 'collection:(animationandcartoons) AND mediatype:(movies)' + IA_PLAYABLE + IA_SAFE;
const Q_ALL_FREE = `((collection:(feature_films)) OR (collection:(classic_tv) AND licenseurl:(*publicdomain*)) OR (collection:(animationandcartoons))) AND mediatype:(movies)` + IA_PLAYABLE + IA_SAFE;

async function archiveSearch(query, page, rows = 30, kind = 'movie') {
  const params = new URLSearchParams({ q: query, rows: String(rows), page: String(page), output: 'json' });
  ['identifier', 'title', 'year'].forEach((f) => params.append('fl[]', f));
  params.append('sort[]', 'downloads desc');
  const data = await getJSON(`${IA}/advancedsearch.php?${params}`);
  return {
    more: page * rows < data.response.numFound,
    items: data.response.docs.map((doc) => ({
      title: (Array.isArray(doc.title) ? doc.title[0] : doc.title) || doc.identifier,
      year: doc.year,
      poster: `${IA}/services/img/${encodeURIComponent(doc.identifier)}`,
      kind,
      archiveId: doc.identifier,
    })),
  };
}

// Full details of one archive.org item: description, videos (one = film, several = series), subtitles
const archiveCache = new Map();
async function archiveDetails(id) {
  if (archiveCache.has(id)) return archiveCache.get(id);
  const meta = await getJSON(`${IA}/metadata/${encodeURIComponent(id)}`);
  const files = meta.files || [];
  const fileUrl = (name) => `${IA}/download/${encodeURIComponent(id)}/${name.split('/').map(encodeURIComponent).join('/')}`;
  const base = (name) => name.replace(/\.[^.]+$/, '').replace(/(_512kb|\.ia)$/i, '').toLowerCase();

  // Best video per source file
  const groups = new Map();
  for (const f of files) {
    if (!/\.(mp4|webm|ogv)$/i.test(f.name)) continue;
    const key = f.original || f.name;
    const rank = f.format === 'h.264' ? 0 : /\.mp4$/i.test(f.name) ? 1 : /\.webm$/i.test(f.name) ? 2 : 3;
    const best = groups.get(key);
    if (!best || rank < best.rank) groups.set(key, { rank, file: f, key });
  }
  const subtitleFiles = files.filter((f) => /\.(srt|vtt)$/i.test(f.name));
  const videos = [...groups.values()].sort((a, b) => naturalSort(a.key, b.key));
  const episodes = videos.map(({ file, key }) => {
    const mine = subtitleFiles.filter((s) => videos.length === 1 || base(s.name).startsWith(base(key)));
    return {
      title: file.title || key.split('/').pop().replace(/\.[^.]+$/, '').replace(/[_]+/g, ' '),
      play: { type: 'file', url: fileUrl(file.name) },
      length: Number(file.length) || 0,
      subs: mine.map((s) => ({ label: subtitleLabel(s.name), url: fileUrl(s.name) })),
    };
  });
  const m = meta.metadata || {};
  const subjects = [].concat(m.subject || []).flatMap((s) => String(s).split(/[;,]/)).map((s) => s.trim()).filter(Boolean);
  const details = {
    title: Array.isArray(m.title) ? m.title[0] : m.title,
    year: m.year || String(m.date || '').slice(0, 4),
    description: stripHtml(Array.isArray(m.description) ? m.description.join('\n') : m.description),
    subjects,
    collection: [].concat(m.collection || [])[0],
    episodes,
    downloadUrl: episodes.length === 1 ? episodes[0].play.url : '',
  };
  archiveCache.set(id, details);
  return details;
}

function subtitleLabel(name) {
  if (/\.asr\.(srt|vtt)$/i.test(name)) return 'Auto-generated';
  const lang = (name.match(/[._-]([a-z]{2,3}|english|spanish|french|german|italian|portuguese)\.(srt|vtt)$/i) || [])[1];
  return lang ? lang.toUpperCase() : name.split('/').pop();
}

/* ================================================================ sources (adapters) */

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
          const item = { title: name, poster: `${IA}/services/img/${encodeURIComponent(id)}`, kind: 'movie', archiveId: id };
          return { name, searchable: false, page: async () => ({ items: [item], more: false }) };
        }
        return {
          name, searchable: true,
          page: (n, text) => archiveSearch(`collection:(${id}) AND mediatype:(movies)` + IA_SAFE +
            (text ? ` AND title:(${cleanSearch(text)})` : ''), n, 30),
        };
      }
      return {
        name: `"${query}" on the Internet Archive`, searchable: true,
        page: (n, text) => archiveSearch(`(${cleanSearch(query)}) AND mediatype:(movies)` + IA_PLAYABLE + IA_SAFE +
          (text ? ` AND title:(${cleanSearch(text)})` : ''), n, 30),
      };
    },
  },

  /* ---- PeerTube: an open video network ---- */
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
      await getJSON(`${host}${endpoint}?count=1`); // check it really is PeerTube

      const count = 24;
      const fetchPage = async (n) => {
        const params = new URLSearchParams({ start: String((n - 1) * count), count: String(count), nsfw: 'false' });
        if (!playlist) params.set('sort', '-publishedAt');
        const data = await getJSON(`${host}${endpoint}?${params}`);
        const videos = data.data.map((d) => (playlist ? d.video : d)).filter(Boolean);
        return { items: videos.map((v) => peertubeItem(host, v)), more: n * count < data.total };
      };
      if (playlist) {
        return {
          name, searchable: false,
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

  /* ---- Sinima catalog file (.json) ---- */
  catalog: {
    label: 'Catalog',
    async create(url) {
      const data = await getJSON(url);
      const items = parseCatalog(data);
      if (items.length === 0) throw new Error('This catalog has no movies or series in it.');
      return { name: data.name || 'Catalog', searchable: 'local', page: async () => ({ items, more: false }) };
    },
  },

  /* ---- .m3u playlist file ---- */
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
      const name = decodeURIComponent(new URL(url).pathname.split('/').pop()) || 'Video';
      const item = { title: name, kind: 'movie', play: { type: 'file', url } };
      return { name, searchable: false, page: async () => ({ items: [item], more: false }) };
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
    return (await getJSON(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(pageUrl)}`)).title;
  } catch {
    return '';
  }
}

// Sinima catalog: { "name", "movies": [ {title,url,poster,year,description,subtitles} ],
//                   "series": [ {title,poster,year,description, "episodes": [ {title,url,subtitles} ] } ] }
function parseCatalog(data) {
  const movies = Array.isArray(data) ? data : Array.isArray(data.movies) ? data.movies : [];
  const series = Array.isArray(data.series) ? data.series : [];
  const playOf = (url) => ({ type: /youtube(-nocookie)?\.com\/embed|\/videos\/embed\//.test(url) ? 'embed' : 'file', url });
  const subsOf = (list) => (Array.isArray(list) ? list : [])
    .filter((s) => s && isWebUrl(s.url)).map((s) => ({ label: String(s.label || 'Subtitles'), url: s.url }));
  const out = [];
  for (const m of movies) {
    if (!m || typeof m.title !== 'string' || !isWebUrl(m.url)) continue;
    out.push({ title: m.title, poster: m.poster, year: m.year, kind: 'movie', info: m.description || '',
      episodes: [{ title: m.title, play: playOf(m.url), subs: subsOf(m.subtitles) }] });
  }
  for (const s of series) {
    if (!s || typeof s.title !== 'string' || !Array.isArray(s.episodes)) continue;
    const episodes = s.episodes.filter((e) => e && isWebUrl(e.url)).map((e, i) => ({
      title: typeof e.title === 'string' ? e.title : `Episode ${i + 1}`, play: playOf(e.url), subs: subsOf(e.subtitles),
    }));
    if (episodes.length) out.push({ title: s.title, poster: s.poster, year: s.year, kind: 'series', info: s.description || '', episodes });
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
  const series = [...groups.values()].map((g) => (g.episodes.length === 1
    ? { title: g.episodes[0].title, poster: g.poster, kind: 'movie', play: g.episodes[0].play } : g));
  return [...movies, ...series];
}

async function detectType(url) {
  const u = new URL(url);
  const host = u.hostname.replace(/^www\./, '');
  if (host === 'archive.org') return 'archive';
  if (/(^|\.)youtube\.com$|^youtu\.be$|^youtube-nocookie\.com$/.test(host)) return 'youtube';
  if (/\.json(\?|$)/i.test(u.pathname)) return 'catalog';
  if (/\.m3u(\?|$)/i.test(u.pathname)) return 'm3u';
  if (/\.(mp4|webm|ogv|m3u8|mov)(\?|$)/i.test(u.pathname)) return 'video';
  try {
    const cfg = await getJSON(`${u.origin}/api/v1/config`);
    if (cfg && cfg.instance) return 'peertube';
  } catch { /* not PeerTube */ }
  return 'website';
}

function friendlyError(err) {
  const msg = err && err.message;
  if (msg && !/^HTTP|Failed to fetch|NetworkError|Load failed|JSON/i.test(msg)) return msg;
  return "Couldn't open this source. The link may be wrong, or the site may not let other apps read it. Try adding it as a Website instead.";
}

/* ================================================================ HOME */

// Built-in rows: legal public-domain titles from the Internet Archive
const HOME_ROWS = [
  { title: 'Popular free films', query: Q_FILMS },
  { title: 'Classic TV series', query: Q_TV },
  { title: 'Cartoons & animation', query: Q_CARTOONS },
  { title: 'Comedy', query: Q_FILMS + ' AND subject:(comedy)' },
  { title: 'Westerns', query: Q_FILMS + ' AND subject:(western)' },
  { title: 'Mystery & crime', query: Q_FILMS + ' AND subject:(mystery OR noir OR crime)' },
  { title: 'Science fiction', query: Q_FILMS + ' AND subject:("science fiction" OR sci-fi)' },
  { title: 'Horror', query: Q_FILMS + ' AND subject:(horror)' },
  { title: 'Silent era', query: Q_FILMS + ' AND subject:(silent)' },
];

function archiveConn(row) {
  return {
    name: row.title, badge: 'Free · Public domain', searchable: true,
    page: (n, text) => archiveSearch(row.query + (text ? ` AND title:(${cleanSearch(text)})` : ''), n, 30, row.kind),
  };
}

function rowSection(title, onSeeAll, content, wide) {
  return el('section', { class: 'home-row' },
    el('div', { class: 'row-between' },
      el('h2', {}, title),
      onSeeAll ? el('button', { class: 'see-all', type: 'button', onclick: onSeeAll }, 'See all ›') : null),
    el('div', { class: 'rail' + (wide ? ' rail-wide' : '') }, content));
}

// A row that loads its own titles
function lazyRow(title, connPromise, onSeeAll) {
  const rail = el('div', { class: 'rail' }, skeletons(6));
  const section = el('section', { class: 'home-row' },
    el('div', { class: 'row-between' },
      el('h2', {}, title),
      el('button', { class: 'see-all', type: 'button', onclick: onSeeAll }, 'See all ›')),
    rail);
  Promise.resolve(connPromise)
    .then((conn) => conn.page(1, ''))
    .then(({ items }) => {
      rail.replaceChildren(...items.slice(0, 18).map((it) => itemTile(it)));
      if (!items.length) section.remove();
    })
    .catch(() => rail.replaceChildren(el('p', { class: 'empty' }, "Couldn't load this row. Check your internet.")));
  return section;
}

const personalRows = el('div');
function refreshPersonalRows() {
  const cont = continueList();
  personalRows.replaceChildren(...[
    cont.length ? rowSection('Continue watching', () => switchTab('mylist'), cont.map(continueTile)) : null,
    mylist.length ? rowSection('My list', () => switchTab('mylist'), mylist.slice(0, 18).map((it) => itemTile(it))) : null,
  ].filter(Boolean));
}

function buildHome() {
  const rows = $('#home-rows');
  rows.replaceChildren(personalRows);
  refreshPersonalRows();
  HOME_ROWS.slice(0, 3).forEach((row) => rows.append(lazyRow(row.title, archiveConn(row), () => openGrid(archiveConn(row)))));
  // A row for each of the user's sources that has titles to show
  for (const s of sources.filter((x) => ['archive', 'peertube', 'catalog', 'm3u'].includes(x.type)).slice(0, 8)) {
    const conn = ADAPTERS[s.type].create(s.url);
    rows.append(lazyRow(s.name, conn, () => openSource(s)));
  }
  HOME_ROWS.slice(3).forEach((row) => rows.append(lazyRow(row.title, archiveConn(row), () => openGrid(archiveConn(row)))));
}

/* ================================================================ GRID screen */

const grid = { conn: null, page: 1, text: '', items: [], kind: 'all', loading: false, token: 0 };

function openGrid(conn, badge, title) {
  open('grid', () => showGrid(conn, badge, title));
}

async function showGrid(connOrPromise, badge, title) {
  const token = ++grid.token;
  Object.assign(grid, { conn: null, page: 1, text: '', items: [], kind: 'all' });
  $('#grid-h').textContent = title || connOrPromise.name || '';
  $('#grid-badge').textContent = badge || connOrPromise.badge || '';
  $('#grid-q').value = '';
  $('#grid-search').hidden = true;
  $('#grid-kinds').hidden = true;
  $('#grid-more').hidden = true;
  $('#grid-embed').hidden = true;
  $('#grid-items').replaceChildren(...skeletons());
  let conn;
  try {
    conn = await connOrPromise;
  } catch (err) {
    if (token === grid.token) $('#grid-items').replaceChildren(el('p', { class: 'empty' }, friendlyError(err)));
    return;
  }
  if (token !== grid.token) return;
  grid.conn = conn;
  $('#grid-h').textContent = title || conn.name;

  if (conn.embed) {
    $('#grid-items').replaceChildren();
    $('#grid-embed').replaceChildren(
      el('iframe', { class: 'embed-frame', title: conn.name, src: conn.embed,
        allow: 'autoplay; fullscreen; encrypted-media; picture-in-picture', allowfullscreen: true,
        referrerpolicy: 'strict-origin-when-cross-origin' }),
      el('p', { class: 'hint' }, 'Use the list button in the top corner of the player to pick an episode.'));
    $('#grid-embed').hidden = false;
    return;
  }
  $('#grid-search').hidden = !conn.searchable;
  loadGridPage(true);
}

async function loadGridPage(reset) {
  if (grid.loading || !grid.conn) return;
  grid.loading = true;
  const token = grid.token;
  if (reset) { grid.page = 1; grid.items = []; $('#grid-items').replaceChildren(...skeletons()); }
  $('#grid-more').hidden = true;
  try {
    const { items, more } = await grid.conn.page(grid.page, grid.conn.searchable === true ? grid.text : '');
    if (token !== grid.token) return;
    grid.items.push(...items);
    renderGrid();
    $('#grid-more').hidden = !more;
  } catch (err) {
    if (reset && token === grid.token) $('#grid-items').replaceChildren(el('p', { class: 'empty' }, friendlyError(err)));
  } finally {
    grid.loading = false;
  }
}

function renderGrid() {
  const hasMovies = grid.items.some((i) => i.kind === 'movie');
  const hasSeries = grid.items.some((i) => i.kind === 'series');
  const kinds = $('#grid-kinds');
  kinds.hidden = !(hasMovies && hasSeries);
  if (!kinds.hidden) {
    kinds.replaceChildren(...[['all', 'All'], ['movie', 'Movies'], ['series', 'Series']].map(([k, label]) =>
      el('button', { type: 'button', 'aria-pressed': String(grid.kind === k),
        onclick: () => { grid.kind = k; renderGrid(); } }, label)));
  }
  const local = grid.conn.searchable === 'local' ? grid.text.toLowerCase() : '';
  const shown = grid.items.filter((i) =>
    (grid.kind === 'all' || i.kind === grid.kind) && (!local || i.title.toLowerCase().includes(local)));
  $('#grid-items').replaceChildren(...(shown.length
    ? shown.map((it) => itemTile(it))
    : [el('p', { class: 'empty' }, grid.text ? 'Nothing matches that search.' : 'Nothing here yet.')]));
}

$('#grid-search').addEventListener('submit', (e) => {
  e.preventDefault();
  grid.text = $('#grid-q').value.trim();
  if (grid.conn && grid.conn.searchable === true) loadGridPage(true);
  else renderGrid();
});
$('#grid-more').addEventListener('click', () => { grid.page += 1; loadGridPage(false); });

/* ================================================================ DETAIL screen */

const detail = { item: null, episodes: [], season: null, token: 0 };

// Group episodes into seasons using names like "S01E05" or "Season 2"
function seasonOf(title) {
  const m = title.match(/\bs(\d{1,2})\s*[._ -]?\s*e\d{1,3}\b/i) || title.match(/\bseason[ ._-]*(\d{1,2})\b/i);
  return m ? Number(m[1]) : null;
}

function openDetail(item) {
  open('detail', () => showDetail(item));
}

async function showDetail(item) {
  const token = ++detail.token;
  detail.item = item;
  detail.episodes = item.episodes || (item.play ? [{ title: item.title, play: item.play, subs: [] }] : []);
  detail.season = null;

  $('#detail-h').textContent = item.title;
  $('#detail-meta').textContent = [item.year, item.kind === 'series' ? 'Series' : '', item.info].filter(Boolean).join(' · ');
  const poster = $('#detail-poster');
  if (item.poster && isWebUrl(item.poster)) {
    poster.src = item.poster;
    $('#detail-backdrop').style.backgroundImage = `url("${item.poster.replace(/"/g, '%22')}")`;
  } else {
    poster.removeAttribute('src');
    $('#detail-backdrop').style.backgroundImage = 'none';
  }
  $('#detail-desc').textContent = '';
  $('#detail-desc').classList.remove('open');
  $('#detail-download').hidden = true;
  $('#detail-similar').replaceChildren();
  updateSaveButton();

  if (item.archiveId) {
    $('#detail-play').disabled = true;
    $('#detail-play').textContent = 'Loading…';
    renderEpisodes();
    try {
      const d = await archiveDetails(item.archiveId);
      if (token !== detail.token) return;
      detail.episodes = d.episodes;
      $('#detail-desc').textContent = d.description;
      $('#detail-meta').textContent = [d.year || item.year,
        d.episodes.length > 1 ? `Series · ${d.episodes.length} episodes` : minutes(d.episodes[0] && d.episodes[0].length),
        'Public domain'].filter(Boolean).join(' · ');
      if (d.downloadUrl) { $('#detail-download').href = d.downloadUrl; $('#detail-download').hidden = false; }
      loadSimilar(item, d, token);
    } catch {
      if (token !== detail.token) return;
      $('#detail-desc').textContent = "Couldn't load this title. Check your internet and try again.";
    }
  } else if (item.info) {
    $('#detail-desc').textContent = item.info;
  }
  renderEpisodes();
}

function renderEpisodes() {
  const eps = detail.episodes;
  const playBtn = $('#detail-play');
  const list = $('#detail-episodes');
  const seasonsBox = $('#detail-seasons');
  if (!eps.length) {
    if (!detail.item.archiveId) { playBtn.disabled = true; playBtn.textContent = 'Nothing to play'; }
    list.replaceChildren();
    seasonsBox.hidden = true;
    return;
  }
  // Play / Resume button: resume the last episode watched, or start the first
  const next = nextToWatch(eps);
  playBtn.disabled = false;
  playBtn.textContent = next.resume ? (eps.length > 1 ? `▶ Resume episode ${next.index + 1}` : '▶ Resume') : (eps.length > 1 ? `▶ Play episode ${next.index + 1}` : '▶ Play');
  playBtn.onclick = () => playFrom(detail.item, eps, next.index);

  if (eps.length < 2) { list.replaceChildren(); seasonsBox.hidden = true; return; }

  const seasons = [...new Set(eps.map((e) => seasonOf(e.title)).filter((s) => s !== null))].sort((a, b) => a - b);
  seasonsBox.hidden = seasons.length < 2;
  if (!seasonsBox.hidden) {
    if (detail.season === null || !seasons.includes(detail.season)) detail.season = seasonOf(eps[next.index].title) || seasons[0];
    seasonsBox.replaceChildren(...seasons.map((s) => el('button', {
      type: 'button', 'aria-pressed': String(detail.season === s),
      onclick: () => { detail.season = s; renderEpisodes(); },
    }, `Season ${s}`)));
  }
  list.replaceChildren(...eps.map((ep, i) => {
    if (!seasonsBox.hidden && seasonOf(ep.title) !== detail.season) return null;
    const done = progressOf(ep.play.url);
    return el('button', { type: 'button', class: i === next.index ? 'now' : '', onclick: () => playFrom(detail.item, eps, i) },
      el('span', { class: 'ep-n' }, String(i + 1)),
      el('span', { class: 't' }, ep.title),
      done > 0.02 ? progressBar(done) : null);
  }).filter(Boolean));
}

// Which episode to play: the most recently watched unfinished one, or the one after a finished one
function nextToWatch(eps) {
  let best = null;
  eps.forEach((ep, i) => {
    const p = progress[ep.play.url];
    if (p && (!best || p.at > best.at)) best = { at: p.at, i, done: p.d && p.t >= p.d * 0.95 };
  });
  if (!best) return { index: 0, resume: false };
  if (best.done) return { index: Math.min(best.i + 1, eps.length - 1), resume: false };
  return { index: best.i, resume: true };
}

function updateSaveButton() {
  const saved = inMyList(detail.item);
  $('#detail-save').textContent = saved ? '✓ In My list' : '+ My list';
}
$('#detail-save').addEventListener('click', () => { toggleMyList(detail.item); updateSaveButton(); });
$('#detail-desc').addEventListener('click', (e) => e.currentTarget.classList.toggle('open'));

// "More like this": other titles with the same subject
async function loadSimilar(item, d, token) {
  const subject = d.subjects.find((s) => s.length > 2 && s.length < 40 && !/public domain|feature film|movie|film|video/i.test(s));
  if (!subject) return;
  const scope = d.collection ? `collection:(${d.collection}) AND ` : '';
  try {
    const { items } = await archiveSearch(`${scope}subject:("${subject.replace(/"/g, '')}") AND mediatype:(movies)` +
      IA_PLAYABLE + IA_SAFE + ` AND -identifier:(${item.archiveId})`, 1, 15);
    if (token !== detail.token || !items.length) return;
    $('#detail-similar').replaceChildren(rowSection('More like this', null, items.map((it) => itemTile(it))));
  } catch { /* optional */ }
}

/* ================================================================ PLAYER */

const player = $('#player');
const video = $('#video');
const embed = $('#embed');
let hls = null;
let now = null; // { item, episodes, index }
let lastSave = 0;

function playFrom(item, episodes, index) {
  const ep = episodes[index];
  if (!ep) return;
  if (player.hidden) history.pushState({ player: true }, '');
  now = { item: snapshot(item), episodes, index };
  const many = episodes.length > 1;
  $('#player-title').textContent = many ? ep.title : item.title;
  $('#player-info').textContent = many ? `${item.title} · Episode ${index + 1} of ${episodes.length}` : (item.year || '');
  $('#player-error').hidden = true;
  $('#player-prev').hidden = !many;
  $('#player-next').hidden = !many;
  $('#player-prev').disabled = index <= 0;
  $('#player-next').disabled = index >= episodes.length - 1;
  player.hidden = false;
  stopVideo();

  const play = ep.play;
  if (!play || !isWebUrl(play.url)) { showPlayerError(); return; }
  const isEmbed = play.type === 'embed';
  $('#player-controls').querySelectorAll('label').forEach((l) => { l.hidden = isEmbed; });
  if (isEmbed) {
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
  setupSubtitles(ep.subs || []);
  $('#player-speed').value = String(settings.speed);
  const saved = progress[play.url];
  video.addEventListener('loadedmetadata', () => {
    video.playbackRate = settings.speed;
    if (saved && saved.t > 10 && saved.t < video.duration - 20) video.currentTime = saved.t;
  }, { once: true });
  video.play().catch(() => { /* the user can press play */ });
}

function stopVideo() {
  if (hls) { hls.destroy(); hls = null; }
  video.pause();
  video.removeAttribute('src');
  video.querySelectorAll('track').forEach((t) => { if (t.src.startsWith('blob:')) URL.revokeObjectURL(t.src); t.remove(); });
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

function closePlayer(fromHistory) {
  saveNow(true);
  stopVideo();
  now = null;
  player.hidden = true;
  if (!fromHistory) { closingPlayer = true; history.back(); }
  if (!views.detail.hidden && detail.item) renderEpisodes();
  if (!views.home.hidden) refreshPersonalRows();
  if (!views.mylist.hidden) renderMyList();
}

$('#player-close').addEventListener('click', () => closePlayer(false));
$('#player-prev').addEventListener('click', () => { if (now && now.index > 0) playFrom(now.item, now.episodes, now.index - 1); });
$('#player-next').addEventListener('click', () => { if (now && now.index < now.episodes.length - 1) playFrom(now.item, now.episodes, now.index + 1); });
$('#player-speed').addEventListener('change', (e) => { video.playbackRate = Number(e.target.value); });

video.addEventListener('error', () => { if (video.getAttribute('src')) showPlayerError(); });
video.addEventListener('timeupdate', () => { if (Date.now() - lastSave > 5000) saveNow(false); });
video.addEventListener('pause', () => saveNow(true));
video.addEventListener('ended', () => {
  saveNow(true);
  if (settings.autoplay && now && now.index < now.episodes.length - 1) playFrom(now.item, now.episodes, now.index + 1);
});

// Remember where the video was stopped (for Continue watching and Resume)
function saveNow(force) {
  if (!now || !video.duration || !isFinite(video.duration) || video.hidden) return;
  if (!force && video.currentTime < 5) return;
  lastSave = Date.now();
  const ep = now.episodes[now.index];
  const many = now.episodes.length > 1;
  progress[ep.play.url] = {
    t: Math.floor(video.currentTime), d: Math.floor(video.duration), at: Date.now(),
    item: now.item, index: now.index, label: many ? `Episode ${now.index + 1}` : '',
    // Archive titles reload their episode list; other titles keep it here
    episodes: now.item.archiveId ? undefined : now.episodes,
  };
  // Keep the history small
  const entries = Object.entries(progress).sort((a, b) => b[1].at - a[1].at);
  if (entries.length > 200) progress = Object.fromEntries(entries.slice(0, 200));
  saveProgress();
}

async function resume(p) {
  try {
    let episodes = p.episodes;
    if (!episodes && p.item.archiveId) episodes = (await archiveDetails(p.item.archiveId)).episodes;
    if (!episodes && p.item.play) episodes = [{ title: p.item.title, play: p.item.play, subs: [] }];
    if (!episodes || !episodes[p.index]) throw new Error('missing');
    playFrom(p.item, episodes, p.index);
  } catch {
    openDetail(p.item);
  }
}

/* ---- subtitles ---- */

function setupSubtitles(subs) {
  const select = $('#player-subs');
  select.replaceChildren(
    el('option', { value: '' }, 'Off'),
    ...subs.map((s, i) => el('option', { value: String(i) }, s.label)),
    el('option', { value: 'file' }, 'From my phone…'));
  select.value = '';
  select.onchange = async () => {
    const v = select.value;
    if (v === 'file') { $('#subs-file').click(); return; }
    if (v === '') { showTrack(null); return; }
    const sub = subs[Number(v)];
    try {
      const res = await fetch(sub.url);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      showTrack(await res.text(), sub.label);
    } catch {
      // Some sites (like archive.org) don't let apps read subtitle files directly.
      // Offer the file as a download; then the user picks it with "From my phone".
      select.value = '';
      const err = $('#player-error');
      err.replaceChildren("These subtitles can't be loaded directly. ",
        el('a', { href: sub.url, target: '_blank', rel: 'noopener' }, 'Download the subtitle file'),
        ', then choose "From my phone…" in Subtitles and pick it.');
      err.hidden = false;
    }
  };
}

$('#subs-file').addEventListener('change', async (e) => {
  const file = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!file) { $('#player-subs').value = ''; return; }
  const text = await file.text();
  const select = $('#player-subs');
  const opt = el('option', { value: 'mine' }, file.name);
  select.insertBefore(opt, select.lastElementChild);
  select.value = 'mine';
  showTrack(text, file.name);
});

// Turn .srt text into WebVTT and show it on the video
function showTrack(text, label) {
  video.querySelectorAll('track').forEach((t) => { if (t.src.startsWith('blob:')) URL.revokeObjectURL(t.src); t.remove(); });
  if (!text) return;
  let vtt = text.replace(/\r/g, '');
  // SRT uses "00:01:02,500"; WebVTT needs "00:01:02.500" (always 3 digits after the dot)
  if (!/^WEBVTT/.test(vtt)) {
    vtt = 'WEBVTT\n\n' + vtt.replace(/(\d{1,2}:\d{2}:\d{2}),(\d{1,3})/g,
      (_m, time, ms) => `${time.padStart(8, '0')}.${ms.padEnd(3, '0')}`);
  }
  const track = el('track', { kind: 'subtitles', label: label || 'Subtitles', srclang: 'en', default: true,
    src: URL.createObjectURL(new Blob([vtt], { type: 'text/vtt' })) });
  video.append(track);
  $('#player-error').hidden = true;
  track.addEventListener('load', () => { track.track.mode = 'showing'; });
  if (track.track) track.track.mode = 'showing';
}

/* ================================================================ SEARCH */

$('#search-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = $('#search-q').value.trim();
  const box = $('#search-results');
  if (!text) { box.replaceChildren(); return; }
  box.replaceChildren();

  const section = (title) => {
    const rail = el('div', { class: 'grid' }, skeletons(6));
    const s = el('section', { class: 'home-row' }, el('h2', {}, title), rail);
    box.append(s);
    return { s, rail };
  };
  const show = ({ s, rail }, items) => {
    if (!items.length) { s.remove(); return; }
    rail.replaceChildren(...items.map((it) => itemTile(it)));
  };

  const jobs = [];
  const free = section('Free films & series');
  jobs.push(archiveSearch(Q_ALL_FREE + ` AND title:(${cleanSearch(text)})`, 1, 24)
    .then(({ items }) => show(free, items), () => free.s.remove()));

  const lower = text.toLowerCase();
  for (const src of sources.filter((x) => ['archive', 'peertube', 'catalog', 'm3u'].includes(x.type))) {
    const sec = section(src.name);
    jobs.push(ADAPTERS[src.type].create(src.url)
      .then((conn) => conn.page(1, conn.searchable === true ? text : ''))
      .then(({ items }) => show(sec, items.filter((i) => i.title.toLowerCase().includes(lower) || src.type === 'archive')))
      .catch(() => sec.s.remove()));
  }
  await Promise.allSettled(jobs);
  if (!box.querySelector('.film')) box.replaceChildren(el('p', { class: 'empty' }, 'Nothing found. Try another word.'));
});

/* ================================================================ SERVICES (More tab) */

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
          onclick: () => { addSource({ type: 'website', name: s.name, url: s.url }); switchTab('sources'); },
        }, 'Add to My sources')))));
  } catch {
    list.replaceChildren(el('p', { class: 'empty' }, "Couldn't load the services list."));
  }
}

/* ================================================================ MY SOURCES */

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
  persistSources();
  return s;
}

function persistSources() {
  storage.set(KEY, sources);
  renderSources();
  updateBackup();
}

function renderSources() {
  const list = $('#sources-list');
  if (sources.length === 0) {
    list.replaceChildren(el('p', { class: 'empty' }, 'Nothing here yet. Tap "+ Add" to add your first source.'));
    return;
  }
  list.replaceChildren(...sources.map((s) => el('article', { class: 'card' },
    el('div', { class: 'row-between' },
      el('h3', {}, s.name),
      el('span', { class: 'badge' }, (ADAPTERS[s.type] || {}).label || s.type)),
    el('p', {}, s.url),
    el('div', { class: 'actions' },
      el('button', { class: 'primary', type: 'button', onclick: () => openSource(s) }, 'Open'),
      el('button', { class: 'ghost', type: 'button', onclick: () => removeSource(s.id) }, 'Remove')))));
}

function removeSource(id) {
  sources = sources.filter((s) => s.id !== id);
  persistSources();
  buildHome();
}

function openSource(s) {
  if (!isWebUrl(s.url) || !ADAPTERS[s.type]) return;
  if (s.type === 'website') {
    open('web', () => {
      $('#web-h').textContent = s.name;
      $('#web-out').href = s.url;
      $('#web-frame').src = s.url;
    });
    return;
  }
  openGrid(ADAPTERS[s.type].create(s.url), ADAPTERS[s.type].label, s.name);
}

/* ---- add-source form ---- */

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
    const conn = await ADAPTERS[type].create(url);
    const name = $('#add-name').value.trim() || (conn.name || '').slice(0, 80) || new URL(url).hostname;
    const s = addSource({ type, name, url });
    addDialog.hidden = true;
    buildHome();
    openSource(s);
  } catch (err) {
    error.textContent = friendlyError(err);
    error.hidden = false;
  } finally {
    save.disabled = false;
    save.textContent = 'Save';
  }
});

/* ================================================================ backup / import */

function updateBackup() {
  $('#backup-text').value = JSON.stringify({
    sources: sources.map(({ type, name, url }) => ({ type, name, url })),
    mylist,
  });
}

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
    const data = JSON.parse($('#backup-text').value);
    const incomingSources = Array.isArray(data) ? data : data.sources || []; // old backups were a plain list
    const incomingList = Array.isArray(data.mylist) ? data.mylist : [];
    const known = new Set(sources.map((s) => s.type + s.url));
    let added = 0;
    for (const s of incomingSources) {
      if (!s || !ADAPTERS[s.type] || typeof s.name !== 'string' || !isWebUrl(s.url) || known.has(s.type + s.url)) continue;
      sources.push({ id: Date.now().toString(36) + added, type: s.type, name: s.name.slice(0, 80), url: s.url });
      added++;
    }
    let saved = 0;
    for (const it of incomingList) {
      if (!it || typeof it.title !== 'string' || inMyList(it)) continue;
      if (it.poster && !isWebUrl(it.poster)) continue;
      mylist.push(snapshot(it));
      saved++;
    }
    storage.set('sinima.mylist.v1', mylist);
    persistSources();
    buildHome();
    $('#backup-msg').textContent = `Imported ${added} source${added === 1 ? '' : 's'} and ${saved} saved title${saved === 1 ? '' : 's'}.`;
  } catch {
    $('#backup-msg').textContent = "That text isn't a valid Sinima backup.";
  }
});

/* ================================================================ keyboard */

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (!addDialog.hidden) addDialog.hidden = true;
  else if (!player.hidden) closePlayer(false);
});

/* ================================================================ start */

history.replaceState({ depth: 1 }, '');
renderSources();
updateBackup();
buildHome();
loadServices();
const startTab = location.hash.slice(1);
if (TABS.includes(startTab) && startTab !== 'home') switchTab(startTab);
else render('home');

// Offline support + installable app (PWA)
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
