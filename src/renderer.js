const STREAMS = [
  'https://stream-relay-geo.ntslive.net/stream',
  'https://stream-relay-geo.ntslive.net/stream2'
];

const $ = (id) => document.getElementById(id);
const audio = $('audio');
let channel = Number(localStorage.getItem('channel') || 0);
let playing = false;            // live radio playing
let view = 'live';              // 'live' or 'archive': what the panel shows
let source = 'live';            // 'live' or 'archive': what the play button controls
let live = null;
let pane = localStorage.getItem('pane') || 'about';
// Set once you've signed in to NTS; cleared if NTS sends the tracklist to sign-in
let supporter = localStorage.getItem('supporter') === '1';
const tracklists = new Map();   // key -> { tracks, source, date, alias, show }

audio.volume = Number(localStorage.getItem('volume') ?? 0.8);
$('volume').value = audio.volume;
const paintVolume = () => $('volume').style.setProperty('--fill', `${audio.volume * 100}%`);
paintVolume();

function fmtTime(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
}

// NTS sometimes sends titles with HTML entities ("Burnin&#039;")
const unescapeHtml = (x) => { const t = document.createElement('textarea'); t.innerHTML = x || ''; return t.value; };

function showInfo(r) {
  const now = r?.now || {};
  const d = now.embeds?.details || {};
  const media = d.media || {};
  return {
    title: unescapeHtml(now.broadcast_title || d.name || 'NTS Live'),
    location: d.location_long || '',
    description: d.description || '',
    img: media.background_large || media.picture_large || media.background_medium || media.picture_medium || '',
    start: now.start_timestamp, end: now.end_timestamp,
    next: r?.next || r?.next1,
    show: d.show_alias || '',
    episode: d.episode_alias || '',
    genres: (d.genres || []).map((g) => (g.value || '').trim()).filter(Boolean),
    genreTags: d.genres || []
  };
}

function render() {
  document.querySelectorAll('.tab[data-ch]').forEach((b) =>
    b.classList.toggle('active', view === 'live' && Number(b.dataset.ch) === channel));
  // The channel you're hearing is highlighted on every page (Home, archive, ...)
  document.querySelectorAll('.tab[data-ch]').forEach((b) =>
    b.classList.toggle('tab--hearing', playing && source === 'live' && Number(b.dataset.ch) === channel));
  $('archiveTab').classList.toggle('active', view === 'archive');
  document.body.classList.toggle('view-archive', view === 'archive');
  $('channel').hidden = view !== 'live';
  $('archive').hidden = view !== 'archive';
  renderNowbar();
  document.body.classList.toggle('playing', playing);
  document.querySelectorAll('.tab[data-ch]').forEach((b) => {
    const ch = Number(b.dataset.ch);
    b.title = ch === channel ? (playing ? `Playing NTS ${ch + 1}` : `NTS ${ch + 1} selected`) : `Switch to NTS ${ch + 1}`;
  });
  document.body.classList.toggle('pane-tracks', pane === 'tracks');

  const results = live?.results;
  if (!results) return;
  results.slice(0, 2).forEach((r, i) => { $(`tabTitle${i}`).textContent = showInfo(r).title; });

  const info = showInfo(results[channel]);
  $('title').textContent = info.title;
  $('location').textContent = info.location;
  $('description').textContent = info.description;
  $('tags').replaceChildren(...(typeof Archive !== 'undefined' ? Archive.tagButtons(info.genreTags) : []));
  const myKey = `${info.show}/${info.episode}`;
  if ($('liveMyNts').dataset.key !== myKey) {
    $('liveMyNts').dataset.key = myKey;
    MyNTS.mount($('liveMyNts'), info.show, info.episode);
  }
  const link = $('episodeLink');
  link.hidden = !info.episode;
  if (info.episode) link.href = `https://www.nts.live/shows/${info.show}/episodes/${info.episode}`;
  document.querySelectorAll('.switch__item').forEach((b) => b.classList.toggle('active', b.dataset.pane === pane));
  $('pane-about').hidden = pane !== 'about';
  $('pane-tracks').hidden = pane !== 'tracks';
  renderSupporter();
  if (!supporter) renderTracks(info);
  $('time').textContent = info.start ? `${fmtTime(info.start)}–${fmtTime(info.end)}` : '';
  if ($('art').getAttribute('src') !== info.img) $('art').setAttribute('src', info.img);
  nextText = info.next?.broadcast_title
    ? `Next ${fmtTime(info.next.start_timestamp)} · ${info.next.broadcast_title}` : '';
  renderNowbar();
  recordLive();
  if (typeof Stage !== 'undefined') Stage.render();

  if (source === 'live' && 'mediaSession' in navigator) {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: info.title, artist: `NTS ${channel + 1}`, album: info.location || 'NTS Radio',
      artwork: info.img ? [{ src: info.img, sizes: '512x512' }] : []
    });
  }
}

// ---- Album art for tracks (looked up in the main process, see art.js) ----
const Art = (() => {
  const memo = new Map();
  const key = (t) => `${t.artist}|${t.title}|${t.deezer_track_id || ''}|${t.isrc_id || ''}`;
  // priority 'high' for the track you're listening to; tracklist rows use 'low'
  function get(t, priority = 'low') {
    if (!t?.artist || !t?.title) return Promise.resolve(null);
    const k = key(t);
    if (!memo.has(k) || (priority === 'high' && memo.get(k).low)) {
      const p = window.nts.art({ artist: t.artist, title: t.title, isrc: t.isrc_id, deezer: t.deezer_track_id }, priority)
        .catch(() => null)
        .then((art) => { if (!art) memo.delete(k); return art; });   // misses can be retried later
      p.low = priority !== 'high';
      memo.set(k, p);
    }
    return memo.get(k);
  }
  // Load art only when a row scrolls into view
  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (!e.isIntersecting) return;
      io.unobserve(e.target);
      const t = e.target._track;
      get(t).then((art) => {
        if (!art?.small) { e.target.classList.add('track__art--none'); return; }
        const img = new Image();
        img.alt = '';
        img.onload = () => e.target.replaceChildren(img);
        img.src = art.small;
      });
    });
  }, { rootMargin: '200px' });
  function attach(box, t) { box._track = t; io.observe(box); }
  return { get, attach };
})();

// One tracklist row: album art, time, artist, title, copy button
function trackRow(t, { onClick, title, saveButtons, deferArt, onPlay, liveSave } = {}) {
  const li = document.createElement('li');
  li.className = 'track';
  li.title = title || 'Click to copy';
  const art = document.createElement('span'); art.className = 'track__art';
  if (deferArt) li._artBox = art; else Art.attach(art, t);
  const text = document.createElement('span'); text.className = 'track__text';
  const top = document.createElement('span'); top.className = 'track__top';
  const time = document.createElement('span'); time.className = 'track__time';
  time.textContent = t.time || fmtOffset(t.offset ?? t.offset_estimate);
  const artist = document.createElement('span'); artist.className = 'track__artist'; artist.textContent = t.artist;
  top.append(time, artist);
  const name = document.createElement('span'); name.className = 'track__title'; name.textContent = t.title;
  text.append(top, name);
  const copy = document.createElement('button'); copy.className = 'track__copy'; copy.title = 'Copy track';
  copy.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="12" height="12"/><path d="M16 8V4H4v12h4"/></svg>';
  copy.addEventListener('click', (e) => { e.stopPropagation(); copyTrack(`${t.artist} - ${t.title}`); });
  const actions = document.createElement('span'); actions.className = 'track__actions';
  if (onPlay) {
    const pl = document.createElement('button');
    pl.className = 'track__play'; pl.title = `Play from ${time.textContent}`;
    pl.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4.5v15l12.5-7.5z"/></svg>';
    pl.addEventListener('click', (e) => { e.stopPropagation(); onPlay(); });
    actions.append(pl);
  }
  if (liveSave) actions.append(liveSaveButton(t));
  if (saveButtons) {
    const save = document.createElement('button');
    save.className = 'track__save'; save.hidden = true; save.title = 'Save track to My NTS';
    save.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h12v18l-6-4.5L6 21z"/></svg>';
    saveButtons.set(MyNTS.trackKey(t), save);
    actions.append(save);
  }
  actions.append(copy);
  li.append(art, text, actions);
  li.addEventListener('click', onClick || (() => copyTrack(`${t.artist} - ${t.title}`)));
  // Keyboard: rows are focusable; Enter or Space opens them
  li.tabIndex = 0;
  li.setAttribute('role', 'button');
  li.setAttribute('aria-label', `${t.artist} – ${t.title}${time.textContent ? ', ' + time.textContent : ''}`);
  li.addEventListener('keydown', (e) => {
    if (e.target !== li) return;
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); li.click(); }
  });
  // icon buttons are announced by their tooltip
  actions.querySelectorAll('button').forEach((b) => { if (b.title && !b.getAttribute('aria-label')) b.setAttribute('aria-label', b.title); });
  return li;
}

// Bookmark for a live tracklist row: saves through an episode that has the track
function isKnownSaved(t) {
  if (MyNTS.originOf(t)) return true;
  try {
    const n = (x) => String(x || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    return (JSON.parse(localStorage.getItem('mynts:tracks'))?.tracks || []).some((x) => n(x.title) === n(t.title));
  } catch { return false; }
}
function liveSaveButton(t) {
  const b = document.createElement('button');
  b.className = 'track__save';
  b.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h12v18l-6-4.5L6 21z"/></svg>';
  const paint = () => {
    const saved = isKnownSaved(t);
    b.classList.toggle('track__save--on', saved);
    b.title = saved ? 'Saved to My NTS: click to remove' : 'Save track to My NTS';
  };
  paint();
  b.hidden = !supporter;
  b.addEventListener('click', async (e) => {
    e.stopPropagation();
    b.classList.add('is-busy');
    const want = !isKnownSaved(t);
    const o = MyNTS.originOf(t);
    const ep = !want && o?.show ? o : await liveSaveTarget(t);
    if (!ep) { b.classList.remove('is-busy'); showSnack('NTS hasn’t logged this track yet, so it can’t be saved'); return; }
    await MyNTS.toggleTrack(ep.show, ep.episode, t, want, { show: ep.show, episode: ep.episode, title: ep.title, date: ep.date, offset: ep.offset });
    b.classList.remove('is-busy');
    paint();
    NowSave.update(true);
  });
  return b;
}

// ---- Now-playing bar: live radio or an archive episode ----
let nextText = '';
let nowArtUrl = '';
function setNowArt(url) {
  nowArtUrl = url || '';
  const img = $('nowArtImg');
  if (url) img.src = url; else img.removeAttribute('src');
  renderNowbar();
}
const fmtMs = (ms) => fmtOffset(Math.max(0, Math.floor((ms || 0) / 1000)));

// The track playing in an archive episode, for the bar (the stage may be showing the track web)
function nowTrackText(a) {
  const pos = a.position / 1000;
  let cur = null;
  for (const t of a.episode?.tracks || []) { const o = t.offset ?? t.offset_estimate; if (o != null && o <= pos) cur = t; }
  return cur ? `${cur.artist} – ${cur.title}` : (a.episode?.date || '');
}

function renderNowbar() {
  const a = ArchivePlayer.state;
  const archive = source === 'archive' && a.episode;
  const active = archive ? (a.playing || a.loading) : playing;
  document.body.classList.toggle('archive-playing', !!(archive && (a.playing || a.loading)));
  document.body.classList.toggle('source-archive', !!archive);
  const canSkip = !!(archive && a.episode.tracks?.length);
  $('prevTrack').hidden = !canSkip;
  $('nextTrack').hidden = !canSkip;
  document.body.classList.toggle('can-skip', canSkip);
  $('iconPlay').toggleAttribute('hidden', active);
  $('iconPause').toggleAttribute('hidden', !active);
  $('play').setAttribute('aria-label', active ? (archive ? 'Pause' : 'Stop') : 'Play');

  if (archive) {
    $('nowKind').textContent = 'Archive';
    $('nowLabel').textContent = a.episode.title;
    $('next').textContent = !navigator.onLine ? 'Offline · waiting for a connection'
      : a.error ? `${a.error}${localStorage.getItem('autoplay') !== '0' ? ' Skipping…' : ''}`
      : a.loading ? 'Loading…'
      : [nowTrackText(a), `${fmtMs(a.position)} / ${a.duration ? fmtMs(a.duration) : '–'}`].filter(Boolean).join(' · ');
    $('seekFill').style.width = a.duration ? `${Math.min(100, (a.position / a.duration) * 100)}%` : '0%';
    $('nowArt').hidden = !nowArtUrl;
    document.title = `NTS Archive · ${a.episode.title}`;
  } else {
    $('nowKind').textContent = '';
    $('nowArt').hidden = true;
    $('nowLabel').textContent = `${playing ? 'Playing' : 'Play'} NTS ${channel + 1}`;
    const lt = LiveNow?.track;
    $('next').textContent = !navigator.onLine ? 'Offline · waiting for a connection'
      : playing && reconnecting ? 'Reconnecting…'
      : playing && lt ? `Now: ${lt.artist} – ${lt.title}` : nextText;
    const t = live?.results?.[channel] ? showInfo(live.results[channel]).title : '';
    document.title = t ? `NTS ${channel + 1} · ${t}` : 'NTS Player';
  }
  // Tray menu / mini player know what's playing
  const label = archive ? `Archive · ${a.episode.title}` : `NTS ${channel + 1}${live?.results?.[channel] ? ' · ' + showInfo(live.results[channel]).title : ''}`;
  if ('mediaSession' in navigator) navigator.mediaSession.playbackState = active ? 'playing' : (archive || playing ? 'paused' : 'none');
  const sig = `${active}|${label}|${canSkip}`;
  if (sig !== desktopSig) { desktopSig = sig; window.nts.desktop?.state({ playing: active, label, canSkip }); }
  const srcSig = `${source}|${playing}|${channel}`;
  if (srcSig !== nowSaveSource) { nowSaveSource = srcSig; if (typeof NowSave !== 'undefined') NowSave.update(); }
}
let desktopSig = '';
let nowSaveSource = '';

// Start an archive episode (stops live radio)
function playArchive(info, startMs = 0) {
  if (playing) stop();
  source = 'archive';
  setNowArt('');
  ArchivePlayer.load(info, startMs);
  ArchivePlayer.setVolume(audio.muted ? 0 : audio.volume);
  if ('mediaSession' in navigator) {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: info.title, artist: 'NTS Archive', album: [info.location, info.date].filter(Boolean).join(' · '),
      artwork: info.img ? [{ src: info.img, sizes: '512x512' }] : []
    });
  }
  render();
}
function switchToArchive() { if (playing) stop(); source = 'archive'; }

// The one play button: controls whichever source is current
function togglePlayback() {
  if (source === 'archive' && ArchivePlayer.state.episode) {
    if (!ArchivePlayer.state.playing && playing) stop();
    ArchivePlayer.toggle();
  } else {
    playing ? stop() : play();
  }
}

ArchivePlayer.onChange(renderNowbar);

// When an episode ends, keep listening (unless Autoplay is switched off)
(() => {
  let handled = null;
  ArchivePlayer.onChange((a) => {
    if (!a.episode || source !== 'archive') return;
    // An episode that won't play: move on after a moment (when autoplay is on)
    if (a.error && navigator.onLine && localStorage.getItem('autoplay') !== '0') {
      const key = `err:${a.episode.show}/${a.episode.episode}`;
      if (handled === key) return;
      handled = key;
      const ep = a.episode;
      setTimeout(() => { if (ArchivePlayer.state.episode === ep && ArchivePlayer.state.error) Archive.playNext(ep); }, 4000);
      return;
    }
    if (!a.finished) return;
    const key = `${a.episode.show}/${a.episode.episode}`;
    if (handled === key) return;
    handled = key;
    if (localStorage.getItem('autoplay') === '0' || Sleep.blocksAutoplay()) return;
    Archive.playNext(a.episode);
  });
})();

// A small NTS-style loader: three blinking squares and a label
function loader(text) {
  const d = document.createElement('div');
  d.className = 'loader';
  d.innerHTML = '<span class="loader__dots" aria-hidden="true"><i></i><i></i><i></i></span><span class="loader__text"></span>';
  d.querySelector('.loader__text').textContent = text;
  d.setAttribute('role', 'status');
  return d;
}

// ---- My NTS: save episodes, follow shows, save tracks (see account.js) ----
// Draws "Save episode" / "Follow show" buttons into a container and keeps track
// buttons in sync. Reads the state from NTS when mounted.
const MyNTS = (() => {
  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const ICON_SAVE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h12v18l-6-4.5L6 21z"/></svg>';
  const ICON_FOLLOW = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-7.5-4.6-9.5-9.2C1.2 8.6 3.3 5 6.8 5c2 0 3.6 1.1 5.2 3 1.6-1.9 3.2-3 5.2-3 3.5 0 5.6 3.6 4.3 6.8C19.5 16.4 12 21 12 21z"/></svg>';

  function button(label, icon) {
    const b = document.createElement('button');
    b.className = 'mynts-btn';
    b.innerHTML = `${icon}<span></span>`;
    b.querySelector('span').textContent = label;
    return b;
  }

  // One read per episode, shared by the episode page, the live view and the stage
  const states = new Map();
  function getState(show, episode, force = false) {
    const k = `${show}/${episode}`;
    if (force || !states.has(k)) {
      states.set(k, window.nts.account.episode(show, episode).catch(() => ({ available: false })));
    }
    return states.get(k);
  }
  const setState = (show, episode, st) => states.set(`${show}/${episode}`, Promise.resolve(st));

  // Remember which episode a saved track came from (NTS's saved-tracks page doesn't say)
  const ORIGINS = 'savedTrackOrigins';
  function rememberOrigin(track, origin) {
    try {
      const m = JSON.parse(localStorage.getItem(ORIGINS) || '{}');
      m[norm(track.title)] = origin;
      localStorage.setItem(ORIGINS, JSON.stringify(m));
    } catch {}
  }
  function forgetSaved(track) {
    try {
      const m = JSON.parse(localStorage.getItem(ORIGINS) || '{}');
      delete m[norm(track.title)];
      localStorage.setItem(ORIGINS, JSON.stringify(m));
      const c = JSON.parse(localStorage.getItem('mynts:tracks') || 'null');
      if (c?.tracks) { c.tracks = c.tracks.filter((x) => norm(x.title) !== norm(track.title)); localStorage.setItem('mynts:tracks', JSON.stringify(c)); }
    } catch {}
  }
  function originOf(track) {
    try { return JSON.parse(localStorage.getItem(ORIGINS) || '{}')[norm(track.title)] || null; } catch { return null; }
  }

  // Save / unsave one track (by title) on an episode; returns the new state
  async function toggleTrack(show, episode, track, want, origin) {
    const res = await window.nts.account.toggle({ show, episode, kind: 'track', want, artist: track.artist, title: track.title }).catch(() => null);
    if (res && !res.error) {
      setState(show, episode, res);
      if (want && origin) rememberOrigin(track, origin);
      if (!want) forgetSaved(track);
      showSnack(want ? 'Track saved to My NTS' : 'Track removed');
    } else showSnack('Couldn’t update My NTS. Try again on nts.live');
    return res;
  }
  const trackState = (st, track) => st?.tracks?.find((x) => norm(x.title) === norm(track.title)) || null;

  // container: element to fill. trackButtons: optional Map("artist|title" -> button)
  function mount(container, show, episode, { trackButtons, origin } = {}) {
    container.replaceChildren();
    container.classList.add('mynts');
    if (!show || !episode) return;
    const note = document.createElement('span');
    note.className = 'mynts__note';
    container.append(loader('Checking My NTS'));
    let state = null;

    const save = button('Save episode', ICON_SAVE);
    const follow = button('Follow show', ICON_FOLLOW);

    function paint() {
      if (!state?.available) {
        if (!state) { container.replaceChildren(loader('Checking My NTS')); return; }
        note.textContent = 'My NTS isn’t available right now';
        container.replaceChildren(note);
        return;
      }
      if (!state.signedIn) {
        const link = document.createElement('button');
        link.className = 'mynts__signin';
        link.textContent = 'Sign in to save to My NTS';
        link.addEventListener('click', () => window.nts.signIn());
        container.replaceChildren(link);
        trackButtons?.forEach((b) => { b.hidden = true; });
        return;
      }
      save.classList.toggle('mynts-btn--on', !!state.saved);
      save.querySelector('span').textContent = state.saved ? 'Saved' : 'Save episode';
      save.title = state.saved ? 'Remove from your saved episodes' : 'Save to My NTS';
      follow.classList.toggle('mynts-btn--on', !!state.following);
      follow.querySelector('span').textContent = state.following ? 'Following' : 'Follow show';
      follow.title = state.following ? 'Unfollow this show' : 'Follow this show in My NTS';
      const parts = [];
      if (state.saved !== null) parts.push(save);
      if (state.following !== null) parts.push(follow);
      container.replaceChildren(...parts);
      trackButtons?.forEach((b, key) => {
        const t = state.tracks?.find((x) => norm(x.title) === key);
        b.hidden = !t?.canSave;
        b.classList.toggle('track__save--on', !!t?.saved);
        b.title = t?.saved ? 'Remove from your saved tracks' : 'Save track to My NTS';
      });
    }

    async function act(kind, want, extra = {}, btn) {
      btn?.classList.add('mynts-btn--busy');
      const res = await window.nts.account.toggle({ show, episode, kind, want, ...extra }).catch(() => null);
      btn?.classList.remove('mynts-btn--busy');
      if (res) state = res;
      if (res && !res.error) setState(show, episode, res);
      if (res && !res.error && kind === 'track' && want && origin) {
        const tr = (origin.tracks || []).find((x) => norm(x.title) === norm(extra.title));
        rememberOrigin({ title: extra.title }, { show, episode, title: origin.title, date: origin.date, offset: tr ? (tr.offset ?? tr.offset_estimate) : null });
      }
      if (!res || res.error) showSnack('Couldn’t update My NTS. Try again on nts.live');
      else showSnack(kind === 'episode' ? (want ? 'Saved to My NTS' : 'Removed from saved episodes')
        : kind === 'show' ? (want ? 'Following in My NTS' : 'Unfollowed')
        : (want ? 'Track saved to My NTS' : 'Track removed'));
      paint();
    }
    save.addEventListener('click', () => act('episode', !state.saved, {}, save));
    follow.addEventListener('click', () => act('show', !state.following, {}, follow));
    trackButtons?.forEach((b, key) => {
      b.hidden = true;
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        const t = state?.tracks?.find((x) => norm(x.title) === key);
        if (t) act('track', !t.saved, { artist: t.artist, title: t.title }, b);
      });
    });

    getState(show, episode).then((s) => {
      if (!container.isConnected) return;
      state = s || { available: false };
      paint();
    });
  }

  // tracks are matched by title: NTS's page formats artists differently from its API
  const trackKey = (t) => norm(t.title);
  return { mount, trackKey, getState, toggleTrack, trackState, originOf, rememberOrigin };
})();

// ---- Listening history ----
// Archive episodes with how far you got, and live shows you heard, newest first.
// Stored on this computer only.
const History = (() => {
  const KEY = 'history';
  const MAX = 50;
  let items;
  try { items = JSON.parse(localStorage.getItem(KEY)) || []; } catch { items = []; }
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(items.slice(0, MAX))); } catch {} };
  const id = (show, episode) => `${show}/${episode}`;
  const get = (show, episode) => items.find((i) => i.id === id(show, episode));

  function upsert(show, episode, patch) {
    if (!show || !episode) return null;
    let it = get(show, episode);
    if (it) items = items.filter((i) => i !== it);
    else it = { id: id(show, episode), show, episode };
    Object.assign(it, patch, { at: Date.now() });
    items.unshift(it);
    save();
    return it;
  }

  // Where to resume an episode: only if you're past the start and not at the very end
  function resumeAt(show, episode) {
    const it = get(show, episode);
    if (!it?.position || !it?.duration) return 0;
    return it.position > 30_000 && it.position < it.duration - 60_000 ? it.position : 0;
  }

  return {
    all: () => items,
    get, upsert, resumeAt,
    clear() { items = []; save(); }
  };
})();

// Remember what you were listening to, for resuming next time
const Session = {
  save(s) { try { localStorage.setItem('lastSession', JSON.stringify(s)); } catch {} },
  load() { try { return JSON.parse(localStorage.getItem('lastSession')); } catch { return null; } }
};

// Record archive progress every few seconds while playing, and on pause
(() => {
  let lastSave = 0;
  const record = (a) => {
    const ep = a.episode;
    if (!ep || !a.duration) return;
    History.upsert(ep.show, ep.episode, {
      kind: 'archive', title: ep.title, img: ep.img, date: ep.date, location: ep.location,
      position: Math.round(a.position), duration: Math.round(a.duration),
      finished: a.position >= a.duration - 1000
    });
    Session.save({ source: 'archive', show: ep.show, episode: ep.episode });
  };
  let wasPlaying = false;
  ArchivePlayer.onChange((a) => {
    if (a.playing && Date.now() - lastSave > 5000) { lastSave = Date.now(); record(a); }
    if (wasPlaying && !a.playing) record(a);
    wasPlaying = a.playing;
  });
  window.addEventListener('beforeunload', () => { if (ArchivePlayer.state.playing) record(ArchivePlayer.state); });
})();

// Show an archive episode in the now-playing bar, paused at a position (used on launch)
function primeArchive(info, positionMs, durationMs) {
  source = 'archive';
  ArchivePlayer.prime(info, positionMs, durationMs);
  render();
}

// ---- Track-change notifications for archive episodes ----
// When an episode moves into a new track from its tracklist, show a Windows
// notification and put the track in the system media overlay. Waits a moment
// so dragging the seek bar doesn't fire a burst of notifications.
const TrackNotify = (() => {
  let lastKey = null;
  let timer = null;
  const enabled = () => localStorage.getItem('trackNotify') !== '0';

  async function setEnabled(on) {
    try { localStorage.setItem('trackNotify', on ? '1' : '0'); } catch {}
  }

  function currentTrack() {
    const a = ArchivePlayer.state;
    const tracks = a.episode?.tracks || [];
    const pos = a.position / 1000;
    let idx = -1;
    tracks.forEach((t, i) => { const o = t.offset ?? t.offset_estimate; if (o != null && o <= pos) idx = i; });
    return idx >= 0 ? { idx, track: tracks[idx] } : null;
  }

  async function announce(ep, { idx, track }) {
    const total = ep.tracks.length;
    // Album art if we can find it quickly; otherwise the episode artwork
    const art = await Promise.race([Art.get(track, 'high'), new Promise((r) => setTimeout(() => r(null), 2500))]);
    if (lastKey !== `${ep.show}/${ep.episode}#${idx}`) return;   // moved on meanwhile
    setNowArt(art?.small || '');
    const cover = art?.large || ep.img;
    if ('mediaSession' in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: track.title, artist: track.artist, album: `NTS Archive · ${ep.title}`,
        artwork: cover ? [{ src: cover, sizes: '512x512' }] : []
      });
    }
    if (!enabled()) return;
    // Shown by the main process (one at a time, with the album art as its picture)
    window.nts.notify({ title: `${track.artist} – ${track.title}`, body: `${ep.title} · track ${idx + 1} of ${total}`, art: cover });
  }

  ArchivePlayer.onChange((a) => {
    if (!a.playing || !a.episode?.tracks?.length) return;
    const cur = currentTrack();
    const key = cur ? `${a.episode.show}/${a.episode.episode}#${cur.idx}` : null;
    if (key === lastKey) return;
    lastKey = key;
    clearTimeout(timer);
    if (!cur) { setNowArt(''); return; }
    const ep = a.episode;
    timer = setTimeout(() => {
      if (lastKey === key && ArchivePlayer.state.playing) announce(ep, cur);
    }, 1500);
  });

  return { enabled, setEnabled, currentTrack };
})();

// Seek bar (archive only): click or drag
(() => {
  const bar = $('seek');
  let dragging = false;
  const seekTo = (e) => {
    const a = ArchivePlayer.state;
    if (!a.duration) return;
    const r = bar.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    $('seekFill').style.width = `${ratio * 100}%`;
    if (!dragging) ArchivePlayer.seek(ratio * a.duration);
    return ratio * a.duration;
  };
  bar.addEventListener('pointerdown', (e) => { dragging = true; bar.setPointerCapture(e.pointerId); seekTo(e); });
  bar.addEventListener('pointermove', (e) => { if (dragging) seekTo(e); });
  bar.addEventListener('pointerup', (e) => { const ms = seekTo(e); dragging = false; if (ms != null) ArchivePlayer.seek(ms); });
})();

// ---- Tracklists ----
// Live track IDs are an NTS Supporter feature, so the live episode's tracklist
// is usually empty while it's on air; the tab then points to the Supporter sign-in.
const fmtOffset = (secs) => {
  if (secs == null) return '';
  const h = Math.floor(secs / 3600), m = Math.floor((secs % 3600) / 60), s = Math.floor(secs % 60);
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
};
const fmtDate = (iso) => new Date(iso).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });

async function loadTracklist(info, force = false) {
  if (!info.show || !info.episode) return;
  const key = `${info.show}/${info.episode}`;
  const cached = tracklists.get(key);
  if (cached && !force && cached.tracks.length) return;
  try {
    const cur = await window.nts.api(`/api/v2/shows/${info.show}/episodes/${info.episode}/tracklist`);
    if (cur.results?.length) {
      tracklists.set(key, { tracks: cur.results, source: 'live' });
    } else {
      tracklists.set(key, { tracks: [], source: 'none' });   // not published yet (live)
    }
  } catch {
    tracklists.set(key, { tracks: [], source: 'error' });
  }
  render();
}

function renderTracks(info) {
  const key = `${info.show}/${info.episode}`;
  const tl = tracklists.get(key);
  const note = $('tracksNote');
  const list = $('tracks');
  if (!info.episode) { note.textContent = 'No tracklist for this broadcast.'; list.replaceChildren(); list.dataset.key = ''; return; }
  if (!tl) { note.textContent = 'Loading tracklist…'; list.replaceChildren(); list.dataset.key = ''; loadTracklist(info); return; }
  if (tl.source === 'live') note.textContent = '';
  else if (tl.source === 'error') note.textContent = 'Could not load the tracklist.';
  else {
    const signIn = Object.assign(document.createElement('button'), { className: 'text-link', textContent: 'Sign in' });
    signIn.addEventListener('click', () => window.nts.signIn());
    note.replaceChildren(
      'No tracklist yet. Live track IDs are an ',
      Object.assign(document.createElement('a'), { href: 'https://www.nts.live/supporters', target: '_blank', textContent: 'NTS Supporter' }),
      ' feature. ', signIn, ' to see them as they play.');
  }

  const shownKey = `${key}:${tl.tracks.length}`;
  if (list.dataset.key !== shownKey) {      // don't rebuild (and re-fetch art) every refresh
    list.dataset.key = shownKey;
    list.replaceChildren(...tl.tracks.map((t) => trackRow(t, {
      title: 'Track details',
      onClick: () => { Archive.showTrack(t.artist, t.title, { fromLive: true }); render(); }
    })));
  }
}

// ---- NTS Supporter live tracklist (NTS's own page, in your NTS session) ----
const webview = $('liveTracks');
let webviewChannel = null;

function setSupporter(on) {
  supporter = on;
  try { localStorage.setItem('supporter', on ? '1' : '0'); } catch {}
  if (!on) { webviewChannel = null; }
  render();
}

function renderSupporter() {
  const showLive = supporter && pane === 'tracks' && view === 'live';
  webview.hidden = true;                  // NTS's page is no longer shown; we draw our own list
  $('liveList').hidden = !supporter;
  $('episodeTracks').hidden = supporter;
  $('supporterBar').hidden = !supporter;
  $('supporterLabel').textContent = `Live tracklist · NTS ${channel + 1}`;
  paintAccount();
  if (showLive) LiveNow.showList();
}

// When you're not signed in as a Supporter, NTS's page shows a "Dig deeper"
// promo instead of tracks. Spot it and fall back to the free episode tracklist.
let promoCheck;
function checkForPromo() {
  clearTimeout(promoCheck);
  let tries = 0;
  const probe = async () => {
    if (!supporter) return;
    try {
      const state = await webview.executeJavaScript(
        `document.querySelector('.page-live-tracks__promo') ? 'promo'
          : document.querySelector('.page-live-tracks') ? 'ok' : 'loading'`);
      if (state === 'promo') { setSupporter(false); showSnack('Sign in as an NTS Supporter for live tracks'); return; }
      if (state === 'ok' && tries > 2) return;
    } catch {}
    if (++tries < 8) promoCheck = setTimeout(probe, 1000);
  };
  probe();
}
// Fit NTS's page into ours: our tabs already pick the channel, so hide its
// heading and channel picker, drop its padding, and invert it to match the
// white panel while playing.
const WEBVIEW_CSS = `
  .page-live-tracks__header { display: none !important; }
  .page-live-tracks__live-tracks { padding: 4px 0 16px !important; max-width: none !important; }
  .page-live-tracks__body { padding: 0 12px !important; }
  .page-live-tracks__notification { margin-left: 12px !important; margin-right: 12px !important; }
  html, body { background: #000 !important; }
  ::-webkit-scrollbar { width: 4px; } ::-webkit-scrollbar-thumb { background: #666; }`;
let cssKey = null, invertKey = null, webviewReady = false, theming = false;
async function themeWebview() {
  if (!webviewReady || theming) return;
  theming = true;
  try {
    if (!cssKey) cssKey = await webview.insertCSS(WEBVIEW_CSS);
    if (playing && !invertKey) invertKey = await webview.insertCSS('html { filter: invert(1) !important; }');
    if (!playing && invertKey) { await webview.removeInsertedCSS(invertKey); invertKey = null; }
  } catch {}
  theming = false;
  if (!!invertKey !== playing && webviewReady) themeWebview();
}
webview.addEventListener('dom-ready', () => { webviewReady = true; cssKey = null; invertKey = null; themeWebview(); });
webview.addEventListener('did-start-navigation', (e) => { if (e.isMainFrame && !e.isInPlace) webviewReady = false; });
webview.addEventListener('dom-ready', checkForPromo);
webview.addEventListener('did-navigate-in-page', checkForPromo);

$('signIn').addEventListener('click', () => window.nts.signIn());
$('signOut').addEventListener('click', () => window.nts.signOut());
window.nts.onAuthChanged?.((signedIn) => {
  setSupporter(signedIn);
  $('liveMyNts').dataset.key = '';      // re-check My NTS with the new sign-in
  render();
  if (typeof Archive !== 'undefined') Archive.refresh();
});

let snackTimer;
function copyTrack(text) {
  window.nts.copy(text);
  showSnack('Track info copied');
}
function showSnack(message) {
  const sb = $('snackbar');
  sb.textContent = message;
  sb.hidden = false;
  clearTimeout(snackTimer);
  snackTimer = setTimeout(() => { sb.hidden = true; }, 2200);
}

document.querySelectorAll('.switch__item').forEach((b) => b.addEventListener('click', () => {
  pane = b.dataset.pane;
  localStorage.setItem('pane', pane);
  render();
}));

// Re-check the live episode's tracklist every few minutes in case NTS publishes it
setInterval(() => {
  const r = live?.results?.[channel];
  if (r) loadTracklist(showInfo(r), true);
}, 5 * 60_000);

async function refresh() {
  try { live = await window.nts.getLive(); render(); Reminders.check(); if (typeof Archive !== 'undefined') Archive.refreshOnAir(); }
  catch (e) { if (!live) $('title').textContent = 'Could not reach NTS'; }
}

let heardLiveKey = '';
function recordLive() {
  const r = live?.results?.[channel];
  if (!playing || !r) return;
  const info = showInfo(r);
  const key = `${info.show}/${info.episode}`;
  if (!info.episode || key === heardLiveKey) return;
  heardLiveKey = key;
  const media = r.now?.embeds?.details?.media || {};
  History.upsert(info.show, info.episode, {
    title: info.title, img: media.background_small || media.picture_small || info.img,
    date: info.start ? fmtDate(info.start) : '', location: info.location, heardLive: true, channel: channel + 1
  });
  Session.save({ source: 'live', channel });
}

function play() {
  ArchivePlayer.pause();
  source = 'live';
  // Always reconnect fresh so you hear what's live now, not a stale buffer
  audio.src = `${STREAMS[channel]}?t=${Date.now()}`;
  audio.play().catch(() => {});
  playing = true; render();
}

function stop() {
  audio.pause();
  audio.removeAttribute('src');
  audio.load(); // closes the connection
  playing = false; render();
}

// Live tabs show that channel; if live radio is playing, it switches to it.
// An archive episode keeps playing while you look at the live channels.
// Live tabs: while something is playing, clicking a channel switches to it (an archive
// episode pauses and keeps its place in History). When nothing plays, it just shows it,
// and the play button then plays that channel.
function setChannel(ch) {
  view = 'live';
  const changed = ch !== channel;
  channel = ch;
  localStorage.setItem('channel', ch);
  const archivePlaying = source === 'archive' && (ArchivePlayer.state.playing || ArchivePlayer.state.loading);
  if (archivePlaying || (playing && changed)) { play(); return; }
  if (!playing) source = 'live';
  render();
}

$('play').addEventListener('click', togglePlayback);
$('prevTrack').addEventListener('click', () => Archive.skipTrack(-1));
$('nextTrack').addEventListener('click', () => Archive.skipTrack(1));
document.querySelectorAll('.tab[data-ch]').forEach((b) =>
  b.addEventListener('click', () => setChannel(Number(b.dataset.ch))));
$('archiveTab').addEventListener('click', () => { view = 'archive'; Archive.open(); render(); });
// The NTS logo goes Home
$('homeBtn').addEventListener('click', () => { view = 'archive'; Archive.home(); render(); });
// Mute toggles between silent and your last volume
const VOL_ON = 'M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0 0 14 8v8a4.5 4.5 0 0 0 2.5-4z';
const VOL_OFF = 'M3 9v6h4l5 5V4L7 9H3zm13.6 3 2.7-2.7-1.4-1.4-2.7 2.7-2.7-2.7-1.4 1.4 2.7 2.7-2.7 2.7 1.4 1.4 2.7-2.7 2.7 2.7 1.4-1.4z';
const paintMute = () => {
  $('volIcon').setAttribute('d', audio.muted || audio.volume === 0 ? VOL_OFF : VOL_ON);
  $('mute').setAttribute('aria-label', audio.muted ? 'Unmute' : 'Mute');
};
$('mute').addEventListener('click', () => {
  audio.muted = !audio.muted;
  ArchivePlayer.setVolume(audio.muted ? 0 : audio.volume);
  paintMute();
});
paintMute();

$('volume').addEventListener('input', (e) => {
  audio.volume = Number(e.target.value);
  localStorage.setItem('volume', audio.volume);
  paintVolume();
  if (audio.muted) audio.muted = false;
  ArchivePlayer.setVolume(audio.volume);
  paintMute();
});
document.addEventListener('keydown', (e) => {
  if (e.target.matches?.('input, textarea')) return;
  if (e.key === 'Escape') {                          // close whatever's open
    if (!$('welcome').hidden) { closeWelcome(); return; }
    if (!$('settings').hidden) { $('settings').hidden = true; $('settingsBtn').focus(); return; }
  }
  // Space plays / pauses, unless a button or row has focus (then Space presses it)
  if (e.code === 'Space' && !e.target.closest?.('button, a, [tabindex], [role="button"]')) { e.preventDefault(); togglePlayback(); }
  // Shift + arrow keys: previous / next track in an archive episode
  if (e.shiftKey && (e.key === 'ArrowRight' || e.key === 'ArrowLeft') && source === 'archive' && ArchivePlayer.state.episode) {
    e.preventDefault();
    Archive.skipTrack(e.key === 'ArrowRight' ? 1 : -1);
  }
  if (e.key === '1') setChannel(0);
  if (e.key === '2') setChannel(1);
});

// If the stream drops, try to reconnect
// If the stream drops, keep trying (backing off up to 30 s) and say so in the bar
var reconnecting = false;
let retryDelay = 2000;
let retryTimer = null;
function reconnect() {
  if (!playing) return;
  reconnecting = true;
  renderNowbar();
  clearTimeout(retryTimer);
  retryTimer = setTimeout(() => { if (playing && navigator.onLine) play(); }, retryDelay);
  retryDelay = Math.min(retryDelay * 2, 30000);
}
audio.addEventListener('error', () => { if (playing && audio.getAttribute('src')) reconnect(); });
audio.addEventListener('stalled', () => { setTimeout(() => { if (playing && audio.paused) reconnect(); }, 5000); });
audio.addEventListener('playing', () => { reconnecting = false; retryDelay = 2000; renderNowbar(); LiveNow.poll(); });

// Offline / back online
function onConnectivity() {
  document.body.classList.toggle('offline', !navigator.onLine);
  renderNowbar();
  if (navigator.onLine) {
    refresh();
    if (playing) play();                       // pick the live stream back up
    else if (source === 'archive' && ArchivePlayer.state.error) ArchivePlayer.play();
  }
}
window.addEventListener('online', onConnectivity);
window.addEventListener('offline', onConnectivity);

// Windows media keys / system media overlay
if ('mediaSession' in navigator) {
  const isArchive = () => source === 'archive' && ArchivePlayer.state.episode;
  navigator.mediaSession.setActionHandler('play', () => (isArchive() ? ArchivePlayer.play() : play()));
  navigator.mediaSession.setActionHandler('pause', () => (isArchive() ? ArchivePlayer.pause() : stop()));
  navigator.mediaSession.setActionHandler('stop', () => (isArchive() ? ArchivePlayer.pause() : stop()));
  // Live: next/previous switches channel. Archive: jumps between tracks in the tracklist.
  navigator.mediaSession.setActionHandler('nexttrack', () => (isArchive() ? Archive.skipTrack(1) : setChannel(channel ? 0 : 1)));
  navigator.mediaSession.setActionHandler('previoustrack', () => (isArchive() ? Archive.skipTrack(-1) : setChannel(channel ? 0 : 1)));
}

// ---- Live track IDs (NTS Supporters) ----
// While live radio plays and you're signed in as a Supporter, read the track playing
// from NTS's live tracklist: shown in the bar and on the stage, with notifications.
var LiveNow = (() => {   // var: the now-playing bar may ask before this line has run
  let track = null;
  let key = '';
  let list = [];
  let listKey = '';

  // NTS's page only shows the latest few tracks, so keep our own log per broadcast:
  // every track we see is added, newest first. Kept on this computer (last 6 broadcasts).
  const LOG = 'liveTrackLog';
  const readLog = () => { try { return JSON.parse(localStorage.getItem(LOG)) || {}; } catch { return {}; } };
  const broadcastKey = (ch) => {
    const r = live?.results?.[ch];
    const info = r ? showInfo(r) : null;
    return `${ch + 1}|${info?.episode || info?.start || 'unknown'}`;
  };
  function remember(ch, tracks) {
    const log = readLog();
    const k = broadcastKey(ch);
    const entry = log[k] || { at: Date.now(), tracks: [] };
    const id = (t) => `${t.time}|${t.artist}|${t.title}`.toLowerCase();
    const seen = new Set(entry.tracks.map(id));
    const fresh = tracks.filter((t) => !seen.has(id(t)));
    entry.tracks = [...fresh, ...entry.tracks].slice(0, 300);
    entry.at = Date.now();
    log[k] = entry;
    const keep = Object.entries(log).sort((a, b) => b[1].at - a[1].at).slice(0, 6);
    try { localStorage.setItem(LOG, JSON.stringify(Object.fromEntries(keep))); } catch {}
    return entry.tracks;
  }
  let listChannel = null;
  let listState = 'loading';
  const listOpen = () => supporter && view === 'live' && pane === 'tracks';
  async function poll() {
    const hearing = playing && source === 'live';
    if (!supporter || !navigator.onLine || !(hearing || listOpen())) return set(null);
    const ch = channel;
    const r = await window.nts.liveTracks(ch + 1).catch(() => null);
    if (ch !== channel) return;
    if (r?.available && r.supporter === false) {         // signed out / not a Supporter
      set(null);
      setSupporter(false);
      showSnack('Sign in as an NTS Supporter for live tracks');
      return;
    }
    listChannel = ch;
    listState = r?.available ? 'ok' : 'error';
    list = r?.available ? remember(ch, r.tracks) : (readLog()[broadcastKey(ch)]?.tracks || list);
    paintList();
    set(hearing && r?.available ? r.tracks[0] || null : null);
  }

  // Our live tracklist: cover, time, artist, title; the newest is the one on now
  function paintList() {
    if (!listOpen()) return;
    const ol = $('liveTracksList');
    const note = $('liveNote');
    if (listChannel !== channel) {
      const saved = readLog()[broadcastKey(channel)]?.tracks;
      if (saved?.length) { list = saved; listChannel = channel; listState = 'ok'; }
      else { note.replaceChildren(loader('Loading live tracks')); ol.replaceChildren(); listKey = ''; return; }
    }
    note.textContent = listState === 'error' ? 'Couldn’t reach the live tracklist. Trying again…'
      : !list.length ? 'No tracks identified yet for this show.'
      : list.length > 3 ? `${list.length} tracks this show (since the app has been open)` : '';
    const k = `${listChannel}|` + list.map((t) => t.time + t.title).join('|');
    if (k === listKey) return;
    listKey = k;
    ol.replaceChildren(...list.map((t, i) => {
      const li = trackRow({ artist: t.artist, title: t.title, time: t.time }, {
        title: 'Track details', liveSave: true,
        onClick: () => { Archive.showTrack(t.artist, t.title, { fromLive: true }); render(); }
      });
      if (i === 0) li.classList.add('track--now');
      return li;
    }));
  }
  function showList() {
    paintList();
    if (listChannel !== channel || !list.length) poll();
  }
  function set(t) {
    const k = t ? `${channel}|${t.time}|${t.artist}|${t.title}` : '';
    if (k === key) return;
    const first = !key;
    key = k;
    track = t;
    renderNowbar();
    if (typeof NowSave !== 'undefined') NowSave.update();
    if (typeof Stage !== 'undefined') Stage.render();
    if (t && !first) announce(t);
  }
  async function announce(t) {
    const art = await Promise.race([Art.get(t, 'high'), new Promise((r) => setTimeout(() => r(null), 2500))]);
    const show = live?.results?.[channel] ? showInfo(live.results[channel]).title : '';
    if ('mediaSession' in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: t.title, artist: t.artist, album: `NTS ${channel + 1} · ${show}`,
        artwork: art?.large ? [{ src: art.large, sizes: '512x512' }] : []
      });
    }
    if (TrackNotify.enabled()) window.nts.notify({ title: `${t.artist} – ${t.title}`, body: `Live on NTS ${channel + 1}${show ? ' · ' + show : ''}`, art: art?.large || '' });
  }
  setInterval(poll, 20000);
  return { get track() { return track; }, poll, showList, clear: () => set(null) };
})();

// ---- Shows you follow in My NTS ----
// Read from your My NTS page in the background (shortly after launch, then every few
// hours) so the schedule and reminders know about them. Only read, never changed.
const Following = (() => {
  const read = () => { try { return JSON.parse(localStorage.getItem('mynts:shows')) || {}; } catch { return {}; } };
  const aliasOf = (path) => (/^\/shows\/([^/]+)/.exec(path || '') || [])[1];
  let aliases = new Set((read().items || []).map((it) => aliasOf(it.path)).filter(Boolean));
  const listeners = new Set();
  async function refresh() {
    if (!navigator.onLine) return;
    const res = await window.nts.account.list('shows').catch(() => null);
    if (!res?.signedIn || !res.available) return;
    try { localStorage.setItem('mynts:shows', JSON.stringify({ items: res.items, tracks: res.tracks })); } catch {}
    aliases = new Set((res.items || []).map((it) => aliasOf(it.path)).filter(Boolean));
    listeners.forEach((fn) => fn());
  }
  setTimeout(refresh, 15000);
  setInterval(refresh, 4 * 3600 * 1000);
  return {
    has: (alias) => aliases.has(alias),
    any: () => aliases.size > 0,
    refresh,
    onChange: (fn) => listeners.add(fn)
  };
})();

// ---- Reminders: tell me when a show goes live ----
// Shows you asked to be reminded about (from the schedule), plus the shows you follow
// in My NTS. One notification per broadcast.
const Reminders = (() => {
  const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) || d; } catch { return d; } };
  const shows = load('reminders', {});            // alias -> title
  const notified = load('remindedEpisodes', []);
  const save = () => { try { localStorage.setItem('reminders', JSON.stringify(shows)); localStorage.setItem('remindedEpisodes', JSON.stringify(notified.slice(-100))); } catch {} };
  function check() {
    (live?.results || []).slice(0, 2).forEach((r, i) => {
      const info = showInfo(r);
      // Bells you set cover every broadcast; followed shows only new ones (not repeats)
      const isRepeat = /\(R\)\s*$/.test(r?.now?.broadcast_title || '');
      if (!info.show || !info.episode || !(shows[info.show] || (Following.has(info.show) && !isRepeat))) return;
      const key = `${info.show}/${info.episode}`;
      if (notified.includes(key)) return;
      notified.push(key);
      save();
      if (playing && channel === i) return;     // already listening
      window.nts.notify({ title: `${info.title} is live on NTS ${i + 1}`, body: shows[info.show] ? 'You asked to be reminded' : 'A show you follow', art: info.img });
    });
  }
  return {
    has: (alias) => !!shows[alias],
    toggle(alias, title) { if (shows[alias]) delete shows[alias]; else shows[alias] = title; save(); return !!shows[alias]; },
    check
  };
})();

// ---- Sleep timer ----
const Sleep = (() => {
  let mode = 'off';
  let endsAt = 0;
  let timer = null;
  let tick = null;
  function fadeOutThenStop() {
    const start = audio.volume;
    let n = 0;
    const steps = 40;
    const fade = setInterval(() => {
      n++;
      const v = Math.max(0, start * (1 - n / steps));
      audio.volume = v;
      ArchivePlayer.setVolume(v);
      if (n >= steps) {
        clearInterval(fade);
        if (source === 'archive') ArchivePlayer.pause(); else if (playing) stop();
        audio.volume = start;
        ArchivePlayer.setVolume(audio.muted ? 0 : start);
        set('off');
        showSnack('Sleep timer: stopped');
      }
    }, 500);   // 20 s fade out
  }
  function set(m) {
    mode = m;
    clearTimeout(timer);
    clearInterval(tick);
    endsAt = 0;
    if (/^\d+$/.test(m)) {
      endsAt = Date.now() + Number(m) * 60000;
      timer = setTimeout(fadeOutThenStop, Math.max(0, Number(m) * 60000 - 20000));
      tick = setInterval(paintSettings, 30000);
    }
    paintSettings();
  }
  // "End of episode": stop when the archive episode finishes (no autoplay)
  ArchivePlayer.onChange((a) => { if (mode === 'episode' && a.finished) { set('off'); showSnack('Sleep timer: stopped at the end of the episode'); } });
  return {
    set,
    get mode() { return mode; },
    blocksAutoplay: () => mode === 'episode',
    remaining: () => (endsAt ? Math.max(0, Math.ceil((endsAt - Date.now()) / 60000)) : 0)
  };
})();

// NTS account row in Settings
function paintAccount() {
  if (typeof NowSave !== 'undefined') NowSave.update(true);
  $('signIn').hidden = supporter;
  $('signOut').hidden = !supporter;
  $('accountHint').textContent = supporter ? 'Signed in: live track IDs and My NTS' : 'Sign in for live track IDs and My NTS';
}

// ---- Settings popover ----
async function paintSettings() {
  paintAccount();
  document.querySelectorAll('#sleepChoices button').forEach((b) => b.classList.toggle('on', b.dataset.sleep === Sleep.mode));
  $('sleepHint').textContent = Sleep.mode === 'episode' ? 'Stops when this episode ends'
    : Sleep.remaining() ? `Stops in ${Sleep.remaining()} min` : '';
  $('settingsBtn').classList.toggle('has-timer', Sleep.mode !== 'off');
  const ds = await window.nts.desktop?.settings().catch(() => null);
  if (ds) {
    $('trayToggle').classList.toggle('notify-toggle--on', ds.keepInTray);
    $('loginToggle').classList.toggle('notify-toggle--on', ds.openAtLogin);
    $('loginToggle').hidden = !ds.loginSupported;
  }
  const mod = /Mac/.test(navigator.platform) ? 'Cmd+Opt' : 'Ctrl+Alt';
  $('shortcutHelp').textContent = `Anywhere: ${mod}+P play/pause · ${mod}+← → tracks · ${mod}+M mini player`;
}
$('settingsBtn').addEventListener('click', (e) => {
  e.stopPropagation();
  $('settings').hidden = !$('settings').hidden;
  if (!$('settings').hidden) { paintSettings(); $('settings').querySelector('button')?.focus(); }
});
document.addEventListener('click', (e) => { if (!$('settings').hidden && !$('settings').contains(e.target)) $('settings').hidden = true; });
document.querySelectorAll('#sleepChoices button').forEach((b) => b.addEventListener('click', () => {
  Sleep.set(b.dataset.sleep);
  if (b.dataset.sleep !== 'off') showSnack(b.dataset.sleep === 'episode' ? 'Sleep timer: end of episode' : `Sleep timer: ${b.textContent}`);
}));
$('trayToggle').addEventListener('click', async () => {
  const ds = await window.nts.desktop.settings();
  await window.nts.desktop.set('keepInTray', !ds.keepInTray);
  paintSettings();
});
$('loginToggle').addEventListener('click', async () => {
  const ds = await window.nts.desktop.settings();
  await window.nts.desktop.set('openAtLogin', !ds.openAtLogin);
  paintSettings();
});
$('miniBtn').addEventListener('click', () => { $('settings').hidden = true; window.nts.desktop.mini(true); });
$('miniExit').addEventListener('click', () => window.nts.desktop.mini(false));
window.nts.desktop?.onMini((on) => document.body.classList.toggle('mini', on));

// Tray menu and global shortcuts
window.nts.desktop?.onCommand((c) => {
  const archive = source === 'archive' && ArchivePlayer.state.episode;
  if (c === 'toggle') togglePlayback();
  else if (c === 'save') NowSave.toggle();
  else if (c === 'next' || c === 'prev') { if (archive) Archive.skipTrack(c === 'next' ? 1 : -1); else setChannel(channel ? 0 : 1); }
  else if (c === 'channel1' || c === 'channel2') { setChannel(c === 'channel1' ? 0 : 1); if (!playing) play(); }
});

// A live track can only be saved from an episode page: the live show's own (once NTS
// has added it there) or an earlier episode that played the same track.
const liveTargets = new Map();
function liveSaveTarget(t) {
  const k = `${channel}|${t.artist}|${t.title}`;
  const hit = liveTargets.get(k);
  if (hit && Date.now() - hit.at < 120000) return hit.p;
  const p = findLiveSaveTarget(t);
  liveTargets.set(k, { at: Date.now(), p });
  return p;
}
async function findLiveSaveTarget(t) {
  const r = live?.results?.[channel];
  const info = r ? showInfo(r) : null;
  if (info?.show && info?.episode) {
    const st = await MyNTS.getState(info.show, info.episode, true);       // fresh: tracks arrive during the show
    if (MyNTS.trackState(st, t)?.canSave) return { show: info.show, episode: info.episode, title: info.title, date: info.start ? fmtDate(info.start) : '' };
  }
  const found = await Archive.findTrack(t).catch(() => null);
  const m = found?.match;
  return m ? { show: m.show, episode: m.episode, title: m.title, date: m.date, offset: m.offset } : null;
}

// ---- Save the track you're hearing (now-playing bar), to My NTS ----
var NowSave = (() => {   // var: renderNowbar may ask before this line runs
  const btn = $('nowSave');
  let sig = '';
  let current = null;   // { ep, t, saved }
  async function update(force) {
    const a = ArchivePlayer.state;
    const lt = source === 'live' && playing ? LiveNow?.track : null;
    const cur = lt ? { track: lt } : source === 'archive' && a.episode ? TrackNotify.currentTrack() : null;
    const s = !cur ? '' : lt ? `live|${channel}|${lt.time}|${lt.title}` : `${a.episode.show}/${a.episode.episode}#${cur.idx}`;
    if (s === sig && !force) return;
    sig = s;
    current = null;
    paint();
    if (!cur || !supporter) return;          // needs your NTS sign-in
    const ep = lt ? await liveSaveTarget(lt) : a.episode;
    if (s !== sig || !ep) return;
    const st = await MyNTS.getState(ep.show, ep.episode);
    if (s !== sig) return;
    const tr = MyNTS.trackState(st, cur.track);
    if (!st?.signedIn || !tr?.canSave) return;
    current = { ep, t: { ...cur.track, offset: ep.offset ?? cur.track.offset, offset_estimate: cur.track.offset_estimate }, saved: !!tr.saved };
    paint();
  }
  function paint() {
    btn.hidden = !current;
    // taskbar thumbnail / tray / Dock save button
    window.nts.desktop?.state({ canSave: !!current, saved: !!current?.saved, track: current ? `${current.t.artist} – ${current.t.title}` : '' });
    if (!current) return;
    btn.classList.toggle('nowbar__save--on', current.saved);
    btn.title = `${current.saved ? 'Saved: click to remove' : 'Save to My NTS'} · ${current.t.artist} – ${current.t.title}`;
    btn.setAttribute('aria-pressed', String(current.saved));
  }
  btn.addEventListener('click', async () => {
    if (!current) return;
    const { ep, t, saved } = current;
    btn.classList.add('mynts-btn--busy');
    const res = await MyNTS.toggleTrack(ep.show, ep.episode, t, !saved,
      { show: ep.show, episode: ep.episode, title: ep.title, date: ep.date, offset: t.offset ?? t.offset_estimate });
    btn.classList.remove('mynts-btn--busy');
    if (res && !res.error && current?.t === t) { current.saved = !saved; paint(); if (typeof Stage !== 'undefined') Stage.render(); }
  });
  ArchivePlayer.onChange(() => update());
  return { update, toggle: () => btn.click() };
})();

// ---- Stage modes: Now playing / Track web ----
function setStageMode(mode) {
  document.body.classList.toggle('stage-web', mode === 'web');
  document.querySelectorAll('.stage__mode').forEach((b) => {
    b.classList.toggle('active', b.dataset.mode === mode);
    b.setAttribute('aria-selected', String(b.dataset.mode === mode));
  });
  $('trackweb').hidden = mode !== 'web';
  if (mode === 'web') TrackWeb.show();
}
document.querySelectorAll('.stage__mode').forEach((b) => b.addEventListener('click', () => setStageMode(b.dataset.mode)));
// Open the track web on a track (switches to the wide view if needed)
function openTrackWeb(t, origin) {
  if (!window.matchMedia('(min-width: 720px)').matches) window.nts.setWide(true);
  setStageMode('web');
  setTimeout(() => TrackWeb.start(t, origin), 250);
}

// ---- Wide view: the stage ----
// Big album art and full details for what's playing, with links to find the
// track elsewhere. Spotify, YouTube, Bandcamp and Discogs open a search;
// Deezer and Apple Music go straight to the track when the lookup found it.
const Stage = (() => {
  const wideQuery = window.matchMedia('(min-width: 720px)');
  let token = 0;

  const cleanTitle = (t) => (t || '').replace(/\s*[([][^)\]]*[)\]]/g, '').replace(/\s+(ft\.?|feat\.?|featuring|prod\.?( by)?)\s.*$/i, '').trim();
  const firstArtist = (a) => (a || '').split(/,|&| x | ft\.? | feat\.? /i)[0].trim();

  // [name, url, exact]: exact links open the track itself, the rest open a search
  function links(track, art, appleUrl) {
    const plain = (x) => x.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[‘’“”'"`´]/g, '').replace(/\s+/g, ' ').trim();
    const q = encodeURIComponent(plain(`${firstArtist(track.artist)} ${cleanTitle(track.title)}`));
    const apple = appleUrl || art?.appleUrl;
    const appleWeb = apple || `https://music.apple.com/us/search?term=${q}`;
    const deezerWeb = art?.deezerUrl || `https://www.deezer.com/search/${q}`;
    // 4th item: app links to try first (opened only if that app is installed)
    return [
      ['Spotify', `https://open.spotify.com/search/${q}`, false, [`spotify:search:${q}`]],
      ['Apple Music', appleWeb, !!apple, ['music', 'itmss'].map((s) => appleWeb.replace(/^https:/, `${s}:`))],
      ['Deezer', deezerWeb, !!art?.deezerUrl, [deezerWeb.replace(/^https:/, 'deezer:')]],
      ['YouTube', `https://www.youtube.com/results?search_query=${q}`, false],
      ['Bandcamp', `https://bandcamp.com/search?q=${q}`, false],
      ['Discogs', `https://www.discogs.com/search/?q=${q}&type=all`, false]
    ];
  }

  function paintLinks(items, list = $('stageLinks'), label = $('stageLinksLabel')) {
    if (label) label.hidden = !items.length || items.length === 1;
    list.replaceChildren(...items.map(([name, href, exact = true, apps = []]) => {
      const a = document.createElement('a');
      a.className = 'stage__link' + (exact ? ' stage__link--exact' : '');
      a.href = href; a.target = '_blank'; a.textContent = name;
      a.title = (exact ? `Open this track in ${name}` : `Search ${name} for this track`) + (apps.length ? ' (opens the app if installed)' : '');
      // Prefer the desktop app when it's installed; otherwise the web page
      a.addEventListener('click', (e) => {
        e.preventDefault();
        window.nts.openLink({ web: href, apps });
      });
      return a;
    }));
  }

  // Artwork: the old picture stays until the new one has loaded, then cross-fades in.
  // whitelabel: no cover found for this track, so show a plain sleeve and white label.
  let artToken = 0;
  function setArt({ img, square, whitelabel, track, keep }) {
    if (keep) return;
    const my = ++artToken;
    const art = $('stageArt');
    const apply = () => {
      if (my !== artToken) return;
      const im = $('stageArtImg');
      if (img) im.src = img; else im.removeAttribute('src');
      art.classList.toggle('stage__art--wide', !square);
      art.classList.toggle('stage__art--album', !!square && (!!img || !!whitelabel));
      art.classList.toggle('stage__art--whitelabel', !!whitelabel);
      art.classList.toggle('stage__art--empty', !img && !whitelabel);
      $('stageRecordLabel').style.backgroundImage = img && square ? `url("${img}")` : '';
      $('wlArtist').textContent = whitelabel ? track?.artist || '' : '';
      $('wlTitle').textContent = whitelabel ? track?.title || '' : '';
      art.classList.remove('stage__art--swapping');
    };
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const wasRecord = art.classList.contains('stage__art--album');
    const isRecord = !!square && (!!img || !!whitelabel);
    const changing = img ? $('stageArtImg').getAttribute('src') !== img
      : whitelabel ? !art.classList.contains('stage__art--whitelabel') || $('wlTitle').textContent !== (track?.title || '')
      : true;

    // Record to record: tuck the disc in, slide the sleeve out, bring the new one in
    const swapRecords = () => {
      art.classList.add('is-tucking');                                  // disc slides back into the sleeve
      setTimeout(() => {
        if (my !== artToken) return;
        art.classList.add('is-leaving');                                // sleeve leaves to the left
        setTimeout(() => {
          if (my !== artToken) return;
          art.classList.add('is-arriving');                             // jump to the right, out of view
          art.classList.remove('is-leaving');
          apply();
          requestAnimationFrame(() => requestAnimationFrame(() => {
            if (my !== artToken) return;
            art.classList.remove('is-arriving');                        // slide in…
            setTimeout(() => { if (my === artToken) art.classList.remove('is-tucking'); }, 420);   // …then the disc comes out
          }));
        }, 320);
      }, 380);
    };
    const go = () => {
      if (!changing) return apply();
      if (wasRecord && isRecord && !reduce && wideQuery.matches) return swapRecords();
      art.classList.add('stage__art--swapping');                        // otherwise a quick cross-fade
      setTimeout(apply, 140);
    };

    if (img && changing) {
      const pre = new Image();                                          // load it before anything moves
      pre.onload = () => { if (my === artToken) go(); };
      pre.onerror = () => { if (my === artToken) setArt({ square, whitelabel: square, track }); };
      pre.src = img;
    } else {
      go();
    }
  }

  function paint({ label, context, img, kicker, title, artist, album, next, linkItems, square, keepSave, keepArt, whitelabel, track }) {
    if (!keepSave) $('stageSave').replaceChildren();
    $('stageLabel').textContent = label;
    $('stageContext').textContent = context || '';
    setArt({ img, square, whitelabel, track, keep: keepArt });
    $('stageKicker').textContent = kicker || '';
    $('stageTitle').textContent = title || '';
    const len = (title || '').length;
    $('stageTitle').classList.toggle('stage__title--long', len > 26 && len <= 42);
    $('stageTitle').classList.toggle('stage__title--xlong', len > 42);
    $('stageArtist').textContent = artist || '';
    $('stageAlbum').textContent = album || '';
    $('stageNext').textContent = next || '';
    paintLinks(linkItems || []);
  }

  // Size the artwork around the text: measure the info block and leave exactly that room
  const fitInfo = () => {
    const h = $('stageInfo').offsetHeight;
    if (h) $('stage').style.setProperty('--info-h', `${h}px`);
  };
  new ResizeObserver(fitInfo).observe($('stageInfo'));

  // Bookmark for the track on the stage (saved to My NTS)
  async function paintSave(epOrPromise, t, my) {
    const box = $('stageSave');
    box.replaceChildren();
    if (!t || !supporter) return;
    // Show it straight away (waiting), then enable once My NTS has answered
    const wait = document.createElement('button');
    wait.className = 'mynts-btn mynts-btn--busy';
    wait.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h12v18l-6-4.5L6 21z"/></svg><span>Save track</span>';
    box.append(wait);
    const ep = await epOrPromise;
    if (my !== token) return;
    if (!ep?.show || !ep?.episode) { box.replaceChildren(); return; }
    if (ep.offset != null) t = { ...t, offset: ep.offset };
    const st = await MyNTS.getState(ep.show, ep.episode);
    if (my !== token) return;
    if (!st?.available || !st.signedIn) { box.replaceChildren(); return; }
    const tr = MyNTS.trackState(st, t);
    if (!tr?.canSave) { box.replaceChildren(); return; }
    box.replaceChildren();
    const b = document.createElement('button');
    b.className = 'mynts-btn' + (tr.saved ? ' mynts-btn--on' : '');
    b.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h12v18l-6-4.5L6 21z"/></svg><span></span>';
    b.querySelector('span').textContent = tr.saved ? 'Saved track' : 'Save track';
    b.title = tr.saved ? 'Remove from your saved tracks' : 'Save this track to My NTS';
    b.addEventListener('click', async () => {
      b.classList.add('mynts-btn--busy');
      const off = t.offset ?? t.offset_estimate;
      await MyNTS.toggleTrack(ep.show, ep.episode, t, !tr.saved, { show: ep.show, episode: ep.episode, title: ep.title, date: ep.date, offset: off });
      if (my === token) paintSave(ep, t, my);
      NowSave.update(true);
    });
    box.append(b);
  }

  async function render() {
    if (!wideQuery.matches) return;
    const my = ++token;
    const a = ArchivePlayer.state;
    // The record slides out and spins while an archive track plays
    document.body.classList.toggle('stage-spinning', source === 'archive' && !!a.episode && a.playing);

    if (source === 'archive' && a.episode) {
      const ep = a.episode;
      const cur = TrackNotify.currentTrack();
      const tracks = ep.tracks || [];
      const label = '';
      const context = '';
      if (!cur) {
        paint({ label, context, img: ep.img, kicker: '',
          title: ep.title, artist: [ep.location, ep.date].filter(Boolean).join(' · '),
          next: '' });
        return;
      }
      const t = cur.track;
      const nt = tracks[cur.idx + 1];
      const base = {
        label, context,
        kicker: '',
        title: t.title, artist: t.artist,
        next: '',
        square: true
      };
      // keep the previous cover on screen while this track's cover is looked up
      paint({ ...base, keepArt: true, linkItems: links(t, null) });
      paintSave(ep, t, my);
      // Art (and the Deezer link) first; the exact Apple Music link follows when found
      const appleP = window.nts.appleLink({ artist: t.artist, title: t.title }).catch(() => null);
      const art = await Art.get(t, 'high');
      if (my !== token) return;
      // No cover found: a white label, not the show's photo
      const full = { ...base, img: art?.large || '', square: true, whitelabel: !art?.large, track: t,
        context: art?.album ? `${art.album}${art.year ? ' · ' + art.year : ''}` : (art?.year || ''), album: '' };
      paint({ ...full, linkItems: links(t, art), keepSave: true });
      const appleUrl = await appleP;
      if (my !== token || !appleUrl) return;
      paintLinks(links(t, art, appleUrl));
      return;
    }

    // Live radio with a live track ID (Supporters): show the track like an archive track
    const lt = playing && source === 'live' ? LiveNow?.track : null;
    if (lt) {
      const base = { label: '', context: '', title: lt.title, artist: lt.artist, square: true };
      paint({ ...base, keepArt: true, linkItems: links(lt, null) });
      paintSave(liveSaveTarget(lt), lt, my);
      const art = await Art.get(lt, 'high');
      if (my !== token) return;
      paint({ ...base, img: art?.large || '', whitelabel: !art?.large, track: lt, keepSave: true,
        context: art?.album ? `${art.album}${art.year ? ' · ' + art.year : ''}` : (art?.year || ''), linkItems: links(lt, art) });
      document.body.classList.add('stage-spinning');
      return;
    }

    // Live radio (or nothing yet): the selected channel's show
    const r = live?.results?.[channel];
    if (!r) { paint({ label: 'NTS Radio', title: 'Loading…' }); return; }
    const info = showInfo(r);
    paint({
      label: '',
      context: [info.location, info.start ? `${fmtTime(info.start)}–${fmtTime(info.end)}` : ''].filter(Boolean).join(' · '),
      img: info.img, square: false,
      kicker: '',
      title: info.title,
      artist: '',
      album: info.genres.slice(0, 4).join(' · '),
      next: '',
      linkItems: info.episode ? [['View on nts.live', `https://www.nts.live/shows/${info.show}/episodes/${info.episode}`]] : []
    });
  }

  // Cover tilt and shine follow the cursor anywhere over the stage
  (() => {
    const stageEl = $('stage');
    const art = $('stageArt');
    const MAX_X = 9, MAX_Y = 12;   // degrees
    let frame = null;
    stageEl.addEventListener('pointermove', (e) => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = null;
        const r = art.getBoundingClientRect();
        if (!r.width) return;
        // -1..1 from the cover's centre, eased so it never flips hard
        const nx = Math.max(-1, Math.min(1, (e.clientX - (r.left + r.width / 2)) / (r.width * 0.9)));
        const ny = Math.max(-1, Math.min(1, (e.clientY - (r.top + r.height / 2)) / (r.height * 0.9)));
        art.classList.add('is-tracking');
        art.style.setProperty('--ry', `${(nx * MAX_Y).toFixed(2)}deg`);
        art.style.setProperty('--rx', `${(-ny * MAX_X).toFixed(2)}deg`);
        art.style.setProperty('--gx', `${(50 + nx * 45).toFixed(1)}%`);
        art.style.setProperty('--gy', `${(50 + ny * 45).toFixed(1)}%`);
      });
    });
    stageEl.addEventListener('pointerleave', () => {
      art.classList.remove('is-tracking');
      ['--rx', '--ry', '--gx', '--gy'].forEach((p) => art.style.removeProperty(p));
    });
  })();

  // Expand / collapse button; the layout itself follows the window width
  function paintButton() {
    const wide = wideQuery.matches;
    $('expandBtn').title = wide ? 'Thin strip' : 'Wide view';
    $('expandBtn').setAttribute('aria-label', $('expandBtn').title);
    $('expandIcon').setAttribute('d', wide
      ? 'M4 10h6V4H8v2.6L3.7 2.3 2.3 3.7 6.6 8H4zm16 4h-6v6h2v-2.6l4.3 4.3 1.4-1.4-4.3-4.3H20z'
      : 'M3 3h7v2H6.4l4.3 4.3-1.4 1.4L5 6.4V10H3zm18 18h-7v-2h3.6l-4.3-4.3 1.4-1.4 4.3 4.3V14h2z');
  }
  $('expandBtn').addEventListener('click', () => {
    const wide = !wideQuery.matches;
    try { localStorage.setItem('wide', wide ? '1' : '0'); } catch {}
    window.nts.setWide(wide);
  });
  wideQuery.addEventListener('change', () => { paintButton(); render(); });
  paintButton();
  // Reopen in the view you used last (thin strip unless you chose wide)
  try { if (localStorage.getItem('wide') === '1' && !wideQuery.matches) window.nts.setWide(true); } catch {}

  // Re-render on track changes, not on every progress tick
  let lastSig = '';
  ArchivePlayer.onChange((a) => {
    const cur = TrackNotify.currentTrack();
    const sig = `${a.episode?.episode}|${cur?.idx}|${a.playing}|${a.loading}|${source}`;
    if (sig !== lastSig) { lastSig = sig; render(); }
  });

  return { render, links, paintLinks };
})();

// ---- First launch: a short welcome ----
function closeWelcome() {
  $('welcome').hidden = true;
  try { localStorage.setItem('welcomeSeen', '1'); } catch {}
  document.activeElement?.blur?.();     // don't leave a keyboard-focus outline behind
}
$('welcomeGo').addEventListener('click', closeWelcome);
$('welcomeSignIn').addEventListener('click', () => { closeWelcome(); window.nts.signIn(); });
$('welcome').addEventListener('click', (e) => { if (e.target === $('welcome')) closeWelcome(); });
if (localStorage.getItem('welcomeSeen') !== '1') {
  $('welcomeKey').textContent = /Mac/.test(navigator.platform) ? 'Cmd+Opt+P' : 'Ctrl+Alt+P';
  $('welcomeSignIn').hidden = supporter;
  $('welcome').hidden = false;
  // Focus the dialog itself (no outline), so Tab and Esc work without highlighting a button
  setTimeout(() => $('welcome').querySelector('.welcome__card').focus(), 50);
}

render();
refresh();
setInterval(refresh, 60_000);
