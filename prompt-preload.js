const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('promptAPI', {
  submit: (value) => ipcRenderer.send('prompt-result', value),
  cancel: () => ipcRenderer.send('prompt-result', null)
});
