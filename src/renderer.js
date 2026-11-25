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

function showInfo(r) {
  const now = r?.now || {};
  const d = now.embeds?.details || {};
  const media = d.media || {};
  return {
    title: now.broadcast_title || d.name || 'NTS Live',
    location: d.location_long || '',
    description: d.description || '',
    img: media.background_large || media.picture_large || media.background_medium || media.picture_medium || '',
    start: now.start_timestamp, end: now.end_timestamp,
    next: r?.next || r?.next1,
    show: d.show_alias || '',
    episode: d.episode_alias || '',
    genres: (d.genres || []).map((g) => (g.value || '').trim()).filter(Boolean)
  };
}

function render() {
  document.querySelectorAll('.tab[data-ch]').forEach((b) =>
    b.classList.toggle('active', view === 'live' && Number(b.dataset.ch) === channel));
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
  $('tags').replaceChildren(...info.genres.slice(0, 4).map((g) => {
    const t = document.createElement('span'); t.className = 'tag'; t.textContent = g; return t;
  }));
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
  const key = (t) => `${t.artist}|${t.title}`;
  function get(t) {
    if (!t?.artist || !t?.title) return Promise.resolve(null);
    const k = key(t);
    if (!memo.has(k)) {
      memo.set(k, window.nts.art({ artist: t.artist, title: t.title, isrc: t.isrc_id, deezer: t.deezer_track_id }).catch(() => null));
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
        if (!art) { e.target.classList.add('track__art--none'); return; }
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
function trackRow(t, { onClick, title } = {}) {
  const li = document.createElement('li');
  li.className = 'track';
  li.title = title || 'Click to copy';
  const art = document.createElement('span'); art.className = 'track__art';
  Art.attach(art, t);
  const text = document.createElement('span'); text.className = 'track__text';
  const top = document.createElement('span'); top.className = 'track__top';
  const time = document.createElement('span'); time.className = 'track__time';
  time.textContent = fmtOffset(t.offset ?? t.offset_estimate);
  const artist = document.createElement('span'); artist.className = 'track__artist'; artist.textContent = t.artist;
  top.append(time, artist);
  const name = document.createElement('span'); name.className = 'track__title'; name.textContent = t.title;
  text.append(top, name);
  const copy = document.createElement('button'); copy.className = 'track__copy'; copy.textContent = '⧉'; copy.title = 'Copy track';
  copy.addEventListener('click', (e) => { e.stopPropagation(); copyTrack(`${t.artist} - ${t.title}`); });
  li.append(art, text, copy);
  li.addEventListener('click', onClick || (() => copyTrack(`${t.artist} - ${t.title}`)));
  return li;
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

function renderNowbar() {
  const a = ArchivePlayer.state;
  const archive = source === 'archive' && a.episode;
  const active = archive ? (a.playing || a.loading) : playing;
  document.body.classList.toggle('archive-playing', !!(archive && (a.playing || a.loading)));
  document.body.classList.toggle('source-archive', !!archive);
  $('iconPlay').toggleAttribute('hidden', active);
  $('iconPause').toggleAttribute('hidden', !active);
  $('play').setAttribute('aria-label', active ? (archive ? 'Pause' : 'Stop') : 'Play');

  if (archive) {
    $('nowKind').textContent = 'Archive';
    $('nowLabel').textContent = a.episode.title;
    $('next').textContent = a.error || (a.loading ? 'Loading…' : `${fmtMs(a.position)} / ${a.duration ? fmtMs(a.duration) : '–'}${a.episode.date ? ' · ' + a.episode.date : ''}`);
    $('seekFill').style.width = a.duration ? `${Math.min(100, (a.position / a.duration) * 100)}%` : '0%';
    $('nowArt').hidden = !nowArtUrl;
    document.title = `NTS Archive · ${a.episode.title}`;
  } else {
    $('nowKind').textContent = '';
    $('nowArt').hidden = true;
    $('nowLabel').textContent = `${playing ? 'Playing' : 'Play'} NTS ${channel + 1}`;
    $('next').textContent = nextText;
    const t = live?.results?.[channel] ? showInfo(live.results[channel]).title : '';
    document.title = t ? `NTS ${channel + 1} · ${t}` : 'NTS Player';
  }
}

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
    const art = await Promise.race([Art.get(track), new Promise((r) => setTimeout(() => r(null), 2500))]);
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
// is usually empty while it's on air. In that case show the show's previous
// episode instead, clearly labelled.
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
  if (cached && !force && (cached.source === 'previous' || cached.tracks.length)) return;
  try {
    const cur = await window.nts.api(`/api/v2/shows/${info.show}/episodes/${info.episode}/tracklist`);
    if (cur.results?.length) {
      tracklists.set(key, { tracks: cur.results, source: 'live' });
    } else {
      const eps = await window.nts.api(`/api/v2/shows/${info.show}/episodes?limit=5`);
      const prev = (eps.results || []).find((e) => e.episode_alias !== info.episode && new Date(e.broadcast) < new Date());
      let tracks = [];
      if (prev) tracks = (await window.nts.api(`/api/v2/shows/${info.show}/episodes/${prev.episode_alias}/tracklist`)).results || [];
      tracklists.set(key, { tracks, source: prev ? 'previous' : 'none', date: prev?.broadcast, alias: prev?.episode_alias, show: info.show });
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
  else if (tl.source === 'previous' && tl.tracks.length) {
    note.replaceChildren(
      'Live track IDs are an ',
      Object.assign(document.createElement('a'), { href: 'https://www.nts.live/supporters', target: '_blank', textContent: 'NTS Supporter' }),
      ` feature. Showing the last episode, ${fmtDate(tl.date)}:`);
  } else if (tl.source === 'error') note.textContent = 'Could not load the tracklist.';
  else note.textContent = 'No tracklist published for this show yet.';

  const shownKey = `${key}:${tl.tracks.length}`;
  if (list.dataset.key !== shownKey) {      // don't rebuild (and re-fetch art) every refresh
    list.dataset.key = shownKey;
    list.replaceChildren(...tl.tracks.map((t) => trackRow(t)));
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
  const showLive = supporter && pane === 'tracks';
  $('pane-tracks').classList.toggle('live', supporter);
  webview.hidden = !supporter;
  $('episodeTracks').hidden = supporter;
  $('signIn').hidden = supporter;
  $('signOut').hidden = !supporter;
  $('supporterLabel').textContent = supporter ? 'Live tracklist' : 'NTS Supporter?';
  themeWebview();
  if (showLive && webviewChannel !== channel) {
    webviewChannel = channel;
    webview.src = `https://www.nts.live/live-tracklist/${channel + 1}`;
  }
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
window.nts.onAuthChanged?.((signedIn) => setSupporter(signedIn));

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
  try { live = await window.nts.getLive(); render(); }
  catch (e) { if (!live) $('title').textContent = 'Could not reach NTS'; }
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
function setChannel(ch) {
  view = 'live';
  if (ch !== channel) {
    channel = ch;
    localStorage.setItem('channel', ch);
    if (playing) { play(); return; }
  }
  render();
}

$('play').addEventListener('click', togglePlayback);
document.querySelectorAll('.tab[data-ch]').forEach((b) =>
  b.addEventListener('click', () => setChannel(Number(b.dataset.ch))));
$('archiveTab').addEventListener('click', () => { view = 'archive'; Archive.open(); render(); });
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
  if (e.target.matches?.('input')) return;
  if (e.code === 'Space') { e.preventDefault(); togglePlayback(); }
  if (e.key === '1') setChannel(0);
  if (e.key === '2') setChannel(1);
});

// If the stream drops, try to reconnect
audio.addEventListener('error', () => { if (playing) setTimeout(play, 3000); });
audio.addEventListener('stalled', () => { if (playing) setTimeout(() => playing && audio.paused && play(), 5000); });

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

  function paintLinks(items) {
    $('stageLinksLabel').hidden = !items.length || items.length === 1;
    $('stageLinks').replaceChildren(...items.map(([name, href, exact = true, apps = []]) => {
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

  function paint({ label, context, img, kicker, title, artist, album, next, linkItems, square }) {
    $('stageLabel').textContent = label;
    $('stageContext').textContent = context || '';
    const im = $('stageArtImg');
    if (img) { if (im.getAttribute('src') !== img) im.src = img; } else im.removeAttribute('src');
    $('stageArt').classList.toggle('stage__art--wide', !square);
    $('stageArt').classList.toggle('stage__art--album', !!square && !!img);
    $('stageArt').classList.toggle('stage__art--empty', !img);
    $('stageRecordLabel').style.backgroundImage = img && square ? `url("${img}")` : '';
    $('stageKicker').textContent = kicker || '';
    $('stageTitle').textContent = title || '';
    $('stageTitle').classList.toggle('stage__title--long', (title || '').length > 26);
    $('stageArtist').textContent = artist || '';
    $('stageAlbum').textContent = album || '';
    $('stageNext').textContent = next || '';
    paintLinks(linkItems || []);
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
      const label = a.playing || a.loading ? 'Now playing' : 'Paused';
      const context = `Archive · ${ep.title}${ep.date ? ' · ' + ep.date : ''}`;
      if (!cur) {
        paint({ label, context, img: ep.img, kicker: tracks.length ? 'Before the first track' : 'NTS Archive',
          title: ep.title, artist: [ep.location, ep.date].filter(Boolean).join(' · '),
          next: tracks[0] ? `First track ${fmtOffset(tracks[0].offset ?? tracks[0].offset_estimate)} · ${tracks[0].artist} – ${tracks[0].title}` : '' });
        return;
      }
      const t = cur.track;
      const nt = tracks[cur.idx + 1];
      const base = {
        label, context,
        kicker: `Track ${cur.idx + 1} of ${tracks.length} · ${fmtOffset(t.offset ?? t.offset_estimate)}`,
        title: t.title, artist: t.artist,
        next: nt ? `Up next ${fmtOffset(nt.offset ?? nt.offset_estimate)} · ${nt.artist} – ${nt.title}` : 'Last track in the tracklist',
        square: true
      };
      paint({ ...base, img: '', linkItems: links(t, null) });
      // Art (and the Deezer link) first; the exact Apple Music link follows when found
      const appleP = window.nts.appleLink({ artist: t.artist, title: t.title }).catch(() => null);
      const art = await Art.get(t);
      if (my !== token) return;
      const full = { ...base, img: art?.large || ep.img, square: !!art,
        album: art?.album ? `${art.album}${art.year ? ' · ' + art.year : ''}` : '' };
      paint({ ...full, linkItems: links(t, art) });
      const appleUrl = await appleP;
      if (my !== token || !appleUrl) return;
      paintLinks(links(t, art, appleUrl));
      return;
    }

    // Live radio (or nothing yet): the selected channel's show
    const r = live?.results?.[channel];
    if (!r) { paint({ label: 'NTS Radio', title: 'Loading…' }); return; }
    const info = showInfo(r);
    paint({
      label: playing ? 'Now playing' : `NTS ${channel + 1}`,
      context: `Live on ${channel + 1}${info.location ? ' · ' + info.location : ''}`,
      img: info.img, square: false,
      kicker: info.start ? `${fmtTime(info.start)}–${fmtTime(info.end)}` : 'Live',
      title: info.title,
      artist: '',
      album: info.genres.slice(0, 4).join(' · '),
      next: nextText,
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
      ? 'M10 10H4V8h2.6L2.3 3.7l1.4-1.4L8 6.6V4h2zm4 4h6v2h-2.6l4.3 4.3-1.4 1.4-4.3-4.3V20h-2z'
      : 'M4 4h6v2H7.4l4.3 4.3-1.4 1.4L6 7.4V10H4zm16 16h-6v-2h2.6l-4.3-4.3 1.4-1.4 4.3 4.3V14h2z');
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

  return { render };
})();

render();
refresh();
setInterval(refresh, 60_000);
