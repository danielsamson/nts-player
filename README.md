# NTS Player

A tiny desktop player for [NTS Radio](https://www.nts.live)'s two live channels. It's
for Windows, where there's no NTS app, but it runs anywhere Electron does.

<img src="docs/screenshot.png" alt="NTS Player showing channel 1 live" width="320"> <img src="docs/archive.png" alt="An archive episode playing, with the current track highlighted" width="320">

<img src="docs/wide.png" alt="Wide view with album art and links" width="660">

## Features

- **Both live channels.** Switch between NTS 1 and NTS 2 with one click.
- **Now playing.** Show title, artwork, location and time slot, plus what's on next.
  Refreshes every minute.
- **Live tracklists for NTS Supporters.** In the Tracklist tab, click
  **Sign in for live tracks** and log in on NTS's own sign-in page. The tab then shows
  NTS's live tracklist for the channel you're on. You stay signed in between launches,
  and **Sign out** clears it. The app never sees your password: you sign in on
  nts.live itself, in a browser session kept separate from the player.
- **Tracklists for everyone else.** Without a Supporter sign-in, the Tracklist tab
  shows the show's previous episode, labelled with its date, with timestamps. Click a
  track to copy "Artist - Title".
- **The NTS archive.** The archive tab (next to 1 and 2) has recently added episodes,
  search across shows and episodes, and show pages with every episode. Episodes play
  in the app with a seek bar. In the tracklist, the track that's playing is highlighted
  and clicking a track jumps straight to it. Media keys skip between tracks. When the
  mix moves to a new track you get a Windows notification and the media overlay shows
  the track (switch it off with **Notify on track change** above the tracklist).
- **Album artwork for tracks.** Tracklists show each track's album cover, and so do
  the now-playing bar, the Windows media overlay and track-change notifications. Covers
  come from Deezer (by the track's Deezer ID or ISRC from NTS, or a search) and iTunes
  Search as a fallback. Only artist and title are sent; results are cached locally.
- **Wide view.** The thin strip is the default. The expand button in the header (or
  just making the window wider) adds a stage with the current track's album art as the
  centrepiece: a record sleeve that tilts toward your cursor with a soft shine, and a
  vinyl that slides out and spins while the track plays. Below it: the full title,
  artist and album, where it sits in the mix and what's next, plus links to
  Spotify, Apple Music, Deezer, YouTube, Bandcamp and Discogs. Deezer and Apple Music
  go straight to the track when it was found; the others open a search.
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
| Archive     | `https://www.nts.live/api/v2/collections/recently-added`, `/api/v2/search`, `/api/v2/shows/...` |
| Archive audio | NTS's SoundCloud uploads, played through SoundCloud's official embed player and its Widget API |
| Album art   | `api.deezer.com` (track ID, ISRC, search), `itunes.apple.com/search` |
| Live tracks | `https://www.nts.live/live-tracklist/{1,2}` (NTS Supporters, shown in an embedded view) |

```
main.js          Electron window, and fetches "now playing" from the NTS API
preload.js       Exposes that fetch safely to the page
src/index.html   Player UI
src/renderer.js  Live playback, channel switching, now-playing bar, media keys
src/archive.js   Archive: recently added, search, show and episode pages
src/archive-player.js  Plays archive episodes via SoundCloud's embed player
art.js           Album art lookup and cache (main process)
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
