// The NTS map: every show placed so that shows that play alike sit together, grouped into
// zones (broad ones, and finer ones inside them when you zoom in). Written to charts/map.json:
//   shows: [[slug, x, y, zone, subzone, weight]]     x, y in 0..1; weight ~ how much it played
//   zones: [[x, y, [artists that define it], shows]]    broad zones
//   subs:  [[x, y, [artists], shows, zone]]             finer zones
//   links: [[i, j]]                                    each show to its nearest few (indexes into shows)
// Each day's layout starts from yesterday's, so the map settles rather than reshuffles.
const fs = require('fs');
const path = require('path');
const { showVectors, cosines } = require('./similar');

const K = 10;                 // neighbours per show in the graph

// a small seeded random, so a fresh layout is the same every time
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

// Louvain community detection: groups of shows more linked to each other than to the rest
function louvain(nodes, edges, gamma) {
  let g = { nodes, edges };
  let members = new Map(nodes.map((n) => [n, [n]]));
  for (let level = 0; level < 12; level++) {
    const deg = new Map(g.nodes.map((n) => [n, [...g.edges.get(n).values()].reduce((a, b) => a + b, 0)]));
    const m2 = [...deg.values()].reduce((a, b) => a + b, 0) || 1;
    const c = new Map(g.nodes.map((n) => [n, n])), tot = new Map(deg);
    let moved = true, any = false, rounds = 0;
    while (moved && rounds++ < 50) {
      moved = false;
      for (const n of g.nodes) {
        const cn = c.get(n), kn = deg.get(n), links = new Map();
        for (const [o, w] of g.edges.get(n)) if (o !== n) links.set(c.get(o), (links.get(c.get(o)) || 0) + w);
        tot.set(cn, tot.get(cn) - kn);
        let best = cn, gain = (links.get(cn) || 0) - gamma * tot.get(cn) * kn / m2;
        for (const [cc, w] of links) { const x = w - gamma * tot.get(cc) * kn / m2; if (x > gain + 1e-12) { best = cc; gain = x; } }
        tot.set(best, tot.get(best) + kn);
        if (best !== cn) { c.set(n, best); moved = true; any = true; }
      }
    }
    if (!any) break;
    const next = new Map();
    for (const n of g.nodes) { const k = c.get(n); if (!next.has(k)) next.set(k, []); next.get(k).push(...members.get(n)); }
    const ne = new Map([...next.keys()].map((k) => [k, new Map()]));
    for (const n of g.nodes) for (const [o, w] of g.edges.get(n)) { const a = c.get(n), b = c.get(o); ne.get(a).set(b, (ne.get(a).get(b) || 0) + w); }
    members = next; g = { nodes: [...next.keys()], edges: ne };
  }
  return [...members.values()].sort((a, b) => b.length - a.length);
}

// force layout: linked shows pull together, everyone pushes apart a little (grid, so it's quick)
function layout(n, edges, pos, { iters, temp }) {
  const k = 0.6 / Math.sqrt(n);            // ideal distance: small, so zones clump into islands
  const cell = k * 3;
  for (let it = 0; it < iters; it++) {
    const t = temp * (1 - it / iters) + 0.002;
    const dx = new Float64Array(n), dy = new Float64Array(n);
    const grid = new Map();
    for (let i = 0; i < n; i++) { const key = `${Math.floor(pos[i][0] / cell)},${Math.floor(pos[i][1] / cell)}`; let l = grid.get(key); if (!l) grid.set(key, (l = [])); l.push(i); }
    for (let i = 0; i < n; i++) {
      const gx = Math.floor(pos[i][0] / cell), gy = Math.floor(pos[i][1] / cell);
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (const j of grid.get(`${gx + a},${gy + b}`) || []) {
        if (j === i) continue;
        let x = pos[i][0] - pos[j][0], y = pos[i][1] - pos[j][1];
        const d2 = x * x + y * y + 1e-9;
        if (d2 > cell * cell) continue;
        const f = (k * k) / d2;
        dx[i] += x * f; dy[i] += y * f;
      }
    }
    for (const [i, j, w] of edges) {
      const x = pos[i][0] - pos[j][0], y = pos[i][1] - pos[j][1];
      const d = Math.sqrt(x * x + y * y) + 1e-9;
      const f = (d / k) * w;
      dx[i] -= x * f; dy[i] -= y * f; dx[j] += x * f; dy[j] += y * f;
    }
    for (let i = 0; i < n; i++) {
      // a gentle pull to the middle keeps stray shows on the map
      dx[i] -= (pos[i][0] - 0.5) * 0.02 / k; dy[i] -= (pos[i][1] - 0.5) * 0.02 / k;
      const d = Math.sqrt(dx[i] * dx[i] + dy[i] * dy[i]) + 1e-9;
      const m = Math.min(d, t);
      pos[i][0] += (dx[i] / d) * m; pos[i][1] += (dy[i] / d) * m;
    }
  }
}

function build(data, prev) {
  const { shows, vec, byArtist } = showVectors(data);
  const cos = cosines({ shows, vec, byArtist });
  const idx = new Map(shows.map((s, i) => [s, i]));
  // graph: each show to its K nearest, symmetric
  const adj = new Map(shows.map((s) => [s, new Map()]));
  for (const s of shows) for (const [o, c] of [...cos.get(s)].sort((a, b) => b[1] - a[1]).slice(0, K)) {
    adj.get(s).set(o, Math.max(adj.get(s).get(o) || 0, c));
    adj.get(o).set(s, Math.max(adj.get(o).get(s) || 0, c));
  }
  const zones = louvain(shows, adj, 1);
  // finer zones, found inside each zone so they sit on its island
  const subs = [];
  for (const z of zones) {
    const inZ = new Set(z);
    const sub = new Map(z.map((s) => [s, new Map([...adj.get(s)].filter(([o]) => inZ.has(o)))]));
    const parts = z.length >= 12 ? louvain(z, sub, 1.4) : [z];
    // tiny leftovers join the part they're most linked to
    const big = parts.filter((p) => p.length >= 4), small = parts.filter((p) => p.length < 4);
    if (!big.length) { subs.push(z); continue; }
    for (const p of small) for (const s of p) {
      const score = big.map((b) => b.reduce((a, o) => a + (sub.get(s).get(o) || 0), 0));
      big[score.indexOf(Math.max(...score))].push(s);
    }
    subs.push(...big);
  }
  const zoneOf = new Map(), subOf = new Map();
  zones.forEach((z, i) => z.forEach((s) => zoneOf.set(s, i)));
  subs.forEach((z, i) => z.forEach((s) => subOf.set(s, i)));

  // start from yesterday's places; new shows start among their neighbours, or by their zone
  const was = new Map((prev?.shows || []).map(([s, x, y]) => [s, [x, y]]));
  const rand = rng(7);
  const edges = [];                    // for the faint lines between close shows
  for (const [s, m] of adj) for (const [o, w] of m) if (idx.get(s) < idx.get(o)) edges.push([idx.get(s), idx.get(o), w]);
  const mean = (ps) => [ps.reduce((a, p) => a + p[0], 0) / ps.length, ps.reduce((a, p) => a + p[1], 0) / ps.length];

  // 1. islands: each zone a round island sized by its shows; zones that share shows' taste sit closer
  const Z = zones.length;
  const zr = zones.map((z) => 0.42 * Math.sqrt(z.length / shows.length));
  const zw = Array.from({ length: Z }, () => new Float64Array(Z));
  for (const [s, m] of adj) for (const [o, w] of m) { const a = zoneOf.get(s), b = zoneOf.get(o); if (a !== b) zw[a][b] += w; }
  const zsum = zw.map((r) => r.reduce((a, b) => a + b, 0) || 1e-9);
  const aff = (i, j) => (zw[i][j] + zw[j][i]) / 2 / Math.sqrt(zsum[i] * zsum[j]);   // 0..1: how much two zones share
  const amax = Math.max(1e-9, ...zones.flatMap((_, i) => zones.map((_, j) => (i === j ? 0 : aff(i, j)))));
  const zc = zones.map((z, i) => {
    const old = z.map((s) => was.get(s)).filter(Boolean);
    if (old.length > z.length / 2) return mean(old);
    const a = (i / Z) * Math.PI * 2;
    return [0.5 + 0.35 * Math.cos(a), 0.5 + 0.35 * Math.sin(a)];
  });
  for (let it = 0; it < 1500; it++) {
    for (let i = 0; i < Z; i++) for (let j = i + 1; j < Z; j++) {
      const x = zc[j][0] - zc[i][0], y = zc[j][1] - zc[i][1], d = Math.sqrt(x * x + y * y) + 1e-9;
      const gap = zr[i] + zr[j] + 0.03;
      const want = gap + 0.35 * (1 - Math.sqrt(aff(i, j) / amax));     // close zones nearly touch
      const f = d < gap ? (gap - d) / 2 : (want - d) * 0.01;
      zc[i][0] -= (x / d) * f; zc[i][1] -= (y / d) * f; zc[j][0] += (x / d) * f; zc[j][1] += (y / d) * f;
    }
    for (const c of zc) { c[0] += (0.5 - c[0]) * 0.002; c[1] += (0.5 - c[1]) * 0.002; }
  }

  // 2. each island's shows, laid out on their own (sub-zones pull together), fitted to the island
  const pos = new Array(shows.length);
  zones.forEach((z, zi) => {
    const local = new Map(z.map((s, i) => [s, i]));
    const old = z.map((s) => was.get(s));
    const oldC = old.filter(Boolean).length ? mean(old.filter(Boolean)) : null;
    const p = z.map((s, i) => (old[i] && oldC ? [0.5 + (old[i][0] - oldC[0]) / (2.4 * zr[zi]), 0.5 + (old[i][1] - oldC[1]) / (2.4 * zr[zi])] : [0.5 + (rand() - 0.5) * 0.5, 0.5 + (rand() - 0.5) * 0.5]));
    const e = [];
    for (const s of z) for (const [o, w] of adj.get(s)) if (local.has(o) && local.get(s) < local.get(o)) e.push([local.get(s), local.get(o), w * (subOf.get(s) === subOf.get(o) ? 6 : 0.7)]);
    const fresh = old.filter(Boolean).length < z.length / 2;
    if (z.length > 1) layout(z.length, e, p, fresh ? { iters: 500, temp: 0.08 } : { iters: 120, temp: 0.01 });
    const c = mean(p);
    const far = p.map((q) => Math.hypot(q[0] - c[0], q[1] - c[1])).sort((a, b) => a - b)[Math.floor(p.length * 0.92)] || 1;
    z.forEach((s, i) => { pos[idx.get(s)] = [zc[zi][0] + ((p[i][0] - c[0]) / far) * zr[zi], zc[zi][1] + ((p[i][1] - c[1]) / far) * zr[zi]]; });
  });
  // fit to 0..1, keeping the shape
  const xs = pos.map((p) => p[0]), ys = pos.map((p) => p[1]);
  const lo = (a) => a.slice().sort((p, q) => p - q)[Math.floor(a.length * 0.005)], hi = (a) => a.slice().sort((p, q) => p - q)[Math.ceil(a.length * 0.995) - 1];
  const x0 = lo(xs), x1 = hi(xs), y0 = lo(ys), y1 = hi(ys), span = Math.max(x1 - x0, y1 - y0) || 1;
  const fit = (p) => [Math.min(1, Math.max(0, 0.05 + 0.9 * ((p[0] - x0) / span + (1 - (x1 - x0) / span) / 2))), Math.min(1, Math.max(0, 0.05 + 0.9 * ((p[1] - y0) / span + (1 - (y1 - y0) / span) / 2)))];
  const xy = pos.map(fit);
  const r3 = (v) => Math.round(v * 1000) / 1000;
  const weight = (s) => Math.round(Math.log(1 + [...data.tasteOf.get(s).values()].reduce((a, b) => a + b, 0)) * 10) / 10;
  // what defines a zone: artists played across many of its shows, and mostly there rather than everywhere
  const showsWith = new Map();
  for (const s of shows) for (const a of vec.get(s).keys()) showsWith.set(a, (showsWith.get(a) || 0) + 1);
  const defining = (members, n) => {       // artist keys, most defining first
    const c = new Map();
    for (const s of members) for (const a of vec.get(s).keys()) c.set(a, (c.get(a) || 0) + 1);
    return [...c].filter(([, k]) => k >= 2).map(([a, k]) => [a, k * Math.sqrt(k / showsWith.get(a))]).sort((a, b) => b[1] - a[1]).slice(0, n).map(([a]) => a);
  };
  const label = (members) => defining(members, 4).map((a) => data.artistName.get(a));

  // artists: the ones that define each zone and neighbourhood, and any played widely. Each lives
  // where it's played most: in that zone and neighbourhood, among the shows there that play it
  const pick = new Set();
  zones.forEach((z) => defining(z, 14).forEach((a) => pick.add(a)));
  subs.forEach((z) => defining(z, 6).forEach((a) => pick.add(a)));
  for (const [a, k] of showsWith) if (k >= 8) pick.add(a);
  const plays = (s, a) => data.artistsOf.get(s)?.get(a) || 0;
  const artists = [];
  for (const a of pick) {
    const by = byArtist.get(a) || [];
    if (by.length < 2) continue;
    const zc = new Map();
    for (const s of by) zc.set(zoneOf.get(s), (zc.get(zoneOf.get(s)) || 0) + plays(s, a));
    const zone = [...zc].sort((x, y) => y[1] - x[1])[0][0];
    const inZone = by.filter((s) => zoneOf.get(s) === zone);
    const sc = new Map();
    for (const s of inZone) sc.set(subOf.get(s), (sc.get(subOf.get(s)) || 0) + plays(s, a));
    const sub = [...sc].sort((x, y) => y[1] - x[1])[0][0];
    const home = inZone.filter((s) => subOf.get(s) === sub);
    const w = home.map((s) => plays(s, a) || 1), tw = w.reduce((x, y) => x + y, 0);
    const jit = rand() * Math.PI * 2;                    // a little off the shows, so they don't sit on top
    const x = home.reduce((acc, s, i) => acc + xy[idx.get(s)][0] * w[i], 0) / tw + Math.cos(jit) * 0.006;
    const y = home.reduce((acc, s, i) => acc + xy[idx.get(s)][1] * w[i], 0) / tw + Math.sin(jit) * 0.006;
    const top = by.slice().sort((p, q) => plays(q, a) - plays(p, a)).slice(0, 8).map((s) => idx.get(s));
    artists.push([data.artistName.get(a), r3(x), r3(y), zone, sub, by.length, top, a]);
  }
  artists.sort((p, q) => q[5] - p[5]);
  // spread them out: artists push apart until they don't sit on top of each other, while each is
  // held towards where its shows are (and kept off the shows themselves)
  {
    const home = artists.map((r) => [r[1], r[2]]);
    const gap = 0.016, cell = gap;
    for (let it = 0; it < 120; it++) {
      const grid = new Map();
      const put = (k, i) => { let l = grid.get(k); if (!l) grid.set(k, (l = [])); l.push(i); };
      artists.forEach((r, i) => put(`${Math.floor(r[1] / cell)},${Math.floor(r[2] / cell)}`, i));
      artists.forEach((r, i) => {
        const gx = Math.floor(r[1] / cell), gy = Math.floor(r[2] / cell);
        for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (const j of grid.get(`${gx + a},${gy + b}`) || []) {
          if (j <= i) continue;
          const o = artists[j], dx = o[1] - r[1], dy = o[2] - r[2], d = Math.hypot(dx, dy) || 1e-6;
          if (d >= gap) continue;
          const push = (gap - d) / 2 * 0.5;
          r[1] -= (dx / d) * push; r[2] -= (dy / d) * push; o[1] += (dx / d) * push; o[2] += (dy / d) * push;
        }
        r[1] += (home[i][0] - r[1]) * 0.02; r[2] += (home[i][1] - r[2]) * 0.02;
      });
    }
    artists.forEach((r) => { r[1] = r3(r[1]); r[2] = r3(r[2]); });
  }
  const ai = new Map(artists.map((r, i) => [r[7], i]));
  // each show's most played artists that are on the map
  const showArtists = shows.map((s) => [...(data.artistsOf.get(s) || [])].filter(([a]) => ai.has(a)).sort((p, q) => q[1] - p[1]).slice(0, 6).map(([a]) => ai.get(a)));

  // names: hand-written ones (zone-names.json) go to the zone sharing most of their artists
  let named = [];
  try { named = JSON.parse(fs.readFileSync(path.join(__dirname, 'zone-names.json'), 'utf8')).zones || []; } catch {}
  const nk = (x) => String(x || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  const pairs = [];
  zones.forEach((z, zi) => { const mine = new Set(defining(z, 40)); named.forEach((nm, ni) => { const k = nm.artists.filter((a) => mine.has(nk(a))).length; if (k >= 2) pairs.push([k, zi, ni]); }); });
  const zoneName = new Map(), used = new Set();
  for (const [, zi, ni] of pairs.sort((p, q) => q[0] - p[0])) if (!zoneName.has(zi) && !used.has(ni)) { zoneName.set(zi, named[ni]); used.add(ni); }
  const lead = (members, n) => defining(members, n).map((a) => data.artistName.get(a));
  // and neighbourhoods the same way, by the artists that define them and the artists who live there
  let nb = [];
  try { nb = JSON.parse(fs.readFileSync(path.join(__dirname, 'zone-names.json'), 'utf8')).neighbourhoods || []; } catch {}
  const subPairs = [];
  subs.forEach((z, si) => {
    const mine = new Set([...defining(z, 30), ...artists.filter((r) => r[4] === si).slice(0, 30).map((r) => r[7])]);
    nb.forEach((nm, ni) => { const k = nm.artists.filter((a) => mine.has(nk(a))).length; if (k >= 2) subPairs.push([k, si, ni]); });
  });
  const subName = new Map(), subUsed = new Set();
  for (const [, si, ni] of subPairs.sort((p, q) => q[0] - p[0])) if (!subName.has(si) && !subUsed.has(ni)) { subName.set(si, nb[ni].name); subUsed.add(ni); }
  const centre = (members) => { const p = members.map((s) => xy[idx.get(s)]); return [r3(p.reduce((a, q) => a + q[0], 0) / p.length), r3(p.reduce((a, q) => a + q[1], 0) / p.length)]; };
  const majority = (members) => { const c = new Map(); members.forEach((s) => c.set(zoneOf.get(s), (c.get(zoneOf.get(s)) || 0) + 1)); return [...c].sort((a, b) => b[1] - a[1])[0][0]; };
  return {
    v: 2, generated: Date.now(), months: [data.months[0], data.months[data.months.length - 1]],
    // [slug, x, y, zone, neighbourhood, weight, [its most played artists (indexes into artists)]]
    shows: shows.map((s, i) => [s, r3(xy[i][0]), r3(xy[i][1]), zoneOf.get(s), subOf.get(s), weight(s), showArtists[i]]),
    // [name, x, y, zone, neighbourhood, shows that play them, [the shows that play them most]]
    artists: artists.map((r) => r.slice(0, 7)),
    // [x, y, [defining artists], shows, name, line]
    zones: zones.map((z, i) => [...centre(z), label(z), z.length, zoneName.get(i)?.name || `Around ${lead(z, 2).join(' & ')}`, zoneName.get(i)?.line || '']),
    // [x, y, [defining artists], shows, zone, name]
    subs: subs.map((z, i) => [...centre(z), label(z), z.length, majority(z), subName.get(i) || `Around ${lead(z, 1)[0] || 'here'}`]),
    links: edges.filter(([, , w]) => w > 0.3).map(([i, j]) => [i, j])
  };
}

function write(out, data, info) {
  const file = path.join(out, 'charts', 'map.json');
  let prev = null;
  try { prev = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
  const map = build(data, prev?.v >= 1 ? prev : null);
  map.info = {};
  for (const [s] of map.shows) if (info[s]) map.info[s] = info[s];
  map.active = [...data.active].filter((s) => map.info[s]);
  fs.writeFileSync(file, JSON.stringify(map));
  console.log(`map: ${map.shows.length} shows, ${map.artists.length} artists, ${map.zones.length} zones (${map.zones.map((z) => z[4]).join('; ')}), ${map.subs.length} neighbourhoods`);
}

module.exports = { build, write, louvain };
