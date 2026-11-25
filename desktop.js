// Desktop integration: tray icon, mini player, global shortcuts, start at login,
// keep playing when the window is closed, and automatic updates.

const { app, Tray, Menu, nativeImage, globalShortcut, BrowserWindow, Notification } = require('electron');
const path = require('path');
const fs = require('fs');

let win = null;
let tray = null;
let quitting = false;
let mini = false;
let normalBounds = null;
const state = { playing: false, label: 'NTS Player', canSkip: false, sleep: 'off', canSave: false, saved: false, track: '' };

// ---- Settings that main needs before the window has loaded ----
const SETTINGS = () => path.join(app.getPath('userData'), 'desktop-settings.json');
let settings = { keepInTray: true, toldAboutTray: false };
try { settings = { ...settings, ...JSON.parse(fs.readFileSync(SETTINGS(), 'utf8')) }; } catch {}
const saveSettings = () => { try { fs.writeFileSync(SETTINGS(), JSON.stringify(settings)); } catch {} };

const send = (command) => win?.webContents.send('desktop:command', command);
function show() {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

// ---- Tray / menu bar icon ----
function trayIcon() {
  const img = nativeImage.createFromPath(path.join(__dirname, 'build', 'icon.png'));
  return img.resize({ width: process.platform === 'darwin' ? 18 : 16, height: process.platform === 'darwin' ? 18 : 16 });
}

// ---- Windows: buttons on the taskbar thumbnail (hover over the icon) ----
const icon = (name) => nativeImage.createFromPath(path.join(__dirname, 'build', `thumb-${name}.png`));
function updateThumbar() {
  if (process.platform !== 'win32' || !win || win.isDestroyed()) return;
  win.setThumbarButtons([
    { tooltip: 'Previous track', icon: icon('prev'), flags: state.canSkip ? [] : ['disabled'], click: () => send('prev') },
    { tooltip: state.playing ? 'Pause' : 'Play', icon: icon(state.playing ? 'pause' : 'play'), click: () => send('toggle') },
    { tooltip: 'Next track', icon: icon('next'), flags: state.canSkip ? [] : ['disabled'], click: () => send('next') },
    { tooltip: state.saved ? `Saved to My NTS: ${state.track}` : `Save to My NTS${state.track ? ': ' + state.track : ''}`,
      icon: icon(state.saved ? 'saved' : 'save'), flags: state.canSave ? [] : ['disabled'], click: () => send('save') }
  ]);
  win.setThumbnailToolTip(state.label);
}

// ---- macOS: Dock menu (right-click the Dock icon) ----
function updateDock() {
  if (process.platform !== 'darwin' || !app.dock) return;
  app.dock.setMenu(Menu.buildFromTemplate([
    { label: state.label, enabled: false },
    { label: state.playing ? 'Pause' : 'Play', click: () => send('toggle') },
    { label: 'Next track', enabled: state.canSkip, click: () => send('next') },
    { label: 'Previous track', enabled: state.canSkip, click: () => send('prev') },
    { label: state.saved ? 'Saved to My NTS' : 'Save track to My NTS', type: 'checkbox', checked: state.saved, enabled: state.canSave, click: () => send('save') },
    { type: 'separator' },
    { label: 'Listen to NTS 1', click: () => send('channel1') },
    { label: 'Listen to NTS 2', click: () => send('channel2') },
    { label: mini ? 'Full player' : 'Mini player', click: () => setMini(!mini) }
  ]));
}

function buildTrayMenu() {
  updateThumbar();
  updateDock();
  if (!tray) return;
  tray.setToolTip(state.label);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: state.label, enabled: false },
    { type: 'separator' },
    { label: state.playing ? 'Pause' : 'Play', click: () => send('toggle') },
    { label: 'Next track', enabled: state.canSkip, click: () => send('next') },
    { label: 'Previous track', enabled: state.canSkip, click: () => send('prev') },
    { label: state.saved ? 'Saved to My NTS' : 'Save track to My NTS', type: 'checkbox', checked: state.saved, enabled: state.canSave, click: () => send('save') },
    { type: 'separator' },
    { label: 'Listen to NTS 1', click: () => send('channel1') },
    { label: 'Listen to NTS 2', click: () => send('channel2') },
    { type: 'separator' },
    { label: mini ? 'Full player' : 'Mini player', click: () => setMini(!mini) },
    { label: 'Show NTS Player', click: show },
    { type: 'separator' },
    { label: 'Quit', click: () => { quitting = true; app.quit(); } }
  ]));
}

// ---- Mini player: just the now-playing bar, always on top ----
function setMini(on) {
  if (!win || on === mini) return;
  mini = on;
  if (on) {
    normalBounds = win.getBounds();
    win.setMinimumSize(320, 56);
    win.setContentSize(Math.max(380, Math.min(normalBounds.width, 520)), 48, true);
    win.setAlwaysOnTop(true, 'floating');
  } else {
    win.setAlwaysOnTop(false);
    win.setMinimumSize(320, 560);
    if (normalBounds) win.setBounds(normalBounds, true);
  }
  win.webContents.send('desktop:mini', on);
  buildTrayMenu();
}

// ---- Global shortcuts (work when the app isn't focused) ----
function registerShortcuts() {
  const mod = process.platform === 'darwin' ? 'Command+Alt' : 'Control+Alt';
  const map = { P: 'toggle', Right: 'next', Left: 'prev', M: 'mini' };
  for (const [key, cmd] of Object.entries(map)) {
    try {
      globalShortcut.register(`${mod}+${key}`, () => (cmd === 'mini' ? setMini(!mini) : send(cmd)));
    } catch {}
  }
}

// ---- Automatic updates (installed builds only) ----
function checkForUpdates() {
  if (!app.isPackaged) return;
  try {
    const { autoUpdater } = require('electron-updater');
    autoUpdater.autoDownload = true;
    autoUpdater.on('update-downloaded', (info) => {
      if (!Notification.isSupported()) return;
      const n = new Notification({ title: 'NTS Player update ready', body: `Version ${info.version} installs when you quit.`, silent: true });
      n.show();
    });
    autoUpdater.on('error', () => {});
    autoUpdater.checkForUpdates().catch(() => {});
    setInterval(() => autoUpdater.checkForUpdates().catch(() => {}), 6 * 3600 * 1000);
  } catch {}
}

function init(mainWindow, ipcMain) {
  win = mainWindow;

  win.on('show', updateThumbar);   // Windows drops thumbnail buttons when a window is hidden
  tray = new Tray(trayIcon());
  tray.on('click', () => (win.isVisible() && win.isFocused() ? win.hide() : show()));
  buildTrayMenu();

  // Closing the window keeps the music going in the tray (if enabled)
  win.on('close', (e) => {
    if (quitting || !settings.keepInTray) return;
    e.preventDefault();
    win.hide();
    if (!settings.toldAboutTray && Notification.isSupported()) {
      settings.toldAboutTray = true;
      saveSettings();
      new Notification({ title: 'NTS Player is still playing', body: 'It’s in the tray. Quit from the tray menu.', silent: true }).show();
    }
  });
  app.on('before-quit', () => { quitting = true; });

  registerShortcuts();
  app.on('will-quit', () => globalShortcut.unregisterAll());

  ipcMain.handle('desktop:state', (_e, s = {}) => {
    if ('playing' in s) state.playing = !!s.playing;
    if ('label' in s) state.label = String(s.label || 'NTS Player').slice(0, 120);
    if ('canSkip' in s) state.canSkip = !!s.canSkip;
    if ('canSave' in s) state.canSave = !!s.canSave;
    if ('saved' in s) state.saved = !!s.saved;
    if ('track' in s) state.track = String(s.track || '').slice(0, 120);
    buildTrayMenu();
  });
  ipcMain.handle('desktop:mini', (_e, on) => setMini(!!on));
  ipcMain.handle('desktop:settings', () => ({
    keepInTray: settings.keepInTray,
    openAtLogin: app.getLoginItemSettings().openAtLogin,
    loginSupported: process.platform === 'win32' || process.platform === 'darwin'
  }));
  ipcMain.handle('desktop:set', (_e, key, value) => {
    if (key === 'keepInTray') { settings.keepInTray = !!value; saveSettings(); }
    if (key === 'openAtLogin' && (process.platform === 'win32' || process.platform === 'darwin')) {
      app.setLoginItemSettings({ openAtLogin: !!value });
    }
  });

  checkForUpdates();
}

module.exports = { init, quit: () => { quitting = true; app.quit(); } };
