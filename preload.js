const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('nts', {
  getLive: () => ipcRenderer.invoke('nts:live')
});
