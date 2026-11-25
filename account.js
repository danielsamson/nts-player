// My NTS: save episodes, follow shows and save tracks to your NTS account.
//
// NTS has no public API for this, so the app never writes to NTS itself. Instead a
// hidden nts.live window, in the same browser session you signed in with, opens the
// page and presses NTS's own buttons ("Save Episode", "Follow host", "Save track").
// NTS's website code does the saving, exactly as if you'd clicked on nts.live.
// It's also how we read your saved lists: by reading your My NTS pages.
//
// If NTS changes its website this can stop working; the app then shows the
// actions as unavailable rather than guessing.

const { BrowserWindow } = require('electron');

const PARTITION = 'persist:nts';
// `npm run debug`: show the hidden window with its console, and log every step
const DEBUG = process.argv.includes('--nts-debug');
const log = (...a) => { if (DEBUG) console.log('[my-nts]', ...a); };
const SITE = 'https://www.nts.live';
let win = null;
let currentUrl = '';
let chain = Promise.resolve();
let openedAt = 0;
const since = () => `(${((Date.now() - openedAt) / 1000).toFixed(1)}s)`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function ensureWindow() {
  if (win && !win.isDestroyed()) return win;
  win = new BrowserWindow({
    show: false, width: 1280, height: 900, title: 'My NTS (debug view)',
    webPreferences: { partition: PARTITION, sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false }
  });
  win.webContents.setAudioMuted(true);
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  if (DEBUG) {
    // Show it beside the player, smaller, without taking focus.
    // Its developer console opens with Ctrl+Shift+I if you need it.
    const { screen } = require('electron');
    const player = BrowserWindow.getAllWindows().find((w) => w !== win && w.isVisible());
    const area = screen.getPrimaryDisplay().workArea;
    const pb = player ? player.getBounds() : { x: area.x, y: area.y, width: 0, height: 700 };
    const height = Math.max(600, pb.height);
    const roomRight = area.x + area.width - (pb.x + pb.width + 8);
    const roomLeft = pb.x - 8 - area.x;
    // right of the player if it fits, else left, else whichever side has more room
    const right = roomRight >= 900 || roomRight >= roomLeft;
    const width = Math.max(480, Math.min(900, right ? roomRight : roomLeft));
    const x = right ? Math.min(pb.x + pb.width + 8, area.x + area.width - width) : Math.max(area.x, pb.x - 8 - width);
    win.setBounds({ x, y: pb.y, width, height });
    win.showInactive();
    win.webContents.on('before-input-event', (_e, input) => {
      if (input.type === 'keyDown' && input.control && input.shift && input.key.toLowerCase() === 'i') win.webContents.toggleDevTools();
    });
    win.webContents.on('console-message', (_e, level, message) => {
      if (level >= 2 && !/Electron Security Warning/.test(message)) log('page console:', message.slice(0, 300));
    });
    win.webContents.on('did-navigate', (_e, url) => log('navigated to', url));
    win.webContents.on('did-navigate-in-page', (_e, url) => log('in-page navigation to', url));
  }
  win.on('closed', () => { win = null; currentUrl = ''; });
  return win;
}

// One job at a time, so page loads and clicks never overlap
function run(fn) {
  const p = chain.then(fn, fn);
  chain = p.catch(() => {});
  return p;
}

async function open(path, force = false) {
  const w = ensureWindow();
  const url = SITE + path;
  if (!force && currentUrl === url) return w;
  currentUrl = url;
  log('opening', url);
  openedAt = Date.now();
  try { await w.loadURL(url); } catch (e) { log('load failed:', e.message); }
  return w;
}

const js = (code) => win.webContents.executeJavaScript(code, true);

async function waitFor(code, timeout = 12000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const r = await js(code).catch(() => null);
    if (r) return r;
    await sleep(300);
  }
  return null;
}

const signedOutUrl = () => /\/sign-in/.test(win?.webContents.getURL() || '');

// ---- Reading an episode page ----
// Everything is looked up inside #episode-container, never the live header above it.
// NTS sets window.NTS.isAuthenticated (true/false) once it knows whether you're signed in;
// until then it's undefined, so wait for it.
const AUTH_KNOWN = `(window.NTS && typeof window.NTS.isAuthenticated === 'boolean')`;
const SIGNED_IN = `(window.NTS.isAuthenticated === true || window.NTS.userIsAuthenticated === true)`;

const READ_EPISODE = `(() => {
  const root = document.querySelector('#episode-container');
  if (!root || !${AUTH_KNOWN}) return null;
  const saveBtn = root.querySelector('.bio__header button[title*="Episode" i], .bio__header button[aria-label*="Episode" i]');
  const followBtn = root.querySelector('.bio__footer .follow-button') || root.querySelector('.follow-button');
  if (!saveBtn && !followBtn) return null;
  const label = (b) => (b.getAttribute('title') || '') + ' ' + (b.getAttribute('aria-label') || '');
  const text = (el) => (el ? el.textContent.trim() : '');
  // NTS repeats each artist in a hidden mobile copy; skip those
  const artists = (t) => [...t.querySelectorAll('.track__artist:not(.track__artist--mobile)')].map(text).filter(Boolean).join(', ');
  const tracks = [...root.querySelectorAll('.track')].map((t) => ({
    artist: artists(t),
    title: text(t.querySelector('.track__title')),
    canSave: !!t.querySelector('.save-track-button'),
    saved: !!t.querySelector('.save-track-button--saved')
  }));
  return {
    signedIn: ${SIGNED_IN},
    saved: saveBtn ? /remove/i.test(label(saveBtn)) : null,
    following: followBtn ? (followBtn.classList.contains('follow-button--favourited') || /unfollow/i.test(label(followBtn))) : null,
    tracks
  };
})()`;

async function readEpisode(show, episode, force) {
  await open(`/shows/${encodeURIComponent(show)}/episodes/${encodeURIComponent(episode)}`, force);
  let state = await waitFor(READ_EPISODE);
  if (!state) { log('episode buttons not found', since(), 'on', win?.webContents.getURL()); return { available: false }; }
  // Your saved state arrives a moment after the page; read again once it settles
  await sleep(1500);
  state = (await js(READ_EPISODE).catch(() => null)) || state;
  log('episode state', since(), JSON.stringify({ signedIn: state.signedIn, saved: state.saved, following: state.following, tracks: state.tracks.length, savedTracks: state.tracks.filter((t) => t.saved).length }));
  return { available: true, ...state };
}

function getEpisodeState(show, episode) {
  return run(() => readEpisode(show, episode, true));
}

// ---- Pressing NTS's button ----
// kind: 'episode' | 'show' | 'track' (track picked by artist + title)
function toggle({ show, episode, kind, artist, title, want }) {
  return run(async () => {
    let state = await readEpisode(show, episode, false);
    if (!state.available || !state.signedIn) return state;
    const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    const current = () => {
      if (kind === 'episode') return state.saved;
      if (kind === 'show') return state.following;
      // match by title: the page formats artists differently ("A (B mix)" vs "A, B")
      const t = state.tracks.find((x) => norm(x.title) === norm(title));
      return t ? t.saved : null;
    };
    log('toggle', kind, 'want', want, 'current', current(), kind === 'track' ? `"${title}"` : '');
    if (current() === null) return { ...state, error: 'not-found' };
    if (current() === want) return state;

    const clicked = await js(`(() => {
      const root = document.querySelector('#episode-container');
      if (!root) return false;
      const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
      let btn = null;
      if (${JSON.stringify(kind)} === 'episode') btn = root.querySelector('.bio__header button[title*="Episode" i], .bio__header button[aria-label*="Episode" i]');
      else if (${JSON.stringify(kind)} === 'show') btn = root.querySelector('.bio__footer .follow-button') || root.querySelector('.follow-button');
      else {
        const row = [...root.querySelectorAll('.track')].find((t) =>
          norm((t.querySelector('.track__title') || {}).textContent) === ${JSON.stringify(norm(title))});
        btn = row && row.querySelector('.save-track-button');
      }
      if (!btn) return false;
      btn.click();
      return true;
    })()`).catch(() => false);
    log(clicked ? 'clicked NTS button' : 'button to click not found');
    if (!clicked) return { ...state, error: 'not-found' };

    // Wait for NTS to confirm (the button flips)
    for (let i = 0; i < 30; i++) {
      await sleep(300);
      const s = await js(READ_EPISODE).catch(() => null);
      if (!s) continue;
      state = { available: true, ...s };
      if (current() === want) { log('confirmed by NTS'); return state; }
    }
    log('NTS did not confirm within 9 s; button still reads', current(), 'url', win?.webContents.getURL());
    return { ...state, error: 'timeout' };
  });
}

// ---- Reading your My NTS lists ----
const LIST_PATHS = { episodes: '/my-nts', shows: '/my-nts/favourites/shows', tracks: '/my-nts/tracks' };

const READ_LIST = `(() => {
  const page = document.querySelector('.page-my-nts, #react-content');
  if (!page) return null;
  const items = [...page.querySelectorAll('.article-list-item')].map((it) => {
    const a = it.querySelector('a[href*="/shows/"]');
    const img = it.querySelector('img');
    const t = (sel) => { const e = it.querySelector(sel); return e ? e.textContent.trim() : ''; };
    return {
      path: a ? new URL(a.getAttribute('href'), location.origin).pathname : '',
      title: t('.article-list-item__content__top__title') || (a ? a.textContent.trim() : ''),
      subtitle: t('.article-list-item__content__top__subtitle'),
      img: img ? img.currentSrc || img.src : ''
    };
  }).filter((x) => x.path);
  const tracks = [...page.querySelectorAll('.track')].map((t) => {
    const a = t.closest('[href*="/shows/"]') || t.querySelector('a[href*="/shows/"]');
    const txt = (sel) => { const e = t.querySelector(sel); return e ? e.textContent.trim() : ''; };
    const artist = [...t.querySelectorAll('.track__artist:not(.track__artist--mobile)')].map((e) => e.textContent.trim()).filter(Boolean).join(', ') || txt('.track__artists');
    return { artist, title: txt('.track__title'), path: a ? new URL(a.getAttribute('href'), location.origin).pathname : '' };
  }).filter((x) => x.title);
  const empty = !items.length && !tracks.length;
  return { items, tracks, empty, ready: !!document.querySelector('.page-my-nts') };
})()`;

function getList(kind) {
  return run(async () => {
    await open(LIST_PATHS[kind] || LIST_PATHS.episodes, true);
    await sleep(500);
    if (signedOutUrl()) { log('My NTS redirected to sign-in: not signed in'); return { signedIn: false }; }
    // Wait for the list (or an empty My NTS page) to render
    let res = await waitFor(`(() => { const r = ${READ_LIST}; return r && (r.items.length || r.tracks.length || r.ready) ? r : null; })()`, 12000);
    if (signedOutUrl()) return { signedIn: false };
    if (!res) {
      log('My NTS list not recognised on', win?.webContents.getURL());
      if (DEBUG) log('page text:', (await js('document.body.innerText.slice(0, 600)').catch(() => '')).replace(/\n+/g, ' | '));
      return { signedIn: true, available: false };
    }
    await sleep(1200);      // let the rest of the list arrive
    res = (await js(READ_LIST).catch(() => null)) || res;
    log(`My NTS ${kind}:`, res.items.length, 'items,', res.tracks.length, 'tracks');
    if (DEBUG && !res.items.length && !res.tracks.length) {
      log('page text:', (await js('document.body.innerText.slice(0, 600)').catch(() => '')).replace(/\n+/g, ' | '));
      log('list classes seen:', await js(`[...new Set([...document.querySelectorAll('[class]')].map((e) => String(e.className).split(' ')[0]).filter((c) => /list|item|card|track|episode|show|favourite/i.test(c)))].slice(0, 40).join(' ')`).catch(() => ''));
    }
    return { signedIn: true, available: true, items: res.items, tracks: res.tracks };
  });
}

// After signing in or out, start fresh
function reset() {
  currentUrl = '';
  if (win && !win.isDestroyed()) win.destroy();
  win = null;
}

module.exports = { getEpisodeState, toggle, getList, reset };
