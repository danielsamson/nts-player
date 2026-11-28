// The NTS map (prototype): every show placed by what it plays, grouped into zones that read
// like islands. From charts/map.json (scripts/map.js, worked out daily). Drag to move, scroll
// or +/- to zoom, hover for a show, click to hear its latest episode. Esc closes.

const NtsMap = (() => {
  let box = null, cv = null, ctx = null, data = null, opener = null;
  let view = { x: 0.5, y: 0.5, z: 1 };       // map point at the centre, zoom (1 = whole map fits)
  let target = null;                         // flying to { x, y, z }
  let hover = -1, picked = -1, raf = 0, t0 = 0, dirty = true;
  let onAir = [], follows = new Set();
  const pics = new Map();                    // slug -> Image, loaded as you zoom in
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const dpr = () => Math.min(2, window.devicePixelRatio || 1);
  const name = (s) => data?.info?.[s]?.[0] || s.replace(/-/g, ' ');
  const big = (u) => String(u || '').replace(/\/\/media\d?\.ntslive\.co\.uk\/resize\/(100x100|200x200)\//, '//media.ntslive.co.uk/resize/400x400/');

  // map <-> screen
  const scale = () => Math.min(cv.clientWidth, cv.clientHeight) * view.z;
  const toScreen = (x, y) => [(x - view.x) * scale() + cv.clientWidth / 2, (y - view.y) * scale() + cv.clientHeight / 2];
  const toMap = (sx, sy) => [(sx - cv.clientWidth / 2) / scale() + view.x, (sy - cv.clientHeight / 2) / scale() + view.y];

  // ---- drawing ----
  // the zones: soft fields of light under the shows, drawn small and blurred so they run together
  let field = null, fieldKey = '';
  function drawField(time) {
    const w = Math.ceil(cv.clientWidth / 4), h = Math.ceil(cv.clientHeight / 4);
    if (!field) field = document.createElement('canvas');
    if (field.width !== w || field.height !== h) { field.width = w; field.height = h; fieldKey = ''; }
    const key = `${view.x.toFixed(4)},${view.y.toFixed(4)},${view.z.toFixed(3)},${w},${h},${Math.floor(time / 120)}`;
    if (key !== fieldKey) {
      fieldKey = key;
      const f = field.getContext('2d');
      f.clearRect(0, 0, w, h);
      const s = scale() / 4;
      const r = Math.max(6, Math.min(60, 0.03 * s));
      f.globalCompositeOperation = 'lighter';
      data.shows.forEach(([, x, y, zone], i) => {
        const [sx, sy] = toScreen(x, y);
        // each zone breathes slightly out of step with the others
        const br = 1 + 0.12 * Math.sin(time / 2600 + zone * 1.7);
        const g = f.createRadialGradient(sx / 4, sy / 4, 0, sx / 4, sy / 4, r * br);
        const a = 0.05 + 0.03 * (zone % 3);
        g.addColorStop(0, `rgba(255,255,255,${a})`); g.addColorStop(1, 'rgba(255,255,255,0)');
        f.fillStyle = g;
        f.fillRect(sx / 4 - r * br, sy / 4 - r * br, r * br * 2, r * br * 2);
      });
    }
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.globalAlpha = Math.max(0.15, Math.min(1, 1.5 - view.z * 0.2));   // the fields give way to the shows as you zoom in
    ctx.filter = 'blur(6px)';
    ctx.drawImage(field, 0, 0, cv.clientWidth, cv.clientHeight);
    ctx.restore();
  }

  function draw(time) {
    const W = cv.clientWidth, H = cv.clientHeight;
    ctx.setTransform(dpr(), 0, 0, dpr(), 0, 0);
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
    drawField(time);
    const s = scale();
    // faint lines between close shows, when zoomed in a little
    if (view.z > 1.6) {
      ctx.strokeStyle = `rgba(255,255,255,${Math.min(0.12, (view.z - 1.6) * 0.06)})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (const [i, j] of data.links) {
        const a = toScreen(data.shows[i][1], data.shows[i][2]), b = toScreen(data.shows[j][1], data.shows[j][2]);
        if ((a[0] < 0 && b[0] < 0) || (a[0] > W && b[0] > W) || (a[1] < 0 && b[1] < 0) || (a[1] > H && b[1] > H)) continue;
        ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]);
      }
      ctx.stroke();
    }
    // the hovered or picked show's neighbours
    const focus = picked >= 0 ? picked : hover;
    const near = new Set();
    if (focus >= 0) for (const [i, j] of data.links) { if (i === focus) near.add(j); if (j === focus) near.add(i); }
    if (focus >= 0) {
      ctx.strokeStyle = 'rgba(255,255,255,.5)'; ctx.beginPath();
      const a = toScreen(data.shows[focus][1], data.shows[focus][2]);
      near.forEach((j) => { const b = toScreen(data.shows[j][1], data.shows[j][2]); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); });
      ctx.stroke();
    }
    // shows: dots, then their pictures once there's room
    const picSize = Math.min(64, 0.012 * s);
    data.shows.forEach(([slug, x, y, , , w], i) => {
      const [sx, sy] = toScreen(x, y);
      if (sx < -40 || sx > W + 40 || sy < -40 || sy > H + 40) return;
      if (picSize >= 22) {
        const im = target ? pics.get(slug) : pic(slug);      // wait for a zoom to settle before asking
        if (im?.complete && im.naturalWidth) {
          ctx.globalAlpha = focus >= 0 && i !== focus && !near.has(i) ? 0.35 : 1;
          ctx.drawImage(im, sx - picSize / 2, sy - picSize / 2, picSize, picSize);
          ctx.globalAlpha = 1;
          if (i === focus) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.strokeRect(sx - picSize / 2 - 2, sy - picSize / 2 - 2, picSize + 4, picSize + 4); }
          return;
        }
      }
      const r = (0.8 + w / 9) * Math.min(2.2, Math.sqrt(view.z));
      ctx.fillStyle = i === focus ? '#fff' : near.has(i) ? 'rgba(255,255,255,.95)' : focus >= 0 ? 'rgba(255,255,255,.35)' : 'rgba(255,255,255,.8)';
      ctx.beginPath(); ctx.arc(sx, sy, i === focus ? r + 2 : r, 0, 7); ctx.fill();
    });
    // live now: a slow pulse; shows you follow: a ring
    const pulse = (time % 2400) / 2400;
    onAir.forEach(({ i, ch }) => {
      const [sx, sy] = toScreen(data.shows[i][1], data.shows[i][2]);
      ctx.strokeStyle = `rgba(255,255,255,${1 - pulse})`; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(sx, sy, 6 + pulse * 28, 0, 7); ctx.stroke();
      ctx.fillStyle = '#fff'; ctx.font = '700 11px "NTS Condensed", "Arial Narrow", sans-serif';
      ctx.textAlign = 'left'; ctx.fillText(`NTS ${ch} NOW`, sx + 10, sy - 8);
    });
    ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.lineWidth = 1;
    follows.forEach((i) => { const [sx, sy] = toScreen(data.shows[i][1], data.shows[i][2]); ctx.beginPath(); ctx.arc(sx, sy, 7, 0, 7); ctx.stroke(); });
    // labels: zones from afar, finer zones closer in, show names closest
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    placed = [];
    const zoneA = Math.max(0, Math.min(1, 2.2 - view.z)), subA = Math.max(0, Math.min(1, (view.z - 1.5) * 1.2)) * Math.max(0, Math.min(1, 5 - view.z));
    if (zoneA > 0) data.zones.forEach(([x, y, artists]) => label(toScreen(x, y), artists.slice(0, 3).join(' / '), 15, zoneA));
    if (subA > 0) data.subs.forEach(([x, y, artists, n]) => { if (n >= 6) label(toScreen(x, y), artists.slice(0, 2).join(' / '), 12, subA * 0.9); });
    if (view.z >= 4) data.shows.forEach(([slug, x, y], i) => {
      if (i === focus) return;
      const [sx, sy] = toScreen(x, y);
      if (sx < 0 || sx > W || sy < 0 || sy > H) return;
      const t = name(slug).toUpperCase().slice(0, 28);
      ctx.font = '700 10px "NTS Condensed", "Arial Narrow", sans-serif';
      const w = ctx.measureText(t).width, ty = sy + Math.max(picSize, 8) / 2 + 9;
      const r = [sx - w / 2, ty - 6, sx + w / 2, ty + 6];
      if (placed.some((p) => r[0] < p[2] && r[2] > p[0] && r[1] < p[3] && r[3] > p[1])) return;
      placed.push(r);
      ctx.fillStyle = 'rgba(255,255,255,.75)'; ctx.fillText(t, sx, ty);
    });
    if (focus >= 0) { const [sx, sy] = toScreen(data.shows[focus][1], data.shows[focus][2]); label([sx, sy - Math.max(picSize, 12) / 2 - 14], name(data.shows[focus][0]), 13, 1, true); }
  }
  let placed = [];                           // labels drawn this frame, so they don't pile up
  function label([x, y], text, size, alpha, solid) {
    ctx.font = `700 ${size}px "NTS Condensed", "Arial Narrow", sans-serif`;
    const t = text.toUpperCase();
    const w = ctx.measureText(t).width;
    const r = [x - w / 2 - 5, y - size / 2 - 4, x + w / 2 + 5, y + size / 2 + 4];
    if (!solid && placed.some((p) => r[0] < p[2] && r[2] > p[0] && r[1] < p[3] && r[3] > p[1])) return;
    placed.push(r);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = solid ? '#fff' : 'rgba(0,0,0,.72)';
    ctx.fillRect(x - w / 2 - 5, y - size / 2 - 4, w + 10, size + 8);
    ctx.fillStyle = solid ? '#000' : '#fff';
    ctx.fillText(t, x, y + 1);
    ctx.globalAlpha = 1;
  }
  // pictures load a few at a time, newest first, skipping ones that have gone off screen
  const queue = [];
  let loading = 0;
  function pic(slug) {
    if (pics.has(slug)) return pics.get(slug);
    if (!data.info?.[slug]?.[1]) return null;
    pics.set(slug, null);
    queue.push(slug);
    pump();
    return null;
  }
  function onScreen(slug) {
    const r = data.shows.find((x) => x[0] === slug);
    if (!r || !cv) return false;
    const [sx, sy] = toScreen(r[1], r[2]);
    return sx > -60 && sx < cv.clientWidth + 60 && sy > -60 && sy < cv.clientHeight + 60;
  }
  function pump() {
    while (loading < 6 && queue.length) {
      const slug = queue.pop();
      if (!onScreen(slug)) { pics.delete(slug); continue; }      // asked for again if it comes back
      loading++;
      const im = new Image(); im.decoding = 'async';
      const done = () => { loading--; dirty = true; pump(); };
      im.onload = done; im.onerror = done;
      im.src = String(data.info[slug][1]).replace(/\/\/media\d?\.ntslive\.co\.uk\/resize\/\d+x\d+\//, '//media.ntslive.co.uk/resize/200x200/');   // the main host; the others refuse
      pics.set(slug, im);
    }
  }

  // ---- loop: redraws while something moves; the fields breathe slowly regardless ----
  function loop(time) {
    raf = requestAnimationFrame(loop);
    if (target) {
      const k = 0.12;
      view.x += (target.x - view.x) * k; view.y += (target.y - view.y) * k; view.z *= Math.pow(target.z / view.z, k);
      if (Math.abs(target.x - view.x) < 1e-4 && Math.abs(target.y - view.y) < 1e-4 && Math.abs(target.z / view.z - 1) < 1e-3) target = null;
      dirty = true;
    }
    // live pulses and breathing need a steady, gentle frame rate; otherwise only when asked
    if (!dirty && time - t0 < (onAir.length ? 33 : 120)) return;
    t0 = time; dirty = false;
    draw(time);
  }
  const fly = (x, y, z) => { target = { x, y, z: Math.max(0.8, Math.min(14, z)) }; };

  // ---- the card for a picked show ----
  function pick(i) {
    picked = i; dirty = true;
    const card = box.querySelector('.ntsmap__card');
    if (i < 0) { card.hidden = true; return; }
    const [slug, , , zone, sub] = data.shows[i];
    const img = card.querySelector('img');
    img.src = big(data.info?.[slug]?.[1]);
    card.classList.toggle('ntsmap__card--nopic', !data.info?.[slug]?.[1]);
    card.querySelector('.ntsmap__name').textContent = name(slug);
    const z = data.subs[sub] || data.zones[zone];
    card.querySelector('.ntsmap__zone').textContent = `Near ${z[2].slice(0, 3).join(', ')}`;
    card.querySelector('.ntsmap__status').textContent = data.active?.includes(slug) ? '' : 'In the archive';
    card.hidden = false;
  }
  async function playLatest(slug) {
    const btn = box.querySelector('.ntsmap__play');
    btn.textContent = 'Loading…';
    try {
      const res = await window.nts.api(`/api/v2/shows/${slug}/episodes?limit=1`);
      const ep = res.results?.[0];
      if (ep) await Archive.playFrom(slug, ep.episode_alias, 0);
    } catch {}
    btn.textContent = '▶ Play the latest';
  }
  // drift: somewhere next door, then play it
  function drift() {
    const from = picked >= 0 ? picked : Math.floor(Math.random() * data.shows.length);
    const sub = data.shows[from][4];
    const near = data.links.filter(([i, j]) => i === from || j === from).map(([i, j]) => (i === from ? j : i));
    const pool = near.filter((j) => data.shows[j][4] !== sub && data.active?.includes(data.shows[j][0]));
    const options = pool.length ? pool : near.length ? near : data.shows.map((_, j) => j);
    const j = options[Math.floor(Math.random() * options.length)];
    fly(data.shows[j][1], data.shows[j][2], Math.max(view.z, 3.2));
    pick(j);
    playLatest(data.shows[j][0]);
  }
  // find: a show by name, or an artist (where the shows that play them most sit)
  async function find(q) {
    const want = Chart.norm(q);
    if (!want) return;
    const i = data.shows.findIndex(([s]) => Chart.norm(name(s)) === want) >= 0 ? data.shows.findIndex(([s]) => Chart.norm(name(s)) === want) : data.shows.findIndex(([s]) => Chart.norm(name(s)).startsWith(want));
    const res = await Archive.artist(q).catch(() => null);
    const at = new Map(data.shows.map((r, k) => [r[0], k]));
    const where = (res?.x?.top || []).map(([s, c]) => [at.get(s), c]).filter(([k]) => k != null);
    const status = box.querySelector('.ntsmap__found');
    if (where.length) {
      const tot = where.reduce((a, [, c]) => a + c, 0);
      const x = where.reduce((a, [k, c]) => a + data.shows[k][1] * c, 0) / tot, y = where.reduce((a, [k, c]) => a + data.shows[k][2] * c, 0) / tot;
      fly(x, y, 3);
      pick(where[0][0]);
      status.textContent = `${res.x.name}: played most on ${where.slice(0, 3).map(([k]) => name(data.shows[k][0])).join(', ')}`;
    } else if (i >= 0) {
      fly(data.shows[i][1], data.shows[i][2], 4); pick(i); status.textContent = '';
    } else status.textContent = `Couldn’t find ${q} on the map`;
  }

  // ---- input ----
  function bind() {
    let drag = null, moved = false;
    cv.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y }; moved = false; cv.setPointerCapture(e.pointerId); });
    cv.addEventListener('pointermove', (e) => {
      const r = cv.getBoundingClientRect();
      if (drag) {
        const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
        if (Math.abs(dx) + Math.abs(dy) > 3) moved = true;
        view.x = drag.vx - dx / scale(); view.y = drag.vy - dy / scale(); target = null; dirty = true;
        return;
      }
      // nearest show within reach
      const [mx, my] = [e.clientX - r.left, e.clientY - r.top];
      let best = -1, bd = 16 * 16;
      data.shows.forEach(([, x, y], i) => { const [sx, sy] = toScreen(x, y); const d = (sx - mx) ** 2 + (sy - my) ** 2; if (d < bd) { bd = d; best = i; } });
      if (best !== hover) { hover = best; dirty = true; cv.style.cursor = best >= 0 ? 'pointer' : 'grab'; }
    });
    cv.addEventListener('pointerup', () => { if (!moved) pick(hover); drag = null; });
    cv.addEventListener('pointerleave', () => { hover = -1; dirty = true; });
    cv.addEventListener('wheel', (e) => {
      e.preventDefault();
      const r = cv.getBoundingClientRect();
      const [mx, my] = toMap(e.clientX - r.left, e.clientY - r.top);
      const z = Math.max(0.8, Math.min(14, view.z * Math.exp(-e.deltaY * 0.0015)));
      // zoom towards the cursor
      view.x = mx - (mx - view.x) * (view.z / z); view.y = my - (my - view.y) * (view.z / z); view.z = z;
      target = null; dirty = true;
    }, { passive: false });
    new ResizeObserver(size).observe(cv);
  }
  function size() {
    cv.width = Math.round(cv.clientWidth * dpr()); cv.height = Math.round(cv.clientHeight * dpr());
    dirty = true;
  }
  const onKey = (e) => {
    if (!box) return;
    if (e.target.tagName === 'INPUT' && e.key !== 'Escape') return;
    const step = 0.08 / view.z;
    if (e.key === 'Escape') { if (picked >= 0) pick(-1); else close(); }
    else if (e.key === 'Tab') { window.trapTab?.(box, e); e.stopPropagation(); return; }
    else if (e.key === '+' || e.key === '=') fly(view.x, view.y, view.z * 1.6);
    else if (e.key === '-') fly(view.x, view.y, view.z / 1.6);
    else if (e.key === 'ArrowLeft') fly(view.x - step, view.y, view.z);
    else if (e.key === 'ArrowRight') fly(view.x + step, view.y, view.z);
    else if (e.key === 'ArrowUp') fly(view.x, view.y - step, view.z);
    else if (e.key === 'ArrowDown') fly(view.x, view.y + step, view.z);
    else return;
    e.preventDefault(); e.stopPropagation();
  };

  async function open() {
    if (box) return;
    opener = document.activeElement;
    box = el('div', 'ntsmap');
    box.tabIndex = -1;
    box.setAttribute('role', 'dialog'); box.setAttribute('aria-label', 'The NTS map');
    box.innerHTML = `<div class="ntsmap__top">
        <span class="ntsmap__title">The NTS map</span>
        <form class="ntsmap__find"><input type="search" placeholder="Find an artist or show" aria-label="Find an artist or show" spellcheck="false"></form>
        <button class="ntsmap__btn ntsmap__drift" title="Somewhere next door: go there and play it">Drift</button>
        <button class="ntsmap__btn ntsmap__zin" aria-label="Zoom in">+</button><button class="ntsmap__btn ntsmap__zout" aria-label="Zoom out">−</button>
        <button class="ntsmap__close" aria-label="Close">×</button>
      </div>
      <canvas class="ntsmap__canvas"></canvas>
      <p class="ntsmap__found" aria-live="polite"></p>
      <p class="ntsmap__note"></p>
      <div class="ntsmap__card" hidden><img alt=""><div class="ntsmap__cardtext"><span class="ntsmap__name"></span><span class="ntsmap__zone"></span><span class="ntsmap__status"></span>
        <div class="ntsmap__actions"><button class="ntsmap__btn ntsmap__play">▶ Play the latest</button><button class="ntsmap__btn ntsmap__open">Open show</button></div></div></div>`;
    document.body.append(box);
    box.focus();
    document.addEventListener('keydown', onKey, true);
    cv = box.querySelector('canvas'); ctx = cv.getContext('2d');
    box.querySelector('.ntsmap__close').addEventListener('click', close);
    box.querySelector('.ntsmap__zin').addEventListener('click', () => fly(view.x, view.y, view.z * 1.6));
    box.querySelector('.ntsmap__zout').addEventListener('click', () => fly(view.x, view.y, view.z / 1.6));
    box.querySelector('.ntsmap__drift').addEventListener('click', drift);
    box.querySelector('.ntsmap__find').addEventListener('submit', (e) => { e.preventDefault(); find(e.target.querySelector('input').value); });
    box.querySelector('.ntsmap__play').addEventListener('click', () => picked >= 0 && playLatest(data.shows[picked][0]));
    box.querySelector('.ntsmap__open').addEventListener('click', () => { const s = data.shows[picked]?.[0]; if (s) { close(); Archive.showShow(s); } });
    data = await window.nts.chart('map').catch(() => null);
    if (!box) return;
    if (!data?.shows?.length) { box.querySelector('.ntsmap__note').textContent = 'The map isn’t ready yet. It’s worked out once a day.'; return; }
    const at = new Map(data.shows.map((r, i) => [r[0], i]));
    // what's on now, and the shows you follow
    onAir = ((typeof live !== 'undefined' && live?.results) || []).slice(0, 2)       // renderer.js's live channels
      .map((r, k) => ({ i: at.get(showInfo(r).show), ch: k + 1 })).filter((x) => x.i != null);
    follows = new Set((Following?.all?.() || []).map((s) => at.get(s)).filter((i) => i != null));
    const [m0, m1] = data.months || [];
    box.querySelector('.ntsmap__note').textContent = `${data.shows.length} shows, placed by the artists they play${m0 ? ` · ${m0.slice(0, 4)}–${m1.slice(0, 4)}` : ''}. Drag, scroll to zoom, click a show.`;
    view = { x: 0.5, y: 0.5, z: 1 };
    bind(); size();
    raf = requestAnimationFrame(loop);
  }
  function close() {
    if (!box) return;
    cancelAnimationFrame(raf);
    document.removeEventListener('keydown', onKey, true);
    box.remove(); box = null; cv = ctx = null; picked = hover = -1; target = null;
    if (opener?.isConnected) opener.focus();
    opener = null;
  }
  return { open, close };
})();
