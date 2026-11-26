// NTS world: a globe of where NTS shows broadcast from.
// Dots are places, sized by how many shows come from there. Scrub the timeline through
// the schedule (last week and the week ahead): NTS 1 and NTS 2 move around the globe,
// trailing where they broadcast from before. At "now" they pulse red.
// Data: WORLD_SHOWS (snapshot of shows and places, scripts/build-world-data.js),
// WorldPlaces (place coordinates), WORLD_LAND (map), and the live NTS schedule.

const World = (() => {
  const host = $('world');
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const STEP = 15 * 60000;            // the timeline moves in 15-minute steps
  let built = false, active = false;
  let svg, gSphere, gGrat, gLand, gTrails, gDots, gLabels, gLive, proj, geoPath;
  let rot = [0, -25], target = null, zoomK = 1, lastUser = 0;
  const places = new Map();           // key -> { key, label, lat, lon, shows: [{ alias, name }] }
  const placeOfShow = new Map();      // alias -> place
  let nowhereShows = [];
  let sched = [];                     // { ch, start, end, title, alias, episode, place }
  let t = Date.now(), followNow = true, playTimer = null;
  let selected = null;

  const fmtWhen = (ms) => new Date(ms).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const fmtTimeOnly = (ms) => new Date(ms).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  const isNow = () => followNow || Math.abs(t - Date.now()) < STEP;

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

  // ---------- drawing ----------
  function build() {
    if (built) return;
    built = true;
    indexShows();
    svg = d3.select(host.querySelector('.world__svg'));
    proj = d3.geoOrthographic().clipAngle(90).precision(0.5);
    geoPath = d3.geoPath(proj);
    gSphere = svg.append('path').attr('class', 'world__sphere');
    gGrat = svg.append('path').attr('class', 'world__grat').datum(d3.geoGraticule10());
    gLand = svg.append('path').attr('class', 'world__land').datum(WORLD_LAND);
    gTrails = svg.append('g');
    gDots = svg.append('g');
    gLabels = svg.append('g').attr('class', 'world__labels');
    gLive = svg.append('g');

    svg.call(d3.drag()
      .on('start', () => { lastUser = Date.now(); target = null; svg.classed('is-dragging', true); })
      .on('drag', (e) => {
        lastUser = Date.now();
        const k = 0.28 / zoomK;
        rot = [rot[0] + e.dx * k, Math.max(-75, Math.min(75, rot[1] - e.dy * k))];
        draw();
      })
      .on('end', () => svg.classed('is-dragging', false)));
    svg.on('wheel', (e) => {
      e.preventDefault();
      lastUser = Date.now();
      zoomK = Math.max(1, Math.min(6, zoomK * Math.pow(1.0015, -e.deltaY)));
      draw();
    }, { passive: false });
    svg.on('click', (e) => { if (e.target === svg.node() || e.target.classList.contains('world__sphere') || e.target.classList.contains('world__land')) { selected = null; draw(); paintInfo(); } });

    const scrub = host.querySelector('.world__scrub');
    scrub.addEventListener('input', () => { const v = Number(scrub.value); followNow = false; t = v; stopPlay(); focusOnChannels(); draw(); paintInfo(); });
    host.querySelector('.world__now').addEventListener('click', () => { stopPlay(); followNow = true; t = Date.now(); focusOnChannels(); draw(); paintInfo(); });
    host.querySelector('.world__play').addEventListener('click', () => (playTimer ? stopPlay() : startPlay()));
    new ResizeObserver(() => active && draw()).observe(host.querySelector('.world__svg'));
  }

  const visible = (p) => d3.geoDistance([p.lon, p.lat], [-rot[0], -rot[1]]) < Math.PI / 2 - 0.03;

  function draw() {
    if (!built) return;
    const box = host.querySelector('.world__svg').getBoundingClientRect();
    if (!box.width || !box.height) return;
    const base = Math.min(box.width, box.height) / 2 - 12;
    proj.translate([box.width / 2, box.height / 2]).scale(base * zoomK).rotate(rot);
    gSphere.datum({ type: 'Sphere' }).attr('d', geoPath);
    gGrat.attr('d', geoPath);
    gLand.attr('d', geoPath);

    // trails: where each channel was before, as great-circle arcs that fade with age
    const trails = [1, 2].flatMap((ch) => {
      const pts = trail(t, ch);
      return pts.slice(1).map((p, i) => ({ ch, i, a: pts[i], b: p }));
    });
    gTrails.selectAll('path').data(trails).join('path')
      .attr('class', (d) => `world__trail world__trail--${d.ch}`)
      .attr('opacity', (d) => Math.max(0.12, 0.8 - d.i * 0.15))
      .attr('d', (d) => geoPath({ type: 'LineString', coordinates: [[d.a.lon, d.a.lat], [d.b.lon, d.b.lat]] }));

    // places
    const list = [...places.values()].filter((p) => p.shows.length || p === selected);
    const r = (p) => 1.8 + Math.sqrt(p.shows.length) * 0.9 * Math.min(1.6, Math.sqrt(zoomK));
    gDots.selectAll('circle').data(list, (p) => p.key).join((enter) => enter.append('circle').attr('class', 'world__dot')
      .on('click', (e, p) => { e.stopPropagation(); select(p); })
      .call((c) => c.append('title')))
      .classed('is-selected', (p) => p === selected)
      .attr('r', r)
      .attr('display', (p) => (visible(p) ? null : 'none'))
      .attr('cx', (p) => proj([p.lon, p.lat])[0]).attr('cy', (p) => proj([p.lon, p.lat])[1])
      .select('title').text((p) => `${p.label} · ${p.shows.length} show${p.shows.length === 1 ? '' : 's'}`);

    // live / scrubbed position of each channel
    const now = [1, 2].map((ch) => at(t, ch)).filter((b) => b?.place);
    const liveMarks = gLive.selectAll('g.world__ch').data(now, (b) => b.ch).join((enter) => {
      const g = enter.append('g').attr('class', (b) => `world__ch world__ch--${b.ch}`)
        .on('click', (e, b) => { e.stopPropagation(); select(b.place); });
      g.append('circle').attr('class', 'world__pulse').attr('r', 10);
      g.append('circle').attr('class', 'world__mark').attr('r', 5.5);
      g.append('text').attr('class', 'world__num').attr('dy', '0.35em').text((b) => b.ch);
      return g;
    });
    // both channels in one place: nudge them apart
    const same = now.length === 2 && now[0].place === now[1].place;
    liveMarks.classed('is-now', isNow())
      .attr('display', (b) => (visible(b.place) ? null : 'none'))
      .attr('transform', (b) => { const [x, y] = proj([b.place.lon, b.place.lat]); return `translate(${x + (same ? (b.ch === 1 ? -8 : 8) : 0)},${y})`; });

    // labels: the channels' places, the selected one, then the biggest, without overlaps
    const want = [...new Set([...now.map((b) => b.place), selected, ...list.slice().sort((a, b) => b.shows.length - a.shows.length).slice(0, 40)])]
      .filter((p) => p && visible(p));
    const kept = [];
    const labels = [];
    for (const p of want) {
      const [x, y] = proj([p.lon, p.lat]);
      const w = p.label.length * 6 + 6, h = 13;
      const bx = { x: x + 8, y: y - h / 2, w, h };
      if (kept.some((k) => bx.x < k.x + k.w && k.x < bx.x + bx.w && bx.y < k.y + k.h && k.y < bx.y + bx.h)) continue;
      kept.push(bx);
      labels.push({ p, x: x + 9, y });
      if (labels.length >= 16 + Math.round(zoomK * 6)) break;
    }
    gLabels.selectAll('text').data(labels, (d) => d.p.key).join('text')
      .attr('class', (d) => `world__label${now.some((b) => b.place === d.p) ? ' is-on-air' : ''}`)
      .attr('x', (d) => d.x).attr('y', (d) => d.y).attr('dy', '0.35em').text((d) => d.p.label);

    paintTime();
  }

  // ---------- motion ----------
  // One animation loop: eases toward a target place, or turns slowly when left alone
  let timer = null;
  function loop() {
    if (timer) return;
    timer = d3.timer(() => {
      if (!active) { timer.stop(); timer = null; return; }
      const idle = Date.now() - lastUser > 8000;
      if (target && Date.now() - lastUser > 1500) {
        const dx = ((target[0] - rot[0] + 540) % 360) - 180, dy = target[1] - rot[1];
        if (Math.abs(dx) < 0.05 && Math.abs(dy) < 0.05) target = null;
        else { rot = [rot[0] + dx * 0.07, rot[1] + dy * 0.07]; draw(); }
      } else if (idle && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
        rot = [rot[0] + 0.04, rot[1]];
        draw();
      }
    });
  }
  function focusOn(p) { if (p) target = [-p.lon, Math.max(-60, Math.min(60, -p.lat * 0.8))]; }
  function focusOnChannels() {
    const ps = [1, 2].map((ch) => at(t, ch)?.place).filter(Boolean);
    if (!ps.length) return;
    if (ps.length === 2 && d3.geoDistance([ps[0].lon, ps[0].lat], [ps[1].lon, ps[1].lat]) < 2) {
      const [lon, lat] = d3.geoInterpolate([ps[0].lon, ps[0].lat], [ps[1].lon, ps[1].lat])(0.5);
      focusOn({ lon, lat });
    } else focusOn(ps[0]);
  }

  // ---------- timeline ----------
  function paintTime() {
    const scrub = host.querySelector('.world__scrub');
    if (sched.length) {
      scrub.min = Math.floor(sched[0].start / STEP) * STEP;
      scrub.max = Math.ceil(sched[sched.length - 1].end / STEP) * STEP;
      scrub.step = STEP;
      if (followNow) t = Date.now();
      scrub.value = t;
      scrub.style.setProperty('--fill', `${((t - scrub.min) / (scrub.max - scrub.min)) * 100}%`);
      // where "now" sits on the timeline
      const pct = ((Date.now() - scrub.min) / (scrub.max - scrub.min)) * 100;
      host.querySelector('.world__nowmark').style.left = `calc(16px + (100% - 32px) * ${Math.max(0, Math.min(100, pct)) / 100})`;
    }
    host.querySelector('.world__when').textContent = isNow() ? 'Live now' : fmtWhen(t);
    host.querySelector('.world__now').hidden = isNow();
    host.querySelector('.world__play').textContent = playTimer ? 'Pause' : '▶ Play the week';
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
    playTimer = setInterval(() => {
      t += STEP * 2;
      if (t >= max) { stopPlay(); return; }
      focusOnChannels(); draw(); paintInfo();
    }, 140);
    paintTime();
  }
  function stopPlay() { clearInterval(playTimer); playTimer = null; paintTime(); }

  // ---------- panel ----------
  function select(p) { selected = p; focusOn(p); draw(); paintInfo(); }
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
      box.append(el('p', 'world__title', p.label));
      const upcoming = sched.filter((b) => b.place === p && b.end > Date.now()).slice(0, 6);
      box.append(el('p', 'world__sub', `${p.shows.length} show${p.shows.length === 1 ? '' : 's'} from here${upcoming.length ? ` · ${upcoming.length >= 6 ? '6+' : upcoming.length} broadcast${upcoming.length === 1 ? '' : 's'} coming up` : ''}`));
      if (upcoming.length) {
        const list = el('div', 'world__upcoming');
        upcoming.forEach((b) => {
          const r = el('button', 'world__up');
          r.append(el('span', 'world__uptime', `${new Date(b.start).toLocaleDateString(undefined, { weekday: 'short' })} ${fmtTimeOnly(b.start)} · NTS ${b.ch}`), el('span', 'world__uptitle', b.title));
          r.addEventListener('click', () => { followNow = false; t = b.start; stopPlay(); draw(); paintInfo(); });
          list.append(r);
        });
        box.append(list);
      }
      const shows = el('div', 'world__shows');
      p.shows.slice().sort((a, b) => a.name.localeCompare(b.name)).forEach((s) => {
        const b = el('button', 'tag', s.name);
        b.addEventListener('click', () => Archive.showShow(s.alias));
        shows.append(b);
      });
      box.append(shows);
      return;
    }
    const chans = [1, 2].map((ch) => at(t, ch) || { ch, title: '' });
    box.append(...chans.map(chRow));
    const top = [...places.values()].sort((a, b) => b.shows.length - a.shows.length).slice(0, 6);
    const total = [...places.values()].reduce((n, p) => n + p.shows.length, 0);
    box.append(el('p', 'world__hint', `${total.toLocaleString()} shows from ${[...places.values()].filter((p) => p.shows.length).length} places, plus ${nowhereShows.length} from everywhere and nowhere. `
      + `Most: ${top.map((p) => `${p.label} ${p.shows.length}`).join(' · ')}. Click a place for its shows. Drag to turn, scroll to zoom.`));
  }

  // Keep "now" moving while the view is open
  setInterval(() => { if (active && followNow && !playTimer) { draw(); paintInfo(); } }, 30000);

  return {
    async show() {
      active = true;
      build();
      draw(); paintInfo(); loop();
      if (!sched.length) {
        host.querySelector('.world__when').textContent = 'Loading the schedule…';
        await loadSchedule().catch(() => {});
        paintDays(); focusOnChannels(); draw(); paintInfo();
      }
    },
    hide() { active = false; stopPlay(); },
    // live info changed (new show on air)
    refresh() { if (active) { if (followNow) focusOnChannels(); draw(); paintInfo(); } }
  };
})();
