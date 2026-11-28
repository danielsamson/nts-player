// The NTS map: shows make the places, artists make it interesting.
//   Zones and neighbourhoods are named areas, grouped by what their shows play.
//   ■ a show (its artwork up close): where you listen.
//   ○ an artist: lives where they're played most, linked to the shows that play them.
// Step in and out (zone › neighbourhood › show or artist) with the trail and the side panel;
// drag and scroll work too. It opens on what you're listening to. From charts/map.json.

const NtsMap = (() => {
  let box = null, cv = null, ctx = null, panel = null, data = null, opener = null;
  let view = { x: 0.5, y: 0.5, z: 1 }, target = null;
  let at = { zone: -1, sub: -1, show: -1, artist: -1 };     // where you are
  let hover = null;                                           // { kind: 'show'|'artist'|'zone', i }
  let raf = 0, t0 = 0, dirty = true, nowShow = -1;
  let onAir = [], follows = new Set();
  let showsIn = { zone: [], sub: [] }, artistsIn = { zone: [], sub: [] };
  const pics = new Map();
  const PANEL = 340;
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const dpr = () => Math.min(2, window.devicePixelRatio || 1);
  const S = (i) => data.shows[i], A = (i) => data.artists[i];
  const showName = (i) => data.info?.[S(i)[0]]?.[0] || S(i)[0].replace(/-/g, ' ');
  const zoneName = (z) => data.zones[z][4], subName = (s) => data.subs[s][5];
  const picUrl = (slug, size = 200) => String(data.info?.[slug]?.[1] || '').replace(/\/\/media\d?\.ntslive\.co\.uk\/resize\/\d+x\d+\//, `//media.ntslive.co.uk/resize/${size}x${size}/`);

  // ---- geometry: the map area is the canvas minus the panel ----
  const area = () => ({ w: Math.max(200, cv.clientWidth - (cv.clientWidth > 760 ? PANEL : 0)), h: cv.clientHeight });
  const scale = () => Math.min(area().w, area().h) * view.z;
  const toScreen = (x, y) => [(x - view.x) * scale() + area().w / 2, (y - view.y) * scale() + area().h / 2];
  const toMap = (sx, sy) => [(sx - area().w / 2) / scale() + view.x, (sy - area().h / 2) / scale() + view.y];
  const fly = (x, y, z) => { target = { x, y, z: Math.max(0.8, Math.min(16, z)) }; dirty = true; };
  function fit(points, pad = 0.75) {
    if (!points.length) return;
    const xs = points.map((p) => p[0]), ys = points.map((p) => p[1]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const span = Math.max(x1 - x0, y1 - y0, 0.02);
    fly((x0 + x1) / 2, (y0 + y1) / 2, pad / span);
  }
  function spanOf(list) {
    if (!list?.length) return 0.1;
    const xs = list.map((i) => S(i)[1]), ys = list.map((i) => S(i)[2]);
    return Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), 0.02);
  }

  // ---- where you are ----
  const level = () => (at.show >= 0 || at.artist >= 0 ? 3 : at.sub >= 0 ? 2 : at.zone >= 0 ? 1 : 0);
  function goOverview() { at = { zone: -1, sub: -1, show: -1, artist: -1 }; fly(0.5, 0.5, 1); render(); }
  function goZone(z) { at = { zone: z, sub: -1, show: -1, artist: -1 }; fit(showsIn.zone[z].map((i) => [S(i)[1], S(i)[2]])); render(); }
  function goSub(s) { at = { zone: data.subs[s][4], sub: s, show: -1, artist: -1 }; fit(showsIn.sub[s].map((i) => [S(i)[1], S(i)[2]]), 0.6); render(); }
  function goShow(i) {
    at = { zone: S(i)[3], sub: S(i)[4], show: i, artist: -1 };
    fly(S(i)[1], S(i)[2], Math.max(view.z, 0.6 / spanOf(showsIn.sub[S(i)[4]])));
    render();
  }
  function goArtist(a) {
    at = { zone: A(a)[3], sub: A(a)[4], show: -1, artist: a };
    fit([[A(a)[1], A(a)[2]], ...A(a)[6].slice(0, 5).map((i) => [S(i)[1], S(i)[2]])], 0.55);   // with the shows that play them
    render();
  }
  function up() {
    if (at.show >= 0 || at.artist >= 0) goSub(at.sub);
    else if (at.sub >= 0) goZone(at.zone);
    else if (at.zone >= 0) goOverview();
    else close();
  }

  // ---- drawing ----
  let field = null, fieldKey = '';
  function drawField(time) {
    const { w: W, h: H } = area();
    const w = Math.ceil(W / 4), h = Math.ceil(H / 4);
    if (!field) field = document.createElement('canvas');
    if (field.width !== w || field.height !== h) { field.width = w; field.height = h; fieldKey = ''; }
    const lit = hover?.kind === 'zone' ? hover.i : at.zone;
    const key = `${view.x.toFixed(4)},${view.y.toFixed(4)},${view.z.toFixed(3)},${w},${h},${lit},${Math.floor(time / 120)}`;
    if (key !== fieldKey) {
      fieldKey = key;
      const f = field.getContext('2d');
      f.clearRect(0, 0, w, h);
      const r = Math.max(6, Math.min(60, 0.03 * scale() / 4));
      f.globalCompositeOperation = 'lighter';
      data.shows.forEach(([, x, y, zone]) => {
        const [sx, sy] = toScreen(x, y);
        const br = 1 + 0.12 * Math.sin(time / 2600 + zone * 1.7);
        const a = lit >= 0 ? (zone === lit ? 0.12 : 0.025) : 0.06;
        const g = f.createRadialGradient(sx / 4, sy / 4, 0, sx / 4, sy / 4, r * br);
        g.addColorStop(0, `rgba(255,255,255,${a})`); g.addColorStop(1, 'rgba(255,255,255,0)');
        f.fillStyle = g; f.fillRect(sx / 4 - r * br, sy / 4 - r * br, r * br * 2, r * br * 2);
      });
    }
    ctx.save();
    ctx.globalAlpha = Math.max(0.25, Math.min(1, 1.6 - view.z * 0.12));
    ctx.filter = 'blur(6px)';
    ctx.drawImage(field, 0, 0, W, H);
    ctx.restore();
  }

  // in focus: everything at the top; otherwise the zone or neighbourhood you're in
  const inFocus = (zone, sub) => (at.sub >= 0 ? sub === at.sub : at.zone >= 0 ? zone === at.zone : true);

  function draw(time) {
    const { w: W, h: H } = area();
    ctx.setTransform(dpr(), 0, 0, dpr(), 0, 0);
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, cv.clientWidth, cv.clientHeight);
    drawField(time);
    placed = [];
    const L = level(), s = scale();
    // what the selected (or hovered) show or artist is linked to
    const sel = new Set(), selA = new Set();
    const hs = hover?.kind === 'show' ? hover.i : -1, ha = hover?.kind === 'artist' ? hover.i : -1;
    const fa = ha >= 0 ? ha : at.artist;
    if (fa >= 0) A(fa)[6].forEach((i) => sel.add(i));
    if (at.show >= 0) { S(at.show)[6].forEach((a) => selA.add(a)); data.links.forEach(([i, j]) => { if (i === at.show) sel.add(j); if (j === at.show) sel.add(i); }); }
    const line = (a, b, alpha) => { ctx.strokeStyle = `rgba(255,255,255,${alpha})`; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); };
    if (fa >= 0) { const p = toScreen(A(fa)[1], A(fa)[2]); A(fa)[6].forEach((i) => line(p, toScreen(S(i)[1], S(i)[2]), 0.55)); }
    if (at.show >= 0) {
      const p = toScreen(S(at.show)[1], S(at.show)[2]);
      S(at.show)[6].forEach((a) => line(p, toScreen(A(a)[1], A(a)[2]), 0.55));
      ctx.setLineDash([3, 4]);
      data.links.forEach(([i, j]) => { if (i === at.show || j === at.show) { const o = i === at.show ? j : i; line(p, toScreen(S(o)[1], S(o)[2]), 0.3); } });
      ctx.setLineDash([]);
    }

    // ■ shows
    const tile = Math.min(56, Math.max(3, 0.009 * s));
    data.shows.forEach(([slug, x, y, zone, sub, w], i) => {
      const [sx, sy] = toScreen(x, y);
      if (sx < -40 || sx > W + 40 || sy < -40 || sy > H + 40) return;
      const strong = i === at.show || i === hs || sel.has(i) || i === nowShow;
      const dim = !strong && !inFocus(zone, sub);
      const size = tile >= 20 ? tile : Math.max(3, Math.min(tile, 2.5 + w / 3));
      ctx.globalAlpha = dim ? 0.18 : 1;
      const im = size >= 20 && !dim ? (target ? pics.get(slug) : pic(slug)) : null;
      if (im?.complete && im.naturalWidth) ctx.drawImage(im, sx - size / 2, sy - size / 2, size, size);
      else { ctx.fillStyle = strong ? '#fff' : 'rgba(255,255,255,.7)'; ctx.fillRect(sx - size / 2, sy - size / 2, size, size); }
      if (strong) { ctx.strokeStyle = '#fff'; ctx.lineWidth = i === at.show ? 2 : 1; ctx.strokeRect(sx - size / 2 - 3, sy - size / 2 - 3, size + 6, size + 6); }
      ctx.globalAlpha = 1;
    });

    // ○ artists: the ones that define where you are; more as you get closer
    const close2 = L >= 2 || view.z > 5;
    data.artists.forEach(([name, x, y, zone, sub, n], ai) => {
      const strong = ai === at.artist || ai === ha || selA.has(ai);
      if (!strong) {
        if (!(L >= 1 || view.z > 2.2) || !inFocus(zone, sub)) return;
        const rank = (close2 ? artistsIn.sub[sub] : artistsIn.zone[zone]).indexOf(ai);
        if (rank < 0 || rank >= (close2 ? 14 : 10)) return;
      }
      const [sx, sy] = toScreen(x, y);
      if (sx < -60 || sx > W + 60 || sy < -30 || sy > H + 30) return;
      const r = 4 + Math.min(6, Math.sqrt(n) / 2);
      ctx.fillStyle = '#000'; ctx.beginPath(); ctx.arc(sx, sy, r, 0, 7); ctx.fill();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = strong ? 2.5 : 1.5; ctx.beginPath(); ctx.arc(sx, sy, r, 0, 7); ctx.stroke();
      if (strong) { ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(sx, sy, Math.max(1, r - 3), 0, 7); ctx.fill(); }
      artistLabel(sx + r + 5, sy, name, strong);
    });

    // you're listening here; live now; shows you follow
    if (nowShow >= 0) { const [sx, sy] = toScreen(S(nowShow)[1], S(nowShow)[2]); tag(sx, sy - Math.max(tile, 8) / 2 - 16, 'YOU’RE LISTENING'); }
    const pulse = (time % 2400) / 2400;
    onAir.forEach(({ i, ch }) => {
      const [sx, sy] = toScreen(S(i)[1], S(i)[2]);
      ctx.strokeStyle = `rgba(255,255,255,${1 - pulse})`; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(sx, sy, 6 + pulse * 26, 0, 7); ctx.stroke();
      if (i !== nowShow) tag(sx, sy + Math.max(tile, 8) / 2 + 14, `LIVE ON NTS ${ch}`);
    });
    ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.lineWidth = 1;
    follows.forEach((i) => { const [sx, sy] = toScreen(S(i)[1], S(i)[2]); ctx.beginPath(); ctx.arc(sx, sy, Math.max(tile, 6) / 2 + 6, 0, 7); ctx.stroke(); });

    // names of places: zones from the top, neighbourhoods inside, show names up close
    if (L === 0 && view.z < 2) data.zones.forEach(([x, y, , , name], z) => areaLabel(toScreen(x, y), name, 17, hover?.kind === 'zone' && hover.i === z));
    if (L >= 1 || view.z >= 2) data.subs.forEach(([x, y, , , zone, name], si) => {
      if (L >= 1 && !inFocus(zone, si) && at.zone !== zone) return;
      if (L >= 2 && si !== at.sub) return;
      areaLabel(toScreen(x, y), name, 13, false, L >= 2);
    });
    if (tile >= 20) data.shows.forEach(([, x, y, zone, sub], i) => {
      if (!inFocus(zone, sub) && i !== at.show) return;
      const [sx, sy] = toScreen(x, y);
      if (sx > 0 && sx < W && sy > 0 && sy < H) showLabel(sx, sy + tile / 2 + 10, showName(i), i === at.show || i === hs);
    });
    if (hs >= 0 && tile < 20) { const [sx, sy] = toScreen(S(hs)[1], S(hs)[2]); showLabel(sx, sy + 14, showName(hs), true); }
  }
  let placed = [];
  const free = (r) => !placed.some((p) => r[0] < p[2] && r[2] > p[0] && r[1] < p[3] && r[3] > p[1]);
  // areas: boxed capitals
  function areaLabel([x, y], text, size, lit, faint) {
    ctx.font = `700 ${size}px "NTS Condensed", "Arial Narrow", sans-serif`;
    const t = text.toUpperCase(), w = ctx.measureText(t).width;
    const r = [x - w / 2 - 6, y - size / 2 - 5, x + w / 2 + 6, y + size / 2 + 5];
    if (!free(r)) return; placed.push(r);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.globalAlpha = faint ? 0.6 : 1;
    ctx.fillStyle = lit ? '#fff' : 'rgba(0,0,0,.8)'; ctx.fillRect(r[0], r[1], r[2] - r[0], r[3] - r[1]);
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 1; ctx.strokeRect(r[0] + 0.5, r[1] + 0.5, r[2] - r[0] - 1, r[3] - r[1] - 1);
    ctx.fillStyle = lit ? '#000' : '#fff'; ctx.fillText(t, x, y + 1);
    ctx.globalAlpha = 1;
  }
  // artists: plain mixed case beside their ring
  function artistLabel(x, y, text, strong) {
    ctx.font = `${strong ? 700 : 400} 13px Arial, sans-serif`;
    const w = ctx.measureText(text).width;
    const r = [x - 2, y - 9, x + w + 2, y + 9];
    if (!strong && !free(r)) return; placed.push(r);
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(0,0,0,.85)'; ctx.strokeText(text, x, y);
    ctx.fillStyle = '#fff'; ctx.fillText(text, x, y);
  }
  // shows: small capitals under their square
  function showLabel(x, y, text, strong) {
    ctx.font = `700 ${strong ? 12 : 10}px "NTS Condensed", "Arial Narrow", sans-serif`;
    const t = text.toUpperCase().slice(0, 30), w = ctx.measureText(t).width;
    const r = [x - w / 2 - 3, y - 7, x + w / 2 + 3, y + 7];
    if (!strong && !free(r)) return; placed.push(r);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    if (strong) { ctx.fillStyle = '#fff'; ctx.fillRect(r[0], r[1], r[2] - r[0], r[3] - r[1]); ctx.fillStyle = '#000'; }
    else ctx.fillStyle = 'rgba(255,255,255,.75)';
    ctx.fillText(t, x, y + 1);
  }
  function tag(x, y, text) {
    ctx.font = '700 11px "NTS Condensed", "Arial Narrow", sans-serif';
    const w = ctx.measureText(text).width;
    ctx.fillStyle = '#fff'; ctx.fillRect(x - w / 2 - 4, y - 8, w + 8, 16);
    ctx.fillStyle = '#000'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, x, y + 1);
    placed.push([x - w / 2 - 4, y - 8, x + w / 2 + 4, y + 8]);
  }

  // pictures: a few at a time, newest first, only once a zoom settles
  const queue = []; let loading = 0;
  function pic(slug) {
    if (pics.has(slug)) return pics.get(slug);
    if (!data.info?.[slug]?.[1]) return null;
    pics.set(slug, null); queue.push(slug); pump();
    return null;
  }
  function pump() {
    while (loading < 6 && queue.length) {
      const slug = queue.pop();
      const r = data.shows.find((x) => x[0] === slug);
      const [sx, sy] = toScreen(r[1], r[2]);
      if (sx < -60 || sx > area().w + 60 || sy < -60 || sy > area().h + 60) { pics.delete(slug); continue; }
      loading++;
      const im = new Image(); im.decoding = 'async';
      const done = () => { loading--; dirty = true; pump(); };
      im.onload = done; im.onerror = done;
      im.src = picUrl(slug);
      pics.set(slug, im);
    }
  }

  function loop(time) {
    raf = requestAnimationFrame(loop);
    if (target) {
      const k = 0.14;
      view.x += (target.x - view.x) * k; view.y += (target.y - view.y) * k; view.z *= Math.pow(target.z / view.z, k);
      if (Math.abs(target.x - view.x) < 1e-4 && Math.abs(target.y - view.y) < 1e-4 && Math.abs(target.z / view.z - 1) < 1e-3) target = null;
      dirty = true;
    }
    if (!dirty && time - t0 < (onAir.length ? 33 : 120)) return;
    t0 = time; dirty = false;
    draw(time);
  }

  // ---- the panel: where you are, and where you can go next ----
  function button(text, cls, onClick, title) { const b = el('button', cls, text); if (title) b.title = title; b.addEventListener('click', onClick); return b; }
  function artistChips(list) {
    const wrap = el('div', 'ntsmap__chips');
    list.forEach((a) => {
      const b = button(`○ ${A(a)[0]}`, 'ntsmap__chip', () => goArtist(a), `${A(a)[0]}: where they live on the map`);
      b.addEventListener('mouseenter', () => { hover = { kind: 'artist', i: a }; dirty = true; });
      b.addEventListener('mouseleave', () => { hover = null; dirty = true; });
      wrap.append(b);
    });
    return wrap;
  }
  function showRow(i, note) {
    const r = el('button', 'ntsmap__row');
    const im = el('img'); im.alt = ''; im.loading = 'lazy';
    if (data.info?.[S(i)[0]]?.[1]) im.src = picUrl(S(i)[0]); else im.style.visibility = 'hidden';
    const t = el('span', 'ntsmap__rowtext');
    t.append(el('span', 'ntsmap__rowname', showName(i)), el('span', 'ntsmap__rownote', note ?? subName(S(i)[4])));
    r.append(im, t);
    r.addEventListener('click', () => goShow(i));
    r.addEventListener('mouseenter', () => { hover = { kind: 'show', i }; dirty = true; });
    r.addEventListener('mouseleave', () => { hover = null; dirty = true; });
    return r;
  }
  function areaRow(name, note, onClick, onHover) {
    const r = button('', 'ntsmap__row ntsmap__row--area', onClick);
    r.append(el('span', 'ntsmap__rowname', name), el('span', 'ntsmap__rownote', note));
    if (onHover) { r.addEventListener('mouseenter', () => { hover = onHover; dirty = true; }); r.addEventListener('mouseleave', () => { hover = null; dirty = true; }); }
    return r;
  }
  const h = (text) => el('h3', 'ntsmap__h', text);
  function render() {
    dirty = true;
    // the trail
    const trail = box.querySelector('.ntsmap__trail');
    const steps = [button('NTS', 'ntsmap__step', goOverview)];
    if (at.zone >= 0) steps.push(button(zoneName(at.zone), 'ntsmap__step', () => goZone(at.zone)));
    if (at.sub >= 0) steps.push(button(subName(at.sub), 'ntsmap__step', () => goSub(at.sub)));
    if (at.show >= 0) steps.push(el('span', 'ntsmap__step', `■ ${showName(at.show)}`));
    if (at.artist >= 0) steps.push(el('span', 'ntsmap__step', `○ ${A(at.artist)[0]}`));
    steps[steps.length - 1].classList.add('is-here');
    trail.replaceChildren(...steps.flatMap((x, i) => (i ? [el('span', 'ntsmap__sep', '›'), x] : [x])));
    box.querySelector('.ntsmap__up').hidden = level() === 0;

    const body = [];
    if (at.show >= 0) {
      const i = at.show, slug = S(i)[0];
      const im = el('img', 'ntsmap__pic'); im.alt = '';
      if (data.info?.[slug]?.[1]) im.src = picUrl(slug, 400); else im.hidden = true;
      body.push(el('p', 'ntsmap__kind', '■ Show'), im, el('h2', 'ntsmap__title2', showName(i)));
      if (!data.active?.includes(slug)) body.push(el('p', 'ntsmap__meta', 'Not on air lately: in the archive.'));
      const acts = el('div', 'ntsmap__actions');
      acts.append(button('▶ Play the latest', 'ntsmap__btn ntsmap__btn--main', (e) => playLatest(slug, e.currentTarget)), button('Open show', 'ntsmap__btn', () => { close(); Archive.showShow(slug); }));
      body.push(acts);
      if (S(i)[6].length) body.push(h('Plays most'), artistChips(S(i)[6]));
      const near = data.links.filter(([a, b]) => a === i || b === i).map(([a, b]) => (a === i ? b : a)).slice(0, 6);
      if (near.length) { body.push(h('Shows nearby')); near.forEach((j) => body.push(showRow(j))); }
    } else if (at.artist >= 0) {
      const a = A(at.artist);
      body.push(el('p', 'ntsmap__kind', '○ Artist'), el('h2', 'ntsmap__title2', a[0]),
        el('p', 'ntsmap__meta', `Played on ${a[5]} shows. Lives in ${subName(a[4])}, where they’re played most.`));
      const acts = el('div', 'ntsmap__actions');
      acts.append(button('Artist page', 'ntsmap__btn', () => { close(); Archive.showArtist(a[0]); }));
      body.push(acts, h('Shows that play them'));
      a[6].forEach((i) => body.push(showRow(i)));
      const near = data.artists.map((r, j) => [j, (r[1] - a[1]) ** 2 + (r[2] - a[2]) ** 2]).filter(([j]) => j !== at.artist).sort((p, q) => p[1] - q[1]).slice(0, 8).map(([j]) => j);
      body.push(h('Artists nearby'), artistChips(near));
    } else if (at.sub >= 0) {
      const sb = data.subs[at.sub];
      body.push(el('p', 'ntsmap__kind', `Neighbourhood · ${sb[3]} shows`), el('h2', 'ntsmap__title2', subName(at.sub)),
        el('p', 'ntsmap__meta', `In ${zoneName(sb[4])}.`), h('Artists here'), artistChips(artistsIn.sub[at.sub].slice(0, 12)), h('Shows here'));
      showsIn.sub[at.sub].slice().sort((p, q) => S(q)[5] - S(p)[5]).slice(0, 12).forEach((i) => body.push(showRow(i, '')));
    } else if (at.zone >= 0) {
      const z = data.zones[at.zone];
      body.push(el('p', 'ntsmap__kind', `Zone · ${z[3]} shows`), el('h2', 'ntsmap__title2', z[4]));
      if (z[5]) body.push(el('p', 'ntsmap__meta', z[5]));
      body.push(h('Known for'), artistChips(artistsIn.zone[at.zone].slice(0, 10)), h('Neighbourhoods'));
      data.subs.map((sb, si) => [sb, si]).filter(([sb]) => sb[4] === at.zone).sort((p, q) => q[0][3] - p[0][3])
        .forEach(([sb, si]) => body.push(areaRow(subName(si), `${sb[3]} shows · ${artistsIn.sub[si].slice(0, 3).map((a) => A(a)[0]).join(', ')}`, () => goSub(si))));
    } else {
      body.push(el('h2', 'ntsmap__title2', 'The NTS map'),
        el('p', 'ntsmap__meta', `${data.shows.length} shows in ${data.zones.length} zones, grouped by what they play. ■ is a show, ○ an artist. Step into a zone, or find an artist you like.`));
      if (nowShow >= 0) body.push(button(`You’re listening to ${showName(nowShow)}. See where it is ›`, 'ntsmap__here', () => goShow(nowShow)));
      body.push(h('Zones'));
      data.zones.map((z, zi) => [z, zi]).sort((p, q) => q[0][3] - p[0][3])
        .forEach(([z, zi]) => body.push(areaRow(z[4], z[5] || artistsIn.zone[zi].slice(0, 3).map((a) => A(a)[0]).join(', '), () => goZone(zi), { kind: 'zone', i: zi })));
    }
    panel.replaceChildren(...body);
    panel.scrollTop = 0;
  }

  async function playLatest(slug, btn) {
    const label = btn?.textContent;
    if (btn) btn.textContent = 'Loading…';
    try {
      const res = await window.nts.api(`/api/v2/shows/${slug}/episodes?limit=1`);
      const ep = res.results?.[0];
      if (ep) { await Archive.playFrom(slug, ep.episode_alias, 0); nowShow = data.shows.findIndex((r) => r[0] === slug); dirty = true; }
    } catch {}
    if (btn?.isConnected) btn.textContent = label;
  }

  // find: an artist on the map, a show by name, or an artist via the shows that play them
  async function find(q) {
    const want = Chart.norm(q);
    const status = box.querySelector('.ntsmap__found');
    status.textContent = '';
    if (!want) return;
    const ai = data.artists.findIndex((r) => Chart.norm(r[0]) === want);
    if (ai >= 0) { goArtist(ai); return; }
    const si = data.shows.findIndex((r, i) => Chart.norm(showName(i)) === want);
    if (si >= 0) { goShow(si); return; }
    const res = await Archive.artist(q).catch(() => null);
    if (!box) return;
    const index = new Map(data.shows.map((r, k) => [r[0], k]));
    const where = (res?.x?.top || []).map(([s]) => index.get(s)).filter((k) => k != null);
    if (where.length) { goShow(where[0]); status.textContent = `${res.x.name} isn’t on the map yet: this is the show that plays them most.`; return; }
    const loose = data.artists.findIndex((r) => Chart.norm(r[0]).startsWith(want));
    if (loose >= 0) { goArtist(loose); return; }
    const looseShow = data.shows.findIndex((r, i) => Chart.norm(showName(i)).includes(want));
    if (looseShow >= 0) { goShow(looseShow); return; }
    status.textContent = `Couldn’t find ${q} on the map.`;
  }

  // ---- input ----
  function hit(mx, my) {
    let best = null, bd = 14 * 14;
    const L = level();
    data.artists.forEach(([, x, y, zone, sub], i) => {
      if (!(L >= 1 || view.z > 2.2) && i !== at.artist) return;
      if (L >= 1 && !inFocus(zone, sub)) return;
      const [sx, sy] = toScreen(x, y); const d = (sx - mx) ** 2 + (sy - my) ** 2;
      if (d < bd) { bd = d; best = { kind: 'artist', i }; }
    });
    data.shows.forEach(([, x, y], i) => { const [sx, sy] = toScreen(x, y); const d = (sx - mx) ** 2 + (sy - my) ** 2; if (d < bd) { bd = d; best = { kind: 'show', i }; } });
    if (best) return best;
    let zi = -1, zd = 60 * 60;      // otherwise: the zone you're over
    data.shows.forEach(([, x, y, zone]) => { const [sx, sy] = toScreen(x, y); const d = (sx - mx) ** 2 + (sy - my) ** 2; if (d < zd) { zd = d; zi = zone; } });
    return zi >= 0 ? { kind: 'zone', i: zi } : null;
  }
  function bind() {
    let drag = null, moved = false, last = { x: 0, y: 0 };
    cv.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y }; moved = false; cv.setPointerCapture(e.pointerId); });
    cv.addEventListener('pointermove', (e) => {
      last = { x: e.clientX, y: e.clientY };
      const r = cv.getBoundingClientRect();
      if (drag) {
        const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
        if (Math.abs(dx) + Math.abs(dy) > 3) moved = true;
        if (moved) { view.x = drag.vx - dx / scale(); view.y = drag.vy - dy / scale(); target = null; dirty = true; }
        return;
      }
      const hh = hit(e.clientX - r.left, e.clientY - r.top);
      if (JSON.stringify(hh) !== JSON.stringify(hover)) { hover = hh; dirty = true; }
      cv.style.cursor = hh ? 'pointer' : 'grab';
    });
    cv.addEventListener('pointerup', () => {
      drag = null;
      if (moved || !hover) return;
      if (hover.kind === 'show') goShow(hover.i);
      else if (hover.kind === 'artist') goArtist(hover.i);
      else if (hover.kind === 'zone') {
        if (at.zone !== hover.i) { goZone(hover.i); return; }
        // inside a zone: a click goes to the neighbourhood under the cursor
        const r = cv.getBoundingClientRect();
        const [mx, my] = toMap(last.x - r.left, last.y - r.top);
        let best = -1, bd = Infinity;
        showsIn.zone[at.zone].forEach((i) => { const d = (S(i)[1] - mx) ** 2 + (S(i)[2] - my) ** 2; if (d < bd) { bd = d; best = i; } });
        if (best >= 0 && S(best)[4] !== at.sub) goSub(S(best)[4]);
      }
    });
    cv.addEventListener('pointerleave', () => { hover = null; dirty = true; });
    cv.addEventListener('wheel', (e) => {
      e.preventDefault();
      const r = cv.getBoundingClientRect();
      const [mx, my] = toMap(e.clientX - r.left, e.clientY - r.top);
      const z = Math.max(0.8, Math.min(16, view.z * Math.exp(-e.deltaY * 0.0015)));
      view.x = mx - (mx - view.x) * (view.z / z); view.y = my - (my - view.y) * (view.z / z); view.z = z;
      target = null; dirty = true;
    }, { passive: false });
    new ResizeObserver(() => { if (!cv) return; cv.width = Math.round(cv.clientWidth * dpr()); cv.height = Math.round(cv.clientHeight * dpr()); dirty = true; }).observe(cv);
  }
  const onKey = (e) => {
    if (!box) return;
    if (e.key === 'Tab') { window.trapTab?.(box, e); e.stopPropagation(); return; }
    if (e.target.tagName === 'INPUT') { if (e.key === 'Escape') { e.target.blur(); e.preventDefault(); e.stopPropagation(); } return; }
    const step = 0.08 / view.z;
    if (e.key === 'Escape' || e.key === 'Backspace') up();
    else if (e.key === '+' || e.key === '=') fly(view.x, view.y, view.z * 1.6);
    else if (e.key === '-') fly(view.x, view.y, view.z / 1.6);
    else if (e.key === 'ArrowLeft') fly(view.x - step, view.y, view.z);
    else if (e.key === 'ArrowRight') fly(view.x + step, view.y, view.z);
    else if (e.key === 'ArrowUp') fly(view.x, view.y - step, view.z);
    else if (e.key === 'ArrowDown') fly(view.x, view.y + step, view.z);
    else return;
    e.preventDefault(); e.stopPropagation();
  };

  // what's playing now, if it's on the map (renderer.js: source, playing, live, channel)
  function listeningTo(index) {
    const ep = ArchivePlayer.state.episode;
    if (typeof source !== 'undefined' && source === 'archive' && ep?.show && index.has(ep.show)) return index.get(ep.show);
    if (typeof playing !== 'undefined' && playing && typeof live !== 'undefined') {
      const s = showInfo(live?.results?.[channel]).show;
      if (index.has(s)) return index.get(s);
    }
    return -1;
  }

  async function open(start = {}) {
    if (box) close();
    opener = document.activeElement;
    box = el('div', 'ntsmap');
    box.tabIndex = -1;
    box.setAttribute('role', 'dialog'); box.setAttribute('aria-label', 'The NTS map');
    box.innerHTML = `<div class="ntsmap__top">
        <nav class="ntsmap__trail" aria-label="Where you are"></nav>
        <form class="ntsmap__find"><input type="search" placeholder="Find an artist or show" aria-label="Find an artist or show" spellcheck="false"></form>
        <button class="ntsmap__btn ntsmap__up" title="Out one level (Esc)">↑ Out</button>
        <button class="ntsmap__close" aria-label="Close">×</button>
      </div>
      <div class="ntsmap__main"><canvas class="ntsmap__canvas"></canvas><aside class="ntsmap__panel"></aside>
        <p class="ntsmap__found" aria-live="polite"></p>
        <p class="ntsmap__key">■ show &nbsp; ○ artist &nbsp;·&nbsp; click to go in, Esc to go out, scroll to zoom</p></div>`;
    document.body.append(box);
    box.focus();
    document.addEventListener('keydown', onKey, true);
    cv = box.querySelector('canvas'); ctx = cv.getContext('2d'); panel = box.querySelector('.ntsmap__panel');
    box.querySelector('.ntsmap__close').addEventListener('click', close);
    box.querySelector('.ntsmap__up').addEventListener('click', up);
    box.querySelector('.ntsmap__find').addEventListener('submit', (e) => { e.preventDefault(); find(e.target.querySelector('input').value); });
    panel.append(el('p', 'ntsmap__meta', 'Loading the map…'));
    data = await window.nts.chart('map').catch(() => null);
    if (!box) return;
    if (!data?.shows?.length || !data.artists) { panel.replaceChildren(el('p', 'ntsmap__meta', 'The map isn’t ready yet. It’s worked out once a day.')); return; }
    showsIn = { zone: data.zones.map(() => []), sub: data.subs.map(() => []) };
    data.shows.forEach((r, i) => { showsIn.zone[r[3]].push(i); showsIn.sub[r[4]].push(i); });
    artistsIn = { zone: data.zones.map(() => []), sub: data.subs.map(() => []) };       // most played first
    data.artists.forEach((r, i) => { artistsIn.zone[r[3]].push(i); artistsIn.sub[r[4]].push(i); });
    const index = new Map(data.shows.map((r, i) => [r[0], i]));
    onAir = ((typeof live !== 'undefined' && live?.results) || []).slice(0, 2).map((r, k) => ({ i: index.get(showInfo(r).show), ch: k + 1 })).filter((x) => x.i != null);
    follows = new Set((typeof Following !== 'undefined' ? Following.all() : []).map((s) => index.get(s)).filter((i) => i != null));
    nowShow = listeningTo(index);
    bind();
    cv.width = Math.round(cv.clientWidth * dpr()); cv.height = Math.round(cv.clientHeight * dpr());
    view = { x: 0.5, y: 0.5, z: 1 };
    // start somewhere: what you asked for, else what you're listening to, else the whole map
    const ai = start.artist ? data.artists.findIndex((r) => Chart.norm(r[0]) === Chart.norm(start.artist)) : -1;
    const si = start.show ? (index.get(start.show) ?? -1) : -1;
    if (ai >= 0) goArtist(ai);
    else if (si >= 0) goShow(si);
    else if (start.artist) { goOverview(); find(start.artist); }
    else if (nowShow >= 0) goShow(nowShow);
    else goOverview();
    raf = requestAnimationFrame(loop);
  }
  function close() {
    if (!box) return;
    cancelAnimationFrame(raf);
    document.removeEventListener('keydown', onKey, true);
    box.remove(); box = null; cv = ctx = panel = null; hover = null; target = null;
    if (opener?.isConnected) opener.focus();
    opener = null;
  }
  return { open, close };
})();
