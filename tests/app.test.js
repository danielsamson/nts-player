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
    // the bar names the track playing (the stage may be showing the track web)
    await waitFor(() => /Sweetie/i.test(document.getElementById('next').textContent), null, { timeout: 15000, what: 'the current track in the bar' });
  });

  await test('Play from in a different episode lands at the right time', async () => {
    await win.evaluate(() => Archive.playFrom('motive', 'motive-2nd-september-2026', 900));
    await waitFor(() => ArchivePlayer.state.episode?.episode === 'motive-2nd-september-2026' && ArchivePlayer.state.playing, null, { timeout: 60000, what: 'the other episode to play' });
    await new Promise((r) => setTimeout(r, 8000));      // past the moment it used to fall back to 0:00
    const pos = await win.evaluate(() => ArchivePlayer.state.position / 1000);
    expect(pos > 890 && pos < 960, `expected ~900s, got ${Math.round(pos)}s`);
    await win.evaluate(() => Archive.playFrom('motive', 'motive-30th-september-2026', 570));
    await waitFor(() => ArchivePlayer.state.episode?.episode === 'motive-30th-september-2026' && ArchivePlayer.state.position > 560000, null, { timeout: 60000, what: 'back to the first episode' });
  });

  await test('Play from late in a longer episode doesn\'t skip to another one', async () => {
    // 1:45:32 into a 1:54 episode, from a 59-minute one: the switch used to look like the end
    await win.evaluate(() => Archive.playFrom('selassie-tbc', 'selassie-tbc-24th-july-2026', 6332));
    await waitFor(() => ArchivePlayer.state.episode?.episode === 'selassie-tbc-24th-july-2026' && ArchivePlayer.state.playing, null, { timeout: 60000, what: 'the long episode to play' });
    await new Promise((r) => setTimeout(r, 8000));
    const s = await win.evaluate(() => ({ ep: ArchivePlayer.state.episode.episode, pos: ArchivePlayer.state.position / 1000 }));
    expect(s.ep === 'selassie-tbc-24th-july-2026' && s.pos > 6300, `expected the same episode near 6332s, got ${s.ep} at ${Math.round(s.pos)}s`);
    await win.evaluate(() => Archive.playFrom('motive', 'motive-30th-september-2026', 570));
    await waitFor(() => ArchivePlayer.state.episode?.episode === 'motive-30th-september-2026' && ArchivePlayer.state.position > 560000, null, { timeout: 60000, what: 'back to the first episode' });
  });

  await test('Save the current track to My NTS from the bar', async () => {
    await waitFor(() => !document.getElementById('nowSave').hidden, null, { timeout: 30000 });
    await win.click('#nowSave');
    await waitFor(() => document.getElementById('nowSave').classList.contains('nowbar__save--on'), null, { timeout: 15000 });
    expect(await app.evaluate(() => global.__saved.has('sweetie izco remix')), 'track not saved in the account');
  });

  await test('The bar takes you back to the episode playing and its tracklist', async () => {
    await win.evaluate(() => Archive.home());
    await win.waitForSelector('.year-card', { timeout: 15000 });
    await win.click('#nowText');
    await waitFor(() => !!document.querySelector('#archiveContent .track--now'), null, { timeout: 30000 });
  });

  await test('Track details open from a tracklist row', async () => {
    await win.locator('#archiveContent .archive-tracks .track').nth(3).click();
    await win.waitForSelector('.track-page', { timeout: 30000 });
    await waitFor(() => document.querySelector('.track-page .detail__meta')?.textContent, null, { timeout: 60000 });
    await win.click('.archive__back-button');
  });

  await test('A track page lists what was played next to it', async () => {
    await win.evaluate(() => Archive.showTrack('Klein', 'Spiritual Warfare'));
    await win.waitForSelector('.track-page', { timeout: 30000 });
    await waitFor(() => document.querySelectorAll('.track-page__discover .similar-tracks .track').length > 0, null, { timeout: 60000 });
    await win.click('.archive__back-button');
  });

  await test('An artist page opens from a track page', async () => {
    await win.evaluate(() => Archive.showTrack('Klein', 'Spiritual Warfare'));
    await win.click('.track-page__artist-link', { timeout: 30000 });
    await win.waitForSelector('.artist-page', { timeout: 15000 });
    await waitFor(() => document.querySelectorAll('.artist-page .track').length > 0, null, { timeout: 60000 });
    await win.click('.archive__back-button');
    await win.click('.archive__back-button');
  });

  await test('The NTS map opens from Home; Esc steps out, then closes', async () => {
    await win.evaluate(() => Archive.home());
    await win.click('.map-card', { timeout: 15000 });
    await win.waitForSelector('.ntsmap canvas', { timeout: 15000 });
    // it opens on what's playing if that's on the map, else the whole map; either way the panel fills
    await waitFor(() => /shows|show|ready/i.test(document.querySelector('.ntsmap__panel')?.textContent || ''), null, { timeout: 30000 });
    // Esc steps out a level at a time, then closes
    for (let i = 0; i < 5 && await win.evaluate(() => !!document.querySelector('.ntsmap')); i++) { await win.keyboard.press('Escape'); await win.waitForTimeout(300); }
    await waitFor(() => !document.querySelector('.ntsmap'), null, { timeout: 5000 });
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

  await test('Feeling lucky plays a random archive episode', async () => {
    await win.evaluate(() => Archive.home());
    await win.waitForSelector('.lucky', { timeout: 15000 });
    const before = await win.evaluate(() => ArchivePlayer.state.episode?.episode);
    await win.click('.lucky');
    await waitFor((b) => ArchivePlayer.state.episode && ArchivePlayer.state.episode.episode !== b, before, { timeout: 60000, what: 'a random episode to start' });
    await win.waitForSelector('#archiveContent .detail', { timeout: 30000 });
  });

  await test('Most played on NTS: the chart and the year', async () => {
    // stand-in chart files instead of the published ones (scripts/build-charts.js makes the real ones)
    await app.evaluate(({ ipcMain }) => {
      const file = (period, complete, top) => ({
        period, complete, generated: Date.now(), episodes: 700, shows: 500, plays: 13000, uniqueTracks: 12000,
        showList: ['motive', 'tone', 'guests', 'raisa-k'],
        tracks: top.map(([a, t, e, idx, fams]) => [a, t, e, idx, [0, 'motive-30th-september-2026', 570, Date.now()], Date.UTC(2026, 0, 3), [], fams || []]),
        families: [['jazz', 'jazz', 300], ['housetechno', 'house / techno', 200]],
        busiest: [['guests', 50], ['motive', 9]], showEps: [['guests', 50], ['motive', 9], ['tone', 4], ['raisa-k', 4]],
        debuts: ['raisa-k'], names: { motive: ['Motive', '', 'London'], 'raisa-k': ['Raisa K', '', 'London'] }
      });
      const data = {
        index: { months: ['2026-02', '2026-01'] },
        // genres: See It Thru tops jazz (3 shows there); Sweetie was only played in house / techno
        recent: file('recent', false, [['Kokoroko', 'Sweetie', 3, [0, 1], [[1, 2, 3]]], ['Camille Munn', 'See It Thru', 2, [1, 3], [[0, 3, 3]]], ['Solo', 'One Show Only', 3, [0]],
          ...Array.from({ length: 10 }, (_, i) => ['Filler', `Jazz ${i}`, 2, [0, 1], [[0, 2, 2]]])]),
        '2026-01': file('2026-01', true, [['Kokoroko', 'Sweetie', 3, [0, 1, 3]], ['Camille Munn', 'See It Thru', 2, [1, 3]]]),
        '2026-02': file('2026-02', true, [['Camille Munn', 'See It Thru', 4, [0, 1, 3]], ['Kokoroko', 'Sweetie', 2, [0, 1]]])
      };
      ipcMain.removeHandler('charts:get');
      ipcMain.handle('charts:get', (_e, name) => data[name] || null);
    });
    await win.evaluate(() => { Chart.reset(); Archive.home(); });
    await waitFor(() => document.querySelectorAll('.chart-row').length > 0, null, { timeout: 15000, what: 'the chart on Home' });
    const rows = await win.evaluate(() => [...document.querySelectorAll('.chart-row')].map((r) => r.querySelector('.track__title').textContent + ' / ' + r.querySelector('.chart-row__count').textContent));
    expect(rows[0] === 'Sweetie / 2 shows · 3 episodes' && rows[1].startsWith('See It Thru'), `unexpected chart: ${rows.join(' | ')}`);
    // the year: See It Thru was played by 3 shows across both months, Sweetie by 3 too but fewer episodes
    await win.click('.chart-year');
    // it opens by playing the year: first the choice of music, then scenes one after another
    await waitFor(() => document.querySelector('.yp-gate'), null, { timeout: 10000, what: 'the play screen' });
    await win.evaluate(() => [...document.querySelectorAll('.yp-btn')].find((b) => /without/i.test(b.textContent)).click());
    await waitFor(() => document.querySelector('.yp-scene.yp-intro'), null, { timeout: 5000, what: 'the first scene' });
    await win.keyboard.press('ArrowRight');
    expect(await win.evaluate(() => document.querySelectorAll('.yp-bar.is-done').length === 1), 'the arrow key moves to the next scene');
    await win.keyboard.press('Space');
    expect(await win.evaluate(() => document.querySelector('.yp').classList.contains('is-paused')), 'Space pauses');
    expect(await win.evaluate(() => [...document.querySelectorAll('.yp-title')].some((t) => /Sweetie|See It Thru/.test(t.textContent)) || document.querySelectorAll('.yp-scene').length === 1), 'a scene is showing');
    // then browse the cards
    await win.evaluate(() => [...document.querySelectorAll('.yp-topbtn')].find((b) => b.textContent === 'Cards').click());
    await waitFor(() => !document.querySelector('.yp') && document.querySelector('.year__card'), null, { timeout: 10000, what: 'the year cards' });
    expect(await win.evaluate(() => /NTS in 2026/.test(document.querySelector('.year__kicker').textContent)), 'year intro card');
    await win.keyboard.press('ArrowRight');
    const track = await win.evaluate(() => document.querySelector('.year__track')?.textContent);
    expect(track === 'Sweetie' || track === 'See It Thru', `track of the year: ${track}`);
    // stories: written headlines from the data
    await win.click('.year__mode[data-mode="stories"]');
    await waitFor(() => document.querySelector('.year__story'), null, { timeout: 10000, what: 'a story card' });
    // the timeline: a column per month
    await win.click('.year__mode[data-mode="timeline"]');
    await waitFor(() => document.querySelectorAll('.tl__col').length === 2, null, { timeout: 10000, what: 'the timeline' });
    await win.keyboard.press('Escape');
    expect(await win.evaluate(() => !document.querySelector('.year')), 'Esc closes the year');
    expect(await win.evaluate(() => document.activeElement?.classList.contains('chart-year')), 'focus goes back to the button that opened it');
    // closed on the timeline, it reopens playing (it used to show the timeline under the Cards tab)
    await win.click('.chart-year');
    await waitFor(() => document.querySelector('.yp-gate'), null, { timeout: 10000, what: 'the play screen on reopening' });
    expect(await win.evaluate(() => !document.querySelector('.year').classList.contains('is-timeline')), 'reopens playing, not on the timeline');
    await win.evaluate(() => [...document.querySelectorAll('.yp-topbtn')].find((b) => b.textContent === 'Cards').click());
    await waitFor(() => document.querySelector('.year__card') && !document.querySelector('.yp'), null, { timeout: 10000, what: 'the cards' });
    expect(await win.evaluate(() => document.querySelector('.year__mode.active').dataset.mode === 'cards'), 'on the cards');
    expect(await win.evaluate(() => document.querySelector('.year').contains(document.activeElement)), 'focus moves into the year');
    await win.keyboard.press('ArrowRight');
    expect(await win.evaluate(() => document.querySelector('.year__count').textContent.startsWith('2 /')), 'arrow keys move through the cards');
    await win.keyboard.press('Escape');
    // trends on the chart rows: a line of shows per month
    await waitFor(() => document.querySelectorAll('.chart-row .spark').length > 0, null, { timeout: 10000, what: 'trend lines on the chart' });
    // the full chart, by genre: jazz has enough tracks for a chip, house / techno doesn't
    await win.evaluate(() => [...document.querySelectorAll('.archive__see')].find((b) => b.parentElement.textContent.startsWith('Most played')).click());
    await waitFor(() => document.querySelectorAll('.chart-genre').length > 0, null, { timeout: 10000, what: 'genre chips' });
    const chips = await win.evaluate(() => [...document.querySelectorAll('.chart-genre')].map((b) => b.textContent));
    expect(chips.join(',') === 'All,Jazz', `genre chips: ${chips.join(',')}`);
    await win.evaluate(() => [...document.querySelectorAll('.chart-genre')].find((b) => b.textContent === 'Jazz').click());
    await waitFor(() => document.querySelector('.chart-genre[aria-pressed="true"]')?.textContent === 'Jazz', null, { timeout: 5000, what: 'Jazz selected' });
    const jazz = await win.evaluate(() => [...document.querySelectorAll('.chart-row .track__title')].map((t) => t.textContent));
    expect(jazz[0] === 'See It Thru' && !jazz.includes('Sweetie') && jazz.length === 11, `jazz chart: ${jazz.join(' | ')}`);
    expect(await win.evaluate(() => /3 shows/.test(document.querySelector('.chart-row .chart-row__count').textContent)), 'genre counts only plays under that genre');
    // a whole year in the same dropdown: its months merged, each show counted once
    // (See It Thru: shows 1, 3 in January and 0, 1, 3 in February = 3 shows, 6 episodes)
    await win.waitForFunction(() => [...document.querySelectorAll('.chart-pick option')].some((o) => o.value === '2026'), null, { timeout: 10000 });
    await win.selectOption('.chart-pick', '2026');
    await waitFor(() => /2026 so far|All of 2026/.test(document.querySelector('.chart-box__span')?.textContent || ''), null, { timeout: 10000, what: 'the year chart' });
    const year = await win.evaluate(() => [...document.querySelectorAll('.chart-row')].map((r) => r.querySelector('.track__title').textContent + ' / ' + r.querySelector('.chart-row__count').textContent));
    expect(year[0] === 'See It Thru / 3 shows · 6 episodes' && year[1] === 'Sweetie / 3 shows · 5 episodes', `year chart: ${year.join(' | ')}`);
  });

  await test('Schedule lists upcoming shows', async () => {
    await win.click('#homeBtn');
    await win.click('.archive__see >> text=Schedule');
    await waitFor(() => document.querySelectorAll('.schedule__item').length > 5, null, { timeout: 30000 });
  });

  await test('Search finds tracks, shows and episodes', async () => {
    await win.fill('#archiveSearch', 'floating points');
    await waitFor(() => /Search/.test(document.querySelector('.archive__crumb')?.textContent || '') && document.querySelectorAll('#archiveContent .item').length > 0, null, { timeout: 30000 });
    // tracks first, each once, opening the track page
    await waitFor(() => document.querySelectorAll('#archiveContent .search-tracks .track').length > 0, null, { timeout: 30000, what: 'track results' });
    await win.evaluate(() => document.querySelector('#archiveContent .search-tracks .track .track__text').click());
    await waitFor(() => /Track/.test(document.querySelector('.archive__crumb')?.textContent || '') && document.querySelector('.track-page__head'), null, { timeout: 15000, what: 'the track page' });
    await win.fill('#archiveSearch', '');
  });

  await test('Wide view opens the stage', async () => {
    await win.click('#expandBtn');
    await waitFor(() => window.innerWidth >= 720 && getComputedStyle(document.getElementById('stage')).display !== 'none', null, { timeout: 10000 });
    await win.click('#expandBtn');
  });

  await test('Track web: search a track and expand the web', async () => {
    await win.click('#expandBtn');
    await waitFor(() => window.innerWidth >= 720, null, { what: 'wide view' });
    await win.click('.stage__mode[data-mode="web"]');
    await win.fill('.trackweb__search input', 'kokoroko sweetie');
    await win.waitForSelector('.trackweb__result', { timeout: 30000 });
    await win.locator('.trackweb__result').first().click();
    await waitFor(() => document.querySelectorAll('.tw-node--episode').length > 0, null, { timeout: 40000, what: 'episodes in the web' });
    await win.evaluate(() => document.querySelector('.tw-node--episode').dispatchEvent(new MouseEvent('dblclick', { bubbles: true })));
    await waitFor(() => document.querySelectorAll('.tw-node--track').length > 5, null, { timeout: 40000, what: 'tracks from an episode' });
    await win.click('.stage__mode[data-mode="now"]');
    await win.click('#expandBtn');
  });

  await test('Track web: follow along adds tracks as they play', async () => {
    await win.evaluate(() => Archive.playFrom('motive', 'motive-30th-september-2026', 570));
    await waitFor(() => ArchivePlayer.state.playing && ArchivePlayer.state.position > 560000, null, { timeout: 60000, what: 'the episode to play' });
    await win.click('#expandBtn');
    await waitFor(() => window.innerWidth >= 720, null, { what: 'wide view' });
    await win.click('.stage__mode[data-mode="web"]');
    await win.evaluate(() => { const b = document.querySelector('.trackweb__follow'); if (!/Following/.test(b.textContent)) b.click(); });
    await waitFor(() => document.querySelectorAll('.tw-node--track').length >= 3 && document.querySelector('.tw-node.is-playing'), null, { timeout: 30000, what: 'the tracks heard so far, one playing' });
    const before = await win.evaluate(() => document.querySelectorAll('.tw-node--track').length);
    await win.click('#nextTrack');
    await waitFor((n) => document.querySelectorAll('.tw-node--track').length > n, before, { timeout: 30000, what: 'the next track to pop in' });
    // the timeline view: tracks along the episode, with a playhead
    await win.click('.trackweb__layout-btn[data-layout="timeline"]');
    await waitFor(() => document.querySelector('.trackweb__svg.is-timeline') && document.querySelector('.tw-playhead') && document.querySelectorAll('.tw-stem').length > 2, null, { timeout: 10000, what: 'the timeline' });
    expect(await win.evaluate(() => document.querySelectorAll('.tw-ahead').length > 0), 'tracks still to come should show on the timeline');
    // click a track: other episodes that played it line up above (when NTS has their times)
    await win.evaluate(() => [...document.querySelectorAll('.tw-node--track')].find((n) => /Sweetie/.test(n.textContent))?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    await waitFor(() => document.querySelector('.trackweb__lanes-note') && !/Finding|Lining up/.test(document.querySelector('.trackweb__lanes-note').textContent), null, { timeout: 40000, what: 'other episodes lined up' });
    expect(await win.evaluate(() => [...document.querySelectorAll('.tw-lane__title')].every((t) => /opened with it|closed with it|% in/.test(t.textContent))), 'each set should say where the track fell');
    await win.click('.trackweb__layout-btn[data-layout="web"]');
    expect(await win.evaluate(() => !document.querySelector('.tw-lane')), 'lanes should go with the timeline');
    await win.click('.trackweb__follow');
    await win.click('.stage__mode[data-mode="now"]');
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
  // the app may still be writing its profile as it exits: retry, and never fail the run over it
  try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 }); } catch {}
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch(async (e) => {
  console.error('Test run crashed:', e.message);
  try { await app?.evaluate(({ app }) => app.exit(1)); } catch {}
  process.exit(1);
});
