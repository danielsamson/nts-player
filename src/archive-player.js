// Plays NTS archive episodes. NTS hosts its archive audio on SoundCloud, so this
// drives SoundCloud's official embed player (kept out of sight) through its
// Widget API, and the app shows its own NTS-styled controls on top.
// https://developers.soundcloud.com/docs/api/html5-widget

const ArchivePlayer = (() => {
  const listeners = new Set();
  const state = {
    episode: null,      // { show, episode, title, img, date, location, url }
    playing: false,
    loading: false,
    position: 0,        // ms
    duration: 0,        // ms
    error: null
  };
  let iframe = null;
  let widget = null;
  let volume = 0.8;
  let pendingSeek = null;
  // A seek requested before the audio is ready can be ignored by SoundCloud's player,
  // so keep asking until its position confirms it (or give up after a few tries)
  let seekTarget = null;
  let seekTries = 0;
  let seekLastTry = 0;
  let seekStarted = 0;
  function trySeek() {
    if (seekTarget == null || !widget) return;
    seekTries++;
    seekLastTry = Date.now();
    widget.seekTo(seekTarget);
  }
  // Keep asking for the position until SoundCloud's player confirms it. On a slower
  // connection it can ignore seeks for a while after the audio starts; give up only
  // after 45 s.
  // After it seems to land, keep watching for 10 s: while switching episodes the player
  // briefly reports the requested position before the audio starts (from 0).
  let guardTarget = null;
  let guardUntil = 0;
  function startSeek(ms) {
    seekTarget = ms; seekTries = 0; seekStarted = Date.now();
    guardTarget = ms; guardUntil = Date.now() + 45000;
    trySeek();
  }
  let primed = null;   // { episode, startMs }: shown as paused, loaded when you press play
  let loadedAt = 0;

  const emit = () => listeners.forEach((fn) => fn(state));
  // Silent while jumping into an episode: SoundCloud starts from 0:00 before a seek lands, so the
  // first moment of the show would play. Muted until the seek lands (or 10s, whichever first).
  let jumping = false, jumpTimer = null;
  const level = () => Math.round((jumping ? 0 : volume) * 100);
  function jumpStart() { jumping = true; clearTimeout(jumpTimer); jumpTimer = setTimeout(jumpEnd, 10000); widget?.setVolume(0); }
  function jumpEnd() { if (!jumping) return; jumping = false; clearTimeout(jumpTimer); widget?.setVolume(level()); }

  function embedUrl(url, autoPlay) {
    const p = new URLSearchParams({ url, auto_play: autoPlay ? 'true' : 'false', visual: 'false',
      show_comments: 'false', show_user: 'false', sharing: 'false', download: 'false' });
    return `https://w.soundcloud.com/player/?${p}`;
  }

  function bindEvents() {
    const E = SC.Widget.Events;
    widget.bind(E.READY, () => {
      widget.setVolume(level());
      widget.getDuration((d) => { state.duration = d || 0; emit(); });
    });
    widget.bind(E.PLAY, () => {
      state.playing = true; state.loading = false; state.error = null;
      widget.getDuration((d) => { state.duration = d || state.duration; emit(); });
      if (pendingSeek != null) { startSeek(pendingSeek); pendingSeek = null; }
      emit();
    });
    widget.bind(E.PAUSE, () => { state.playing = false; emit(); });
    widget.bind(E.FINISH, () => {
      // While switching episodes, a seek past the end of the old audio can make SoundCloud
      // report "finished" for it: ignore that, or autoplay would skip the episode just picked.
      if (Date.now() - loadedAt < 4000 || seekTarget != null || pendingSeek != null) return;
      state.playing = false; state.position = state.duration; state.finished = true; emit();
    });
    widget.bind(E.PLAY_PROGRESS, (e) => {
      if (seekTarget != null) {
        if (Math.abs(e.currentPosition - seekTarget) < 4000) { seekTarget = null; guardUntil = Math.min(guardUntil, Date.now() + 10000); jumpEnd(); }   // seems to have landed
        else if (Date.now() - seekStarted > 45000) { seekTarget = null; guardTarget = null; jumpEnd(); }                                                // give up
        else {
          if (Date.now() - seekLastTry > 800) trySeek();
          state.position = seekTarget;      // show where we're going, not 0:00
          emit();
          return;
        }
      }
      // fell back to the start after "landing": ask again
      if (guardTarget != null && Date.now() < guardUntil && e.currentPosition < guardTarget - 8000) {
        seekTarget = guardTarget; seekLastTry = 0;
        jumpStart();
        state.position = guardTarget;
        emit();
        return;
      }
      if (Date.now() >= guardUntil) guardTarget = null;
      state.position = e.currentPosition;
      emit();
    });
    widget.bind(E.ERROR, () => {
      state.playing = false; state.loading = false;
      state.error = 'This episode could not be played.';
      emit();
    });
  }

  // Load an episode and start playing, optionally from a position in ms
  function load(episode, startMs = 0) {
    if (standby?.ready && standby.url === episode.url) { swapIn(episode, startMs); return; }
    if (standby?.url === episode.url) { try { standby.widget.pause(); } catch {} standby.url = null; }   // not warm yet: load it here instead
    primed = null;
    loadedAt = Date.now();
    seekTarget = null;
    guardTarget = null;
    state.finished = false;
    state.episode = episode;
    state.playing = false;
    state.loading = true;
    state.position = startMs;
    state.duration = 0;
    state.error = null;
    pendingSeek = startMs > 0 ? startMs : null;
    if (pendingSeek != null) jumpStart(); else jumpEnd();
    emit();

    if (!widget) {
      iframe = document.createElement('iframe');
      iframe.className = 'sc-frame';
      iframe.title = 'SoundCloud player';
      iframe.allow = 'autoplay; encrypted-media';
      iframe.src = embedUrl(episode.url, true);
      document.body.appendChild(iframe);
      widget = SC.Widget(iframe);
      bindEvents();
    } else {
      widget.load(episode.url, {
        auto_play: true, visual: false, show_comments: false, show_user: false, sharing: false, download: false,
        callback: () => widget.setVolume(level())
      });
    }
  }

  // ---- the standby player: loads the next episode out of sight, so starting it later skips the
  // load (NTS in <year> uses it a scene ahead). It never plays while waiting: SoundCloud's players
  // pause each other, so a warm-up would stop what you're hearing.
  const EVENTS = () => Object.values(SC.Widget.Events);
  let standby = null;      // { iframe, widget, url, startMs, ready }
  function makeFrame(url) {
    const f = document.createElement('iframe');
    f.className = 'sc-frame';
    f.title = 'SoundCloud player';
    f.allow = 'autoplay; encrypted-media';
    f.src = embedUrl(url, false);
    document.body.appendChild(f);
    return f;
  }
  function preload(episode, startMs = 0) {
    if (!episode?.url || typeof SC === 'undefined') return;
    if (state.episode?.url === episode.url) return;                       // already the one playing
    if (standby?.url === episode.url && Math.abs((standby.startMs || 0) - startMs) < 4000) return;
    const sb = standby && standby.widget ? standby : { iframe: null, widget: null };
    sb.url = episode.url; sb.startMs = startMs; sb.ready = false;
    const warm = (w) => {
      EVENTS().forEach((ev) => w.unbind(ev));
      w.bind(SC.Widget.Events.READY, () => { if (standby === sb) { w.setVolume(0); sb.ready = true; } });
    };
    if (!sb.widget) {
      sb.iframe = makeFrame(episode.url);
      sb.widget = SC.Widget(sb.iframe);
      standby = sb;
      warm(sb.widget);
    } else {
      standby = sb;
      warm(sb.widget);
      sb.widget.load(episode.url, { auto_play: false, visual: false, show_comments: false, show_user: false, sharing: false, download: false,
        callback: () => { if (standby === sb) { sb.widget.setVolume(0); sb.ready = true; } } });
    }
  }
  // swap the warmed standby in as the main player; the old one becomes the next standby
  function swapIn(episode, startMs) {
    const sb = standby;
    const oldW = widget, oldF = iframe;
    if (oldW) { try { oldW.pause(); } catch {} EVENTS().forEach((ev) => oldW.unbind(ev)); }
    EVENTS().forEach((ev) => sb.widget.unbind(ev));
    widget = sb.widget; iframe = sb.iframe;
    standby = oldW ? { iframe: oldF, widget: oldW, url: null, ready: false } : null;
    primed = null; loadedAt = Date.now(); seekTarget = null; guardTarget = null;
    Object.assign(state, { finished: false, episode, playing: false, loading: true, position: startMs, duration: 0, error: null });
    pendingSeek = startMs > 0 ? startMs : null;      // it starts from 0:00, silent until the jump lands
    if (pendingSeek != null) jumpStart(); else jumpEnd();
    bindEvents();
    widget.setVolume(level());
    widget.play();
    emit();
  }

  // Show an episode as paused at a position without loading it (resume on launch)
  function prime(episode, startMs = 0, durationMs = 0) {
    primed = { episode, startMs };
    state.episode = episode;
    state.playing = false;
    state.loading = false;
    state.position = startMs;
    state.duration = durationMs;
    state.error = null;
    emit();
  }
  const startPrimed = () => { const p = primed; load(p.episode, p.startMs); };

  return {
    state,
    onChange: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
    load,
    prime,
    preload,
    play: () => (primed ? startPrimed() : widget?.play()),
    pause: () => widget?.pause(),
    toggle: () => (primed ? startPrimed() : state.playing ? widget?.pause() : widget?.play()),
    seek: (ms) => {
      if (primed) { primed.startMs = ms; state.position = ms; emit(); return; }
      if (!widget) return;
      state.position = ms;
      startSeek(ms);
      if (!state.playing) widget.play();
      emit();
    },
    setVolume: (v) => { volume = v; widget?.setVolume(level()); },
    isLoaded: (show, episode) => state.episode?.show === show && state.episode?.episode === episode
  };
})();
