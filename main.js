const { app, BrowserWindow, ipcMain, net, Menu, shell, clipboard, session } = require('electron');
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
  Menu.setApplicationMenu(null);
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

ipcMain.handle('clipboard:write', (_e, text) => {
  if (typeof text === 'string' && text.length < 1000) clipboard.writeText(text);
});

app.whenReady().then(() => {
  // Present as a regular Chrome browser to nts.live (drops the "Electron" token)
  const nts = session.fromPartition(NTS_PARTITION);
  nts.setUserAgent(nts.getUserAgent().replace(/\s(Electron|nts-player)\/\S+/g, ''));
  createWindow();
});
app.on('window-all-closed', () => app.quit());
