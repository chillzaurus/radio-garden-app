const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('__rgFolders', {
  load: () => ipcRenderer.invoke('folders-load'),
  save: (data) => ipcRenderer.invoke('folders-save', data)
});