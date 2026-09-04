const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('overlayAPI', {
  onData: (callback) => ipcRenderer.on('overlay-data', (_event, payload) => callback(payload)),
  selectSuggestion: (index) => ipcRenderer.send('suggestions-overlay:select', index),
  hideOverlay: () => ipcRenderer.send('suggestions-overlay:hide')
});
