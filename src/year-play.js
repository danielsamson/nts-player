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
  const TINTS = ['#4b3cff', '#d42bd8', '#ff2a1a', '#ffd000', '#00b8c4', '#ff7a00'];

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
  function backdrop(t, mood) {
    const b = el('div', 'yp-bg');
    const src = mood && moods[mood];
    const layer = (cls) => {
      if (src) { const w = el('div', `${cls} has-img`); const im = el('img'); im.alt = ''; im.src = src; w.append(im); return w; }
      return t ? coverImg(t, cls) : el('div', cls);
    };
    b.append(layer('yp-bg__img'), layer('yp-bg__img yp-bg__ghost'), el('div', 'yp-bg__tint'));
    return b;
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

  // ---- the scenes: each { dur (s), track (to play with music), build() -> element } ----
  function build(s) {
    const out = [];
    const year = s.year;
    const top = s.top || [];

    // 1. intro: the year's covers drifting behind, the numbers counting up
    out.push({ dur: 7, cls: 'yp-intro', build() {
      const wall = el('div', 'yp-wall');
      const pool = [...(s.numberOnes || []), ...top.slice(0, 24)];
      for (let r = 0; r < 4; r++) {
        const row = el('div', 'yp-wall__row');
        for (let i = 0; i < 16; i++) row.append(coverImg(pool[(r * 7 + i) % pool.length] || top[0], 'yp-wall__cover'));
        wall.append(row);
      }
      const box = el('div', 'yp-center');
      box.append(rise(el('p', 'yp-kicker', 'NTS in'), 0.1), rise(el('h1', 'yp-year', String(year)), 0.25));
      const nums = el('div', 'yp-nums');
      [[s.episodes, 'episodes'], [s.shows, 'shows'], [s.plays, 'tracks played']].forEach(([v, l], i) => {
        const d = el('div', 'yp-num'); d.append(counter(v, { d: 0.9 + i * 0.35 }), el('span', 'yp-num__label', l)); nums.append(rise(d, 0.8 + i * 0.35));
      });
      box.append(nums, rise(el('p', 'yp-sub', s.complete ? 'The year in tracks' : `The year in tracks, ${s.months} months so far`), 2.2));
      return [wall, box];
    } });

    // 2. how rarely NTS repeats itself: 100 squares, almost all played once
    const rep = story(s, 'repeats');
    if (rep) out.push({ dur: 8, build() {
      const once = rep.viz.value;
      const box = el('div', 'yp-center');
      box.append(rise(el('p', 'yp-kicker', 'Of every 100 tracks played'), 0));
      const g = el('div', 'yp-waffle');
      for (let i = 0; i < 100; i++) { const c = el('span', i >= once ? 'is-again' : ''); c.style.setProperty('--d', `${0.4 + i * 0.018}s`); g.append(c); }
      box.append(g, rise(el('h2', 'yp-head', `${once} were played once.`), 2.4), rise(el('p', 'yp-sub', `Only ${100 - once} came back, on any show. NTS runs on record bags, not playlists.`), 3));
      return [backdrop(null, 'don-t-assume'), box];
    } });

    // 3. the countdown to the track of the year: 5 to 2
    top.slice(1, 5).reverse().forEach((t, i) => {
      const rank = 5 - i;
      out.push({ dur: 3.6, cls: 'yp-countdown', build() {     // no music change: four tracks in a few seconds would just stutter
        const box = el('div', 'yp-row');
        box.append(rise(el('span', 'yp-rank', String(rank)), 0), rise(coverImg(t, 'yp-cover yp-cover--mid'), 0.15));
        const tx = el('div', 'yp-rowtext');
        tx.append(rise(el('p', 'yp-title', t.title), 0.3), rise(el('p', 'yp-artist', t.artist), 0.4), rise(el('p', 'yp-sub', `${fmt(t.shows)} shows`), 0.55));
        box.append(tx);
        return [backdrop(t), box];
      } });
    });

    // 4. track of the year
    const t1 = top[0];
    if (t1) out.push({ dur: 11, track: t1, cls: 'yp-hero', build() {
      const box = el('div', 'yp-center');
      box.append(rise(el('p', 'yp-kicker', 'Track of the year'), 0.2), rise(coverImg(t1, 'yp-cover yp-cover--hero'), 0.5));
      box.append(rise(el('h2', 'yp-title yp-title--hero', t1.title), 1.1), rise(el('p', 'yp-artist', t1.artist), 1.3));
      const n = el('p', 'yp-sub'); n.append('Played by ', counter(t1.shows, { d: 1.6, ms: 1200 }), ' different shows');
      box.append(rise(n, 1.5));
      return [backdrop(t1), box];
    } });

    // 5. artist of the year: the name running across the screen
    const a1 = s.topArtists?.[0];
    if (a1) out.push({ dur: 8, track: a1.top, cls: 'yp-artist-scene', build() {
      const runs = el('div', 'yp-marquee');
      for (let r = 0; r < 5; r++) {
        const row = el('div', `yp-marquee__row${r % 2 ? ' is-back' : ''}${r === 2 ? ' is-solid' : ''}`);
        row.textContent = `${a1.artist} · `.repeat(8);
        runs.append(row);
      }
      const box = el('div', 'yp-center yp-center--low');
      box.append(rise(el('p', 'yp-kicker', 'Artist of the year'), 0.3));
      const n = el('p', 'yp-sub'); n.append('Played by ', counter(a1.shows, { d: 0.9 }), ` shows, ${a1.tracks} different tracks`);
      box.append(rise(n, 0.7));
      return [backdrop(a1.top), runs, box];
    } });

    // 6. number one, month by month: the covers arriving one after another
    if ((s.numberOnes || []).length > 2) out.push({ dur: 9, build() {
      const box = el('div', 'yp-center yp-center--wide');
      box.append(rise(el('p', 'yp-kicker', 'Number one, month by month'), 0));
      const g = el('div', 'yp-ones');
      s.numberOnes.forEach((t, i) => {
        const c = el('div', 'yp-one');
        c.append(coverImg(t, 'yp-cover'), el('span', 'yp-one__month', monthShort(t.month)), el('span', 'yp-one__title', t.title));
        c.title = `${t.artist} – ${t.title}`;
        g.append(rise(c, 0.4 + i * 0.32));
      });
      box.append(g);
      return [backdrop(null, 'music-to-dance-to'), box];
    } });

    // 7. the biggest leap: the rank counting down
    const leap = story(s, 'leap');
    if (leap) out.push({ dur: 8, track: leap.viz.t, build() {
      const t = leap.viz.t;
      const box = el('div', 'yp-center yp-corner');
      box.append(rise(el('p', 'yp-kicker', 'The biggest leap'), 0));
      const n = el('h2', 'yp-giant'); n.append(counter(leap.viz.to, { from: leap.viz.from, prefix: '#', d: 0.8, ms: 2200 }));
      box.append(rise(n, 0.3), rise(el('p', 'yp-title', t.title), 2.4), rise(el('p', 'yp-artist', t.artist), 2.5),
        rise(el('p', 'yp-sub', `From #${leap.viz.from} to #${leap.viz.to} in a month`), 2.8));
      return [backdrop(t), box];
    } });

    // 8. who heard it first: the show, and every show after it, along the year
    const first = story(s, 'first');
    if (first) out.push({ dur: 9, track: first.viz.t, build() {
      const v = first.viz;
      const box = el('div', 'yp-center yp-center--wide');
      box.append(rise(el('p', 'yp-kicker', 'Who heard it first'), 0), rise(el('h2', 'yp-head', v.firsts[0].show), 0.3),
        rise(el('p', 'yp-sub', `played ${v.t.title} (${v.t.artist}) before anyone else`), 0.6));
      const line = el('div', 'yp-strip');
      const y0 = Date.UTC(v.year, 0, 1), y1 = Date.UTC(v.year + 1, 0, 1);
      v.firsts.forEach((f, i) => {
        const dot = el('span', i === 0 ? 'yp-strip__dot is-first' : 'yp-strip__dot');
        dot.style.left = `${((f.d - y0) / (y1 - y0)) * 100}%`;
        dot.style.setProperty('--d', `${1 + i * 0.12}s`);
        dot.title = f.show;
        line.append(dot);
      });
      box.append(rise(line, 0.9), rise(el('p', 'yp-sub', `then ${v.firsts.length - 1} more shows`), 1.2 + v.firsts.length * 0.12));
      return [backdrop(v.t, 'audio-research'), box];
    } });

    // 9. rising: new in the last three months
    if ((s.breakouts || []).length >= 3) out.push({ dur: 8, track: s.breakouts[0], build() {
      const since = new Date(s.breakouts.since).toLocaleDateString(undefined, { month: 'long', timeZone: 'UTC' });
      const box = el('div', 'yp-center yp-center--wide');
      box.append(rise(el('p', 'yp-kicker', 'Rising'), 0), rise(el('h2', 'yp-head', `New since ${since}`), 0.2));
      const list = el('div', 'yp-list');
      s.breakouts.forEach((t, i) => {
        const r = el('div', 'yp-list__row');
        const tx = el('div', 'yp-rowtext'); tx.append(el('span', 'yp-list__title', t.title), el('span', 'yp-list__artist', `${t.artist} · ${t.shows} shows`));
        r.append(el('span', 'yp-list__rank', String(i + 1)), coverImg(t, 'yp-cover yp-cover--row'), tx);
        list.append(rise(r, 0.6 + i * 0.25));
      });
      box.append(list);
      return [backdrop(s.breakouts[0]), box];
    } });

    // 10. the long runner: a month at a time lighting up
    const lr = s.evergreen?.[0];
    if (lr) out.push({ dur: 8, track: lr, build() {
      const box = el('div', 'yp-center');
      box.append(rise(el('p', 'yp-kicker', 'The long runner'), 0), rise(coverImg(lr, 'yp-cover yp-cover--mid'), 0.2),
        rise(el('p', 'yp-title', lr.title), 0.5), rise(el('p', 'yp-artist', lr.artist), 0.6));
      const months = el('div', 'yp-months');
      (s.monthList || []).forEach((m, i) => {
        const c = el('span', (lr.perMonth?.[m] || 0) > 0 ? 'is-on' : '', monthShort(m).slice(0, 1));
        c.style.setProperty('--d', `${1 + i * 0.16}s`);
        months.append(c);
      });
      box.append(months, rise(el('p', 'yp-sub', `Played in ${lr.months} of ${s.months} months. Most tracks on NTS last a few weeks.`), 1.4 + (s.monthList || []).length * 0.16));
      return [backdrop(lr), box];
    } });

    // 11. the sound of the year: genres as a stream, drawn left to right
    const gen = story(s, 'genres');
    if (gen) out.push({ dur: 9, cls: 'yp-genres', build() {
      const v = gen.viz;
      const box = el('div', 'yp-center yp-center--wide');
      box.append(rise(el('p', 'yp-kicker', 'The sound of the year'), 0), rise(el('h2', 'yp-head', gen.headline), 0.3));
      const W = 1000, H = 360;
      const stack = d3.stack().keys(v.keys).offset(d3.stackOffsetWiggle).order(d3.stackOrderInsideOut)(v.rows);
      const x = d3.scalePoint().domain(v.rows.map((r) => r.m)).range([0, W]);
      const yy = d3.scaleLinear().domain([d3.min(stack, (l) => d3.min(l, (p) => p[0])), d3.max(stack, (l) => d3.max(l, (p) => p[1]))]).range([H, 0]);
      const area = d3.area().x((p) => x(p.data.m)).y0((p) => yy(p[0])).y1((p) => yy(p[1])).curve(d3.curveBasis);
      const svg = d3.create('svg').attr('class', 'yp-stream').attr('viewBox', `0 0 ${W} ${H + 30}`).attr('preserveAspectRatio', 'none');
      const shade = d3.scaleLinear().domain([0, v.keys.length - 1]).range([0.95, 0.2]);
      svg.selectAll('path').data(stack).join('path').attr('d', area).attr('fill', (l, i) => `rgba(255,255,255,${shade(i)})`).append('title').text((l) => l.key);
      stack.forEach((l, i) => {
        const p = l.reduce((b, q) => (q[1] - q[0] > b[1] - b[0] ? q : b), l[0]);
        if (yy(p[0]) - yy(p[1]) < 22) return;
        svg.append('text').attr('class', 'yp-stream__label').attr('x', Math.min(W - 80, Math.max(80, x(p.data.m)))).attr('y', (yy(p[0]) + yy(p[1])) / 2 + 6)
          .attr('text-anchor', 'middle').attr('fill', shade(i) > 0.55 ? '#000' : '#fff').text(l.key);
      });
      v.rows.forEach((r) => svg.append('text').attr('class', 'yp-stream__axis').attr('x', x(r.m)).attr('y', H + 24).attr('text-anchor', 'middle').text(monthShort(r.m).slice(0, 1)));
      const wrap = el('div', 'yp-stream-wrap'); wrap.append(svg.node());
      box.append(wrap);
      return [backdrop(null, 'lsd'), box];
    } });

    // 12. tastemaker of the year
    const taste = story(s, 'tastemaker');
    if (taste) out.push({ dur: 8, track: taste.viz.rows[0], build() {
      const box = el('div', 'yp-center yp-corner');
      box.append(rise(el('p', 'yp-kicker', 'Tastemaker of the year'), 0), rise(el('h2', 'yp-head yp-head--big', taste.headline), 0.3), rise(el('p', 'yp-sub', taste.body), 0.8));
      const covers = el('div', 'yp-fan');
      taste.viz.rows.forEach((t, i) => covers.append(rise(coverImg(t, 'yp-cover'), 1.2 + i * 0.2)));
      box.append(covers);
      return [backdrop(taste.viz.rows[0]), box];
    } });

    // 13. outro
    out.push({ dur: 0, cls: 'yp-outro', build() {
      const box = el('div', 'yp-center yp-corner');
      box.append(rise(el('p', 'yp-kicker', `NTS in ${year}`), 0), rise(el('h1', 'yp-year yp-year--outro', 'That was the year'), 0.2));
      const acts = el('div', 'yp-actions');
      const again = el('button', 'yp-btn', 'Watch again'); again.addEventListener('click', (e) => { e.stopPropagation(); show(0, true); });
      const cards = el('button', 'yp-btn', 'Browse the cards'); cards.addEventListener('click', (e) => { e.stopPropagation(); opts.onBrowse?.(); });
      const sup = el('button', 'yp-btn yp-btn--on', 'Support NTS'); sup.addEventListener('click', (e) => { e.stopPropagation(); window.nts.openLink({ url: 'https://www.nts.live/supporters' }); });
      acts.append(again, cards, sup);
      box.append(rise(acts, 0.8));
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
    stage.replaceChildren(scene);
    // a tape glitch on the cut
    root.classList.remove('is-cut'); void root.offsetWidth; root.classList.add('is-cut');
    clearTimeout(cutTimer); cutTimer = setTimeout(() => root?.classList.remove('is-cut'), 450);
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
  let cutTimer = null, clock = null, t0 = 0, held = 0;
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
    const tape = el('div', 'yp-vhs'); tape.append(el('div', 'yp-vhs__band'));
    root.append(stage, tape, osd(s.year), top, hint);
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
    const gt = el('div', 'yp-center');
    gt.append(rise(el('p', 'yp-kicker', 'NTS in'), 0), rise(el('h1', 'yp-year', String(s.year)), 0.1),
      rise(el('p', 'yp-sub', 'The year on NTS, told through its tracklists.'), 0.3));
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
    gt.classList.add('yp-corner');
    stage.append(gate);
    setPaused(true);
    setTimeout(() => withMusic.focus(), 50);
  }
  function stop() { clearInterval(clock); root?.remove(); root = null; }
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
