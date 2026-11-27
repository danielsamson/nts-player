// NTS in <year>: the year on NTS in tracks, as full-window cards (one fact each).
// Built from the monthly chart files (Chart.year). Arrows or ← → to move, Esc to close.

const Year = (() => {
  let box = null, cards = [], at = 0, y = null;
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const monthName = (m, style = 'long') => new Date(Date.UTC(+m.slice(0, 4), +m.slice(5) - 1, 15)).toLocaleDateString(undefined, { month: style, timeZone: 'UTC' });
  const fmt = (x) => Number(x).toLocaleString();
  const showPic = (src, cls) => {
    const wrap = el('div', cls);
    if (src) { const im = el('img'); im.alt = ''; im.addEventListener('error', () => im.remove()); im.src = String(src).replace(/\/\/media\d?\.ntslive\.co\.uk\/resize\/(100x100|200x200)\//, '//media.ntslive.co.uk/resize/400x400/'); wrap.append(im); }
    return wrap;
  };
  const plural = (x, word) => `${fmt(x)} ${word}${x === 1 ? '' : 's'}`;

  function cover(t, size = 'high') {
    const wrap = el('div', 'year__cover');
    const img = el('img'); img.alt = '';
    Art.get({ artist: t.artist, title: t.title }, size).then((a) => { if (a?.large || a?.small) { img.src = a.large || a.small; wrap.classList.add('has-img'); } }).catch(() => {});
    wrap.append(img);
    return wrap;
  }
  const play = (t) => {
    const b = el('button', 'year__play', '▶ Play');
    b.title = `Play it in ${t.latest.title}`;
    b.addEventListener('click', () => Archive.playFrom(t.latest.show, t.latest.episode, Number.isFinite(t.latest.offset) ? t.latest.offset : 0));
    return b;
  };
  let monthList = [];
  function trackLine(t, i) {
    const r = el('div', 'year__row');
    const c = cover(t, 'small'); c.classList.add('year__cover--small');
    const txt = el('div', 'year__rowtext');
    txt.append(el('span', 'year__rowtitle', t.title), el('span', 'year__rowsub', `${t.artist} · ${plural(t.shows, 'show')}`));
    r.append(el('span', 'year__rank', String(i + 1)), c, txt);
    if (t.perMonth && monthList.length > 1) { const sp = Chart.spark(monthList.map((m) => t.perMonth[m] || 0), { w: 72, h: 20 }); sp.classList.add('year__spark'); r.append(sp); }
    r.addEventListener('click', () => Archive.playFrom(t.latest.show, t.latest.episode, Number.isFinite(t.latest.offset) ? t.latest.offset : 0));
    r.title = `Play it in ${t.latest.title}`;
    return r;
  }
  function card(kicker, title, ...body) {
    const c = el('section', 'year__card');
    c.append(el('p', 'year__kicker', kicker));
    if (title) c.append(el('h2', 'year__title', title));
    c.append(...body.filter(Boolean));
    return c;
  }

  function build(s) {
    const out = [];
    const soFar = s.complete ? '' : ` (${s.months} month${s.months === 1 ? '' : 's'} so far)`;
    // 1: the year in numbers
    const nums = el('div', 'year__nums');
    [[s.episodes, 'episodes'], [s.shows, 'shows'], [s.plays, 'tracks played']].forEach(([v, l]) => {
      const d = el('div', 'year__num'); d.append(el('span', 'year__big', fmt(v)), el('span', 'year__label', l)); nums.append(d);
    });
    out.push(card(`NTS in ${s.year}${soFar}`, 'The year in tracks', nums,
      el('p', 'year__note', 'Worked out from every episode’s tracklist. Tracks are ranked by how many different shows played them.')));
    // 2: track of the year
    const t1 = s.top[0];
    if (t1) out.push(card('Track of the year', null, cover(t1), el('p', 'year__track', t1.title), el('p', 'year__artist', t1.artist),
      el('p', 'year__note', `Played by ${plural(t1.shows, 'show')} in ${plural(t1.episodes, 'episode')}.`), play(t1)));
    // 3: top 10
    if (s.top.length > 1) { const l = el('div', 'year__list'); s.top.slice(0, 10).forEach((t, i) => l.append(trackLine(t, i))); out.push(card('The top 10', null, l)); }
    // the top 10's ranks month by month
    if (s.monthList.length >= 3 && s.top.length >= 3) out.push(card('Month by month', 'How the top 10 moved', bumpChart(s)));
    // how long each lasted
    if (s.top.length >= 3) out.push(card('Lifespans', 'First play to last', lifespans(s)));
    // 4: artists
    if (s.topArtists.length) {
      const a1 = s.topArtists[0];
      const l = el('div', 'year__list');
      s.topArtists.slice(1, 6).forEach((a, i) => { const r = el('div', 'year__row'); r.append(el('span', 'year__rank', String(i + 2)), el('div', 'year__rowtext')); r.lastChild.append(el('span', 'year__rowtitle', a.artist), el('span', 'year__rowsub', plural(a.shows, 'show'))); l.append(r); });
      out.push(card('Artist of the year', a1.artist, cover(a1.top), el('p', 'year__note', `Played by ${plural(a1.shows, 'show')}, ${plural(a1.tracks, 'different track')}.`), l));
    }
    // 5: number one each month
    if (s.numberOnes.length > 1) {
      const g = el('div', 'year__grid');
      s.numberOnes.forEach((t) => { const c = el('div', 'year__cell'); c.append(cover(t, 'small'), el('span', 'year__cellmonth', monthName(t.month, 'short')), el('span', 'year__celltitle', t.title)); c.title = `${t.artist} – ${t.title}`; c.addEventListener('click', () => Archive.playFrom(t.latest.show, t.latest.episode, Number.isFinite(t.latest.offset) ? t.latest.offset : 0)); g.append(c); });
      out.push(card('Number one, month by month', null, g));
    }
    // 6: breakouts
    if (s.breakouts.length >= 3) {
      const l = el('div', 'year__list'); s.breakouts.forEach((t, i) => l.append(trackLine(t, i)));
      const since = new Date(s.breakouts.since).toLocaleDateString(undefined, { month: 'long', timeZone: 'UTC' });
      out.push(card('Rising', `New since ${since}`, l, el('p', 'year__note', `First played in the last three months and already picked up by the most shows (beyond the top 10).`)));
    }
    // 7: long runners
    if (s.evergreen.length) {
      const l = el('div', 'year__list');
      s.evergreen.forEach((t, i) => { const r = trackLine(t, i); const sub = r.querySelector('.year__rowsub'); if (sub) sub.textContent = `${t.artist} · ${t.months} of ${s.months} months`; l.append(r); });
      out.push(card('Long runners', 'Played month after month', l, el('p', 'year__note', 'Most tracks on NTS come and go within weeks. These kept coming back.')));
    }
    // (busiest shows by episodes left out: it's just the daily slots)
    // 9: new shows
    if (s.debuts.length) {
      const g = el('div', 'year__shows');
      s.debuts.slice(0, 9).forEach((d) => { const b = el('button', 'year__show'); b.append(showPic(d.img, 'year__showpic'), el('span', null, d.name)); b.addEventListener('click', () => { close(); Archive.showShow(d.show); }); g.append(b); });
      out.push(card('New on NTS', `${plural(s.debuts.length, 'new show')}`, g, s.debuts.length > 9 ? el('p', 'year__note', `And ${fmt(s.debuts.length - 9)} more.`) : null));
    }
    // shows linked by the tracks they shared
    if (s.links.length >= 5) out.push(card('Shows network', 'Who played the same tracks', network(s),
      el('p', 'year__note', 'Lines join shows that played at least 3 of the same tracks; thicker means more. Bigger circles share with more shows.')));
    // 10: shared taste
    if (s.pair && s.pair.count >= 3) {
      const nm = (a) => (s.pair.names[a] || [])[0] || Chart.showName(a);
      const l = el('div', 'year__list');
      (s.pair.tracks || []).forEach((t, i) => l.append(trackLine(t, i)));
      out.push(card('Shared taste', `${nm(s.pair.a)} & ${nm(s.pair.b)}`, el('p', 'year__note', `The two shows that played the most of the same tracks: ${plural(s.pair.count, 'track')} in common. Among them:`), l));
    }
    // 11: outro
    const sup = el('button', 'year__link', 'Support NTS');
    sup.addEventListener('click', () => window.nts.openLink({ web: 'https://www.nts.live/supporters', apps: [] }));
    out.push(card(`NTS in ${s.year}`, 'That was the year', el('p', 'year__note', s.peak ? `The busiest month was ${monthName(s.peak.month)}, with ${plural(s.peak.episodes, 'episode')}.` : ''), sup));
    return out;
  }

  // ---- charts drawn with d3 ----
  const W = 504;
  const shortMonth = (m) => monthName(m, 'short');
  function bumpChart(s) {
    const top = s.top.slice(0, 10), months = s.monthList, MAXR = 30, H = 300, L = 8, R = 34, T = 14, B = 26;
    const x = d3.scalePoint().domain(months).range([L + 8, W - R]);
    const y = d3.scaleLinear().domain([1, MAXR]).range([T, H - B]);
    const svg = d3.create('svg').attr('class', 'year__svg').attr('viewBox', `0 0 ${W} ${H}`);
    svg.append('g').selectAll('text').data(months).join('text').attr('class', 'year__axis').attr('x', x).attr('y', H - 8).attr('text-anchor', 'middle').text(shortMonth);
    [1, 10, 20, 30].forEach((r) => {
      svg.append('line').attr('class', 'year__grid').attr('x1', L).attr('x2', W - R + 4).attr('y1', y(r)).attr('y2', y(r));
      svg.append('text').attr('class', 'year__axis').attr('x', W - R + 8).attr('y', y(r) + 3).text(`#${r}`);
    });
    const series = top.map((t, i) => {
      const pts = months.map((m) => ({ m, r: s.monthRanks[m]?.get(Chart.key(t.artist, t.title))?.rank ?? null })).filter((p) => p.r != null && p.r <= MAXR);
      const best = pts.reduce((b, p) => (!b || p.r < b.r ? p : b), null);
      return { t, i, pts, best };
    }).filter((d) => d.pts.length);
    const line = d3.line().x((p) => x(p.m)).y((p) => y(p.r)).curve(d3.curveMonotoneX);
    const g = svg.append('g');
    const tg = g.selectAll('g').data(series).join('g').attr('class', (d) => `year__bump${d.i === 0 ? ' is-first' : ''}`);
    // dashed through the months it dropped out of the top 30, solid between neighbouring months
    tg.append('path').attr('class', 'year__bumpgap').attr('d', (d) => line(d.pts));
    tg.append('path').attr('d', (d) => d.pts.map((p, k) => (k && months.indexOf(p.m) - months.indexOf(d.pts[k - 1].m) === 1 ? line([d.pts[k - 1], p]) : '')).join(''));
    tg.selectAll('circle.year__bumpdot').data((d) => d.pts).join('circle').attr('class', 'year__bumpdot').attr('cx', (p) => x(p.m)).attr('cy', (p) => y(p.r)).attr('r', 2.4);
    const mk = tg.append('g').attr('class', 'year__bumpmark').attr('transform', (d) => `translate(${x(d.best.m)},${y(d.best.r)})`);
    mk.append('circle').attr('r', 7.5);
    mk.append('text').attr('dy', '0.35em').attr('text-anchor', 'middle').text((d) => d.i + 1);
    tg.append('title').text((d) => `${d.i + 1}. ${d.t.title} – ${d.t.artist}: best #${d.best.r} in ${monthName(d.best.m)}`);
    tg.on('mouseenter', function () { g.classed('has-hover', true); d3.select(this).classed('is-hover', true).raise(); })
      .on('mouseleave', function () { g.classed('has-hover', false); d3.select(this).classed('is-hover', false); });
    const wrapEl = el('div');
    const key = el('ol', 'year__key');
    top.forEach((t, i) => key.append(el('li', null, `${i + 1}  ${t.title}`)));
    wrapEl.append(svg.node(), key);
    return wrapEl;
  }
  function lifespans(s) {
    const top = s.top.slice(0, 10), months = s.monthList, ROW = 26, H = top.length * ROW + 26, L = 150, R = 8;
    const start = Date.UTC(s.year, 0, 1), end = Date.UTC(s.year, months.length, 1);
    const x = d3.scaleLinear().domain([start, end]).range([L, W - R]);
    const svg = d3.create('svg').attr('class', 'year__svg').attr('viewBox', `0 0 ${W} ${H}`);
    months.forEach((m, i) => {
      const mx = x(Date.UTC(s.year, i, 1));
      svg.append('line').attr('class', 'year__grid').attr('x1', mx).attr('x2', mx).attr('y1', 0).attr('y2', H - 20);
      svg.append('text').attr('class', 'year__axis').attr('x', x(Date.UTC(s.year, i, 15))).attr('y', H - 6).attr('text-anchor', 'middle').text(shortMonth(m).slice(0, 1));
    });
    const maxShows = Math.max(1, ...top.flatMap((t) => Object.values(t.perMonth || {})));
    top.forEach((t, i) => {
      const yy = i * ROW + 14;
      svg.append('text').attr('class', 'year__lifelabel').attr('x', 0).attr('y', yy + 4).text(`${i + 1} ${t.title}`.slice(0, 24)).append('title').text(`${t.title} – ${t.artist}`);
      const a = Math.max(start, t.first || start), b = Math.min(end, Math.max(a, t.latest?.d || a));
      svg.append('line').attr('class', 'year__lifebar').attr('x1', x(a)).attr('x2', x(b) + 0.5).attr('y1', yy).attr('y2', yy);
      months.forEach((m, j) => {
        const v = t.perMonth?.[m];
        if (v) svg.append('circle').attr('class', 'year__lifedot').attr('cx', x(Date.UTC(s.year, j, 15))).attr('cy', yy).attr('r', 2 + (v / maxShows) * 6).append('title').text(`${shortMonth(m)}: ${plural(v, 'show')}`);
      });
    });
    return svg.node();
  }
  function network(s) {
    const H = 380;
    const nm = (a) => (s.names[a] || [])[0] || Chart.showName(a);
    const deg = new Map();
    s.links.forEach((l) => { deg.set(l.a, (deg.get(l.a) || 0) + 1); deg.set(l.b, (deg.get(l.b) || 0) + 1); });
    // groups of at least 3 shows (lone pairs would just float around the edge)
    const parent = new Map();
    const find = (a) => { while (parent.get(a) !== a) a = parent.get(a); return a; };
    deg.forEach((_, id) => parent.set(id, id));
    s.links.forEach((l) => parent.set(find(l.a), find(l.b)));
    const size = new Map();
    deg.forEach((_, id) => size.set(find(id), (size.get(find(id)) || 0) + 1));
    const keep = (id) => size.get(find(id)) >= 3;
    const nodes = [...deg].filter(([id]) => keep(id)).map(([id, d]) => ({ id, d }));
    const links = s.links.filter((l) => keep(l.a)).map((l) => ({ source: l.a, target: l.b, count: l.count }));
    const sim = d3.forceSimulation(nodes).force('link', d3.forceLink(links).id((d) => d.id).distance(50).strength(0.4))
      .force('charge', d3.forceManyBody().strength(-170)).force('x', d3.forceX(W / 2).strength(0.08)).force('y', d3.forceY(H / 2).strength(0.12))
      .force('collide', d3.forceCollide((d) => 6 + Math.sqrt(d.d) * 2)).stop();
    for (let i = 0; i < 320; i++) sim.tick();
    nodes.forEach((d) => { d.x = Math.max(10, Math.min(W - 10, d.x)); d.y = Math.max(10, Math.min(H - 10, d.y)); });
    const maxC = Math.max(...links.map((l) => l.count));
    const svg = d3.create('svg').attr('class', 'year__svg year__net').attr('viewBox', `0 0 ${W} ${H}`);
    const lg = svg.append('g').selectAll('line').data(links).join('line').attr('class', 'year__netlink')
      .attr('x1', (l) => l.source.x).attr('y1', (l) => l.source.y).attr('x2', (l) => l.target.x).attr('y2', (l) => l.target.y)
      .attr('stroke-width', (l) => 0.6 + (l.count / maxC) * 3.5);
    lg.append('title').text((l) => `${nm(l.source.id)} & ${nm(l.target.id)}: ${plural(l.count, 'track')} in common`);
    const ng = svg.append('g').selectAll('g').data(nodes).join('g').attr('class', 'year__netnode').attr('transform', (d) => `translate(${d.x},${d.y})`);
    ng.append('circle').attr('r', (d) => 3 + Math.sqrt(d.d) * 2);
    ng.append('title').text((d) => `${nm(d.id)}: shares with ${plural(d.d, 'show')}`);
    // names for the best-connected shows, only where they don't overlap one already placed
    // (the rest show on hover)
    const placed = [];
    const labelled = new Set();
    for (const d of nodes.slice().sort((a, b) => b.d - a.d)) {
      if (labelled.size >= 10) break;
      const w = Math.min(22, nm(d.id).length) * 5.4, h = 11, y = d.y - (6 + Math.sqrt(d.d) * 2) - h;
      const box = { x0: d.x - w / 2 - 3, x1: d.x + w / 2 + 3, y0: y, y1: y + h };
      if (box.x0 < 0 || box.x1 > W || placed.some((b) => box.x0 < b.x1 && box.x1 > b.x0 && box.y0 < b.y1 && box.y1 > b.y0)) continue;
      placed.push(box); labelled.add(d.id);
    }
    ng.filter((d) => labelled.has(d.id)).append('text').attr('y', (d) => -(6 + Math.sqrt(d.d) * 2)).attr('text-anchor', 'middle').text((d) => nm(d.id).slice(0, 22));
    ng.on('mouseenter', (e, d) => { lg.classed('is-on', (l) => l.source === d || l.target === d); svg.classed('has-hover', true); })
      .on('mouseleave', () => { lg.classed('is-on', false); svg.classed('has-hover', false); })
      .on('click', (e, d) => { close(); Archive.showShow(d.id); });
    return svg.node();
  }

  // ---- Stories: a headline, the numbers, one small chart ----
  function storyCards(s) {
    if (!s.stories?.length) return [card(`NTS in ${s.year}`, 'No stories yet', el('p', 'year__note', 'There isn’t enough of the year yet to tell its stories.'))];
    return s.stories.map((st) => card(st.kicker, st.headline, storyViz(st.viz, s), el('p', 'year__story', st.body)));
  }
  function storyViz(v, s) {
    const svgOf = (h) => d3.create('svg').attr('class', 'year__svg').attr('viewBox', `0 0 ${W} ${h}`);
    if (v.type === 'waffle') {
      const g = el('div', 'year__waffle');
      for (let i = 0; i < 100; i++) g.append(el('span', i < v.value ? 'is-on' : ''));
      return g;
    }
    if (v.type === 'leap') {
      const d = el('div', 'year__leap');
      const c = cover(v.t, 'small'); c.classList.add('year__cover--mid');
      const nums = el('div', 'year__leapnums');
      nums.append(el('span', 'year__leapfrom', `#${v.from}`), el('span', 'year__leaparrow', '→'), el('span', 'year__big', `#${v.to}`));
      d.append(c, nums);
      return d;
    }
    if (v.type === 'versus') {
      const d = el('div', 'year__versus');
      [v.a, v.b].forEach((x) => { const b = el('div', 'year__num'); b.append(el('span', 'year__big', String(x.value)), el('span', 'year__label', `${x.unit} · ${x.label}`), el('span', 'year__rowsub', x.note)); d.append(b); });
      return d;
    }
    if (v.type === 'cover') { const c = cover(v.t); c.classList.add('year__cover--mid'); return c; }
    if (v.type === 'tracks') { const l = el('div', 'year__list'); v.rows.forEach((t, i) => l.append(trackLine(t, i))); return l; }
    if (v.type === 'bars' || v.type === 'decades') {
      const rows = v.type === 'bars' ? v.rows.map((r) => ({ k: shortMonth(r.m), v: r.v, on: r.m === v.peak })) : v.rows.map(([d, c]) => ({ k: `${String(d).slice(2)}s`, v: c }));
      const H = 160, B = 18;
      const x = d3.scaleBand().domain(rows.map((r) => r.k)).range([0, W]).padding(0.2);
      const y = d3.scaleLinear().domain([0, d3.max(rows, (r) => r.v)]).range([H - B, 6]);
      const svg = svgOf(H);
      svg.selectAll('rect').data(rows).join('rect').attr('class', (r) => `year__bar${r.on ? ' is-on' : ''}`).attr('x', (r) => x(r.k)).attr('width', x.bandwidth()).attr('y', (r) => y(r.v)).attr('height', (r) => H - B - y(r.v))
        .append('title').text((r) => `${r.k}: ${r.v}`);
      svg.selectAll('text').data(rows).join('text').attr('class', 'year__axis').attr('x', (r) => x(r.k) + x.bandwidth() / 2).attr('y', H - 5).attr('text-anchor', 'middle').text((r) => r.k);
      return svg.node();
    }
    if (v.type === 'runs') {
      const ROW = 24, H = v.rows.length * ROW + 20, L = 160;
      const x = d3.scalePoint().domain(v.months).range([L + 8, W - 8]);
      const svg = svgOf(H);
      v.months.forEach((m) => svg.append('text').attr('class', 'year__axis').attr('x', x(m)).attr('y', H - 4).attr('text-anchor', 'middle').text(shortMonth(m).slice(0, 1)));
      v.rows.forEach((r, i) => {
        const yy = i * ROW + 12;
        svg.append('text').attr('class', 'year__lifelabel').attr('x', 0).attr('y', yy + 4).text(r.t.title.slice(0, 26));
        r.on.forEach((rk, j) => svg.append('circle').attr('class', rk ? 'year__lifedot' : 'year__emptydot').attr('cx', x(v.months[j])).attr('cy', yy).attr('r', rk ? 5 : 2).append('title').text(rk ? `${shortMonth(v.months[j])}: #${rk}` : shortMonth(v.months[j])));
      });
      return svg.node();
    }
    if (v.type === 'strip') {
      const H = 90, start = Date.UTC(v.year, 0, 1), end = Date.UTC(v.year + 1, 0, 1);
      const x = d3.scaleTime().domain([start, end]).range([10, W - 10]);
      const svg = svgOf(H);
      svg.append('line').attr('class', 'year__lifebar').attr('x1', 10).attr('x2', W - 10).attr('y1', 50).attr('y2', 50);
      d3.range(12).forEach((i) => svg.append('text').attr('class', 'year__axis').attr('x', x(Date.UTC(v.year, i, 15))).attr('y', H - 6).attr('text-anchor', 'middle').text(shortMonth(`${v.year}-${String(i + 1).padStart(2, '0')}`).slice(0, 1)));
      v.firsts.forEach((f, i) => svg.append('circle').attr('class', i === 0 ? 'year__stripfirst' : 'year__lifedot').attr('cx', x(f.d)).attr('cy', 50).attr('r', i === 0 ? 7 : 4).append('title').text(`${f.show}: ${new Date(f.d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' })}`));
      svg.append('text').attr('class', 'year__striplabel').attr('x', x(v.firsts[0].d)).attr('y', 30).attr('text-anchor', 'middle').text(`${v.firsts[0].show.slice(0, 28)} · first`);
      return svg.node();
    }
    if (v.type === 'stream') {
      const H = 220, B = 18;
      const stack = d3.stack().keys(v.keys).offset(d3.stackOffsetWiggle).order(d3.stackOrderInsideOut)(v.rows);
      const x = d3.scalePoint().domain(v.rows.map((r) => r.m)).range([0, W]);
      const y = d3.scaleLinear().domain([d3.min(stack, (l) => d3.min(l, (p) => p[0])), d3.max(stack, (l) => d3.max(l, (p) => p[1]))]).range([H - B, 4]);
      const area = d3.area().x((p) => x(p.data.m)).y0((p) => y(p[0])).y1((p) => y(p[1])).curve(d3.curveBasis);
      const shade = d3.scaleLinear().domain([0, v.keys.length - 1]).range([0.95, 0.22]);
      const svg = svgOf(H);
      svg.selectAll('path').data(stack).join('path').attr('class', 'year__stream').attr('d', area).attr('fill', (l, i) => `rgba(255,255,255,${shade(i)})`)
        .append('title').text((l) => l.key);
      svg.selectAll('text.year__axis').data(v.rows).join('text').attr('class', 'year__axis').attr('x', (r) => x(r.m)).attr('y', H - 4).attr('text-anchor', 'middle').text((r) => shortMonth(r.m).slice(0, 1));
      // name each band where it's widest
      stack.forEach((l, i) => {
        const p = l.reduce((b, q) => (q[1] - q[0] > b[1] - b[0] ? q : b), l[0]);
        if (y(p[0]) - y(p[1]) < 11) return;
        svg.append('text').attr('class', 'year__streamlabel').attr('x', Math.min(W - 40, Math.max(40, x(p.data.m)))).attr('y', (y(p[0]) + y(p[1])) / 2 + 3).attr('text-anchor', 'middle')
          .attr('fill', shade(i) > 0.55 ? '#000' : '#fff').text(l.key);
      });
      return svg.node();
    }
    return el('div');
  }

  // ---- the timeline: months side by side, top 8 each, lines following a track ----
  let tlMonths = [];
  async function timeline(year) {
    const stage = box.querySelector('.year__stage');
    stage.replaceChildren(loader('Loading the timeline'));
    const all = (await Chart.months()).slice().sort();
    tlMonths = all.filter((m) => m.startsWith(`${year}-`));
    await drawTimeline(all);
  }
  async function drawTimeline(all) {
    const stage = box.querySelector('.year__stage');
    const files = (await Promise.all(tlMonths.map((m) => Chart.get(m)))).filter(Boolean);
    const wrap = el('div', 'tl');
    const scroller = el('div', 'tl__scroll');
    const inner = el('div', 'tl__inner');
    const earliest = tlMonths[0];
    const earlier = all.filter((m) => m < earliest).slice(-12);
    if (earlier.length) {
      const more = el('button', 'tl__more', `‹ ${earlier[0].slice(0, 4) === earlier[earlier.length - 1].slice(0, 4) ? earlier[0].slice(0, 4) : 'Earlier'}`);
      more.addEventListener('click', async () => { tlMonths = [...earlier, ...tlMonths]; await drawTimeline(all); });
      inner.append(more);
    }
    files.forEach((f) => {
      const col = el('div', 'tl__col');
      col.append(el('div', 'tl__month', `${monthName(f.period, 'short')} ${f.period.slice(2, 4)}`));
      f.rows.slice(0, 8).forEach((t, i) => {
        const b = el('button', 'tl__item');
        b.dataset.key = Chart.key(t.artist, t.title);
        const c = cover(t, 'small'); c.classList.add('tl__cover');
        b.append(c, el('span', 'tl__rank', String(i + 1)), el('span', 'tl__title', t.title), el('span', 'tl__artist', t.artist));
        b.title = `${t.artist} – ${t.title} · ${plural(t.shows, 'show')}. Play it`;
        b.addEventListener('click', () => Archive.playFrom(t.latest.show, t.latest.episode, Number.isFinite(t.latest.offset) ? t.latest.offset : 0));
        col.append(b);
      });
      inner.append(col);
    });
    scroller.append(inner);
    wrap.append(scroller, el('p', 'year__note tl__note', 'The top 8 each month. A line follows a track while it stays in the top 8. Click a cover to play it.'));
    stage.replaceChildren(wrap);
    // lines between the same track in neighbouring months
    requestAnimationFrame(() => {
      const NS = 'http://www.w3.org/2000/svg';
      const svg = document.createElementNS(NS, 'svg');
      svg.setAttribute('class', 'tl__lines');
      svg.setAttribute('width', inner.scrollWidth); svg.setAttribute('height', inner.scrollHeight);
      const base = inner.getBoundingClientRect();
      const cols = [...inner.querySelectorAll('.tl__col')];
      for (let i = 0; i + 1 < cols.length; i++) {
        cols[i].querySelectorAll('.tl__item').forEach((a) => {
          const b = cols[i + 1].querySelector(`.tl__item[data-key="${CSS.escape(a.dataset.key)}"]`);
          if (!b) return;
          const ra = a.getBoundingClientRect(), ca = a.querySelector('.tl__cover').getBoundingClientRect(), rb = b.querySelector('.tl__cover').getBoundingClientRect();
          const x1 = ra.right + 2 - base.left, y1 = ca.top + ca.height / 2 - base.top, x2 = rb.left - 2 - base.left, y2 = rb.top + rb.height / 2 - base.top;
          const p = document.createElementNS(NS, 'path');
          p.setAttribute('d', `M${x1},${y1} C${(x1 + x2) / 2},${y1} ${(x1 + x2) / 2},${y2} ${x2},${y2}`);
          p.setAttribute('class', 'tl__line');
          svg.append(p);
          a.classList.add('is-linked'); b.classList.add('is-linked');
        });
      }
      inner.prepend(svg);
      if (!wrap.dataset.kept) setTimeout(() => { scroller.scrollLeft = scroller.scrollWidth; }, 30);   // newest at the right
    });
  }
  let opener = null;
  let mode = 'play', deck = { cards: [], stories: [] }, summary = null;
  const startPlay = () => { if (summary) YearPlay.start(box, summary, { onBrowse: () => setMode('cards'), onClose: close }); };
  function setMode(m) {
    mode = m;
    if (m === 'play') { startPlay(); return; }
    YearPlay.stop();
    box.querySelectorAll('.year__mode').forEach((b) => b.classList.toggle('active', b.dataset.mode === m));
    box.classList.toggle('is-timeline', m === 'timeline');
    if (m === 'timeline') { timeline(y); return; }
    cards = deck[m] || [];
    if (cards.length) show(0);
  }

  function show(i) {
    at = Math.max(0, Math.min(cards.length - 1, i));
    const stage = box.querySelector('.year__stage');
    stage.replaceChildren(cards[at]);
    box.querySelector('.year__count').textContent = box.querySelector('.year__pos').textContent = `${at + 1} / ${cards.length}`;
    box.querySelector('.year__prev').disabled = at === 0;
    box.querySelector('.year__next').disabled = at === cards.length - 1;
  }
  const onKey = (e) => {
    if (!box) return;
    if (e.key === 'Escape') { e.preventDefault(); close(); return; }
    if (e.key === 'Tab') { window.trapTab?.(YearPlay.active ? box.querySelector('.yp') : box, e); e.stopPropagation(); return; }
    if (mode === 'play') { if (YearPlay.key(e)) e.preventDefault(); e.stopPropagation(); return; }
    if (mode === 'timeline') return;
    else if (e.key === 'ArrowRight') { e.preventDefault(); show(at + 1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); show(at - 1); }
    e.stopPropagation();
  };

  async function open(year) {
    y = year;
    if (!box) {
      mode = 'play';                        // a fresh overlay starts by playing the year
      opener = document.activeElement;      // focus goes back here on close
      box = el('div', 'year');
      box.tabIndex = -1;
      box.setAttribute('role', 'dialog'); box.setAttribute('aria-label', `NTS in ${year}`);
      box.innerHTML = '<div class="year__top"><select class="year__pick" aria-label="Year"></select><div class="year__modes"><button class="year__mode" data-mode="play">▶ Play</button><button class="year__mode active" data-mode="cards">Cards</button><button class="year__mode" data-mode="stories">Stories</button><button class="year__mode" data-mode="timeline">Timeline</button></div><span class="year__count"></span><button class="year__close" aria-label="Close">×</button></div>'
        + '<button class="year__prev" aria-label="Previous">‹</button><div class="year__stage"></div><button class="year__next" aria-label="Next">›</button><span class="year__pos" aria-hidden="true"></span>';
      box.querySelector('.year__close').addEventListener('click', close);
      box.querySelectorAll('.year__mode').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));
      box.querySelector('.year__prev').addEventListener('click', () => show(at - 1));
      box.querySelector('.year__next').addEventListener('click', () => show(at + 1));
      box.querySelector('.year__pick').addEventListener('change', (e) => open(+e.target.value));
      document.body.append(box);
      box.focus();
      document.addEventListener('keydown', onKey, true);
    }
    const pick = box.querySelector('.year__pick');
    const years = [...new Set((await Chart.months()).map((m) => +m.slice(0, 4)))].sort((a, b) => b - a);
    pick.replaceChildren(...(years.length ? years : [year]).map((v) => { const o = el('option', null, `NTS in ${v}`); o.value = v; return o; }));
    pick.value = year;
    box.querySelector('.year__stage').replaceChildren(loader(`Putting ${year} together`));
    const s = await Chart.year(year);
    if (y !== year || !box) return;
    monthList = s?.monthList || [];
    summary = s;
    deck.stories = s ? storyCards(s) : [];
    deck.cards = cards = s ? build(s) : [card(`NTS in ${year}`, 'Not ready yet', el('p', 'year__note', 'This year’s charts haven’t been worked out yet. They fill in a year at a time; try again tomorrow.'))];
    if (mode === 'play' && s) { cards = deck.cards; show(0); startPlay(); }
    else if (mode === 'timeline') timeline(year);
    else { if (mode === 'play') mode = 'cards'; cards = deck[mode]?.length ? deck[mode] : deck.cards; show(0); }
  }
  function close() {
    if (!box) return;
    document.removeEventListener('keydown', onKey, true);
    YearPlay.stop();
    box.remove();
    box = null;
    if (opener?.isConnected) opener.focus();
    opener = null;
  }
  return { open, close };
})();
