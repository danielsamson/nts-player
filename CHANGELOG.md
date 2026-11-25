# Changelog

Each version's notes become its GitHub Release. To release, bump `version` in
`package.json`, add a section here for it, and push to `main`: the Build workflow
tags it and publishes the release automatically.

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
