// Most played on NTS: charts worked out once a day by the Charts workflow
// (scripts/build-charts.js) and published to the repo's data branch. The app only
// downloads the small files (main.js caches them) and ranks/merges what's in them.
// Periods: 'recent' (the last 30 days) or a month 'YYYY-MM'. A year merges its months.

const Chart = (() => {
  const n = (x) => String(x || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  const key = (a, t) => `${n(a)}|${n(t)}`;
  const ym = (d) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  const shift = (m, k) => ym(new Date(Date.UTC(+m.slice(0, 4), +m.slice(5) - 1 + k, 1)));
  const showName = (alias) => alias.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  const CATCH_ALL = /^(guests|dancing-\d{4}|nts-guests|supporter-radio.*)$/;
  // ...and NTS's Supporter Radio specials, whose addresses change but whose names don't
  const catchAll = (alias, names) => CATCH_ALL.test(alias) || /^supporter radio/i.test((names?.[alias] || [])[0] || '');
  const mem = new Map();          // period -> result
  const loading = new Map();

  // One file's tracks as chart rows (most played first)
  function rowsOf(data, limit = 100) {
    const shows = data.showList;
    return data.tracks.filter((t) => t[2] >= 2).slice(0, limit).map(([artist, title, episodes, idx, l]) => ({
      artist, title, episodes, shows: idx.length,
      latest: { show: shows[l[0]], episode: l[1], offset: l[2], d: l[3], title: (data.names?.[shows[l[0]]] || [])[0] || showName(shows[l[0]]) }
    }));
  }
  async function load(period) {
    const data = await window.nts.chart(period).catch(() => null);
    if (!data) return null;
    const res = { period, data, rows: rowsOf(data), episodes: data.episodes, generated: data.generated, map: new Map() };
    // track -> { shows, rank } (rank among tracks played in 2+ episodes)
    let rank = 0;
    for (const t of data.tracks) res.map.set(key(t[0], t[1]), { shows: t[3].length, rank: t[2] >= 2 ? ++rank : null });
    mem.set(period, res);
    return res;
  }
  function get(period) {
    // remember a download for a minute (several parts of the page ask at once); never a failure
    if (!loading.has(period)) {
      loading.set(period, load(period).then((r) => {
        if (r) setTimeout(() => loading.delete(period), 60000); else loading.delete(period);
        return r;
      }));
    }
    return loading.get(period);
  }
  const peek = (period) => mem.get(period) || null;

  // Months with data, newest first
  async function months() {
    const idx = await window.nts.chart('index').catch(() => null);
    return idx?.months || [];
  }

  // ---- trends ----
  // The month a period is "in" (the last 30 days count as this month)
  const monthOf = (period) => (period === 'recent' ? ym(new Date()) : period);
  // For a period: the months before it (up to `count`, ending with it) and the month to
  // compare chart movement against
  async function trend(period, count = 12) {
    const have = new Set(await months());
    const end = monthOf(period);
    const list = [];
    for (let i = count - 1; i >= 0; i--) list.push(shift(end, -i));
    const files = await Promise.all(list.map((m) => (have.has(m) ? get(m) : null)));
    const prevMonth = period === 'recent' ? shift(end, -1) : shift(end, -1);
    const prev = have.has(prevMonth) ? await get(prevMonth) : null;
    return {
      months: list,
      // shows per month for a track (null where there's no data for that month)
      series: (t) => files.map((f) => (f ? (f.map.get(key(t.artist, t.title))?.shows || 0) : null)),
      // chart movement: rank last month, or null if it wasn't in the chart
      prevRank: (t) => (prev ? prev.map.get(key(t.artist, t.title))?.rank ?? null : undefined)
    };
  }

  // ---- a year: its months merged ----
  async function year(y) {
    const list = (await months()).filter((m) => m.startsWith(`${y}-`)).sort();
    const files = (await Promise.all(list.map((m) => get(m)))).filter(Boolean).map((r) => r.data);
    if (!files.length) return null;
    const tracks = new Map();
    const showEps = new Map();
    const names = {};
    let episodes = 0, plays = 0;
    const numberOnes = [];
    const debuts = [];
    for (const f of files) {
      episodes += f.episodes; plays += f.plays;
      Object.assign(names, f.names || {});
      (f.showEps || f.busiest || []).forEach(([s, c]) => showEps.set(s, (showEps.get(s) || 0) + c));
      debuts.push(...(f.debuts || []).map((s) => ({ show: s, month: f.period })));
      const top = rowsOf(f, 1)[0];
      if (top) numberOnes.push({ month: f.period, ...top });
      for (const [artist, title, e, idx, l, first] of f.tracks) {
        const k = `${n(artist)}|${n(title)}`;
        let m = tracks.get(k);
        if (!m) { m = { artist, title, episodes: 0, showSet: new Set(), monthSet: new Set(), perMonth: {}, latest: null, first }; tracks.set(k, m); }
        m.perMonth[f.period] = idx.length;
        m.episodes += e;
        idx.forEach((i) => m.showSet.add(f.showList[i]));
        m.monthSet.add(f.period);
        m.first = Math.min(m.first, first);
        const lat = { show: f.showList[l[0]], episode: l[1], offset: l[2], d: l[3] };
        if (!m.latest || lat.d > m.latest.d) m.latest = lat;
      }
    }
    const all = [...tracks.values()].map(({ showSet, monthSet, ...m }) => ({ ...m, shows: showSet.size, showSet, months: monthSet.size }))
      .filter((m) => m.episodes >= 2)
      .sort((a, b) => b.shows - a.shows || b.episodes - a.episodes);
    all.forEach((m) => { m.latest.title = (names[m.latest.show] || [])[0] || showName(m.latest.show); });
    // artists: across their tracks (split "A, B & C" into each artist)
    const artists = new Map();
    for (const m of all) {
      for (const a of String(m.artist).split(/\s*(?:,|&|\bx\b|\bfeat\.?|\bft\.?|\band\b)\s*/i).map((s) => s.trim()).filter(Boolean)) {
        const k = n(a);
        if (!k) continue;
        let r = artists.get(k);
        if (!r) { r = { artist: a, showSet: new Set(), tracks: 0, top: m }; artists.set(k, r); }
        m.showSet.forEach((s) => r.showSet.add(s));
        r.tracks++;
      }
    }
    const topArtists = [...artists.values()].map((r) => ({ artist: r.artist, shows: r.showSet.size, tracks: r.tracks, top: r.top }))
      .sort((a, b) => b.shows - a.shows || b.tracks - a.tracks).slice(0, 10);
    // tracks first played this year that the most shows picked up
    const yearStart = Date.UTC(y, 0, 1);
    const breakouts = all.filter((m) => m.first >= yearStart + 14 * 864e5).slice(0, 5);
    // played in every month so far
    const evergreen = all.filter((m) => m.months === files.length && files.length >= 3).slice(0, 5);
    // shows that shared the most tracks
    const pairs = new Map();
    for (const m of all.slice(0, 3000)) {
      const s = [...m.showSet].filter((x) => !CATCH_ALL.test(x)).sort();
      if (s.length < 2 || s.length > 12) continue;
      for (let i = 0; i < s.length; i++) for (let j = i + 1; j < s.length; j++) { const k = `${s[i]}|${s[j]}`; pairs.set(k, (pairs.get(k) || 0) + 1); }
    }
    const topPair = [...pairs].sort((a, b) => b[1] - a[1])[0];
    const busiest = [...showEps].filter(([s]) => !catchAll(s, names)).sort((a, b) => b[1] - a[1]).slice(0, 5)
      .map(([show, count]) => ({ show, count, name: (names[show] || [])[0] || showName(show), img: (names[show] || [])[1] || '' }));
    const peak = files.slice().sort((a, b) => b.episodes - a.episodes)[0];
    // each month's ranks, for the bump chart and the timeline
    const monthRanks = {};
    const monthFiles = (await Promise.all(list.map((mm) => get(mm)))).filter(Boolean);
    monthFiles.forEach((r) => { monthRanks[r.period] = r.map; });
    // shows that shared tracks: the strongest links, for the network
    const links = [...pairs].filter(([, c]) => c >= 3).sort((a, b) => b[1] - a[1]).slice(0, 60)
      .map(([k, c]) => ({ a: k.split('|')[0], b: k.split('|')[1], count: c }));
    all.forEach((m) => { delete m.showSet; });
    const realDebuts = debuts.filter((d) => !catchAll(d.show, names));
    return {
      year: y, months: files.length, complete: files.length === 12 && files.every((f) => f.complete),
      episodes, plays, shows: showEps.size, uniqueTracks: files.reduce((s, f) => s + f.uniqueTracks, 0),
      top: all.slice(0, 100), topArtists, numberOnes, breakouts, evergreen, busiest,
      debuts: realDebuts.map((d) => ({ ...d, name: (names[d.show] || [])[0] || showName(d.show), img: (names[d.show] || [])[1] || '' })),
      pair: topPair ? { a: topPair[0].split('|')[0], b: topPair[0].split('|')[1], count: topPair[1], names } : null,
      peak: peak ? { month: peak.period, episodes: peak.episodes } : null,
      monthList: list, monthRanks, links, names,
      monthTop: monthFiles.map((r) => ({ month: r.period, rows: r.rows.slice(0, 5) }))
    };
  }

  // A small line of shows per month (gaps where a month has no data)
  function spark(series, { w = 64, h = 18 } = {}) {
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('class', 'spark'); svg.setAttribute('width', w); svg.setAttribute('height', h);
    svg.setAttribute('viewBox', `0 0 ${w} ${h}`); svg.setAttribute('aria-hidden', 'true');
    const max = Math.max(1, ...series.filter((v) => v != null));
    const x = (i) => (series.length < 2 ? w / 2 : 1 + (i * (w - 2)) / (series.length - 1));
    const y = (v) => h - 2 - (v / max) * (h - 4);
    let d = '', pen = false;
    series.forEach((v, i) => { if (v == null) { pen = false; return; } d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`; pen = true; });
    const base = document.createElementNS(NS, 'line');
    base.setAttribute('x1', 1); base.setAttribute('x2', w - 1); base.setAttribute('y1', h - 2); base.setAttribute('y2', h - 2); base.setAttribute('class', 'spark__base');
    const path = document.createElementNS(NS, 'path'); path.setAttribute('d', d); path.setAttribute('class', 'spark__line');
    svg.append(base, path);
    const last = series.length - 1;
    if (series[last] != null) { const c = document.createElementNS(NS, 'circle'); c.setAttribute('cx', x(last)); c.setAttribute('cy', y(series[last])); c.setAttribute('r', 1.8); c.setAttribute('class', 'spark__dot'); svg.append(c); }
    return svg;
  }

  return { get, peek, months, year, trend, spark, showName, key, shift,
    reset() { mem.clear(); loading.clear(); } };      // tests
})();
