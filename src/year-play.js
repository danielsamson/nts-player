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

  let root = null, scenes = [], at = 0, paused = false, music = false, playingKey = null, opts = {}, auto = false, nudgeTimer = null;
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
    if (t.latest && Number.isFinite(t.latest.offset) && !/yp-bg|yp-wall|yp-ht/.test(cls)) {
      wrap.classList.add('yp-hot', 'yp-playable');
      wrap.dataset.tip = `${t.title} · ${t.artist}${t.released ? ` · ${t.released}` : ''}`;
      wrap.append(keepButton(t));
      wrap.addEventListener('click', (e) => {
        e.stopPropagation();
        playingKey = `${t.latest.show}/${t.latest.episode}/${t.latest.offset}`;
        crossTo(t);
        toast(`Playing ${t.title} where ${t.latest.title || 'a show'} played it`);
      });
    }
    return wrap;
  }
  // The mini player: what's playing, the track and the show it's from, at what point in the mix.
  // Pause, and dig in (open the episode).
  let unPlayer = null;
  function miniPlayer() {
    const p = el('div', 'yp-mini');
    const art = el('div', 'yp-mini__art'); const im = el('img'); im.alt = ''; art.append(im);
    const txt = el('div', 'yp-mini__text');
    const trk = el('span', 'yp-mini__track'), from = el('span', 'yp-mini__from');
    txt.append(trk, from);
    const play = el('button', 'yp-mini__btn', '❚❚'); play.setAttribute('aria-label', 'Pause');
    const dig = el('button', 'yp-mini__btn yp-mini__dig'); dig.innerHTML = BOOKMARK; dig.title = 'Bookmark the track playing now';
    p.append(art, txt, play, dig);
    const fmt2 = (ms) => { const t = Math.floor(ms / 1000); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; };
    let artKey = '';
    const paint = (st) => {
      const ep = st.episode;
      p.classList.toggle('is-on', !!(ep && (st.playing || st.loading || st.position)));
      if (!ep) return;
      const pos = st.position / 1000;
      let cur = null;
      for (const t of ep.tracks || []) { const o = t.offset ?? t.offset_estimate; if (o != null && o <= pos) cur = t; }
      trk.textContent = cur ? `${cur.title} · ${cur.artist}` : (st.loading ? 'Loading…' : ep.title);
      from.textContent = `${ep.title}${ep.date ? ' · ' + ep.date : ''} · ${fmt2(st.position)}`;
      const k = cur ? `${cur.artist}|${cur.title}` : ep.img;
      if (k !== artKey) {
        artKey = k;
        if (cur) Art.get({ artist: cur.artist, title: cur.title }, 'small').then((a) => { if (artKey === k) im.src = a?.small || a?.large || ep.img || ''; }).catch(() => { im.src = ep.img || ''; });
        else im.src = ep.img || '';
      }
      play.textContent = st.playing ? '❚❚' : '▶';
      play.setAttribute('aria-label', st.playing ? 'Pause' : 'Play');
    };
    play.addEventListener('click', (e) => { e.stopPropagation(); ArchivePlayer.toggle(); });
    dig.addEventListener('click', (e) => {
      e.stopPropagation();
      const st = ArchivePlayer.state, ep = st.episode; if (!ep) return;
      let cur = null;
      for (const t of ep.tracks || []) { const o = t.offset ?? t.offset_estimate; if (o != null && o <= st.position / 1000) cur = t; }
      if (!cur) return;
      const t = { artist: cur.artist, title: cur.title, latest: { show: ep.show, episode: ep.episode, offset: cur.offset ?? cur.offset_estimate, title: ep.title } };
      if (!crate.has(keyOf(t))) { crate.set(keyOf(t), t); paintCount(); toast(`Bookmarked ${t.title}`); }
    });
    unPlayer?.(); unPlayer = ArchivePlayer.onChange(paint); paint(ArchivePlayer.state);
    return p;
  }
  // ---- the crate: what you keep while you watch (for this viewing; saved to My NTS too when signed in) ----
  const crate = new Map();               // key -> track
  // the same bookmark as everywhere else in the app
  const BOOKMARK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h12v18l-6-4.5L6 21z"/></svg>';
  const keyOf = (t) => `${t.artist}|${t.title}`.toLowerCase();
  function keepButton(t) {
    const b = el('button', 'yp-keep');
    b.innerHTML = BOOKMARK;
    const paint = () => { const on = crate.has(keyOf(t)); b.classList.toggle('is-on', on); b.title = on ? 'Bookmarked (click to remove)' : 'Bookmark it to dig into later'; b.setAttribute('aria-pressed', String(on)); };
    paint();
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      const k = keyOf(t);
      if (crate.has(k)) { crate.delete(k); toast(`Removed ${t.title}`); }
      else {
        crate.set(k, t);
        toast(`Bookmarked ${t.title}. It's waiting at the end`);
        if (typeof supporter !== 'undefined' && supporter && t.latest?.episode) {
          MyNTS.toggleTrack(t.latest.show, t.latest.episode, { artist: t.artist, title: t.title }, true,
            { show: t.latest.show, episode: t.latest.episode, title: t.latest.title, offset: t.latest.offset }).catch(() => {});
        }
      }
      root?.querySelectorAll('.yp-keep').forEach((x) => x.dispatchEvent(new Event('repaint')));
      paintCount();
    });
    b.addEventListener('repaint', paint);
    return b;
  }
  const paintCount = () => { const c = root?.querySelector('.yp-cratecount'); if (c) { c.innerHTML = crate.size ? `${BOOKMARK}<span>${crate.size}</span>` : ''; c.title = 'Bookmarked, waiting at the end'; c.hidden = !crate.size; } };
  // a short note at the bottom of the screen
  let toastTimer = null;
  function toast(text) {
    let n = root?.querySelector('.yp-toast');
    if (!root) return;
    if (!n) { n = el('p', 'yp-toast'); root.append(n); }
    n.textContent = text; n.classList.add('is-on');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => n.classList.remove('is-on'), 3200);
  }
  // a show you can open: hover lifts it, click goes to its page (closing the year)
  function showLink(node, alias) {
    if (!alias) return node;
    node.classList.add('yp-hot', 'yp-showlink');
    node.dataset.tip = node.querySelector('span')?.textContent || 'A show on NTS';
    return node;
  }
  // the scene's backdrop, treated like a tape still: the cover (or NTS mood footage) full-bleed,
  // a colour cast, a ghost of itself slightly off to the side, drifting slowly
  // (extra: something else to show on the tape, like the wall of covers)
  // halftone: grey, printed with a coarse dot screen (like nts.live's 404 page), instead of a colour cast
  function backdrop(t, mood, extra, halftone = false) {
    const b = el('div', `yp-bg${halftone ? ' yp-bg--halftone' : ''}`);
    const src = mood && moods[mood];
    const layer = (cls) => {
      if (src) {
        const w = el('div', `${cls} has-img`); const im = el('img'); im.alt = '';
        // the mood still didn't load: the track's cover instead
        if (t) im.addEventListener('error', () => { if (w.isConnected) w.replaceWith(coverImg(t, cls)); });
        im.src = src; w.append(im); return w;
      }
      return t ? coverImg(t, cls) : el('div', cls);
    };
    if (halftone) {
      // a real halftone: the picture blurred and grey, multiplied by a dot pattern, then the contrast
      // pushed until each dot snaps to a hard edge, sized by the tone under it
      const ht = el('div', 'yp-ht');
      ht.append(layer('yp-ht__img'), el('div', 'yp-ht__dots'));
      b.append(ht);
    } else b.append(layer('yp-bg__img'), layer('yp-bg__img yp-bg__ghost'));
    if (extra) b.append(extra);
    // torn slices for the corrupted moments: copies of the picture, a band each, shoved sideways
    if (!halftone && (src || t)) for (let i = 0; i < 3; i++) b.append(layer('yp-bg__img yp-bg__slice'));
    b.append(el('div', 'yp-bg__tint'), el('div', 'yp-bg__grain'), el('div', 'yp-bg__snow'), el('div', 'yp-bg__bars'), el('div', 'yp-bg__phos'), el('div', 'yp-bg__band'), el('div', 'yp-bg__head'));
    return b;
  }
  // running lines of type behind a scene: rows of the words sliding past, alternating direction,
  // outlined with a solid row here and there. vertical: columns sliding up and down instead
  function kinetic(text, { rows = 5, angle = -4, size = '13vw', speed = 34, solid = [], vertical = false, opacity = 0.5 } = {}) {
    const k = el('div', `yp-kin${vertical ? ' yp-kin--v' : ''}`);
    k.style.setProperty('--a', `${angle}deg`);
    k.style.setProperty('--s', size);
    k.style.setProperty('--o', opacity);
    for (let r = 0; r < rows; r++) {
      const row = el('div', `yp-kin__row${r % 2 ? ' is-back' : ''}${solid.includes(r) ? ' is-solid' : ''}`);
      row.textContent = `${text} · `.repeat(10);
      row.style.setProperty('--sp', `${speed + (r % 3) * 6}s`);
      k.append(row);
    }
    return k;
  }
  // the tape never sits still: the wobble's noise changes several times a second, and white
  // drop-out streaks flick across
  let jitterTimer = null;
  // snow: a few frames of coloured speckle, drawn once; each speck a short sideways streak
  let snowFrames = null;
  function snow() {
    if (snowFrames) return snowFrames;
    const cols = ['255,255,255', '255,90,200', '255,60,90', '255,220,120', '120,230,255', '200,120,255'];
    snowFrames = Array.from({ length: 5 }, () => {
      const c = document.createElement('canvas'); c.width = 240; c.height = 180;
      const g = c.getContext('2d');
      for (let i = 0; i < 2600; i++) {
        g.fillStyle = `rgba(${cols[Math.floor(Math.random() * cols.length)]},${0.35 + Math.random() * 0.65})`;
        g.fillRect(Math.random() * 240, Math.floor(Math.random() * 180), 1 + Math.random() * 5, 1);
      }
      return `url(${c.toDataURL()})`;
    });
    return snowFrames;
  }
  let snowAt = 0;
  function jitter() {
    clearInterval(jitterTimer);
    if (reduced()) return;
    jitterTimer = setInterval(() => {
      if (!root || paused) return;
      const frames = snow();
      snowAt = (snowAt + 1) % frames.length;
      root.querySelectorAll('.yp-bg__snow').forEach((sn) => { sn.style.backgroundImage = frames[snowAt]; });
      const turb = root.querySelector('#yp-vhs feTurbulence');
      if (turb) turb.setAttribute('seed', String(1 + Math.floor(Math.random() * 999)));
      const bg = root.querySelector('.yp-scene .yp-bg, .yp-gate .yp-bg');
      if (bg && Math.random() < 0.45) {
        for (let i = 0, n = 1 + Math.floor(Math.random() * 3); i < n; i++) {
          const d = el('span', 'yp-drop');
          d.style.top = `${Math.random() * 100}%`;
          d.style.left = `${Math.random() * 70}%`;
          d.style.width = `${8 + Math.random() * 45}%`;
          bg.append(d);
          setTimeout(() => d.remove(), 60 + Math.random() * 90);
        }
      }
    }, 110);
  }
  // now and then the tape corrupts: slices jump, colours bleed, the noise flares
  function corrupt(bg, strong = false) {
    if (!bg?.isConnected || reduced()) return;
    const disp = root?.querySelector('#yp-vhs feDisplacementMap');
    if (disp) { disp.setAttribute('scale', String(strong ? 70 : 28 + Math.random() * 30)); setTimeout(() => disp.setAttribute('scale', '9'), strong ? 380 : 200); }
    bg.querySelectorAll('.yp-bg__slice').forEach((sl) => {
      const top = Math.random() * 85, h = 3 + Math.random() * (strong ? 22 : 12);
      sl.style.setProperty('--t', `${top}%`);
      sl.style.setProperty('--b', `${Math.max(0, 100 - top - h)}%`);
      sl.style.setProperty('--dx', `${(Math.random() - 0.5) * (strong ? 22 : 12)}%`);
    });
    bg.style.setProperty('--hue', `${Math.round((Math.random() - 0.5) * 160)}deg`);
    bg.style.setProperty('--bt', `${Math.random() * 80}%`);
    bg.style.setProperty('--bh', `${6 + Math.random() * (strong ? 30 : 14)}%`);
    bg.classList.add('is-corrupt');
    root?.classList.add('is-glitch');
    if (strong) root?.classList.add('is-snow');
    setTimeout(() => root?.classList.remove('is-glitch', 'is-snow'), strong ? 320 : 150);
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

  // Outlined type: the text drawn solid, then shrunk and cut out of itself, leaving just the
  // edge of each letter's silhouette (a text stroke would also trace the overlapping pieces
  // the letters are built from, inside them)
  function outlineFilters() {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('class', 'yp-filters'); svg.setAttribute('aria-hidden', 'true');
    svg.innerHTML = ''
      // worn tape: each line wobbles sideways (noise that changes several times a second), and the
      // colours come apart: red one way, blue the other, smeared along the line
      + `<filter id="yp-vhs" x="-4%" y="0" width="108%" height="100%" color-interpolation-filters="sRGB">
          <feTurbulence type="fractalNoise" baseFrequency="0.00001 0.28" numOctaves="1" seed="2" result="n"/>
          <feColorMatrix in="n" type="matrix" values="1 0 0 0 0  0 0 0 0 .5  0 0 0 0 .5  0 0 0 0 1" result="nx"/>
          <feDisplacementMap in="SourceGraphic" in2="nx" scale="9" xChannelSelector="R" yChannelSelector="G" result="d"/>
          <feColorMatrix in="d" type="matrix" values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" result="r"/>
          <feOffset in="r" dx="7" result="ro"/><feGaussianBlur in="ro" stdDeviation="9 0.4" result="rb"/>
          <feColorMatrix in="d" type="matrix" values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0" result="g"/>
          <feColorMatrix in="d" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0" result="b"/>
          <feOffset in="b" dx="-7" result="bo"/><feGaussianBlur in="bo" stdDeviation="9 0.4" result="bb"/>
          <feBlend in="rb" in2="g" mode="screen" result="rg"/><feBlend in="rg" in2="bb" mode="screen"/>
        </filter>`;
    return svg;
  }
  // Outlined text as vector, Illustrator style: the same words as SVG text with a stroke, the stroke
  // masked by the letters' own fill so only the outer half shows (no lines inside the letters,
  // where the shapes they're built from overlap). Drawn over the element, whose own text is hidden.
  let outlineIds = 0;
  function vectorOutline(node, { weight = 0.025, color = '#fff', opacity = 1 } = {}) {
    node.querySelector(':scope > .yp-vo')?.remove();
    const text = node.textContent;
    if (!text.trim()) return;
    const cs = getComputedStyle(node);
    const fs = parseFloat(cs.fontSize);
    // where the baseline sits: a zero-size marker at the end of the text
    const mark = document.createElement('span');
    mark.style.cssText = 'display:inline-block;width:0;height:0;vertical-align:baseline';
    node.append(mark);
    const box = node.getBoundingClientRect(), mb = mark.getBoundingClientRect();
    mark.remove();
    const base = mb.top - box.top;
    const sw = Math.max(2, fs * weight) * 2;            // twice: the inner half is masked away
    const pad = sw;
    const ns = 'http://www.w3.org/2000/svg', id = `yp-vo-${++outlineIds}`;
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('class', 'yp-vo');
    svg.setAttribute('aria-hidden', 'true');
    const W = box.width + pad * 2, H = box.height + pad * 2;
    svg.setAttribute('width', W); svg.setAttribute('height', H);
    svg.setAttribute('viewBox', `${-pad} ${-pad} ${W} ${H}`);
    svg.style.cssText = `position:absolute;left:${-pad}px;top:${-pad}px;overflow:visible;pointer-events:none;opacity:${opacity}`;
    const t = (attrs) => {
      const e = document.createElementNS(ns, 'text');
      e.textContent = cs.textTransform === 'uppercase' ? text.toUpperCase() : text;
      Object.entries({ x: 0, y: base, 'font-family': cs.fontFamily, 'font-size': fs, 'font-weight': cs.fontWeight, 'letter-spacing': cs.letterSpacing === 'normal' ? 0 : cs.letterSpacing, ...attrs })
        .forEach(([k, v]) => e.setAttribute(k, v));
      return e;
    };
    const mask = document.createElementNS(ns, 'mask');
    mask.id = id;
    mask.setAttribute('maskUnits', 'userSpaceOnUse');
    const rect = document.createElementNS(ns, 'rect');
    Object.entries({ x: -pad, y: -pad, width: W, height: H, fill: '#fff' }).forEach(([k, v]) => rect.setAttribute(k, v));
    mask.append(rect, t({ fill: '#000' }));
    svg.append(mask, t({ fill: 'none', stroke: color, 'stroke-width': sw, 'stroke-linejoin': 'round', mask: `url(#${id})` }));
    if (cs.position === 'static') node.style.position = 'relative';
    node.style.color = 'transparent';
    node.append(svg);
  }
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
  // even: every line the same size (one title over several lines), else each line fills the width
  function poster(lines, { d = 0, step = 0.14, max = 0.34, cls = '', even = false } = {}) {
    const box = el('div', `yp-poster ${cls}`);
    box.dataset.max = max;
    if (even) box.dataset.even = '1';
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
      const lines = [...box.querySelectorAll('.yp-poster__line')];
      const sizes = lines.map((line) => {
        line.style.fontSize = '100px';
        const w = line.querySelector('.yp-poster__inner').getBoundingClientRect().width || 1;
        return Math.min(cap, (100 * W) / w);
      });
      const even = box.dataset.even ? Math.min(...sizes) : 0;
      lines.forEach((line, i) => {
        const fs = even || sizes[i];
        line.style.fontSize = `${fs}px`;
      });
      // outlined lines: drawn as vector once sized
      lines.filter((l) => l.classList.contains('is-outline')).forEach((line) => {
        const inner = line.querySelector('.yp-poster__inner');
        inner.querySelector(':scope > .yp-vo')?.remove();
        vectorOutline(inner, { weight: 0.022, color: line.closest('.yp-white') ? '#000' : '#fff' });
      });
    });
  }
  // a numeral so big it runs off the edge of the screen, behind everything
  function giant(content, cls = '') {
    const g = el('div', `yp-giant-bg ${cls}`);
    if (typeof content === 'string') g.textContent = content; else g.append(content);
    return g;
  }
  // The white panel (like an Infinite Mixtape page): the footage on the left, black type on white
  // on the right: an icon and label, the title, a rule, the content
  function whitePanel({ icon, label, title, body, foot }) {
    const p = el('aside', 'yp-white');
    const head = el('div', 'yp-white__head');
    head.append(el('span', 'yp-white__icon', icon), el('span', 'yp-white__label', label));
    p.append(rise(head, 0.1), poster(title, { d: 0.2, max: 0.11, cls: 'yp-white__title' }), rise(el('div', 'yp-white__rule'), 0.4), body);
    if (foot) p.append(rise(el('p', 'yp-white__foot', foot), 1.8));
    return p;
  }
  // An archive tile, as on nts.live: the cover, a row with a date on the left and a count on the
  // right, the title, the artist, outlined genre tags
  function tile(t, left, right) {
    const c = el('div', 'yp-tile');
    const row = el('div', 'yp-tile__row'); row.append(el('span', null, left), el('span', null, right));
    c.append(coverImg(t, 'yp-cover'), row, el('span', 'yp-tile__title', t.title), el('span', 'yp-tile__artist', t.artist));
    if (t.tags?.length) { const tags = el('div', 'yp-tile__tags'); t.tags.forEach((g) => tags.append(el('span', null, g))); c.append(tags); }
    c.title = `${t.artist} – ${t.title}`;
    return c;
  }
  // Covers as a grid, each one rising in turn, with its title under it (captions: false for none)
  function coverGrid(tracks, { cols = 2, d = 0.6, step = 0.14, captions = true, cls = '' } = {}) {
    const g = el('div', `yp-covergrid ${cls}`);
    g.style.setProperty('--cols', cols);
    tracks.forEach((t, i) => {
      const c = el('figure', 'yp-covergrid__item');
      c.append(coverImg(t, 'yp-cover'));
      if (captions) c.append(el('figcaption', null, t.title));
      c.title = `${t.artist} – ${t.title}`;
      g.append(rise(c, d + i * step));
    });
    return g;
  }
  // type on the left, artwork on the right
  function artSplit(text, art) { const b = el('div', 'yp-frame yp-artsplit'); const l = el('div', 'yp-artsplit__text'); l.append(...text); b.append(l, art); return b; }
  // NTS show pictures, the 400px version from the main image host (sharper than the 200px thumbnails)
  const bigPic = (u) => String(u || '').replace(/\/\/media\d?\.ntslive\.co\.uk\/resize\/\d+x\d+\//, '//media.ntslive.co.uk/resize/400x400/');
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
      box.append(g, poster([[`${once} of 100`, 'outline'], 'played once'], { d: 2.2, max: 0.2, cls: 'yp-poster--center yp-poster--narrow' }),
        rise(tape(`Only ${100 - once} came back, on any show.`, 'yp-tape--sub'), 2.9));
      return [backdrop(null, 'don-t-assume', kinetic('Played once', { rows: 7, angle: 0, size: '11vh', speed: 26, solid: [3], opacity: 0.35 }), true), box];
    } });

    // 3. the countdown, 5 to 2: the number runs off the edge, the title stacks beside the cover
    top.slice(1, 5).reverse().forEach((t, i) => {
      const rank = 5 - i;
      out.push({ dur: [3.2, 3.4, 3.8, 4.6][i], cls: 'yp-countdown', build() {     // no music change: four tracks in a few seconds would just stutter
        const box = el('div', 'yp-frame yp-frame--right');
        const row = el('div', 'yp-split');
        row.append(rise(coverImg(t, 'yp-cover yp-cover--split'), 0.1));
        const tx = el('div', 'yp-splittext');
        tx.append(poster(splitLines(t.title, t.title.length > 14 ? 3 : 2), { even: true, d: 0.25, max: 0.2 }),
          rise(tape(`${t.artist}`, 'yp-tape--sub'), 0.6), rise(tape(`${fmt(t.shows)} shows`, 'yp-tape--sub'), 0.7));
        row.append(tx);
        box.append(row);
        return [backdrop(t, null, kinetic(t.title, { rows: 3, angle: 0, size: '30vh', speed: 22, opacity: 0.32 })), giant(String(rank), 'yp-giant-bg--left'), box];
      } });
    });

    // the beat before number one: black, the tape running, a single line
    const t1 = top[0];
    if (t1) out.push({ dur: 2.4, cls: 'yp-beat', build() {
      const box = el('div', 'yp-frame yp-frame--center');
      box.append(rise(tape('And the track of the year', 'yp-label'), 0.2), poster([['Number one', 'outline']], { d: 0.5, max: 0.24, cls: 'yp-poster--center yp-poster--narrow' }));
      return [box];
    } });

    // 4. track of the year: the title across the whole frame, over the cover
    if (t1) out.push({ dur: 11, track: t1, cls: 'yp-hero', build() {
      const box = el('div', 'yp-frame yp-frame--bottom');
      box.append(rise(coverImg(t1, 'yp-cover yp-cover--hero'), 0.3), rise(tape('Track of the year', 'yp-label'), 0.6),
        poster(splitLines(t1.title, t1.title.length > 8 ? 2 : 1), { even: true, d: 0.9, max: 0.3, cls: 'yp-poster--beside' }));
      const n = tape('', 'yp-tape--sub'); n.append(`${t1.artist} · played by `, counter(t1.shows, { d: 1.6, ms: 1200 }), ' shows');
      box.append(rise(n, 1.4));
      return [backdrop(t1), box];
    } });

    // 5. artist of the year: the name, as big as it goes
    const a1 = s.topArtists?.[0];
    if (a1) out.push({ dur: 8, track: a1.top, build() {
      const runs = kinetic(a1.artist, { rows: 6, angle: -4, size: '13vw', solid: [2], opacity: 0.6 });
      const box = el('div', 'yp-frame yp-frame--bottom');
      const parts = splitLines(a1.artist, a1.artist.length > 10 ? 2 : 1);
      box.append(rise(tape('Artist of the year', 'yp-label'), 0.1), poster(parts.map((p, i) => (i % 2 ? [p, 'outline'] : p)), { d: 0.3, max: 0.32, cls: 'yp-poster--artist' }));
      const n = tape('', 'yp-tape--sub'); n.append('Played by ', counter(a1.shows, { d: 0.9 }), ` shows · ${a1.tracks} different tracks`);
      box.append(rise(n, 0.9));
      // the record, and their tracks NTS played, as a tracklist
      const side = el('div', 'yp-artistrec');
      side.append(rise(coverImg(a1.top, 'yp-cover'), 0.6));
      const tl = el('ol', 'yp-tracklist');
      (a1.list || [a1.top]).slice(0, 5).forEach((t, i) => { const li = el('li'); li.append(el('span', null, String(i + 1).padStart(2, '0')), el('span', null, t.title), el('span', null, `${t.shows} shows`)); tl.append(rise(li, 1 + i * 0.15)); });
      side.append(tl);
      return [backdrop(a1.top, null, runs), side, box];
    } });

    // 6. number one, month by month: a white panel of archive tiles
    if ((s.numberOnes || []).length > 2) out.push({ dur: 10, cls: 'yp-panelscene', build() {
      const g = el('div', `yp-tiles${s.numberOnes.length > 6 ? ' yp-tiles--many' : ''}`);
      s.numberOnes.forEach((t, i) => g.append(rise(tile(t, monthShort(t.month), `${t.shows} shows`), 0.6 + i * 0.22)));
      return [backdrop(s.numberOnes[0], 'music-to-dance-to', kinetic(s.numberOnes.map((t) => t.title).join(' · '), { rows: 4, vertical: true, size: '13vh', speed: 60, solid: [1], opacity: 0.55 })), whitePanel({ icon: '✦', label: 'Number one, month by month', title: [['Number one', 'outline'], 'every month'], body: g })];
    } });

    // 7. the biggest leap: the rank counting down, huge, off the edge
    const leap = story(s, 'leap');
    if (leap) out.push({ dur: 8, track: leap.viz.t, build() {
      const t = leap.viz.t;
      const num = el('span'); num.append(counter(leap.viz.to, { from: leap.viz.from, prefix: '#', d: 0.6, ms: 2200 }));
      const box = el('div', 'yp-frame yp-frame--right');
      box.append(rise(tape('The biggest leap', 'yp-label'), 0), poster(splitLines(t.title, 2), { even: true, d: 2.3, max: 0.12 }),
        rise(tape(`${t.artist} · #${leap.viz.from} → #${leap.viz.to} in a month`, 'yp-tape--sub'), 2.7));
      return [backdrop(t), giant(num, 'yp-giant-bg--left yp-giant-bg--count'), box];
    } });

    // 8. who heard it first: the show's name across the frame, the shows after it along the year
    const first = story(s, 'first');
    if (first) out.push({ dur: 9, track: first.viz.t, build() {
      const v = first.viz;
      const box = el('div', 'yp-frame yp-frame--bottom');
      box.append(rise(tape('Who heard it first', 'yp-label'), 0), poster(splitLines(v.firsts[0].show, 2), { even: true, d: 0.2, max: 0.24 }),
        rise(tape(`played ${v.t.title} (${v.t.artist}) before anyone else`, 'yp-tape--sub'), 0.7));
      const line = el('div', 'yp-strip');
      for (let m = 0; m < 12; m++) { const tk = el('span', 'yp-strip__tick', 'JFMAMJJASOND'[m]); tk.style.left = `${((m + 0.5) / 12) * 100}%`; line.append(tk); }
      const y0 = Date.UTC(v.year, 0, 1), y1 = Date.UTC(v.year + 1, 0, 1);
      v.firsts.forEach((f, i) => {
        const dot = el('span', i === 0 ? 'yp-strip__dot is-first' : 'yp-strip__dot');
        dot.style.left = `${((f.d - y0) / (y1 - y0)) * 100}%`;
        dot.style.setProperty('--d', `${1.1 + i * 0.12}s`);
        dot.dataset.tip = `${f.show} · ${new Date(f.d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' })}`;
        dot.classList.add('yp-hot');
        line.append(dot);
      });
      box.append(rise(line, 1), rise(tape(`then ${v.firsts.length - 1} more shows`, 'yp-tape--sub'), 1.3 + v.firsts.length * 0.12));
      const art = el('div', 'yp-artsplit__art yp-artsplit__art--one');
      const cov = rise(coverImg(v.t, 'yp-cover yp-cover--feature'), 0.4);
      art.append(cov, rise(el('p', 'yp-artcap', `${v.t.title} · ${v.t.artist}`), 0.7));
      box.classList.add('yp-artsplit'); box.classList.remove('yp-frame--bottom');
      const l = el('div', 'yp-artsplit__text'); l.append(...box.childNodes); box.append(l, art);
      return [backdrop(v.t, 'audio-research', null, true), box];
    } });

    // 9. rising: new in the last three months, as tiles
    if ((s.breakouts || []).length >= 3) out.push({ dur: 9, track: s.breakouts[0], build() {
      const since = new Date(s.breakouts.since).toLocaleDateString(undefined, { month: 'long', timeZone: 'UTC' });
      const g = el('div', 'yp-tiles yp-tiles--five');
      s.breakouts.forEach((t, i) => g.append(rise(tile(t, `#${i + 1}`, `${t.shows} shows`), 0.6 + i * 0.22)));
      const box = el('div', 'yp-frame yp-risescene');
      const from = new Date(s.breakouts.since).toLocaleDateString(undefined, { month: 'short', timeZone: 'UTC' });
      const to = monthShort(s.monthList[s.monthList.length - 1]);
      box.append(rise(tape(`Rising · ${from}–${to}`, 'yp-label'), 0), poster([['Breaking', 'outline'], 'through'], { d: 0.15, max: 0.14, cls: 'yp-rise__title' }), g,
        rise(tape(`New in the last three months (${since} on) and already picked up by the most shows.`, 'yp-tape--sub'), 1.9));
      return [backdrop(s.breakouts[0], null, null, true), box];
    } });

    // 10. the long runner: 11 / 11, a month at a time lighting up
    const lr = s.evergreen?.[0];
    if (lr) out.push({ dur: 8, track: lr, build() {
      const box = el('div', 'yp-frame');
      box.append(rise(tape('The long runner', 'yp-label'), 0.1), poster(splitLines(lr.title, lr.title.length > 14 ? 3 : 2), { even: true, d: 0.2, max: 0.1 }),
        rise(tape(lr.artist, 'yp-tape--sub'), 0.6));
      const months = el('div', 'yp-months');
      (s.monthList || []).forEach((m, i) => {
        const c = el('span', (lr.perMonth?.[m] || 0) > 0 ? 'is-on' : '', monthShort(m).slice(0, 1));
        c.style.setProperty('--d', `${0.9 + i * 0.14}s`);
        months.append(c);
      });
      box.append(rise(months, 0.8), rise(tape(`Played in ${lr.months} of ${s.months} months. Most tracks on NTS last a few weeks.`, 'yp-tape--sub'), 1.2 + (s.monthList || []).length * 0.14));
      const l = el('div', 'yp-artsplit__text'); l.append(...box.childNodes);
      box.classList.add('yp-artsplit');
      const art = el('div', 'yp-artsplit__art yp-artsplit__art--one');
      art.append(rise(coverImg(lr, 'yp-cover yp-cover--feature'), 0.3), rise(el('p', 'yp-artcap', `${lr.months} of ${s.months} months`), 0.6));
      box.append(l, art);
      return [backdrop(lr, 'lean-back'), box];
    } });

    // time travellers: the oldest records among the year's most played
    const old = s.timeTravel || [];
    if (old.length >= 3) out.push({ dur: 9, track: old[0], build() {
      const box = el('div', 'yp-frame yp-travel');
      box.append(rise(tape('Time travellers', 'yp-label'), 0), poster([['Old records,', 'outline'], 'new ears'], { d: 0.15, max: 0.11, cls: 'yp-deep__title' }));
      const row = el('div', 'yp-travel__row');
      old.forEach((t, i) => {
        const c = el('div', 'yp-travel__item');
        c.append(el('span', 'yp-travel__year', String(t.released)), coverImg(t, 'yp-cover'), el('span', 'yp-deep__t', t.title), el('span', 'yp-deep__a', `${t.artist} · ${t.shows} shows in ${year}`));
        row.append(rise(c, 0.5 + i * 0.3));
      });
      box.append(row, rise(tape(`${year - old[0].released} years old and still finding new shows.`, 'yp-tape--sub'), 1.8));
      return [backdrop(old[0], null, null, true), box];
    } });

    // comebacks: old records that suddenly spread in one month
    const cb = s.comebacks || [];
    if (cb.length >= 2) out.push({ dur: 9, track: cb[0], build() {
      const box = el('div', 'yp-frame yp-travel');
      box.append(rise(tape('Comebacks', 'yp-label'), 0), poster([['Back', 'outline'], 'in the bag'], { d: 0.15, max: 0.11, cls: 'yp-deep__title' }));
      const row = el('div', 'yp-travel__row');
      cb.forEach((t, i) => {
        const c = el('div', 'yp-travel__item');
        const bars = el('div', 'yp-bars-mini');
        const mx = Math.max(...t.vals, 1);
        t.vals.forEach((v, j) => { const b = el('span', s.monthList[j] === t.peakMonth ? 'is-peak' : ''); b.style.setProperty('--h', `${Math.max(4, (v / mx) * 100)}%`); b.style.setProperty('--d', `${0.9 + i * 0.3 + j * 0.04}s`); bars.append(b); });
        c.append(coverImg(t, 'yp-cover'), bars, el('span', 'yp-deep__t', t.title),
          el('span', 'yp-deep__a', `${t.artist} · ${t.released}`), el('span', 'yp-deep__by', `${t.peak} shows in ${monthShort(t.peakMonth)}, out of nowhere`));
        row.append(rise(c, 0.5 + i * 0.3));
      });
      box.append(row);
      return [backdrop(cb[0]), box];
    } });

    // crossovers: one track, many genres
    const xo = (s.crossovers || [])[0];
    if (xo && xo.gl.length >= 4) out.push({ dur: 9, track: xo, build() {
      const box = el('div', 'yp-frame yp-artsplit');
      const l = el('div', 'yp-artsplit__text');
      l.append(rise(tape('Crossover', 'yp-label'), 0), poster(splitLines(xo.title, xo.title.length > 12 ? 2 : 1), { even: true, d: 0.2, max: 0.16 }),
        rise(tape(`${xo.artist} · played in ${xo.gl.length} different genres of show`, 'yp-tape--sub'), 0.6));
      const tags = el('div', 'yp-xo__tags');
      xo.gl.slice(0, 10).forEach((g, i) => tags.append(rise(el('span', null, g), 0.9 + i * 0.12)));
      l.append(tags);
      const art = el('div', 'yp-artsplit__art yp-artsplit__art--one');
      art.append(rise(coverImg(xo, 'yp-cover yp-cover--feature'), 0.3));
      box.append(l, art);
      return [backdrop(xo), box];
    } });

    // loyalty: one show, one track, month after month
    const ly = s.loyal;
    if (ly) out.push({ dur: 8, track: ly, build() {
      const box = el('div', 'yp-frame yp-artsplit');
      const l = el('div', 'yp-artsplit__text');
      l.append(rise(tape('Loyal', 'yp-label'), 0), poster(splitLines(ly.by, ly.by.length > 14 ? 2 : 1), { even: true, d: 0.2, max: 0.13 }),
        rise(tape(`kept coming back to ${ly.title} (${ly.artist}). No other show played it.`, 'yp-tape--sub'), 0.6));
      const months = el('div', 'yp-months');
      (s.monthList || []).forEach((m, i) => { const c = el('span', (ly.perMonth?.[m] || 0) > 0 ? 'is-on' : '', monthShort(m).slice(0, 1)); c.style.setProperty('--d', `${0.9 + i * 0.12}s`); months.append(c); });
      l.append(rise(months, 0.8), rise(tape(`${ly.months} months, ${ly.episodes} episodes`, 'yp-tape--sub'), 1.4));
      const art = el('div', 'yp-artsplit__art yp-artsplit__art--one');
      art.append(rise(coverImg(ly, 'yp-cover yp-cover--feature'), 0.3));
      box.append(l, art);
      return [backdrop(ly, null, null, true), box];
    } });

    // 11. the sound of the year: the top genres by share of the year's episodes, and which way
    // each went (the last three months against the first three)
    const gen = story(s, 'genres');
    if (gen) out.push({ dur: 9, cls: 'yp-panelscene', build() {
      const v = gen.viz;
      const avg = (rows, k) => rows.reduce((a, r) => a + (r[k] || 0), 0) / Math.max(1, rows.length);
      const n3 = Math.min(3, Math.floor(v.rows.length / 2));
      const list = v.keys.map((k) => ({ k, share: avg(v.rows, k), move: avg(v.rows.slice(-n3), k) - avg(v.rows.slice(0, n3), k) }))
        .sort((a, b) => b.share - a.share).slice(0, 6);
      const max = list[0]?.share || 1;
      const chart = el('div', 'yp-genres');
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
      return [backdrop(null, 'lsd'), whitePanel({ icon: '◉', label: 'The sound of the year', title: [['The sound', 'outline'], 'of the year'], body: chart,
        foot: 'Share of the year’s episodes tagged with each genre. ▲ ▼ more or less of it by the end of the year.' })];
    } });

    // 12. tastemaker of the year
    const taste = story(s, 'tastemaker');
    if (taste) out.push({ dur: 8, track: taste.viz.rows[0], build() {
      const box = el('div', 'yp-frame yp-frame--bottom');
      box.append(rise(tape('Tastemaker of the year', 'yp-label'), 0), poster(splitLines(taste.headline, taste.headline.length > 16 ? 3 : 2), { even: true, d: 0.2, max: 0.15 }),
        rise(tape(taste.body, 'yp-tape--sub'), 0.8));
      const l = el('div', 'yp-artsplit__text'); l.append(...box.childNodes);
      box.classList.add('yp-artsplit'); box.classList.remove('yp-frame--bottom');
      box.append(l, coverGrid(taste.viz.rows.slice(0, 4), { cols: 2, d: 0.9, cls: 'yp-artsplit__art' }));
      return [backdrop(taste.viz.rows[0], null, null, true), box];
    } });

    // ---- the shows ----
    const nm = (a) => (s.names?.[a] || [])[0] || Chart.showName(a);
    // new on NTS: the count, and their pictures
    if ((s.debuts || []).length >= 3) out.push({ dur: 8, build() {
      const box = el('div', 'yp-frame yp-showsplit');
      const left = el('div', 'yp-showsplit__text');
      const big = el('div', 'yp-showcount'); big.append(counter(s.debuts.length, { d: 0.3, ms: 1300 }));
      left.append(rise(tape('New on NTS', 'yp-label'), 0), rise(big, 0.1), poster(['new shows'], { d: 0.4, max: 0.1 }),
        rise(tape(`First broadcast in ${year}${s.complete ? '' : ', so far'}.`, 'yp-tape--sub'), 0.9));
      // every new show, scattered at random across and past the frame, drifting: more than fits
      const field = el('div', 'yp-showfield');
      const shows = s.debuts.slice().sort(() => Math.random() - 0.5);
      shows.forEach((d, i) => {
        const c = el('div', 'yp-showtile');
        if (d.img) { const im = el('img'); im.alt = ''; im.src = bigPic(d.img); im.addEventListener('error', () => im.remove()); c.append(im); }
        c.append(el('span', null, d.name));
        showLink(c, d.show);
        const size = 6 + Math.random() * 8;                        // vw
        c.style.cssText = `--x:${-8 + Math.random() * 108}%;--y:${-12 + Math.random() * 112}%;--w:${size}vw;--r:${(Math.random() - 0.5) * 16}deg;--z:${Math.round(size)};--d:${0.2 + i * 0.05}s;--dr:${(Math.random() - 0.5) * 6}vw;--bg:${TINTS[i % TINTS.length]}`;
        field.append(c);
      });
      box.append(left);
      return [backdrop(null, 'safe-for-work', null, true), field, box];
    } });
    // in tune with NTS
    const words = (x) => String(x || '').toLowerCase().replace(/\bw\/.*$/, '').replace(/[^a-z0-9 ]/g, '').trim();
    const told = words(story(s, 'tastemaker')?.headline);
    const tuneS = (s.inTune || []).find((x) => !told || (!words(x.name).startsWith(told) && !told.startsWith(words(x.name))));
    if (tuneS && tuneS.count >= 5) out.push({ dur: 8, track: tuneS.tracks[0], build() {
      const box = el('div', 'yp-frame yp-artsplit');
      const l = el('div', 'yp-artsplit__text');
      l.append(rise(tape('In tune with NTS', 'yp-label'), 0), showLink(poster(splitLines(tuneS.name, tuneS.name.length > 16 ? 3 : 2), { even: true, d: 0.2, max: 0.2 }), tuneS.show));
      const n = tape('', 'yp-tape--sub'); const ahead = (s.inTune || []).filter((x) => x.count > tuneS.count);
      n.append('Played ', counter(tuneS.count, { d: 0.8, ms: 1100 }), ` of the year’s top 100 tracks. ${!ahead.length ? 'More than any other show.' : ahead.length === 1 ? `Second only to ${ahead[0].name}.` : `Only ${ahead.length} shows played more.`}`);
      l.append(rise(n, 0.7));
      box.append(l, coverGrid(tuneS.tracks.slice(0, 9), { cols: 3, d: 0.5, step: 0.09, captions: false, cls: 'yp-artsplit__art yp-mosaic' }));
      return [backdrop(tuneS.tracks[0]), box];
    } });
    // shared taste: the two shows with the most tracks in common
    const pr = s.pair;
    if (pr && pr.count >= 3) out.push({ dur: 8, track: pr.tracks?.[0], build() {
      const amp = el('div', 'yp-amp', '&');
      const n = tape('', 'yp-tape--sub'); n.append(counter(pr.count, { d: 1, ms: 1000 }), ' tracks in common, among them:');
      const box = artSplit([rise(tape('Shared taste', 'yp-label'), 0), showLink(poster(splitLines(nm(pr.a), 2), { even: true, d: 0.2, max: 0.15 }), pr.a), rise(amp, 0.45),
        showLink(poster(splitLines(nm(pr.b), 2), { even: true, d: 0.6, max: 0.15 }), pr.b), rise(n, 1)],
        coverGrid((pr.tracks || []).slice(0, 4), { cols: 2, d: 1.1, cls: 'yp-artsplit__art' }));
      return [backdrop(pr.tracks?.[0], 'the-healing-place'), box];
    } });

    // deep cuts: the tracks one show kept returning to
    if ((s.deepCuts || []).length >= 3) out.push({ dur: 9, build() {
      const box = el('div', 'yp-frame yp-deepcuts');
      box.append(rise(tape('Deep cuts', 'yp-label'), 0), poster([['One show,', 'outline'], 'on repeat'], { d: 0.15, max: 0.12, cls: 'yp-deep__title' }));
      const list = el('ol', 'yp-deep');
      s.deepCuts.forEach((t, i) => {
        const li = el('li');
        const tx = el('div', 'yp-deep__text');
        tx.append(el('span', 'yp-deep__t', t.title), el('span', 'yp-deep__a', t.artist), el('span', 'yp-deep__by', `${t.by} · ${t.episodes} times`));
        li.append(coverImg(t, 'yp-cover'), tx);
        list.append(rise(li, 0.6 + i * 0.18));
      });
      box.append(list, rise(tape('Played again and again by one show, and by no one else.', 'yp-tape--sub'), 1.8));
      return [backdrop(s.deepCuts[0], null, null, true), box];
    } });
    // the year it happened: the months, a moment pinned where an artist suddenly spread; hover one
    // for what happened, click its cover to hear it on the show that played it
    // only moments we can explain (a checked line in the context file); unexplained spikes are noise here
    const mo = (s.moments || []).filter((x) => x.t && x.text);
    if (mo.length >= 3) out.push({ dur: 12, track: mo[0].t, cls: 'yp-happened', build() {
      const box = el('div', 'yp-frame yp-happen');
      box.append(rise(tape('The year it happened', 'yp-label'), 0), poster([['What the world', 'outline'], 'did to NTS'], { d: 0.15, max: 0.1, cls: 'yp-deep__title' }));
      const line = el('div', 'yp-happen__line');
      const months = s.monthList || [];
      months.forEach((m, i) => { const tk = el('span', 'yp-happen__month', monthShort(m)); tk.style.left = `${((i + 0.5) / months.length) * 100}%`; line.append(tk); });
      const detail = el('div', 'yp-happen__detail');
      const pick = (x, pin) => {
        line.querySelectorAll('.yp-happen__pin').forEach((p) => p.classList.toggle('is-on', p === pin));
        const u = Math.round(x.usual);
        const usual = x.usual < 1 ? 'barely played' : `about ${u} show${u === 1 ? '' : 's'} a month`;
        const month = new Date(Date.UTC(+x.month.slice(0, 4), +x.month.slice(5) - 1, 15)).toLocaleDateString(undefined, { month: 'long', timeZone: 'UTC' });
        detail.replaceChildren(el('span', 'yp-happen__artist', x.artist),
          el('span', 'yp-happen__jump', `${usual} → ${x.peak} shows in ${month}`),
          x.text ? el('span', 'yp-happen__text', x.text) : el('span', 'yp-happen__text is-quiet', `Played most: ${x.t.title}`));
      };
      const used = new Map();
      mo.forEach((x, i) => {
        const mi = months.indexOf(x.month); if (mi < 0) return;
        const lane = used.get(mi) || 0; used.set(mi, lane + 1);
        const twin = mo.filter((y) => y.month === x.month).length > 1;
        const pin = el('div', 'yp-happen__pin');
        // two in a month sit side by side, either side of the month
        pin.style.left = `calc(${((mi + 0.5) / months.length) * 100}% + ${twin ? (lane ? 0.5 : -0.5) : 0} * var(--pw))`;
        pin.style.setProperty('--d', `${0.8 + i * 0.18}s`);
        pin.append(coverImg(x.t, 'yp-cover'), el('span', 'yp-happen__name', x.artist));
        pin.addEventListener('pointerenter', () => pick(x, pin));
        line.append(pin);
        if (i === 0) setTimeout(() => pick(x, pin), 0);
      });
      box.append(line, rise(detail, 1.4));
      return [backdrop(mo[0].t, 'audio-research', null, true), box];
    } });

    // the shows' characters: deepest crate, oldest record box, widest range
    if ((s.characters || []).length >= 2) out.push({ dur: 10, build() {
      const box = el('div', 'yp-frame yp-chars');
      box.append(rise(tape('The diggers', 'yp-label'), 0));
      const row = el('div', 'yp-chars__row');
      s.characters.forEach((c, i) => {
        const card = el('div', 'yp-char');
        card.append(el('span', 'yp-char__kind', c.kind), coverImg(c.t, 'yp-cover'), el('span', 'yp-char__name', c.name), el('span', 'yp-char__text', c.text));
        row.append(rise(card, 0.4 + i * 0.3));
      });
      box.append(row);
      return [backdrop(s.characters[0].t, 'audio-research', null, true), box];
    } });
    // who listens to whom: the handoffs between shows that keep repeating
    const ho = s.handoffs || [];
    if (ho.length >= 2) out.push({ dur: 11, track: ho[0].tracks[0], build() {
      const box = el('div', 'yp-frame yp-handoffs');
      box.append(rise(tape('Who listens to whom', 'yp-label'), 0), poster([['Passed', 'outline'], 'along'], { d: 0.15, max: 0.11, cls: 'yp-deep__title' }));
      const list = el('div', 'yp-ho');
      ho.forEach((h, i) => {
        const row = el('div', 'yp-ho__row');
        const names = el('div', 'yp-ho__names');
        names.append(el('span', 'yp-ho__a', h.an), el('span', 'yp-ho__arrow', '→'), el('span', 'yp-ho__b', h.bn));
        const covers = el('div', 'yp-ho__covers');
        h.tracks.forEach((t) => covers.append(coverImg(t, 'yp-cover')));
        row.append(names, el('span', 'yp-ho__n', `${h.count} tracks, about ${h.days} days later`), covers);
        list.append(rise(row, 0.6 + i * 0.25));
      });
      box.append(list, rise(tape('One show plays it, the other picks it up within three weeks. Again and again.', 'yp-tape--sub'), 2));
      return [backdrop(ho[0].tracks[0], null, null, true), box];
    } });

    // your crate: what you kept, to play now (built when you get here)
    out.push({ dur: 8, cls: 'yp-cratescene', build() {
      const box = el('div', 'yp-frame yp-crate');
      const items = [...crate.values()];
      box.append(rise(tape('Your crate', 'yp-label'), 0));
      if (!items.length) {
        box.append(poster([['Nothing', 'outline'], 'kept yet'], { d: 0.15, max: 0.14 }),
          rise(tape('Go back (←) and bookmark any cover to keep it here.', 'yp-tape--sub'), 0.6));
        return [backdrop(t1, null, null, true), box];
      }
      box.append(poster([`${items.length} to dig into`], { d: 0.15, max: 0.11 }));
      const grid = el('div', 'yp-crate__grid');
      items.forEach((t, i) => {
        const c = el('div', 'yp-crate__item');
        const links = el('div', 'yp-crate__links');
        // for diggers: Bandcamp, Discogs, YouTube (they open in the browser; the year stays open)
        try { Stage.links(t, null).filter(([n]) => ['Bandcamp', 'Discogs', 'YouTube'].includes(n)).forEach(([n, url]) => { const a = el('button', 'yp-crate__link', n); a.addEventListener('click', (e) => { e.stopPropagation(); window.nts.openLink({ web: url, apps: [] }); }); links.append(a); }); } catch {}
        c.append(coverImg(t, 'yp-cover'), el('span', 'yp-crate__t', t.title), el('span', 'yp-crate__a', `${t.artist}${t.latest?.title ? ' · from ' + t.latest.title : ''}`), links);
        grid.append(rise(c, 0.4 + i * 0.1));
      });
      box.append(grid);
      if (typeof supporter !== 'undefined' && supporter) box.append(rise(tape('Saved to your tracks in My NTS too.', 'yp-tape--sub'), 1));
      return [backdrop(items[0], null, null, true), box];
    } });

    // 13. outro
    out.push({ dur: 0, cls: 'yp-outro', build() {
      const box = el('div', 'yp-frame yp-frame--bottom');
      box.append(rise(tape(`NTS ${year} · end of tape`, 'yp-label'), 1.9), poster([['That was', 'outline'], 'the year'], { d: 2.1, max: 0.32 }));
      const acts = el('div', 'yp-actions');
      const again = el('button', 'yp-btn', 'Watch again'); again.addEventListener('click', (e) => { e.stopPropagation(); show(0, true); });
      const cards = el('button', 'yp-btn', 'Browse the cards'); cards.addEventListener('click', (e) => { e.stopPropagation(); opts.onBrowse?.(); });
      const sup = el('button', 'yp-btn yp-btn--on', 'Support NTS'); sup.addEventListener('click', (e) => { e.stopPropagation(); window.nts.openLink({ web: 'https://www.nts.live/supporters', apps: [] }); });
      acts.append(again, cards, sup);
      box.append(rise(acts, 2.9));
      const logo = el('div', 'yp-endlogo'); const im = el('img'); im.src = 'nts-logo.svg'; im.alt = 'NTS'; logo.append(im);
      return [backdrop(t1, 'sedative', null, true), box, logo];
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
    root.classList.toggle('is-panel', (sc.cls || '').includes('yp-panelscene'));
    scene.append(...sc.build());
    inkLines(scene);
    stage.replaceChildren(scene);
    const outlineGiants = () => { scene.querySelectorAll('.yp-giant-bg.is-outline').forEach((g) => vectorOutline(g, { weight: 0.012, opacity: 0.6 })); scene.querySelectorAll('.yp-amp').forEach((g) => vectorOutline(g, { weight: 0.02 })); };
    fitPosters(scene); outlineGiants();
    document.fonts?.ready.then(() => { if (scene.isConnected) { fitPosters(scene); outlineGiants(); } });
    // a tape glitch on the cut, then now and then while it plays
    root.classList.remove('is-cut'); void root.offsetWidth; root.classList.add('is-cut');
    clearTimeout(cutTimer); cutTimer = setTimeout(() => root?.classList.remove('is-cut'), 450);
    const bg = scene.querySelector('.yp-bg');
    corrupt(bg, true);
    if (!reduced()) hiss();
    clearTimeout(glitchTimer);
    const again = () => { glitchTimer = setTimeout(() => { if (!paused) corrupt(bg); if (bg?.isConnected) again(); }, 3200 + Math.random() * 6000); };   // now and then, not constantly
    again();
    root.querySelectorAll('.yp-bar').forEach((b, j) => {
      b.classList.toggle('is-done', j < at);
      b.classList.toggle('is-on', j === at);
      const fill = b.firstChild;
      fill.style.animation = 'none'; void fill.offsetWidth; fill.style.animation = '';
      fill.style.animationDuration = `${(scenes[j].dur || 1) * 1.6}s`;     // auto runs slower than the old reel
    });
    if (play) setPaused(false);
    root.classList.toggle('is-manual', !auto);
    clearTimeout(nudgeTimer);
    root.querySelector('.yp-nudge')?.classList.remove('is-on');
    if (!auto && at < scenes.length - 1) nudgeTimer = setTimeout(() => root?.querySelector('.yp-nudge')?.classList.add('is-on'), 6000);
    if (music && sc.track && playable(sc.track)) {
      const t = sc.track, k = `${t.latest.show}/${t.latest.episode}/${t.latest.offset}`;
      if (k !== playingKey) { playingKey = k; crossTo(t); }
    }
    root.querySelector('.yp-hint').hidden = at !== 1;
  }
  const next = () => { if (at < scenes.length - 1) show(at + 1); };
  const prev = () => show(at - 1);
  // Music between scenes: the old track fades down, the new one starts and fades up (like a mix,
  // not a hard cut). Uses the player's own volume (the slider's level) as the target.
  let fadeTimer = null;
  const level = () => { const v = document.getElementById('volume'); const m = document.getElementById('audio')?.muted; return m ? 0 : Number(v?.value ?? 0.8); };
  function ramp(from, to, ms, done) {
    clearInterval(fadeTimer);
    const t0 = performance.now();
    fadeTimer = setInterval(() => {
      const p = Math.min(1, (performance.now() - t0) / ms);
      ArchivePlayer.setVolume(from + (to - from) * p);
      if (p >= 1) { clearInterval(fadeTimer); done?.(); }
    }, 40);
  }
  function crossTo(t) {
    const target = level();
    const playing = ArchivePlayer.state.playing;
    const go = () => { ArchivePlayer.setVolume(0); Archive.playFrom(t.latest.show, t.latest.episode, t.latest.offset).then(() => setTimeout(() => ramp(0, target, 1100), 500)); };
    if (playing) ramp(target, 0, 450, go); else go();
  }
  // tape hiss on the hard cuts: a short burst of filtered noise, quiet
  let actx = null;
  function hiss(ms = 260, gain = 0.05) {
    try {
      actx ||= new AudioContext();
      const n = Math.floor(actx.sampleRate * ms / 1000), buf = actx.createBuffer(1, n, actx.sampleRate), d = buf.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
      const src = actx.createBufferSource(); src.buffer = buf;
      const bp = actx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 3200; bp.Q.value = 0.6;
      const g = actx.createGain(); g.gain.value = gain * level() / 0.8;
      src.connect(bp).connect(g).connect(actx.destination); src.start();
    } catch {}
  }
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
    opts = o; music = false; playingKey = null; auto = false; crate.clear();
    scenes = build(s);
    root = el('div', 'yp');
    const bars = el('div', 'yp-bars');
    scenes.forEach((sc) => { const b = el('span', 'yp-bar'); b.append(el('i')); if (!sc.dur) b.classList.add('is-last'); bars.append(b); });
    const top = el('div', 'yp-top');
    // Auto: plays itself (slower); otherwise it waits for you
    const autoBtn = el('button', 'yp-topbtn', 'Auto');
    autoBtn.setAttribute('aria-pressed', 'false');
    autoBtn.title = 'Play through by itself';
    autoBtn.addEventListener('click', (e) => { e.stopPropagation(); auto = !auto; autoBtn.setAttribute('aria-pressed', String(auto)); show(at, true); });
    const browse = el('button', 'yp-topbtn', 'Cards');
    browse.title = 'Browse the year as cards';
    browse.addEventListener('click', (e) => { e.stopPropagation(); opts.onBrowse?.(); });
    const close = el('button', 'yp-topbtn yp-close', '×');
    close.setAttribute('aria-label', 'Close');
    close.addEventListener('click', (e) => { e.stopPropagation(); opts.onClose?.(); });
    const count = el('span', 'yp-cratecount'); count.hidden = true;
    top.append(bars, count, autoBtn, browse, close);
    const stage = el('div', 'yp-stage');
    const hint = el('p', 'yp-hint', 'Take your time · click or → for the next · hover and click things to explore');
    const nudge = el('p', 'yp-nudge', 'Click to continue ›');
    root.append(stage, osd(s.year), top, hint, nudge, miniPlayer(), outlineFilters());
    // a label that follows the cursor over anything with a tip
    const tip = el('p', 'yp-tip'); root.append(tip);
    root.addEventListener('pointermove', (e) => {
      const h = e.target.closest?.('[data-tip]');
      tip.classList.toggle('is-on', !!h);
      if (h) { tip.textContent = h.dataset.tip; tip.style.left = `${e.clientX + 14}px`; tip.style.top = `${e.clientY + 18}px`; }
    });
    // the cursor: the picture drifts against it, the giant numbers the other way
    root.addEventListener('pointermove', (e) => {
      const r = root.getBoundingClientRect();
      root.style.setProperty('--mx', ((e.clientX - r.left) / r.width - 0.5).toFixed(3));
      root.style.setProperty('--my', ((e.clientY - r.top) / r.height - 0.5).toFixed(3));
    });
    jitter();
    onResize = () => root && fitPosters(root);
    window.addEventListener('resize', onResize);
    loadMoods();
    container.append(root);

    // the bar filling up is the timer: when it ends, the next scene
    bars.addEventListener('animationend', (e) => { if (auto && e.target.parentElement === bars.children[at]) next(); });
    // click: left third goes back, the rest forward; holding pauses
    let downAt = 0, holdTimer = null;
    root.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button')) return;
      downAt = Date.now();
      holdTimer = setTimeout(() => setPaused(true), 220);
    });
    root.addEventListener('pointerup', (e) => {
      clearTimeout(holdTimer);
      if (e.target.closest('button, .yp-hot') || root.querySelector('.yp-gate')) return;
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
  function stop() { clearInterval(fadeTimer); unPlayer?.(); unPlayer = null; stopInner(); }
  function stopInner() { clearInterval(clock); clearInterval(jitterTimer); clearTimeout(glitchTimer); window.removeEventListener('resize', onResize); root?.remove(); root = null; }
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
