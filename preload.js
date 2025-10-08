const { contextBridge, ipcRenderer } = require('electron');

// Expose a secure API to the renderer process
contextBridge.exposeInMainWorld('electronAPI', {
  // --- Renderer to Main ---
  viewCreate: (id) => ipcRenderer.send('view:create', id),
  viewDestroy: (id) => ipcRenderer.send('view:destroy', id),
  viewNavigate: (args) => ipcRenderer.send('view:navigate', args), // args: { id, url }
  viewReload: (id) => ipcRenderer.send('view:reload', id),
  viewBack: (id) => ipcRenderer.send('view:back', id),
  viewForward: (id) => ipcRenderer.send('view:forward', id),
  viewShow: (id) => ipcRenderer.send('view:show', id),
  viewHide: () => ipcRenderer.send('view:hide'),

  // --- New APIs ---
  openSettingsWindow: () => ipcRenderer.send('open-settings-window'),
  broadcastThemeChange: (theme) => ipcRenderer.send('broadcast-theme-change', theme),
  toggleAdBlock: (enabled) => ipcRenderer.send('toggle-adblock', enabled),
  openIncognitoWindow: () => ipcRenderer.send('open-incognito'),

  // --- Main to Renderer ---
  onViewNavigated: (callback) => ipcRenderer.on('view:navigated', (event, args) => callback(args)),
  onOpenInNewTab: (callback) => ipcRenderer.on('open-in-new-tab', (event, url) => callback(url)),
  onNewWindow: (callback) => ipcRenderer.on('new-window', (event, url) => callback(url)),
  onPageTitleUpdated: (callback) => ipcRenderer.on('page-title-updated', (event, args) => callback(args)),
  onThemeChanged: (callback) => ipcRenderer.on('theme-changed', (event, theme) => callback(theme)),

  // --- Download Events ---
  onDownloadStarted: (callback) => ipcRenderer.on('download-started', (event, data) => callback(data)),
  onDownloadProgress: (callback) => ipcRenderer.on('download-progress', (event, data) => callback(data)),
  onDownloadCompleted: (callback) => ipcRenderer.on('download-completed', (event, data) => callback(data)),
});
