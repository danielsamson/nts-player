// Track web (prototype): explore NTS through what DJs played.
// Round nodes are tracks (with their cover), square nodes are episodes. A line means
// "this episode played this track". Click a node to expand it: a track shows the
// episodes that played it, an episode shows its tracklist. Drag to move, scroll to zoom.
// Uses: Archive.findTrack (NTS track search), the NTS API, Art (covers), MyNTS.

const TrackWeb = (() => {
  const host = $('trackweb');
  const MAX_NODES = 320;
  const norm = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  const trackId = (t) => `t:${norm(t.artist)}|${norm(t.title)}`;
  const epId = (show, episode) => `e:${show}/${episode}`;

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
    nodes.push(n); byId.set(n.id, n);
    if (n.type === 'track') loadCover(n);
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
    const art = await Art.get({ artist: n.artist, title: n.title, isrc_id: n.isrc_id, deezer_track_id: n.deezer_track_id }).catch(() => null);
    if (art?.small) { n.img = art.small; paintNodes(); }
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
      .force('link', d3.forceLink().id((d) => d.id).distance((l) => (l.source.type === 'episode' || l.target.type === 'episode' ? 70 : 60)).strength(.7))
      .force('charge', d3.forceManyBody().strength(-220))
      .force('collide', d3.forceCollide((d) => (d.type === 'track' ? 24 : 18)))
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
    lsel.enter().append('line').attr('class', 'tw-link');
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
      if (d.type === 'track') {
        g.append('circle').attr('class', 'tw-shape').attr('r', 18);
        g.append('image').attr('x', -17).attr('y', -17).attr('width', 34).attr('height', 34).attr('clip-path', 'url(#tw-circle)').attr('preserveAspectRatio', 'xMidYMid slice');
        g.append('circle').attr('class', 'tw-ring').attr('r', 18);
      } else {
        g.append('rect').attr('class', 'tw-shape').attr('x', -9).attr('y', -9).attr('width', 18).attr('height', 18);
      }
      g.append('text').attr('class', 'tw-label').attr('y', d.type === 'track' ? 32 : 22).attr('text-anchor', 'middle');
      g.append('title');
    });
    paintNodes();
    sim.nodes(nodes);
    sim.force('link').links(links);
    sim.alpha(.8).restart();
    paintInfo();
  }

  function paintNodes() {
    if (!gNodes) return;
    gNodes.selectAll('g.tw-node')
      .classed('is-root', (d) => d.id === rootId)
      .classed('is-selected', (d) => d === selected)
      .classed('is-expanded', (d) => d.expanded)
      .classed('is-loading', (d) => d.loading)
      .each(function (d) {
        const g = d3.select(this);
        if (d.type === 'track') g.select('image').attr('href', d.img || null);
        const label = d.type === 'track' ? d.title : d.title;
        g.select('text').text(label.length > 22 ? label.slice(0, 21) + '…' : label);
        g.select('title').text(d.type === 'track' ? `${d.artist} – ${d.title}` : `${d.title}${d.date ? ' · ' + d.date : ''}`);
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
    if (!d.expanded && !d.loading) (d.type === 'track' ? expandTrack(d) : expandEpisode(d));
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
      !nodes.length ? 'Search for a track, or start from the one playing.'
        : d ? '' : `${nodes.filter((n) => n.type === 'track').length} tracks · ${nodes.filter((n) => n.type === 'episode').length} episodes. Click a node to expand it.`);
    if (!d) { box.append(hint); return; }
    const title = el('p', 'trackweb__title', d.title);
    const sub = el('p', 'trackweb__sub', d.type === 'track' ? d.artist : `Episode${d.date ? ' · ' + d.date : ''}`);
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
      actions.append(btn('Open episode', () => openInPanel(() => Archive.showEpisode(d.show, d.episode))));
    }
    if (d.loading) actions.prepend(loader(d.type === 'track' ? 'Finding episodes' : 'Loading tracklist'));
    box.append(title, sub, actions);
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

  // ---------- track search ----------
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
      const res = await window.nts.api(`/api/v2/search?q=${enc(q)}&version=2&offset=0&limit=30&types[]=track`).catch(() => null);
      if (input.value.trim() !== q) return;
      const seen = new Map();
      (res?.results || []).forEach((x) => {
        const artist = (x.artists || []).map((a) => a.name).join(', ');
        const k = `${norm(artist)}|${norm(x.title)}`;
        if (!seen.has(k)) seen.set(k, { artist, title: x.title, plays: 0 });
        seen.get(k).plays++;
      });
      const list = [...seen.values()].slice(0, 10);
      results.replaceChildren(...(list.length ? list.map((t) => {
        const b = el('button', 'trackweb__result');
        b.append(el('span', 'trackweb__result-title', t.title), el('span', 'trackweb__result-artist', t.artist));
        b.addEventListener('click', () => { results.hidden = true; input.value = ''; input.blur(); start(t); });
        return b;
      }) : [el('p', 'trackweb__hint', 'No tracks found.')]));
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
    // open with the current track if the web is empty
    show() { build(); center(); if (!nodes.length) { const t = currentTrack(); if (t) start(t); else paintInfo(); } },
    get empty() { return !nodes.length; }
  };
})();
