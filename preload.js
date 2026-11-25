const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('nts', {
  getLive: () => ipcRenderer.invoke('nts:live'),
  api: (path) => ipcRenderer.invoke('nts:api', path),
  copy: (text) => ipcRenderer.invoke('clipboard:write', text)
});
