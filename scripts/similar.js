// Similar shows and tracks, worked out from every tracklist the charts build keeps in taste/
// (one file per month; the last few years count). Keys match the app's Chart.key. Written to charts/similar.json:
//   shows:  slug -> [[similar show, [artists both play]], ...]
//   tracks: "artist|title" -> [[artist, title, [shows that play both]], ...]
//   info:   slug -> [name, picture] for every show mentioned
// Shows are alike when they play the same artists, weighted so that artists everyone plays
// count for little. Tracks are alike when the same shows play them, weighted so that shows
// that play a bit of everything count for little.
const fs = require('fs');
const path = require('path');

const YEARS = 3;
const SHOW_MIN_PLAYS = 40;     // plays a show needs before it gets a profile
const TRACK_MIN_SHOWS = 3;     // shows a track needs before it gets neighbours
const KEEP_SHOWS = 8, KEEP_TRACKS = 6;
// shows that are a different guest every time, or play everything: they don't say much about taste
const MIXED = /^(guests|dancing-\d{4}|nts-guests|supporter-radio.*|your-specialist-subject.*|coming-of-age.*|nts-.*-takeover.*)$/;
const n = (x) => String(x || '').toLowerCase().replace(/ø/g, 'o').replace(/æ/g, 'ae').replace(/ß/g, 'ss').normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const splitArtists = (a) => String(a || '').split(/\s*(?:,|&|\bx\b|\bfeat\.?|\bft\.?|\band\b)\s*/i).map((s) => s.trim()).filter(Boolean);
const NOT_ARTISTS = new Set(['excerpt', 'excerpts', 'dialogue', 'interview', 'intro', 'outro', 'speech', 'spoken word', 'jingle', 'ident', 'nts', 'nts radio', 'traditional', 'trad', 'anonymous', 'field recording', 'field recordings', 'unknown', 'unknown artist', 'various', 'various artists']);

function load(out) {
  const dir = path.join(out, 'taste');
  if (!fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir).filter((f) => /^\d{4}-\d{2}\.json$/.test(f)).sort().reverse().slice(0, YEARS * 12);
  if (!files.length) return null;
  const artistsOf = new Map();         // show -> Map(artist key -> plays)
  const artistName = new Map();        // artist key -> how it's written most
  const showsOf = new Map();           // track key -> Set(show)
  const trackName = new Map();
  for (const f of files) {
    const d = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    for (const [si, , list] of d.eps) {
      const s = d.showList[si];
      if (MIXED.test(s)) continue;
      let am = artistsOf.get(s);
      if (!am) artistsOf.set(s, (am = new Map()));
      for (const ti of new Set(list)) {
        const [artist, title] = d.tracks[ti];
        const k = `${n(artist)}|${n(title)}`;
        if (!trackName.has(k)) trackName.set(k, [artist, title]);
        let ss = showsOf.get(k);
        if (!ss) showsOf.set(k, (ss = new Set()));
        ss.add(s);
        for (const a of splitArtists(artist)) {
          const ak = n(a);
          if (!ak || NOT_ARTISTS.has(ak)) continue;
          am.set(ak, (am.get(ak) || 0) + 1);
          if (!artistName.has(ak)) artistName.set(ak, a);
        }
      }
    }
  }
  return { months: files.map((f) => f.slice(0, 7)).sort(), artistsOf, artistName, showsOf, trackName };
}

// shows: TF-IDF over artists, cosine, then a correction for "hub" shows that are a bit
// like everyone (CSLS: subtract how close each is to its own nearest neighbours)
function similarShows({ artistsOf, artistName }) {
  const shows = [...artistsOf].filter(([, am]) => [...am.values()].reduce((a, b) => a + b, 0) >= SHOW_MIN_PLAYS).map(([s]) => s);
  const df = new Map();
  for (const s of shows) for (const a of artistsOf.get(s).keys()) df.set(a, (df.get(a) || 0) + 1);
  const N = shows.length;
  const vec = new Map(), byArtist = new Map();
  for (const s of shows) {
    const v = new Map();
    for (const [a, c] of artistsOf.get(s)) if (df.get(a) >= 2) v.set(a, (1 + Math.log(c)) * Math.log(N / df.get(a)));
    const norm = Math.sqrt([...v.values()].reduce((x, y) => x + y * y, 0)) || 1;
    for (const [a, x] of v) { v.set(a, x / norm); let l = byArtist.get(a); if (!l) byArtist.set(a, (l = [])); l.push(s); }
    vec.set(s, v);
  }
  const cos = new Map();               // show -> Map(other -> cosine)
  for (const s of shows) {
    const acc = new Map();
    for (const [a, x] of vec.get(s)) for (const o of byArtist.get(a)) if (o !== s) acc.set(o, (acc.get(o) || 0) + x * vec.get(o).get(a));
    cos.set(s, acc);
  }
  const K = 10;
  const r = new Map(shows.map((s) => [s, [...cos.get(s).values()].sort((a, b) => b - a).slice(0, K).reduce((a, b) => a + b, 0) / K]));
  const res = {};
  for (const s of shows) {
    const near = [...cos.get(s)].filter(([, c]) => c > 0.08)
      .map(([o, c]) => [o, 2 * c - r.get(s) - r.get(o)]).sort((a, b) => b[1] - a[1]).slice(0, KEEP_SHOWS);
    if (!near.length) continue;
    res[s] = near.map(([o]) => {
      const vs = vec.get(s), vo = vec.get(o);
      const both = [...vs.keys()].filter((a) => vo.has(a)).sort((a, b) => vs.get(b) * vo.get(b) - vs.get(a) * vo.get(a)).slice(0, 3);
      return [o, both.map((a) => artistName.get(a))];
    });
  }
  return res;
}

// tracks: shows in common, each show weighted 1/log(2 + tracks it played), cosine;
// a neighbour needs at least two shows in common, so one DJ's taste isn't the whole story
function similarTracks({ showsOf, trackName }) {
  const keys = [...showsOf].filter(([, ss]) => ss.size >= 2).map(([k]) => k);
  const played = new Map(), tracksOf = new Map();
  for (const k of keys) for (const s of showsOf.get(k)) {
    played.set(s, (played.get(s) || 0) + 1);
    let l = tracksOf.get(s); if (!l) tracksOf.set(s, (l = [])); l.push(k);
  }
  const w = (s) => 1 / Math.log(2 + played.get(s));
  const mass = new Map(keys.map((k) => [k, [...showsOf.get(k)].reduce((a, s) => a + w(s), 0)]));
  const main = (k) => n(splitArtists(trackName.get(k)[0])[0] || k.split('|')[0]);
  const res = {};
  for (const k of keys) {
    if (showsOf.get(k).size < TRACK_MIN_SHOWS) continue;
    const acc = new Map(), via = new Map();
    for (const s of showsOf.get(k)) for (const o of tracksOf.get(s)) {
      if (o === k) continue;
      acc.set(o, (acc.get(o) || 0) + w(s));
      let v = via.get(o); if (!v) via.set(o, (v = [])); v.push(s);
    }
    const me = main(k);
    const near = [...acc].filter(([o]) => via.get(o).length >= 2 && main(o) !== me)
      .map(([o, x]) => [o, x / Math.sqrt(mass.get(k) * mass.get(o))]).sort((a, b) => b[1] - a[1]);
    const seen = new Set(), out = [];
    for (const [o] of near) {                      // one track per artist
      const a = main(o);
      if (seen.has(a)) continue;
      seen.add(a);
      const byWeight = via.get(o).sort((a, b) => w(b) - w(a)).slice(0, 3);
      out.push([...trackName.get(o), byWeight]);
      if (out.length === KEEP_TRACKS) break;
    }
    if (out.length) res[k] = out;
  }
  return res;
}

// names and pictures for the shows mentioned (kept between runs, so each is looked up once)
async function showInfo(out, slugs, get) {
  const file = path.join(out, 'charts', 'show-info.json');
  let info = {};
  try { info = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
  const missing = slugs.filter((s) => !info[s]);
  let i = 0;
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (i < missing.length) {
      const s = missing[i++];
      const sh = await get(`https://www.nts.live/api/v2/shows/${s}`).catch(() => null);
      if (sh) info[s] = [sh.name || s, sh.media?.picture_small || ''];
    }
  }));
  fs.writeFileSync(file, JSON.stringify(info));
  return info;
}

async function write(out, get) {
  const data = load(out);
  if (!data) { console.log('similar: no tracklists in taste/ yet'); return; }
  const shows = similarShows(data);
  const tracks = similarTracks(data);
  const slugs = new Set(Object.keys(shows));
  for (const l of Object.values(shows)) l.forEach(([o]) => slugs.add(o));
  for (const l of Object.values(tracks)) l.forEach(([, , via]) => via.forEach((s) => slugs.add(s)));
  const all = get ? await showInfo(out, [...slugs], get) : {};
  const info = {};
  for (const s of slugs) if (all[s]) info[s] = all[s];
  const res = { v: 1, generated: Date.now(), months: [data.months[0], data.months[data.months.length - 1]], shows, tracks, info };
  fs.writeFileSync(path.join(out, 'charts', 'similar.json'), JSON.stringify(res));
  console.log(`similar: ${Object.keys(shows).length} shows, ${Object.keys(tracks).length} tracks, from ${data.months.length} months`);
}

module.exports = { write, load, similarShows, similarTracks };
if (require.main === module) {
  const i = process.argv.indexOf('--out');
  write(i > 0 ? process.argv[i + 1] : path.join(__dirname, '..', 'data'), (u) => fetch(u, { headers: { Accept: 'application/json' } }).then((r) => (r.ok ? r.json() : null)))
    .catch((e) => { console.error(e); process.exit(1); });
}
