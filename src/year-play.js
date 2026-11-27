// NTS in <year>, played: full-window scenes one after another, like a story. Big type, the
// covers filling the screen, numbers counting up; progress bars along the top. Click the
// right of the screen (or →) for the next scene, the left (or ←) for the one before; Space or
// holding the mouse down pauses. With music on, each scene's track plays from where an
// episode played it.
// Uses Chart.year's summary (passed in), Art (covers), Archive.playFrom, d3.

const YearPlay = (() => {
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const fmt = (x) => Number(x).toLocaleString();
  const monthShort = (m) => new Date(Date.UTC(+m.slice(0, 4), +m.slice(5) - 1, 15)).toLocaleDateString(undefined, { month: 'short', timeZone: 'UTC' });
  const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  let root = null, scenes = [], at = 0, paused = false, music = false, playingKey = null, opts = {};
  // NTS's own mood footage (the stills on its Explore page), for the scenes without a cover
  const moods = {};
  let moodsP = null;
  const loadMoods = () => (moodsP ||= window.nts.api('/api/v2/moods').then((r) => (r.results || []).forEach((m) => { moods[m.id] = m.image?.medium_large || m.image?.large || ''; })).catch(() => { moodsP = null; }));
  // colour casts like NTS's moods: blue, magenta, red, yellow, cyan, orange
  const TINTS = ['#4b3cff', '#d42bd8', '#00b8c4', '#e3c000', '#2fbf71', '#7a4dff'];   // (no red: NTS keeps red for live)

  // a cover image that fills its box once found
  function coverImg(t, cls = 'yp-cover') {
    const wrap = el('div', cls);
    const img = el('img'); img.alt = '';
    Art.get({ artist: t.artist, title: t.title }, 'high').then((a) => {
      const src = a?.large || a?.small;
      if (src) { img.src = src; wrap.classList.add('has-img'); }
    }).catch(() => {});
    wrap.append(img);
    return wrap;
  }
  // the scene's backdrop, treated like a tape still: the cover (or NTS mood footage) full-bleed,
  // a colour cast, a ghost of itself slightly off to the side, drifting slowly
  // (extra: something else to show on the tape, like the wall of covers)
  function backdrop(t, mood, extra) {
    const b = el('div', 'yp-bg');
    const src = mood && moods[mood];
    const layer = (cls) => {
      if (src) { const w = el('div', `${cls} has-img`); const im = el('img'); im.alt = ''; im.src = src; w.append(im); return w; }
      return t ? coverImg(t, cls) : el('div', cls);
    };
    b.append(layer('yp-bg__img'), layer('yp-bg__img yp-bg__ghost'));
    if (extra) b.append(extra);
    // torn slices for the corrupted moments: copies of the picture, a band each, shoved sideways
    if (src || t) for (let i = 0; i < 3; i++) b.append(layer('yp-bg__img yp-bg__slice'));
    b.append(el('div', 'yp-bg__tint'), el('div', 'yp-bg__grain'), el('div', 'yp-bg__scan'), el('div', 'yp-bg__band'));
    return b;
  }
  // now and then the tape corrupts: slices jump, colours bleed, the noise flares
  function corrupt(bg, strong = false) {
    if (!bg?.isConnected || reduced()) return;
    bg.querySelectorAll('.yp-bg__slice').forEach((sl) => {
      const top = Math.random() * 85, h = 3 + Math.random() * (strong ? 22 : 12);
      sl.style.setProperty('--t', `${top}%`);
      sl.style.setProperty('--b', `${Math.max(0, 100 - top - h)}%`);
      sl.style.setProperty('--dx', `${(Math.random() - 0.5) * (strong ? 22 : 12)}%`);
    });
    bg.style.setProperty('--hue', `${Math.round((Math.random() - 0.5) * 160)}deg`);
    bg.classList.add('is-corrupt');
    setTimeout(() => bg.classList.remove('is-corrupt'), strong ? 420 : 90 + Math.random() * 260);
  }
  // caption text gets its own inline layer, so each line's black block hugs its words (ragged,
  // like nts.live) instead of the block filling the column
  function inkLines(root) {
    root.querySelectorAll('.yp-kicker, .yp-head, .yp-title, .yp-year--outro, .yp-sub, .yp-artist').forEach((e) => {
      if (e.querySelector(':scope > .yp-ink')) return;
      const ink = el('span', 'yp-ink');
      ink.append(...e.childNodes);
      e.append(ink);
    });
  }
  // text that rises in, after `d` seconds
  const rise = (node, d = 0) => { node.classList.add('yp-rise'); node.style.setProperty('--d', `${d}s`); return node; };
  // a number counting up to its value
  function counter(value, { d = 0, prefix = '', from = 0, ms = 1400 } = {}) {
    const n = el('span', 'yp-count', prefix + fmt(reduced() ? value : from));
    if (reduced()) return n;
    setTimeout(() => {
      const t0 = performance.now();
      const step = (now) => {
        if (!n.isConnected) return;
        const p = Math.min(1, (now - t0) / ms), e = 1 - Math.pow(1 - p, 3);
        n.textContent = prefix + fmt(Math.round(from + (value - from) * e));
        if (p < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    }, d * 1000);
    return n;
  }
  const story = (s, id) => (s.stories || []).find((x) => x.id === id);
  const playable = (t) => t?.latest && Number.isFinite(t.latest.offset);

  // ---- poster type ----
  // Split a title into up to n lines of similar length (by characters)
  function splitLines(text, n) {
    const words = String(text).split(/\s+/).filter(Boolean);
    if (words.length <= 1 || n <= 1) return [words.join(' ')];
    n = Math.min(n, words.length);
    const total = words.join(' ').length, target = total / n;
    const out = [];
    let line = [];
    words.forEach((w, i) => {
      const cur = line.join(' ').length;
      if (line.length && out.length < n - 1 && cur + w.length / 2 > target) { out.push(line.join(' ')); line = []; }
      line.push(w);
    });
    out.push(line.join(' '));
    return out;
  }
  // Lines of type sized to fill their box's width, each sliding up out of a mask in turn.
  // lines: strings, or [text, 'outline'] for an outlined line. max: the tallest a line may get
  // (as a share of the window height), so a short word doesn't fill the whole screen.
  function poster(lines, { d = 0, step = 0.14, max = 0.34, cls = '' } = {}) {
    const box = el('div', `yp-poster ${cls}`);
    box.dataset.max = max;
    lines.forEach((ln, i) => {
      const [text, style] = Array.isArray(ln) ? ln : [ln];
      const mask = el('span', `yp-poster__line${style ? ' is-' + style : ''}`);
      const inner = el('span', 'yp-poster__inner', text);
      inner.style.setProperty('--d', `${d + i * step}s`);
      mask.append(inner);
      box.append(mask);
    });
    return box;
  }
  // size each poster line to the box width (after it's in the page)
  function fitPosters(scope) {
    scope.querySelectorAll('.yp-poster').forEach((box) => {
      const W = box.clientWidth;
      if (!W) return;
      const cap = Number(box.dataset.max || 0.34) * window.innerHeight;
      box.querySelectorAll('.yp-poster__line').forEach((line) => {
        line.style.fontSize = '100px';
        const w = line.querySelector('.yp-poster__inner').getBoundingClientRect().width || 1;
        line.style.fontSize = `${Math.min(cap, (100 * W) / w)}px`;
      });
    });
  }
  // a numeral so big it runs off the edge of the screen, behind everything
  function giant(content, cls = '') {
    const g = el('div', `yp-giant-bg ${cls}`);
    if (typeof content === 'string') g.textContent = content; else g.append(content);
    return g;
  }
  // a line of tape type (the VHS screen font): labels, counts, dates
  const tape = (text, cls = '') => el('p', `yp-tape ${cls}`, text);

  // ---- the scenes: each { dur (s), track (to play with music), build() -> element } ----
  function build(s) {
    const out = [];
    const year = s.year;
    const top = s.top || [];

    // 1. intro: the year's covers drifting by on the tape; the year in tracks, filling the frame
    out.push({ dur: 7, cls: 'yp-intro', build() {
      const wall = el('div', 'yp-wall');
      const pool = [...(s.numberOnes || []), ...top.slice(0, 24)];
      for (let r = 0; r < 4; r++) {
        const row = el('div', 'yp-wall__row');
        for (let i = 0; i < 16; i++) row.append(coverImg(pool[(r * 7 + i) % pool.length] || top[0], 'yp-wall__cover'));
        wall.append(row);
      }
      const box = el('div', 'yp-frame');
      box.append(rise(tape(`▶ NTS ${year}`, 'yp-label'), 0), poster([['The year', 'outline'], 'in tracks'], { d: 0.2, max: 0.3 }));
      const nums = el('div', 'yp-tapenums');
      [[s.episodes, 'episodes'], [s.shows, 'shows'], [s.plays, 'tracks played']].forEach(([v, l], i) => {
        const d = el('div', 'yp-tapenum'); d.append(counter(v, { d: 1 + i * 0.3 }), el('span', null, l)); nums.append(rise(d, 0.9 + i * 0.3));
      });
      box.append(nums);
      return [backdrop(null, null, wall), box];
    } });

    // 2. how rarely NTS repeats itself: 98 as giant type behind 100 squares
    const rep = story(s, 'repeats');
    if (rep) out.push({ dur: 8, build() {
      const once = rep.viz.value;
      const box = el('div', 'yp-frame yp-frame--center');
      box.append(rise(tape('Of every 100 tracks played', 'yp-label'), 0));
      const g = el('div', 'yp-waffle yp-panel');
      for (let i = 0; i < 100; i++) { const c = el('span', i >= once ? 'is-again' : ''); c.style.setProperty('--d', `${0.4 + i * 0.018}s`); g.append(c); }
      box.append(g, poster([`${once} played once.`], { d: 2.3, max: 0.16, cls: 'yp-poster--center' }),
        rise(tape(`Only ${100 - once} came back, on any show.`, 'yp-tape--sub'), 2.9));
      return [backdrop(null, 'don-t-assume'), giant(String(once), 'is-outline yp-giant-bg--center'), box];
    } });

    // 3. the countdown, 5 to 2: the number runs off the edge, the title stacks beside the cover
    top.slice(1, 5).reverse().forEach((t, i) => {
      const rank = 5 - i;
      out.push({ dur: 3.8, cls: 'yp-countdown', build() {     // no music change: four tracks in a few seconds would just stutter
        const box = el('div', 'yp-frame yp-frame--right');
        const row = el('div', 'yp-split');
        row.append(rise(coverImg(t, 'yp-cover yp-cover--split'), 0.1));
        const tx = el('div', 'yp-splittext');
        tx.append(poster(splitLines(t.title, t.title.length > 14 ? 3 : 2), { d: 0.25, max: 0.2 }),
          rise(tape(`${t.artist}`, 'yp-tape--sub'), 0.6), rise(tape(`${fmt(t.shows)} shows`, 'yp-tape--sub'), 0.7));
        row.append(tx);
        box.append(row);
        return [backdrop(t), giant(String(rank), 'yp-giant-bg--left'), box];
      } });
    });

    // 4. track of the year: the title across the whole frame, over the cover
    const t1 = top[0];
    if (t1) out.push({ dur: 11, track: t1, cls: 'yp-hero', build() {
      const box = el('div', 'yp-frame yp-frame--bottom');
      box.append(rise(coverImg(t1, 'yp-cover yp-cover--hero'), 0.3), rise(tape('Track of the year', 'yp-label'), 0.6),
        poster(splitLines(t1.title, t1.title.length > 12 ? 2 : 1), { d: 0.9, max: 0.3 }));
      const n = tape('', 'yp-tape--sub'); n.append(`${t1.artist} · played by `, counter(t1.shows, { d: 1.6, ms: 1200 }), ' shows');
      box.append(rise(n, 1.4));
      return [backdrop(t1), el('div', 'yp-side', `Track of the year · ${year} · Track of the year · ${year}`), box];
    } });

    // 5. artist of the year: the name, as big as it goes
    const a1 = s.topArtists?.[0];
    if (a1) out.push({ dur: 8, track: a1.top, build() {
      const runs = el('div', 'yp-marquee');
      for (let r = 0; r < 6; r++) { const row = el('div', `yp-marquee__row${r % 2 ? ' is-back' : ''}`); row.textContent = `${a1.artist} · `.repeat(8); runs.append(row); }
      const box = el('div', 'yp-frame yp-frame--bottom');
      const parts = splitLines(a1.artist, a1.artist.length > 10 ? 2 : 1);
      box.append(rise(tape('Artist of the year', 'yp-label'), 0.1), poster(parts.map((p, i) => (i % 2 ? [p, 'outline'] : p)), { d: 0.3, max: 0.32 }));
      const n = tape('', 'yp-tape--sub'); n.append('Played by ', counter(a1.shows, { d: 0.9 }), ` shows · ${a1.tracks} different tracks`);
      box.append(rise(n, 0.9));
      return [backdrop(a1.top, null, runs), box];
    } });

    // 6. number one, month by month
    if ((s.numberOnes || []).length > 2) out.push({ dur: 9, build() {
      const box = el('div', 'yp-frame yp-frame--center');
      box.append(poster([['Number one', 'outline'], 'month by month'], { d: 0, max: 0.13, cls: 'yp-poster--center yp-poster--narrow' }));
      const g = el('div', 'yp-ones yp-panel');
      s.numberOnes.forEach((t, i) => {
        const c = el('div', 'yp-one');
        c.append(coverImg(t, 'yp-cover'), el('span', 'yp-one__month', monthShort(t.month)), el('span', 'yp-one__title', t.title), el('span', 'yp-one__artist', t.artist));
        c.title = `${t.artist} – ${t.title}`;
        g.append(rise(c, 0.5 + i * 0.3));
      });
      box.append(g);
      return [backdrop(null, 'music-to-dance-to'), box];
    } });

    // 7. the biggest leap: the rank counting down, huge, off the edge
    const leap = story(s, 'leap');
    if (leap) out.push({ dur: 8, track: leap.viz.t, build() {
      const t = leap.viz.t;
      const num = el('span'); num.append(counter(leap.viz.to, { from: leap.viz.from, prefix: '#', d: 0.6, ms: 2200 }));
      const box = el('div', 'yp-frame yp-frame--right');
      box.append(rise(tape('The biggest leap', 'yp-label'), 0), poster(splitLines(t.title, 2), { d: 2.3, max: 0.16 }),
        rise(tape(`${t.artist} · #${leap.viz.from} → #${leap.viz.to} in a month`, 'yp-tape--sub'), 2.7));
      return [backdrop(t), giant(num, 'is-outline yp-giant-bg--left'), box];
    } });

    // 8. who heard it first: the show's name across the frame, the shows after it along the year
    const first = story(s, 'first');
    if (first) out.push({ dur: 9, track: first.viz.t, build() {
      const v = first.viz;
      const box = el('div', 'yp-frame yp-frame--bottom');
      box.append(rise(tape('Who heard it first', 'yp-label'), 0), poster(splitLines(v.firsts[0].show, 2), { d: 0.2, max: 0.24 }),
        rise(tape(`played ${v.t.title} (${v.t.artist}) before anyone else`, 'yp-tape--sub'), 0.7));
      const line = el('div', 'yp-strip yp-panel');
      const y0 = Date.UTC(v.year, 0, 1), y1 = Date.UTC(v.year + 1, 0, 1);
      v.firsts.forEach((f, i) => {
        const dot = el('span', i === 0 ? 'yp-strip__dot is-first' : 'yp-strip__dot');
        dot.style.left = `${((f.d - y0) / (y1 - y0)) * 100}%`;
        dot.style.setProperty('--d', `${1.1 + i * 0.12}s`);
        dot.title = f.show;
        line.append(dot);
      });
      box.append(rise(line, 1), rise(tape(`then ${v.firsts.length - 1} more shows`, 'yp-tape--sub'), 1.3 + v.firsts.length * 0.12));
      return [backdrop(v.t, 'audio-research'), box];
    } });

    // 9. rising: new in the last three months
    if ((s.breakouts || []).length >= 3) out.push({ dur: 8, track: s.breakouts[0], build() {
      const since = new Date(s.breakouts.since).toLocaleDateString(undefined, { month: 'long', timeZone: 'UTC' });
      const box = el('div', 'yp-frame yp-frame--center');
      box.append(poster([['New since', 'outline'], since], { d: 0, max: 0.15, cls: 'yp-poster--center yp-poster--narrow' }));
      const list = el('div', 'yp-list yp-panel');
      s.breakouts.forEach((t, i) => {
        const r = el('div', 'yp-list__row');
        const tx = el('div', 'yp-rowtext'); tx.append(el('span', 'yp-list__title', t.title), el('span', 'yp-list__artist', `${t.artist} · ${t.shows} shows`));
        r.append(el('span', 'yp-list__rank', String(i + 1)), coverImg(t, 'yp-cover yp-cover--row'), tx);
        list.append(rise(r, 0.6 + i * 0.25));
      });
      box.append(list);
      return [backdrop(s.breakouts[0]), box];
    } });

    // 10. the long runner: 11 / 11, a month at a time lighting up
    const lr = s.evergreen?.[0];
    if (lr) out.push({ dur: 8, track: lr, build() {
      const box = el('div', 'yp-frame yp-frame--right');
      box.append(rise(tape('The long runner', 'yp-label'), 0), poster(splitLines(lr.title, lr.title.length > 14 ? 3 : 2), { d: 0.2, max: 0.18 }),
        rise(tape(lr.artist, 'yp-tape--sub'), 0.6));
      const months = el('div', 'yp-months yp-panel');
      (s.monthList || []).forEach((m, i) => {
        const c = el('span', (lr.perMonth?.[m] || 0) > 0 ? 'is-on' : '', monthShort(m).slice(0, 1));
        c.style.setProperty('--d', `${0.9 + i * 0.14}s`);
        months.append(c);
      });
      box.append(rise(months, 0.8), rise(tape(`Played in ${lr.months} of ${s.months} months. Most tracks on NTS last a few weeks.`, 'yp-tape--sub'), 1.2 + (s.monthList || []).length * 0.14));
      return [backdrop(lr), giant(`${lr.months}/${s.months}`, 'is-outline yp-giant-bg--left'), box];
    } });

    // 11. the sound of the year: the top genres by share of the year's episodes, and which way
    // each went (the last three months against the first three)
    const gen = story(s, 'genres');
    if (gen) out.push({ dur: 9, build() {
      const v = gen.viz;
      const avg = (rows, k) => rows.reduce((a, r) => a + (r[k] || 0), 0) / Math.max(1, rows.length);
      const n3 = Math.min(3, Math.floor(v.rows.length / 2));
      const list = v.keys.map((k) => ({ k, share: avg(v.rows, k), move: avg(v.rows.slice(-n3), k) - avg(v.rows.slice(0, n3), k) }))
        .sort((a, b) => b.share - a.share).slice(0, 6);
      const max = list[0]?.share || 1;
      const box = el('div', 'yp-frame yp-frame--center');
      box.append(poster([['The sound', 'outline'], 'of the year'], { d: 0, max: 0.13, cls: 'yp-poster--center yp-poster--narrow' }));
      const chart = el('div', 'yp-genres yp-panel');
      list.forEach((g, i) => {
        const row = el('div', 'yp-genre');
        const bar = el('span', 'yp-genre__bar');
        bar.style.setProperty('--w', `${(g.share / max) * 100}%`);
        bar.style.setProperty('--d', `${0.7 + i * 0.25}s`);
        const mv = Math.abs(g.move) >= 0.01 ? (g.move > 0 ? '▲' : '▼') : '–';
        const tag = el('span', `yp-genre__move${g.move >= 0.01 ? ' is-up' : g.move <= -0.01 ? ' is-down' : ''}`, mv);
        tag.title = g.move >= 0.01 ? 'More of it as the year went on' : g.move <= -0.01 ? 'Less of it as the year went on' : 'Steady all year';
        row.append(el('span', 'yp-genre__rank', String(i + 1)), el('span', 'yp-genre__name', g.k), bar,
          el('span', 'yp-genre__pct', `${Math.round(g.share * 100)}%`), tag);
        chart.append(rise(row, 0.5 + i * 0.25));
      });
      box.append(chart, rise(tape('Share of the year’s episodes tagged with each genre · ▲▼ more or less by the end of the year', 'yp-tape--sub'), 2.2));
      return [backdrop(null, 'lsd'), box];
    } });

    // 12. tastemaker of the year
    const taste = story(s, 'tastemaker');
    if (taste) out.push({ dur: 8, track: taste.viz.rows[0], build() {
      const box = el('div', 'yp-frame yp-frame--bottom');
      box.append(rise(tape('Tastemaker of the year', 'yp-label'), 0), poster(splitLines(taste.headline, taste.headline.length > 16 ? 3 : 2), { d: 0.2, max: 0.15 }),
        rise(tape(taste.body, 'yp-tape--sub'), 0.8));
      const covers = el('div', 'yp-fan');
      taste.viz.rows.forEach((t, i) => covers.append(rise(coverImg(t, 'yp-cover'), 1.1 + i * 0.2)));
      box.append(covers);
      return [backdrop(taste.viz.rows[0]), box];
    } });

    // 13. outro
    out.push({ dur: 0, cls: 'yp-outro', build() {
      const box = el('div', 'yp-frame yp-frame--bottom');
      box.append(rise(tape(`NTS ${year} · end of tape`, 'yp-label'), 0), poster([['That was', 'outline'], 'the year'], { d: 0.2, max: 0.32 }));
      const acts = el('div', 'yp-actions');
      const again = el('button', 'yp-btn', 'Watch again'); again.addEventListener('click', (e) => { e.stopPropagation(); show(0, true); });
      const cards = el('button', 'yp-btn', 'Browse the cards'); cards.addEventListener('click', (e) => { e.stopPropagation(); opts.onBrowse?.(); });
      const sup = el('button', 'yp-btn yp-btn--on', 'Support NTS'); sup.addEventListener('click', (e) => { e.stopPropagation(); window.nts.openLink({ url: 'https://www.nts.live/supporters' }); });
      acts.append(again, cards, sup);
      box.append(rise(acts, 0.9));
      return [backdrop(t1, 'sedative'), box];
    } });
    return out;
  }

  // ---- playing ----
  function show(i, play = true) {
    at = Math.max(0, Math.min(scenes.length - 1, i));
    const sc = scenes[at];
    const stage = root.querySelector('.yp-stage');
    const scene = el('section', `yp-scene ${sc.cls || ''}`);
    scene.style.setProperty('--tint', TINTS[at % TINTS.length]);
    scene.append(...sc.build());
    inkLines(scene);
    stage.replaceChildren(scene);
    fitPosters(scene);
    document.fonts?.ready.then(() => { if (scene.isConnected) fitPosters(scene); });
    // a tape glitch on the cut, then now and then while it plays
    root.classList.remove('is-cut'); void root.offsetWidth; root.classList.add('is-cut');
    clearTimeout(cutTimer); cutTimer = setTimeout(() => root?.classList.remove('is-cut'), 450);
    const bg = scene.querySelector('.yp-bg');
    corrupt(bg, true);
    clearTimeout(glitchTimer);
    const again = () => { glitchTimer = setTimeout(() => { if (!paused) corrupt(bg); if (bg?.isConnected) again(); }, 1400 + Math.random() * 3600); };
    again();
    root.querySelectorAll('.yp-bar').forEach((b, j) => {
      b.classList.toggle('is-done', j < at);
      b.classList.toggle('is-on', j === at);
      const fill = b.firstChild;
      fill.style.animation = 'none'; void fill.offsetWidth; fill.style.animation = '';
      fill.style.animationDuration = `${scenes[j].dur || 1}s`;
    });
    if (play) setPaused(false);
    if (music && sc.track && playable(sc.track)) {
      const t = sc.track, k = `${t.latest.show}/${t.latest.episode}/${t.latest.offset}`;
      if (k !== playingKey) { playingKey = k; Archive.playFrom(t.latest.show, t.latest.episode, t.latest.offset); }
    }
    root.querySelector('.yp-hint').hidden = at !== 1;
  }
  const next = () => { if (at < scenes.length - 1) show(at + 1); };
  const prev = () => show(at - 1);
  let cutTimer = null, glitchTimer = null, clock = null, t0 = 0, held = 0;
  function setPaused(p) {
    paused = p;
    root.classList.toggle('is-paused', p);
    const osd = root.querySelector('.yp-osd__mode');
    if (osd) osd.textContent = p ? '❚❚ PAUSE' : '▶ PLAY';
  }
  // the camcorder overlay: PLAY / PAUSE, a tape counter, the date
  function osd(year) {
    const o = el('div', 'yp-osd');
    const mode = el('span', 'yp-osd__mode', '▶ PLAY');
    const counter = el('span', 'yp-osd__counter', 'SP 0:00:00');
    const date = el('span', 'yp-osd__date', `DEC 31 ${year}`);
    o.append(mode, counter, date);
    t0 = Date.now(); held = 0;
    let last = Date.now();
    clock = setInterval(() => {
      const now = Date.now();
      if (!paused) held += now - last;
      last = now;
      const sec = Math.floor(held / 1000);
      counter.textContent = `SP ${Math.floor(sec / 3600)}:${String(Math.floor(sec / 60) % 60).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
    }, 250);
    return o;
  }

  // start: the first screen asks with or without music, then plays
  function start(container, s, o = {}) {
    stop();
    opts = o; music = false; playingKey = null;
    scenes = build(s);
    root = el('div', 'yp');
    const bars = el('div', 'yp-bars');
    scenes.forEach((sc) => { const b = el('span', 'yp-bar'); b.append(el('i')); if (!sc.dur) b.classList.add('is-last'); bars.append(b); });
    const top = el('div', 'yp-top');
    const browse = el('button', 'yp-topbtn', 'Cards');
    browse.title = 'Browse the year as cards';
    browse.addEventListener('click', (e) => { e.stopPropagation(); opts.onBrowse?.(); });
    const close = el('button', 'yp-topbtn yp-close', '×');
    close.setAttribute('aria-label', 'Close');
    close.addEventListener('click', (e) => { e.stopPropagation(); opts.onClose?.(); });
    top.append(bars, browse, close);
    const stage = el('div', 'yp-stage');
    const hint = el('p', 'yp-hint', 'Click for the next one · hold to pause');
    root.append(stage, osd(s.year), top, hint);
    onResize = () => root && fitPosters(root);
    window.addEventListener('resize', onResize);
    loadMoods();
    container.append(root);

    // the bar filling up is the timer: when it ends, the next scene
    bars.addEventListener('animationend', (e) => { if (e.target.parentElement === bars.children[at]) next(); });
    // click: left third goes back, the rest forward; holding pauses
    let downAt = 0, holdTimer = null;
    root.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button')) return;
      downAt = Date.now();
      holdTimer = setTimeout(() => setPaused(true), 220);
    });
    root.addEventListener('pointerup', (e) => {
      clearTimeout(holdTimer);
      if (e.target.closest('button') || root.querySelector('.yp-gate')) return;
      if (Date.now() - downAt > 220) { setPaused(false); return; }
      if (e.clientX < root.clientWidth / 3) prev(); else next();
    });

    // the gate: music or not
    const gate = el('div', 'yp-gate');
    const gt = el('div', 'yp-frame yp-frame--bottom');
    gt.append(rise(tape('▶ NTS in', 'yp-label'), 0), poster([String(s.year)], { d: 0.1, max: 0.5 }),
      rise(tape('The year on NTS, told through its tracklists.', 'yp-tape--sub'), 0.4));
    const acts = el('div', 'yp-actions');
    const withMusic = el('button', 'yp-btn yp-btn--on', '▶ Play with music');
    withMusic.title = 'Each track plays as it comes up (this stops what you’re listening to)';
    const without = el('button', 'yp-btn', 'Without music');
    const go = (m) => (e) => { e.stopPropagation(); music = m; gate.remove(); show(0); };
    withMusic.addEventListener('click', go(true));
    without.addEventListener('click', go(false));
    acts.append(withMusic, without);
    gt.append(rise(acts, 0.5));
    gate.append(backdrop(s.top?.[0]), gt);
    stage.append(gate);
    fitPosters(gate);
    document.fonts?.ready.then(() => fitPosters(gate));
    setPaused(true);
    setTimeout(() => withMusic.focus(), 50);
  }
  let onResize = null;
  function stop() { clearInterval(clock); clearTimeout(glitchTimer); window.removeEventListener('resize', onResize); root?.remove(); root = null; }
  // keys from the overlay: ← → move, Space pauses
  function key(e) {
    if (!root) return false;
    if (root.querySelector('.yp-gate')) return false;
    if (e.key === 'ArrowRight') { next(); return true; }
    if (e.key === 'ArrowLeft') { prev(); return true; }
    if (e.key === ' ' && !e.target.closest?.('button')) { setPaused(!paused); return true; }
    return false;
  }
  return { start, stop, key, get active() { return !!root; } };
})();
