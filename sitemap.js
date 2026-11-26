// Which NTS episodes were broadcast between two dates, from nts.live's sitemap (the list
// of pages it publishes for search engines). NTS's API has no date search and its
// "recently added" list stops after about 12 days; the sitemap lists every episode.
// sitemap1 holds the newest ~48,000 episodes (back to early 2021), sitemap2 the rest.
const { net } = require('electron');
const zlib = require('zlib');

const BASE = 'https://www.nts.live';
const MAX_AGE = 6 * 3600e3;
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const cache = new Map();      // sitemap url -> { at, episodes: [{ show, episode, d }] }

async function fetchGz(url) {
  const res = await net.fetch(url);
  if (!res.ok) throw new Error(`Sitemap ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  return (buf[0] === 0x1f && buf[1] === 0x8b ? zlib.gunzipSync(buf) : buf).toString('utf8');
}

// The broadcast date from an episode's name ("...-25th-november-2026"), else its lastmod
function dateOf(episode, lastmod) {
  const m = /(\d{1,2})(?:st|nd|rd|th)?-(january|february|march|april|may|june|july|august|september|october|november|december)-(\d{4})/.exec(episode);
  if (m) return Date.UTC(+m[3], MONTHS.indexOf(m[2]), +m[1], 12);
  return Date.parse(lastmod) || 0;
}

async function load(url) {
  const c = cache.get(url);
  if (c && Date.now() - c.at < MAX_AGE) return c.episodes;
  const xml = await fetchGz(url);
  const episodes = [];
  const re = /<loc>https:\/\/www\.nts\.live\/shows\/([^/<]+)\/episodes\/([^/<]+)<\/loc>(?:<lastmod>([^<]+)<\/lastmod>)?/g;
  for (let m; (m = re.exec(xml));) episodes.push({ show: m[1], episode: m[2], d: dateOf(m[2], m[3]) });
  cache.set(url, { at: Date.now(), episodes });
  return episodes;
}

async function files() {
  const index = await fetchGz(`${BASE}/sitemap.xml.gz`);
  return [...index.matchAll(/<loc>(https:\/\/www\.nts\.live\/sitemap\d+\.xml\.gz)<\/loc>/g)].map((m) => m[1]);
}

// Episodes broadcast from `from` up to (not including) `to`, both in ms
async function episodesBetween(from, to) {
  const out = [];
  for (const url of await files()) {
    const eps = await load(url);
    out.push(...eps.filter((e) => e.d >= from && e.d < to));
    // files go newest to oldest: stop once this one already reaches back past `from`
    if (eps.length && Math.min(...eps.slice(-200).map((e) => e.d || Infinity)) < from) break;
  }
  const seen = new Set();
  return out.filter((e) => { const k = `${e.show}/${e.episode}`; if (seen.has(k)) return false; seen.add(k); return true; });
}

module.exports = { episodesBetween };
