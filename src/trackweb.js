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
  let selected = null, rootId = null, sim = null, svg, gZoom, gLinks, gNodes, gAxis, gLanes, zoom;
  let zoomed = false, hovered = null;
  let built = false;
  let holdTimer = null;

  // ---------- data ----------
  function addNode(n) {
    if (byId.has(n.id)) return byId.get(n.id);
    if (nodes.length >= MAX_NODES) return null;
    const near = n.near && byId.get(n.near);
    if (near) {
      near.kids = (near.kids || 0) + 1;
      const a = near.kids * 2.4;                       // golden-angle spiral around the parent
      const dist = 80 + Math.sqrt(near.kids) * 12;     // room to breathe
      n.x = near.x + Math.cos(a) * dist; n.y = near.y + Math.sin(a) * dist;
    } else { n.x = 0; n.y = 0; }
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
  // Repaint at most once a frame, and only nudge the layout gently and rarely
  let paintQueued = false;
  function schedulePaint() {
    if (paintQueued) return;
    paintQueued = true;
    requestAnimationFrame(() => { paintQueued = false; paintNodes(); });
  }
  let settleTimer = null;
  function settle() {
    clearTimeout(settleTimer);
    settleTimer = setTimeout(() => { if (sim && sim.alpha() < .05) sim.alpha(.05).restart(); }, 600);
  }

  async function loadCover(n) {
    n.artLoading = true;
    const art = await Art.get({ artist: n.artist, title: n.title, isrc_id: n.isrc_id, deezer_track_id: n.deezer_track_id }).catch(() => null);
    n.artLoading = false;
    if (art?.small) n.img = art.small;
    schedulePaint();
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
    schedulePaint();
  }
  async function loadShowNode(n) {
    n.artLoading = true;
    n.meta = await showMeta(n.show);
    n.title = n.meta.name;
    n.img = n.meta.img;
    n.artLoading = false;
    schedulePaint(); if (selected === n) paintInfo();
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
    schedulePaint();
    settle();
  }

  // Expand a track: the episodes that played it
  async function expandTrack(n) {
    n.loading = true; paintNodes();
    const info = await Archive.findTrack({ artist: n.artist, title: n.title }).catch(() => null);
    n.loading = false; n.expanded = true;
    const plays = (info?.plays || []).slice(0, 16);
    // a track found by search: default to its latest episode (we know its position there)
    const m0 = info?.match;
    if (m0 && !n.via) { n.viaMatch = { show: m0.show, episode: m0.episode, title: m0.title, date: m0.date, offset: m0.offset }; }
    n.noOtherPlays = !plays.some((p) => !byId.has(epId(...((/^\/shows\/([^/]+)\/episodes\/([^/]+)/.exec(p.path || '') || []).slice(1)))));
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
      const offset = t.offset ?? t.offset_estimate;
      const tn = addNode({ id: trackId(t), type: 'track', artist: t.artist, title: t.title, isrc_id: t.isrc_id, deezer_track_id: t.deezer_track_id, near: n.id });
      if (tn && !tn.via && offset != null) { tn.via = n.id; }   // where we found it
      addLink(tn, n, { offset });
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
    gAxis = gZoom.append('g').attr('class', 'tw-axis');      // timeline view: time axis, stems, playhead
    gLanes = gZoom.append('g').attr('class', 'tw-lanes');    // timeline view: other episodes, lined up
    gLinks = gZoom.append('g').attr('class', 'tw-links');
    gNodes = gZoom.append('g').attr('class', 'tw-nodes');
    zoom = d3.zoom().scaleExtent([0.25, 3]).on('zoom', (e) => {
      gZoom.attr('transform', e.transform);
      if (e.sourceEvent && follow) follow.userZoomed = true;      // you zoomed: stop zooming for you
      zoomed = e.transform.k > 1.3;
      // names stay close to the same size on screen, so zooming in makes room for more of them
      // (in the timeline, also when zoomed out to fit the whole episode)
      const fs = 9 / Math.pow(timelineOn() ? Math.max(.45, e.transform.k) : Math.max(1, e.transform.k), .8);
      svg.node().style.setProperty('--tw-fs', `${fs}px`);
      svg.node().style.setProperty('--tw-sw', `${fs * .55}px`);
      cullLabelsSoon();
    });
    svg.call(zoom).on('dblclick.zoom', null);
    svg.on('click', (e) => { if (e.target === svg.node()) select(null); });
    sim = d3.forceSimulation()
      .force('link', d3.forceLink().id((d) => d.id).distance((l) => (l.kind === 'show' ? 120 : 90)).strength((l) => (l.kind === 'show' ? .3 : .5)))
      .force('charge', d3.forceManyBody().strength(-340))
      .force('collide', d3.forceCollide(spaceFor).strength(1).iterations(2))
      .force('x', d3.forceX(0).strength(.03))
      .force('y', d3.forceY(0).strength(.03))
      .velocityDecay(.6)           // more damping: drift, don't jump
      .on('tick', ticked)
      .on('end', cullLabels);
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
        .on('end', (e, d) => { if (!e.active) sim.alphaTarget(0); d.held = false; if (follow?.ep !== d) { d.fx = null; d.fy = null; } }))
      .on('click', (e, d) => { e.stopPropagation(); select(d); })
      .on('dblclick', (e, d) => { e.stopPropagation(); select(d); expand(d); })
      .on('mouseenter', (e, d) => hoverSoon(d))
      .on('mouseleave', () => hoverSoon(null));
    enter.each(function (d) {
      const g = d3.select(this);
      if (d.type === 'track') g.append('circle').attr('class', 'tw-pulse');
      const shape = g.append('g').attr('class', 'tw-body');
      if (d.type === 'track') {
        shape.append('circle').attr('class', 'tw-shape');
        shape.append('image').attr('clip-path', 'url(#tw-circle)').attr('preserveAspectRatio', 'xMidYMid slice');
        shape.append('circle').attr('class', 'tw-hole');
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
      label.append('tspan').attr('class', 'tw-label__sub').attr('x', 0).attr('dy', '1.22em');
      g.append('title');
      // artwork that fails to load: fall back to the plain node
      g.select('image').on('error', function () { d3.select(this).attr('href', null); d.img = ''; });
    });
    paintNodes();
    // Hold the existing web still while the new nodes settle in, then let go gently
    const fresh = new Set(enter.data());
    if (nodes.length > fresh.size) {
      nodes.forEach((n) => { if (!fresh.has(n) && n.fx == null) { n.fx = n.x; n.fy = n.y; n.held = true; } });
      clearTimeout(holdTimer);
      holdTimer = setTimeout(() => {
        nodes.forEach((n) => { if (n.held) { n.fx = null; n.fy = null; n.held = false; } });
        sim.alpha(Math.max(sim.alpha(), .35)).restart();   // let everything sort out its spacing
      }, 1400);
    }
    sim.nodes(nodes);
    sim.force('link').links(links);
    sim.alpha(Math.max(sim.alpha(), nodes.length < 3 ? .8 : .3)).restart();   // a nudge, not a shake
    paintInfo();
  }

  const clip = (x, n) => (x && x.length > n ? x.slice(0, n - 1) + '…' : x || '');
  // Room a node needs: its size, plus space for its label when it usually shows one
  function labelled(d) {
    return d.type !== 'track' || d.id === rootId || d === selected || d.expanded || d.plays >= 3 || d.inWeb >= 2;
  }
  function spaceFor(d) { return d.r + (labelled(d) ? 30 : 12); }

  // Labels that would overlap are hidden, most important first. Hover still shows any.
  function labelPriority(d) {
    // shows and episodes are the web's landmarks: their names win over track names
    return d === selected ? 6 : d.id === rootId ? 5 : d.type !== 'track' ? 4.2 : d.expanded ? 4 : d.inWeb >= 2 ? 3 : (d.plays || 0) >= 3 ? 2 : 0;
  }
  // Which labels show: every node that usually has one (all tracks when zoomed in), minus
  // those that would overlap a more important one. Labels fade in and out (CSS); one
  // that's showing keeps its place over an equal newcomer, so they don't swap as nodes drift.
  const wantsLabel = () => true;
  let cullQueued = false, cullTimer = null;
  function cullLabelsSoon() { clearTimeout(cullTimer); cullTimer = setTimeout(cullLabels, 250); }
  function cullLabels() {
    if (cullQueued || !gNodes) return;
    cullQueued = true;
    requestAnimationFrame(() => {
      cullQueued = false;
      const items = [];
      gNodes.selectAll('g.tw-node').each(function (d) {
        const label = this.querySelector('.tw-label');
        if (!wantsLabel(d)) { label.classList.remove('is-on'); return; }
        const b = label.getBBox();
        if (!b.width) return;
        const was = label.classList.contains('is-on');
        // where it goes: below the node, or above it if that's free and below isn't
        const up = (-d.r - 6) - (b.y + b.height);
        const spots = [0, up].map((dy) => ({ dy, x: d.x + b.x - 2, y: d.y + b.y + dy - 1, w: b.width + 4, h: b.height + 2 }));
        if (d.labelUp) spots.reverse();          // keep the side it's on unless it has to move
        items.push({ label, d, spots, p: labelPriority(d) + (was ? .1 : 0) });
      });
      items.sort((a, b) => b.p - a.p || (b.d.plays || 0) - (a.d.plays || 0));
      const kept = [];
      // labels also shouldn't sit on top of other nodes' artwork
      const bodies = nodes.map((n) => ({ x: n.x - n.r, y: n.y - n.r, w: n.r * 2, h: n.r * 2, n }));
      const hit = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
      for (const it of items) {
        const free = (box) => !kept.some((k) => hit(box, k)) && (it.p >= 5 || !bodies.some((b) => b.n !== it.d && hit(box, b)));
        // tracks only use the spot below; shows and episodes may move above
        const clearOfLabels = (box) => !kept.some((k) => hit(box, k));
        const spot = it.d.type === 'track' ? it.spots.filter((x) => x.dy === 0).find(free)
          // shows and episodes: last resort, over another node's cover rather than nameless
          : it.spots.find(free) || it.spots.find(clearOfLabels);
        it.label.classList.toggle('is-on', !!spot);
        if (!spot) continue;
        it.d.labelUp = spot.dy !== 0;
        it.label.setAttribute('transform', spot.dy ? `translate(0,${spot.dy})` : '');
        kept.push(spot);
      }
      // say so when names are hidden, so it doesn't look like a bug
      const hidden = items.length - kept.length;
      const note = host.querySelector('.trackweb__crowd');
      note.hidden = hidden === 0;
      note.textContent = hidden ? `${hidden} name${hidden === 1 ? '' : 's'} hidden · zoom in or hover to see` : '';
    });
  }

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
      if (d.type === 'track') {
        d.inWeb = deg.get(d.id) || 0;
        if (d.plays != null && d.inWeb > d.plays) d.plays = d.inWeb;   // search can lag behind brand-new episodes
      }
      if (d.type === 'episode') {
        // bigger episode = more of its tracks are shared with other episodes in the web
        d.shared = links.filter((l) => l.kind !== 'show' && (l.source === d || l.target === d))
          .filter((l) => (deg.get((l.source === d ? l.target : l.source).id) || 0) >= 2).length;
        d.r = 12 + Math.min(10, d.shared * 1.5);
      }
    });
    sim?.force('collide')?.radius(spaceFor);
    gNodes.selectAll('g.tw-node')
      .classed('is-root', (d) => d.id === rootId)
      .classed('is-selected', (d) => d === selected)
      .classed('is-expanded', (d) => d.expanded)
      .classed('is-loading', (d) => d.loading || (d.artLoading && !d.img))
      .classed('has-img', (d) => !!d.img)
      .classed('is-popular', (d) => d.plays >= 3)
      .classed('is-shared', (d) => d.type === 'track' && d.inWeb >= 2)
      .classed('is-playing', (d) => !!follow && d.id === follow.playingId)
      .classed('is-off', (d) => timelineOn() && d !== follow.ep && !follow.shown.has(d.id))
      .classed('is-new', (d) => !!d.popAt && Date.now() - d.popAt < 900)
      .style('--pop-delay', (d) => (d.popDelay ? `${d.popDelay}ms` : null))
      .classed('is-followed', (d) => d.type !== 'track' && typeof Following !== 'undefined' && Following.has(d.show))
      .each(function (d) {
        const g = d3.select(this);
        const r = d.r;
        if (d.type === 'track') {
          g.selectAll('.tw-shape, .tw-ring, .tw-pulse').attr('r', r);
          g.select('.tw-hole').attr('r', Math.max(2, r * .32));
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

  let lastCull = 0;
  function ticked() {
    if (timelineOn()) gAxis.selectAll('line.tw-stem').attr('x1', (d) => d.x).attr('y1', (d) => d.y);
    if (Date.now() - lastCull > 700) { lastCull = Date.now(); cullLabels(); }
    cullLabelsSoon();     // and once more when the movement stops, from where nodes ended up
    gLinks.selectAll('line')
      .attr('x1', (d) => d.source.x).attr('y1', (d) => d.source.y)
      .attr('x2', (d) => d.target.x).attr('y2', (d) => d.target.y);
    gNodes.selectAll('g.tw-node').attr('transform', (d) => `translate(${d.x},${d.y})`);
  }

  // Hover reacts after a short pause, so brushing past nodes (or nodes drifting under a
  // still cursor) doesn't flash the whole web
  let hoverTimer = null;
  function hoverSoon(d) {
    clearTimeout(hoverTimer);
    hoverTimer = setTimeout(() => {
      if (hovered === d) return;
      hovered = d;
      highlight(d);
      gNodes.selectAll('g.tw-node').classed('is-hover', (n) => n === d);
      if (d) gNodes.selectAll('g.tw-node').filter((n) => n === d).raise();   // its label sits on top
    }, d ? 140 : 220);
  }

  function highlight(d) {
    const near = new Set();
    if (d) { near.add(d.id); links.forEach((l) => { if (l.source.id === d.id) near.add(l.target.id); if (l.target.id === d.id) near.add(l.source.id); }); }
    gNodes.selectAll('g.tw-node').classed('is-dim', (n) => d && !near.has(n.id));
    gLinks.selectAll('line').classed('is-lit', (l) => d && (l.source.id === d.id || l.target.id === d.id))
      .classed('is-dim', (l) => d && l.source.id !== d.id && l.target.id !== d.id);
  }

  // ---------- interaction ----------
  function expand(d) {
    if (d.expanded || d.loading) return;
    if (d.type === 'track') expandTrack(d);
    else if (d.type === 'episode') expandEpisode(d);
    else addShowEpisodes(d);
  }
  function select(d) { selected = d; paintNodes(); paintInfo(); sim?.force('collide')?.radius(spaceFor); cullLabels(); if (timelineOn()) compareTrack(d); }

  // Episodes this track can be played from (with its position), the one we found it
  // through first; for a searched-for track, its latest episode
  // Every episode in the web that played this track. The time comes from the episode's
  // tracklist: known when we expanded that episode, otherwise looked up (lookupOffsets).
  // offset null = still looking; NaN = the tracklist gives no time (plays from the start).
  function playOptions(t) {
    const opts = [];
    for (const l of links) {
      if (l.kind === 'show') continue;
      const other = l.source.id === t.id ? l.target : l.target.id === t.id ? l.source : null;
      if (other?.type === 'episode') opts.push({ ep: other, offset: l.offset ?? null, link: l });
    }
    // the episode we found it through first, then ones with a known time
    const rank = (o) => (o.ep.id === t.via ? 2 : 0) + (Number.isFinite(o.offset) ? 1 : 0);
    opts.sort((a, b) => rank(b) - rank(a));
    if (!opts.length && t.viaMatch?.offset != null) {
      const m = t.viaMatch;
      opts.push({ ep: { show: m.show, episode: m.episode, title: m.title, date: m.date }, offset: m.offset });
    }
    return opts;
  }
  const playableEpisode = (t) => playOptions(t)[0] || null;

  const tracklists = new Map();   // episode id -> Promise of its tracklist
  const sameTrack = (x, t) => trackId(x) === t.id || trackId({ artist: x.title, title: x.artist }) === t.id;
  async function lookupOffsets(t) {
    const missing = playOptions(t).filter((o) => o.offset == null && o.link);
    if (!missing.length) return false;
    await Promise.all(missing.map(async (o) => {
      const id = o.ep.id;
      if (!tracklists.has(id)) tracklists.set(id, window.nts.api(`/api/v2/shows/${o.ep.show}/episodes/${o.ep.episode}/tracklist`).catch(() => null));
      const tl = await tracklists.get(id);
      const rows = tl?.results || [];
      const hit = rows.find((x) => x.title && sameTrack(x, t)) || rows.find((x) => x.title && Archive.sameTrack(x, t));
      const off = hit ? (hit.offset ?? hit.offset_estimate) : null;
      o.link.offset = off != null ? off : NaN;
    }));
    return true;
  }

  function paintInfo() {
    const box = host.querySelector('.trackweb__info');
    box.replaceChildren();
    box.scrollTop = 0;
    const d = selected;
    const hint = el('p', 'trackweb__hint',
      !nodes.length ? 'Search for a track or a show, start from the one playing, or follow along.'
        : d ? '' : follow ? `Following along: each track appears as it plays (${follow.shown.size} so far). Click one to select it, or expand it to see where else it was played.` : `${nodes.filter((n) => n.type === 'track').length} tracks · ${nodes.filter((n) => n.type === 'episode').length} episodes. Click a node to select it, double-click to expand it. Bigger tracks, with a number, were played in more episodes.`);
    if (!d) { box.append(hint); return; }
    const title = el('p', 'trackweb__title', d.title);
    if (d.type === 'show') return paintShowInfo(box, d);
    const playsText = d.plays ? ` · played in ${d.plays >= 50 ? '50+' : d.plays} NTS episode${d.plays === 1 ? '' : 's'}` : '';
    // An episode node is one broadcast: say which, and offer the rest of the show
    const inWebText = d.inWeb >= 2 ? ` · in ${d.inWeb} episodes here` : d.expanded && d.noOtherPlays ? ' · not found in any other NTS episode' : '';
    const sub = el('p', 'trackweb__sub', d.type === 'track' ? `${d.artist}${playsText}${inWebText}`
      : `${d.date ? `Episode of ${d.date}` : 'Episode'}${d.trackCount ? ` · ${d.trackCount} tracks` : ''}${d.shared ? ` · ${d.shared} shared` : ''}`);
    const actions = el('div', 'trackweb__actions');
    if (d.type === 'track') {
      const opts = playOptions(d);
      const p = opts[0];
      if (p) {
        const play = el('button', 'episode-play trackweb__play');
        let choice = p;
        const paintPlay = () => {
          play.disabled = choice.offset == null;
          play.textContent = choice.offset == null ? '▶ Finding the time…'
            : Number.isFinite(choice.offset) ? `▶ Play from ${fmtOffset(choice.offset)}` : '▶ Play episode';
          play.title = Number.isFinite(choice.offset) ? '' : 'This episode’s tracklist has no times, so it plays from the start';
        };
        paintPlay();
        play.addEventListener('click', () => Archive.playFrom(choice.ep.show, choice.ep.episode, Number.isFinite(choice.offset) ? choice.offset : 0));
        // times we don't know yet: look them up, then redraw this panel
        if (opts.some((o) => o.offset == null)) lookupOffsets(d).then((changed) => { if (changed && selected === d) paintInfo(); });
        actions.append(play);
        if (opts.length > 1) {
          const pick = el('select', 'trackweb__pick');
          pick.setAttribute('aria-label', 'Episode to play it from');
          opts.forEach((o, i) => { const op = el('option', null, `in ${o.ep.title}${o.ep.date ? ' · ' + o.ep.date : ''}${Number.isNaN(o.offset) ? ' (no time listed)' : ''}`); op.value = i; pick.append(op); });
          pick.addEventListener('change', () => { choice = opts[Number(pick.value)]; paintPlay(); });
          actions.append(pick);
        } else {
          actions.append(el('span', 'trackweb__in', `in ${p.ep.title}${p.ep.date ? ' · ' + p.ep.date : ''}${Number.isNaN(p.offset) ? ' · no time listed, plays from the start' : ''}`));
        }
      }
      if (!d.expanded) actions.append(btn(d.loading ? 'Finding episodes…' : 'Expand: other episodes', () => expand(d)));
      actions.append(btn('Details', () => openInPanel(() => Archive.showTrack(d.artist, d.title))));
      actions.append(btn('Start a web here', () => start({ artist: d.artist, title: d.title, isrc_id: d.isrc_id, deezer_track_id: d.deezer_track_id })));
      if (p && supporter) {
        actions.append(btn('Save to My NTS', async (b) => {
          b.classList.add('mynts-btn--busy');
          const res = await MyNTS.toggleTrack(p.ep.show, p.ep.episode, d, true, { show: p.ep.show, episode: p.ep.episode, title: p.ep.title, date: p.ep.date, offset: Number.isFinite(p.offset) ? p.offset : null });
          b.classList.remove('mynts-btn--busy');
          if (res && !res.error) { b.textContent = 'Saved'; b.classList.add('mynts-btn--on'); }
        }));
      }
    } else {
      if (!d.expanded) actions.append(btn(d.loading ? 'Loading tracklist…' : 'Expand: tracklist', () => expand(d)));
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
    if (compare?.track === d && compare.status) box.append(el('p', 'trackweb__lanes-note', compare.status));
    if (compare?.track === d && compare.shared?.length) {
      const wrap = el('div', 'trackweb__shared');
      wrap.append(el('span', 'trackweb__top-label', 'Also in several of these sets'));
      compare.shared.slice(0, 8).forEach((s) => {
        const b = el('button', `tag${compare.focus === s.id ? ' tag--on' : ''}`, `${s.title} · ${s.artist} (${s.sets} sets)`);
        b.addEventListener('click', () => { compare.focus = compare.focus === s.id ? null : s.id; focusShared(); paintInfo(); });
        wrap.append(b);
      });
      box.append(wrap);
    }
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
    clearLanes();
    nodes = []; links = []; byId = new Map(); linkIds = new Set(); selected = null; rootId = null;
    if (gNodes) { gNodes.selectAll('*').remove(); gLinks.selectAll('*').remove(); svg.call(zoom.transform, d3.zoomIdentity); }
  }
  // origin (optional): the episode we know it's in { show, episode, title, date, offset }
  function start(t, origin) {
    stopFollow();
    build(); center(); clear();
    const n = addNode({ id: trackId(t), type: 'track', artist: t.artist, title: t.title, isrc_id: t.isrc_id, deezer_track_id: t.deezer_track_id });
    rootId = n.id;
    if (origin?.show && origin?.episode) {
      const e = addNode({ id: epId(origin.show, origin.episode), type: 'episode', show: origin.show, episode: origin.episode,
        title: origin.title || origin.show, date: origin.date || '', near: n.id });
      addLink(n, e, { offset: origin.offset ?? null });
      if (origin.offset != null) n.via = e.id;
    }
    update();
    select(n);
    expandTrack(n);
  }

  function startShow(alias, name) {
    stopFollow();
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
    if (t) start(t, currentOrigin(t)); else showSnack('Nothing with a track ID is playing right now');
  });
  // ---------- follow along ----------
  // The episode (or live show) you're hearing sits in the middle; each track pops in
  // around it as it starts playing, and the one playing pulses.
  let follow = null;     // { key, ep, shown: Set of track ids, playingId }
  const followBtn = host.querySelector('.trackweb__follow');
  followBtn.addEventListener('click', () => (follow ? stopFollow() : startFollow()));
  function hearing() {
    if (source === 'archive' && ArchivePlayer.state.episode) {
      const ep = ArchivePlayer.state.episode;
      return { key: `a|${ep.show}/${ep.episode}`, kind: 'archive', show: ep.show, episode: ep.episode, title: ep.title, date: ep.date };
    }
    if (source === 'live' && playing) {
      const r = live?.results?.[channel];
      const info = r ? showInfo(r) : null;
      if (info?.show && info?.episode) return { key: `l|${channel}|${info.episode}`, kind: 'live', show: info.show, episode: info.episode, title: info.title, date: '' };
    }
    return null;
  }
  function startFollow(quiet) {
    const h = hearing();
    if (!h) { if (!quiet) showSnack('Play an episode or live radio to follow along'); return false; }
    build(); center(); clear();
    const ep = addNode({ id: epId(h.show, h.episode), type: 'episode', show: h.show, episode: h.episode, title: h.title, date: h.date });
    ep.fx = 0; ep.fy = 0;          // the show stays in the middle; tracks gather around it
    rootId = ep.id;
    follow = { key: h.key, kind: h.kind, ep, shown: new Set(), playingId: null };
    followBtn.classList.add('mynts-btn--on'); followBtn.textContent = 'Following'; followBtn.setAttribute('aria-pressed', 'true');
    update();
    followTick(true);
    applyLayout(true);
    paintInfo();
    return true;
  }
  function stopFollow() {
    if (!follow) return;
    if (follow.ep) { follow.ep.fx = null; follow.ep.fy = null; }
    follow = null;
    followBtn.classList.remove('mynts-btn--on'); followBtn.textContent = 'Follow along'; followBtn.setAttribute('aria-pressed', 'false');
    applyLayout();
    schedulePaint();
  }

  // ---------- layouts: web, or a timeline of the episode ----------
  let layout = (() => { try { return localStorage.getItem('trackwebLayout') === 'timeline' ? 'timeline' : 'web'; } catch { return 'web'; } })();
  const layoutBox = host.querySelector('.trackweb__layout');
  layoutBox.addEventListener('click', (e) => {
    const b = e.target.closest('[data-layout]');
    if (!b || b.dataset.layout === layout) return;
    layout = b.dataset.layout;
    try { localStorage.setItem('trackwebLayout', layout); } catch {}
    if (follow) follow.userZoomed = false;
    applyLayout(true);
  });
  const timelineOn = () => !!follow && layout === 'timeline';
  // where a followed track sits on the timeline
  let tl = null;     // { x: sec -> x, start, end, timed, dur }
  function timelineItems() { return nodes.filter((n) => follow.shown.has(n.id)).sort((a, b) => a.fIndex - b.fIndex); }
  function applyLayout(refit) {
    layoutBox.hidden = !follow;
    layoutBox.querySelectorAll('[data-layout]').forEach((b) => {
      b.classList.toggle('active', b.dataset.layout === layout);
      b.setAttribute('aria-selected', String(b.dataset.layout === layout));
    });
    if (!sim) return;
    svg.classed('is-timeline', timelineOn());
    if (timelineOn()) {
      const items = timelineItems();
      const timed = items.length > 0 && items.every((n) => Number.isFinite(n.fOffset));
      const durSec = follow.kind === 'archive' && ArchivePlayer.state.duration ? ArchivePlayer.state.duration / 1000
        : Math.max(600, ...items.map((n) => (n.fOffset || 0) + 300));
      const W = Math.max(900, (durSec / 60) * 16);          // 16 px a minute
      const x = timed ? (sec) => (sec / durSec) * W - W / 2 : null;
      items.forEach((n, i) => {
        n.tx = timed ? x(n.fOffset) : i * 95 - ((items.length - 1) * 95) / 2;
        n.ty = rowY(n.fIndex ?? i);
      });
      const start = timed ? x(0) : (items[0]?.tx ?? 0) - 40;
      const end = timed ? x(durSec) : (items[items.length - 1]?.tx ?? 0) + 40;
      tl = { x, start, end, timed, dur: durSec };
      follow.ep.fx = start - 80; follow.ep.fy = 0;
      sim.force('x', d3.forceX((d) => d.tx ?? 0).strength((d) => (d.tx != null ? .4 : 0)));
      sim.force('y', d3.forceY((d) => d.ty ?? 0).strength((d) => (d.ty != null ? .4 : 0)));
      sim.force('link').strength(0);
      sim.force('charge').strength(-30);
      drawAxis(items);
      refitTimeline(compare?.lanes.length ? -235 - (Math.min(compare.lanes.length, FIT_LANES) - 1) * 85 - 40 : undefined);
    } else {
      tl = null;
      clearLanes();
      nodes.forEach((n) => { n.tx = undefined; n.ty = undefined; });
      sim.force('x', d3.forceX(0).strength(.03));
      sim.force('y', d3.forceY(0).strength(.03));
      sim.force('link').strength((l) => (l.kind === 'show' ? .3 : .5));
      sim.force('charge').strength(-340);
      if (follow) { follow.ep.fx = 0; follow.ep.fy = 0; }
      gAxis.selectAll('*').remove();
      if (follow && refit && !follow.userZoomed) {
        const k = Math.max(0.9, Math.min(2, 2.2 - Math.sqrt(follow.shown.size) * 0.22));
        svg.transition().duration(600).call(zoom.transform, d3.zoomIdentity.scale(k));
      }
    }
    sim.alpha(.6).restart();
    schedulePaint();
  }
  // a small play triangle, centred in a circle of radius r
  const playPath = (r) => { const s = r * 0.42; return `M${-s * 0.75},${-s} L${s * 1.05},0 L${-s * 0.75},${s} Z`; };
  // alternate above and below the axis, two rows each (by place in the tracklist)
  const rowY = (i) => (i % 2 ? 1 : -1) * (i % 4 >= 2 ? 150 : 85);
  // Tracks still to come in the episode: grey circles where they'll pop in. Click one to skip there.
  function drawUpcoming() {
    const a = ArchivePlayer.state;
    const tracks = follow?.kind === 'archive' && tl?.timed ? (a.episode?.tracks || []).filter((t) => t.title) : [];
    const ahead = tracks.map((t, i) => ({ t, i, off: t.offset ?? t.offset_estimate }))
      .filter((u) => Number.isFinite(u.off) && !follow.shown.has(trackId(u.t)));
    const sel = gAxis.selectAll('g.tw-ahead').data(ahead, (u) => trackId(u.t));
    sel.exit().remove();
    const en = sel.enter().append('g').attr('class', 'tw-ahead')
      .on('click', (e, u) => { e.stopPropagation(); Archive.playFrom(follow.ep.show, follow.ep.episode, u.off); });
    en.append('line').attr('class', 'tw-ahead__stem');
    en.append('circle').attr('r', 8);
    en.append('path').attr('class', 'tw-play-icon').attr('d', playPath(8));
    en.append('title');
    en.merge(sel)
      .attr('transform', (u) => `translate(${tl.x(u.off)},${rowY(u.i)})`)
      .each(function (u) {
        d3.select(this).select('line').attr('x1', 0).attr('y1', 0).attr('x2', 0).attr('y2', -rowY(u.i));
        d3.select(this).select('title').text(`Coming up at ${fmtOffset(u.off)}: ${u.t.artist} – ${u.t.title}. Play from here`);
      });
  }
  function drawAxis(items) {
    gAxis.selectAll('line.tw-axis__line').data([0]).join('line').attr('class', 'tw-axis__line')
      .attr('x1', tl.start).attr('x2', tl.end).attr('y1', 0).attr('y2', 0);
    // a tick every 10 minutes (15 for long episodes)
    const every = tl.dur > 7200 ? 900 : 600;
    const ticks = tl.timed ? d3.range(0, tl.dur + 1, every) : [];
    gAxis.selectAll('g.tw-tick').data(ticks).join((en) => { const g = en.append('g').attr('class', 'tw-tick'); g.append('line').attr('y1', -4).attr('y2', 4); g.append('text').attr('y', 16); return g; })
      .attr('transform', (s) => `translate(${tl.x(s)},0)`)
      .select('text').text((s) => fmtOffset(s));
    gAxis.selectAll('line.tw-stem').data(items, (d) => d.id).join('line').attr('class', 'tw-stem')
      .attr('x2', (d) => d.tx).attr('y2', 0).attr('x1', (d) => d.x).attr('y1', (d) => d.y);
    drawUpcoming();
    movePlayhead();
  }
  // ---------- timeline: the same track in other episodes, lined up above ----------
  // Click a track in the timeline: every other episode that played it appears above (up
  // to the 50 NTS's search returns), each shifted so that track sits right above it, on
  // the same time scale. The view fits the first few; drag down for the rest.
  const FIT_LANES = 4;
  let compare = null;      // { track, lanes, status }
  let compareToken = 0;
  function clearLanes() {
    compareToken++;
    compare = null;
    gLanes?.selectAll('*').remove();
  }
  const rowOffset = (r) => r.offset ?? r.offset_estimate;
  async function compareTrack(d) {
    const token = ++compareToken;
    gLanes.selectAll('*').remove();
    compare = null;
    if (!d || d.type !== 'track' || !follow?.shown.has(d.id)) { refitTimeline(); return; }
    compare = { track: d, lanes: [], status: 'Finding other episodes that played it…' };
    paintInfo();
    const info = await Archive.findTrack({ artist: d.artist, title: d.title }).catch(() => null);
    if (token !== compareToken) return;
    const eps = (info?.plays || []).map((p) => {
      const m = /^\/shows\/([^/]+)\/episodes\/([^/]+)/.exec(p.path || '');
      return m && { show: m[1], episode: m[2], title: p.title, date: p.date };
    }).filter((e) => e && epId(e.show, e.episode) !== follow.ep.id);
    const total = Math.max(eps.length, (d.plays || 0) - 1);    // other episodes it was played in
    if (!eps.length) { compare.status = 'Not found in any other NTS episode.'; paintInfo(); return; }
    let done = 0;
    const progress = () => { compare.status = `Lining up ${eps.length} other episode${eps.length === 1 ? '' : 's'}… ${done} of ${eps.length}`; paintInfo(); };
    progress();
    const lineUp = async (ep) => {
      const id = epId(ep.show, ep.episode);
      if (!tracklists.has(id)) tracklists.set(id, window.nts.api(`/api/v2/shows/${ep.show}/episodes/${ep.episode}/tracklist`).catch(() => null));
      const rows = ((await tracklists.get(id))?.results || []).filter((r) => r.title);
      const hit = rows.find((r) => sameTrack(r, d)) || rows.find((r) => Archive.sameTrack(r, d));
      if (!hit) return null;                                    // not in that tracklist after all
      const anchor = rowOffset(hit);
      if (Number.isFinite(anchor)) {
        rows.forEach((r) => { r.at = rowOffset(r); });
        return { ep, rows: rows.filter((r) => Number.isFinite(r.at)), anchor, hit };
      }
      // no times listed: space its tracks evenly in tracklist order, still lined up on this one
      rows.forEach((r, i) => { r.at = i * 240; });
      return { ep, rows, anchor: hit.at, hit, approx: true };
    };
    // four tracklists at a time, counting as they come in
    const lanes = new Array(eps.length);
    let next = 0;
    await Promise.all(Array.from({ length: 4 }, async () => {
      while (next < eps.length && token === compareToken) {
        const i = next++;
        lanes[i] = await lineUp(eps[i]).catch(() => null);
        done++;
        if (token === compareToken && (done % 3 === 0 || done === eps.length)) progress();
      }
    }));
    if (token !== compareToken) return;
    const found = lanes.filter(Boolean);
    const when = (l) => Date.parse(l.ep.date) || 0;
    const ok = found.sort((a, b) => when(b) - when(a));      // newest just above your episode, oldest at the top
    compare.lanes = ok;
    const approx = ok.filter((l) => l.approx).length;
    compare.status = ok.length
      ? `${ok.length < total ? `Showing ${ok.length} of ${total >= 49 ? '50+' : total}` : `Also in ${ok.length}`} other episode${total === 1 ? '' : 's'}, lined up above at this track${approx ? ` (${approx} with no times listed: spaced evenly, dashed)` : ''}.${ok.length > FIT_LANES ? ' Drag down to see them all.' : ''} Press play on any track up there to jump into that episode.`
      : `NTS lists it in ${eps.length} other episode${eps.length === 1 ? '' : 's'}, but couldn't find it in ${eps.length === 1 ? 'that tracklist' : 'their tracklists'}.`;
    drawLanes(d);
    paintInfo();
  }
  function drawLanes(d) {
    gLanes.selectAll('*').remove();
    if (!compare?.lanes.length || !tl) return;
    const pps = tl.timed ? tl.x(1) - tl.x(0) : 16 / 60;       // the main timeline's pixels per second
    const ax = d.tx ?? d.x;                                   // where the track sits on the main timeline
    const TOP = -235, GAP = 85;
    const lastY = TOP - (compare.lanes.length - 1) * GAP;
    gLanes.append('line').attr('class', 'tw-lane__align').attr('x1', ax).attr('x2', ax).attr('y1', -20).attr('y2', lastY - 26);
    // tracks that turn up in more than one of these sets (yours included), and where
    const mainTracks = follow?.kind === 'archive' ? (ArchivePlayer.state.episode?.tracks || []).filter((t) => t.title) : [];
    const sets = new Map();          // track id -> number of sets it's in
    const bump = (ids) => ids.forEach((id) => sets.set(id, (sets.get(id) || 0) + 1));
    bump(new Set(mainTracks.map(trackId)));
    compare.lanes.forEach((l) => bump(new Set(l.rows.map(trackId))));
    // the selected track itself, under any of its credits, isn't a neighbour
    const self = new Set([d.id, ...compare.lanes.map((l) => trackId(l.hit))]);
    const isShared = (id) => !self.has(id) && (sets.get(id) || 0) >= 2;
    const seen = new Map();          // track id -> [{ x, y }] where it appears
    const at = (id, p) => { if (!seen.has(id)) seen.set(id, []); seen.get(id).push(p); };
    mainTracks.forEach((t, i) => {
      const id = trackId(t);
      if (!isShared(id)) return;
      const n = byId.get(id);
      const off = t.offset ?? t.offset_estimate;
      if (n && n.tx != null) at(id, { x: n.tx, y: n.ty });
      else if (tl.timed && Number.isFinite(off)) at(id, { x: tl.x(off), y: rowY(i) });
    });
    const gLinksShared = gLanes.append('g').attr('class', 'tw-shared-links');
    compare.lanes.forEach((lane, k) => {
      const y = TOP - k * GAP;
      const x = (sec) => ax + (sec - lane.anchor) * pps;
      const last = Math.max(...lane.rows.map((r) => r.at));
      const g = gLanes.append('g').attr('class', `tw-lane${lane.approx ? ' is-approx' : ''}`).attr('transform', `translate(0,${y})`).style('--lane-delay', `${k * 90}ms`);
      g.append('line').attr('class', 'tw-lane__line').attr('x1', x(0)).attr('x2', x(last + 240)).attr('y1', 0).attr('y2', 0);
      // the episode's name next to the lined-up track (the lane's start may be off screen)
      // where it fell in that set
      const hi = lane.rows.indexOf(lane.hit);
      const where = hi <= 0 ? 'opened with it' : hi >= lane.rows.length - 1 ? 'closed with it'
        : `${Math.round((lane.anchor / (last + 240)) * 100)}% in`;
      g.append('text').attr('class', 'tw-lane__title').attr('x', ax + 18).attr('y', -16)
        .text(`${clip(lane.ep.title, 40)}${lane.ep.date ? ' · ' + lane.ep.date : ''} · ${where}${lane.approx ? ' · no times listed' : ''}`);
      lane.rows.forEach((row) => {
        const anchor = row === lane.hit;
        const id = trackId(row);
        const shared = isShared(id);
        const r = anchor ? 12 : shared ? 10 : 8;
        if (shared) at(id, { x: x(row.at), y });
        const t = g.append('g').attr('class', `tw-lane__track${anchor ? ' is-anchor' : ''}${shared ? ' is-shared' : ''}`).attr('data-id', id).attr('transform', `translate(${x(row.at)},0)`)
          .on('click', (e) => { e.stopPropagation(); Archive.playFrom(lane.ep.show, lane.ep.episode, lane.approx ? 0 : row.at); });
        t.append('circle').attr('class', 'tw-lane__dot').attr('r', r);
        const img = t.append('image').attr('x', -r).attr('y', -r).attr('width', r * 2).attr('height', r * 2)
          .attr('clip-path', 'url(#tw-circle)').attr('preserveAspectRatio', 'xMidYMid slice');
        t.append('circle').attr('class', 'tw-lane__ring').attr('r', r);
        t.append('circle').attr('class', 'tw-lane__shade').attr('r', r);       // darkens the cover on hover
        t.append('path').attr('class', 'tw-play-icon').attr('d', playPath(r));
        t.append('text').attr('class', 'tw-lane__label').attr('y', r + 11).text(clip(`${row.title}`, 22));
        t.append('title').text(lane.approx ? `${row.artist} – ${row.title}. No time listed: plays ${lane.ep.title} from the start`
          : `${row.artist} – ${row.title} · ${fmtOffset(row.at)}. Play from here in ${lane.ep.title}`);
        const loadCover = () => {
          if (img.attr('href') || t.property('coverAsked')) return;
          t.property('coverAsked', true);
          Art.get({ artist: row.artist, title: row.title, isrc_id: row.isrc_id, deezer_track_id: row.deezer_track_id })
            .then((a) => { if (a?.small) img.attr('href', a.small); }).catch(() => {});
        };
        if (shared || (k < FIT_LANES * 2 && Math.abs(lane.rows.indexOf(row) - lane.rows.indexOf(lane.hit)) <= 4)) loadCover();
        else t.on('mouseenter', loadCover);
      });
    });
    // join each shared track's appearances, top to bottom
    const line = d3.line().curve(d3.curveMonotoneY);
    gLinksShared.selectAll('path').data([...seen].filter(([, pts]) => pts.length >= 2)).join('path')
      .attr('class', 'tw-shared-link').attr('data-id', ([id]) => id)
      .attr('d', ([, pts]) => line(pts.slice().sort((a, b) => a.y - b.y).map((p) => [p.x, p.y])));
    // markers on your own timeline for the shared ones
    gLinksShared.selectAll('circle').data([...seen].filter(([, pts]) => pts.length >= 2).map(([id, pts]) => ({ id, p: pts.find((q) => q.y > TOP + 40) })).filter((m) => m.p))
      .join('circle').attr('class', 'tw-shared-mark').attr('data-id', (m) => m.id).attr('r', 13).attr('cx', (m) => m.p.x).attr('cy', (m) => m.p.y);
    // the list in the panel: most sets first
    const byTrack = new Map();
    compare.lanes.forEach((l) => l.rows.forEach((r) => { const id = trackId(r); if (isShared(id) && !byTrack.has(id)) byTrack.set(id, { id, title: r.title, artist: r.artist, sets: sets.get(id) }); }));
    compare.shared = [...byTrack.values()].sort((a, b) => b.sets - a.sets);
    focusShared();
    refitTimeline(TOP - (Math.min(compare.lanes.length, FIT_LANES) - 1) * GAP - 40);
  }
  // one shared track picked in the panel: light it up, fade the rest
  function focusShared() {
    const f = compare?.focus;
    gLanes.classed('has-focus', !!f);
    gLanes.selectAll('[data-id]').classed('is-focus', function () { return !!f && this.getAttribute('data-id') === f; });
  }
  // fit the timeline (and any lanes above it) in view, unless you've zoomed yourself
  function refitTimeline(topY) {
    if (!tl || follow?.userZoomed) return;
    const r = host.querySelector('.trackweb__svg').getBoundingClientRect();
    const x0 = tl.start - 80, x1 = tl.end;        // your episode's width; other episodes may run off the sides
    const y0 = Math.min(-200, topY ?? -200), y1 = 200;
    const k = Math.max(0.25, Math.min(1.6, Math.min(r.width / (x1 - x0 + 140), r.height / (y1 - y0 + 40))));
    svg.transition().duration(700).call(zoom.transform, d3.zoomIdentity.scale(k).translate(-(x0 + x1) / 2, -(y0 + y1) / 2));
  }


  function movePlayhead() {
    if (!tl) return;
    const show = tl.timed && follow.kind === 'archive';
    const x = show ? tl.x(ArchivePlayer.state.position / 1000) : 0;
    gAxis.selectAll('line.tw-playhead').data(show ? [0] : []).join('line').attr('class', 'tw-playhead')
      .attr('y1', -190).attr('y2', 190).style('transform', `translateX(${x}px)`);
  }
  // The tracks heard so far, oldest first, and which one is playing
  function heardSoFar() {
    if (follow.kind === 'archive') {
      const a = ArchivePlayer.state;
      const tracks = (a.episode?.tracks || []).filter((t) => t.title);
      if (!tracks.some((t) => (t.offset ?? t.offset_estimate) != null)) return { tracks, playing: -1, untimed: true };
      const pos = a.position / 1000;
      let idx = -1;
      tracks.forEach((t, i) => { const o = t.offset ?? t.offset_estimate; if (o != null && o <= pos) idx = i; });
      return { tracks: tracks.slice(0, idx + 1), playing: idx };
    }
    const log = LiveNow.log().slice().reverse();
    const cur = LiveNow.track;
    const id = (t) => trackId(t);
    if (cur && !log.some((t) => id(t) === id(cur))) log.push(cur);
    return { tracks: log, playing: cur ? log.findIndex((t) => id(t) === id(cur)) : -1 };
  }
  function followTick(initial) {
    if (!follow) return;
    const h = hearing();
    if (!h) return;
    if (h.key !== follow.key) { startFollow(true); return; }      // the next episode started
    const { tracks, playing: idx, untimed } = heardSoFar();
    let added = 0;
    tracks.forEach((t, i) => {
      const id = trackId(t);
      if (follow.shown.has(id)) return;
      const n = addNode({ id, type: 'track', artist: t.artist, title: t.title, isrc_id: t.isrc_id, deezer_track_id: t.deezer_track_id, near: follow.ep.id });
      if (!n) return;
      follow.shown.add(id);
      n.popAt = Date.now();
      n.popDelay = Math.min(added, 20) * 60;     // several at once (seeking ahead): one after another
      if (!n.via) n.via = follow.ep.id;
      n.fOffset = t.offset ?? t.offset_estimate ?? null;
      n.fIndex = i;            // its place in the tracklist (sets its row on the timeline)
      addLink(n, follow.ep, { offset: n.fOffset });
      added++;
    });
    // a small web starts close up and zooms out gently as it grows
    if (added && !follow.userZoomed && !timelineOn()) {
      const k = Math.max(0.9, Math.min(2, 2.2 - Math.sqrt(follow.shown.size) * 0.22));
      svg.transition().duration(initial ? 0 : 900).call(zoom.transform, d3.zoomIdentity.scale(k));
    }
    if (timelineOn()) { if (added) applyLayout(initial); else movePlayhead(); }
    const playingId = idx >= 0 && tracks[idx] ? trackId(tracks[idx]) : null;
    const changed = added || playingId !== follow.playingId;
    follow.playingId = playingId;
    if (added) { update(); if (untimed && initial) showSnack('This tracklist has no times, so every track is shown'); }
    if (changed) { schedulePaint(); if (!selected) paintInfo(); setTimeout(schedulePaint, 1000); }
  }
  let followTimer = null;
  ArchivePlayer.onChange(() => { if (follow && !followTimer) followTimer = setTimeout(() => { followTimer = null; followTick(); }, 400); });
  setInterval(() => { if (follow) followTick(); }, 5000);

  // The episode the current track is playing in
  function currentOrigin(t) {
    if (source === 'archive' && ArchivePlayer.state.episode) {
      const ep = ArchivePlayer.state.episode;
      return { show: ep.show, episode: ep.episode, title: ep.title, date: ep.date, offset: t.offset ?? t.offset_estimate };
    }
    const r = live?.results?.[channel];
    const info = r ? showInfo(r) : null;
    return info?.episode ? { show: info.show, episode: info.episode, title: info.title, date: info.start ? fmtDate(info.start) : '' } : null;
  }

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
    show() { build(); center(); if (!nodes.length && !startFollow(true)) { const t = currentTrack(); if (t) start(t, currentOrigin(t)); else paintInfo(); } },
    get empty() { return !nodes.length; }
  };
})();
