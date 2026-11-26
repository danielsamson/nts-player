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
    else if (current.type === 'track') renderTrack({ artist: current.artist, title: current.title });
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
      i.src = img; pic.append(i);
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
          onClick: () => go({ type: 'track', artist: t.artist, title: t.title })
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

  // ---- Track page: big cover, details, links, where it was played ----
  async function renderTrack(t) {
    const wrap = el('div', 'detail track-page');
    const picWrap = el('div', 'picture-wrap');
    const pic = el('div', 'picture track-page__art');
    const img = el('img'); img.alt = '';
    pic.append(img); picWrap.append(pic);
    const body = el('div', 'detail__body');
    const title = el('h1', 'broadcast-heading', t.title);
    const artist = el('p', 'track-page__artist', t.artist);
    const album = el('p', 'detail__meta');
    const from = el('div', 'track-page__from');
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
    body.append(title, artist, album, from, linksNav, actions);
    wrap.append(picWrap, body);
    root.replaceChildren(backBar(current.type === 'track' && !current.returnLive && !current.origin ? 'Saved track' : 'Track'), wrap);

    Stage.paintLinks(Stage.links(t, null), linksList, linksLabel);
    from.append(loader('Finding where it was played'));

    // Episodes it was played on (NTS track search) and the one you saved it from
    const info = await TrackInfo.find(t);
    if (current.type !== 'track' || current.title !== t.title) return;
    const remembered = current.origin || MyNTS.originOf(t);
    const o = remembered?.show ? remembered : info.match;
    from.replaceChildren();
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
      from.append(playFrom);
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
      root.replaceChildren(...onAirSection(), ...continueSection(), ...(await comingUpSection()), ...exploreSection(), ...myNtsSection(), sectionTitle('Recently added'), list);
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
      if (!rows.length && offset === 20) list.append(el('p', 'archive__status', `Nothing found for “${q}”.`));
      list.append(...rows);
      btn?.remove();
      if (offset < (res.metadata?.resultset?.count ?? 0)) list.after(loadMoreButton(more));
    };
    try {
      root.replaceChildren(backBar(`Search: ${q}`), list);
      await more();
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
      root.replaceChildren(backBar('Show'), head, sectionTitle('Episodes'), list);
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
  function luckyButton() {
    const b = el('button', 'lucky');
    b.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="3.5" width="17" height="17"/><circle cx="8.5" cy="8.5" r="1.4"/><circle cx="15.5" cy="15.5" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="15.5" cy="8.5" r="1.4"/><circle cx="8.5" cy="15.5" r="1.4"/></svg>';
    const label = el('span', 'lucky__label', 'I’m feeling lucky');
    const sub = el('span', 'lucky__sub', 'A random episode from anywhere in the archive');
    b.append(label, sub);
    b.addEventListener('click', async () => {
      if (b.classList.contains('is-busy')) return;
      b.classList.add('is-busy');
      sub.textContent = 'Digging through the archive…';
      const ep = await randomEpisode();
      b.classList.remove('is-busy');
      sub.textContent = 'A random episode from anywhere in the archive';
      if (!ep) { showSnack('Couldn’t find one this time. Try again'); return; }
      go({ type: 'episode', show: ep.show, episode: ep.episode });
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
  async function fetchEpisode(show, episode) {
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
