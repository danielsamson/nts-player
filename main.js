const { app, BrowserWindow, ipcMain, net, Menu, shell, clipboard, session, Notification, nativeImage } = require('electron');
const { getArt, getAppleLink } = require('./art');
const account = require('./account');
const liveTracks = require('./live-tracks');
const desktop = require('./desktop');
const path = require('path');

const LIVE_API = 'https://www.nts.live/api/v2/live';
// Your NTS sign-in lives in its own persistent browser session, separate from
// the player. The app never sees your password: you sign in on nts.live itself.
const NTS_PARTITION = 'persist:nts';
const LIVE_TRACKLIST_URL = 'https://www.nts.live/live-tracklist/';
// NTS's own embeddable sign-in, which returns to the live tracklist afterwards
const SIGN_IN_URL = 'https://www.nts.live/sign-in?embed=true&continue=/live-tracklist/1';
let win;
let signInWin;

const isNts = (url) => {
  try { const u = new URL(url); return u.protocol === 'https:' && u.hostname === 'www.nts.live'; }
  catch { return false; }
};
// Pages that are part of signing in, rather than the destination after it
const isAuthPage = (url) => isNts(url) && /^\/(sign-in|join|forgot-password|reset-password)(\/|$)/.test(new URL(url).pathname);

// Tests run with a throwaway profile so they never touch your settings or history
if (process.env.NTS_PLAYER_USER_DATA) app.setPath('userData', process.env.NTS_PLAYER_USER_DATA);

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
  });
}

function createWindow() {
  win = new BrowserWindow({
    width: 380,
    height: 660,
    minWidth: 320,
    minHeight: 560,
    backgroundColor: '#000000',
    title: 'NTS Player',
    icon: path.join(__dirname, 'build', 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      webviewTag: true
    }
  });

  // Lock down the embedded live tracklist: NTS session, no Node, nts.live only
  win.webContents.on('will-attach-webview', (event, prefs, params) => {
    delete prefs.preload;
    prefs.nodeIntegration = false;
    prefs.contextIsolation = true;
    prefs.sandbox = true;
    params.partition = NTS_PARTITION;
    if (!params.src.startsWith(LIVE_TRACKLIST_URL)) event.preventDefault();
  });
  // No menu bar on Windows/Linux. macOS keeps the standard app menu, which is where
  // Cmd+Q, Cmd+C/V (e.g. in the search box) and the other shortcuts live.
  if (process.platform === 'darwin') {
    const cmd = (c) => () => win?.webContents.send('desktop:command', c);
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      { role: 'appMenu' }, { role: 'editMenu' },
      { label: 'Playback', submenu: [
        { label: 'Play / Pause', accelerator: 'Command+Alt+P', registerAccelerator: false, click: cmd('toggle') },
        { label: 'Next track', accelerator: 'Command+Alt+Right', registerAccelerator: false, click: cmd('next') },
        { label: 'Previous track', accelerator: 'Command+Alt+Left', registerAccelerator: false, click: cmd('prev') },
        { type: 'separator' },
        { label: 'Listen to NTS 1', click: cmd('channel1') },
        { label: 'Listen to NTS 2', click: cmd('channel2') }
      ] },
      { role: 'windowMenu' }
    ]));
  } else {
    Menu.setApplicationMenu(null);
  }
  win.loadFile(path.join(__dirname, 'src', 'index.html'));

  // Open any links (e.g. show pages) in the normal browser
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) shell.openExternal(url);
    return { action: 'deny' };
  });
}

// Fetch "now playing" from the main process so CORS never gets in the way
ipcMain.handle('nts:live', async () => {
  const res = await net.fetch(LIVE_API, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`NTS API ${res.status}`);
  return res.json();
});

// Read-only access to other NTS API paths (tracklists, episodes). Only
// /api/v2/... paths on nts.live are allowed.
ipcMain.handle('nts:api', async (_e, apiPath) => {
  if (typeof apiPath !== 'string' || !/^\/api\/v2\/[A-Za-z0-9\-_/]+(\?[A-Za-z0-9=&_.%+\[\]-]*)?$/.test(apiPath) || apiPath.includes('..')) {
    throw new Error('Invalid NTS API path');
  }
  const res = await net.fetch(`https://www.nts.live${apiPath}`, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`NTS API ${res.status}`);
  return res.json();
});

// ---- NTS Supporter sign-in ----
function openSignIn() {
  if (signInWin && !signInWin.isDestroyed()) { signInWin.focus(); return; }
  signInWin = new BrowserWindow({
    width: 440, height: 720, parent: win, title: 'Sign in to NTS',
    backgroundColor: '#000000', autoHideMenuBar: true,
    webPreferences: { partition: NTS_PARTITION, sandbox: true, contextIsolation: true, nodeIntegration: false }
  });
  const wc = signInWin.webContents;
  // Signed in once NTS sends us on from the sign-in pages to anywhere else on nts.live
  const check = (_e, url) => {
    if (isNts(url) && !isAuthPage(url)) {
      account.reset();
      liveTracks.reset();
      win?.webContents.send('nts:auth-changed', true);
      signInWin.close();
    }
  };
  wc.on('did-navigate', check);
  wc.on('did-navigate-in-page', check);
  // Allow sign-in popups (e.g. Google/Apple) but send other links to the browser
  wc.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\/(accounts\.google\.com|appleid\.apple\.com|[a-z0-9-]+\.firebaseapp\.com)\//.test(url)) {
      return { action: 'allow' };
    }
    if (url.startsWith('https://')) shell.openExternal(url);
    return { action: 'deny' };
  });
  signInWin.loadURL(SIGN_IN_URL);
}

ipcMain.handle('nts:sign-in', () => openSignIn());
ipcMain.handle('nts:sign-out', async () => {
  await session.fromPartition(NTS_PARTITION).clearStorageData();
  account.reset();
  liveTracks.reset();
  win?.webContents.send('nts:auth-changed', false);
});

// Links inside the embedded tracklist open in your browser; it can't navigate off nts.live
app.on('web-contents-created', (_e, contents) => {
  if (contents.getType() !== 'webview') return;
  contents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) shell.openExternal(url);
    return { action: 'deny' };
  });
  contents.on('will-navigate', (event, url) => { if (!isNts(url)) event.preventDefault(); });
});

// Album art for a tracklist entry (see art.js)
ipcMain.handle('art:lookup', (_e, track, priority) => getArt(track && {
  artist: String(track.artist || '').slice(0, 200), title: String(track.title || '').slice(0, 200),
  isrc: track.isrc ? String(track.isrc).slice(0, 20) : null,
  deezer: track.deezer ? String(track.deezer).slice(0, 20) : null
}, priority === 'high' ? 'high' : 'low'));

// Open a link in the music app if it's installed (Spotify, Deezer, Apple Music),
// otherwise on the web. Windows/macOS tell us whether something handles the scheme.
const APP_SCHEMES = new Set(['spotify', 'deezer', 'music', 'musics', 'itmss']);
ipcMain.handle('open:link', async (_e, { web, apps } = {}) => {
  for (const u of Array.isArray(apps) ? apps.slice(0, 4) : []) {
    const scheme = typeof u === 'string' ? u.split(':')[0].toLowerCase() : '';
    if (!APP_SCHEMES.has(scheme)) continue;
    let handler = '';
    try { handler = app.getApplicationNameForProtocol(`${scheme}://`); } catch {}
    if (handler) {
      try { await shell.openExternal(u); return `app:${scheme}`; } catch {}
    }
  }
  if (typeof web === 'string' && /^https:\/\//.test(web)) { await shell.openExternal(web); return 'web'; }
  return 'none';
});

// My NTS (see account.js): saved state, NTS's own save/follow buttons, your lists
const alias = (s) => (typeof s === 'string' && /^[a-z0-9-]{1,200}$/i.test(s) ? s : null);
ipcMain.handle('account:episode', (_e, show, episode) =>
  alias(show) && alias(episode) ? account.getEpisodeState(show, episode) : { available: false });
ipcMain.handle('account:toggle', (_e, a = {}) => {
  if (!alias(a.show) || !alias(a.episode) || !['episode', 'show', 'track'].includes(a.kind)) return { available: false };
  return account.toggle({ show: a.show, episode: a.episode, kind: a.kind, want: !!a.want,
    artist: String(a.artist || '').slice(0, 300), title: String(a.title || '').slice(0, 300) });
});
ipcMain.handle('account:list', (_e, kind) =>
  account.getList(['episodes', 'shows', 'tracks'].includes(kind) ? kind : 'episodes'));

// Live track IDs for NTS Supporters (see live-tracks.js)
ipcMain.handle('live:tracks', (_e, channel) => liveTracks.getLiveTracks(channel === 2 ? 2 : 1));

ipcMain.handle('links:apple', (_e, track) => getAppleLink(track && {
  artist: String(track.artist || '').slice(0, 200), title: String(track.title || '').slice(0, 200)
}));

// Track-change notifications, shown from here so they can carry the album art on Windows
let lastNote = null;
ipcMain.handle('notify', async (_e, { title, body, art } = {}) => {
  if (!Notification.isSupported()) return;
  let icon = path.join(__dirname, 'build', 'icon.png');
  if (typeof art === 'string' && /^https:\/\//.test(art)) {
    try {
      const res = await net.fetch(art);
      if (res.ok) {
        const img = nativeImage.createFromBuffer(Buffer.from(await res.arrayBuffer()));
        if (!img.isEmpty()) icon = img.resize({ width: 256, height: 256 });
      }
    } catch {}
  }
  lastNote?.close();
  lastNote = new Notification({ title: String(title || '').slice(0, 200), body: String(body || '').slice(0, 300), icon, silent: true });
  lastNote.on('click', () => { if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); } });
  lastNote.show();
});

// Thin strip (default) or wide view with the stage. Grows to the right, kept on screen.
const STRIP_WIDTH = 380;
const WIDE_WIDTH = 1040;
ipcMain.handle('win:set-wide', (_e, wide) => {
  if (!win) return;
  const { screen } = require('electron');
  const b = win.getBounds();
  const area = screen.getDisplayMatching(b).workArea;
  const width = Math.min(wide ? WIDE_WIDTH : STRIP_WIDTH, area.width);
  const x = Math.max(area.x, Math.min(b.x, area.x + area.width - width));
  if (win.isMaximized()) win.unmaximize();
  win.setBounds({ x, y: b.y, width, height: b.height }, true);
});

ipcMain.handle('win:focus', () => {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
});

ipcMain.handle('clipboard:write', (_e, text) => {
  if (typeof text === 'string' && text.length < 1000) clipboard.writeText(text);
});

// Windows needs an app ID for notifications to show up (matches build.appId)
if (process.platform === 'win32') app.setAppUserModelId('local.ntsplayer');

app.whenReady().then(() => {
  // Present as a regular Chrome browser to nts.live (drops the "Electron" token)
  const nts = session.fromPartition(NTS_PARTITION);
  // NTS's own pages (live tracklist, My NTS) can send browser notifications, e.g. "new
  // live track", whatever you're listening to. The app sends its own, so block theirs.
  nts.setPermissionRequestHandler((_wc, permission, cb) => cb(permission !== 'notifications'));
  nts.setPermissionCheckHandler((_wc, permission) => permission !== 'notifications');
  nts.setUserAgent(nts.getUserAgent().replace(/\s(Electron|nts-player)\/\S+/g, ''));
  createWindow();
  desktop.init(win, ipcMain);
});
// macOS: clicking the dock icon brings the window back
app.on('activate', () => { if (win) { win.show(); win.focus(); } });
app.on('window-all-closed', () => app.quit());
