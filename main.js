const { app, BrowserWindow, ipcMain, net, Menu, shell } = require('electron');
const path = require('path');

const LIVE_API = 'https://www.nts.live/api/v2/live';
let win;

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
    height: 620,
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
      backgroundThrottling: false
    }
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

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
