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
    if (!history.length) return;
    current = history.pop();
    render();
  }

  function render() {
    episodeView = null;
    root.replaceChildren(el('p', 'archive__status', 'Loading…'));
    if (current.type === 'home') renderHome();
    else if (current.type === 'search') renderSearch(current.q);
    else if (current.type === 'show') renderShow(current.show);
    else if (current.type === 'episode') renderEpisode(current.show, current.episode);
    else if (current.type === 'mynts') renderMyNts(current.kind);
  }

  function backBar(label) {
    const bar = el('div', 'archive__back');
    const btn = el('button', 'archive__back-button', '‹ Back');
    btn.addEventListener('click', back);
    bar.append(btn, el('span', 'archive__crumb', label || ''));
    return bar;
  }

  function sectionTitle(text) { return el('h2', 'archive__section', text); }

  function loadMoreButton(onClick) {
    const b = el('button', 'archive__more', 'Load more');
    b.addEventListener('click', async () => { b.disabled = true; b.textContent = 'Loading…'; await onClick(b); });
    return b;
  }

  // An episode or show row: thumbnail, title, meta line
  function row({ img, title, meta, kind, onClick, playing }) {
    const r = el('button', 'item' + (playing ? ' item--playing' : ''));
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
  function historySection() {
    const items = History.all().slice(0, 8);
    if (!items.length) return [];
    const head = sectionTitle('History');
    const clear = el('button', 'archive__clear', 'Clear');
    clear.addEventListener('click', () => { History.clear(); render(); });
    head.append(clear);
    const list = el('div', 'items');
    items.forEach((h) => {
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
      list.append(r);
    });
    return [head, list];
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

  async function renderMyNts(kind) {
    const titles = { episodes: 'Saved episodes', shows: 'Followed shows', tracks: 'Saved tracks' };
    root.replaceChildren(backBar(`My NTS · ${titles[kind]}`), el('p', 'archive__status', 'Loading from My NTS…'));
    const res = await window.nts.account.list(kind).catch(() => null);
    if (current.type !== 'mynts' || current.kind !== kind) return;
    if (!res || res.signedIn === false) {
      const btn = el('button', 'archive__more', 'Sign in to NTS');
      btn.addEventListener('click', () => window.nts.signIn());
      root.replaceChildren(backBar(`My NTS · ${titles[kind]}`),
        el('p', 'archive__status', 'Sign in with your NTS account to see what you’ve saved on nts.live and the NTS app.'), btn);
      return;
    }
    if (!res.available) {
      root.replaceChildren(backBar(`My NTS · ${titles[kind]}`), el('p', 'archive__status', 'Couldn’t read My NTS right now.'));
      return;
    }
    const list = el('div', 'items');
    if (kind === 'tracks') {
      const ol = el('ol', 'tracks archive-tracks');
      (res.tracks || []).forEach((t) => {
        const p = parsePath(t.path);
        ol.append(trackRow({ artist: t.artist, title: t.title }, {
          title: p?.episode ? 'Open the episode' : 'Click to copy',
          onClick: p?.episode ? () => go({ type: 'episode', show: p.show, episode: p.episode }) : undefined
        }));
      });
      list.append(ol);
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
    const empty = kind === 'tracks' ? !(res.tracks || []).length : !list.children.length;
    root.replaceChildren(backBar(`My NTS · ${titles[kind]}`),
      empty ? el('p', 'archive__status', `Nothing here yet.`) : list);
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
      root.replaceChildren(...historySection(), ...myNtsSection(), sectionTitle('Recently added'), list);
      await more();
    } catch { root.replaceChildren(el('p', 'archive__status', 'Could not load the archive.')); }
  }

  // ---- Search ----
  async function renderSearch(q) {
    const list = el('div', 'items');
    let offset = 0;
    const more = async (btn) => {
      const res = await api(`/api/v2/search?q=${encodeURIComponent(q)}&version=2&offset=${offset}&limit=20&types[]=show&types[]=episode`);
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
    } catch { root.replaceChildren(backBar(), el('p', 'archive__status', 'Search failed. Try again.')); }
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
    } catch { root.replaceChildren(backBar(), el('p', 'archive__status', 'Could not load this show.')); }
  }

  function tagRow(genres) {
    const tags = el('div', 'tags');
    (genres || []).map((g) => (g.value || '').trim()).filter(Boolean).slice(0, 4)
      .forEach((g) => tags.append(el('span', 'tag', g)));
    return tags;
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
      body.append(playBtn, startOver, mynts);
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
          title: playable ? 'Play from here' : 'Click to copy',
          onClick: () => {
            if (!playable) { copyTrack(`${t.artist} - ${t.title}`); return; }
            if (ArchivePlayer.isLoaded(show, episode)) { switchToArchive(); ArchivePlayer.seek(offset * 1000); }
            else playArchive(info, offset * 1000);
          }
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
      MyNTS.mount(mynts, show, episode, { trackButtons: saveButtons });
      paintPlay();
      highlight();
    } catch { root.replaceChildren(backBar(), el('p', 'archive__status', 'Could not load this episode.')); }
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

  let started = false;
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
    resumeLast,
    refresh() { if (started) render(); },
    open() { if (!started) { started = true; render(); } },
    showEpisode(show, episode) { go({ type: 'episode', show, episode }); },
    skipTrack
  };
})();

// Pick up where you left off
Archive.resumeLast().then(() => { if (typeof render === 'function') render(); });
