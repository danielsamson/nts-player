// NTS world: a globe of where NTS shows broadcast from.
// Dots are places, sized by how many shows come from there. Scrub the timeline through
// the schedule (last week and the week ahead): NTS 1 and NTS 2 move around the globe,
// trailing where they broadcast from before. At "now" they pulse red.
// Drawn on a canvas, one frame at a time, so turning and playing stay smooth.
// Data: WORLD_SHOWS (snapshot of shows and places, scripts/build-world-data.js),
// WorldPlaces (place coordinates), WORLD_LAND (map), and the live NTS schedule.

const World = (() => {
  const host = $('world');
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const STEP = 15 * 60000;              // the timeline moves in 15-minute steps
  const PLAY_SPEED = 3600000 / 0.22;    // playing: an hour of schedule every 0.22 s
  const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  let built = false, active = false, dirty = true;
  let canvas, ctx, proj, geoPath, W = 0, H = 0, dpr = 1;
  let rot = [0, -25], vel = [0, 0], target = null, zoomK = 1, zoomTo = 1, lastUser = 0, dragging = false, moved = false;
  let hovered = null;
  let t = Date.now(), followNow = true, playing = false;
  let selected = null;
  const places = new Map();           // key -> { key, label, lat, lon, shows: [{ alias, name }] }
  const placeOfShow = new Map();      // alias -> place
  let nowhereShows = [];
  let sched = [];                     // { ch, start, end, title, alias, episode, place }


  // ---------- data ----------
  function indexShows() {
    for (const [alias, name, where] of WORLD_SHOWS) {
      const p = WorldPlaces.find(where);
      if (!p) { nowhereShows.push({ alias, name, where }); continue; }
      if (!places.has(p.key)) places.set(p.key, { ...p, shows: [] });
      const place = places.get(p.key);
      place.shows.push({ alias, name: unescapeHtml(name) });
      placeOfShow.set(alias, place);
    }
  }
  const placeFor = (p) => {
    if (!p) return null;
    if (!places.has(p.key)) places.set(p.key, { ...p, shows: [] });
    return places.get(p.key);
  };

  async function loadSchedule() {
    const res = await Promise.all([1, 2].map((ch) => window.nts.api(`/api/v2/radio/schedule/${ch}`).catch(() => null)));
    sched = [];
    res.forEach((r, i) => {
      for (const day of r?.results || []) for (const b of day.broadcasts || []) {
        const link = (b.links || []).find((l) => /\/shows\//.test(l.href || ''));
        const m = /\/shows\/([^/]+)(?:\/episodes\/([^/?]+))?/.exec(link?.href || '');
        const d = b.embeds?.details;
        const place = (d && placeFor(WorldPlaces.find(d.location_long, d.location_short))) || (m && placeOfShow.get(m[1])) || null;
        sched.push({ ch: i + 1, start: Date.parse(b.start_timestamp), end: Date.parse(b.end_timestamp), title: unescapeHtml(b.broadcast_title || ''),
          alias: m?.[1], episode: m?.[2], place });
      }
    });
    sched.sort((a, b) => a.start - b.start);
  }

  // What a channel is broadcasting at a time (live data wins for "now")
  function at(time, ch) {
    const b = sched.find((x) => x.ch === ch && x.start <= time && time < x.end);
    if (isNow()) {
      const d = live?.results?.[ch - 1]?.now?.embeds?.details;
      const p = d && placeFor(WorldPlaces.find(d.location_long, d.location_short));
      const title = live?.results?.[ch - 1] ? showInfo(live.results[ch - 1]).title : '';
      if (p || title) return { ...(b || {}), ch, title: title || b?.title || '', place: p || b?.place || null, live: true };
    }
    return b || null;
  }
  // Where a channel broadcast from before, newest first (one entry per move)
  function trail(time, ch, n = 6) {
    const out = [];
    const cur = at(time, ch)?.place;
    if (cur) out.push(cur);
    for (let i = sched.length - 1; i >= 0 && out.length < n; i--) {
      const x = sched[i];
      if (x.ch !== ch || x.start > time || !x.place) continue;
      if (!out.length || out[out.length - 1] !== x.place) out.push(x.place);
    }
    return out;
  }


  const isNow = () => followNow || Math.abs(t - Date.now()) < STEP;
  const fmtWhen = (ms) => new Date(ms).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const fmtTimeOnly = (ms) => new Date(ms).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

  // ---------- setup ----------
  function build() {
    if (built) return;
    built = true;
    indexShows();
    canvas = host.querySelector('.world__svg');
    ctx = canvas.getContext('2d');
    proj = d3.geoOrthographic().clipAngle(90).precision(0.6);
    geoPath = d3.geoPath(proj, ctx);
    new ResizeObserver(() => resize()).observe(canvas);
    resize();

    // drag to turn (keeps drifting a little when let go), click a place, scroll to zoom
    let last = null;
    canvas.addEventListener('pointerdown', (e) => {
      canvas.setPointerCapture(e.pointerId);
      dragging = true; moved = false; target = null; vel = [0, 0]; lastUser = Date.now();
      last = { x: e.clientX, y: e.clientY, at: performance.now() };
      canvas.classList.add('is-dragging');
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!dragging) { hoverAt(e); return; }
      const dx = e.clientX - last.x, dy = e.clientY - last.y;
      if (Math.abs(dx) + Math.abs(dy) > 2) moved = true;
      const k = 0.25 / zoomK;
      rot = [rot[0] + dx * k, clampLat(rot[1] - dy * k)];
      const dt = Math.max(1, performance.now() - last.at);
      vel = [dx * k / dt * 16, -dy * k / dt * 16];
      last = { x: e.clientX, y: e.clientY, at: performance.now() };
      lastUser = Date.now(); dirty = true;
    });
    const end = (e) => {
      if (!dragging) return;
      dragging = false; canvas.classList.remove('is-dragging'); lastUser = Date.now();
      if (!moved) { vel = [0, 0]; const p = hitTest(e); if (p) select(p); else if (selected) { selected = null; dirty = true; paintInfo(); } }
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    canvas.addEventListener('pointerleave', () => { if (hovered) { hovered = null; canvas.title = ''; canvas.style.cursor = ''; dirty = true; } });
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      lastUser = Date.now();
      zoomTo = Math.max(1, Math.min(6, zoomTo * Math.pow(1.0018, -e.deltaY)));
    }, { passive: false });

    const scrub = host.querySelector('.world__scrub');
    scrub.addEventListener('input', () => { const v = Number(scrub.value); stopPlay(); followNow = false; t = v; timeChanged(); });
    host.querySelector('.world__now').addEventListener('click', () => { stopPlay(); followNow = true; t = Date.now(); timeChanged(); });
    host.querySelector('.world__play').addEventListener('click', () => (playing ? stopPlay() : startPlay()));
  }
  const clampLat = (v) => Math.max(-75, Math.min(75, v));
  function resize() {
    const r = canvas.getBoundingClientRect();
    dpr = window.devicePixelRatio || 1;
    W = r.width; H = r.height;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    dirty = true;
  }

  // ---------- hit testing ----------
  const center = () => [-rot[0], -rot[1]];
  const facing = (p) => d3.geoDistance([p.lon, p.lat], center());
  const dotR = (p) => 1.8 + Math.sqrt(p.shows.length) * 0.9 * Math.min(1.6, Math.sqrt(zoomK));
  function hitTest(e) {
    const r = canvas.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    let best = null, bestD = Infinity;
    const cands = [...places.values()].filter((p) => p.shows.length || p === selected);
    for (const m of markers.values()) if (m.place) cands.push(m.place);
    for (const p of cands) {
      if (facing(p) > Math.PI / 2 - 0.05) continue;
      const [px, py] = proj([p.lon, p.lat]);
      const d = Math.hypot(px - x, py - y);
      if (d < Math.max(8, dotR(p) + 4) && d < bestD) { best = p; bestD = d; }
    }
    return best;
  }
  function hoverAt(e) {
    const p = hitTest(e);
    if (p === hovered) return;
    hovered = p;
    canvas.style.cursor = p ? 'pointer' : '';
    canvas.title = p ? `${p.label} · ${p.shows.length} show${p.shows.length === 1 ? '' : 's'}` : '';
    dirty = true;
  }

  // ---------- channels: markers glide from place to place ----------
  const markers = new Map();     // ch -> { place, from: [lon, lat], to: [lon, lat], at }
  let chanKey = '';
  function syncChannels() {
    const now = [1, 2].map((ch) => at(t, ch));
    for (const b of now) {
      if (!b) continue;
      const m = markers.get(b.ch);
      const to = b.place ? [b.place.lon, b.place.lat] : null;
      if (!m) { markers.set(b.ch, { place: b.place, from: to, to, at: 0 }); continue; }
      if (m.place !== b.place) {
        const from = markerPos(m) || to;
        markers.set(b.ch, { place: b.place, from, to, at: performance.now() });
      }
    }
    // a different show on air: refresh the panel and face the channels
    const key = now.map((b) => `${b?.ch}|${b?.title}|${b?.place?.key}`).join('/') + isNow();
    if (key !== chanKey) { chanKey = key; if (!selected) paintInfo(); if (Date.now() - lastUser > 2500) focusOnChannels(); }
  }
  const ease = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
  function markerPos(m) {
    if (!m?.to) return null;
    if (!m.from || reduceMotion()) return m.to;
    const k = Math.min(1, (performance.now() - m.at) / 900);
    return k >= 1 ? m.to : d3.geoInterpolate(m.from, m.to)(ease(k));
  }

  // ---------- the frame loop ----------
  let raf = 0, prev = 0, lastPanel = 0;
  const shownLabels = new Map();     // place key -> opacity (labels fade in and out)
  function frame(ts) {
    raf = 0;
    if (!active) return;
    const dt = Math.min(64, prev ? ts - prev : 16);
    prev = ts;
    let moving = false;

    if (playing) {
      t += (dt / 1000) * PLAY_SPEED;
      const max = sched.length ? sched[sched.length - 1].end : t;
      if (t >= max) { t = max; stopPlay(); }
      if (ts - lastPanel > 120) { lastPanel = ts; paintTime(); }
      syncChannels();
      moving = true;
    } else if (followNow && ts - lastPanel > 30000) { lastPanel = ts; t = Date.now(); paintTime(); syncChannels(); }

    // drift after a drag, ease toward a place, or turn slowly when left alone
    if (!dragging && (Math.abs(vel[0]) > 0.005 || Math.abs(vel[1]) > 0.005)) {
      rot = [rot[0] + vel[0] * dt / 16, clampLat(rot[1] + vel[1] * dt / 16)];
      const decay = Math.pow(0.92, dt / 16);
      vel = [vel[0] * decay, vel[1] * decay];
      moving = true;
    } else if (target && !dragging) {
      const k = 1 - Math.pow(1 - 0.06, dt / 16);
      const dx = ((target[0] - rot[0] + 540) % 360) - 180, dy = target[1] - rot[1];
      if (Math.abs(dx) < 0.03 && Math.abs(dy) < 0.03) target = null;
      else { rot = [rot[0] + dx * k, rot[1] + dy * k]; moving = true; }
    } else if (!dragging && Date.now() - lastUser > 8000 && !reduceMotion()) {
      rot = [rot[0] + 0.004 * dt, rot[1]];
      moving = true;
    }
    if (Math.abs(zoomTo - zoomK) > 0.001) { zoomK += (zoomTo - zoomK) * (1 - Math.pow(0.8, dt / 16)); moving = true; }
    for (const m of markers.values()) if (m.at && performance.now() - m.at < 950) moving = true;
    const pulsing = isNow() && markers.size && !reduceMotion();

    if (moving || pulsing || dirty || labelsFading) render(ts, dt);
    dirty = false;
    raf = requestAnimationFrame(frame);
  }
  function kick() { if (!raf && active) { prev = 0; raf = requestAnimationFrame(frame); } }

  // ---------- drawing ----------
  let labelsFading = false;
  function render(ts, dt) {
    if (!W || !H) return;
    const R = (Math.min(W, H) / 2 - 14) * zoomK;
    proj.translate([W / 2, H / 2]).scale(R).rotate(rot);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    // the sphere, lit softly from the top left
    const g = ctx.createRadialGradient(W / 2 - R * 0.35, H / 2 - R * 0.35, R * 0.1, W / 2, H / 2, R);
    g.addColorStop(0, '#161616'); g.addColorStop(1, '#060606');
    ctx.beginPath(); geoPath({ type: 'Sphere' }); ctx.fillStyle = g; ctx.fill();
    ctx.lineWidth = 1; ctx.strokeStyle = '#333'; ctx.stroke();
    ctx.beginPath(); geoPath(graticule); ctx.lineWidth = 0.6; ctx.strokeStyle = '#1b1b1b'; ctx.stroke();
    ctx.beginPath(); geoPath(WORLD_LAND); ctx.fillStyle = '#272727'; ctx.fill(); ctx.lineWidth = 0.5; ctx.strokeStyle = '#3a3a3a'; ctx.stroke();

    // trails: where each channel broadcast from before, fading with age
    ctx.setLineDash([3, 3]);
    for (const ch of [1, 2]) {
      const pts = trail(t, ch);
      const head = markerPos(markers.get(ch));
      for (let i = 0; i + 1 < pts.length; i++) {
        const a = i === 0 && head ? head : [pts[i].lon, pts[i].lat];
        ctx.beginPath(); geoPath({ type: 'LineString', coordinates: [a, [pts[i + 1].lon, pts[i + 1].lat]] });
        ctx.globalAlpha = Math.max(0.12, 0.75 - i * 0.14);
        ctx.strokeStyle = ch === 1 ? '#fff' : '#999'; ctx.lineWidth = 1.4; ctx.stroke();
      }
    }
    ctx.setLineDash([]); ctx.globalAlpha = 1;

    // places: fade out toward the edge of the globe instead of popping
    const limb = (p) => Math.max(0, Math.min(1, (Math.PI / 2 - facing(p)) / 0.3));
    const list = [...places.values()].filter((p) => p.shows.length || p === selected);
    for (const p of list) {
      const a = limb(p);
      if (a <= 0) continue;
      const [x, y] = proj([p.lon, p.lat]);
      const on = p === selected || p === hovered;
      ctx.beginPath(); ctx.arc(x, y, dotR(p), 0, Math.PI * 2);
      ctx.globalAlpha = a * (on ? 1 : 0.6); ctx.fillStyle = on ? '#fff' : '#ccc'; ctx.fill();
      ctx.lineWidth = on ? 1.5 : 0.8; ctx.strokeStyle = on ? '#fff' : '#000'; ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // labels: the channels' places, selected/hovered, then the biggest. Ones already showing
    // keep their spot (no flicker); they fade in and out.
    const chPlaces = [...markers.values()].map((m) => m.place).filter(Boolean);
    ctx.font = '700 10px "NTS Condensed", "Arial Narrow", Arial, sans-serif';
    const ranked = [...new Set([...chPlaces, selected, hovered,
      ...[...shownLabels.keys()].map((k) => places.get(k)).filter((p) => p && shownLabels.get(p.key) > 0.5),
      ...list.slice().sort((a, b) => b.shows.length - a.shows.length).slice(0, 50)])].filter((p) => p && limb(p) > 0.15);
    const kept = [], want = new Set();
    const maxLabels = 14 + Math.round(zoomK * 6);
    for (const p of ranked) {
      const [x, y] = proj([p.lon, p.lat]);
      const text = p.label.toUpperCase();
      const w = ctx.measureText(text).width + 6;
      const bx = { x: x + dotR(p) + 3, y: y - 7, w, h: 14, p, text };
      if (kept.some((k) => bx.x < k.x + k.w && k.x < bx.x + bx.w && bx.y < k.y + k.h && k.y < bx.y + bx.h)) continue;
      kept.push(bx); want.add(p.key);
      if (kept.length >= maxLabels) break;
    }
    labelsFading = false;
    const step = (dt || 16) / 220;
    for (const p of list.concat(chPlaces)) {
      const cur = shownLabels.get(p.key) || 0;
      const next = want.has(p.key) ? Math.min(1, cur + step) : Math.max(0, cur - step);
      if (next !== cur) labelsFading = true;
      if (next > 0) shownLabels.set(p.key, next); else shownLabels.delete(p.key);
    }
    ctx.lineJoin = 'round'; ctx.textBaseline = 'middle';
    for (const [k, o] of shownLabels) {
      const p = places.get(k);
      if (!p) continue;
      const a = o * limb(p);
      if (a <= 0.01) continue;
      const [x, y] = proj([p.lon, p.lat]);
      const text = p.label.toUpperCase();
      ctx.globalAlpha = a;
      ctx.lineWidth = 3; ctx.strokeStyle = '#000'; ctx.strokeText(text, x + dotR(p) + 4, y);
      ctx.fillStyle = chPlaces.includes(p) || p === selected ? '#fff' : '#ccc'; ctx.fillText(text, x + dotR(p) + 4, y);
    }
    ctx.globalAlpha = 1;

    // the channels
    const live = isNow();
    const pos = [1, 2].map((ch) => ({ ch, m: markers.get(ch), at: markerPos(markers.get(ch)) })).filter((x) => x.at);
    const same = pos.length === 2 && d3.geoDistance(pos[0].at, pos[1].at) < 0.002;
    for (const { ch, at: ll } of pos) {
      if (d3.geoDistance(ll, center()) > Math.PI / 2 - 0.02) continue;
      let [x, y] = proj(ll);
      if (same) x += ch === 1 ? -8 : 8;
      if (live && !reduceMotion()) {
        const ph = (((ts || 0) + (ch === 2 ? 1000 : 0)) % 2000) / 2000;
        ctx.beginPath(); ctx.arc(x, y, 6 + ph * 16, 0, Math.PI * 2);
        ctx.globalAlpha = (1 - ph) * 0.9; ctx.strokeStyle = '#f00'; ctx.lineWidth = 1; ctx.stroke();
        ctx.globalAlpha = 1;
      }
      ctx.beginPath(); ctx.arc(x, y, 6, 0, Math.PI * 2);
      ctx.fillStyle = live ? '#f00' : '#fff'; ctx.fill();
      ctx.lineWidth = 1.5; ctx.strokeStyle = '#000'; ctx.stroke();
      ctx.font = '700 8px "NTS Condensed", "Arial Narrow", Arial, sans-serif';
      ctx.textAlign = 'center'; ctx.fillStyle = live ? '#fff' : '#000'; ctx.fillText(String(ch), x, y + 0.5);
      ctx.textAlign = 'start';
    }
  }
  const graticule = d3.geoGraticule10();

  // ---------- motion targets ----------
  function focusOn(p) { if (p) { target = [-p.lon, clampLat(-p.lat * 0.8)]; kick(); } }
  function focusOnChannels() {
    const ps = [1, 2].map((ch) => at(t, ch)?.place).filter(Boolean);
    if (!ps.length) return;
    if (ps.length === 2 && d3.geoDistance([ps[0].lon, ps[0].lat], [ps[1].lon, ps[1].lat]) < 2) {
      const [lon, lat] = d3.geoInterpolate([ps[0].lon, ps[0].lat], [ps[1].lon, ps[1].lat])(0.5);
      focusOn({ lon, lat });
    } else focusOn(ps[0]);
  }

  // ---------- timeline ----------
  function timeChanged() { syncChannels(); paintTime(); dirty = true; kick(); }
  function paintTime() {
    const scrub = host.querySelector('.world__scrub');
    if (sched.length) {
      scrub.min = Math.floor(sched[0].start / STEP) * STEP;
      scrub.max = Math.ceil(sched[sched.length - 1].end / STEP) * STEP;
      scrub.step = STEP;
      if (followNow) t = Date.now();
      scrub.value = t;
      scrub.style.setProperty('--fill', `${((t - scrub.min) / (scrub.max - scrub.min)) * 100}%`);
      const pct = ((Date.now() - scrub.min) / (scrub.max - scrub.min)) * 100;
      host.querySelector('.world__nowmark').style.left = `calc(16px + (100% - 32px) * ${Math.max(0, Math.min(100, pct)) / 100})`;
    }
    host.querySelector('.world__when').textContent = isNow() ? 'Live now' : fmtWhen(t);
    host.querySelector('.world__now').hidden = isNow();
    host.querySelector('.world__play').textContent = playing ? 'Pause' : '▶ Play the week';
  }
  function paintDays() {
    const box = host.querySelector('.world__days');
    if (!sched.length) { box.replaceChildren(); return; }
    const min = sched[0].start, max = sched[sched.length - 1].end;
    const days = [];
    const d = new Date(min); d.setHours(0, 0, 0, 0);
    for (; d.getTime() < max; d.setDate(d.getDate() + 1)) {
      const left = ((Math.max(min, d.getTime() + 43200000) - min) / (max - min)) * 100;   // midday
      const s = el('span', 'world__day', d.toLocaleDateString(undefined, { weekday: 'narrow' }));
      s.style.left = `${left}%`;
      days.push(s);
    }
    box.replaceChildren(...days);
  }
  function startPlay() {
    if (!sched.length) return;
    followNow = false;
    const max = sched[sched.length - 1].end;
    if (t >= max - STEP) t = sched[0].start;
    playing = true;
    paintTime(); kick();
  }
  function stopPlay() { if (!playing) return; playing = false; paintTime(); if (!selected) paintInfo(); }

  // ---------- panel ----------
  function select(p) { selected = p; focusOn(p); dirty = true; paintInfo(); }
  function chRow(b) {
    const row = el('div', 'world__row');
    const num = el('span', 'world__chnum', String(b.ch));
    if (b.live && isNow()) num.classList.add('is-live');
    const text = el('button', 'world__rowtext');
    text.append(el('span', 'world__rowtitle', b.title || 'Off air'), el('span', 'world__rowsub',
      [b.place?.label || 'Somewhere', b.start && !b.live ? `${fmtTimeOnly(b.start)}–${fmtTimeOnly(b.end)}` : ''].filter(Boolean).join(' · ')));
    text.addEventListener('click', () => (b.place ? select(b.place) : b.alias && Archive.showShow(b.alias)));
    row.append(num, text);
    return row;
  }
  function paintInfo() {
    const box = host.querySelector('.world__info');
    box.replaceChildren();
    if (selected) {
      const p = selected;
      const head = el('div', 'world__head');
      const close = el('button', 'world__close', '×');
      close.setAttribute('aria-label', 'Close');
      close.addEventListener('click', () => { selected = null; dirty = true; kick(); paintInfo(); });
      head.append(el('p', 'world__title', p.label), close);
      box.append(head, el('p', 'world__sub', `${p.shows.length} show${p.shows.length === 1 ? '' : 's'} based here, all time`));
      const upcoming = sched.filter((b) => b.place === p && b.end > Date.now()).slice(0, 3);
      if (upcoming.length) {
        box.append(el('p', 'world__label-sm', 'Coming up from here'));
        const list = el('div', 'world__upcoming');
        upcoming.forEach((b) => {
          const r = el('button', 'world__up');
          r.append(el('span', 'world__uptime', `${new Date(b.start).toLocaleDateString(undefined, { weekday: 'short' })} ${fmtTimeOnly(b.start)} · NTS ${b.ch}`), el('span', 'world__uptitle', b.title));
          r.addEventListener('click', () => { stopPlay(); followNow = false; t = b.start; timeChanged(); });
          list.append(r);
        });
        box.append(list);
      }
      // shows on the schedule this week first, then the rest alphabetically; 10 to start
      const onAir = new Set(sched.filter((b) => b.place === p).map((b) => b.alias));
      const shows = p.shows.slice().sort((a, b) => (onAir.has(b.alias) - onAir.has(a.alias)) || a.name.localeCompare(b.name));
      box.append(el('p', 'world__label-sm', 'Shows'));
      const list = el('div', 'world__shows');
      const paint = (n) => {
        list.replaceChildren(...shows.slice(0, n).map((s) => {
          const b = el('button', 'world__show', s.name);
          b.addEventListener('click', () => Archive.showShow(s.alias));
          return b;
        }));
        if (shows.length > n) {
          const more = el('button', 'world__more', `All ${shows.length} shows`);
          more.addEventListener('click', () => paint(shows.length));
          list.append(more);
        }
      };
      paint(10);
      box.append(list);
      return;
    }
    const chans = [1, 2].map((ch) => at(t, ch) || { ch, title: '' });
    box.append(...chans.map(chRow));
    const top = [...places.values()].sort((a, b) => b.shows.length - a.shows.length).slice(0, 6);
    const total = [...places.values()].reduce((n, p) => n + p.shows.length, 0);
    box.append(el('p', 'world__hint', `${total.toLocaleString()} shows from ${[...places.values()].filter((p) => p.shows.length).length} places, plus ${nowhereShows.length} from everywhere and nowhere. `
      + `Most: ${top.map((p) => `${p.label} ${p.shows.length}`).join(' · ')}. Click a place for its shows. Drag to turn, scroll to zoom.`));
  }

  return {
    async show() {
      active = true;
      build();
      resize(); paintInfo(); kick();
      if (!sched.length) {
        host.querySelector('.world__when').textContent = 'Loading the schedule…';
        await loadSchedule().catch(() => {});
        paintDays(); timeChanged(); focusOnChannels(); paintInfo();
      } else timeChanged();
    },
    hide() { active = false; stopPlay(); },
    // live info changed (new show on air)
    refresh() { if (active) { syncChannels(); dirty = true; } }
  };
})();
