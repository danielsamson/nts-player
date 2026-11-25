const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('nts', {
  getLive: () => ipcRenderer.invoke('nts:live'),
  api: (path) => ipcRenderer.invoke('nts:api', path),
  copy: (text) => ipcRenderer.invoke('clipboard:write', text),
  signIn: () => ipcRenderer.invoke('nts:sign-in'),
  signOut: () => ipcRenderer.invoke('nts:sign-out'),
  onAuthChanged: (cb) => ipcRenderer.on('nts:auth-changed', (_e, signedIn) => cb(signedIn))
});
