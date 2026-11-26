// Track web (prototype): explore NTS through what DJs played.
// Round nodes are tracks (with their cover), square nodes are episodes. A line means
// "this episode played this track". Click a node to expand it: a track shows the
// episodes that played it, an episode shows its tracklist. Drag to move, scroll to zoom.
// Uses: Archive.findTrack (NTS track search), the NTS API, Art (covers), MyNTS.

const TrackWeb = (() => {
  const host = $('trackweb');
  const MAX_NODES = 450;
  const norm = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  const trackId = (t) => `t:${norm(t.artist)}|${norm(t.title)}`;
  const epId = (show, episode) => `e:${show}/${episode}`;
  const showId = (show) => `s:${show}`;

  // ---------- show facts (popularity stand-ins): episodes, since when, how often, featured ----------
  const metaCache = new Map();
  let featuredP = null;
  const featured = () => (featuredP ||= window.nts.api('/api/v2/shows?type=featured&limit=50')
    .then((r) => new Set((r.results || []).map((x) => x.show_alias))).catch(() => new Set()));
  function showMeta(alias) {
    if (!metaCache.has(alias)) {
      metaCache.set(alias, (async () => {
        const [show, list, feat] = await Promise.all([
          window.nts.api(`/api/v2/shows/${alias}`).catch(() => ({})),
          window.nts.api(`/api/v2/shows/${alias}/episodes?limit=1&offset=0`).catch(() => ({})),
          featured()
        ]);
        const episodes = list.metadata?.resultset?.count || 0;
        let since = '';
        if (episodes > 1) {
          const first = await window.nts.api(`/api/v2/shows/${alias}/episodes?limit=1&offset=${episodes - 1}`).catch(() => ({}));
          since = (first.results?.[0]?.broadcast || '').slice(0, 4);
        }
        const m = show.media || {};
        return { name: show.name || alias, img: m.background_small || m.picture_small || '', episodes, since,
          frequency: (show.frequency || '').toLowerCase(), featured: feat.has(alias) };
      })());
    }
    return metaCache.get(alias);
  }
  const metaLine = (m) => [m.episodes ? `${m.episodes} episode${m.episodes === 1 ? '' : 's'}${m.since ? ` since ${m.since}` : ''}` : '',
    m.frequency && m.frequency !== 'none' ? m.frequency : '', m.featured ? '★ featured by NTS' : ''].filter(Boolean).join(' · ');

  let nodes = [], links = [], byId = new Map(), linkIds = new Set();
  let selected = null, rootId = null, sim = null, svg, gZoom, gLinks, gNodes, zoom;
  let built = false;

  // ---------- data ----------
  function addNode(n) {
    if (byId.has(n.id)) return byId.get(n.id);
    if (nodes.length >= MAX_NODES) return null;
    const near = n.near && byId.get(n.near);
    n.x = near ? near.x + (Math.random() - .5) * 60 : (Math.random() - .5) * 40;
    n.y = near ? near.y + (Math.random() - .5) * 60 : (Math.random() - .5) * 40;
    n.r = n.type === 'track' ? 16 : n.type === 'show' ? 20 : 12;
    nodes.push(n); byId.set(n.id, n);
    if (n.type === 'track') { loadCover(n); loadCount(n); }
    else if (n.type === 'episode') loadShowArt(n);
    else loadShowNode(n);
    return n;
  }
  function addLink(a, b, data = {}) {
    if (!a || !b) return;
    const id = `${a.id}~${b.id}`;
    if (linkIds.has(id)) return;
    linkIds.add(id);
    links.push({ id, source: a.id, target: b.id, ...data });
  }
  async function loadCover(n) {
    n.artLoading = true;
    const art = await Art.get({ artist: n.artist, title: n.title, isrc_id: n.isrc_id, deezer_track_id: n.deezer_track_id }).catch(() => null);
    n.artLoading = false;
    if (art?.small) n.img = art.small;
    paintNodes();
  }
  // Show artwork for an episode node (from the episode details; cached)
  const showArt = new Map();
  async function loadShowArt(n) {
    n.artLoading = true;
    const key = `${n.show}/${n.episode}`;
    if (!showArt.has(key)) {
      showArt.set(key, window.nts.api(`/api/v2/shows/${n.show}/episodes/${n.episode}`)
        .then((ep) => { const m = ep.media || {}; return m.background_small || m.picture_small || m.background_thumb || m.picture_thumb || ''; })
        .catch(() => ''));
    }
    n.img = await showArt.get(key);
    n.artLoading = false;
    paintNodes();
  }
  async function loadShowNode(n) {
    n.artLoading = true;
    n.meta = await showMeta(n.show);
    n.title = n.meta.name;
    n.img = n.meta.img;
    n.artLoading = false;
    paintNodes(); paintInfo();
  }

  // ---------- exploring a show: bring in its episodes, newest first ----------
  function showNodeFor(ep) {
    const s = addNode({ id: showId(ep.show), type: 'show', show: ep.show, title: ep.title, near: ep.id });
    addLink(s, ep, { kind: 'show' });
    return s;
  }
  async function addShowEpisodes(s, howMany = 6) {
    if (s.loading) return;
    s.loading = true; s.offset ||= 0; paintNodes(); paintInfo();
    const res = await window.nts.api(`/api/v2/shows/${s.show}/episodes?limit=${howMany}&offset=${s.offset}`).catch(() => null);
    s.offset += howMany;
    s.total = res?.metadata?.resultset?.count ?? s.total;
    s.expanded = true;
    const eps = (res?.results || []).map((ep) => {
      const e = addNode({ id: epId(s.show, ep.episode_alias), type: 'episode', show: s.show, episode: ep.episode_alias,
        title: ep.name, date: ep.broadcast ? fmtDate(ep.broadcast) : '', near: s.id });
      addLink(s, e, { kind: 'show' });
      return e;
    }).filter(Boolean);
    update();
    for (const e of eps) if (!e.expanded) await expandEpisode(e);   // their tracklists: shared tracks appear
    s.loading = false;
    paintNodes(); paintInfo();
  }

  // The explore hint: how many episodes played this track; bigger node = more played
  async function loadCount(n) {
    const c = await Archive.trackCount({ artist: n.artist, title: n.title }).catch(() => null);
    if (c == null || !byId.has(n.id)) return;
    n.plays = c;
    n.r = 13 + Math.min(13, Math.sqrt(Math.max(0, c - 1)) * 3.2);
    paintNodes();
    sim?.force('collide').radius((d) => d.r + 8);
    sim?.alpha(.15).restart();
  }

  // Expand a track: the episodes that played it
  async function expandTrack(n) {
    n.loading = true; paintNodes();
    const info = await Archive.findTrack({ artist: n.artist, title: n.title }).catch(() => null);
    n.loading = false; n.expanded = true;
    const plays = info?.plays || [];
    if (!plays.length) showSnack('No other NTS episodes found for this track');
    plays.forEach((p) => {
      const m = /^\/shows\/([^/]+)\/episodes\/([^/]+)/.exec(p.path || '');
      if (!m) return;
      const e = addNode({ id: epId(m[1], m[2]), type: 'episode', show: m[1], episode: m[2], title: p.title, date: p.date, near: n.id });
      addLink(n, e);
    });
    update();
  }

  // Expand an episode: its tracklist
  async function expandEpisode(n) {
    n.loading = true; paintNodes();
    const tl = await window.nts.api(`/api/v2/shows/${n.show}/episodes/${n.episode}/tracklist`).catch(() => null);
    n.loading = false; n.expanded = true;
    n.trackCount = (tl?.results || []).length;
    (tl?.results || []).forEach((t) => {
      if (!t.title) return;
      const tn = addNode({ id: trackId(t), type: 'track', artist: t.artist, title: t.title, isrc_id: t.isrc_id, deezer_track_id: t.deezer_track_id, near: n.id });
      addLink(tn, n, { offset: t.offset ?? t.offset_estimate });
    });
    if (nodes.length >= MAX_NODES) showSnack('The web is full: start a new one from a track');
    update();
  }

  // ---------- drawing ----------
  function build() {
    if (built) return;
    built = true;
    svg = d3.select(host.querySelector('.trackweb__svg'));
    const defs = svg.append('defs');
    defs.append('clipPath').attr('id', 'tw-circle').attr('clipPathUnits', 'objectBoundingBox')
      .append('circle').attr('cx', .5).attr('cy', .5).attr('r', .5);
    gZoom = svg.append('g');
    gLinks = gZoom.append('g').attr('class', 'tw-links');
    gNodes = gZoom.append('g').attr('class', 'tw-nodes');
    zoom = d3.zoom().scaleExtent([0.25, 3]).on('zoom', (e) => {
      gZoom.attr('transform', e.transform);
      svg.classed('is-zoomed', e.transform.k > 1.3);      // zoomed in: show every track label
    });
    svg.call(zoom).on('dblclick.zoom', null);
    svg.on('click', (e) => { if (e.target === svg.node()) select(null); });
    sim = d3.forceSimulation()
      .force('link', d3.forceLink().id((d) => d.id).distance((l) => (l.kind === 'show' ? 90 : 70)).strength((l) => (l.kind === 'show' ? .4 : .7)))
      .force('charge', d3.forceManyBody().strength(-220))
      .force('collide', d3.forceCollide((d) => d.r + 8))
      .force('x', d3.forceX(0).strength(.03))
      .force('y', d3.forceY(0).strength(.03))
      .on('tick', ticked);
    new ResizeObserver(center).observe(host);
  }
  function center() {
    const r = host.getBoundingClientRect();
    if (!r.width) return;
    svg.attr('viewBox', [-r.width / 2, -r.height / 2, r.width, r.height]);
  }

  function update() {
    const lsel = gLinks.selectAll('line').data(links, (d) => d.id);
    lsel.exit().remove();
    lsel.enter().append('line').attr('class', (d) => `tw-link${d.kind === 'show' ? ' tw-link--show' : ''}`);
    const nsel = gNodes.selectAll('g.tw-node').data(nodes, (d) => d.id);
    nsel.exit().remove();
    const enter = nsel.enter().append('g')
      .attr('class', (d) => `tw-node tw-node--${d.type}`)
      .call(d3.drag()
        .on('start', (e, d) => { if (!e.active) sim.alphaTarget(.2).restart(); d.fx = d.x; d.fy = d.y; })
        .on('drag', (e, d) => { d.fx = e.x; d.fy = e.y; })
        .on('end', (e, d) => { if (!e.active) sim.alphaTarget(0); d.fx = null; d.fy = null; }))
      .on('click', (e, d) => { e.stopPropagation(); onNodeClick(d); })
      .on('mouseenter', (e, d) => highlight(d))
      .on('mouseleave', () => highlight(null));
    enter.each(function (d) {
      const g = d3.select(this);
      const shape = g.append('g').attr('class', 'tw-body');
      if (d.type === 'track') {
        shape.append('circle').attr('class', 'tw-shape');
        shape.append('image').attr('clip-path', 'url(#tw-circle)').attr('preserveAspectRatio', 'xMidYMid slice');
        shape.append('circle').attr('class', 'tw-ring');
      } else {
        shape.append('rect').attr('class', 'tw-shape');
        shape.append('image').attr('preserveAspectRatio', 'xMidYMid slice');
        shape.append('rect').attr('class', 'tw-ring');
        if (d.type === 'show') {
          g.insert('rect', ':first-child').attr('class', 'tw-life');     // outer ring: how long it's run
          g.append('text').attr('class', 'tw-star').text('★');
        }
      }
      g.append('circle').attr('class', 'tw-select');           // thin ring when selected
      g.append('circle').attr('class', 'tw-root').attr('r', 3.5); // small red dot: where you started
      const badge = g.append('g').attr('class', 'tw-badge');
      badge.append('rect').attr('height', 13).attr('rx', 0);
      badge.append('text').attr('y', 9.5).attr('text-anchor', 'middle');
      const label = g.append('text').attr('class', 'tw-label').attr('text-anchor', 'middle');
      label.append('tspan').attr('class', 'tw-label__title').attr('x', 0);
      label.append('tspan').attr('class', 'tw-label__sub').attr('x', 0).attr('dy', 11);
      g.append('title');
      // artwork that fails to load: fall back to the plain node
      g.select('image').on('error', function () { d3.select(this).attr('href', null); d.img = ''; });
    });
    paintNodes();
    sim.nodes(nodes);
    sim.force('link').links(links);
    sim.alpha(.8).restart();
    paintInfo();
  }

  const clip = (x, n) => (x && x.length > n ? x.slice(0, n - 1) + '…' : x || '');
  // Cross-breeding: how many of the web's episodes played each track
  function epDegrees() {
    const deg = new Map();
    for (const l of links) {
      if (l.kind === 'show') continue;
      const t = l.source.type === 'track' ? l.source : l.target.type === 'track' ? l.target : null;
      if (t) deg.set(t.id, (deg.get(t.id) || 0) + 1);
    }
    return deg;
  }
  function paintNodes() {
    if (!gNodes) return;
    const deg = epDegrees();
    nodes.forEach((d) => {
      if (d.type === 'track') d.inWeb = deg.get(d.id) || 0;
      if (d.type === 'episode') {
        // bigger episode = more of its tracks are shared with other episodes in the web
        d.shared = links.filter((l) => l.kind !== 'show' && (l.source === d || l.target === d))
          .filter((l) => (deg.get((l.source === d ? l.target : l.source).id) || 0) >= 2).length;
        d.r = 12 + Math.min(10, d.shared * 1.5);
      }
    });
    sim?.force('collide')?.radius((d) => d.r + 8);
    gNodes.selectAll('g.tw-node')
      .classed('is-root', (d) => d.id === rootId)
      .classed('is-selected', (d) => d === selected)
      .classed('is-expanded', (d) => d.expanded)
      .classed('is-loading', (d) => d.loading || (d.artLoading && !d.img))
      .classed('has-img', (d) => !!d.img)
      .classed('is-popular', (d) => d.plays >= 3)
      .classed('is-shared', (d) => d.type === 'track' && d.inWeb >= 2)
      .classed('is-followed', (d) => d.type !== 'track' && typeof Following !== 'undefined' && Following.has(d.show))
      .each(function (d) {
        const g = d3.select(this);
        const r = d.r;
        if (d.type === 'track') {
          g.selectAll('.tw-shape, .tw-ring').attr('r', r);
          g.select('image').attr('x', -r).attr('y', -r).attr('width', r * 2).attr('height', r * 2).attr('href', d.img || null);
        } else {
          g.selectAll('rect.tw-shape, rect.tw-ring').attr('x', -r).attr('y', -r).attr('width', r * 2).attr('height', r * 2);
          g.select('image').attr('x', -r).attr('y', -r).attr('width', r * 2).attr('height', r * 2).attr('href', d.img || null);
        }
        g.select('.tw-select').attr('r', (d.type === 'track' ? r : r * 1.42) + 4);
        if (d.type === 'show') {
          const eps = d.meta?.episodes || 0;
          const pad = 3 + Math.min(6, Math.log2(eps + 1));      // longer-running show = wider outer ring
          g.select('.tw-life').attr('x', -r - pad).attr('y', -r - pad).attr('width', (r + pad) * 2).attr('height', (r + pad) * 2)
            .attr('stroke-width', Math.max(1, Math.min(4, eps / 40)));
          g.select('.tw-star').attr('x', -r - pad - 2).attr('y', -r - pad + 2).style('display', d.meta?.featured ? null : 'none');
        }
        g.select('.tw-root').attr('cx', r * .78).attr('cy', -r * .78);
        // play-count badge (tracks played in more than one episode)
        const show = d.type === 'track' && d.plays > 1;
        const txt = d.plays >= 50 ? '50+' : String(d.plays || '');
        const w = 6 + txt.length * 6;
        g.select('.tw-badge').style('display', show ? null : 'none')
          .attr('transform', `translate(${-r * .78 - w / 2},${-r * .78 - 9})`);
        g.select('.tw-badge rect').attr('width', w);
        g.select('.tw-badge text').attr('x', w / 2).text(txt);
        // label: title, then artist (tracks) or date (episodes)
        const label = g.select('.tw-label').attr('y', r + 12);
        label.select('.tw-label__title').text(clip(d.title, 24));
        label.select('.tw-label__sub').text(clip(d.type === 'track' ? d.artist : d.type === 'show' ? (d.meta ? `${d.meta.episodes} episodes` : '') : d.date, 26));
        g.select('title').text(d.type === 'track'
          ? `${d.artist} – ${d.title}${d.plays ? `\nPlayed in ${d.plays >= 50 ? '50+' : d.plays} NTS episode${d.plays === 1 ? '' : 's'}` : ''}`
          : d.type === 'show' ? `${d.title}${d.meta ? '\n' + metaLine(d.meta) : ''}` : `${d.title}${d.date ? ' · ' + d.date : ''}`);
      });
  }

  function ticked() {
    gLinks.selectAll('line')
      .attr('x1', (d) => d.source.x).attr('y1', (d) => d.source.y)
      .attr('x2', (d) => d.target.x).attr('y2', (d) => d.target.y);
    gNodes.selectAll('g.tw-node').attr('transform', (d) => `translate(${d.x},${d.y})`);
  }

  function highlight(d) {
    const near = new Set();
    if (d) { near.add(d.id); links.forEach((l) => { if (l.source.id === d.id) near.add(l.target.id); if (l.target.id === d.id) near.add(l.source.id); }); }
    gNodes.selectAll('g.tw-node').classed('is-dim', (n) => d && !near.has(n.id));
    gLinks.selectAll('line').classed('is-lit', (l) => d && (l.source.id === d.id || l.target.id === d.id))
      .classed('is-dim', (l) => d && l.source.id !== d.id && l.target.id !== d.id);
  }

  // ---------- interaction ----------
  function onNodeClick(d) {
    select(d);
    if (d.expanded || d.loading) return;
    if (d.type === 'track') expandTrack(d);
    else if (d.type === 'episode') expandEpisode(d);
    else addShowEpisodes(d);
  }
  function select(d) { selected = d; paintNodes(); paintInfo(); }

  // An episode this track is linked to with a known position (for "Play from")
  function playableEpisode(t) {
    for (const l of links) {
      const other = l.source.id === t.id ? l.target : l.target.id === t.id ? l.source : null;
      if (other?.type === 'episode' && l.offset != null) return { ep: other, offset: l.offset };
    }
    return null;
  }

  function paintInfo() {
    const box = host.querySelector('.trackweb__info');
    box.replaceChildren();
    const d = selected;
    const hint = el('p', 'trackweb__hint',
      !nodes.length ? 'Search for a track or a show, or start from the one playing.'
        : d ? '' : `${nodes.filter((n) => n.type === 'track').length} tracks · ${nodes.filter((n) => n.type === 'episode').length} episodes. Click a node to expand it. Bigger tracks, with a number, were played in more episodes.`);
    if (!d) { box.append(hint); return; }
    const title = el('p', 'trackweb__title', d.title);
    if (d.type === 'show') return paintShowInfo(box, d);
    const playsText = d.plays ? ` · played in ${d.plays >= 50 ? '50+' : d.plays} NTS episode${d.plays === 1 ? '' : 's'}` : '';
    // An episode node is one broadcast: say which, and offer the rest of the show
    const inWebText = d.inWeb >= 2 ? ` · in ${d.inWeb} episodes here` : '';
    const sub = el('p', 'trackweb__sub', d.type === 'track' ? `${d.artist}${playsText}${inWebText}`
      : `${d.date ? `Episode of ${d.date}` : 'Episode'}${d.trackCount ? ` · ${d.trackCount} tracks` : ''}${d.shared ? ` · ${d.shared} shared` : ''}`);
    const actions = el('div', 'trackweb__actions');
    if (d.type === 'track') {
      const p = playableEpisode(d);
      if (p) actions.append(btn(`▶ Play from ${fmtOffset(p.offset)} · ${p.ep.title}`, () => Archive.playFrom(p.ep.show, p.ep.episode, p.offset)));
      actions.append(btn('Details', () => openInPanel(() => Archive.showTrack(d.artist, d.title))));
      actions.append(btn('Start a web here', () => start({ artist: d.artist, title: d.title, isrc_id: d.isrc_id, deezer_track_id: d.deezer_track_id })));
      if (p && supporter) {
        actions.append(btn('Save to My NTS', async (b) => {
          b.classList.add('mynts-btn--busy');
          const res = await MyNTS.toggleTrack(p.ep.show, p.ep.episode, d, true, { show: p.ep.show, episode: p.ep.episode, title: p.ep.title, date: p.ep.date, offset: p.offset });
          b.classList.remove('mynts-btn--busy');
          if (res && !res.error) { b.textContent = 'Saved'; b.classList.add('mynts-btn--on'); }
        }));
      }
    } else {
      actions.append(btn('▶ Play episode', () => Archive.playFrom(d.show, d.episode, 0)));
      actions.append(btn('Explore this show', () => { const s = showNodeFor(d); update(); select(s); addShowEpisodes(s); }));
      actions.append(btn('Open episode', () => openInPanel(() => Archive.showEpisode(d.show, d.episode))));
      // the show's popularity stand-ins, below the episode
      const metaEl = el('p', 'trackweb__meta');
      showMeta(d.show).then((m) => { metaEl.textContent = `${m.name} · ${metaLine(m)}${Following.has(d.show) ? ' · you follow' : ''}`; });
      box.append(title, sub, metaEl, actions);
      if (d.loading) actions.prepend(loader('Loading tracklist'));
      return;
    }
    if (d.loading) actions.prepend(loader(d.type === 'track' ? 'Finding episodes' : 'Loading tracklist'));
    box.append(title, sub, actions);
  }
  // A show: its facts, more episodes, and the tracks its episodes share most
  function paintShowInfo(box, d) {
    const title = el('p', 'trackweb__title', d.title);
    const sub = el('p', 'trackweb__sub', d.meta ? `${metaLine(d.meta)}${Following.has(d.show) ? ' · you follow' : ''}` : 'Show');
    const actions = el('div', 'trackweb__actions');
    const loaded = links.filter((l) => l.kind === 'show' && l.source === d).length;
    if (d.loading) actions.append(loader('Adding episodes'));
    else if (d.total == null || d.offset < d.total) actions.append(btn(loaded ? 'Add 6 more episodes' : 'Add 6 episodes', () => addShowEpisodes(d)));
    actions.append(btn('Open show', () => openInPanel(() => Archive.showShow(d.show))));
    box.append(title, sub, actions);
    // most-shared tracks across this show's episodes in the web
    const eps = new Set(links.filter((l) => l.kind === 'show' && l.source === d).map((l) => l.target.id));
    const tally = new Map();
    links.forEach((l) => {
      if (l.kind === 'show') return;
      const ep = l.source.type === 'episode' ? l.source : l.target.type === 'episode' ? l.target : null;
      const t = l.source.type === 'track' ? l.source : l.target.type === 'track' ? l.target : null;
      if (ep && t && eps.has(ep.id)) tally.set(t, (tally.get(t) || 0) + 1);
    });
    const top = [...tally.entries()].filter(([, c]) => c >= 2).sort((a, b) => b[1] - a[1]).slice(0, 8);
    if (top.length) {
      const list = el('div', 'trackweb__top');
      list.append(el('span', 'trackweb__top-label', `Played most across ${eps.size} episodes`));
      top.forEach(([t, c]) => {
        const b = el('button', 'tag', `${t.title} · ${t.artist} (${c})`);
        b.addEventListener('click', () => { select(t); focusOn(t); });
        list.append(b);
      });
      box.append(list);
    } else if (eps.size) box.append(el('p', 'trackweb__hint', `No tracks shared between these ${eps.size} episodes yet. Add more episodes.`));
  }
  function focusOn(n) {
    const r = host.querySelector('.trackweb__svg').getBoundingClientRect();
    svg.transition().duration(500).call(zoom.transform, d3.zoomIdentity.scale(1.4).translate(-n.x, -n.y));
  }

  function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function btn(text, fn) { const b = el('button', 'mynts-btn', text); b.addEventListener('click', () => fn(b)); return b; }
  function openInPanel(fn) { view = 'archive'; render(); fn(); }

  // ---------- starting points ----------
  function clear() {
    nodes = []; links = []; byId = new Map(); linkIds = new Set(); selected = null; rootId = null;
    if (gNodes) { gNodes.selectAll('*').remove(); gLinks.selectAll('*').remove(); svg.call(zoom.transform, d3.zoomIdentity); }
  }
  function start(t) {
    build(); center(); clear();
    const n = addNode({ id: trackId(t), type: 'track', artist: t.artist, title: t.title, isrc_id: t.isrc_id, deezer_track_id: t.deezer_track_id });
    rootId = n.id;
    update();
    select(n);
    expandTrack(n);
  }

  function startShow(alias, name) {
    build(); center(); clear();
    const s = addNode({ id: showId(alias), type: 'show', show: alias, title: name });
    rootId = s.id;
    update();
    select(s);
    addShowEpisodes(s);
  }

  // ---------- search: tracks and shows ----------
  const input = host.querySelector('.trackweb__search input');
  const results = host.querySelector('.trackweb__results');
  let searchTimer;
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Escape') { input.value = ''; results.replaceChildren(); results.hidden = true; }
    if (e.key === 'Enter') results.querySelector('button')?.click();
  });
  input.addEventListener('input', () => {
    clearTimeout(searchTimer);
    const q = input.value.trim();
    if (q.length < 2) { results.hidden = true; return; }
    searchTimer = setTimeout(async () => {
      results.hidden = false;
      results.replaceChildren(loader('Searching tracks'));
      const enc = (x) => encodeURIComponent(x).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
      const [res, showsRes] = await Promise.all([
        window.nts.api(`/api/v2/search?q=${enc(q)}&version=2&offset=0&limit=30&types[]=track`).catch(() => null),
        window.nts.api(`/api/v2/search?q=${enc(q)}&version=2&offset=0&limit=4&types[]=show`).catch(() => null)
      ]);
      if (input.value.trim() !== q) return;
      const shows = (showsRes?.results || []).map((x) => ({ alias: (/^\/shows\/([^/]+)/.exec(x.article?.path || '') || [])[1], name: x.title }))
        .filter((x) => x.alias);
      const seen = new Map();
      (res?.results || []).forEach((x) => {
        const artist = (x.artists || []).map((a) => a.name).join(', ');
        const k = `${norm(artist)}|${norm(x.title)}`;
        if (!seen.has(k)) seen.set(k, { artist, title: x.title, plays: 0 });
        seen.get(k).plays++;
      });
      const list = [...seen.values()].slice(0, 10);
      const items = [];
      if (shows.length) {
        items.push(el('p', 'trackweb__group', 'Shows'));
        shows.forEach((sh) => {
          const b = el('button', 'trackweb__result');
          b.append(el('span', 'trackweb__result-title', sh.name), el('span', 'trackweb__result-artist', 'Explore its episodes'));
          b.addEventListener('click', () => { results.hidden = true; input.value = ''; input.blur(); startShow(sh.alias, sh.name); });
          items.push(b);
        });
      }
      if (list.length) items.push(el('p', 'trackweb__group', 'Tracks'));
      list.forEach((t) => {
        const b = el('button', 'trackweb__result');
        b.append(el('span', 'trackweb__result-title', t.title), el('span', 'trackweb__result-artist', t.artist));
        b.addEventListener('click', () => { results.hidden = true; input.value = ''; input.blur(); start(t); });
        items.push(b);
      });
      results.replaceChildren(...(items.length ? items : [el('p', 'trackweb__hint', 'Nothing found.')]));
    }, 300);
  });
  document.addEventListener('click', (e) => { if (!host.querySelector('.trackweb__search').contains(e.target)) results.hidden = true; });

  host.querySelector('.trackweb__now').addEventListener('click', () => {
    const t = currentTrack();
    if (t) start(t); else showSnack('Nothing with a track ID is playing right now');
  });

  // The track you're hearing (archive track, or a live track ID)
  function currentTrack() {
    if (source === 'live' && playing && LiveNow?.track) return { artist: LiveNow.track.artist, title: LiveNow.track.title };
    const cur = source === 'archive' ? TrackNotify.currentTrack() : null;
    return cur ? cur.track : null;
  }

  return {
    start,
    startShow,
    // open with the current track if the web is empty
    show() { build(); center(); if (!nodes.length) { const t = currentTrack(); if (t) start(t); else paintInfo(); } },
    get empty() { return !nodes.length; }
  };
})();
