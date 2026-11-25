# NTS Player

A tiny desktop player for NTS Radio's two live channels.

- Channel 1 and 2, with show title, artwork, location and what's on next
- Uses Windows media keys and the system media overlay
- Shortcuts: `Space` play/stop, `1` / `2` switch channel
- Remembers your channel and volume

## Run it on Windows

1. Install Node.js (LTS) from https://nodejs.org
2. Open a terminal in this folder and run:

   ```
   npm install
   npm start
   ```

## Build a standalone .exe

```
npm run dist
```

This puts two files in `dist/`:
- `NTS-Player-portable.exe`: a single file you can run directly
- `NTS-Player-Setup.exe`: an installer that adds a Start-menu shortcut

Windows SmartScreen may warn the first time because the app isn't signed.
Click "More info", then "Run anyway".
