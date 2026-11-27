// Builds the "Most played on NTS" data: one small JSON file per month (and one for the
// last 30 days), worked out once here instead of in every copy of the app. Runs daily on
// GitHub Actions (.github/workflows/charts.yml) and publishes to the `data` branch; the
// app just downloads the files.
//
//   node scripts/build-charts.js [--out DIR] [periods...]
//   periods: recent | 2026-10 | 2024-01..2024-12 | auto (default: recent, this month,
//            and last month while it may still be settling) | backfill (the newest year
//            back to 2016 that's still missing months, or has them from an older version) |
//            years (add release years to a few months that don't have them yet)
//
// For each period: the episodes broadcast in it (from nts.live's sitemap), their
// tracklists (NTS API), and per track how many episodes and which shows played it.
const fs = require('fs');
const path = require('path');
const sitemap = require('../sitemap');

const API = 'https://www.nts.live/api/v2';
const KEEP_TRACKS = 2000;            // per file, most played first (enough to merge into a year)
const VERSION = 4;                   // bump when files gain data: older ones are rebuilt a year at a time
const DAY = 864e5;
const splitArtists = (a) => String(a || '').split(/\s*(?:,|&|\bx\b|\bfeat\.?|\bft\.?|\band\b)\s*/i).map((s) => s.trim()).filter(Boolean);
const n = (x) => String(x || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const JUNK = new Set(['id', 'unknown', 'untitled', 'tba', 'tbc', 'track id', 'unreleased', 'n a', 'na', 'various', 'various artists', 'unknown artist']);
// tracklist labels that aren't artists (film clips, talk, idents): not counted as artists
const NOT_ARTISTS = new Set(['excerpt', 'excerpts', 'dialogue', 'interview', 'intro', 'outro', 'speech', 'spoken word', 'jingle', 'ident', 'nts', 'nts radio', 'traditional', 'trad', 'anonymous', 'field recording', 'field recordings']);

const args = process.argv.slice(2);
const outIdx = args.indexOf('--out');
const OUT = outIdx >= 0 ? args.splice(outIdx, 2)[1] : path.join(__dirname, '..', 'data');
const ym = (d) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;

async function get(url, tries = 4) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: { Accept: 'application/json' } });
      if (r.ok) return await r.json();
      if (r.status === 404 || r.status === 422) return null;
    } catch {}
    await new Promise((res) => setTimeout(res, 1500 * (i + 1)));
  }
  return null;
}
// a few at a time, with a short pause each: go easy on NTS (at most ~30 requests a second)
async function pool(items, size, fn) {
  let next = 0;
  await Promise.all(Array.from({ length: size }, async () => {
    while (next < items.length) { const i = next++; await fn(items[i], i); await new Promise((r) => setTimeout(r, 100)); }
  }));
}
// NTS's catch-all slots (one-off guests, yearly dance specials): not shows in their own right
const CATCH_ALL = /^(guests|dancing-\d{4}|nts-guests|supporter-radio.*)$/;

let firstEpisode = null;              // show -> date of its first episode (whole sitemap)
async function debutsOf() {
  if (!firstEpisode) {
    firstEpisode = new Map();
    for (const e of await sitemap.allEpisodes()) if (e.d && (!firstEpisode.has(e.show) || e.d < firstEpisode.get(e.show))) firstEpisode.set(e.show, e.d);
  }
  return firstEpisode;
}

// NTS's top-level genre families ("housetechno" -> "house / techno"): an episode's genre ids
// start with their family ("genres-housetechno-acid")
let families = null;
async function familyNames() {
  if (!families) families = new Map(((await get(`${API}/genres`))?.results || []).map((g) => [g.id, g.name || g.id]));
  return families;
}
const familyOf = (id) => String(id || '').replace(/^genres-/, '').split('-')[0];

async function build(period) {
  const now = Date.now();
  let from, to;
  if (period === 'recent') { from = now - 30 * 864e5; to = now + 864e5; }
  else { const [y, m] = period.split('-').map(Number); from = Date.UTC(y, m - 1, 1); to = Date.UTC(y, m, 1); }
  const refs = await sitemap.episodesBetween(from, to);
  console.log(`${period}: ${refs.length} episodes`);

  const showEps = new Map();
  const tracks = new Map();
  const genres = new Map();            // genre -> episodes tagged with it
  const famEps = new Map();            // genre family -> episodes tagged with it
  const famNames = await familyNames();
  const artists = new Map();           // artist -> { name, tracks: Set, shows: Set }
  let plays = 0, read = 0;
  await pool(refs, 3, async (r) => {
    showEps.set(r.show, (showEps.get(r.show) || 0) + 1);
    const [tl, ep] = await Promise.all([
      get(`${API}/shows/${r.show}/episodes/${r.episode}/tracklist`),
      get(`${API}/shows/${r.show}/episodes/${r.episode}`)
    ]);
    for (const g of new Set((ep?.genres || []).map((x) => String(x.value || '').trim()).filter(Boolean))) genres.set(g, (genres.get(g) || 0) + 1);
    const fams = [...new Set((ep?.genres || []).map((x) => familyOf(x.id)).filter((f) => famNames.has(f) && f !== 'other'))];
    fams.forEach((f) => famEps.set(f, (famEps.get(f) || 0) + 1));
    read++;
    if (read % 100 === 0) console.log(`  ${read} / ${refs.length}`);
    const seen = new Set();
    for (const x of tl?.results || []) {
      const a = n(x.artist), t = n(x.title);
      if (!a || !t || JUNK.has(a) || JUNK.has(t)) continue;
      plays++;
      const k = `${a}|${t}`;
      if (seen.has(k)) continue;                       // once per episode
      seen.add(k);
      let m = tracks.get(k);
      if (!m) { m = { a: x.artist, t: x.title, e: 0, shows: new Set(), firstBy: new Map(), latest: null, first: r.d, fams: new Map() }; tracks.set(k, m); }
      m.e++;
      for (const f of fams) {
        let g = m.fams.get(f);
        if (!g) { g = { shows: new Set(), e: 0 }; m.fams.set(f, g); }
        g.shows.add(r.show); g.e++;
      }
      m.shows.add(r.show);
      if (!m.firstBy.has(r.show) || r.d < m.firstBy.get(r.show)) m.firstBy.set(r.show, r.d);
      for (const name of splitArtists(x.artist)) {
        const ak = n(name);
        if (!ak || JUNK.has(ak) || NOT_ARTISTS.has(ak)) continue;
        let ar = artists.get(ak);
        if (!ar) { ar = { name, tracks: new Set(), shows: new Set() }; artists.set(ak, ar); }
        ar.tracks.add(t); ar.shows.add(r.show);
      }
      m.first = Math.min(m.first, r.d);
      if (!m.latest || r.d > m.latest.d) m.latest = { s: r.show, ep: r.episode, o: x.offset ?? x.offset_estimate ?? null, d: r.d };
    }
  });

  const top = [...tracks.values()].sort((a, b) => b.shows.size - a.shows.size || b.e - a.e || b.latest.d - a.latest.d).slice(0, KEEP_TRACKS);
  const familyList = [...famEps].sort((a, b) => b[1] - a[1]).map(([f]) => f);
  const fi = new Map(familyList.map((f, i) => [f, i]));
  const showList = [];
  const idx = new Map();
  const si = (s) => { if (!idx.has(s)) { idx.set(s, showList.length); showList.push(s); } return idx.get(s); };
  const busiest = [...showEps].filter(([s]) => !CATCH_ALL.test(s)).sort((a, b) => b[1] - a[1]).slice(0, 30);
  const firsts = await debutsOf();
  const debuts = period === 'recent' ? [] : [...showEps.keys()].filter((s) => { const d = firsts.get(s); return !CATCH_ALL.test(s) && d >= from && d < to; });

  // names and pictures for the shows the cards show
  const names = {};
  await pool([...new Set([...busiest.slice(0, 12).map(([s]) => s), ...debuts.slice(0, 24)])], 4, async (s) => {
    const sh = await get(`${API}/shows/${s}`);
    if (sh) names[s] = [sh.name || s, sh.media?.picture_small || '', sh.location_long || ''];
  });

  // Supporter Radio specials: addresses change, the name doesn't
  const special = (s) => /^supporter radio/i.test((names[s] || [])[0] || '');
  const realBusiest = busiest.filter(([s]) => !special(s));
  const realDebuts = debuts.filter((s) => !special(s));
  return {
    v: VERSION,
    period, from, to: Math.min(to, now), generated: now, complete: to <= now,
    episodes: refs.length, shows: showEps.size, plays, uniqueTracks: tracks.size,
    showList,
    // [artist, title, episodes, [show indexes], [latest show index, episode, offset, date], first played,
    //  [day each of those shows first played it (days since 1970)],
    //  [[genre family index, [show indexes], episodes] for each family it was played under]]
    tracks: top.map((m) => { const ss = [...m.shows]; return [m.a, m.t, m.e, ss.map(si), [si(m.latest.s), m.latest.ep, m.latest.o, m.latest.d], m.first, ss.map((s) => Math.floor(m.firstBy.get(s) / DAY)),
      [...m.fams].map(([f, g]) => [fi.get(f), [...g.shows].map(si), g.e])]; }),
    // genre families, most episodes first: [id, name, episodes] (tracks point at these)
    families: familyList.map((f) => [f, famNames.get(f), famEps.get(f)]),
    // genres by number of episodes tagged with them
    genres: [...genres].sort((a, b) => b[1] - a[1]).slice(0, 60),
    // artists with the most different tracks played (from every play): [name, tracks, [show indexes]]
    artists: [...artists.values()].sort((a, b) => b.tracks.size - a.tracks.size || b.shows.size - a.shows.size).slice(0, 150)
      .map((ar) => [ar.name, ar.tracks.size, [...ar.shows].map(si)]),
    busiest: realBusiest, debuts: realDebuts, names,
    // every show that broadcast, with its number of episodes (for the year's totals)
    showEps: [...showEps].sort((a, b) => b[1] - a[1])
  };
}

// ---- release years (MusicBrainz: the first release of each recording, not a reissue) ----
// One request a second, as MusicBrainz asks; results cached in charts/years.json so a track
// is only looked up once. A few months per run; gives up quietly if MusicBrainz is unreachable.
const YEARS_PER_RUN = Number(process.env.YEARS_MONTHS) || 3, YEAR_TOP = 100;
// The earliest year any source gives (a later one is usually a reissue). MusicBrainz first
// (it records a recording's first release); Deezer and iTunes Search if it has nothing.
const UA = { 'User-Agent': 'nts-player-charts/1.0', Accept: 'application/json' };
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
const words = (x) => new Set(n(x).split(' ').filter((w) => w.length > 1 && !['the', 'and', 'feat', 'ft'].includes(w)));
const plain = (x) => String(x || '').replace(/\s*[([][^)\]]*[)\]]/g, '').replace(/\s+(feat|ft)\.?\s.*$/i, '').replace(/["“”]/g, '').trim();
// is a result this track? same title (ignoring brackets, feat.) and every word of the main artist
// (one shared word let Michael Jackson match a Jackson 5 recording)
function same(artist, title, rArtist, rTitle) {
  if (n(plain(rTitle)) !== n(plain(title))) return false;
  const a = words(splitArtists(artist)[0] || artist), b = words(rArtist);
  return !a.size || [...a].every((w) => b.has(w));
}
async function getJson(url, tries = 7) {
  for (let i = 0; i < tries; i++) {
    let r;
    try { r = await fetch(url, { headers: UA }); } catch { await sleep(2000 * 2 ** i); continue; }   // network hiccup: try again
    if (r.status === 503 || r.status === 429) { await sleep(2000 * 2 ** i); continue; }   // busy: wait longer each time
    if (!r.ok) throw new Error(`${new URL(url).host} ${r.status}`);
    return r.json();
  }
  throw new Error(`${new URL(url).host} stayed busy`);
}
const yearOf = (d) => { const y = parseInt(d, 10); return y > 1900 && y <= new Date().getUTCFullYear() + 1 ? y : null; };
async function releaseYear(artist, title) {
  const t = plain(title), a = plain(splitArtists(artist)[0] || artist).replace(/^the\s+/i, '');
  const found = [];
  // MusicBrainz: search the words, then check each result ourselves
  const q = `recording:(${t.replace(/[^\p{L}\p{N}\s']/gu, ' ')}) AND artist:(${a.replace(/[^\p{L}\p{N}\s']/gu, ' ')})`;
  const mb = await getJson(`https://musicbrainz.org/ws/2/recording?query=${encodeURIComponent(q)}&fmt=json&limit=15`);
  await sleep(1100);
  for (const r of mb.recordings || []) {
    const ra = (r['artist-credit'] || []).map((c) => c.name).join(' ');
    if (same(artist, title, ra, r.title)) { const y = yearOf(r['first-release-date']); if (y) found.push(y); }
  }
  if (found.length) return Math.min(...found);
  // Deezer: the album's release date
  try {
    const dz = await getJson(`https://api.deezer.com/search?q=${encodeURIComponent(`${a} ${t}`)}&limit=5`, 2);
    const hit = (dz.data || []).find((x) => same(artist, title, x.artist?.name, x.title));
    if (hit) { const al = await getJson(`https://api.deezer.com/album/${hit.album.id}`, 2); const y = yearOf(al.release_date); if (y) found.push(y); }
  } catch {}
  // iTunes Search
  try {
    const it = await getJson(`https://itunes.apple.com/search?term=${encodeURIComponent(`${a} ${t}`)}&entity=song&limit=10`, 2);
    (it.results || []).filter((x) => same(artist, title, x.artistName, x.trackName)).forEach((x) => { const y = yearOf(x.releaseDate); if (y) found.push(y); });
    await sleep(3000);                      // iTunes allows about 20 searches a minute
  } catch {}
  return found.length ? Math.min(...found) : 0;
}
const YEARS_V = 3;                     // v3: the whole main artist must match
const yearsFile = () => path.join(OUT, 'charts', `years-v${YEARS_V}.json`);
const keyOf = (t) => `${n(t[0])}|${n(t[1])}`;
// A freshly built month gets every release year already looked up, so a rebuild never loses
// them; it's only marked done (yearsV) if none of its top tracks are left to look up
function cachedYears(d) {
  let cache = {};
  try { cache = JSON.parse(fs.readFileSync(yearsFile(), 'utf8')); } catch { return; }
  const top = d.tracks.filter((t) => t[2] >= 2).slice(0, YEAR_TOP);
  d.years = {};
  top.forEach((t, i) => { if (cache[keyOf(t)]) d.years[i] = cache[keyOf(t)]; });
  if (top.every((t) => keyOf(t) in cache)) d.yearsV = YEARS_V;
}
async function fillYears() {
  const dir = path.join(OUT, 'charts');
  const cacheFile = yearsFile();
  let cache = {};
  try { cache = JSON.parse(fs.readFileSync(cacheFile, 'utf8')); } catch {}
  const todo = fs.readdirSync(dir).filter((f) => /^\d{4}-\d{2}\.json$/.test(f)).sort().reverse()
    .filter((f) => { try { const d = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); return d.v >= VERSION && d.yearsV !== YEARS_V; } catch { return false; } })
    .slice(0, YEARS_PER_RUN);
  for (const f of todo) {
    const d = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    const years = {};
    let i = 0, failed = false;
    for (const t of d.tracks) {
      if (t[2] < 2) continue;
      if (i >= YEAR_TOP) break;
      const k = keyOf(t);
      if (!(k in cache)) {
        try { cache[k] = await releaseYear(t[0], t[1]); } catch (e) { console.log(`years: ${e.message}, stopping`); failed = true; break; }
      }
      if (cache[k]) years[i] = cache[k];
      i++;
    }
    fs.writeFileSync(cacheFile, JSON.stringify(cache));
    if (failed) return;
    d.years = years;                    // chart row index -> first release year
    d.yearsV = YEARS_V;
    fs.writeFileSync(path.join(dir, f), JSON.stringify(d));
    console.log(`years: ${f} (${Object.keys(years).length} of ${i})`);
  }
}

function periods() {
  const list = args.length ? args : ['auto'];
  const out = [];
  for (const p of list) {
    if (p === 'years') continue;          // a separate step, after building
    if (p === 'auto') {
      const d = new Date();
      out.push('recent', ym(d));
      if (d.getUTCDate() <= 7) out.push(ym(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1))));   // last month may still be filling in
    } else if (p === 'backfill') {
      // the newest year (2016 on) still missing months: one year per run, so NTS isn't hit all at once
      // months we have at the current version (older versions get rebuilt with the new data)
      const dir = path.join(OUT, 'charts');
      const have = new Set((fs.existsSync(dir) ? fs.readdirSync(dir) : []).filter((f) => /^\d{4}-\d{2}\.json$/.test(f)).filter((f) => {
        try { return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')).v >= VERSION; } catch { return false; }
      }).map((f) => f.slice(0, 7)));
      const thisYear = new Date().getUTCFullYear();
      for (let y = thisYear; y >= 2016; y--) {
        const missing = [];
        for (let m = 1; m <= 12; m++) { const k = `${y}-${String(m).padStart(2, '0')}`; if (k <= ym(new Date()) && !have.has(k)) missing.push(k); }
        if (missing.length) { out.push(...missing); break; }
      }
    } else if (p.includes('..')) {
      const [a, b] = p.split('..');
      for (let d = new Date(Date.UTC(+a.slice(0, 4), +a.slice(5) - 1, 1)); ym(d) <= b; d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1))) out.push(ym(d));
    } else out.push(p);
  }
  return [...new Set(out)];
}

module.exports = { releaseYear, build };
if (require.main === module) (async () => {
  fs.mkdirSync(path.join(OUT, 'charts'), { recursive: true });
  for (const p of periods()) {
    const res = await build(p);
    if (!res.episodes) { console.log(`${p}: no episodes, skipped`); continue; }
    cachedYears(res);
    fs.writeFileSync(path.join(OUT, 'charts', `${p}.json`), JSON.stringify(res));
  }
  if (args.includes('years')) await fillYears().catch((e) => console.log(`years: ${e.message}`));
  const months = fs.readdirSync(path.join(OUT, 'charts')).filter((f) => /^\d{4}-\d{2}\.json$/.test(f)).map((f) => f.slice(0, 7)).sort().reverse();
  fs.writeFileSync(path.join(OUT, 'charts', 'index.json'), JSON.stringify({ months, updated: Date.now() }));
  console.log(`index: ${months.length} months`);
})().catch((e) => { console.error(e); process.exit(1); });
