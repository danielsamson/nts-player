# NTS Player

A tiny desktop player for [NTS Radio](https://www.nts.live)'s two live channels. It's
for Windows, where there's no NTS app, but it runs anywhere Electron does.

<img src="docs/screenshot.png" alt="NTS Player showing channel 1 live" width="380">

## Features

- **Both live channels.** Switch between NTS 1 and NTS 2 with one click.
- **Now playing.** Show title, artwork, location and time slot, plus what's on next.
  Refreshes every minute.
- **Tracklists.** The Tracklist tab lists each track with its timestamp. Click a
  track to copy "Artist - Title". Live track IDs are an
  [NTS Supporter](https://www.nts.live/supporters) feature, so while a show is on air
  the app shows the tracklist from that show's previous episode, labelled with its date.
- **Genre tags** and the show description, with a link to the episode on nts.live.
- **Always live.** Stopping drops the stream, so pressing play again picks up what's
  on air now, not where you left off.
- **Reconnects** by itself if the stream drops.
- **Media keys.** Works with your keyboard's play/pause keys and the Windows media
  overlay. Next/previous switches channel.
- **Remembers** your last channel and volume.
- **Looks like NTS.** Uses the visual language of nts.live: black and white, 1px
  rules, square corners, bold uppercase condensed type, the red live dot, and the
  channel inverting to white while it's playing.

### Keyboard shortcuts

| Key     | Action          |
| ------- | --------------- |
| `Space` | Play / stop     |
| `1`     | Switch to NTS 1 |
| `2`     | Switch to NTS 2 |

## Getting started

You need [Node.js](https://nodejs.org) (the LTS version).

```bash
git clone https://github.com/danielsamson/nts-player
cd nts-player
npm install
npm start
```

## Build a Windows .exe

```bash
npm run dist
```

This puts two files in `dist/`:

- `NTS-Player-portable.exe`: a single file you can run directly, no install needed
- `NTS-Player-Setup.exe`: an installer that adds a Start-menu shortcut

The app isn't code-signed, so Windows SmartScreen may warn you the first time you run
it. Click **More info**, then **Run anyway**.

## How it works

| What        | Where                                                  |
| ----------- | ------------------------------------------------------ |
| NTS 1 audio | `https://stream-relay-geo.ntslive.net/stream`          |
| NTS 2 audio | `https://stream-relay-geo.ntslive.net/stream2`         |
| Now playing | `https://www.nts.live/api/v2/live`                     |
| Tracklists  | `https://www.nts.live/api/v2/shows/{show}/episodes/{episode}/tracklist` |

```
main.js          Electron window, and fetches "now playing" from the NTS API
preload.js       Exposes that fetch safely to the page
src/index.html   Player UI
src/renderer.js  Playback, channel switching, media keys
src/style.css    Styling (design tokens at the top)
src/fonts/       Roboto Condensed (SIL Open Font License)
build/icon.png   App icon
```

### Type

nts.live uses Univers Condensed, a commercial typeface that can't be redistributed
here. The app bundles [Roboto Condensed](https://fonts.google.com/specimen/Roboto+Condensed)
as a close, free stand-in. If you have Univers Condensed installed, the app uses it
automatically.

## Disclaimer

This is an unofficial, personal project. It isn't affiliated with or endorsed by NTS
Radio. The NTS name, logo, streams and show content belong to NTS. If you enjoy the
station, consider supporting them through [NTS Supporters](https://www.nts.live/supporters).
