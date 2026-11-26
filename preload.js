const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('nts', {
  getLive: () => ipcRenderer.invoke('nts:live'),
  api: (path) => ipcRenderer.invoke('nts:api', path),
  chart: (name) => ipcRenderer.invoke('charts:get', name),
  copy: (text) => ipcRenderer.invoke('clipboard:write', text),
  focus: () => ipcRenderer.invoke('win:focus'),
  setWide: (wide) => ipcRenderer.invoke('win:set-wide', wide),
  art: (track, priority) => ipcRenderer.invoke('art:lookup', track, priority),
  appleLink: (track) => ipcRenderer.invoke('links:apple', track),
  openLink: (link) => ipcRenderer.invoke('open:link', link),
  liveTracks: (channel) => ipcRenderer.invoke('live:tracks', channel),
  desktop: {
    state: (s) => ipcRenderer.invoke('desktop:state', s),
    mini: (on) => ipcRenderer.invoke('desktop:mini', on),
    settings: () => ipcRenderer.invoke('desktop:settings'),
    set: (key, value) => ipcRenderer.invoke('desktop:set', key, value),
    onCommand: (cb) => ipcRenderer.on('desktop:command', (_e, c) => cb(c)),
    onMini: (cb) => ipcRenderer.on('desktop:mini', (_e, on) => cb(on))
  },
  account: {
    episode: (show, episode) => ipcRenderer.invoke('account:episode', show, episode),
    toggle: (action) => ipcRenderer.invoke('account:toggle', action),
    list: (kind) => ipcRenderer.invoke('account:list', kind)
  },
  notify: (n) => ipcRenderer.invoke('notify', n),
  signIn: () => ipcRenderer.invoke('nts:sign-in'),
  signOut: () => ipcRenderer.invoke('nts:sign-out'),
  onAuthChanged: (cb) => ipcRenderer.on('nts:auth-changed', (_e, signedIn) => cb(signedIn))
});
