const { contextBridge, ipcRenderer, shell } = require('electron');

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

  // --- External URL handling ---
  openExternal: (url) => shell.openExternal(url),

  // --- New APIs ---
  openSettingsWindow: () => ipcRenderer.send('open-settings-window'),
  broadcastThemeChange: (theme) => ipcRenderer.send('broadcast-theme-change', theme),
  toggleAdBlock: (enabled) => ipcRenderer.send('toggle-adblock', enabled),
  openIncognitoWindow: () => ipcRenderer.send('open-incognito'),
  toggleDevTools: () => ipcRenderer.send('toggle-devtools'),
  broadcastWidgetSettings: (widget, enabled) => ipcRenderer.send('broadcast-widget-settings', { widget, enabled }),
  setBookmarkBarVisibility: (visible) => ipcRenderer.send('set-bookmark-bar-visibility', visible),
  closeApp: () => ipcRenderer.send('close-app'),

  // Cookie management APIs
  getAllCookies: () => ipcRenderer.invoke('get-all-cookies'),
  clearAllCookies: () => ipcRenderer.invoke('clear-all-cookies'),
  deleteCookie: (name, domain) => ipcRenderer.invoke('delete-cookie', { name, domain }),

  // --- Main to Renderer ---
  onViewNavigated: (callback) => ipcRenderer.on('view:navigated', (event, args) => callback(args)),
  onOpenInNewTab: (callback) => ipcRenderer.on('open-in-new-tab', (event, url) => callback(url)),
  onNewWindow: (callback) => ipcRenderer.on('new-window', (event, url) => callback(url)),
  onPageTitleUpdated: (callback) => ipcRenderer.on('page-title-updated', (event, args) => callback(args)),
  onThemeChanged: (callback) => ipcRenderer.on('theme-changed', (_event, theme) => callback(theme)),
  onWidgetSettingsChanged: (callback) => ipcRenderer.on('widget-settings-changed', (_event, data) => callback(data)),
  broadcastThemeChange: (theme) => ipcRenderer.send('broadcast-theme-change', theme),
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),

  // --- Auto-Updater APIs ---
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  installUpdate: () => ipcRenderer.invoke('install-update'),
  
  // Auto-updater event listeners
  onAutoUpdaterDebugInfo: (callback) => ipcRenderer.on('auto-updater-debug-info', (_event, debugInfo) => callback(debugInfo)),
  onUpdateChecking: (callback) => ipcRenderer.on('update-checking', callback),
  onUpdateAvailable: (callback) => ipcRenderer.on('update-available', (_event, info) => callback(info)),
  onUpdateNotAvailable: (callback) => ipcRenderer.on('update-not-available', (_event, info) => callback(info)),
  onUpdateError: (callback) => ipcRenderer.on('update-error', (_event, message) => callback(message)),
  onUpdateDownloadProgress: (callback) => ipcRenderer.on('update-download-progress', (_event, progress) => callback(progress)),
  onUpdateDownloaded: (callback) => ipcRenderer.on('update-downloaded', (_event, info) => callback(info)),

  // --- Window Control APIs ---
  minimizeWindow: () => ipcRenderer.invoke('minimize-window'),
  maximizeWindow: () => ipcRenderer.invoke('maximize-window'),
  closeWindow: () => ipcRenderer.invoke('close-window'),
  isMaximized: () => ipcRenderer.invoke('is-maximized'),

  // --- Memory Management APIs ---
  getMemoryUsage: () => ipcRenderer.invoke('get-memory-usage'),
  forceGarbageCollection: () => ipcRenderer.invoke('force-garbage-collection'),
  hibernateInactiveTabs: () => ipcRenderer.invoke('hibernate-inactive-tabs')
});
