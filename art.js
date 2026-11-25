// Album artwork for tracklist entries.
// NTS tracklists come from music recognition and often carry a Deezer track ID
// or an ISRC. We try, in order:
//   1. Deezer by track ID      (exact)
//   2. Deezer by ISRC          (exact)
//   3. Deezer search           (artist + title, checked for a match)
// (iTunes is kept for the exact Apple Music link of the track on the stage, see below,
//  because its rate limit is tight.)
// Only artist and title are sent. Results (including misses) are cached on disk.

const { net, app } = require('electron');
const fs = require('fs');
const path = require('path');

// v2: entries also carry album, year and links to the track on Deezer / Apple Music
const CACHE_FILE = () => path.join(app.getPath('userData'), 'art-cache-v2.json');
const MISS_TTL = 14 * 24 * 3600 * 1000;   // retry misses after two weeks
let cache = null;
let saveTimer = null;

function loadCache() {
  if (cache) return cache;
  try { cache = JSON.parse(fs.readFileSync(CACHE_FILE(), 'utf8')); } catch { cache = {}; }
  return cache;
}
function saveCache() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { fs.writeFileSync(CACHE_FILE(), JSON.stringify(cache)); } catch {}
  }, 2000);
}

async function getJson(url) {
  const res = await net.fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(String(res.status));
  return res.json();
}

// iTunes Search allows roughly 20 requests a minute. All iTunes calls go through
// this: one at a time, at least 3 s apart, and a 60 s pause after a 403/429.
let itunesChain = Promise.resolve();
let itunesLast = 0;
let itunesPausedUntil = 0;
function itunes(url) {
  const run = async () => {
    if (Date.now() < itunesPausedUntil) throw new Error('itunes paused');
    const wait = itunesLast + 3000 - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    itunesLast = Date.now();
    const res = await net.fetch(url, { headers: { Accept: 'application/json' } });
    if (res.status === 403 || res.status === 429) { itunesPausedUntil = Date.now() + 60_000; throw new Error('itunes rate limited'); }
    if (!res.ok) throw new Error(String(res.status));
    return res.json();
  };
  const p = itunesChain.then(run, run);
  itunesChain = p.catch(() => {});
  return p;
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

// Deezer track (from /track or /search) -> { small, large, album, year, deezerUrl }
const fromDeezer = (t) => t?.album?.cover_medium ? {
  small: t.album.cover_small || t.album.cover_medium,
  large: t.album.cover_xl || t.album.cover_big || t.album.cover_medium,
  album: t.album.title || '',
  year: (t.release_date || t.album.release_date || '').slice(0, 4),
  deezerUrl: t.link || (t.id ? `https://www.deezer.com/track/${t.id}` : '')
} : null;

async function lookup(track) {
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
  try {
    const q = encodeURIComponent(`artist:"${artist}" track:"${title}"`);
    const d = await getJson(`https://api.deezer.com/search?q=${q}&limit=5`);
    const hit = (d.data || []).find((x) => matches(track, x.artist?.name, x.title));
    if (hit) return fromDeezer(hit);
  } catch {}
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
    lookup(job.track).then(job.resolve, () => job.resolve(null)).finally(() => { active--; pump(); });
  }
}

function getArt(track) {
  if (!track || typeof track.artist !== 'string' || typeof track.title !== 'string') return Promise.resolve(null);
  const key = `${norm(track.artist)}|${norm(track.title)}`;
  const c = loadCache();
  const hit = c[key];
  if (hit && (hit.art || Date.now() - hit.at < MISS_TTL)) return Promise.resolve(hit.art);
  if (inflight.has(key)) return inflight.get(key);
  const p = new Promise((resolve) => { queue.push({ track, resolve }); pump(); }).then((art) => {
    c[key] = { art, at: Date.now() };
    saveCache();
    inflight.delete(key);
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
      const d = await itunes(`https://itunes.apple.com/search?term=${q}&entity=song&limit=10`);
      const m = best(d.results || []);
      if (m?.trackViewUrl) { url = `${m.trackViewUrl.split('?')[0]}?i=${m.trackId}`; break; }
    }
  } catch { return null; }    // network trouble: don't cache, try again next time
  c[key] = { url, at: Date.now() };
  saveCache();
  return url;
}

module.exports = { getArt, getAppleLink };
