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
      if (pendingSeek != null) { widget.seekTo(pendingSeek); pendingSeek = null; }
      emit();
    });
    widget.bind(E.PAUSE, () => { state.playing = false; emit(); });
    widget.bind(E.FINISH, () => { state.playing = false; state.position = state.duration; emit(); });
    widget.bind(E.PLAY_PROGRESS, (e) => { state.position = e.currentPosition; emit(); });
    widget.bind(E.ERROR, () => {
      state.playing = false; state.loading = false;
      state.error = 'This episode could not be played.';
      emit();
    });
  }

  // Load an episode and start playing, optionally from a position in ms
  function load(episode, startMs = 0) {
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

  return {
    state,
    onChange: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
    load,
    play: () => widget?.play(),
    pause: () => widget?.pause(),
    toggle: () => (state.playing ? widget?.pause() : widget?.play()),
    seek: (ms) => {
      if (!widget) return;
      state.position = ms;
      widget.seekTo(ms);
      if (!state.playing) widget.play();
      emit();
    },
    setVolume: (v) => { volume = v; widget?.setVolume(Math.round(v * 100)); },
    isLoaded: (show, episode) => state.episode?.show === show && state.episode?.episode === episode
  };
})();
