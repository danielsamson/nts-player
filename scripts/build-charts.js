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
const VERSION = 2;                   // bump when files gain data: older ones are rebuilt a year at a time
const DAY = 864e5;
const splitArtists = (a) => String(a || '').split(/\s*(?:,|&|\bx\b|\bfeat\.?|\bft\.?|\band\b)\s*/i).map((s) => s.trim()).filter(Boolean);
const n = (x) => String(x || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const JUNK = new Set(['id', 'unknown', 'untitled', 'tba', 'tbc', 'track id', 'unreleased', 'n a', 'na', 'various', 'various artists', 'unknown artist']);

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
  const artists = new Map();           // artist -> { name, tracks: Set, shows: Set }
  let plays = 0, read = 0;
  await pool(refs, 3, async (r) => {
    showEps.set(r.show, (showEps.get(r.show) || 0) + 1);
    const [tl, ep] = await Promise.all([
      get(`${API}/shows/${r.show}/episodes/${r.episode}/tracklist`),
      get(`${API}/shows/${r.show}/episodes/${r.episode}`)
    ]);
    for (const g of new Set((ep?.genres || []).map((x) => String(x.value || '').trim()).filter(Boolean))) genres.set(g, (genres.get(g) || 0) + 1);
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
      if (!m) { m = { a: x.artist, t: x.title, e: 0, shows: new Set(), firstBy: new Map(), latest: null, first: r.d }; tracks.set(k, m); }
      m.e++;
      m.shows.add(r.show);
      if (!m.firstBy.has(r.show) || r.d < m.firstBy.get(r.show)) m.firstBy.set(r.show, r.d);
      for (const name of splitArtists(x.artist)) {
        const ak = n(name);
        if (!ak || JUNK.has(ak)) continue;
        let ar = artists.get(ak);
        if (!ar) { ar = { name, tracks: new Set(), shows: new Set() }; artists.set(ak, ar); }
        ar.tracks.add(t); ar.shows.add(r.show);
      }
      m.first = Math.min(m.first, r.d);
      if (!m.latest || r.d > m.latest.d) m.latest = { s: r.show, ep: r.episode, o: x.offset ?? x.offset_estimate ?? null, d: r.d };
    }
  });

  const top = [...tracks.values()].sort((a, b) => b.shows.size - a.shows.size || b.e - a.e || b.latest.d - a.latest.d).slice(0, KEEP_TRACKS);
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
    //  [day each of those shows first played it (days since 1970)]]
    tracks: top.map((m) => { const ss = [...m.shows]; return [m.a, m.t, m.e, ss.map(si), [si(m.latest.s), m.latest.ep, m.latest.o, m.latest.d], m.first, ss.map((s) => Math.floor(m.firstBy.get(s) / DAY))]; }),
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
async function releaseYear(artist, title) {
  const clean = (x) => String(x).replace(/\s*[([][^)\]]*[)\]]/g, '').replace(/"/g, '').trim();
  const q = `recording:"${clean(title)}" AND artist:"${clean(splitArtists(artist)[0] || artist)}"`;
  const r = await fetch(`https://musicbrainz.org/ws/2/recording?query=${encodeURIComponent(q)}&fmt=json&limit=5`, { headers: { 'User-Agent': 'nts-player-charts/1.0', Accept: 'application/json' } });
  if (r.status === 503) { await new Promise((res) => setTimeout(res, 3000)); return undefined; }   // busy: try another time
  if (!r.ok) throw new Error(`MusicBrainz ${r.status}`);
  const recs = ((await r.json()).recordings || []).filter((x) => x.score >= 90 && x['first-release-date']);
  const years = recs.map((x) => parseInt(x['first-release-date'], 10)).filter((y) => y > 1900);
  return years.length ? Math.min(...years) : 0;
}
async function fillYears() {
  const dir = path.join(OUT, 'charts');
  const cacheFile = path.join(dir, 'years.json');
  let cache = {};
  try { cache = JSON.parse(fs.readFileSync(cacheFile, 'utf8')); } catch {}
  const todo = fs.readdirSync(dir).filter((f) => /^\d{4}-\d{2}\.json$/.test(f)).sort().reverse()
    .filter((f) => { try { const d = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); return d.v >= VERSION && !d.years; } catch { return false; } })
    .slice(0, YEARS_PER_RUN);
  for (const f of todo) {
    const d = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    const years = {};
    let i = 0, failed = false;
    for (const t of d.tracks) {
      if (t[2] < 2) continue;
      if (i >= YEAR_TOP) break;
      const k = `${n(t[0])}|${n(t[1])}`;
      if (!(k in cache)) {
        let y;
        try { y = await releaseYear(t[0], t[1]); } catch (e) { console.log(`years: ${e.message}, stopping`); failed = true; break; }
        await new Promise((res) => setTimeout(res, 1100));
        if (y !== undefined) cache[k] = y;
      }
      if (cache[k]) years[i] = cache[k];
      i++;
    }
    fs.writeFileSync(cacheFile, JSON.stringify(cache));
    if (failed) return;
    d.years = years;                    // chart row index -> first release year
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

(async () => {
  fs.mkdirSync(path.join(OUT, 'charts'), { recursive: true });
  for (const p of periods()) {
    const res = await build(p);
    if (!res.episodes) { console.log(`${p}: no episodes, skipped`); continue; }
    fs.writeFileSync(path.join(OUT, 'charts', `${p}.json`), JSON.stringify(res));
  }
  if (args.includes('years')) await fillYears().catch((e) => console.log(`years: ${e.message}`));
  const months = fs.readdirSync(path.join(OUT, 'charts')).filter((f) => /^\d{4}-\d{2}\.json$/.test(f)).map((f) => f.slice(0, 7)).sort().reverse();
  fs.writeFileSync(path.join(OUT, 'charts', 'index.json'), JSON.stringify({ months, updated: Date.now() }));
  console.log(`index: ${months.length} months`);
})().catch((e) => { console.error(e); process.exit(1); });
