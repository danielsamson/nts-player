const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('nts', {
  getLive: () => ipcRenderer.invoke('nts:live'),
  api: (path) => ipcRenderer.invoke('nts:api', path),
  copy: (text) => ipcRenderer.invoke('clipboard:write', text),
  focus: () => ipcRenderer.invoke('win:focus'),
  setWide: (wide) => ipcRenderer.invoke('win:set-wide', wide),
  art: (track, priority) => ipcRenderer.invoke('art:lookup', track, priority),
  appleLink: (track) => ipcRenderer.invoke('links:apple', track),
  openLink: (link) => ipcRenderer.invoke('open:link', link),
  notify: (n) => ipcRenderer.invoke('notify', n),
  signIn: () => ipcRenderer.invoke('nts:sign-in'),
  signOut: () => ipcRenderer.invoke('nts:sign-out'),
  onAuthChanged: (cb) => ipcRenderer.on('nts:auth-changed', (_e, signedIn) => cb(signedIn))
});
