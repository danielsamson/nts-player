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
      let ri = 0;
      for (const [artist, title, e, idx, l, first, days] of f.tracks) {
        const k = `${n(artist)}|${n(title)}`;
        let m = tracks.get(k);
        if (!m) { m = { artist, title, episodes: 0, showSet: new Set(), monthSet: new Set(), perMonth: {}, firstBy: new Map(), latest: null, first }; tracks.set(k, m); }
        if (days) idx.forEach((i, j) => { const s = f.showList[i]; if (!m.firstBy.has(s) || days[j] < m.firstBy.get(s)) m.firstBy.set(s, days[j]); });
        if (e >= 2) { const yr = f.years?.[ri]; if (yr) m.released = yr; ri++; }
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
  function stories(y, files, all, monthFiles, names) {
    const out = [];
    const nm = (a) => (names[a] || [])[0] || showName(a);
    const mName = (m) => new Date(Date.UTC(+m.slice(0, 4), +m.slice(5) - 1, 15)).toLocaleDateString(undefined, { month: 'long', timeZone: 'UTC' });
    const pct = (x) => Math.round(x * 100);
    const DAY = 864e5;

    // 1. how rarely NTS repeats itself
    const rates = files.filter((f) => f.uniqueTracks).map((f) => 1 - f.tracks.filter((t) => t[2] >= 2).length / f.uniqueTracks);
    if (rates.length) {
      const r = rates.reduce((a, b) => a + b, 0) / rates.length;
      out.push({ id: 'repeats', kicker: 'Never the same twice', headline: r > 0.9 ? 'NTS almost never repeats itself' : 'How often tracks come back',
        body: `${pct(r)}% of tracks were played just once in their month. Only ${100 - pct(r)} in every 100 got a second play, on any show. Most radio runs on playlists; NTS runs on record bags.`,
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
        body: top.best <= 3 ? `The longest run in a monthly top 20 was ${top.best} months, by “${top.t.title}” (${top.t.artist}). On NTS, tracks catch on and move on within weeks.`
          : `“${top.t.title}” (${top.t.artist}) held a place in the monthly top 20 for ${top.best} months in a row, the longest run of the year.`,
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
        body: `“${t.title}” by ${t.artist} jumped ${leap.by} places in ${mName(leap.month)}, the biggest climb into a monthly top 10 all year.`,
        viz: { type: 'leap', t, from: leap.from, to: leap.to } });
    }

    // 4. one show's obsession against real breadth
    let obsession = null;
    for (const f of files) for (const [name, count, idx] of f.artists || []) {
      const shows = idx.map((i) => f.showList[i]);
      if (shows.length <= 2 && count >= 10 && count > (obsession?.count || 0)) obsession = { name, count, shows, month: f.period };
    }
    const reach = new Map();
    for (const f of files) for (const [name, , idx] of f.artists || []) {
      const k = n(name);
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
        body: `${Math.round((peakM.v / avg - 1) * 100)}% more than an average month this year (${Math.round(avg).toLocaleString()} episodes).`,
        viz: { type: 'bars', rows: eps, peak: peakM.m } });
    }

    // 6. the rare repeat: one show playing one track again and again
    let repeat = null;
    for (const f of files) for (const t of f.tracks) if (t[3].length === 1 && t[2] > (repeat?.times || 0)) repeat = { times: t[2], artist: t[0], title: t[1], show: f.showList[t[3][0]], month: f.period };
    if (repeat && repeat.times >= 3) out.push({ id: 'repeat', kicker: 'On repeat', headline: `${repeat.times} plays, one show`,
      body: `The most any show played one track in a month: ${nm(repeat.show)} played “${repeat.title}” by ${repeat.artist} ${repeat.times} times in ${mName(repeat.month)}.`,
      viz: { type: 'cover', t: { artist: repeat.artist, title: repeat.title } } });

    // 7. who heard it first
    const lead = (t) => { const d = [...t.firstBy.entries()].sort((a, b) => a[1] - b[1]); return d.length >= 2 ? { first: d[0], next: d[1], all: d, days: d[1][1] - d[0][1] } : null; };
    const big = all.filter((t) => t.shows >= 5 && t.firstBy.size >= 5);
    const ahead = big.map((t) => ({ t, l: lead(t) })).filter((x) => x.l && !CATCH_ALL.test(x.l.first[0])).sort((a, b) => b.l.days - a.l.days)[0];
    const number1 = all[0] && lead(all[0]);
    if (ahead && ahead.l.days >= 14) {
      const w = Math.round(ahead.l.days / 7);
      out.push({ id: 'first', kicker: 'Who heard it first', headline: `${nm(ahead.l.first[0])}, ${w} week${w === 1 ? '' : 's'} ahead`,
        body: `${nm(ahead.l.first[0])} played “${ahead.t.title}” (${ahead.t.artist}) ${w} week${w === 1 ? '' : 's'} before any other show. ${ahead.t.shows} shows had played it by the end of the year.`
          + (number1 && all[0] !== ahead.t ? ` The track of the year, “${all[0].title}”, was first played by ${nm(number1.first[0])}.` : ''),
        viz: { type: 'strip', t: ahead.t, firsts: ahead.l.all.map(([s, d]) => ({ show: nm(s), d: d * DAY })), year: y } });
    }

    // 8. tastemaker of the year: the show that played first the most tracks others took up
    const credit = new Map();
    for (const t of big) { const l = lead(t); if (!l || CATCH_ALL.test(l.first[0])) continue; const s = l.first[0]; if (!credit.has(s)) credit.set(s, []); credit.get(s).push(t); }
    const taste = [...credit].sort((a, b) => b[1].length - a[1].length)[0];
    if (taste && taste[1].length >= 2) out.push({ id: 'tastemaker', kicker: 'Tastemaker of the year', headline: nm(taste[0]),
      body: `First to play ${taste[1].length} tracks that at least five shows went on to play this year.`,
      viz: { type: 'tracks', rows: taste[1].sort((a, b) => b.shows - a.shows).slice(0, 4) } });

    // 9. old and new: when the year's top 100 first came out
    const dated = all.slice(0, 100).filter((t) => t.released);
    if (dated.length >= 30) {
      const fresh = dated.filter((t) => t.released >= y - 1).length;
      const oldest = dated.slice().sort((a, b) => a.released - b.released)[0];
      const decades = new Map();
      dated.forEach((t) => { const d = Math.floor(t.released / 10) * 10; decades.set(d, (decades.get(d) || 0) + 1); });
      out.push({ id: 'decades', kicker: 'Old and new', headline: fresh / dated.length > 0.5 ? `${pct(fresh / dated.length)}% brand new` : `${pct(1 - fresh / dated.length)}% from before ${y - 1}`,
        body: `Of the year's top 100 (${dated.length} with a known release year), ${fresh} came out in ${y - 1} or ${y}. The oldest: “${oldest.title}” by ${oldest.artist}, from ${oldest.released}.`,
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
      out.push({ id: 'genres', kicker: 'The sound of the year', headline: `${topG[0]} led; ${rise.g} rose`,
        body: `${topG[0]} was the most common tag on NTS this year. ${rise.g} grew the most, from ${pct(avgOf(rows.slice(0, half), rise.g))}% of episodes in the first half of the year to ${pct(avgOf(rows.slice(half), rise.g))}% in the second.`,
        viz: { type: 'stream', rows, keys: topG } });
    }
    return out;
  }

  return { get, peek, months, year, trend, spark, showName, key, shift,
    reset() { mem.clear(); loading.clear(); } };      // tests
})();
