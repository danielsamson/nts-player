# Changelog

Each version's notes become its GitHub Release. To release, bump `version` in
`package.json`, add a section here for it, and push to `main`: the Build workflow
tags it and publishes the release automatically.

## 1.2.1

**Discover**
- Explore by mood and genre: NTS's moods and every genre and subgenre lead to their episodes, and genre tags are clickable everywhere
- I'm feeling lucky on Home: a random episode from anywhere in the archive
- Track web (prototype, in the wide view): explore NTS through what DJs played. Search a track or a show, expand tracks into the episodes that played them and episodes into their tracklists, see which tracks are shared and how often they've been played, and play any track from the episode you found it in

**Listening**
- The now-playing bar shows the track playing in an archive episode
- The artwork box in the bar is always there, with a white label when there's no cover, and covers fade in without flashing
- Live track covers in the bar (Supporters)

**First launch and accessibility**
- A short welcome on first launch
- Everything works from the keyboard, with a visible focus outline; buttons are labelled for screen readers; small text has more contrast

**Fixes**
- macOS no longer says the app "is damaged": Mac builds now have an ad-hoc signature (allow it once in System Settings > Privacy & Security)
- Play from now lands at the right time, instead of sometimes starting the episode from 0:00
- Track play counts no longer count different tracks with similar names
- HTML codes like "&amp;" no longer show in titles

## 1.2.0

**Home**
- A Home screen: what's on air on NTS 1 and NTS 2, continue listening, coming up from shows you follow, My NTS and recently added
- Click the NTS logo to get back to it

**Live**
- Our own live tracklist for Supporters, with album covers, keeping the whole show (not just the last three tracks)
- Save live tracks to My NTS, from the tracklist, the now-playing bar or the taskbar
- Click any track for its details: cover, album, where else it was played, Play from
- Clicking NTS 1 or 2 while an archive episode plays switches to live
- The channel you're hearing is highlighted on every page

**Saving**
- Save the track you're hearing from the now-playing bar, the Windows taskbar thumbnail, the tray and the Dock
- Save tracks from the track details page

**Archive**
- Click a track for its details; the play button on each row jumps to it

**Desktop**
- Previous / play-pause / next on the Windows taskbar thumbnail, a Dock menu and Playback menu on macOS, and system now-playing controls on macOS and Linux
- NTS sign in / sign out moved to Settings

**Fixes and polish**
- Consistent button sizes and icons throughout
- No more notifications from NTS's own pages while listening to the archive
- The live tracklist no longer falls back to a previous episode's tracklist

## 1.1.0

**Listening**
- Live track IDs for NTS Supporters, with album art, links and notifications
- Keep listening: the next episode starts when one ends
- Previous / next track buttons, and "Play from" any track
- Resume where you left off, and listening history

**Discovering**
- Schedule for NTS 1 and NTS 2, with reminders when a show goes live
- Shows you follow: marked on the schedule, "Coming up" list, live notifications
- My NTS: save episodes, follow shows, save tracks (synced with your NTS account)
- Saved track pages with cover, album, where it was played and "Play from"

**Looks and feel**
- Wide view with the album art as a record sleeve
- White label when a track has no cover
- Exact Apple Music and Deezer links; opens Spotify, Deezer and Apple Music apps

**On your desktop**
- Tray icon, mini player, global shortcuts, sleep timer, start at login
- Automatic updates (Windows installer and Linux AppImage)
- Reconnects on bad connections; offline notice

## 1.0.0

- First version: NTS 1 and NTS 2 live, archive, tracklists, Windows / macOS / Linux builds
