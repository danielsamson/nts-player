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
    next: r?.next || r?.next1
  };
}

function render() {
  document.querySelectorAll('.tab').forEach((b) =>
    b.classList.toggle('active', Number(b.dataset.ch) === channel));
  document.body.classList.toggle('playing', playing);
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
