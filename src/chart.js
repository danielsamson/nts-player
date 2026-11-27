// Most played on NTS: charts worked out once a day by the Charts workflow
// (scripts/build-charts.js) and published to the repo's data branch. The app only
// downloads the small files (main.js caches them) and ranks/merges what's in them.
// Periods: 'recent' (the last 30 days) or a month 'YYYY-MM'. A year merges its months.

const Chart = (() => {
  const n = (x) => String(x || '').toLowerCase().replace(/ø/g, 'o').replace(/æ/g, 'ae').replace(/ß/g, 'ss').normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  const key = (a, t) => `${n(a)}|${n(t)}`;
  const ym = (d) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  const shift = (m, k) => ym(new Date(Date.UTC(+m.slice(0, 4), +m.slice(5) - 1 + k, 1)));
  const showName = (alias) => alias.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  const CATCH_ALL = /^(guests|dancing-\d{4}|nts-guests|supporter-radio.*)$/;
  // ...and NTS's Supporter Radio specials, whose addresses change but whose names don't
  const catchAll = (alias, names) => CATCH_ALL.test(alias) || /^supporter radio/i.test((names?.[alias] || [])[0] || '');
  const mem = new Map();          // period -> result
  const loading = new Map();

  // One file's tracks as chart rows (most played first). With a genre family ("housetechno"),
  // only plays in episodes tagged with it count: ranked by the shows that played it under it.
  function chartTracks(data, fam) {
    if (!fam) return data.tracks.filter((t) => t[2] >= 2).map((t) => ({ t, shows: t[3].length, episodes: t[2] }));
    const fi = (data.families || []).findIndex((f) => f[0] === fam);
    if (fi < 0) return [];
    // a family's shows: a list of show indexes (older files: just the number)
    return data.tracks.map((t) => { const g = (t[7] || []).find((x) => x[0] === fi); return g && g[2] >= 2 ? { t, shows: Array.isArray(g[1]) ? g[1].length : g[1], episodes: g[2] } : null; })
      .filter(Boolean).sort((a, b) => b.shows - a.shows || b.episodes - a.episodes);
  }
  function rowsOf(data, limit = 100, fam = null) {
    const shows = data.showList;
    return chartTracks(data, fam).slice(0, limit).map(({ t: [artist, title, , , l], shows: s, episodes }) => ({
      artist, title, episodes, shows: s,
      latest: { show: shows[l[0]], episode: l[1], offset: l[2], d: l[3], title: (data.names?.[shows[l[0]]] || [])[0] || showName(shows[l[0]]) }
    }));
  }
  // track -> { shows, rank } for a file, overall or within a genre family (remembered)
  function ranks(res, fam = null) {
    if (!fam) return res.map;
    res.famMaps ||= new Map();
    if (!res.famMaps.has(fam)) res.famMaps.set(fam, new Map(chartTracks(res.data, fam).map((x, i) => [key(x.t[0], x.t[1]), { shows: x.shows, rank: i + 1 }])));
    return res.famMaps.get(fam);
  }
  // The genre families a file has a chart for: [{ id, name, tracks }], most episodes first
  function families(res, min = 10) {
    return (res?.data.families || []).map(([id, name]) => ({ id, name, tracks: ranks(res, id).size })).filter((f) => f.tracks >= min);
  }
  const isYear = (p) => /^\d{4}$/.test(p);
  // A year's chart: its months' files merged into one, in the same shape (a show counts once
  // however many months it played the track in)
  async function mergedYear(y) {
    const list = (await months()).filter((m) => m.startsWith(`${y}-`)).sort();
    const files = (await Promise.all(list.map((m) => get(m)))).filter(Boolean).map((r) => r.data);
    if (!files.length) return null;
    const showList = [], si = new Map();
    const sIdx = (alias) => { if (!si.has(alias)) { si.set(alias, showList.length); showList.push(alias); } return si.get(alias); };
    const famEps = new Map(), famName = new Map();
    const withFams = files.every((f) => f.families);
    const tracks = new Map();
    for (const f of files) {
      (f.families || []).forEach(([id, name, e]) => { famEps.set(id, (famEps.get(id) || 0) + e); famName.set(id, name); });
      for (const t of f.tracks) {
        const k = key(t[0], t[1]);
        let m = tracks.get(k);
        if (!m) { m = { a: t[0], t: t[1], e: 0, shows: new Set(), latest: null, first: t[5], fams: new Map() }; tracks.set(k, m); }
        m.e += t[2];
        t[3].forEach((i) => m.shows.add(sIdx(f.showList[i])));
        if (!m.latest || t[4][3] > m.latest[3]) m.latest = [sIdx(f.showList[t[4][0]]), t[4][1], t[4][2], t[4][3]];
        m.first = Math.min(m.first, t[5]);
        for (const [fi, ss, e] of t[7] || []) {
          if (!Array.isArray(ss)) continue;                 // older files: no show lists to merge
          const id = f.families[fi][0];
          let g = m.fams.get(id);
          if (!g) { g = { shows: new Set(), e: 0 }; m.fams.set(id, g); }
          ss.forEach((i) => g.shows.add(sIdx(f.showList[i])));
          g.e += e;
        }
      }
    }
    const families = withFams ? [...famEps].sort((a, b) => b[1] - a[1]).map(([id, e]) => [id, famName.get(id), e]) : undefined;
    const fi = new Map((families || []).map(([id], i) => [id, i]));
    return {
      period: String(y), showList, families,
      episodes: files.reduce((a, f) => a + f.episodes, 0),
      names: Object.assign({}, ...files.map((f) => f.names || {})),
      tracks: [...tracks.values()].sort((a, b) => b.shows.size - a.shows.size || b.e - a.e)
        .map((m) => [m.a, m.t, m.e, [...m.shows], m.latest, m.first, [], [...m.fams].map(([id, g]) => [fi.get(id), [...g.shows], g.e])])
    };
  }
  async function load(period) {
    const data = isYear(period) ? await mergedYear(period) : await window.nts.chart(period).catch(() => null);
    if (!data) return null;
    const res = { period, data, rows: rowsOf(data), rowsFor: (fam, limit) => rowsOf(data, limit, fam), episodes: data.episodes, generated: data.generated, map: new Map() };
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
  // (a year: its last month so far)
  const monthOf = (period) => {
    if (period === 'recent') return ym(new Date());
    if (isYear(period)) { const now = ym(new Date()); return now.startsWith(period) ? now : `${period}-12`; }
    return period;
  };
  // For a period: the months before it (up to `count`, ending with it) and the month to
  // compare chart movement against
  async function trend(period, count = 12, fam = null) {
    const have = new Set(await months());
    const end = monthOf(period);
    if (isYear(period)) count = Number(end.slice(5));     // a year's sparkline: just its months
    const list = [];
    for (let i = count - 1; i >= 0; i--) list.push(shift(end, -i));
    const files = await Promise.all(list.map((m) => (have.has(m) ? get(m) : null)));
    const prevMonth = period === 'recent' ? shift(end, -1) : shift(end, -1);
    // (no movement for a year: there's no year before to compare with yet)
    const prev = !isYear(period) && have.has(prevMonth) ? await get(prevMonth) : null;
    return {
      months: list,
      // shows per month for a track (null where there's no data for that month)
      series: (t) => files.map((f) => (f && (!fam || f.data.families) ? (ranks(f, fam).get(key(t.artist, t.title))?.shows || 0) : null)),
      // chart movement: rank last month, or null if it wasn't in the chart
      prevRank: (t) => (prev && (!fam || prev.data.families) ? ranks(prev, fam).get(key(t.artist, t.title))?.rank ?? null : undefined)
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
    const showFams = new Map();          // show -> genre families it played tracks under
    const debuts = [];
    for (const f of files) {
      episodes += f.episodes; plays += f.plays;
      Object.assign(names, f.names || {});
      (f.showEps || f.busiest || []).forEach(([s, c]) => showEps.set(s, (showEps.get(s) || 0) + c));
      debuts.push(...(f.debuts || []).map((s) => ({ show: s, month: f.period })));
      const top = rowsOf(f, 1)[0];
      if (top) numberOnes.push({ month: f.period, ...top });
      let ri = 0;
      for (const [artist, title, e, idx, l, first, days, fams] of f.tracks) {
        const k = `${n(artist)}|${n(title)}`;
        let m = tracks.get(k);
        if (!m) { m = { artist, title, episodes: 0, showSet: new Set(), monthSet: new Set(), perMonth: {}, firstBy: new Map(), latest: null, first }; tracks.set(k, m); }
        if (days) idx.forEach((i, j) => { const s = f.showList[i]; if (!m.firstBy.has(s) || days[j] < m.firstBy.get(s)) m.firstBy.set(s, days[j]); });
        if (e >= 2) { const yr = f.years?.[ri]; if (yr) m.released = yr; ri++; }
        m.perMonth[f.period] = idx.length;
        m.monthShows ||= {};
        m.monthShows[f.period] = idx.map((i) => { const sh = f.showList[i]; return (f.names?.[sh] || [])[0] || showName(sh); });
        // genres it was played under (episodes per genre family), for tags
        if (fams && f.families) { m.genres ||= {}; fams.forEach(([fi, ss, ge]) => {
          const nm = f.families[fi]?.[1]; if (!nm) return;
          m.genres[nm] = (m.genres[nm] || 0) + ge;
          if (Array.isArray(ss)) ss.forEach((i) => { const sh = f.showList[i]; if (!showFams.has(sh)) showFams.set(sh, new Set()); showFams.get(sh).add(nm); });
        }); }
        m.episodes += e;
        idx.forEach((i) => m.showSet.add(f.showList[i]));
        m.monthSet.add(f.period);
        m.first = Math.min(m.first, first);
        const lat = { show: f.showList[l[0]], episode: l[1], offset: l[2], d: l[3] };
        // the episode to play it from: the latest one where we know when it was played, else the latest
        const timed = (x) => x && Number.isFinite(x.offset);
        if (!m.latest || (timed(lat) && !timed(m.latest)) || (lat.d > m.latest.d && (timed(lat) || !timed(m.latest)))) m.latest = lat;
      }
    }
    // a show named after the track (its theme tune, played every episode) isn't a long runner
    const slug = (x) => n(x).replace(/ /g, '-');
    const themeOf = (m) => [...m.showSet].find((sh) => { const t = slug(m.title); return t.length > 5 && (sh === t || sh.startsWith(t + '-') || sh.endsWith('-' + t)); });
    const all = [...tracks.values()].map(({ showSet, monthSet, ...m }) => ({ ...m, shows: showSet.size, showSet, months: monthSet.size, theme: themeOf({ ...m, showSet }) }))
      .filter((m) => m.episodes >= 2)
      .sort((a, b) => b.shows - a.shows || b.episodes - a.episodes);
    all.forEach((m) => {
      m.latest.title = (names[m.latest.show] || [])[0] || showName(m.latest.show);
      m.tags = Object.entries(m.genres || {}).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([g]) => g);
    });
    // number ones get their tags too
    const byKey = new Map(all.map((m) => [`${n(m.artist)}|${n(m.title)}`, m]));
    numberOnes.forEach((t) => { t.tags = byKey.get(`${n(t.artist)}|${n(t.title)}`)?.tags || []; });
    // artists: across their tracks (split "A, B & C" into each artist)
    const artists = new Map();
    for (const m of all) {
      for (const a of String(m.artist).split(/\s*(?:,|&|\bx\b|\bfeat\.?|\bft\.?|\band\b)\s*/i).map((s) => s.trim()).filter(Boolean)) {
        const k = n(a);
        if (!k) continue;
        let r = artists.get(k);
        if (!r) { r = { artist: a, showSet: new Set(), tracks: 0, top: m, list: [] }; artists.set(k, r); }
        if (r.list.length < 6) r.list.push(m);
        m.showSet.forEach((s) => r.showSet.add(s));
        r.tracks++;
      }
    }
    const topArtists = [...artists.values()].map((r) => ({ artist: r.artist, shows: r.showSet.size, tracks: r.tracks, top: r.top, list: r.list }))
      .sort((a, b) => b.shows - a.shows || b.tracks - a.tracks).slice(0, 10);
    // rising: first played in the last three months, most shows first (the top 10 already has
    // the year's big ones, so these are the ones still on the way up)
    const top10 = new Set(all.slice(0, 10));
    const lastMonth = list[list.length - 1];
    const riseFrom = Date.UTC(+lastMonth.slice(0, 4), +lastMonth.slice(5) - 3, 1);
    const breakouts = files.length >= 4 ? all.filter((m) => m.first >= riseFrom && !top10.has(m)).slice(0, 5) : [];
    breakouts.since = riseFrom;
    // long runners: played in most of the months (not just the busiest weeks)
    const minMonths = Math.max(4, Math.ceil(files.length * 0.4));     // NTS rarely repeats: 5 of 11 months is a long run
    const evergreen = files.length >= 4 ? all.filter((m) => m.months >= minMonths && !m.theme).sort((a, b) => b.months - a.months || b.shows - a.shows).slice(0, 5) : [];
    if (evergreen.length < 3) evergreen.length = 0;     // one or two isn't a story
    // shows that shared the most tracks
    const pairs = new Map();
    for (const m of all.slice(0, 3000)) {
      const s = [...m.showSet].filter((x) => !CATCH_ALL.test(x)).sort();
      if (s.length < 2 || s.length > 12) continue;
      for (let i = 0; i < s.length; i++) for (let j = i + 1; j < s.length; j++) { const k = `${s[i]}|${s[j]}`; pairs.set(k, (pairs.get(k) || 0) + 1); }
    }
    const topPair = [...pairs].sort((a, b) => b[1] - a[1])[0];
    // the tracks those two shows both played, most shows first
    const [pa, pb] = topPair ? topPair[0].split('|') : [];
    const pairTracks = topPair ? all.filter((m) => m.showSet.has(pa) && m.showSet.has(pb)).slice(0, 6) : [];
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
    // deep cuts: tracks one show kept coming back to that (almost) nobody else played
    const seenBy = new Set();
    const deepCuts = all.filter((m) => m.shows === 1 && m.episodes >= 3 && !m.theme && !catchAll([...m.showSet][0], names))
      .sort((a, b) => b.episodes - a.episodes)
      .filter((m) => { const sh = [...m.showSet][0]; if (seenBy.has(sh)) return false; seenBy.add(sh); return true; })      // one per show
      .slice(0, 5)
      .map((m) => ({ ...m, by: (names[[...m.showSet][0]] || [])[0] || showName([...m.showSet][0]) }));
    // the shows' characters
    const label = (sh) => (names[sh] || [])[0] || showName(sh);
    const perShow = new Map();           // show -> { solo, dated: [years], tracks: [track] }
    for (const m of tracks.values()) {
      for (const sh of m.showSet) {
        if (catchAll(sh, names)) continue;
        let r = perShow.get(sh); if (!r) { r = { solo: 0, dated: [], tracks: [], soloTracks: [], datedTracks: [] }; perShow.set(sh, r); }
        if (m.showSet.size === 1) { r.solo++; if (r.soloTracks.length < 3 && m.latest) r.soloTracks.push(m); }
        if (m.released) { r.dated.push(m.released); if (m.latest) r.datedTracks.push(m); }
        if (r.tracks.length < 12 && m.latest) r.tracks.push(m);
      }
    }
    const median = (xs) => { const a = xs.slice().sort((x, y) => x - y); return a[Math.floor(a.length / 2)]; };
    // three different shows; deepest crate scored per episode, so a daily show doesn't win on volume
    const used = new Set();
    const best = (rows, cmp) => { const r = rows.sort(cmp).find(([sh]) => !used.has(sh)); if (r) used.add(r[0]); return r; };
    const eps = (sh) => showEps.get(sh) || 1;
    const solo = best([...perShow].filter(([sh, r]) => r.solo >= 8 && eps(sh) >= 3).map(([sh, r]) => [sh, r, r.solo / eps(sh)]), (a, b) => b[2] - a[2]);
    const oldest = best([...perShow].filter(([, r]) => r.dated.length >= 5).map(([sh, r]) => [sh, r, median(r.dated)]), (a, b) => a[2] - b[2]);
    const widest = best([...perShow].map(([sh, r]) => [sh, r, showFams.get(sh)?.size || 0]).filter((x) => x[2] >= 6), (a, b) => b[2] - a[2]);
    const characters = [
      solo && { kind: 'Deepest crate', show: solo[0], name: label(solo[0]), text: `${solo[1].solo} tracks nobody else played, in ${eps(solo[0])} episodes`, t: solo[1].soloTracks[0] || solo[1].tracks[0] },
      oldest && { kind: 'Oldest record box', show: oldest[0], name: label(oldest[0]), text: `Half the records predate ${oldest[2] + 1}`, t: oldest[1].datedTracks.sort((a, b) => a.released - b.released)[0] || oldest[1].tracks[0] },
      widest && { kind: 'Widest range', show: widest[0], name: label(widest[0]), text: `${widest[2]} genres, no fixed address`, t: widest[1].tracks[widest[1].tracks.length - 1] }
    ].filter((c) => c && c.t);
    // the year it happened: artists whose plays jumped in one month (news: a death, a return,
    // an anniversary). Shows per month per artist; a spike is a month with 7+ shows and at least
    // four times the artist's usual month
    const am = new Map();                // artist key -> { name, months: Map(month -> Set(show)), tracks: Map(month -> best track row) }
    for (const f of files) for (const t of f.tracks) {
      for (const a of String(t[0]).split(/\s*(?:,|&|\bx\b|\bfeat\.?|\bft\.?|\band\b)\s*/i).map((x) => x.trim()).filter(Boolean)) {
        const k = n(a); if (!k) continue;
        let r = am.get(k); if (!r) { r = { name: a, months: new Map(), best: new Map() }; am.set(k, r); }
        if (!r.months.has(f.period)) r.months.set(f.period, new Set());
        const set = r.months.get(f.period);
        t[3].forEach((i) => { if (!catchAll(f.showList[i], names)) set.add(f.showList[i]); });
        const b = r.best.get(f.period);
        if (!b || t[3].length > b[3].length) r.best.set(f.period, t);
      }
    }
    const ctx = (await window.nts.chart(`context-${y}`).catch(() => null))?.moments || [];
    const spikes = [];
    for (const [k, r] of am) {
      const vals = list.map((mm) => r.months.get(mm)?.size || 0);
      const peak = Math.max(...vals);
      const at = vals.indexOf(peak), usual = (vals.reduce((a, b) => a + b, 0) - peak) / Math.max(1, vals.length - 1);
      const month = list[at];
      const mi0 = (m) => +m.slice(0, 4) * 12 + +m.slice(5);
      // a checked context line lowers the bar (a real moment with fewer shows); otherwise 7+ shows
      const known = ctx.some((x) => n(x.artist) === k && Math.abs(mi0(x.month) - mi0(month)) <= 1);
      if (peak < (known ? 4 : 7) || peak < (known ? 3 : 4) * Math.max(usual, 0.75)) continue;
      const row = r.best.get(month), f = files.find((x) => x.period === month);
      const t = row && { artist: row[0], title: row[1], latest: { show: f.showList[row[4][0]], episode: row[4][1], offset: row[4][2], d: row[4][3], title: (names[f.showList[row[4][0]]] || [])[0] || showName(f.showList[row[4][0]]) } };
      // the context line, when one has been written for it (a month either side of the peak)
      const mi = (m) => +m.slice(0, 4) * 12 + +m.slice(5);
      const c = ctx.find((x) => n(x.artist) === k && Math.abs(mi(x.month) - mi(month)) <= 1);
      spikes.push({ artist: r.name, month, peak, usual: Math.round(usual * 10) / 10, vals, t, text: c?.text || '', source: c?.source || '' });
    }
    // the clearest moments first; at most two a month, captioned ones preferred
    spikes.sort((a, b) => (b.text ? 1 : 0) - (a.text ? 1 : 0) || b.peak / Math.max(1, b.usual) - a.peak / Math.max(1, a.usual));
    const perM = new Map(), seenT = new Set();
    const moments = spikes.filter((x) => { const tk = x.t && `${n(x.t.artist)}|${n(x.t.title)}`; if (tk && seenT.has(tk)) return false; if (tk) seenT.add(tk); return true; }).filter((x) => { const c = perM.get(x.month) || 0; if (c >= 2) return false; perM.set(x.month, c + 1); return true; })
      .slice(0, 12).sort((a, b) => a.month.localeCompare(b.month) || b.peak - a.peak);
    // who listens to whom: show A plays a track, show B plays it within three weeks; the pairs that
    // repeat across the tracks that spread (5+ shows). Listener series and catch-alls left out.
    const SERIES = /^(dancing-\d{4}|coming-of-age|your-specialist-subject.*)$/;
    const pairsH = new Map();
    for (const m of all) {
      const order = [...m.firstBy].filter(([sh]) => !catchAll(sh, names) && !SERIES.test(sh)).sort((a, b) => a[1] - b[1]);
      if (order.length < 5) continue;
      for (let i = 0; i < order.length; i++) for (let j = i + 1; j < order.length; j++) {
        const gap = order[j][1] - order[i][1];
        if (gap <= 0 || gap > 21) continue;
        const key2 = `${order[i][0]}>${order[j][0]}`;
        let r = pairsH.get(key2); if (!r) { r = { a: order[i][0], b: order[j][0], tracks: [], gaps: [] }; pairsH.set(key2, r); }
        r.tracks.push(m); r.gaps.push(gap);
      }
    }
    const handoffs = [...pairsH.values()].filter((r) => r.tracks.length >= 3).sort((x, y) => y.tracks.length - x.tracks.length).slice(0, 5)
      .map((r) => ({ a: r.a, b: r.b, an: label(r.a), bn: label(r.b), count: r.tracks.length, days: Math.round(r.gaps.reduce((x, y) => x + y, 0) / r.gaps.length), tracks: r.tracks.slice(0, 3) }));
    // the show most in tune with NTS: it played the most of the year's top 100
    const tune = new Map();
    all.slice(0, 100).forEach((m) => m.showSet.forEach((sh) => { if (!catchAll(sh, names)) tune.set(sh, (tune.get(sh) || 0) + 1); }));
    // (the top few, so the story can skip one already told, like the tastemaker)
    const inTune = [...tune].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([sh, count]) => ({ show: sh, count, name: (names[sh] || [])[0] || showName(sh),
      tracks: all.slice(0, 100).filter((m) => m.showSet.has(sh)).slice(0, 9) }));
    all.forEach((m) => { delete m.showSet; });
    const realDebuts = debuts.filter((d) => !catchAll(d.show, names));
    return {
      year: y, months: files.length, complete: files.length === 12 && files.every((f) => f.complete),
      episodes, plays, shows: showEps.size, uniqueTracks: files.reduce((s, f) => s + f.uniqueTracks, 0),
      top: all.slice(0, 100), topArtists, numberOnes, breakouts, evergreen, busiest,
      debuts: realDebuts.map((d) => ({ ...d, name: (names[d.show] || [])[0] || showName(d.show), img: (names[d.show] || [])[1] || '' })),
      pair: topPair ? { a: pa, b: pb, count: topPair[1], names, tracks: pairTracks } : null,
      inTune, deepCuts, characters, moments, handoffs,
      // comebacks: old records (10+ years) that suddenly spread to many shows in one month
      comebacks: all.slice(0, 400).filter((m) => m.released && m.released <= y - 10).map((m) => {
        const vals = list.map((mm) => m.perMonth[mm] || 0);
        const peak = Math.max(...vals), at = vals.indexOf(peak), before = Math.max(0, ...vals.slice(0, at));
        return { ...m, peak, peakMonth: list[at], before, vals };
      }).filter((m) => m.peak >= 3 && m.before <= 1).sort((a, b) => b.peak - a.peak || a.released - b.released).slice(0, 3),
      // crossovers: tracks played under the most different genres
      crossovers: all.slice(0, 400).filter((m) => m.genres && m.shows >= 3)
        .map((m) => ({ ...m, gl: Object.entries(m.genres).sort((a, b) => b[1] - a[1]).map(([g]) => g) }))
        .sort((a, b) => b.gl.length - a.gl.length || b.shows - a.shows).slice(0, 3),
      // loyalty: a track one show kept playing month after month
      loyal: (() => { // (4+ months; on a tie the show that broadcasts least wins, so loyalty isn't just a daily slot)
        const t = all.filter((m) => m.shows === 1 && m.months >= 4 && !m.theme && !catchAll(m.latest.show, names))
          .sort((a, b) => b.months - a.months || (showEps.get(a.latest.show) || 0) - (showEps.get(b.latest.show) || 0))[0];
        return t ? { ...t, by: (names[t.latest.show] || [])[0] || showName(t.latest.show) } : null; })(),
      // the oldest records among the year's 200 most played (first release year known)
      timeTravel: all.slice(0, 200).filter((m) => m.released && m.released < y - 25).sort((a, b) => a.released - b.released).slice(0, 3),
      peak: peak ? { month: peak.period, episodes: peak.episodes } : null,
      stories: stories(y, files, all, monthFiles, names),
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

  // ---- Stories: headlines worked out from the year, only the ones worth telling ----
  // tracklist labels that aren't artists (film clips, talk, idents)
  const NOT_ARTISTS = new Set(['excerpt', 'excerpts', 'dialogue', 'interview', 'intro', 'outro', 'speech', 'spoken word', 'jingle', 'ident', 'nts', 'nts radio', 'various', 'various artists', 'unknown', 'unknown artist', 'traditional', 'trad', 'anonymous', 'field recording', 'field recordings']);
  const unquote = (x) => String(x || '').replace(/^["“”'‘’]+|["“”'‘’]+$/g, '');
  function stories(y, files, all, monthFiles, names) {
    const out = [];
    const q = (t) => `“${unquote(t)}”`;
    const nm = (a) => (names[a] || [])[0] || showName(a);
    const mName = (m) => new Date(Date.UTC(+m.slice(0, 4), +m.slice(5) - 1, 15)).toLocaleDateString(undefined, { month: 'long', timeZone: 'UTC' });
    const pct = (x) => Math.round(x * 100);
    const DAY = 864e5;

    // 1. how rarely NTS repeats itself
    const rates = files.filter((f) => f.uniqueTracks).map((f) => 1 - f.tracks.filter((t) => t[2] >= 2).length / f.uniqueTracks);
    if (rates.length) {
      const r = rates.reduce((a, b) => a + b, 0) / rates.length;
      out.push({ id: 'repeats', kicker: 'Never the same twice', headline: r > 0.9 ? 'NTS almost never repeats itself' : 'How often tracks come back',
        body: `${pct(r)}% of tracks got one play in their month, and that was it. Only ${100 - pct(r)} in every 100 came round again, on any show. Most radio runs on playlists. NTS runs on record bags.`,
        viz: { type: 'waffle', value: pct(r) } });
    }

    // 2. fame is fast: the longest runs in a monthly top 20
    const months = monthFiles.map((f) => f.period);
    const runs = [];
    for (const t of all.slice(0, 400)) {
      const k = key(t.artist, t.title);
      let cur = 0, best = 0, end = null;
      months.forEach((m, i) => { const r = monthFiles[i].map.get(k)?.rank; if (r && r <= 20) { cur++; if (cur > best) { best = cur; end = m; } } else cur = 0; });
      if (best) runs.push({ t, best, end });
    }
    runs.sort((a, b) => b.best - a.best || b.t.shows - a.t.shows);
    if (runs.length && months.length >= 4) {
      const top = runs[0];
      out.push({ id: 'fast', kicker: 'Fame is fast', headline: top.best <= 3 ? `No track lasted more than ${top.best} months in the top 20` : `${top.t.title} stayed in the top 20 for ${top.best} months`,
        body: top.best <= 3 ? `The longest run in a monthly top 20 was ${top.best} months, by ${q(top.t.title)} (${top.t.artist}). On NTS, tracks catch on and move on within weeks.`
          : `${q(top.t.title)} (${top.t.artist}) held a place in the monthly top 20 for ${top.best} months in a row, the longest run of the year.`,
        viz: { type: 'runs', months, rows: runs.slice(0, 5).map((r) => ({ t: r.t, on: months.map((m, i) => { const rk = monthFiles[i].map.get(key(r.t.artist, r.t.title))?.rank; return rk && rk <= 20 ? rk : null; }) })) } });
    }

    // 3. the biggest leap into a monthly top 10
    let leap = null;
    for (let i = 1; i < monthFiles.length; i++) {
      monthFiles[i].map.forEach((v, k) => {
        const before = monthFiles[i - 1].map.get(k)?.rank;
        if (v.rank && v.rank <= 10 && before && before - v.rank > (leap?.by || 0)) leap = { k, by: before - v.rank, from: before, to: v.rank, month: monthFiles[i].period };
      });
    }
    if (leap && leap.by >= 20) {
      const t = monthFiles.find((f) => f.period === leap.month).rows.find((r) => key(r.artist, r.title) === leap.k);
      if (t) out.push({ id: 'leap', kicker: 'The biggest leap', headline: `From #${leap.from} to #${leap.to}`,
        body: `${q(t.title)} by ${t.artist} climbed ${leap.by} places in ${mName(leap.month)}. Nothing else made a jump like it all year.`,
        viz: { type: 'leap', t, from: leap.from, to: leap.to } });
    }

    // 4. one show's obsession against real breadth
    let obsession = null;
    for (const f of files) for (const [name, count, idx] of f.artists || []) {
      const shows = idx.map((i) => f.showList[i]);
      if (NOT_ARTISTS.has(n(name)) || shows.every((x) => catchAll(x, names))) continue;
      if (shows.length <= 2 && count >= 10 && count > (obsession?.count || 0)) obsession = { name, count, shows, month: f.period };
    }
    const reach = new Map();
    for (const f of files) for (const [name, , idx] of f.artists || []) {
      const k = n(name);
      if (NOT_ARTISTS.has(k)) continue;
      if (!reach.has(k)) reach.set(k, { name, shows: new Set() });
      idx.forEach((i) => reach.get(k).shows.add(f.showList[i]));
    }
    const breadth = [...reach.values()].sort((a, b) => b.shows.size - a.shows.size)[0];
    if (obsession && breadth) {
      out.push({ id: 'obsession', kicker: 'Deep dives', headline: `${obsession.count} ${obsession.name} tracks, ${obsession.shows.length === 1 ? 'one show' : 'two shows'}`,
        body: `In ${mName(obsession.month)}, ${obsession.shows.map(nm).join(' and ')} played ${obsession.count} different ${obsession.name} tracks: a deep dive, not a trend. The widest reach belonged to ${breadth.name}, played by ${breadth.shows.size} different shows across the year.`,
        viz: { type: 'versus', a: { label: obsession.name, value: obsession.count, unit: 'tracks', note: `on ${obsession.shows.length} show${obsession.shows.length === 1 ? '' : 's'}` },
          b: { label: breadth.name, value: breadth.shows.size, unit: 'shows', note: 'across the year' } } });
    }

    // 5. the busiest month
    if (files.length >= 3) {
      const eps = files.map((f) => ({ m: f.period, v: f.episodes }));
      const peakM = eps.slice().sort((a, b) => b.v - a.v)[0];
      const avg = eps.reduce((a, b) => a + b.v, 0) / eps.length;
      out.push({ id: 'busiest', kicker: 'The busiest month', headline: `${mName(peakM.m)}: ${peakM.v.toLocaleString()} episodes`,
        body: `${Math.round((peakM.v / avg - 1) * 100)}% busier than usual (${Math.round(avg).toLocaleString()} episodes in a normal month). Listener takeovers did a lot of the lifting.`,
        viz: { type: 'bars', rows: eps, peak: peakM.m } });
    }

    // 6. the rare repeat: one show playing one track again and again
    let repeat = null;
    for (const f of files) for (const t of f.tracks) if (t[3].length === 1 && !catchAll(f.showList[t[3][0]], names) && t[2] > (repeat?.times || 0)) repeat = { times: t[2], artist: t[0], title: t[1], show: f.showList[t[3][0]], month: f.period };
    if (repeat && repeat.times >= 3) out.push({ id: 'repeat', kicker: 'On repeat', headline: `${repeat.times} plays, one show`,
      body: `${nm(repeat.show)} played ${q(repeat.title)} by ${repeat.artist} ${repeat.times} times in ${mName(repeat.month)}. Nobody leaned on one record harder.`,
      viz: { type: 'cover', t: { artist: repeat.artist, title: repeat.title } } });

    // 7. who heard it first
    const lead = (t) => { const d = [...t.firstBy.entries()].sort((a, b) => a[1] - b[1]); return d.length >= 2 ? { first: d[0], next: d[1], all: d, days: d[1][1] - d[0][1] } : null; };
    const big = all.filter((t) => t.shows >= 5 && t.firstBy.size >= 5);
    const ahead = big.map((t) => ({ t, l: lead(t) })).filter((x) => x.l && !CATCH_ALL.test(x.l.first[0])).sort((a, b) => b.l.days - a.l.days)[0];
    const number1 = all[0] && lead(all[0]);
    if (ahead && ahead.l.days >= 14) {
      const w = Math.round(ahead.l.days / 7);
      out.push({ id: 'first', kicker: 'Who heard it first', headline: `${nm(ahead.l.first[0])}, ${w} week${w === 1 ? '' : 's'} ahead`,
        body: `${nm(ahead.l.first[0])} played ${q(ahead.t.title)} (${ahead.t.artist}) ${w} week${w === 1 ? '' : 's'} before any other show. ${ahead.t.shows} shows had played it by the end of the year.`
          + (number1 && all[0] !== ahead.t ? ` The track of the year, ${q(all[0].title)}, was first played by ${nm(number1.first[0])}.` : ''),
        viz: { type: 'strip', t: ahead.t, firsts: ahead.l.all.map(([s, d]) => ({ show: nm(s), d: d * DAY })), year: y } });
    }

    // 8. tastemaker of the year: the show that played first the most tracks others took up
    const credit = new Map();
    for (const t of big) { const l = lead(t); if (!l || CATCH_ALL.test(l.first[0])) continue; const s = l.first[0]; if (!credit.has(s)) credit.set(s, []); credit.get(s).push(t); }
    const taste = [...credit].sort((a, b) => b[1].length - a[1].length)[0];
    if (taste && taste[1].length >= 2) out.push({ id: 'tastemaker', kicker: 'Tastemaker of the year', headline: nm(taste[0]),
      body: `Got there first on ${taste[1].length} tracks that five or more shows went on to play.`,
      viz: { type: 'tracks', rows: taste[1].sort((a, b) => b.shows - a.shows).slice(0, 4) } });

    // 9. old and new: when the year's top 100 first came out
    const dated = all.slice(0, 100).filter((t) => t.released);
    if (dated.length >= 30) {
      const fresh = dated.filter((t) => t.released >= y - 1).length;
      const oldest = dated.slice().sort((a, b) => a.released - b.released)[0];
      const decades = new Map();
      dated.forEach((t) => { const d = Math.floor(t.released / 10) * 10; decades.set(d, (decades.get(d) || 0) + 1); });
      out.push({ id: 'decades', kicker: 'Old and new', headline: fresh / dated.length > 0.5 ? `${pct(fresh / dated.length)}% brand new` : `${pct(1 - fresh / dated.length)}% from before ${y - 1}`,
        body: `Of the year's top 100 (${dated.length} with a known release year), ${fresh} came out in ${y - 1} or ${y}. The oldest: ${q(oldest.title)} by ${oldest.artist}, from ${oldest.released}.`,
        viz: { type: 'decades', rows: [...decades].sort((a, b) => a[0] - b[0]) } });
    }

    // 10. the sound of the year: genres month by month
    const gTotals = new Map();
    files.forEach((f) => (f.genres || []).forEach(([g, c]) => gTotals.set(g, (gTotals.get(g) || 0) + c)));
    const topG = [...gTotals].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([g]) => g);
    if (topG.length >= 3 && files.length >= 3 && files.every((f) => f.genres)) {
      const rows = files.map((f) => { const r = { m: f.period }; topG.forEach((g) => { r[g] = ((f.genres.find((x) => x[0] === g) || [])[1] || 0) / f.episodes; }); return r; });
      const half = Math.floor(rows.length / 2);
      const avgOf = (rs, g) => rs.reduce((a, r) => a + r[g], 0) / Math.max(1, rs.length);
      const rise = topG.map((g) => ({ g, d: avgOf(rows.slice(half), g) - avgOf(rows.slice(0, half), g) })).sort((a, b) => b.d - a.d)[0];
      const rose = rise.d >= 0.02;
      out.push({ id: 'genres', kicker: 'The sound of the year', headline: rose ? `${topG[0]} led; ${rise.g} rose` : `${topG[0]}, all year`,
        body: `${topG[0]} was the most common tag on NTS this year, on ${pct(gTotals.get(topG[0]) / files.reduce((a2, f) => a2 + f.episodes, 0))}% of episodes. `
          + (rose ? `${rise.g} grew the most, from ${pct(avgOf(rows.slice(0, half), rise.g))}% of episodes in the first half of the year to ${pct(avgOf(rows.slice(half), rise.g))}% in the second.`
            : 'The mix of genres barely moved from month to month: NTS’s sound is broad and steady.'),
        viz: { type: 'stream', rows, keys: topG } });
    }
    return out;
  }

  return { get, peek, months, year, trend, spark, showName, key, shift, families,
    reset() { mem.clear(); loading.clear(); } };      // tests
})();
