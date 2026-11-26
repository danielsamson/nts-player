// Most played on NTS: charts worked out once a day by the Charts workflow
// (scripts/build-charts.js) and published to the repo's data branch. The app only
// downloads the small files (main.js caches them) and ranks/merges what's in them.
// Periods: 'recent' (the last 30 days) or a month 'YYYY-MM'. A year merges its months.

const Chart = (() => {
  const n = (x) => String(x || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  const showName = (alias) => alias.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  const CATCH_ALL = /^(guests|dancing-\d{4}|nts-guests)$/;
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
    const res = { period, data, rows: rowsOf(data), episodes: data.episodes, generated: data.generated };
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
        if (!m) { m = { artist, title, episodes: 0, showSet: new Set(), monthSet: new Set(), latest: null, first }; tracks.set(k, m); }
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
    const busiest = [...showEps].filter(([s]) => !CATCH_ALL.test(s)).sort((a, b) => b[1] - a[1]).slice(0, 5)
      .map(([show, count]) => ({ show, count, name: (names[show] || [])[0] || showName(show), img: (names[show] || [])[1] || '' }));
    const peak = files.slice().sort((a, b) => b.episodes - a.episodes)[0];
    all.forEach((m) => { delete m.showSet; });
    return {
      year: y, months: files.length, complete: files.length === 12 && files.every((f) => f.complete),
      episodes, plays, shows: showEps.size, uniqueTracks: files.reduce((s, f) => s + f.uniqueTracks, 0),
      top: all.slice(0, 100), topArtists, numberOnes, breakouts, evergreen, busiest,
      debuts: debuts.map((d) => ({ ...d, name: (names[d.show] || [])[0] || showName(d.show), img: (names[d.show] || [])[1] || '' })),
      pair: topPair ? { a: topPair[0].split('|')[0], b: topPair[0].split('|')[1], count: topPair[1], names } : null,
      peak: peak ? { month: peak.period, episodes: peak.episodes } : null
    };
  }

  return { get, peek, months, year, showName };
})();
