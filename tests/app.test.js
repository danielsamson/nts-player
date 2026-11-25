// End-to-end tests: launch the real app (Electron) and check the main journeys.
// NTS's public API and streams are used for real; your NTS account is replaced by a
// stand-in, and the app runs with a throwaway profile.
//
//   npm test            (on Linux without a display: xvfb-run -a npm test)

const { _electron: electron } = require('playwright');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const results = [];
let app, win;

async function test(name, fn) {
  const t0 = Date.now();
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`  ✓ ${name} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  } catch (e) {
    results.push({ name, ok: false });
    console.log(`  ✗ ${name}\n      ${String(e.message || e).split('\n')[0]}`);
    try { await win.screenshot({ path: path.join(ROOT, `test-failure-${results.length}.png`) }); } catch {}
  }
}
const expect = (cond, msg) => { if (!cond) throw new Error(msg); };

// Poll a function in the page until it returns something truthy. (Playwright's
// waitForFunction evaluates strings, which the app's Content-Security-Policy blocks.)
async function waitFor(fn, arg, { timeout = 30000, what = 'condition' } = {}) {
  const end = Date.now() + timeout;
  for (;;) {
    const v = await win.evaluate(fn, arg).catch(() => null);
    if (v) return v;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 250));
  }
}

// Stand-in for a signed-in NTS account (My NTS + live track IDs)
async function mockAccount() {
  await app.evaluate(({ ipcMain }) => {
    const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    global.__saved = new Set();
    global.__state = (show) => ({ available: true, signedIn: true, saved: false, following: false,
      tracks: ['Lead It Up', 'Sweetie (IZCO Remix)'].map((t) => ({ artist: '', title: t, canSave: show === 'motive', saved: global.__saved.has(norm(t)) })) });
    for (const ch of ['account:episode', 'account:toggle', 'account:list', 'live:tracks']) ipcMain.removeHandler(ch);
    ipcMain.handle('account:episode', (_e, show) => global.__state(show));
    ipcMain.handle('account:toggle', (_e, a) => { if (a.want) global.__saved.add(norm(a.title)); else global.__saved.delete(norm(a.title)); return global.__state(a.show); });
    ipcMain.handle('account:list', () => ({ signedIn: true, available: true, items: [], tracks: [] }));
    ipcMain.handle('live:tracks', () => ({ available: true, supporter: true, tracks: [
      { time: '15:01', artist: 'Kokoroko, IZCO', title: 'Sweetie (IZCO Remix)' },
      { time: '14:56', artist: 'Joe Higgs', title: 'Journey To Freedom' }] }));
  });
}

(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'nts-player-test-'));
  const args = [ROOT, '--no-sandbox', '--autoplay-policy=no-user-gesture-required'];
  if (process.env.HTTPS_PROXY) args.push(`--proxy-server=${process.env.HTTPS_PROXY}`);
  app = await electron.launch({ args, env: { ...process.env, NTS_PLAYER_USER_DATA: profile } });
  await mockAccount();
  win = await app.firstWindow();
  await win.evaluate(() => { localStorage.setItem('welcomeSeen', '1'); localStorage.setItem('supporter', '1'); localStorage.setItem('wide', '0'); location.reload(); });

  console.log('NTS Player tests');

  await test('Home loads with both live channels', async () => {
    await win.waitForSelector('#onAir .onair__card', { timeout: 30000 });
    expect(await win.locator('#onAir .onair__card').count() === 2, 'expected two On air cards');
    expect(await win.evaluate(() => view) === 'archive', 'app should open on Home');
  });

  await test('Live radio plays and the channel is highlighted', async () => {
    await win.locator('.onair__play').nth(0).click();
    await waitFor(() => playing && !document.getElementById('audio').paused, null, { timeout: 30000 });
    expect(await win.evaluate(() => document.querySelector('.tab[data-ch="0"]').classList.contains('tab--hearing')), 'NTS 1 tab not highlighted');
  });

  await test('Live tracklist shows live track IDs', async () => {
    await win.evaluate(() => { localStorage.setItem('pane', 'tracks'); });
    await win.click('.tab[data-ch="0"]');
    await win.evaluate(() => { pane = 'tracks'; render(); });
    await waitFor(() => document.querySelectorAll('#liveTracksList .track').length === 2, null, { timeout: 30000 });
    await waitFor(() => /Sweetie/.test(document.getElementById('next').textContent), null, { timeout: 30000 });
  });

  await test('Archive episode opens with its tracklist', async () => {
    await win.click('#homeBtn');
    await win.evaluate(() => Archive.showEpisode('motive', 'motive-30th-september-2026'));
    await win.waitForSelector('#archiveContent .archive-tracks .track', { timeout: 30000 });
    expect(await win.locator('#archiveContent .archive-tracks .track').count() > 10, 'tracklist too short');
  });

  await test('Play from a track jumps to it and switches from live', async () => {
    await win.locator('#archiveContent .archive-tracks .track__play').nth(3).click();
    await waitFor(() => ArchivePlayer.state.playing && ArchivePlayer.state.position > 560000, null, { timeout: 60000 });
    expect(await win.evaluate(() => !playing), 'live radio should have stopped');
  });

  await test('Save the current track to My NTS from the bar', async () => {
    await waitFor(() => !document.getElementById('nowSave').hidden, null, { timeout: 30000 });
    await win.click('#nowSave');
    await waitFor(() => document.getElementById('nowSave').classList.contains('nowbar__save--on'), null, { timeout: 15000 });
    expect(await app.evaluate(() => global.__saved.has('sweetie izco remix')), 'track not saved in the account');
  });

  await test('Track details open from a tracklist row', async () => {
    await win.locator('#archiveContent .archive-tracks .track').nth(3).click();
    await win.waitForSelector('.track-page', { timeout: 30000 });
    await waitFor(() => document.querySelector('.track-page .detail__meta')?.textContent, null, { timeout: 60000 });
    await win.click('.archive__back-button');
  });

  await test('Explore: a mood and a genre list episodes', async () => {
    await win.click('#homeBtn');
    await win.waitForSelector('.moods .mood', { timeout: 30000 });
    await win.locator('.moods .mood').first().click();
    await waitFor(() => document.querySelectorAll('#archiveContent .item').length > 5, null, { timeout: 30000 });
    await win.click('.archive__back-button');
    await win.click('.archive__see >> text=All genres');
    await win.waitForSelector('.genre__name', { timeout: 30000 });
    await win.locator('.genre__name').first().click();
    await waitFor(() => document.querySelectorAll('#archiveContent .item').length > 5, null, { timeout: 30000 });
  });

  await test('Schedule lists upcoming shows', async () => {
    await win.click('#homeBtn');
    await win.click('.archive__see >> text=Schedule');
    await waitFor(() => document.querySelectorAll('.schedule__item').length > 5, null, { timeout: 30000 });
  });

  await test('Search finds shows and episodes', async () => {
    await win.fill('#archiveSearch', 'floating points');
    await waitFor(() => /Search/.test(document.querySelector('.archive__crumb')?.textContent || '') && document.querySelectorAll('#archiveContent .item').length > 0, null, { timeout: 30000 });
    await win.fill('#archiveSearch', '');
  });

  await test('Wide view opens the stage', async () => {
    await win.click('#expandBtn');
    await waitFor(() => window.innerWidth >= 720 && getComputedStyle(document.getElementById('stage')).display !== 'none', null, { timeout: 10000 });
    await win.click('#expandBtn');
  });

  await test('Keyboard: Space pauses and plays', async () => {
    await win.evaluate(() => document.activeElement?.blur());
    const before = await win.evaluate(() => ArchivePlayer.state.playing);
    await win.keyboard.press('Space');
    await waitFor((b) => ArchivePlayer.state.playing !== b, before, { timeout: 10000 });
  });

  await test('Keyboard: Space on a focused button presses it, Esc closes', async () => {
    const playingBefore = await win.evaluate(() => ArchivePlayer.state.playing);
    await win.focus('#settingsBtn');
    await win.keyboard.press('Space');
    await waitFor(() => !document.getElementById('settings').hidden, null, { what: 'settings to open' });
    expect(await win.evaluate(() => ArchivePlayer.state.playing) === playingBefore, 'Space also toggled playback');
    await win.keyboard.press('Escape');
    await waitFor(() => document.getElementById('settings').hidden, null, { what: 'settings to close' });
  });

  await test('Keyboard: Enter on a tracklist row opens it', async () => {
    await win.evaluate(() => Archive.showEpisode('motive', 'motive-30th-september-2026'));
    await win.waitForSelector('#archiveContent .archive-tracks .track', { timeout: 30000 });
    await win.focus('#archiveContent .archive-tracks .track >> nth=2');
    await win.keyboard.press('Enter');
    await win.waitForSelector('.track-page', { timeout: 30000 });
  });

  await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  fs.rmSync(profile, { recursive: true, force: true });
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch(async (e) => {
  console.error('Test run crashed:', e.message);
  try { await app?.evaluate(({ app }) => app.exit(1)); } catch {}
  process.exit(1);
});
