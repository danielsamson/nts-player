// The NTS archive: recently added, search, show pages and episode pages.
// Uses helpers from renderer.js ($, fmtDate, fmtOffset, showSnack, copyTrack).

const Archive = (() => {
  const root = $('archiveContent');
  const input = $('archiveSearch');
  const history = [];          // stack of views for Back
  let current = { type: 'home' };
  let searchTimer;
  let episodeView = null;      // { show, episode, tracks } while an episode page is open

  const api = (path) => window.nts.api(path);
  // Like encodeURIComponent, but also encodes ! ' ( ) * so search terms such as
  // "Sweetie (IZCO Remix)" or "Don't" pass the main process's API path check
  const enc = (x) => encodeURIComponent(x).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };
  const pick = (media) => media?.background_medium || media?.picture_medium || media?.background_large || media?.picture_large || '';
  const thumb = (media) => media?.background_small || media?.picture_small || media?.background_thumb || pick(media);
  const soundcloudUrl = (ep) => (ep.audio_sources || []).find((a) => a.source === 'soundcloud')?.url?.split('?')[0] || '';
  const parsePath = (path) => {
    const m = /^\/shows\/([^/]+)(?:\/episodes\/([^/]+))?/.exec(path || '');
    return m ? { show: m[1], episode: m[2] || null } : null;
  };

  // ---- Navigation ----
  function go(view, push = true) {
    if (push && current) history.push(current);
    current = view;
    render();
    root.scrollTop = 0;
  }
  function back() {
    // Opened from the live view: Back returns there
    if (current.returnLive) {
      current = history.pop() || { type: 'home' };
      view = 'live';
      if (typeof window.render === 'function') window.render(); else render();
      return;
    }
    if (!history.length) return;
    current = history.pop();
    render();
  }

  function render() {
    episodeView = null;
    root.replaceChildren(loader('Loading'));
    if (current.type === 'home') renderHome();
    else if (current.type === 'search') renderSearch(current.q);
    else if (current.type === 'show') renderShow(current.show);
    else if (current.type === 'episode') renderEpisode(current.show, current.episode);
    else if (current.type === 'mynts') renderMyNts(current.kind);
    else if (current.type === 'schedule') renderSchedule(current.channel);
    else if (current.type === 'history') renderHistory();
    else if (current.type === 'genres') renderGenres();
    else if (current.type === 'explore') renderExplore(current);
    else if (current.type === 'artist') renderArtist(current.name);
    else if (current.type === 'track') renderTrack({ artist: current.artist, title: current.title });
    else if (current.type === 'chart') renderChart(current.period, current.genre);
  }

  function backBar(label) {
    const bar = el('div', 'archive__back');
    const btn = el('button', 'archive__back-button', '‹ Back');
    btn.addEventListener('click', back);
    bar.append(btn, el('span', 'archive__crumb', label || ''));
    return bar;
  }

  function sectionTitle(text, linkText, onLink) {
    const h = el('h2', 'archive__section', text);
    if (linkText) {
      const a = el('button', 'archive__see', `${linkText} ›`);
      a.addEventListener('click', onLink);
      h.append(a);
    }
    return h;
  }

  // A failed load: the message and a Try again button (offline-aware)
  function failed(message) {
    const box = el('div', 'archive__failed');
    box.append(el('p', 'archive__status', navigator.onLine ? message : 'You’re offline. This will load when you’re back online.'));
    const again = el('button', 'archive__more', 'Try again');
    again.addEventListener('click', () => render());
    box.append(again);
    return box;
  }
  window.addEventListener('online', () => { if (root.querySelector('.archive__failed')) render(); });

  function loadMoreButton(onClick) {
    const b = el('button', 'archive__more', 'Load more');
    b.addEventListener('click', async () => { b.disabled = true; b.textContent = 'Loading…'; await onClick(b); });
    return b;
  }

  // An episode or show row: thumbnail, title, meta line
  function row({ img, title, meta, kind, onClick, playing, noPic }) {
    const r = el('button', 'item' + (playing ? ' item--playing' : '') + (noPic ? ' item--nopic' : ''));
    const pic = el('span', 'item__pic');
    if (img) {
      const i = el('img'); i.alt = ''; i.loading = 'lazy';
      i.addEventListener('error', () => i.remove());   // leave the grey box if artwork fails
      i.src = String(img).replace(/\/\/media\d?\.ntslive\.co\.uk\/resize\/(100x100|200x200)\//, '//media.ntslive.co.uk/resize/400x400/'); pic.append(i);
    }
    const text = el('span', 'item__text');
    const t = el('span', 'item__title', title);
    text.append(t);
    const m = el('span', 'item__meta');
    if (kind) m.append(el('span', 'item__kind', kind));
    if (meta) m.append(meta);
    text.append(m);
    r.append(pic, text);
    r.addEventListener('click', onClick);
    return r;
  }

  function episodeRow(ep) {
    const date = ep.broadcast ? fmtDate(ep.broadcast) : '';
    const loc = ep.location_short || '';
    return row({
      img: thumb(ep.media),
      title: ep.name,
      meta: [date, loc].filter(Boolean).join(' · '),
      playing: ArchivePlayer.isLoaded(ep.show_alias, ep.episode_alias),
      onClick: () => go({ type: 'episode', show: ep.show_alias, episode: ep.episode_alias })
    });
  }

  // ---- History (newest first): progress for archive episodes, and shows heard live ----
  function historyRow(h) {
    let meta;
    if (h.kind === 'archive' && h.duration) {
      meta = h.finished ? 'Played' : `${fmtOffset(Math.floor(h.position / 1000))} of ${fmtOffset(Math.floor(h.duration / 1000))}`;
      if (h.date) meta += ` · ${h.date}`;
    } else {
      meta = `Heard live${h.channel ? ' on ' + h.channel : ''}${h.date ? ' · ' + h.date : ''}`;
    }
    const r = row({
      img: h.img, title: h.title, meta,
      playing: ArchivePlayer.isLoaded(h.show, h.episode),
      onClick: () => go({ type: 'episode', show: h.show, episode: h.episode })
    });
    if (h.kind === 'archive' && h.duration && !h.finished) {
      const bar = el('span', 'item__progress');
      bar.style.setProperty('--p', `${Math.min(100, (h.position / h.duration) * 100)}%`);
      r.querySelector('.item__pic').append(bar);
    }
    return r;
  }

  // Home: episodes you're part-way through
  function continueSection() {
    const all = History.all();
    const items = all.filter((h) => h.kind === 'archive' && h.duration && !h.finished && h.position > 30000).slice(0, 3);
    if (!items.length) return all.length ? [sectionTitle('History', 'See all', () => go({ type: 'history' }))] : [];
    const list = el('div', 'items');
    items.forEach((h) => list.append(historyRow(h)));
    return [sectionTitle('Continue listening', 'History', () => go({ type: 'history' })), list];
  }

  // Full history page
  function renderHistory() {
    const items = History.all();
    const head = backBar('History');
    if (!items.length) { root.replaceChildren(head, el('p', 'archive__status', 'Nothing here yet.')); return; }
    const clear = el('button', 'archive__more', 'Clear history');
    clear.addEventListener('click', () => { History.clear(); render(); });
    const list = el('div', 'items');
    items.forEach((h) => list.append(historyRow(h)));
    root.replaceChildren(head, list, clear);
  }

  // Home: what's on air now, NTS 1 and NTS 2
  function onAirSection() {
    const box = el('div', 'onair');
    box.id = 'onAir';
    fillOnAir(box);
    return [sectionTitle('On air', 'Schedule', () => go({ type: 'schedule', channel: 1 })), box];
  }
  function fillOnAir(box) {
    const results = typeof live !== 'undefined' ? live?.results : null;
    if (!results) { box.replaceChildren(loader('Loading')); return; }
    box.replaceChildren(...results.slice(0, 2).map((r, i) => {
      const info = showInfo(r);
      const hearing = playing && source === 'live' && channel === i;
      const card = el('div', 'onair__card' + (hearing ? ' onair__card--playing' : ''));
      const pic = el('button', 'onair__pic');
      pic.title = `Open NTS ${i + 1}`;
      pic.setAttribute('aria-label', `Open NTS ${i + 1}`);
      pic.tabIndex = -1;                    // the show title below does the same; one tab stop is enough
      if (info.img) { const im = el('img'); im.src = info.img; im.alt = ''; im.addEventListener('error', () => im.remove()); pic.append(im); }
      pic.addEventListener('click', () => setChannel(i));
      const playBtn = el('button', 'onair__play');
      playBtn.setAttribute('aria-label', hearing ? `Stop NTS ${i + 1}` : `Play NTS ${i + 1}`);
      playBtn.innerHTML = hearing
        ? '<svg viewBox="0 0 24 24"><path d="M6 4h4.5v16H6zM13.5 4H18v16h-4.5z"/></svg>'
        : '<svg viewBox="0 0 24 24"><path d="M7 4.5v15l12.5-7.5z"/></svg>';
      playBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (hearing) stop();
        else { channel = i; localStorage.setItem('channel', i); play(); }
        fillOnAir(box);
      });
      pic.append(playBtn);
      const meta = el('div', 'onair__meta');
      const badge = el('span', 'onair__badge');
      badge.append(el('span', 'channel-icon', String(i + 1)), el('span', 'live-dot'));
      const title = el('button', 'onair__title', info.title);
      title.addEventListener('click', () => setChannel(i));
      meta.append(badge, title, el('span', 'onair__where', [info.location, info.start ? `${fmtTime(info.start)}–${fmtTime(info.end)}` : ''].filter(Boolean).join(' · ')));
      card.append(pic, meta);
      return card;
    }));
  }

  // ---- My NTS: your saved episodes, followed shows and saved tracks (from nts.live) ----
  function myNtsSection() {
    const head = sectionTitle('My NTS');
    const nav = el('div', 'mynts-nav');
    [['episodes', 'Saved episodes'], ['shows', 'Followed shows'], ['tracks', 'Saved tracks']].forEach(([kind, label]) => {
      const b = el('button', 'mynts-nav__item', label);
      b.addEventListener('click', () => go({ type: 'mynts', kind }));
      nav.append(b);
    });
    return [head, nav];
  }

  // My NTS lists come from nts.live and take a few seconds. Show the last copy straight
  // away (with a loader while it refreshes), then the fresh one.
  const MYNTS_TITLES = { episodes: 'Saved episodes', shows: 'Followed shows', tracks: 'Saved tracks' };
  const cacheKey = (kind) => `mynts:${kind}`;
  const readCache = (kind) => { try { return JSON.parse(localStorage.getItem(cacheKey(kind))); } catch { return null; } };
  const writeCache = (kind, res) => { try { localStorage.setItem(cacheKey(kind), JSON.stringify({ items: res.items, tracks: res.tracks })); } catch {} };

  function myNtsList(kind, res) {
    const list = el('div', 'items');
    if (kind === 'tracks') {
      const ol = el('ol', 'tracks archive-tracks');
      (res.tracks || []).forEach((t) => {
        const p = parsePath(t.path);
        const li = trackRow({ artist: t.artist, title: t.title }, {
          title: 'Open track', deferArt: true,
          onClick: () => go({ type: 'track', artist: t.artist, title: t.title, saved: true })
        });
        // look up the track's IDs first, so its cover is the exact one
        TrackInfo.find(t).then((info) => Art.attach(li._artBox, { artist: t.artist, title: t.title,
          isrc_id: info.match?.isrc_id, deezer_track_id: info.match?.deezer_track_id }));
        ol.append(li);
      });
      if (ol.children.length) list.append(ol);
    } else {
      (res.items || []).forEach((it) => {
        const p = parsePath(it.path);
        if (!p) return;
        list.append(row({
          img: it.img, title: it.title, meta: it.subtitle, kind: kind === 'shows' ? 'Show' : null,
          playing: p.episode && ArchivePlayer.isLoaded(p.show, p.episode),
          onClick: () => go(p.episode ? { type: 'episode', show: p.show, episode: p.episode } : { type: 'show', show: p.show })
        }));
      });
    }
    return list.children.length ? list : el('p', 'archive__status',
      kind === 'tracks' ? 'No saved tracks yet. Use the bookmark on any track in an episode.' : 'Nothing here yet.');
  }

  async function renderMyNts(kind) {
    const bar = () => backBar(`My NTS · ${MYNTS_TITLES[kind]}`);
    const cached = readCache(kind);
    if (cached) root.replaceChildren(bar(), loader('Updating from My NTS'), myNtsList(kind, cached));
    else root.replaceChildren(bar(), loader('Loading from My NTS'));

    const res = await window.nts.account.list(kind).catch(() => null);
    if (current.type !== 'mynts' || current.kind !== kind) return;
    if (!res || res.signedIn === false) {
      const btn = el('button', 'archive__more', 'Sign in to NTS');
      btn.addEventListener('click', () => window.nts.signIn());
      root.replaceChildren(bar(),
        el('p', 'archive__status', 'Sign in with your NTS account to see what you’ve saved on nts.live and the NTS app.'), btn);
      return;
    }
    if (!res.available) {
      root.replaceChildren(bar(), el('p', 'archive__status', 'Couldn’t read My NTS right now.'), ...(cached ? [myNtsList(kind, cached)] : []));
      return;
    }
    writeCache(kind, res);
    root.replaceChildren(bar(), myNtsList(kind, res));
  }

  // ---- Where a track was played, via NTS's public track search ----
  // Gives the episodes a track was played on and its tracklist entry there (with the
  // Deezer ID / ISRC for an exact cover, and its timestamp for "Play from"). Cached.
  const TrackInfo = (() => {
    const KEY = 'trackInfo:v4';
    let cache;
    try { cache = JSON.parse(localStorage.getItem(KEY)) || {}; } catch { cache = {}; }
    const save = () => { try { localStorage.setItem(KEY, JSON.stringify(cache)); } catch {} };
    const inflight = new Map();
    const n = (x) => String(x || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
    // little words don't count as an artist match ("The Haunting" isn't "The Invaders")
    const STOP = new Set(['the', 'and', 'of', 'de', 'la', 'le', 'el', 'les', 'los', 'las', 'der', 'die', 'das', 'und', 'et', 'feat', 'ft', 'with', 'vs', 'his', 'her', 'their', 'orchestra', 'band', 'trio', 'quartet']);
    const words = (x) => new Set(n(x).split(' ').filter((w) => w.length > 1 && !STOP.has(w)));

    // Is a search result this track? Same title and an overlapping artist, or the same
    // with artist and title swapped (it happens in hand-typed tracklists)
    function sameTrack(x, t) {
      const wantTitle = n(t.title), wantArtist = words(t.artist);
      const artists = (x.artists || []).map((a) => a.name).join(' ');
      const overlaps = (a, b) => !a.size || [...a].some((w) => b.has(w));
      if (n(x.title) === wantTitle && overlaps(wantArtist, words(artists))) return true;
      return n(artists) === wantTitle && overlaps(wantArtist, words(x.title));
    }

    function find(t) {
      const key = `${n(t.artist)}|${n(t.title)}`;
      if (cache[key]) return Promise.resolve(cache[key]);
      if (inflight.has(key)) return inflight.get(key);
      const p = (async () => {
        const res = await api(`/api/v2/search?q=${enc(`${t.artist} ${t.title}`.slice(0, 200))}&version=2&offset=0&limit=50&types[]=track`);
        const wantTitle = n(t.title);
        const wantArtist = words(t.artist);
        const plays = (res.results || [])
          .filter((x) => x.article_type === 'track' && sameTrack(x, t))
          .map((x) => ({ path: x.article?.path, title: x.article?.title, date: x.local_date, uid: x.track_uid }))
          .filter((x, i, all) => parsePath(x.path)?.episode && all.findIndex((y) => y.path === x.path) === i);   // each episode once
        let match = null;
        if (plays[0]) {
          const ep = parsePath(plays[0].path);
          const tl = await api(`/api/v2/shows/${ep.show}/episodes/${ep.episode}/tracklist`).catch(() => ({ results: [] }));
          const e = (tl.results || []).find((r) => r.uid === plays[0].uid) || (tl.results || []).find((r) => n(r.title) === wantTitle || n(r.artist) === wantTitle);
          if (e) match = { show: ep.show, episode: ep.episode, title: plays[0].title, date: plays[0].date,
            offset: e.offset ?? e.offset_estimate, isrc_id: e.isrc_id, deezer_track_id: e.deezer_track_id };
        }
        const info = { plays: plays.slice(0, 50), total: plays.length, match };
        cache[key] = info;
        save();
        return info;
      })().catch(() => ({ plays: [], match: null })).finally(() => inflight.delete(key));
      inflight.set(key, p);
      return p;
    }
    // How many NTS episodes played this track (from one track search; 50 means 50+)
    const COUNTS = 'trackCount:v3';
    let counts;
    try { counts = JSON.parse(localStorage.getItem(COUNTS)) || {}; } catch { counts = {}; }
    const countQueue = [];
    let counting = 0;
    function pumpCounts() {
      while (counting < 2 && countQueue.length) {
        const job = countQueue.shift();
        counting++;
        (async () => {
          const res = await api(`/api/v2/search?q=${enc(`${job.t.artist} ${job.t.title}`.slice(0, 200))}&version=2&offset=0&limit=50&types[]=track`);
          const wantTitle = n(job.t.title);
          const wantArtist = words(job.t.artist);
          const eps = new Set((res.results || [])
            .filter((x) => x.article_type === 'track' && sameTrack(x, job.t))
            .map((x) => x.article?.path).filter(Boolean));
          return eps.size;
        })().then((c) => {
          counts[job.key] = c;
          try { localStorage.setItem(COUNTS, JSON.stringify(counts)); } catch {}
          job.resolve(c);
        }, () => job.resolve(null)).finally(() => { counting--; pumpCounts(); });
      }
    }
    function count(t) {
      const key = `${n(t.artist)}|${n(t.title)}`;
      if (key in counts) return Promise.resolve(counts[key]);
      return new Promise((resolve) => { countQueue.push({ t, key, resolve }); pumpCounts(); });
    }

    return { find, count, sameTrack };
  })();

  // ---- Similar: shows and tracks that go together ----
  // charts/similar.json is worked out daily from every NTS tracklist: shows are alike when they
  // play the same artists, tracks when the same shows play them. "Played next to it" is live:
  // the tracks either side of it in the episodes that played it.
  const Similar = (() => {
    let p = null;
    const data = () => (p ||= window.nts.chart('similar').catch(() => null).then((d) => { if (!d) p = null; return d; }));
    const name = (d, s) => d.info?.[s]?.[0] || s.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    const list = (xs) => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}` : xs[0] || '');
    async function shows(alias) { const d = await data(); return d?.shows?.[alias] ? { d, near: d.shows[alias] } : null; }
    async function tracks(t) { const k = Chart.key(t.artist, t.title); const d = await Artists.part(k); const near = d?.tracks?.[k]; return near ? { d, near } : null; }
    // shows like the ones you follow: each followed show's neighbours, nearer ones counting more
    async function forYou(followed) {
      const d = await data();
      if (!d?.shows || !followed.length) return [];
      const mine = new Set(followed), score = new Map();
      const active = d.active ? new Set(d.active) : null;      // only suggest shows still on air
      for (const f of followed) (d.shows[f] || []).forEach(([o, both], i) => {
        if (mine.has(o) || (active && !active.has(o))) return;
        const x = score.get(o) || { s: 0, from: [], both };
        x.s += 1 / (i + 1); x.from.push(f); score.set(o, x);
      });
      return [...score].sort((a, b) => b[1].s - a[1].s).map(([o, x]) => ({ show: o, name: name(d, o), pic: d.info?.[o]?.[1], like: x.from.map((f) => name(d, f)), both: x.both }));
    }
    // the tracks either side of this one, in up to 8 of the episodes that played it
    async function nextTo(t, plays) {
      const got = new Map(), me = Chart.key(t.artist, t.title);
      const eps = plays.slice(0, 8);
      let i = 0;
      await Promise.all([0, 1, 2].map(async () => {
        while (i < eps.length) {
          const pl = eps[i++];
          const ep = parsePath(pl.path);
          if (!ep?.episode) continue;
          const tl = (await api(`/api/v2/shows/${ep.show}/episodes/${ep.episode}/tracklist`).catch(() => null))?.results || [];
          let at = pl.uid ? tl.findIndex((r) => r.uid === pl.uid) : -1;
          if (at < 0) at = tl.findIndex((r) => Chart.key(r.artist, r.title) === me);
          if (at < 0) continue;
          for (const j of [at - 1, at + 1]) {
            const r = tl[j];
            if (!r?.artist || !r?.title) continue;
            const k = Chart.key(r.artist, r.title);
            if (k === me) continue;
            const x = got.get(k) || { artist: r.artist, title: r.title, eps: [] };
            if (!x.eps.some((e) => e.episode === ep.episode)) x.eps.push({ show: ep.show, episode: ep.episode, title: pl.title, offset: r.offset ?? r.offset_estimate, before: j < at });
            got.set(k, x);
          }
        }
      }));
      return [...got.values()].sort((a, b) => b.eps.length - a.eps.length);
    }
    return { data, name, list, shows, tracks, forYou, nextTo };
  })();

  // ---- Artists: charts/artists-<letter>.json, from the same daily tracklists ----
  const Artists = (() => {
    const parts = new Map();
    const shard = (k) => `${k}__`.slice(0, 2).replace(/[0-9]/g, '0').replace(/[^a-z0]/g, '_');   // as in scripts/similar.js
    const part = (k) => {
      const f = shard(k);
      if (!parts.has(f)) parts.set(f, window.nts.chart(`artists-${f}`).catch(() => null).then((d) => { if (!d) parts.delete(f); return d; }));
      return parts.get(f);
    };
    async function get(name) {
      const k = Chart.norm(name);
      const d = k && (await part(k));
      return d?.artists?.[k] ? { d, x: d.artists[k] } : null;
    }
    // artists whose name starts with what you typed (or has a word that does)
    async function search(q) {
      const k = Chart.norm(q);
      if (k.length < 2) return [];
      const d = await part(k);
      if (!d) return [];
      return Object.entries(d.artists).filter(([a]) => a === k || a.startsWith(k + ' ') || (k.length >= 4 && a.startsWith(k)))
        .sort((a, b) => (b[0] === k) - (a[0] === k) || b[1].shows - a[1].shows).slice(0, 4).map(([, x]) => x);
    }
    const split = (a) => String(a || '').split(/\s*(?:,|&|\bx\b|\bfeat\.?|\bft\.?|\band\b)\s*/i).map((x) => x.trim()).filter(Boolean);
    return { get, search, split, part };
  })();

  // ---- Artist page: their tracks on NTS, the shows that play them, who else those shows play ----
  async function renderArtist(name) {
    const wrap = el('div', 'artist-page');
    const head = el('div', 'artist-page__head');
    const h = el('h1', 'broadcast-heading', name);
    const meta = el('p', 'detail__meta');
    head.append(el('span', 'artist-page__kicker', 'Artist'), h, meta);
    const tracks = el('div'), where = el('div'), like = el('div');
    wrap.append(head, like, where, tracks);
    root.replaceChildren(backBar('Artist'), wrap);
    tracks.append(loader('Looking through the tracklists'));
    const res = await Artists.get(name).catch(() => null);
    if (current.type !== 'artist' || current.name !== name) return;
    const x = res?.x;
    const onMap = el('button', 'mynts-btn artist-page__map', 'On the NTS map');
    onMap.title = 'Where they live on the map: the shows that play them and the artists around them';
    onMap.addEventListener('click', () => NtsMap.open({ artist: x?.name || name }));
    head.append(onMap);
    const span = (ms) => { const f = (m) => monthLabel(m).replace(/^(\w{3})\w*/, '$1'); return ms ? (ms[0] === ms[1] ? f(ms[0]) : `${f(ms[0])} – ${f(ms[1])}`) : ''; };
    if (x) {
      h.textContent = x.name;
      meta.textContent = `Played on ${x.shows} shows · ${x.plays} play${x.plays === 1 ? '' : 's'} · ${span(res.d.months)}`;
    }
    // tracks: from the daily data, or else straight from NTS track search
    let list = x?.tracks.map(([artist, title, shows]) => ({ artist, title, note: `${shows} show${shows === 1 ? '' : 's'}` })) || [];
    if (!list.length) {
      const r = await api(`/api/v2/search?q=${enc(name)}&version=2&offset=0&limit=40&types[]=track`).catch(() => null);
      const want = Chart.norm(name), seen = new Map();
      (r?.results || []).forEach((t) => {
        const artist = (t.artists || []).map((a) => a.name).join(', ');
        if (!t.title || !Artists.split(artist).some((a) => Chart.norm(a) === want)) return;
        const k = Chart.key(artist, t.title);
        if (!seen.has(k)) seen.set(k, { artist, title: t.title, n: 0 });
        seen.get(k).n++;
      });
      list = [...seen.values()].sort((a, b) => b.n - a.n).slice(0, 8).map((t) => ({ ...t, note: `${t.n}${t.n >= 40 ? '+' : ''} episode${t.n === 1 ? '' : 's'}` }));
      if (current.type !== 'artist' || current.name !== name) return;
    }
    tracks.replaceChildren();
    if (list.length) {
      const ol = el('ol', 'tracks archive-tracks');
      list.forEach((t) => {
        const li = trackRow({ artist: t.artist, title: t.title }, { title: 'Open track', onClick: () => go({ type: 'track', artist: t.artist, title: t.title }) });
        li.querySelector('.track__text').append(el('span', 'chart-row__count', t.note));
        ol.append(li);
      });
      tracks.append(sectionTitle(x ? 'Most played on NTS' : 'On NTS'), ol);
    } else tracks.append(el('p', 'archive__status', `No tracks by ${name} in NTS tracklists.`));
    if (!x) {
      if (list.length) like.append(el('p', 'archive__status', 'Not played on enough shows lately to say who else goes with them.'));
      return;
    }
    const box = el('div', 'items');
    x.top.forEach(([s, c]) => box.append(row({ img: res.d.info?.[s]?.[1], title: Similar.name(res.d, s), meta: `${c} play${c === 1 ? '' : 's'}`, onClick: () => go({ type: 'show', show: s }) })));
    where.append(sectionTitle('Where they get played'), box);
    if (x.like.length) {
      const l = el('div', 'items artist-page__like');
      x.like.forEach(([a, via]) => l.append(row({ title: a, noPic: true, meta: `Both played by ${Similar.list(via.map((s) => Similar.name(res.d, s)))}`, onClick: () => go({ type: 'artist', name: a }) })));
      like.append(sectionTitle(`If you like ${x.name}`), l);
    }
  }

  function similarShowRow(d, [o, both], extra) {
    return row({
      img: d.info?.[o]?.[1], title: Similar.name(d, o),
      meta: extra || (both.length ? `Both play ${Similar.list(both)}` : ''),
      onClick: () => go({ type: 'show', show: o })
    });
  }

  // Track page: what goes with it
  function discoverBox(t, plays) {
    const box = el('div', 'track-page__discover');
    const along = el('div'), alike = el('div');
    box.append(along, alike);
    if (plays.length) Similar.nextTo(t, plays).then((near) => {
      if (!near.length || !box.isConnected) return;
      const ol = el('ol', 'tracks archive-tracks similar-tracks');
      near.slice(0, 6).forEach((x) => {
        const e = x.eps[0];
        const li = trackRow({ artist: x.artist, title: x.title }, {
          title: 'Open track',
          onClick: () => go({ type: 'track', artist: x.artist, title: x.title }),
          onPlay: () => Archive.playFrom(e.show, e.episode, Number.isFinite(e.offset) ? e.offset : 0)
        });
        li.querySelector('.track__play').title = `Hear it in ${e.title}${e.before ? ', just before this one' : ', right after this one'}`;
        li.querySelector('.track__text').append(el('span', 'chart-row__count',
          x.eps.length > 1 ? `Next to it in ${x.eps.length} episodes` : `${e.before ? 'Before' : 'After'} it in ${e.title}`));
        ol.append(li);
      });
      along.replaceChildren(sectionTitle('Played next to it'), ol);
    }).catch(() => {});
    Similar.tracks(t).then((res) => {
      if (!res || !box.isConnected) return;
      const ol = el('ol', 'tracks archive-tracks similar-tracks');
      res.near.forEach(([artist, title, via]) => {
        const li = trackRow({ artist, title }, { title: 'Open track', onClick: () => go({ type: 'track', artist, title }) });
        li.querySelector('.track__text').append(el('span', 'chart-row__count', `Both played by ${Similar.list(via.slice(0, 2).map((s) => Similar.name(res.d, s)))}`));
        ol.append(li);
      });
      alike.replaceChildren(sectionTitle('Shows that play this also play'), ol);
    }).catch(() => {});
    return box;
  }

  // ---- Track page: big cover, details, links, where it was played ----
  async function renderTrack(t) {
    const wrap = el('div', 'detail track-page');
    const picWrap = el('div', 'picture-wrap');
    const pic = el('div', 'picture track-page__art');
    const img = el('img'); img.alt = '';
    pic.append(img); picWrap.append(pic);
    const body = el('div', 'detail__body');
    const title = el('h1', 'broadcast-heading', t.title);
    const artist = el('p', 'track-page__artist');
    Artists.split(t.artist).forEach((a, i, all) => {
      const b = el('button', 'track-page__artist-link', a);
      b.title = `More from ${a} on NTS`;
      b.addEventListener('click', () => go({ type: 'artist', name: a }));
      artist.append(b);
      if (i < all.length - 1) artist.append(document.createTextNode(', '));
    });
    if (!artist.childNodes.length) artist.textContent = t.artist;
    // a band with "&" or "and" in its name (Simon & Garfunkel) is one link, if it has a page
    if (artist.querySelectorAll('button').length > 1) Artists.get(t.artist).then((res) => {
      if (!res || !artist.isConnected) return;
      const b = el('button', 'track-page__artist-link', t.artist);
      b.title = `More from ${t.artist} on NTS`;
      b.addEventListener('click', () => go({ type: 'artist', name: t.artist }));
      artist.replaceChildren(b);
    }).catch(() => {});
    const album = el('p', 'detail__meta');
    const playBox = el('div', 'track-page__playbox');     // Play from: first thing under the title
    const from = el('div', 'track-page__from');           // the episodes it was played on
    const actions = el('div', 'track-page__actions');
    const save = el('button', 'mynts-btn');
    save.hidden = true;
    const web = el('button', 'mynts-btn', 'Open in Track web');
    web.addEventListener('click', () => {
      const o = current.origin || MyNTS.originOf(t);
      openTrackWeb({ artist: t.artist, title: t.title, isrc_id: o?.isrc_id, deezer_track_id: o?.deezer_track_id }, o);
    });
    const copy = el('button', 'mynts-btn', 'Copy artist & title');
    copy.addEventListener('click', () => copyTrack(`${t.artist} - ${t.title}`));
    actions.append(save, web, copy);
    const linksNav = el('nav', 'track-page__links');
    const linksLabel = el('span', 'stage__links-label', 'Find it on');
    const linksList = el('span', 'stage__links-list');
    linksNav.append(linksLabel, linksList);
    // a compact head: small cover beside the title, so Play from and the actions are in view
    const headText = el('div', 'track-page__headtext');
    headText.append(title, artist, album);
    const head = el('div', 'track-page__head');
    head.append(picWrap, headText);
    body.append(playBox, actions, linksNav, from);
    wrap.append(head, body);
    root.replaceChildren(backBar(current.saved ? 'Saved track' : 'Track'), wrap);

    Stage.paintLinks(Stage.links(t, null), linksList, linksLabel);
    from.append(loader('Finding where it was played'));

    // Episodes it was played on (NTS track search) and the one you saved it from
    const info = await TrackInfo.find(t);
    if (current.type !== 'track' || current.title !== t.title) return;
    const remembered = current.origin || MyNTS.originOf(t);
    const o = remembered?.show ? remembered : info.match;
    from.replaceChildren();
    from.before(discoverBox(t, info.plays || []));
    if (o?.show && o?.episode && o.offset != null) {
      const playFrom = el('button', 'episode-play', `Play from ${fmtOffset(o.offset)}${o.title ? ' · ' + o.title : ''}`);
      playFrom.addEventListener('click', async () => {
        const label = playFrom.textContent;
        playFrom.textContent = 'Loading…';
        try {
          const { info: ep } = await fetchEpisode(o.show, o.episode);
          if (!ep.url) { playFrom.textContent = 'Not available to stream'; playFrom.disabled = true; return; }
          playArchive(ep, o.offset * 1000);
        } catch { showSnack('Couldn’t load the episode'); }
        playFrom.textContent = label;
      });
      playBox.append(playFrom);
    }
    if (info.plays.length) {
      from.append(el('p', 'track-page__played', info.plays.length > 1 ? 'Played on' : 'Played on'));
      const list = el('div', 'items track-page__plays');
      info.plays.forEach((pl) => {
        const p = parsePath(pl.path);
        list.append(row({ title: pl.title, meta: pl.date, onClick: () => go({ type: 'episode', show: p.show, episode: p.episode }) }));
      });
      from.append(list);
    }

    // Save to My NTS, through the episode it was played on
    if (o?.show && o?.episode && supporter) {
      const ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h12v18l-6-4.5L6 21z"/></svg>';
      const paintSave = (saved, busy) => {
        save.hidden = false;
        save.innerHTML = `${ICON}<span>${saved ? 'Saved to My NTS' : 'Save to My NTS'}</span>`;
        save.classList.toggle('mynts-btn--on', !!saved);
        save.classList.toggle('mynts-btn--busy', !!busy);
      };
      paintSave(false, true);
      MyNTS.getState(o.show, o.episode).then((st) => {
        if (current.type !== 'track' || current.title !== t.title) return;
        const tr = MyNTS.trackState(st, t);
        if (!st?.signedIn || !tr?.canSave) { save.hidden = true; return; }
        let saved = !!tr.saved;
        paintSave(saved);
        save.onclick = async () => {
          paintSave(saved, true);
          const res = await MyNTS.toggleTrack(o.show, o.episode, t, !saved, { show: o.show, episode: o.episode, title: o.title, date: o.date, offset: o.offset });
          if (res && !res.error) saved = !saved;
          paintSave(saved);
          NowSave.update(true);
        };
      });
    }

    // Cover and album: with the exact IDs from the tracklist when we have them
    const exact = { artist: t.artist, title: t.title, isrc_id: current.origin?.isrc_id || info.match?.isrc_id, deezer_track_id: current.origin?.deezer_track_id || info.match?.deezer_track_id };
    const [art, apple] = await Promise.all([
      Art.get(exact, 'high'),
      window.nts.appleLink({ artist: t.artist, title: t.title }).catch(() => null)
    ]);
    if (current.type !== 'track' || current.title !== t.title) return;
    if (art?.large) img.src = art.large; else pic.classList.add('track-page__art--none');
    if (art?.album) album.textContent = `${art.album}${art.year ? ' · ' + art.year : ''}`;
    Stage.paintLinks(Stage.links(t, art, apple), linksList, linksLabel);
  }

  // NTS sometimes sends titles with HTML entities ("Peterson &amp; Andras")
  const decode = (x) => { const t = document.createElement('textarea'); t.innerHTML = x || ''; return t.value; };

  // Schedules, cached for 10 minutes
  const schedules = new Map();
  function getSchedule(ch) {
    const c = schedules.get(ch);
    if (c && Date.now() - c.at < 600000) return c.p;
    const p = api(`/api/v2/radio/schedule/${ch}`);
    schedules.set(ch, { at: Date.now(), p });
    p.catch(() => schedules.delete(ch));
    return p;
  }
  // Broadcasts from a schedule response, with times and the show they belong to
  function broadcasts(res, ch) {
    return (res.results || []).flatMap((d) => d.broadcasts || []).map((b) => {
      const link = (b.links || []).find((l) => /\/shows\//.test(l.href || ''));
      const p = link ? parsePath(new URL(link.href).pathname.replace('/api/v2', '')) : null;
      return { b, ch, title: decode(b.broadcast_title), start: new Date(b.start_timestamp), end: new Date(b.end_timestamp), p,
        repeat: /\(R\)\s*$/.test(b.broadcast_title || '') };
    });
  }
  const whenLabel = (d) => {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const day = new Date(d); day.setHours(0, 0, 0, 0);
    const diff = Math.round((day - today) / 86400000);
    const t = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
    return diff === 0 ? `Today ${t}` : diff === 1 ? `Tomorrow ${t}` : `${d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })} ${t}`;
  };

  // ---- Coming up from shows you follow (both channels, this week) ----
  async function comingUpSection() {
    if (!Following.any()) return [];
    const box = el('div', 'items');
    const head = sectionTitle('Coming up from shows you follow', 'Schedule', () => go({ type: 'schedule', channel: 1 }));
    (async () => {
      const now = Date.now();
      const all = (await Promise.all([1, 2].map((ch) => getSchedule(ch).then((r) => broadcasts(r, ch)).catch(() => []))))
        .flat()
        .filter((x) => x.p?.show && Following.has(x.p.show) && x.end.getTime() > now && !x.repeat)
        .sort((a, b) => a.start - b.start)
        .slice(0, 3);
      if (!all.length) { box.append(el('p', 'archive__status', 'None of your shows are on this week. Repeats aren’t listed.')); return; }
      all.forEach((x) => {
        const live = x.start.getTime() <= now;
        box.append(row({
          title: x.title, noPic: true,
          kind: live ? 'Live' : null,
          meta: `${live ? 'On now' : whenLabel(x.start)} · NTS ${x.ch}`,
          onClick: () => go({ type: 'show', show: x.p.show })
        }));
      });
    })();
    return [head, box];
  }

  // Home: shows like the ones you follow (worked out here, from your follows and similar.json)
  function forYouSection() {
    if (!Following.any()) return [];
    const box = el('div', 'items');
    const head = sectionTitle('Shows like the ones you follow');
    Similar.forYou(Following.all()).then((list) => {
      if (!list.length) { head.remove(); box.remove(); return; }
      list.slice(0, 4).forEach((x) => box.append(row({
        img: x.pic, title: x.name,
        meta: `Like ${Similar.list(x.like.slice(0, 2))}${x.both.length ? ` · plays ${Similar.list(x.both.slice(0, 2))}` : ''}`,
        onClick: () => go({ type: 'show', show: x.show })
      })));
    }).catch(() => { head.remove(); box.remove(); });
    return [head, box];
  }

  // ---- Schedule: what's on, with reminders ----
  async function renderSchedule(ch) {
    const bar = backBar(`Schedule · NTS ${ch}`);
    root.replaceChildren(bar, loader('Loading the schedule'));
    let res;
    try { res = await getSchedule(ch); } catch { root.replaceChildren(bar, failed('Couldn’t load the schedule.')); return; }
    if (current.type !== 'schedule' || current.channel !== ch) return;

    // Tabs to switch channel
    const tabs = el('div', 'mynts-nav');
    [1, 2].forEach((c) => {
      const b = el('button', 'mynts-nav__item' + (c === ch ? ' mynts-nav__item--on' : ''), `NTS ${c}`);
      b.addEventListener('click', () => { if (c !== ch) { current = { type: 'schedule', channel: c }; render(); } });
      tabs.append(b);
    });

    // "Following only" filter (remembered)
    const filterFollowing = Following.any() && localStorage.getItem('scheduleFollowing') === '1';
    const filter = el('button', 'notify-toggle schedule__filter' + (filterFollowing ? ' notify-toggle--on' : ''), 'Following only');
    filter.addEventListener('click', () => {
      try { localStorage.setItem('scheduleFollowing', filterFollowing ? '0' : '1'); } catch {}
      render();
    });
    if (!Following.any()) filter.hidden = true;

    const now = Date.now();
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const dayName = (d) => {
      const diff = Math.round((d - today) / 86400000);
      return diff === 0 ? 'Today' : diff === 1 ? 'Tomorrow' : d.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'short' });
    };
    // Group broadcasts by local day, from now on
    const days = new Map();
    (res.results || []).flatMap((d) => d.broadcasts || []).forEach((b) => {
      const start = new Date(b.start_timestamp);
      const end = new Date(b.end_timestamp);
      if (end.getTime() < now) return;
      const day = new Date(start); day.setHours(0, 0, 0, 0);
      const k = day.getTime();
      if (!days.has(k)) days.set(k, []);
      const link = (b.links || []).find((l) => /\/shows\//.test(l.href || ''));
      const p = link ? parsePath(new URL(link.href).pathname.replace('/api/v2', '')) : null;
      days.get(k).push({ b, start, end, p });
    });

    const parts = [bar, tabs, filter];
    [...days.entries()].sort((a, b) => a[0] - b[0]).slice(0, 7).forEach(([k, items]) => {
      const dayTitle = sectionTitle(dayName(new Date(k)));
      const list = el('div', 'schedule');
      items.sort((a, b) => a.start - b.start).forEach(({ b, start, end, p }) => {
        const onNow = start.getTime() <= now && now < end.getTime();
        const rowEl = el('div', 'schedule__item' + (onNow ? ' schedule__item--now' : ''));
        const time = el('span', 'schedule__time', start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }));
        const title = el('button', 'schedule__title', decode(b.broadcast_title));
        title.title = p ? 'Open the show' : '';
        if (p) title.addEventListener('click', () => go(onNow || !p.episode ? { type: 'show', show: p.show } : { type: 'episode', show: p.show, episode: p.episode }));
        if (onNow) title.prepend(el('span', 'schedule__live', 'Live'));
        rowEl.append(time, title);
        const followed = p?.show && Following.has(p.show);
        if (followed) {
          rowEl.classList.add('schedule__item--followed');
          const heart = el('span', 'schedule__following');
          heart.title = b.broadcast_title.match(/\(R\)\s*$/) ? 'A show you follow (repeat)' : 'A show you follow: you’ll be notified when it goes live';
          heart.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-7.5-4.6-9.5-9.2C1.2 8.6 3.3 5 6.8 5c2 0 3.6 1.1 5.2 3 1.6-1.9 3.2-3 5.2-3 3.5 0 5.6 3.6 4.3 6.8C19.5 16.4 12 21 12 21z"/></svg>';
          rowEl.append(heart);
        }
        if (filterFollowing && !followed) return;
        if (p?.show) {
          const bell = el('button', 'schedule__remind');
          const paintBell = () => {
            const on = Reminders.has(p.show);
            bell.classList.toggle('schedule__remind--on', on);
            bell.title = on ? 'Reminder set: you’ll be notified when this show goes live' : 'Remind me when this show goes live';
            bell.setAttribute('aria-label', bell.title);
          };
          bell.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3a6 6 0 0 0-6 6v4l-2 3h16l-2-3V9a6 6 0 0 0-6-6zm-2 15a2 2 0 0 0 4 0"/></svg>';
          bell.addEventListener('click', () => {
            const on = Reminders.toggle(p.show, decode(b.broadcast_title).replace(/\s*\(R\)\s*$/, ''));
            paintBell();
            showSnack(on ? 'Reminder set' : 'Reminder removed');
          });
          paintBell();
          rowEl.append(bell);
        }
        list.append(rowEl);
      });
      if (list.children.length) parts.push(dayTitle, list);
    });
    if (parts.length === 3) parts.push(el('p', 'archive__status', 'None of the shows you follow are on this channel this week.'));
    root.replaceChildren(...parts);
    root.querySelector('.schedule__item--now')?.scrollIntoView({ block: 'center' });
  }

  // ---- Home: recently added ----
  async function renderHome() {
    const list = el('div', 'items');
    let offset = 0;
    const more = async (btn) => {
      const res = await api(`/api/v2/collections/recently-added?limit=20&offset=${offset}`);
      offset += 20;
      list.append(...(res.results || []).map(episodeRow));
      btn?.remove();
      if (offset < (res.metadata?.resultset?.count ?? 0)) list.after(loadMoreButton(more));
    };
    try {
      root.replaceChildren(...onAirSection(), ...yearCard(), ...mapCard(), ...continueSection(), ...(await comingUpSection()), ...forYouSection(), ...exploreSection(), ...chartSection(), ...myNtsSection(), sectionTitle('Recently added'), list);
      await more();
    } catch { root.replaceChildren(failed('Couldn’t load the archive.')); }
  }

  // ---- Search ----
  async function renderSearch(q) {
    const list = el('div', 'items');
    let offset = 0;
    const more = async (btn) => {
      const res = await api(`/api/v2/search?q=${enc(q)}&version=2&offset=${offset}&limit=20&types[]=show&types[]=episode`);
      offset += 20;
      const rows = (res.results || []).map((x) => {
        const p = parsePath(x.article?.path);
        if (!p) return null;
        const isShow = x.article_type === 'show';
        return row({
          img: x.image?.small || x.image?.medium || '',
          title: x.title,
          kind: isShow ? 'Show' : null,
          meta: isShow ? (x.location || '') : [x.local_date, x.location].filter(Boolean).join(' · '),
          playing: !isShow && ArchivePlayer.isLoaded(p.show, p.episode),
          onClick: () => go(isShow ? { type: 'show', show: p.show } : { type: 'episode', show: p.show, episode: p.episode })
        });
      }).filter(Boolean);
      if (!rows.length && offset === 20) list.append(el("p", "archive__status", `No shows or episodes for “${q}”.`));
      list.append(...rows);
      btn?.remove();
      if (offset < (res.metadata?.resultset?.count ?? 0)) list.after(loadMoreButton(more));
    };
    // Tracks first (what crate diggers type), grouped: each track once, with how many episodes played it
    const tracksBox = el('div');
    const tracks = async () => {
      const res = await api(`/api/v2/search?q=${enc(q)}&version=2&offset=0&limit=40&types[]=track`).catch(() => null);
      const seen = new Map();
      (res?.results || []).forEach((x) => {
        const artist = (x.artists || []).map((a) => a.name).join(', ');
        if (!artist || !x.title) return;
        const k = Chart.key(artist, x.title);
        if (!seen.has(k)) seen.set(k, { artist, title: x.title, plays: 0 });
        seen.get(k).plays++;
      });
      const found = [...seen.values()].slice(0, 8);
      if (!found.length) { tracksBox.remove(); return; }
      const ol = el('ol', 'tracks archive-tracks search-tracks');
      found.forEach((t) => {
        const li = trackRow({ artist: t.artist, title: t.title }, { title: 'Open track', onClick: () => go({ type: 'track', artist: t.artist, title: t.title }) });
        li.querySelector('.track__text').append(el('span', 'chart-row__count', `${t.plays}${t.plays >= 40 ? '+' : ''} episode${t.plays === 1 ? '' : 's'}`));
        ol.append(li);
      });
      tracksBox.replaceChildren(sectionTitle('Tracks'), ol, sectionTitle('Shows and episodes'));
    };
    const artistsBox = el('div');
    Artists.search(q).then((found) => {
      if (!found.length || !artistsBox.isConnected) return;
      const box = el('div', 'items');
      found.forEach((x) => box.append(row({ title: x.name, noPic: true, kind: 'Artist', meta: `Played on ${x.shows} shows`, onClick: () => go({ type: 'artist', name: x.name }) })));
      artistsBox.replaceChildren(sectionTitle('Artists'), box);
    }).catch(() => {});
    try {
      root.replaceChildren(backBar(`Search: ${q}`), artistsBox, tracksBox, list);
      await Promise.all([tracks(), more()]);
    } catch { root.replaceChildren(backBar(), failed('Search didn’t work.')); }
  }

  // ---- Show page ----
  async function renderShow(alias) {
    try {
      const show = await api(`/api/v2/shows/${alias}`);
      const head = el('div', 'detail');
      const picWrap = el('div', 'picture-wrap');
      const pic = el('div', 'picture');
      const img = el('img'); img.src = pick(show.media); img.alt = '';
      pic.append(img); picWrap.append(pic);
      const body = el('div', 'detail__body');
      body.append(el('h1', 'broadcast-heading', show.name));
      const meta = [show.location_long, show.frequency].filter(Boolean).join(' · ');
      if (meta) body.append(el('p', 'detail__meta', meta));
      body.append(tagRow(show.genres));
      if (show.description) body.append(el('p', 'broadcast-description detail__desc', show.description));
      const onMap = el('button', 'mynts-btn', 'On the NTS map');
      onMap.title = 'Where this show sits: its neighbourhood, the shows nearby and the artists it plays';
      onMap.addEventListener('click', () => NtsMap.open({ show: alias }));
      body.append(onMap);
      head.append(picWrap, body);

      const list = el('div', 'items');
      let offset = 0;
      const more = async (btn) => {
        const res = await api(`/api/v2/shows/${alias}/episodes?limit=20&offset=${offset}`);
        offset += 20;
        list.append(...(res.results || []).map(episodeRow));
        btn?.remove();
        const total = res.metadata?.resultset?.count ?? 0;
        if (offset < total) list.after(loadMoreButton(more));
      };
      const alike = el('div');
      root.replaceChildren(backBar('Show'), head, alike, sectionTitle('Episodes'), list);
      Similar.shows(alias).then((res) => {
        if (!res || !alike.isConnected) return;
        const box = el('div', 'items');
        res.near.slice(0, 4).forEach((x) => box.append(similarShowRow(res.d, x)));
        alike.replaceChildren(sectionTitle('Similar shows'), box);
      }).catch(() => {});
      await more();
    } catch { root.replaceChildren(backBar(), failed('Couldn’t load this show.')); }
  }

  // Genre tags are buttons into Explore (episode genre ids look like "genres-<id>")
  function tagButtons(genres) {
    return (genres || []).filter((g) => (g.value || '').trim()).slice(0, 4).map((g) => {
      const id = String(g.id || '').replace(/^genres-/, '');
      const b = el('button', 'tag', g.value.trim());
      b.title = `Explore ${g.value.trim()}`;
      b.addEventListener('click', () => openExplore({ kind: 'genre', id, name: g.value.trim() }));
      return b;
    });
  }
  function tagRow(genres) {
    const tags = el('div', 'tags');
    tags.append(...tagButtons(genres));
    return tags;
  }

  // Open Explore results from anywhere (switches to the archive side if needed)
  function openExplore(target) {
    started = true;
    if (typeof view !== 'undefined' && view !== 'archive') { view = 'archive'; history.length = 0; history.push({ type: 'home' }); current = { type: 'explore', ...target }; window.render?.(); render(); return; }
    go({ type: 'explore', ...target });
  }

  // ---- Explore: moods and genres ----
  let genresP = null, moodsP = null;
  const getGenres = () => (genresP ||= api('/api/v2/genres').then((r) => r.results || []).catch((e) => { genresP = null; throw e; }));
  const getMoods = () => (moodsP ||= api('/api/v2/moods').then((r) => r.results || []).catch((e) => { moodsP = null; throw e; }));
  const titleCase = (x) => String(x || '').toLowerCase().replace(/\b([a-z])/g, (c) => c.toUpperCase());

  function moodTile(m) {
    const b = el('button', 'mood');
    b.title = `Explore ${titleCase(m.name)}`;
    const img = m.image?.medium || m.image?.small;
    if (img) { const i = el('img'); i.src = img; i.alt = ''; i.loading = 'lazy'; i.addEventListener('error', () => i.remove()); b.append(i); }
    b.append(el('span', 'mood__name', titleCase(m.name)));
    b.addEventListener('click', () => go({ type: 'explore', kind: 'mood', id: m.id, name: titleCase(m.name) }));
    return b;
  }

  // Home: a row of moods and a way into all genres
  function exploreSection() {
    const box = el('div', 'moods moods--row');
    getMoods().then((ms) => box.replaceChildren(...ms.map(moodTile))).catch(() => box.remove());
    return [sectionTitle('Explore', 'All genres', () => go({ type: 'genres' })), box, luckyButton()];
  }

  // ---- Most played on NTS: a chart from tracklists (Chart, chart.js) ----
  const monthLabel = (m) => new Date(Date.UTC(+m.slice(0, 4), +m.slice(5) - 1, 15)).toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const periodLabel = (p) => (p === 'recent' ? 'Last 30 days' : /^\d{4}$/.test(p) ? (+p === new Date().getUTCFullYear() ? `${p} so far` : `All of ${p}`) : monthLabel(p));
  function chartRow(r, i) {
    const t = { artist: r.artist, title: r.title, time: String(i + 1) };
    const li = trackRow(t, {
      title: 'Open track',
      onClick: () => go({ type: 'track', artist: r.artist, title: r.title }),
      onPlay: () => Archive.playFrom(r.latest.show, r.latest.episode, Number.isFinite(r.latest.offset) ? r.latest.offset : 0)
    });
    li.classList.add('chart-row');
    li.querySelector('.track__play').title = `Play it in ${r.latest.title}, the latest episode that played it`;
    li.querySelector('.track__text').append(el('span', 'chart-row__count',
      `${r.shows} show${r.shows === 1 ? '' : 's'}${r.episodes > r.shows ? ` · ${r.episodes} episodes` : ''}`));
    return li;
  }
  function chartList(res, limit, genre = null) {
    const ol = el('ol', 'tracks archive-tracks chart-list');
    const rows = genre ? res.rowsFor(genre, limit) : res.rows.slice(0, limit);
    rows.forEach((r, i) => ol.append(chartRow(r, i)));
    // trends: a line of shows per month over the past year, and movement since last month
    Chart.trend(res.period, 12, genre).then((tr) => {
      [...ol.children].forEach((li, i) => {
        const r = rows[i];
        const s = tr.series(r);
        const box = el('span', 'chart-row__trend');
        const sp = Chart.spark(s);
        sp.setAttribute('aria-label', `Shows per month over the past year: ${s.map((v) => v ?? '–').join(', ')}`);
        box.append(sp);
        const prev = tr.prevRank(r);
        if (prev !== undefined) {
          const mv = el('span', 'chart-move');
          if (prev == null) { mv.textContent = 'NEW'; mv.classList.add('is-new'); mv.title = 'Not in last month’s chart'; }
          else if (prev > i + 1) { mv.textContent = prev - (i + 1) > 99 ? '▲99+' : `▲${prev - (i + 1)}`; mv.classList.add('is-up'); mv.title = `Up from ${prev} last month`; }
          else if (prev < i + 1) { mv.textContent = i + 1 - prev > 99 ? '▼99+' : `▼${i + 1 - prev}`; mv.classList.add('is-down'); mv.title = `Down from ${prev} last month`; }
          else { mv.textContent = '='; mv.title = 'Same place as last month'; }
          box.append(mv);
        }
        li.querySelector('.track__actions').prepend(box);      // beside the play and copy buttons
      });
    }).catch(() => {});
    return ol;
  }
  const thisYear = new Date().getUTCFullYear();
  function yearLink() {
    const b = el('button', 'chart-year', `NTS in ${thisYear} ›`);
    b.title = `The year on NTS in tracks: track of the year, top artists, number ones, busiest and new shows`;
    b.addEventListener('click', () => Year.open(thisYear));
    return b;
  }
  // NTS in <year>, near the top of Home (it was only a small link under the chart)
  function yearCard() {
    const b = el('button', 'year-card');
    b.innerHTML = `<span class="year-card__kicker">The year on NTS</span><span class="year-card__title">NTS in ${thisYear}</span><span class="year-card__sub">The tracks, the shows, the moments. Take your time.</span><span class="year-card__go">Play ›</span>`;
    b.addEventListener('click', () => Year.open(thisYear));
    Chart.months().then((ms) => { if (!ms.some((m) => m.startsWith(`${thisYear}-`))) b.remove(); }).catch(() => b.remove());
    return [b];
  }
  // The NTS map: a way into everything above
  function mapCard() {
    const b = el('button', 'year-card map-card');
    b.innerHTML = '<span class="year-card__kicker">Explore</span><span class="year-card__title">The NTS map</span><span class="year-card__sub">Every show, placed by what it plays. Find the zones, drift between them.</span><span class="year-card__go">Open ›</span>';
    b.addEventListener('click', () => NtsMap.open());
    return [b];
  }
  function chartSection() {
    const box = el('div', 'chart-box');
    const head = sectionTitle('Most played on NTS', 'See all', () => go({ type: 'chart', period: 'recent' }));
    const fill = (res) => {
      if (!res?.rows.length) { box.replaceChildren(el('p', 'archive__empty', 'The chart isn’t available right now.')); return; }
      box.replaceChildren(el('p', 'chart-box__span', `Last 30 days · ${res.episodes} episodes`), chartList(res, 5), yearLink());
    };
    const now = Chart.peek('recent');
    if (now) fill(now); else box.replaceChildren(loader('Loading the chart'));
    Chart.get('recent').then((res) => { if (box.isConnected) fill(res); });
    return [head, box];
  }
  // genre family names from NTS ("house / techno") as chip labels
  const genreLabel = (name) => titleCase(name).replace(/\s*\/\s*/g, ' / ').replace(/\bRhythm & Blues\b|\bR'n'b\b/gi, 'R&B').replace(/\bUk\b/g, 'UK');
  async function renderChart(period = 'recent', genre = null) {
    const bar = backBar('Most played on NTS');
    const pick = el('select', 'chart-pick');
    pick.setAttribute('aria-label', 'Period');
    const addOpt = (p) => { const o = el('option', null, periodLabel(p)); o.value = p; pick.append(o); };
    addOpt('recent');
    if (period !== 'recent') addOpt(period);
    pick.value = period;
    // years first (each year with data), then its months
    Chart.months().then((ms) => {
      pick.replaceChildren();
      addOpt('recent');
      const years = [...new Set(ms.map((m) => m.slice(0, 4)))];
      const yg = el('optgroup'); yg.label = 'Years';
      const mg = el('optgroup'); mg.label = 'Months';
      years.forEach((y) => { const o = el('option', null, periodLabel(y)); o.value = y; yg.append(o); });
      ms.forEach((m) => { const o = el('option', null, monthLabel(m)); o.value = m; mg.append(o); });
      pick.append(yg, mg);
      pick.value = period;
    });
    pick.addEventListener('change', () => { current.period = pick.value; renderChart(pick.value, current.genre); });
    const head = el('div', 'chart-head');
    head.append(pick, yearLink());
    // genre chips: the same chart, counting only plays in episodes tagged with that genre
    const chips = el('div', 'tags chart-genres');
    chips.setAttribute('role', 'group');
    chips.setAttribute('aria-label', 'Genre');
    const box = el('div', 'chart-box chart-box--page');
    root.replaceChildren(bar, head, chips, box);
    const fill = (res) => {
      const fams = Chart.families(res);
      const sel = fams.find((f) => f.id === genre) || null;
      const chip = (label, id) => {
        const b = el('button', 'tag chart-genre', label);
        b.setAttribute('aria-pressed', String((sel?.id || null) === id));
        b.addEventListener('click', () => { current.genre = id; renderChart(period, id); });
        return b;
      };
      chips.replaceChildren(...(fams.length ? [chip('All', null), ...fams.map((f) => chip(genreLabel(f.name), f.id))] : []));
      chips.hidden = !fams.length;
      const rows = res && (sel ? res.rowsFor(sel.id, 100) : res.rows);
      if (!rows?.length) { box.replaceChildren(el('p', 'archive__empty', 'No chart for this period yet.')); return; }
      box.replaceChildren(
        el('p', 'chart-box__span', sel
          ? `${periodLabel(period)} · ${genreLabel(sel.name)}. Ranked by how many different shows played each track in episodes tagged ${genreLabel(sel.name)}.`
          : `${periodLabel(period)} · ${res.episodes.toLocaleString()} episodes. Ranked by how many different shows played each track.`),
        chartList(res, 100, sel?.id || null));
    };
    const now = Chart.peek(period);
    if (now) fill(now); else box.replaceChildren(loader('Loading the chart'));
    const res = await Chart.get(period);
    if (box.isConnected && current.type === 'chart' && (current.period || 'recent') === period && (current.genre || null) === genre) fill(res);
  }

  // ---- Feeling lucky: a random episode from anywhere in the archive ----
  // NTS's show list only pages through its first 1,000 shows (A to N), so the rest
  // (O to Z) come from show search. Then any episode in that show's history.
  const pickOne = (xs) => xs[Math.floor(Math.random() * xs.length)];
  const LIST_CAP = 1000;
  async function randomShow() {
    const meta = await api('/api/v2/shows?offset=0&limit=1');
    const total = meta.metadata?.resultset?.count || LIST_CAP;
    const i = Math.floor(Math.random() * total);
    if (i <= LIST_CAP) {
      const r = await api(`/api/v2/shows?offset=${i}&limit=1`);
      return r.results?.[0]?.show_alias;
    }
    const q = pickOne('abcdefghijklmnopqrstuvwxyz'.split(''));
    const r = await api(`/api/v2/search?q=${q}&version=2&offset=0&limit=50&types[]=show`);
    const aliases = (r.results || []).map((x) => parsePath(x.article?.path)?.show).filter(Boolean);
    const late = aliases.filter((a) => a > 'ninja-tune-takeover');     // past where the list stops
    return pickOne(late.length ? late : aliases);
  }
  async function randomEpisode() {
    for (let tries = 0; tries < 6; tries++) {
      const show = await randomShow().catch(() => null);
      if (!show) continue;
      const first = await api(`/api/v2/shows/${show}/episodes?offset=0&limit=1`).catch(() => null);
      const count = first?.metadata?.resultset?.count || 0;
      if (!count) continue;
      for (let j = 0; j < 3; j++) {
        const off = Math.floor(Math.random() * count);
        const r = off === 0 ? first : await api(`/api/v2/shows/${show}/episodes?offset=${off}&limit=1`).catch(() => null);
        const ep = r?.results?.[0];
        if (ep?.episode_alias && (ep.audio_sources || []).length) return { show, episode: ep.episode_alias };
      }
    }
    return null;
  }
  // On Home; and on the episode it picked, as "Try another" (again: true)
  function luckyButton({ again = false } = {}) {
    const b = el('button', 'lucky' + (again ? ' lucky--again' : ''));
    b.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="3.5" width="17" height="17"/><circle cx="8.5" cy="8.5" r="1.4"/><circle cx="15.5" cy="15.5" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="15.5" cy="8.5" r="1.4"/><circle cx="8.5" cy="15.5" r="1.4"/></svg>';
    const label = el('span', 'lucky__label', again ? 'Try another' : 'I’m feeling lucky');
    const subText = again ? 'Not for you? Another random episode' : 'A random episode from anywhere in the archive';
    const sub = el('span', 'lucky__sub', subText);
    b.append(label, sub);
    b.addEventListener('click', async () => {
      if (b.classList.contains('is-busy')) return;
      b.classList.add('is-busy');
      sub.textContent = 'Digging through the archive…';
      const ep = await randomEpisode();
      b.classList.remove('is-busy');
      sub.textContent = subText;
      if (!ep) { showSnack('Couldn’t find one this time. Try again'); return; }
      go({ type: 'episode', show: ep.show, episode: ep.episode, lucky: true });
      Archive.playFrom(ep.show, ep.episode, 0);
    });
    return b;
  }

  async function renderGenres() {
    const bar = backBar('Explore');
    root.replaceChildren(bar, loader('Loading'));
    let genres, moods;
    try { [genres, moods] = await Promise.all([getGenres(), getMoods().catch(() => [])]); }
    catch { root.replaceChildren(bar, failed('Couldn’t load genres.')); return; }
    if (current.type !== 'genres') return;
    const moodGrid = el('div', 'moods');
    moods.forEach((m) => moodGrid.append(moodTile(m)));
    const parts = [bar, sectionTitle('Moods'), moodGrid, sectionTitle('Genres')];
    genres.forEach((g) => {
      const group = el('div', 'genre');
      const head = el('button', 'genre__name', titleCase(g.name));
      head.addEventListener('click', () => go({ type: 'explore', kind: 'genre', id: g.id, name: titleCase(g.name) }));
      const subs = el('div', 'tags genre__subs');
      (g.subgenres || []).forEach((sg) => {
        const b = el('button', 'tag', sg.name);
        b.addEventListener('click', () => go({ type: 'explore', kind: 'genre', id: sg.id, name: sg.name }));
        subs.append(b);
      });
      group.append(head, subs);
      parts.push(group);
    });
    root.replaceChildren(...parts);
  }

  async function renderExplore(t) {
    const list = el('div', 'items');
    let offset = 0;
    const param = t.kind === 'mood' ? `moods[]=${enc(t.id)}` : `genres[]=${enc(t.id)}`;
    const more = async (btn) => {
      const res = await api(`/api/v2/search/episodes?${param}&offset=${offset}&limit=20`);
      offset += 20;
      (res.results || []).forEach((x) => {
        const p = parsePath(x.article?.path);
        if (!p?.episode) return;
        list.append(row({
          img: x.image?.small || x.image?.medium || '', title: x.title,
          meta: [x.local_date, x.location].filter(Boolean).join(' · '),
          playing: ArchivePlayer.isLoaded(p.show, p.episode),
          onClick: () => go({ type: 'episode', show: p.show, episode: p.episode })
        }));
      });
      btn?.remove();
      if (!list.children.length) list.append(el('p', 'archive__status', 'Nothing here yet.'));
      if (offset < (res.metadata?.resultset?.count ?? 0)) list.after(loadMoreButton(more));
    };
    const bar = backBar(`${t.kind === 'mood' ? 'Mood' : 'Genre'} · ${t.name}`);
    try {
      root.replaceChildren(bar, list);
      await more();
    } catch { root.replaceChildren(bar, failed('Couldn’t load these episodes.')); }
  }

  // ---- Episode page ----
  // Episode details + tracklist, in the shape the player uses
  // (remembered for 10 minutes: NTS in <year> asks a scene ahead, then again on the scene)
  const episodeCache = new Map();
  function fetchEpisode(show, episode) {
    const k = `${show}/${episode}`, c = episodeCache.get(k);
    if (c && Date.now() - c.at < 600000) return c.p;
    const p = fetchEpisodeFresh(show, episode);
    episodeCache.set(k, { at: Date.now(), p });
    p.catch(() => episodeCache.delete(k));
    return p;
  }
  async function fetchEpisodeFresh(show, episode) {
    const [ep, tl] = await Promise.all([
      api(`/api/v2/shows/${show}/episodes/${episode}`),
      api(`/api/v2/shows/${show}/episodes/${episode}/tracklist`).catch(() => ({ results: [] }))
    ]);
    const info = {
      show, episode, url: soundcloudUrl(ep), title: ep.name, img: pick(ep.media),
      date: ep.broadcast ? fmtDate(ep.broadcast) : '', location: ep.location_long || '',
      tracks: tl.results || []
    };
    return { ep, info };
  }

  async function renderEpisode(show, episode) {
    try {
      const { ep, info } = await fetchEpisode(show, episode);
      const url = info.url;
      const tracks = info.tracks;

      const wrap = el('div', 'detail');
      const picWrap = el('div', 'picture-wrap');
      const pic = el('div', 'picture');
      const img = el('img'); img.src = info.img; img.alt = '';
      const metaChips = el('span', 'picture__meta');
      if (info.location) metaChips.append(el('span', null, info.location));
      if (info.date) metaChips.append(el('span', null, info.date));
      pic.append(img, metaChips); picWrap.append(pic);

      const body = el('div', 'detail__body');
      body.append(el('h1', 'broadcast-heading', ep.name));
      const showLink = el('button', 'detail__show', 'More from this show ›');
      showLink.addEventListener('click', () => go({ type: 'show', show }));
      body.append(showLink, tagRow(ep.genres));

      const playBtn = el('button', 'episode-play');
      const startOver = el('button', 'episode-restart', 'Start over');
      const paintPlay = () => {
        const loaded = ArchivePlayer.isLoaded(show, episode);
        const s = ArchivePlayer.state;
        const resume = loaded ? s.position : History.resumeAt(show, episode);
        playBtn.disabled = !url;
        playBtn.classList.toggle('episode-play--active', loaded && s.playing);
        playBtn.textContent = !url ? 'Not available to stream'
          : loaded && s.loading ? 'Loading…'
          : loaded && s.playing ? 'Pause episode'
          : resume > 1000 ? `Resume from ${fmtOffset(Math.floor(resume / 1000))}` : 'Play episode';
        startOver.hidden = !url || (loaded && s.playing) || !(resume > 1000);
      };
      playBtn.addEventListener('click', () => {
        if (ArchivePlayer.isLoaded(show, episode)) togglePlayback();
        else playArchive(info, History.resumeAt(show, episode));
      });
      startOver.addEventListener('click', () => {
        if (ArchivePlayer.isLoaded(show, episode) && ArchivePlayer.state.episode && !startOver.hidden) {
          switchToArchive(); ArchivePlayer.seek(0); if (!ArchivePlayer.state.playing) ArchivePlayer.play();
        } else playArchive(info, 0);
      });
      const mynts = el('div');
      const autoplay = el('button', 'notify-toggle episode-autoplay');
      const paintAuto = () => {
        const on = localStorage.getItem('autoplay') !== '0';
        autoplay.classList.toggle('notify-toggle--on', on);
        autoplay.textContent = 'Autoplay next episode';
        autoplay.setAttribute('aria-pressed', String(on));
      };
      autoplay.addEventListener('click', () => {
        try { localStorage.setItem('autoplay', localStorage.getItem('autoplay') === '0' ? '1' : '0'); } catch {}
        paintAuto();
      });
      paintAuto();
      body.append(playBtn, startOver, autoplay, mynts);
      if (current.lucky) body.append(luckyButton({ again: true }));
      if (ep.description) body.append(el('p', 'broadcast-description detail__desc', ep.description));
      if (url) {
        const sc = el('a', 'text-link detail__source', 'Audio via SoundCloud');
        sc.href = url; sc.target = '_blank';
        body.append(sc);
      }
      wrap.append(picWrap, body);

      const list = el('ol', 'tracks archive-tracks');
      const saveButtons = new Map();
      tracks.forEach((t, i) => {
        const offset = t.offset ?? t.offset_estimate;
        const playable = url && offset != null;
        const li = trackRow(t, {
          saveButtons,
          title: 'Track details',
          onClick: () => go({ type: 'track', artist: t.artist, title: t.title,
            origin: { show, episode, title: info.title, date: info.date, offset, isrc_id: t.isrc_id, deezer_track_id: t.deezer_track_id } }),
          onPlay: playable ? () => {
            if (ArchivePlayer.isLoaded(show, episode)) { switchToArchive(); ArchivePlayer.seek(offset * 1000); }
            else playArchive(info, offset * 1000);
          } : null
        });
        li.dataset.index = i;
        list.append(li);
      });

      const head = sectionTitle(tracks.length ? `Tracklist · ${tracks.length}` : 'Tracklist');
      if (tracks.length) head.append(notifyToggle());
      const parts = [backBar(info.date), wrap, head];
      parts.push(tracks.length ? list : el('p', 'archive__status', 'No tracklist for this episode.'));
      root.replaceChildren(...parts);
      episodeView = { show, episode, tracks, list, paintPlay };
      MyNTS.mount(mynts, show, episode, { trackButtons: saveButtons, origin: info });
      paintPlay();
      highlight();
    } catch { root.replaceChildren(backBar(), failed('Couldn’t load this episode.')); }
  }

  // "Notify on track change" switch, shared by every episode
  function notifyToggle() {
    const b = el('button', 'notify-toggle');
    const paint = () => {
      b.classList.toggle('notify-toggle--on', TrackNotify.enabled());
      b.textContent = 'Notify on track change';
      b.setAttribute('aria-pressed', String(TrackNotify.enabled()));
    };
    b.addEventListener('click', async () => { await TrackNotify.setEnabled(!TrackNotify.enabled()); paint(); });
    paint();
    return b;
  }

  // Highlight the track that's playing now in an open episode page
  function highlight() {
    if (!episodeView) return;
    episodeView.paintPlay();
    const loaded = ArchivePlayer.isLoaded(episodeView.show, episodeView.episode);
    const pos = ArchivePlayer.state.position / 1000;
    let idx = -1;
    if (loaded) {
      episodeView.tracks.forEach((t, i) => {
        const o = t.offset ?? t.offset_estimate;
        if (o != null && o <= pos) idx = i;
      });
    }
    episodeView.list.querySelectorAll('.track').forEach((li) =>
      li.classList.toggle('track--now', Number(li.dataset.index) === idx));
  }

  // Next/previous track inside the playing episode (media keys)
  async function trackOffsets() {
    const ep = ArchivePlayer.state.episode;
    if (!ep) return [];
    if (episodeView && ArchivePlayer.isLoaded(episodeView.show, episodeView.episode)) {
      return episodeView.tracks.map((t) => t.offset ?? t.offset_estimate).filter((o) => o != null);
    }
    const tl = await api(`/api/v2/shows/${ep.show}/episodes/${ep.episode}/tracklist`).catch(() => ({ results: [] }));
    return (tl.results || []).map((t) => t.offset ?? t.offset_estimate).filter((o) => o != null);
  }
  async function skipTrack(dir) {
    const offsets = await trackOffsets();
    const pos = ArchivePlayer.state.position / 1000;
    let target;
    if (dir > 0) target = offsets.find((o) => o > pos + 1);
    else target = [...offsets].reverse().find((o) => o < pos - 5) ?? 0;
    if (target != null) ArchivePlayer.seek(target * 1000);
  }

  // ---- Search box ----
  input.addEventListener('input', () => {
    clearTimeout(searchTimer);
    const q = input.value.trim();
    searchTimer = setTimeout(() => {
      if (q.length >= 2) {
        if (current.type === 'search') { current = { type: 'search', q }; render(); }
        else go({ type: 'search', q });
      } else if (!q && current.type === 'search') back();
    }, 350);
  });
  input.addEventListener('keydown', (e) => {
    e.stopPropagation(); // don't trigger the Space / 1 / 2 shortcuts while typing
    if (e.key === 'Escape') { input.value = ''; input.dispatchEvent(new Event('input')); }
  });

  ArchivePlayer.onChange(highlight);
  Following.onChange(() => { if (current.type === 'home' || current.type === 'schedule') render(); });

  let started = false;
  // ---- Keep listening: what plays when an episode ends ----
  // The show's next older episode; when the show runs out, the newest in the archive.
  // Episodes without audio are skipped.
  async function nextEpisodes(show, episode) {
    const out = [];
    try {
      const res = await api(`/api/v2/shows/${show}/episodes?limit=50&offset=0`);
      const eps = res.results || [];
      const i = eps.findIndex((e) => e.episode_alias === episode);
      if (i >= 0) out.push(...eps.slice(i + 1, i + 6).map((e) => ({ show, episode: e.episode_alias })));
    } catch {}
    try {
      const res = await api('/api/v2/collections/recently-added?limit=10&offset=0');
      (res.results || []).forEach((e) => {
        if (e.episode_alias !== episode) out.push({ show: e.show_alias, episode: e.episode_alias });
      });
    } catch {}
    return out;
  }

  async function playNext(finished) {
    for (const cand of await nextEpisodes(finished.show, finished.episode)) {
      try {
        const { info } = await fetchEpisode(cand.show, cand.episode);
        if (!info.url) continue;
        playArchive(info, 0);
        showSnack(`Up next: ${info.title}${info.date ? ' · ' + info.date : ''}`);
        if (current.type === 'episode' && current.show === finished.show && current.episode === finished.episode) {
          go({ type: 'episode', show: cand.show, episode: cand.episode });   // follow along if you were watching it
        }
        return;
      } catch {}
    }
  }

  // On launch: if you were listening to an archive episode, open it paused where you left off
  async function resumeLast() {
    const s = Session.load();
    if (s?.source !== 'archive' || !s.show || !s.episode) return;
    try {
      const { info } = await fetchEpisode(s.show, s.episode);
      if (!info.url) return;
      const h = History.get(s.show, s.episode);
      const pos = h && !h.finished ? h.position || 0 : 0;
      primeArchive(info, pos, h?.duration || 0);
      view = 'archive';
      started = true;
      history.length = 0;
      history.push({ type: 'home' });
      current = { type: 'episode', show: s.show, episode: s.episode };
      render();
      if (typeof window.render === 'function') window.render();
    } catch {}
  }

  return {
    findTrack: (t) => TrackInfo.find(t),
    trackCount: (t) => TrackInfo.count(t),
    // is a tracklist row ({ artist, title }) this track? (tolerates swapped tags)
    sameTrack: (row, t) => TrackInfo.sameTrack({ title: row.title, artists: [{ name: row.artist }] }, t),
    // Get an episode ready to play from a position, out of sight (seconds)
    async preload(show, episode, offsetSec = 0) {
      try { const { info } = await fetchEpisode(show, episode); if (info.url) ArchivePlayer.preload(info, offsetSec * 1000); } catch {}
    },
    // Play an episode from a position (seconds)
    async playFrom(show, episode, offsetSec = 0) {
      try {
        const { info } = await fetchEpisode(show, episode);
        if (!info.url) { showSnack('This episode isn’t available to stream'); return; }
        if (ArchivePlayer.isLoaded(show, episode)) { switchToArchive(); ArchivePlayer.seek(offsetSec * 1000); }
        else playArchive(info, offsetSec * 1000);
      } catch { showSnack('Couldn’t load the episode'); }
    },
    tagButtons,
    resumeLast,
    home() { started = true; history.length = 0; current = { type: 'home' }; render(); },
    refreshOnAir() { const box = document.getElementById('onAir'); if (box && current.type === 'home') fillOnAir(box); },
    playNext,
    refresh() { if (started) render(); },
    open() { if (!started) { started = true; render(); } },
    showEpisode(show, episode) { go({ type: 'episode', show, episode }); },
    showShow(show) { started = true; go({ type: 'show', show }); },
    artist: (name) => Artists.get(name),
    showArtist(name) { started = true; go({ type: 'artist', name }); },
    showTrack(artist, title, { fromLive } = {}) {
      started = true;
      if (fromLive) { go({ type: 'track', artist, title, returnLive: true }); view = 'archive'; return; }
      go({ type: 'track', artist, title });
    },
    skipTrack
  };
})();

// Pick up where you left off
Archive.resumeLast().then(() => {
  if (view !== 'archive') { view = 'archive'; Archive.open(); }   // start on Home
  if (typeof render === 'function') render();
});
