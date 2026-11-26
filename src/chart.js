// Most played on NTS: a chart worked out from tracklists (NTS doesn't publish one).
// The episodes broadcast in a period come from nts.live's sitemap (main process); the app
// reads their tracklists, counts each track once per episode, and ranks tracks by how
// many different shows played them (so a show's theme tune doesn't top it).
// Periods: 'recent' (the last 30 days, refreshed in the background) or a month 'YYYY-MM'.
// Past months don't change, so each is worked out once and kept.

const Chart = (() => {
  const RECENT = 'chart:v2';            // the last 30 days: tracklists, kept to update cheaply
  const MONTH = (m) => `chart:month:${m}`;
  const DAYS = 30;
  const REFRESH = 6 * 3600e3;
  const n = (x) => String(x || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  // placeholder entries in tracklists, not real tracks
  const JUNK = new Set(['id', 'unknown', 'untitled', 'tba', 'tbc', 'track id', 'unreleased', 'n a', 'na', 'various', 'various artists', 'unknown artist']);
  const read = (k, dflt) => { try { return JSON.parse(localStorage.getItem(k)) || dflt; } catch { return dflt; } };
  const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
  const showName = (alias) => alias.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

  let recent = read(RECENT, { eps: {}, at: 0 });
  const listeners = new Set();
  const progress = {};                    // period -> { done, total }
  const emit = (period) => listeners.forEach((fn) => fn(period, progress[period] || null));

  // Read the tracklists of some episodes (four at a time), reporting progress
  async function readTracklists(period, refs, into) {
    progress[period] = { done: 0, total: refs.length };
    emit(period);
    let next = 0;
    await Promise.all(Array.from({ length: 4 }, async () => {
      while (next < refs.length) {
        const r = refs[next++];
        const tl = await window.nts.api(`/api/v2/shows/${r.show}/episodes/${r.episode}/tracklist`).catch(() => null);
        if (tl) into[`${r.show}/${r.episode}`] = { d: r.d, s: r.show, e: r.episode, tr: (tl.results || []).filter((x) => x.title).map((x) => [x.artist || '', x.title, x.offset ?? x.offset_estimate ?? null]) };
        progress[period].done++;
        if (progress[period].done % 10 === 0) emit(period);
      }
    }));
    delete progress[period];
    emit(period);
  }

  // Rank the tracks in a set of episodes
  function rank(eps, limit = 100) {
    const map = new Map();
    for (const ep of eps) {
      const seen = new Set();
      for (const [artist, title, offset] of ep.tr) {
        const a = n(artist), t = n(title);
        if (!a || !t || JUNK.has(a) || JUNK.has(t)) continue;
        const k = `${a}|${t}`;
        if (seen.has(k)) continue;                 // once per episode
        seen.add(k);
        let m = map.get(k);
        if (!m) { m = { artist, title, episodes: 0, showSet: new Set(), latest: null }; map.set(k, m); }
        m.episodes++;
        m.showSet.add(ep.s);
        if (!m.latest || ep.d > m.latest.d) m.latest = { d: ep.d, show: ep.s, episode: ep.e, title: showName(ep.s), offset };
      }
    }
    return [...map.values()].map(({ showSet, ...m }) => ({ ...m, shows: showSet.size }))
      .filter((m) => m.episodes >= 2)
      .sort((a, b) => b.shows - a.shows || b.episodes - a.episodes || b.latest.d - a.latest.d)
      .slice(0, limit);
  }

  // ---- the last 30 days ----
  async function refreshRecent() {
    const to = Date.now() + 864e5, from = Date.now() - DAYS * 864e5;
    const refs = await window.nts.episodesBetween(from, to);
    const keep = new Set(refs.map((r) => `${r.show}/${r.episode}`));
    for (const k of Object.keys(recent.eps)) if (!keep.has(k)) delete recent.eps[k];
    await readTracklists('recent', refs.filter((r) => !recent.eps[`${r.show}/${r.episode}`]), recent.eps);
    recent.at = Date.now();
    write(RECENT, recent);
  }
  const recentResult = () => {
    const eps = Object.values(recent.eps);
    return eps.length ? { rows: rank(eps), episodes: eps.length, days: DAYS } : null;
  };

  // ---- a month ----
  async function buildMonth(m) {
    const [y, mo] = m.split('-').map(Number);
    const from = Date.UTC(y, mo - 1, 1), to = Date.UTC(y, mo, 1);
    const refs = await window.nts.episodesBetween(from, to);
    const eps = {};
    // reuse tracklists we already have from the last 30 days
    refs.forEach((r) => { const k = `${r.show}/${r.episode}`; if (recent.eps[k]) eps[k] = recent.eps[k]; });
    await readTracklists(m, refs.filter((r) => !eps[`${r.show}/${r.episode}`]), eps);
    const list = Object.values(eps);
    const res = { rows: rank(list), episodes: list.length, at: Date.now(), complete: to < Date.now() };
    write(MONTH(m), res);
    return res;
  }

  const building = {};
  // The chart for a period: cached if fresh, otherwise worked out (progress via onProgress)
  function get(period) {
    if (building[period]) return building[period];
    const cached = peek(period);
    const fresh = period === 'recent' ? cached && Date.now() - recent.at < REFRESH
      : cached && (cached.complete || Date.now() - cached.at < REFRESH);
    if (fresh) return Promise.resolve(cached);
    building[period] = (period === 'recent' ? refreshRecent().then(recentResult) : buildMonth(period))
      .catch(() => peek(period)).finally(() => { delete building[period]; });
    return building[period];
  }
  // What we have for a period right now (or null)
  function peek(period) { return period === 'recent' ? recentResult() : read(MONTH(period), null); }

  // Months you can pick: newest first, back to 2015
  function months() {
    const out = [];
    const now = new Date();
    for (let i = 0; ; i++) {
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
      if (d.getUTCFullYear() < 2015) break;
      out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
    }
    return out;
  }

  return {
    get, peek, months,
    progress: (period) => progress[period] || null,
    onProgress: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
    reload() { recent = read(RECENT, { eps: {}, at: 0 }); }      // tests
  };
})();
