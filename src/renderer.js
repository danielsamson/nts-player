const STREAMS = [
  'https://stream-relay-geo.ntslive.net/stream',
  'https://stream-relay-geo.ntslive.net/stream2'
];

const $ = (id) => document.getElementById(id);
const audio = $('audio');
let channel = Number(localStorage.getItem('channel') || 0);
let playing = false;
let live = null;

audio.volume = Number(localStorage.getItem('volume') ?? 0.8);
$('volume').value = audio.volume;

function fmtTime(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function render() {
  document.querySelectorAll('.ch').forEach((b) =>
    b.classList.toggle('active', Number(b.dataset.ch) === channel));
  document.body.classList.toggle('playing', playing);
  $('iconPlay').toggleAttribute('hidden', playing);
  $('iconPause').toggleAttribute('hidden', !playing);

  const r = live?.results?.[channel];
  if (!r) return;
  const now = r.now || {};
  const d = now.embeds?.details || {};
  const media = d.media || {};
  const title = now.broadcast_title || d.name || 'NTS Live';
  const img = media.background_large || media.picture_large || media.background_medium || media.picture_medium || '';

  $('title').textContent = title;
  $('location').textContent = d.location_long || `Channel ${channel + 1}`;
  $('time').textContent = now.start_timestamp
    ? `${fmtTime(now.start_timestamp)} – ${fmtTime(now.end_timestamp)}` : '';
  $('art').style.backgroundImage = img ? `url("${img}")` : '';
  const next = r.next || r.next1;
  $('next').textContent = next?.broadcast_title
    ? `Next ${fmtTime(next.start_timestamp)}: ${next.broadcast_title}` : '';
  document.title = `NTS ${channel + 1} · ${title}`;

  if ('mediaSession' in navigator) {
    navigator.mediaSession.metadata = new MediaMetadata({
      title, artist: `NTS ${channel + 1}`, album: d.location_long || 'NTS Radio',
      artwork: img ? [{ src: img, sizes: '512x512' }] : []
    });
  }
}

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
document.querySelectorAll('.ch').forEach((b) =>
  b.addEventListener('click', () => setChannel(Number(b.dataset.ch))));
$('volume').addEventListener('input', (e) => {
  audio.volume = Number(e.target.value);
  localStorage.setItem('volume', audio.volume);
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
