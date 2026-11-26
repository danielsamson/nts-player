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

  function embedUrl(url, autoPlay) {
    const p = new URLSearchParams({ url, auto_play: autoPlay ? 'true' : 'false', visual: 'false',
      show_comments: 'false', show_user: 'false', sharing: 'false', download: 'false' });
    return `https://w.soundcloud.com/player/?${p}`;
  }

  function bindEvents() {
    const E = SC.Widget.Events;
    widget.bind(E.READY, () => {
      widget.setVolume(Math.round(volume * 100));
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
        if (Math.abs(e.currentPosition - seekTarget) < 4000) { seekTarget = null; guardUntil = Math.min(guardUntil, Date.now() + 10000); }   // seems to have landed
        else if (Date.now() - seekStarted > 45000) { seekTarget = null; guardTarget = null; }                                                // give up
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
        callback: () => widget.setVolume(Math.round(volume * 100))
      });
    }
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
    setVolume: (v) => { volume = v; widget?.setVolume(Math.round(v * 100)); },
    isLoaded: (show, episode) => state.episode?.show === show && state.episode?.episode === episode
  };
})();
