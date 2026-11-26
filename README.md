# NTS Player

A small desktop player for [NTS Radio](https://www.nts.live): both live channels and the
archive, in one compact window. Runs on Windows, macOS and Linux.

<img src="docs/screenshot.png" alt="NTS Player showing channel 1 live" width="320"> <img src="docs/archive.png" alt="An archive episode playing, with the current track highlighted" width="320">

<img src="docs/wide.png" alt="Wide view with the album art as a record sleeve" width="660">

## Features

### Home

The app opens on Home (or click the NTS logo): **On air** with NTS 1 and NTS 2 and a
play button each, **Continue listening**, **Coming up from shows you follow**, **Explore** (with **I'm feeling lucky**), **Most played on NTS**,
**My NTS** and **Recently added**, with search at the top. "See all" links lead to the full
schedule, history and lists.

### Live radio

- **NTS 1 and NTS 2**, one click to switch. Clicking a channel while an archive episode
  plays switches to live (the episode keeps its place). Show title, artwork, location, time slot,
  genres, description and what's on next.
- **Always live.** Stopping drops the stream, so play picks up what's on air now.
  Reconnects by itself if the stream drops.
- **Live tracklists for NTS Supporters.** In **Settings**, click
  **Sign in** and log in on NTS's own sign-in page. The app never sees
  your password, and you stay signed in until you click **Sign out**.
- **Live track IDs for Supporters, everywhere:** the track playing on live radio shows in
  the now-playing bar and the wide view (with its cover and links), and you get a
  notification when it changes.
- **Schedule:** what's on NTS 1 and NTS 2 today and this week, in the archive. Tap the
  bell on a show to be **reminded when it goes live**.
- **Shows you follow:** marked with a heart on the schedule (with a **Following only**
  filter), listed under **Coming up from shows you follow** in the archive, and you get a
  notification when one goes live (new broadcasts, not repeats). The app reads your
  followed shows from My NTS in the background.

### Archive

- **Most played on NTS** on Home: the tracks played by the most different shows in the
  last 30 days, worked out from every episode's tracklist (NTS doesn't publish a chart).
  **See all** for the top 100 and earlier months. Each track has a small line of how many
  shows played it each month over the past year, and its movement since last month
  (▲, ▼ or NEW). Click a track for its details or press play to hear it in the latest
  episode that played it.
- **NTS in 2026:** the year on NTS in tracks, as full-window cards: the year in numbers,
  track of the year, the top 10, artist of the year, number one month by month,
  how the top 10 moved month by month, each track's lifespan, breakouts, tracks played all
  year, the busiest and new shows, and a network of shows that played the same tracks.
  Switch to **Timeline** for the months side by side, each month's top 8 with lines
  following a track from month to month; scroll back through earlier years.
- **I'm feeling lucky** on Home plays a random episode from anywhere in the archive: any
  show, any year.
- **Explore by mood and genre:** NTS's moods (Sedative, Lean Back, Music To Dance To…) and
  every genre and subgenre lead to their episodes. Genre tags anywhere in the app are
  clickable too.
- **Browse and search** every NTS show and episode: recently added, search, and show
  pages with all their episodes.
- **Play episodes** in the app with a seek bar, and previous / next track buttons. The
  now-playing bar shows the track playing, so you always see it (even in the track web).
- **Keep listening.** When an episode ends, the show's previous episode starts (then the
  newest in the archive). Switch it off with **Autoplay next episode** on any episode page.
- **Tracklists that follow the mix.** The track playing is highlighted; click a track for
  its details, or its ▶ to jump to it. Media keys skip between tracks.
- **Track-change notifications** with the album cover (switch off with
  **Notify on track change** above the tracklist).

### My NTS

- **Save episodes, follow shows and save tracks** to your NTS account, right from the
  app: the same saves you see on nts.live and in the NTS phone app. Sign in once with
  your NTS account (the app never sees your password).
- **Your saved episodes, followed shows and saved tracks** are in the archive under
  **My NTS**. Click a saved track for its cover, details and links, and to play it in
  the episode you saved it from.
- **Save the track that's playing** with the bookmark in the now-playing bar (or on the
  wide view). Live tracks too: the app saves them through the live show's
  page, or an earlier episode that played the same track.

NTS has no public API for this. The app uses NTS's own website, in your signed-in
session, out of sight: it opens the page and presses NTS's own Save / Follow buttons,
and reads your My NTS pages. If NTS changes its site, these buttons may stop working
until the app is updated. To see what's happening, run `npm run debug`: the NTS window
opens next to the player so you can watch it, and each step is logged in the terminal.

### History and resume

- **Pick up where you left off.** Open the app and the episode you were playing is
  ready, paused at the same spot.
- **Resume from where you stopped** on any episode you've started, or **Start over**.
- **History** at the top of the archive: episodes with your progress, and live shows
  you heard, so you can find them again later.

### Tracks and artwork

- **Album covers** for tracks in tracklists, the now-playing bar, the Windows media
  overlay and notifications. When there's no cover, a plain white label stands in.
- **Click a track** to copy "Artist - Title".

### Track web (prototype)

In the wide view, switch the stage to **Track web** to explore NTS through what DJs
played. Search for a track (or start from the one playing, or **Open in Track web** on any
track page). Round nodes are tracks with their covers, square nodes are episodes; a line
means "this episode played this track". Click a node to select it; **Expand** (or double-click) grows the web:
a track shows the episodes that played it, an episode shows its tracklist. Pick a track to **play it from that
point** in the episode you found it through (or choose another), open its details, save it, or start a new web from it.

**Follow along:** with an episode (or live radio, for Supporters) playing, the track web
puts the show in the middle and each track pops in around it as it plays, the current
one pulsing red. It starts by itself when you open the track web while something plays;
skip ahead and the tracks you skipped appear. Switch between **Web** and **Timeline**: the
timeline lays the tracks out along the episode's running time, with a playhead; tracks
still to come show faded. Click any track, played or still to come, to play from it. A
played track also brings up every other episode that played it, above (up to 50), each
lined up so that track sits right above it: see what other DJs played around it, and
press play on any of their tracks to jump into that episode (it becomes the timeline you
follow). Episodes whose tracklist has no times are shown too, dashed, with their tracks
spaced evenly. The sets are stacked by date (newest nearest yours), each says where the track fell
("opened with it", "62% in", "closed with it"), and tracks that turn up in more than
one of the sets are highlighted and joined across them; the panel lists them, click one
to follow just that track.

Tracks are sized by how many NTS episodes played them (with a count). Search for a show,
or **Explore this show** on any episode, to bring in its episodes six at a time: tracks
shared between them light up, and the show's panel lists the ones it played most. Shows
carry their stand-in popularity: how many episodes, since when, how often, ★ if featured
by NTS, and a red outline if you follow them.

Every node is named when there's room. Where names would overlap, the less important ones
fade out (shows and episodes are always named), and a note says how many are hidden.
Zoom in to make room for them, or rest on a node to see its name and connections.

### Wide view

The thin strip is the default. The expand button in the header (or a wider window) adds
a stage with the current track's album art as a record sleeve that tilts toward your
cursor, with a vinyl that spins while the track plays. Below it: title, artist, album,
where the track sits in the mix and what's next, plus links to Spotify, Apple Music,
Deezer, YouTube, Bandcamp and Discogs.

- Deezer and Apple Music open the exact track when it can be found; the others open a
  search ([exact Spotify links](https://github.com/danielsamson/nts-player/issues/1)).
- Spotify, Deezer and Apple Music open in their desktop apps when installed.

### On your desktop

- **Tray / menu bar icon** with play, pause, tracks and channels. Closing the window
  keeps the music playing (switch off in Settings).
- **Mini player:** just the now-playing bar, always on top.
- **System media controls:** previous / play-pause / next and **save to My NTS** on the
  Windows taskbar thumbnail, a Dock menu and Playback menu on macOS, and the now-playing controls in
  macOS Control Center and Linux desktops.
- **Global shortcuts** that work from any app (see below).
- **Sleep timer:** 15, 30 or 60 minutes, or the end of the episode, with a gentle fade.
- **Start at login** (Windows and macOS).
- **Automatic updates** for installed builds (Windows installer and Linux AppImage).
- **Copes with bad connections:** the live stream reconnects by itself, the app tells you
  when you're offline and picks up again when you're back, and an episode that won't
  play is skipped.

### Everywhere

- **Media keys** and the Windows media overlay: play/pause, and next/previous (switches
  channel when live, skips tracks in an episode).
- **Remembers** your channel, volume, view and history.
- **Looks like NTS:** black and white, 1px rules, square corners, bold condensed type,
  the red live dot.

### Keyboard shortcuts

| Key     | Action             |
| ------- | ------------------ |
| `Space` | Play / pause       |
| `Shift` + `←` / `→` | Previous / next track (archive) |
| `1`     | Switch to NTS 1    |
| `2`     | Switch to NTS 2    |
| `Esc`   | Clear the search   |

Anywhere, even when NTS Player isn't in front (on a Mac, `Cmd` + `Option`):

| Key | Action |
| --- | ------ |
| `Ctrl` + `Alt` + `P` | Play / pause |
| `Ctrl` + `Alt` + `←` / `→` | Previous / next track (or channel) |
| `Ctrl` + `Alt` + `M` | Mini player |

### Accessibility

- Everything works from the keyboard: Tab through controls (a red outline shows where you
  are), Enter or Space presses buttons and opens tracklist rows, Esc closes panels.
- Buttons have labels for screen readers; the now-playing title is announced.
- Animations (record spin, cover tilt) switch off when your system asks for reduced motion.

## Getting started

You need [Node.js](https://nodejs.org) (the LTS version).

```bash
git clone https://github.com/danielsamson/nts-player
cd nts-player
npm install
npm start
```

## Tests

```bash
npm test
```

Runs the real app and checks the main journeys (Home, live, archive, saving, explore,
schedule, search, keyboard), with a stand-in NTS account and a throwaway profile. On Linux
without a display: `xvfb-run -a npm test`. The tests run on GitHub before every build.

The **Charts** workflow works out "Most played on NTS" once a day, so the app doesn't
read hundreds of tracklists itself: the last 30 days, the current month, and older years
one at a time until they're all there. It publishes small JSON files to the `data`
branch. To rebuild specific months, run it from the Actions tab (e.g. `2019-01..2019-12`),
or locally: `npm run charts -- --out data 2026-10`.

A separate **NTS site check** runs daily and opens an issue if nts.live has changed in a
way that affects the app (live track IDs, My NTS).

## Build the app

```bash
npm run dist
```

This builds for the system you're on and puts the files in `dist/`. To pick one:
`npm run dist:win`, `npm run dist:mac` or `npm run dist:linux`.

| System | Files |
| ------ | ----- |
| Windows | `NTS-Player-portable.exe` (runs directly) and `NTS-Player-Setup.exe` (installer) |
| macOS | `.dmg` and `.zip`, for Apple Silicon (`arm64`) and Intel (`x64`). Build on a Mac. |
| Linux | `.AppImage` (runs on most distributions) and `.deb` (Ubuntu, Debian) |

**Build all three on GitHub:** the **Build** workflow in the Actions tab builds every
version and attaches the files to the run. It also runs when you push a version tag,
like `v1.0.0`.

The builds aren't code-signed, so the first launch needs a click past a warning:

- **Windows:** SmartScreen, click **More info**, then **Run anyway**.
- **macOS:** open the app once; macOS says it can't check it. Go to **System Settings >
  Privacy & Security**, scroll down and click **Open Anyway** (older macOS: right-click the
  app, choose **Open**, then **Open** again). If macOS says the app **is damaged**
  (older builds), run `xattr -cr "/Applications/NTS Player.app"` in Terminal, then open it.

  The Mac builds have an ad-hoc signature, not an Apple Developer ID, so macOS can't verify
  who made them. Removing this step entirely needs a paid Apple Developer account and
  notarization.
- **Linux (AppImage):** make it executable first: `chmod +x NTS-Player-*.AppImage`.

### Releasing a new version

Releases are fully automatic:

1. Bump `version` in `package.json` and add a section for it in `CHANGELOG.md`.
2. Push to `main`.

The **Build** workflow sees the new version, builds every platform, tags it (`v1.2.0`),
and publishes a GitHub Release with the notes from `CHANGELOG.md`. Installed apps then
update themselves. (Pushing a `v*` tag yourself does the same.)

Automatic updates work for the Windows installer and the Linux AppImage. macOS only
allows them for signed apps, so Mac users download new versions from the release page.

## How it works

| What | Source |
| ---- | ------ |
| Live audio | `stream-relay-geo.ntslive.net/stream` and `/stream2` |
| Now playing, archive, tracklists | The NTS API at `www.nts.live/api/v2/` |
| Archive audio | NTS's SoundCloud uploads, played through SoundCloud's official embed player |
| Live tracklists | `www.nts.live/live-tracklist/{1,2}`, shown in an embedded view (NTS Supporters) |
| Album covers | Deezer (by the track's Deezer ID or ISRC from NTS, or a search), then iTunes Search |
| Apple Music links | iTunes Search, for the track you're listening to |
| My NTS | NTS's own pages and buttons on `www.nts.live`, in your signed-in session |
| Most played, NTS in <year> | Worked out once a day on GitHub (episode dates from nts.live's sitemap, tracklists from the NTS API) and published to this repo's `data` branch; the app downloads those files |

**Your data stays on your computer.** History, your place in an episode, settings and
the artwork cache are stored locally. Cover and link lookups send only a track's artist
and title (or its ID) to Deezer and Apple.

```
main.js                Window, NTS API access, notifications, sign-in window
account.js             My NTS: saves and follows through NTS's own website
live-tracks.js         Live track IDs from NTS's live tracklist (Supporters)
desktop.js             Tray, mini player, global shortcuts, start at login, updates
art.js                 Album art and Apple Music link lookups, with a local cache
preload.js             The bridge between the window and main.js
src/index.html         Layout
src/renderer.js        Live radio, now-playing bar, history, wide view
src/archive.js         Archive: browse, search, show and episode pages
src/archive-player.js  Plays archive episodes via SoundCloud's embed player
src/chart.js           Most played on NTS: shows the published charts, merges a year
src/year.js            NTS in <year>: the year's cards
scripts/build-charts.js  Works out the charts (run daily by the Charts workflow)
src/trackweb.js        Track web
src/style.css          Styling (design tokens at the top)
src/fonts/             Roboto Condensed (SIL Open Font License)
build/icon.png         App icon
```

### Type

nts.live uses Univers Condensed, a commercial typeface that can't be redistributed here.
The app bundles [Roboto Condensed](https://fonts.google.com/specimen/Roboto+Condensed) as
a close, free stand-in, and uses Univers Condensed if you have it installed.

## License

The code is open source under the [MIT License](LICENSE): use it, change it, share it.

That covers this project's code only. The NTS name and logo belong to NTS, and the
bundled Roboto Condensed font is under the SIL Open Font License (`src/fonts/`).

## Disclaimer

This is an unofficial, personal project. It isn't affiliated with or endorsed by NTS
Radio. The NTS name, logo, streams and show content belong to NTS. If you enjoy the
station, consider supporting them through [NTS Supporters](https://www.nts.live/supporters).
