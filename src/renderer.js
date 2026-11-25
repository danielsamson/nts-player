const STREAMS = [
  'https://stream-relay-geo.ntslive.net/stream',
  'https://stream-relay-geo.ntslive.net/stream2'
];

const $ = (id) => document.getElementById(id);
const audio = $('audio');
let channel = Number(localStorage.getItem('channel') || 0);
let playing = false;
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
  document.querySelectorAll('.tab').forEach((b) =>
    b.classList.toggle('active', Number(b.dataset.ch) === channel));
  document.body.classList.toggle('playing', playing);
  document.body.classList.toggle('pane-tracks', pane === 'tracks');
  $('iconPlay').toggleAttribute('hidden', playing);
  $('iconPause').toggleAttribute('hidden', !playing);
  $('play').setAttribute('aria-label', playing ? 'Stop' : 'Play');
  $('chIcon').textContent = channel + 1;
  $('nextLabel').textContent = `Next on ${channel + 1}`;

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
  $('next').textContent = info.next?.broadcast_title
    ? `${fmtTime(info.next.start_timestamp)} ${info.next.broadcast_title}` : '';
  document.title = `NTS ${channel + 1} · ${info.title}`;

  if ('mediaSession' in navigator) {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: info.title, artist: `NTS ${channel + 1}`, album: info.location || 'NTS Radio',
      artwork: info.img ? [{ src: info.img, sizes: '512x512' }] : []
    });
  }
}

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
  if (!info.episode) { note.textContent = 'No tracklist for this broadcast.'; list.replaceChildren(); return; }
  if (!tl) { note.textContent = 'Loading tracklist…'; list.replaceChildren(); loadTracklist(info); return; }
  if (tl.source === 'live') note.textContent = '';
  else if (tl.source === 'previous' && tl.tracks.length) {
    note.replaceChildren(
      'Live track IDs are an ',
      Object.assign(document.createElement('a'), { href: 'https://www.nts.live/supporters', target: '_blank', textContent: 'NTS Supporter' }),
      ` feature. Showing the last episode, ${fmtDate(tl.date)}:`);
  } else if (tl.source === 'error') note.textContent = 'Could not load the tracklist.';
  else note.textContent = 'No tracklist published for this show yet.';

  list.replaceChildren(...tl.tracks.map((t) => {
    const li = document.createElement('li');
    li.className = 'track';
    li.title = 'Click to copy';
    const time = document.createElement('span'); time.className = 'track__time';
    time.textContent = fmtOffset(t.offset ?? t.offset_estimate);
    const artist = document.createElement('span'); artist.className = 'track__artist'; artist.textContent = t.artist;
    const title = document.createElement('span'); title.className = 'track__title'; title.textContent = t.title;
    li.append(time, artist, title);
    li.addEventListener('click', () => copyTrack(`${t.artist} - ${t.title}`));
    return li;
  }));
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
  $('supporterLabel').textContent = supporter ? `Live on ${channel + 1}` : 'NTS Supporter?';
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

function setChannel(ch) {
  if (ch === channel) return;
  channel = ch;
  localStorage.setItem('channel', ch);
  if (playing) play(); else render();
}

$('play').addEventListener('click', () => (playing ? stop() : play()));
document.querySelectorAll('.tab').forEach((b) =>
  b.addEventListener('click', () => setChannel(Number(b.dataset.ch))));
$('volume').addEventListener('input', (e) => {
  audio.volume = Number(e.target.value);
  localStorage.setItem('volume', audio.volume);
  paintVolume();
});
document.addEventListener('keydown', (e) => {
  if (e.code === 'Space') { e.preventDefault(); playing ? stop() : play(); }
  if (e.key === '1') setChannel(0);
  if (e.key === '2') setChannel(1);
});

// If the stream drops, try to reconnect
audio.addEventListener('error', () => { if (playing) setTimeout(play, 3000); });
audio.addEventListener('stalled', () => { if (playing) setTimeout(() => playing && audio.paused && play(), 5000); });

// Windows media keys / system media overlay
if ('mediaSession' in navigator) {
  navigator.mediaSession.setActionHandler('play', play);
  navigator.mediaSession.setActionHandler('pause', stop);
  navigator.mediaSession.setActionHandler('stop', stop);
  navigator.mediaSession.setActionHandler('nexttrack', () => setChannel(channel ? 0 : 1));
  navigator.mediaSession.setActionHandler('previoustrack', () => setChannel(channel ? 0 : 1));
}

render();
refresh();
setInterval(refresh, 60_000);
