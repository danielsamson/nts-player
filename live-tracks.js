// Live track IDs for NTS Supporters.
// Reads NTS's own live tracklist page (www.nts.live/live-tracklist/{1,2}) in your
// signed-in session, rendered offscreen, and returns the tracks it shows. NTS keeps
// that page updated itself, so we only read it; nothing is written anywhere.

const { BrowserWindow } = require('electron');

const PARTITION = 'persist:nts';
let win = null;
let channelLoaded = null;

function ensureWindow() {
  if (win && !win.isDestroyed()) return win;
  win = new BrowserWindow({
    show: false, width: 800, height: 900,
    webPreferences: {
      partition: PARTITION, sandbox: true, contextIsolation: true, nodeIntegration: false,
      backgroundThrottling: false, offscreen: true   // rendered as if on screen, never shown
    }
  });
  win.webContents.setFrameRate(2);
  win.webContents.setAudioMuted(true);
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.on('closed', () => { win = null; channelLoaded = null; });
  return win;
}

const READ = `(() => {
  if (!(window.NTS && typeof window.NTS.isAuthenticated === 'boolean')) return null;
  if (document.querySelector('.page-live-tracks__promo')) return { supporter: false, tracks: [] };
  const list = document.querySelector('.page-live-tracks__list, .live-tracks-list');
  if (!list) return null;
  const text = (el) => (el ? el.textContent.trim() : '');
  const tracks = [...list.querySelectorAll('.live-track')].map((li) => ({
    time: text(li.querySelector('.live-track__timestamp')),
    artist: text(li.querySelector('.live-track__artist-title')),
    title: text(li.querySelector('.live-track__song-title'))
  })).filter((t) => t.title);
  return { supporter: true, tracks };   // newest first
})()`;

// channel: 1 or 2. Returns { supporter, tracks } or { available: false }
async function getLiveTracks(channel) {
  touch();
  const w = ensureWindow();
  if (channelLoaded !== channel) {
    channelLoaded = channel;
    try { await w.loadURL(`https://www.nts.live/live-tracklist/${channel}`); } catch {}
  }
  for (let i = 0; i < 30; i++) {
    const r = await w.webContents.executeJavaScript(READ, true).catch(() => null);
    if (r) return { available: true, ...r };
    await new Promise((res) => setTimeout(res, 300));
  }
  return { available: false };
}

// Close the page when it hasn't been asked for a while (live radio stopped)
let idleTimer = null;
function touch() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(reset, 90 * 1000);
}

function reset() {
  if (win && !win.isDestroyed()) win.destroy();
  win = null;
  channelLoaded = null;
}

module.exports = { getLiveTracks, reset };
