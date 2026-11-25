// Album artwork for tracklist entries.
// NTS tracklists come from music recognition and often carry a Deezer track ID
// or an ISRC. We try, in order:
//   1. Deezer by track ID      (exact)
//   2. Deezer by ISRC          (exact)
//   3. Deezer search           (exact fields, then a looser search)
//   4. iTunes Search           (last resort; rate limited and queued by priority)
// Only artist and title are sent. Results (including misses) are cached on disk.

const { net, app } = require('electron');
const fs = require('fs');
const path = require('path');

// v2: entries also carry album, year and links to the track on Deezer / Apple Music
// v4: dropped Deezer's grey placeholder covers saved as if they were real
const CACHE_FILE = () => path.join(app.getPath('userData'), 'art-cache-v4.json');
const MISS_TTL = 3 * 24 * 3600 * 1000;    // retry misses after three days
let cache = null;
let saveTimer = null;

function loadCache() {
  if (cache) return cache;
  try { cache = JSON.parse(fs.readFileSync(CACHE_FILE(), 'utf8')); } catch { cache = {}; }
  return cache;
}
// Save at most every 5 s while lookups keep coming in, and once more when the app quits
function writeCache() {
  saveTimer = null;
  if (!cache) return;
  try { fs.writeFileSync(CACHE_FILE(), JSON.stringify(cache)); } catch {}
}
function saveCache() {
  if (!saveTimer) saveTimer = setTimeout(writeCache, 5000);
}
app.on('will-quit', () => { if (saveTimer) { clearTimeout(saveTimer); writeCache(); } });

async function getJson(url) {
  const res = await net.fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(String(res.status));
  return res.json();
}

// iTunes Search allows roughly 20 requests a minute. All iTunes calls go through
// this: one at a time, at least 3 s apart, and a 60 s pause after a 403/429.
const itunesQueue = { high: [], low: [] };
let itunesBusy = false;
let itunesLast = 0;
let itunesPausedUntil = 0;
// priority 'high': the track you're listening to (Apple link, its cover).
// priority 'low': covers for other tracklist rows.
function itunes(url, priority = 'low') {
  return new Promise((resolve, reject) => {
    itunesQueue[priority === 'high' ? 'high' : 'low'].push({ url, resolve, reject });
    itunesPump();
  });
}
async function itunesPump() {
  if (itunesBusy) return;
  const job = itunesQueue.high.shift() || itunesQueue.low.shift();
  if (!job) return;
  itunesBusy = true;
  try {
    if (Date.now() < itunesPausedUntil) throw new Error('itunes paused');
    const wait = itunesLast + 3000 - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    itunesLast = Date.now();
    const res = await net.fetch(job.url, { headers: { Accept: 'application/json' } });
    if (res.status === 403 || res.status === 429) { itunesPausedUntil = Date.now() + 60_000; throw new Error('itunes rate limited'); }
    if (!res.ok) throw new Error(String(res.status));
    job.resolve(await res.json());
  } catch (e) {
    job.reject(e);
  } finally {
    itunesBusy = false;
    itunesPump();
  }
}

const norm = (s) => (s || '').toLowerCase()
  .normalize('NFKD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]+/g, ' ').trim();
const words = (s) => new Set(norm(s).split(' ').filter((w) => w.length > 1));
// Strip "(... Remix)", "[...]", "ft./feat. ...", "prod. by ..." so searches find the release
const cleanTitle = (t) => (t || '')
  .replace(/\s*[([][^)\]]*[)\]]/g, '')
  .replace(/\s+(ft\.?|feat\.?|featuring|prod\.?( by)?)\s.*$/i, '')
  .trim();
const firstArtist = (a) => (a || '').split(/,|&| x | ft\.? | feat\.? /i)[0].trim();

// Does a search result plausibly match the track? Needs overlap on both artist and title.
function matches(track, resArtist, resTitle) {
  const want = { artist: words(firstArtist(track.artist)), title: words(cleanTitle(track.title)) };
  const got = new Set([...words(resArtist), ...words(resTitle)]);
  const hit = (set) => [...set].some((w) => got.has(w));
  return want.artist.size && want.title.size && hit(want.artist) && hit(want.title);
}

// Deezer serves a grey placeholder for releases without a cover: its image id is blank or
// d41d8cd98f00b204e9800998ecf8427e (the hash of nothing). Treat those as no cover.
const DEEZER_EMPTY = 'd41d8cd98f00b204e9800998ecf8427e';
const hasDeezerCover = (album) => {
  const id = album?.md5_image || (/\/images\/cover\/([0-9a-f]*)\//.exec(album?.cover_medium || '') || [])[1] || '';
  return /^[0-9a-f]{32}$/.test(id) && id !== DEEZER_EMPTY;
};

// Deezer track (from /track or /search) -> { small, large, album, year, deezerUrl }
const fromDeezer = (t) => t?.album?.cover_medium && hasDeezerCover(t.album) ? {
  small: t.album.cover_small || t.album.cover_medium,
  large: t.album.cover_xl || t.album.cover_big || t.album.cover_medium,
  album: t.album.title || '',
  year: (t.release_date || t.album.release_date || '').slice(0, 4),
  deezerUrl: t.link || (t.id ? `https://www.deezer.com/track/${t.id}` : '')
} : null;

// Of the results that match artist and title, take the one whose title fits best
// (so "Sweetie (IZCO Remix)" beats "Sweetie", and "Freedom Journey" still counts)
function bestMatch(track, results, artistOf, titleOf) {
  const want = words(track.title);
  return results
    .filter((x) => matches(track, artistOf(x), titleOf(x)))
    .map((x) => {
      const got = words(titleOf(x));
      return { x, score: [...want].filter((w) => got.has(w)).length * 2 - [...got].filter((w) => !want.has(w)).length };
    })
    .sort((a, b) => b.score - a.score)[0]?.x || null;
}

async function lookup(track, priority) {
  const { deezer, isrc } = track;
  if (deezer) {
    try { const r = fromDeezer(await getJson(`https://api.deezer.com/track/${encodeURIComponent(deezer)}`)); if (r) return r; } catch {}
  }
  if (isrc) {
    try { const r = fromDeezer(await getJson(`https://api.deezer.com/track/isrc:${encodeURIComponent(isrc)}`)); if (r) return r; } catch {}
  }
  const artist = firstArtist(track.artist);
  const title = cleanTitle(track.title);
  if (!artist || !title) return null;
  // Deezer: exact fields first, then a looser search (catches reordered titles)
  for (const q of [`artist:"${artist}" track:"${title}"`, `${norm(artist)} ${norm(title)}`]) {
    try {
      const d = await getJson(`https://api.deezer.com/search?q=${encodeURIComponent(q)}&limit=10`);
      const hit = bestMatch(track, d.data || [], (x) => x.artist?.name, (x) => x.title);
      if (hit) return fromDeezer(hit);
    } catch {}
  }
  // iTunes Search as the last resort (rate limited, so it waits its turn)
  try {
    const d = await itunes(`https://itunes.apple.com/search?term=${encodeURIComponent(`${norm(artist)} ${norm(title)}`)}&entity=song&limit=10`, priority);
    const hit = bestMatch(track, d.results || [], (x) => x.artistName, (x) => x.trackName);
    if (hit?.artworkUrl100) {
      return {
        small: hit.artworkUrl100, large: hit.artworkUrl100.replace(/\/\d+x\d+bb\./, '/600x600bb.'),
        album: hit.collectionName || '', year: (hit.releaseDate || '').slice(0, 4),
        appleUrl: hit.trackViewUrl ? `${hit.trackViewUrl.split('?')[0]}?i=${hit.trackId}` : ''
      };
    }
  } catch (e) {
    if (/rate limited|paused/.test(e.message)) throw e;   // don't cache as a miss
  }
  return null;
}

// A small queue so a long tracklist doesn't fire dozens of requests at once
const queue = [];
let active = 0;
const inflight = new Map();
function pump() {
  while (active < 3 && queue.length) {
    const job = queue.shift();
    active++;
    lookup(job.track, job.priority).then(job.resolve, () => job.resolve(undefined)).finally(() => { active--; pump(); });
  }
}

function getArt(track, priority = 'low') {
  if (!track || typeof track.artist !== 'string' || typeof track.title !== 'string') return Promise.resolve(null);
  // Lookups with an exact ID are cached separately, so a miss by name never blocks them
  const key = track.deezer ? `dz:${track.deezer}` : track.isrc ? `isrc:${track.isrc}` : `${norm(track.artist)}|${norm(track.title)}`;
  const c = loadCache();
  const hit = c[key];
  if (hit && (hit.art || Date.now() - hit.at < MISS_TTL)) return Promise.resolve(hit.art);
  if (inflight.has(key)) {
    // already waiting: if it's now the track you're listening to, move it up
    const waiting = queue.findIndex((j) => j.key === key);
    if (priority === 'high' && waiting > 0) {
      const [j] = queue.splice(waiting, 1);
      j.priority = 'high';
      queue.unshift(j);
    }
    return inflight.get(key);
  }
  const job = { track, priority, key };
  const p = new Promise((resolve) => {
    job.resolve = resolve;
    // the track you're listening to goes to the front of the line
    if (priority === 'high') queue.unshift(job); else queue.push(job);
    pump();
  }).then((art) => {
    inflight.delete(key);
    if (art === undefined) return null;      // rate limited: try again later, don't remember a miss
    c[key] = { art, at: Date.now() };
    saveCache();
    return art;
  });
  inflight.set(key, p);
  return p;
}

// Exact Apple Music link for one track (used for the track on the stage only, to keep
// requests low). iTunes Search by artist + title, checked for a match. Cached.
async function getAppleLink(track) {
  if (!track || typeof track.artist !== 'string' || typeof track.title !== 'string') return null;
  const key = `apple|${norm(track.artist)}|${norm(track.title)}`;
  const c = loadCache();
  const hit = c[key];
  if (hit && (hit.url || Date.now() - hit.at < MISS_TTL)) return hit.url;

  // Keep the remix / version in the title ("Sweetie (IZCO Remix)"), drop featured artists
  const fullTitle = track.title.replace(/\s*[([]\s*(ft\.?|feat\.?|featuring|prod\.?)[^)\]]*[)\]]/gi, '')
    .replace(/\s+(ft\.?|feat\.?|featuring|prod\.?( by)?)\s.*$/i, '');
  const want = words(fullTitle);
  // Prefer the result whose title shares the most words with ours (so a remix beats the original)
  const best = (results) => results
    .filter((x) => matches(track, x.artistName, x.trackName))
    .map((x) => {
      const got = words(x.trackName);
      const shared = [...want].filter((w) => got.has(w)).length;
      const extra = [...got].filter((w) => !want.has(w)).length;
      return { x, score: shared * 2 - extra };
    })
    .sort((a, b) => b.score - a.score)[0]?.x;

  let url = null;
  try {
    for (const t of [fullTitle, cleanTitle(track.title)]) {
      const q = encodeURIComponent(`${norm(firstArtist(track.artist))} ${norm(t)}`);
      const d = await itunes(`https://itunes.apple.com/search?term=${q}&entity=song&limit=10`, 'high');
      const m = best(d.results || []);
      if (m?.trackViewUrl) { url = `${m.trackViewUrl.split('?')[0]}?i=${m.trackId}`; break; }
    }
  } catch { return null; }    // network trouble: don't cache, try again next time
  c[key] = { url, at: Date.now() };
  saveCache();
  return url;
}

module.exports = { getArt, getAppleLink };
