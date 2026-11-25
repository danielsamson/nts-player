// Daily check that nts.live still looks the way the app expects.
// Run with Electron (no extra browser needed):
//   xvfb-run -a npx electron tests/nts-site-check.js --no-sandbox
// Prints a report and exits 1 if anything the app relies on has changed.

const { app, BrowserWindow, net } = require('electron');

const SITE = 'https://www.nts.live';
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); };

const getJson = async (path) => (await net.fetch(SITE + path, { headers: { Accept: 'application/json' } })).json();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function inPage(url, code, { wait = 15000 } = {}) {
  const w = new BrowserWindow({ show: false, webPreferences: { partition: 'nts-check', offscreen: true } });
  try {
    await w.loadURL(url).catch(() => {});
    const end = Date.now() + wait;
    let r = null;
    while (Date.now() < end) {
      r = await w.webContents.executeJavaScript(code, true).catch(() => null);
      if (r && r.ready) break;
      await sleep(500);
    }
    return { ...(r || {}), finalUrl: w.webContents.getURL() };
  } finally { w.destroy(); }
}

async function run() {
  // ---- Public API ----
  const live = await getJson('/api/v2/live').catch(() => null);
  const d = live?.results?.[0]?.now?.embeds?.details;
  check('API: live channels', live?.results?.length >= 2 && d?.show_alias && d?.episode_alias, 'results[].now.embeds.details.{show_alias,episode_alias}');

  const sched = await getJson('/api/v2/radio/schedule/1').catch(() => null);
  check('API: schedule', sched?.results?.[0]?.broadcasts?.length > 0, 'results[].broadcasts[]');

  const tl = await getJson('/api/v2/shows/motive/episodes/motive-30th-september-2026/tracklist').catch(() => null);
  const t0 = tl?.results?.[0];
  check('API: tracklists', t0 && 'artist' in t0 && 'title' in t0 && ('offset' in t0 || 'offset_estimate' in t0) && 'deezer_track_id' in t0, 'artist, title, offset, deezer_track_id');

  const ep = await getJson('/api/v2/shows/motive/episodes/motive-30th-september-2026').catch(() => null);
  check('API: episode audio (SoundCloud)', (ep?.audio_sources || []).some((a) => a.source === 'soundcloud'), 'audio_sources[].source = soundcloud');

  const tracks = await getJson('/api/v2/search?q=kokoroko%20sweetie&version=2&offset=0&limit=5&types[]=track').catch(() => null);
  check('API: track search', (tracks?.results || []).some((x) => x.article_type === 'track' && x.article?.path), 'results[].article.path');

  const genres = await getJson('/api/v2/genres').catch(() => null);
  const moods = await getJson('/api/v2/moods').catch(() => null);
  const explore = await getJson('/api/v2/search/episodes?moods[]=sedative&offset=0&limit=1').catch(() => null);
  check('API: genres, moods, explore', genres?.results?.length && moods?.results?.length && explore?.results?.length, '/genres, /moods, /search/episodes');

  // ---- Episode page (Save episode, Follow, Save track buttons) ----
  const epPage = await inPage(`${SITE}/shows/motive/episodes/motive-30th-september-2026`, `(() => {
    const root = document.querySelector('#episode-container');
    if (!root || !(window.NTS && typeof window.NTS.isAuthenticated === 'boolean')) return null;
    return {
      ready: !!root.querySelector('.track'),
      save: !!root.querySelector('.bio__header button[title*="Episode" i], .bio__header button[aria-label*="Episode" i]'),
      follow: !!(root.querySelector('.bio__footer .follow-button') || root.querySelector('.follow-button')),
      tracks: root.querySelectorAll('.track .track__title').length,
      trackArtists: root.querySelectorAll('.track .track__artist:not(.track__artist--mobile)').length,
      saveTrack: root.querySelectorAll('.save-track-button').length
    };
  })()`);
  check('Episode page: sign-in state (window.NTS.isAuthenticated)', epPage.ready !== undefined, 'boolean on window.NTS');
  check('Episode page: Save episode button', epPage.save, '.bio__header button[title*=Episode]');
  check('Episode page: Follow button', epPage.follow, '.follow-button');
  check('Episode page: tracklist rows', epPage.tracks > 5 && epPage.trackArtists > 5, '.track .track__title / .track__artist');
  check('Episode page: Save track buttons', epPage.saveTrack > 5, '.save-track-button');

  // ---- Live tracklist page (signed out shows the Supporter promo) ----
  // Signed out it shows a Supporter promo; give it time (it loads after the page)
  const lt = await inPage(`${SITE}/live-tracklist/1`, `(() => {
    const page = !!document.querySelector('.page-live-tracks');
    const promo = !!document.querySelector('.page-live-tracks__promo');
    const list = !!document.querySelector('.page-live-tracks__list');
    return { page, promo, list, ready: page && (promo || list) };
  })()`, { wait: 45000 });
  check('Live tracklist page', lt.page && (lt.promo || lt.list), '.page-live-tracks with its promo (signed out) or list');

  // ---- My NTS pages need sign-in ----
  for (const path of ['/my-nts/favourites/episodes', '/my-nts/favourites/shows', '/my-nts/tracks']) {
    const r = await inPage(SITE + path, `(() => ({ ready: /sign-in/.test(location.pathname) }))()`);
    check(`My NTS ${path} redirects to sign-in`, /\/sign-in/.test(r.finalUrl), r.finalUrl);
  }

  // ---- Signed-in markup the app reads, checked in NTS's site code ----
  const home = await (await net.fetch(SITE + '/')).text();
  const bundle = (/src="(\/js\/app\.min\.[^"]+\.js)"/.exec(home) || [])[1];
  const js = bundle ? await (await net.fetch(SITE + bundle)).text() : '';
  for (const cls of ['live-track__artist-title', 'live-track__song-title', 'live-track__timestamp', 'page-live-tracks__list',
    'my-track', 'article-list-item__content__top__title', 'save-track-button--saved', 'follow-button--favourited', '/favourites/episodes']) {
    check(`Site code still has "${cls}"`, js.includes(cls), bundle || 'app bundle not found');
  }
}

app.on('window-all-closed', () => {});   // keep running between page checks

app.whenReady().then(async () => {
  try { await run(); } catch (e) { check('Check ran', false, e.message); }
  const failed = results.filter((r) => !r.ok);
  for (const r of results) console.log(`${r.ok ? 'ok  ' : 'FAIL'}  ${r.name}${r.ok ? '' : `  (${r.detail})`}`);
  console.log(`\n${results.length - failed.length} ok, ${failed.length} failed`);
  require('fs').writeFileSync(process.env.NTS_CHECK_REPORT || 'nts-check-report.txt',
    failed.map((r) => `- ${r.name} (expected: ${r.detail})`).join('\n'));
  app.exit(failed.length ? 1 : 0);
});
