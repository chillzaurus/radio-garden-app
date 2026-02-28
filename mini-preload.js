const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('miniAPI', {
  playpause: () => ipcRenderer.send('mini-playpause'),
  prev:      () => ipcRenderer.send('mini-prev'),
  next:      () => ipcRenderer.send('mini-next'),
  close:     () => ipcRenderer.send('mini-close'),
  onUpdate:  (cb) => ipcRenderer.on('mini-update', (event, data) => cb(data))
});
