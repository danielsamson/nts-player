// NTS in <year>: the year on NTS in tracks, as full-window cards (one fact each).
// Built from the monthly chart files (Chart.year). Arrows or ← → to move, Esc to close.

const Year = (() => {
  let box = null, cards = [], at = 0, y = null;
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const monthName = (m, style = 'long') => new Date(Date.UTC(+m.slice(0, 4), +m.slice(5) - 1, 15)).toLocaleDateString(undefined, { month: style, timeZone: 'UTC' });
  const fmt = (x) => Number(x).toLocaleString();
  const showPic = (src, cls) => {
    const wrap = el('div', cls);
    if (src) { const im = el('img'); im.alt = ''; im.addEventListener('error', () => im.remove()); im.src = src; wrap.append(im); }
    return wrap;
  };
  const plural = (x, word) => `${fmt(x)} ${word}${x === 1 ? '' : 's'}`;

  function cover(t, size = 'high') {
    const wrap = el('div', 'year__cover');
    const img = el('img'); img.alt = '';
    Art.get({ artist: t.artist, title: t.title }, size).then((a) => { if (a?.large || a?.small) { img.src = a.large || a.small; wrap.classList.add('has-img'); } }).catch(() => {});
    wrap.append(img);
    return wrap;
  }
  const play = (t) => {
    const b = el('button', 'year__play', '▶ Play');
    b.title = `Play it in ${t.latest.title}`;
    b.addEventListener('click', () => Archive.playFrom(t.latest.show, t.latest.episode, Number.isFinite(t.latest.offset) ? t.latest.offset : 0));
    return b;
  };
  function trackLine(t, i) {
    const r = el('div', 'year__row');
    const c = cover(t, 'small'); c.classList.add('year__cover--small');
    const txt = el('div', 'year__rowtext');
    txt.append(el('span', 'year__rowtitle', t.title), el('span', 'year__rowsub', `${t.artist} · ${plural(t.shows, 'show')}`));
    r.append(el('span', 'year__rank', String(i + 1)), c, txt);
    r.addEventListener('click', () => Archive.playFrom(t.latest.show, t.latest.episode, Number.isFinite(t.latest.offset) ? t.latest.offset : 0));
    r.title = `Play it in ${t.latest.title}`;
    return r;
  }
  function card(kicker, title, ...body) {
    const c = el('section', 'year__card');
    c.append(el('p', 'year__kicker', kicker));
    if (title) c.append(el('h2', 'year__title', title));
    c.append(...body.filter(Boolean));
    return c;
  }

  function build(s) {
    const out = [];
    const soFar = s.complete ? '' : ` (${s.months} month${s.months === 1 ? '' : 's'} so far)`;
    // 1: the year in numbers
    const nums = el('div', 'year__nums');
    [[s.episodes, 'episodes'], [s.shows, 'shows'], [s.plays, 'tracks played']].forEach(([v, l]) => {
      const d = el('div', 'year__num'); d.append(el('span', 'year__big', fmt(v)), el('span', 'year__label', l)); nums.append(d);
    });
    out.push(card(`NTS in ${s.year}${soFar}`, 'The year in tracks', nums,
      el('p', 'year__note', 'Worked out from every episode’s tracklist. Tracks are ranked by how many different shows played them.')));
    // 2: track of the year
    const t1 = s.top[0];
    if (t1) out.push(card('Track of the year', null, cover(t1), el('p', 'year__track', t1.title), el('p', 'year__artist', t1.artist),
      el('p', 'year__note', `Played by ${plural(t1.shows, 'show')} in ${plural(t1.episodes, 'episode')}.`), play(t1)));
    // 3: top 10
    if (s.top.length > 1) { const l = el('div', 'year__list'); s.top.slice(0, 10).forEach((t, i) => l.append(trackLine(t, i))); out.push(card('The top 10', null, l)); }
    // 4: artists
    if (s.topArtists.length) {
      const a1 = s.topArtists[0];
      const l = el('div', 'year__list');
      s.topArtists.slice(1, 6).forEach((a, i) => { const r = el('div', 'year__row'); r.append(el('span', 'year__rank', String(i + 2)), el('div', 'year__rowtext')); r.lastChild.append(el('span', 'year__rowtitle', a.artist), el('span', 'year__rowsub', plural(a.shows, 'show'))); l.append(r); });
      out.push(card('Artist of the year', a1.artist, cover(a1.top), el('p', 'year__note', `Played by ${plural(a1.shows, 'show')}, ${plural(a1.tracks, 'different track')}.`), l));
    }
    // 5: number one each month
    if (s.numberOnes.length > 1) {
      const g = el('div', 'year__grid');
      s.numberOnes.forEach((t) => { const c = el('div', 'year__cell'); c.append(cover(t, 'small'), el('span', 'year__cellmonth', monthName(t.month, 'short')), el('span', 'year__celltitle', t.title)); c.title = `${t.artist} – ${t.title}`; c.addEventListener('click', () => Archive.playFrom(t.latest.show, t.latest.episode, Number.isFinite(t.latest.offset) ? t.latest.offset : 0)); g.append(c); });
      out.push(card('Number one, month by month', null, g));
    }
    // 6: breakouts
    if (s.breakouts.length) { const l = el('div', 'year__list'); s.breakouts.forEach((t, i) => l.append(trackLine(t, i))); out.push(card('Breakouts', 'First played this year', l)); }
    // 7: evergreen
    if (s.evergreen.length) { const l = el('div', 'year__list'); s.evergreen.forEach((t, i) => l.append(trackLine(t, i))); out.push(card('All year long', `Played every month${soFar ? ' so far' : ''}`, l)); }
    // 8: busiest shows
    if (s.busiest.length) {
      const l = el('div', 'year__list');
      s.busiest.forEach((b, i) => { const r = el('div', 'year__row'); const c = showPic(b.img, 'year__cover year__cover--small has-img'); const tx = el('div', 'year__rowtext'); tx.append(el('span', 'year__rowtitle', b.name), el('span', 'year__rowsub', plural(b.count, 'episode'))); r.append(el('span', 'year__rank', String(i + 1)), c, tx); r.addEventListener('click', () => { close(); Archive.showShow(b.show); }); l.append(r); });
      out.push(card('Busiest shows', 'Most episodes', l));
    }
    // 9: new shows
    if (s.debuts.length) {
      const g = el('div', 'year__shows');
      s.debuts.slice(0, 9).forEach((d) => { const b = el('button', 'year__show'); b.append(showPic(d.img, 'year__showpic'), el('span', null, d.name)); b.addEventListener('click', () => { close(); Archive.showShow(d.show); }); g.append(b); });
      out.push(card('New on NTS', `${plural(s.debuts.length, 'new show')}`, g, s.debuts.length > 9 ? el('p', 'year__note', `And ${fmt(s.debuts.length - 9)} more.`) : null));
    }
    // 10: shared taste
    if (s.pair && s.pair.count >= 3) {
      const nm = (a) => (s.pair.names[a] || [])[0] || Chart.showName(a);
      out.push(card('Shared taste', `${nm(s.pair.a)} & ${nm(s.pair.b)}`, el('p', 'year__note', `The two shows that played the most of the same tracks: ${plural(s.pair.count, 'track')} in common.`)));
    }
    // 11: outro
    const sup = el('button', 'year__link', 'Support NTS');
    sup.addEventListener('click', () => window.nts.openLink({ url: 'https://www.nts.live/supporters' }));
    out.push(card(`NTS in ${s.year}`, 'That was the year', el('p', 'year__note', s.peak ? `The busiest month was ${monthName(s.peak.month)}, with ${plural(s.peak.episodes, 'episode')}.` : ''), sup));
    return out;
  }

  function show(i) {
    at = Math.max(0, Math.min(cards.length - 1, i));
    const stage = box.querySelector('.year__stage');
    stage.replaceChildren(cards[at]);
    box.querySelector('.year__count').textContent = `${at + 1} / ${cards.length}`;
    box.querySelector('.year__prev').disabled = at === 0;
    box.querySelector('.year__next').disabled = at === cards.length - 1;
  }
  const onKey = (e) => {
    if (!box) return;
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); show(at + 1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); show(at - 1); }
    e.stopPropagation();
  };

  async function open(year) {
    y = year;
    if (!box) {
      box = el('div', 'year');
      box.setAttribute('role', 'dialog'); box.setAttribute('aria-label', `NTS in ${year}`);
      box.innerHTML = '<div class="year__top"><select class="year__pick" aria-label="Year"></select><span class="year__count"></span><button class="year__close" aria-label="Close">×</button></div>'
        + '<button class="year__prev" aria-label="Previous">‹</button><div class="year__stage"></div><button class="year__next" aria-label="Next">›</button>';
      box.querySelector('.year__close').addEventListener('click', close);
      box.querySelector('.year__prev').addEventListener('click', () => show(at - 1));
      box.querySelector('.year__next').addEventListener('click', () => show(at + 1));
      box.querySelector('.year__pick').addEventListener('change', (e) => open(+e.target.value));
      document.body.append(box);
      document.addEventListener('keydown', onKey, true);
    }
    const pick = box.querySelector('.year__pick');
    const years = [...new Set((await Chart.months()).map((m) => +m.slice(0, 4)))].sort((a, b) => b - a);
    pick.replaceChildren(...(years.length ? years : [year]).map((v) => { const o = el('option', null, `NTS in ${v}`); o.value = v; return o; }));
    pick.value = year;
    box.querySelector('.year__stage').replaceChildren(loader(`Putting ${year} together`));
    const s = await Chart.year(year);
    if (y !== year || !box) return;
    cards = s ? build(s) : [card(`NTS in ${year}`, 'Not ready yet', el('p', 'year__note', 'This year’s charts haven’t been worked out yet. They fill in a year at a time; try again tomorrow.'))];
    show(0);
  }
  function close() {
    if (!box) return;
    document.removeEventListener('keydown', onKey, true);
    box.remove();
    box = null;
  }
  return { open, close };
})();
