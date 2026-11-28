// Similar shows, tracks and artists, worked out from every tracklist the charts build keeps in
// taste/ (one file per month, every year back to 2016). Keys match the app's Chart.key.
// charts/similar.json:
//   shows:  slug -> [[similar show, [artists both play]], ...]   (recent years count for more)
//   active: shows that broadcast in the last year (the only ones Home suggests)
//   info:   slug -> [name, picture] for every show mentioned
// charts/artists-<first two letters>.json (small, loaded as needed):
//   artists: artist -> where they're played, who else, their tracks
//   tracks:  "artist|title" -> [[artist, title, [shows that play both]], ...]
// Shows are alike when they play the same artists, weighted so that artists everyone plays
// count for little. Tracks are alike when the same shows play them, weighted so that shows
// that play a bit of everything count for little.
const fs = require('fs');
const path = require('path');

const HALF_LIFE = 36;           // months: a show's plays from three years ago count half for its profile
const SHOW_MIN_PLAYS = 40;     // plays a show needs before it gets a profile
const TRACK_MIN_SHOWS = 3;     // shows a track needs before it gets neighbours
const KEEP_SHOWS = 8, KEEP_TRACKS = 6;
// shows that are a different guest every time, or play everything: they don't say much about taste
// (yearly specials have the year in the address: dancing-2026, Supporter Radio's peace-2025)
const MIXED = /^(guests|nts-guests|supporter-radio.*|your-specialist-subject.*|coming-of-age.*|nts-.*-takeover.*|.*-\d{4})$/;
const n = (x) => String(x || '').toLowerCase().replace(/ø/g, 'o').replace(/æ/g, 'ae').replace(/ß/g, 'ss').normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const splitArtists = (a) => String(a || '').split(/\s*(?:,|&|\bx\b|\bfeat\.?|\bft\.?|\band\b)\s*/i).map((s) => s.trim()).filter(Boolean);
// "Duval Timothy, CJ Mirra" is two artists, "Simon & Garfunkel" and "Earth, Wind & Fire" are one:
// split a credit where at least two of its names are artists in their own right (3+ tracks alone), and
// the credit as a whole isn't far more common than they are (there's a band called Earth, but EW&F is the
// name). feat. always splits
function artistSplitter(solo, whole) {
  const memo = new Map();
  return (credit) => {
    if (memo.has(credit)) return memo.get(credit);
    const out = [];
    for (const piece of String(credit || '').split(/\s+(?:feat\.?|ft\.?|featuring)\s+/i)) {
      const parts = splitArtists(piece);
      const known = parts.map((x) => solo.get(n(x)) || 0).filter((c) => c >= 3);
      if (parts.length > 1 && !solo.has(n(piece)) && known.length >= 2 && (whole.get(n(piece)) || 0) < 3 * Math.min(...known)) out.push(...parts);
      else if (piece.trim()) out.push(piece.trim());
    }
    memo.set(credit, out);
    return out;
  };
}
const NOT_ARTISTS = new Set(['excerpt', 'excerpts', 'dialogue', 'interview', 'intro', 'outro', 'speech', 'spoken word', 'jingle', 'ident', 'nts', 'nts radio', 'traditional', 'trad', 'anonymous', 'field recording', 'field recordings', 'guest', 'guests', 'unknown', 'unknown artist', 'various', 'various artists']);

function load(out) {
  const dir = path.join(out, 'taste');
  if (!fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir).filter((f) => /^\d{4}-\d{2}\.json$/.test(f)).sort().reverse();
  if (!files.length) return null;
  const monthNo = (f) => +f.slice(0, 4) * 12 + +f.slice(5, 7);
  const newest = monthNo(files[0]);
  const artistsOf = new Map();         // show -> Map(artist key -> plays)
  const tasteOf = new Map();           // show -> Map(artist key -> plays, recent ones counting more)
  const lastDay = new Map();           // show -> last day it broadcast
  const artistName = new Map();        // artist key -> how it's written most
  const showsOf = new Map();           // track key -> Set(show)
  const trackName = new Map();
  // first, every credit as written, to tell bands from collaborations
  const solo = new Map(), whole = new Map();          // credit -> tracks credited exactly so
  const docs = files.map((f) => {
    const d = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    for (const [artist] of d.tracks) {
      const k = n(artist);
      const m = /,|&|\bx\b|\bfeat|\bft\b|\band\b/i.test(artist) ? whole : solo;
      m.set(k, (m.get(k) || 0) + 1);
    }
    return [f, d];
  });
  const creditsOf = artistSplitter(solo, whole);
  const together = new Map();          // artist key -> Set(artists credited on the same track)
  for (const [f, d] of docs) {
    const wt = 0.5 ** ((newest - monthNo(f)) / HALF_LIFE);
    for (const [si, day, list] of d.eps) {
      const s = d.showList[si];
      if (MIXED.test(s)) continue;
      if (!(lastDay.get(s) >= day)) lastDay.set(s, day);
      let am = artistsOf.get(s);
      if (!am) artistsOf.set(s, (am = new Map()));
      let tm = tasteOf.get(s);
      if (!tm) tasteOf.set(s, (tm = new Map()));
      for (const ti of new Set(list)) {
        const [artist, title] = d.tracks[ti];
        const k = `${n(artist)}|${n(title)}`;
        if (!trackName.has(k)) trackName.set(k, [artist, title]);
        let ss = showsOf.get(k);
        if (!ss) showsOf.set(k, (ss = new Set()));
        ss.add(s);
        const credited = creditsOf(artist);
        if (credited.length > 1) for (const a of credited) {
          let t = together.get(n(a)); if (!t) together.set(n(a), (t = new Set()));
          credited.forEach((b) => { if (b !== a) t.add(n(b)); });
        }
        for (const a of credited) {
          const ak = n(a);
          if (!ak || NOT_ARTISTS.has(ak)) continue;
          am.set(ak, (am.get(ak) || 0) + 1);
          tm.set(ak, (tm.get(ak) || 0) + wt);
          if (!artistName.has(ak)) artistName.set(ak, a);
        }
      }
    }
  }
  const latest = Math.max(...lastDay.values());
  const active = new Set([...lastDay].filter(([, d]) => d > latest - 365).map(([s]) => s));
  return { months: files.map((f) => f.slice(0, 7)).sort(), artistsOf, tasteOf, active, artistName, showsOf, trackName, creditsOf, together };
}

// shows: TF-IDF over artists, cosine, then a correction for "hub" shows that are a bit
// like everyone (CSLS: subtract how close each is to its own nearest neighbours)
// each show as a unit vector over artists (TF-IDF): byArtist lists the shows that play each artist
function showVectors({ tasteOf: artistsOf }) {
  const shows = [...artistsOf].filter(([, am]) => [...am.values()].reduce((a, b) => a + b, 0) >= SHOW_MIN_PLAYS).map(([s]) => s);
  const df = new Map();
  for (const s of shows) for (const a of artistsOf.get(s).keys()) df.set(a, (df.get(a) || 0) + 1);
  const N = shows.length;
  const vec = new Map(), byArtist = new Map();
  for (const s of shows) {
    const v = new Map();
    for (const [a, c] of artistsOf.get(s)) if (df.get(a) >= 2) v.set(a, Math.log(1 + c) * Math.log(N / df.get(a)));
    const norm = Math.sqrt([...v.values()].reduce((x, y) => x + y * y, 0)) || 1;
    for (const [a, x] of v) { v.set(a, x / norm); let l = byArtist.get(a); if (!l) byArtist.set(a, (l = [])); l.push(s); }
    vec.set(s, v);
  }
  return { shows, vec, byArtist };
}
// cosine of every show with the shows it shares an artist with
function cosines({ shows, vec, byArtist }) {
  const cos = new Map();               // show -> Map(other -> cosine)
  for (const s of shows) {
    const acc = new Map();
    for (const [a, x] of vec.get(s)) for (const o of byArtist.get(a)) if (o !== s) acc.set(o, (acc.get(o) || 0) + x * vec.get(o).get(a));
    cos.set(s, acc);
  }
  return cos;
}

function similarShows(data) {
  const { artistName } = data;
  const { shows, vec, byArtist } = showVectors(data);
  const cos = cosines({ shows, vec, byArtist });
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
function similarTracks({ showsOf, trackName, creditsOf }) {
  const keys = [...showsOf].filter(([, ss]) => ss.size >= 2).map(([k]) => k);
  const played = new Map(), tracksOf = new Map();
  for (const k of keys) for (const s of showsOf.get(k)) {
    played.set(s, (played.get(s) || 0) + 1);
    let l = tracksOf.get(s); if (!l) tracksOf.set(s, (l = [])); l.push(k);
  }
  const w = (s) => 1 / Math.log(2 + played.get(s));
  const mass = new Map(keys.map((k) => [k, [...showsOf.get(k)].reduce((a, s) => a + w(s), 0)]));
  const main = (k) => n(creditsOf(trackName.get(k)[0])[0] || k.split('|')[0]);
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
      .map(([o, x]) => { const c = via.get(o).length; return [o, (x / Math.sqrt(mass.get(k) * mass.get(o))) * (c / (c + DAMP))]; }).sort((a, b) => b[1] - a[1]);
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

// artists: where they're played most, who else those shows play, their most played tracks.
// Written as charts/artists-<first two letters>.json, with the tracks whose artist starts the same
const ARTIST_MIN_SHOWS = 3;
let DAMP = 6;                          // how much more shows in common count (see artistPages)
const shard = (k) => `${k}__`.slice(0, 2).replace(/[0-9]/g, '0').replace(/[^a-z0]/g, '_');   // same in the app
function artistPages({ artistsOf, artistName, showsOf, trackName, creditsOf, together }) {
  const showsBy = new Map();           // artist -> Map(show -> plays)
  for (const [s, am] of artistsOf) for (const [a, c] of am) {
    let m = showsBy.get(a); if (!m) showsBy.set(a, (m = new Map())); m.set(s, c);
  }
  const keys = [...showsBy].filter(([, m]) => m.size >= ARTIST_MIN_SHOWS).map(([a]) => a);
  const keep = new Set(keys);
  const artistsIn = new Map();         // show -> artists it plays (only ones with pages)
  for (const a of keys) for (const s of showsBy.get(a).keys()) { let l = artistsIn.get(s); if (!l) artistsIn.set(s, (l = [])); l.push(a); }
  const w = new Map([...artistsIn].map(([s, l]) => [s, 1 / Math.log(2 + l.length)]));
  const mass = new Map(keys.map((a) => [a, [...showsBy.get(a).keys()].reduce((x, s) => x + w.get(s), 0)]));
  // tracks by artist: how many shows played each
  const tracksBy = new Map();
  for (const [k, ss] of showsOf) {
    const [artist, title] = trackName.get(k);
    for (const part of creditsOf(artist)) {
      const a = n(part);
      if (!keep.has(a)) continue;
      let l = tracksBy.get(a); if (!l) tracksBy.set(a, (l = [])); l.push([artist, title, ss.size]);
    }
  }
  const out = {};
  for (const a of keys) {
    const mine = showsBy.get(a);
    const acc = new Map(), via = new Map();
    for (const s of mine.keys()) for (const o of artistsIn.get(s)) {
      if (o === a) continue;
      acc.set(o, (acc.get(o) || 0) + w.get(s));
      let v = via.get(o); if (!v) via.set(o, (v = [])); v.push(s);
    }
    const withThem = together.get(a);      // collaborators played them *with* them, not instead
    const own = new RegExp(`(^| )${a}( |$)`);   // "Duval Timothy & CJ Mirra" isn't a suggestion for Duval Timothy
    const like = [...acc].filter(([o]) => via.get(o).length >= 2 && !withThem?.has(o) && !own.test(o) && !new RegExp(`(^| )${o}( |$)`).test(a))
      // cosine favours artists on two or three shows that happen to overlap; more shows in common counts for more
      .map(([o, x]) => { const k = via.get(o).length; return [o, (x / Math.sqrt(mass.get(a) * mass.get(o))) * (k / (k + DAMP))]; }).sort((x, y) => y[1] - x[1]).slice(0, 8)
      .map(([o]) => [artistName.get(o), via.get(o).sort((x, y) => w.get(y) - w.get(x)).slice(0, 2)]);
    const top = [...mine].sort((x, y) => y[1] - x[1]).slice(0, 6);
    const tracks = (tracksBy.get(a) || []).sort((x, y) => y[2] - x[2]).slice(0, 6);
    (out[shard(a)] ||= {})[a] = { name: artistName.get(a), shows: mine.size, plays: [...mine.values()].reduce((x, y) => x + y, 0), top, like, tracks };
  }
  return out;
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
  const artists = artistPages(data);
  const slugs = new Set(Object.keys(shows));
  for (const part of Object.values(artists)) for (const x of Object.values(part)) {
    x.top.forEach(([s]) => slugs.add(s)); x.like.forEach(([, v]) => v.forEach((s) => slugs.add(s)));
  }
  for (const l of Object.values(shows)) l.forEach(([o]) => slugs.add(o));
  for (const l of Object.values(tracks)) l.forEach(([, , via]) => via.forEach((s) => slugs.add(s)));
  const all = get ? await showInfo(out, [...slugs], get) : {};
  const info = {};
  for (const s of slugs) if (all[s]) info[s] = all[s];
  const months = [data.months[0], data.months[data.months.length - 1]];
  const active = [...data.active].filter((s) => slugs.has(s));
  fs.writeFileSync(path.join(out, 'charts', 'similar.json'), JSON.stringify({ v: 2, generated: Date.now(), months, shows, active, info }));
  // artists and tracks, split by the first two letters of the artist
  const parts = {};
  for (const [k, part] of Object.entries(artists)) (parts[k] ||= { artists: {}, tracks: {} }).artists = part;
  for (const [k, near] of Object.entries(tracks)) (parts[shard(k)] ||= { artists: {}, tracks: {} }).tracks[k] = near;
  const written = new Set();
  for (const [k, p] of Object.entries(parts)) {
    const used = {};
    const add = (s) => { if (all[s]) used[s] = all[s]; };
    for (const x of Object.values(p.artists)) { x.top.forEach(([s]) => add(s)); x.like.forEach(([, v]) => v.forEach(add)); }
    for (const l of Object.values(p.tracks)) l.forEach(([, , v]) => v.forEach(add));
    const f = `artists-${k}.json`;
    fs.writeFileSync(path.join(out, 'charts', f), JSON.stringify({ v: 2, months, artists: p.artists, tracks: p.tracks, info: used }));
    written.add(f);
  }
  for (const f of fs.readdirSync(path.join(out, 'charts'))) if (/^artists-.+\.json$/.test(f) && !written.has(f)) fs.unlinkSync(path.join(out, 'charts', f));
  // the map: every show placed by what it plays (needs the show names and pictures, so here)
  const map = require('./map');
  const forMap = get ? await showInfo(out, showVectors(data).shows, get) : all;
  map.write(out, data, forMap);
  console.log(`artists: ${Object.values(artists).reduce((x, p) => x + Object.keys(p).length, 0)} pages`);
  console.log(`similar: ${Object.keys(shows).length} shows, ${Object.keys(tracks).length} tracks, from ${data.months.length} months`);
}

module.exports = { write, load, showVectors, cosines, similarShows, similarTracks, artistPages, shard, setDamp: (x) => { DAMP = x; } };
if (require.main === module) {
  const i = process.argv.indexOf('--out');
  write(i > 0 ? process.argv[i + 1] : path.join(__dirname, '..', 'data'), (u) => fetch(u, { headers: { Accept: 'application/json' } }).then((r) => (r.ok ? r.json() : null)))
    .catch((e) => { console.error(e); process.exit(1); });
}
