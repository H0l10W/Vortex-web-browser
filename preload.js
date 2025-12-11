const { contextBridge, ipcRenderer, shell } = require('electron');

// Expose a secure API to the renderer process
contextBridge.exposeInMainWorld('electronAPI', {
  // --- Renderer to Main ---
  viewCreate: (id, settings) => ipcRenderer.send('view:create', id, settings),
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
  broadcastHistoryUpdated: () => ipcRenderer.send('history-updated'),
  requestClearHistory: () => ipcRenderer.send('request-clear-history'),
  // Global notification API
  notify: (message, type = 'info', duration = 3000) => ipcRenderer.send('notify', { message, type, duration }),
  closeApp: () => ipcRenderer.send('close-app'),

  // Cookie management APIs
  getAllCookies: () => ipcRenderer.invoke('get-all-cookies'),
  clearAllCookies: () => ipcRenderer.invoke('clear-all-cookies'),
  
  // Download folder chooser
  chooseDownloadFolder: () => ipcRenderer.invoke('choose-download-folder'),
  
  // Browser settings
  applyBrowserSettings: (viewId, settings) => ipcRenderer.invoke('apply-browser-settings', viewId, settings),
  setSearchEngine: (engine) => ipcRenderer.invoke('set-search-engine', engine),
  setHomepage: (url) => ipcRenderer.invoke('set-homepage', url),
  setDownloadLocation: (path) => ipcRenderer.invoke('set-download-location', path),
  applyUISettings: (settings) => ipcRenderer.invoke('apply-ui-settings', settings),
  applyWebDarkMode: (viewId, enabled) => ipcRenderer.invoke('apply-web-dark-mode', viewId, enabled),
  applyWebDarkModeAll: (enabled) => ipcRenderer.invoke('apply-web-dark-mode-all', enabled),
  setZoomLevel: (zoom) => ipcRenderer.invoke('set-zoom-level', zoom),
  setCloseTabsOnExit: (enabled) => ipcRenderer.invoke('set-close-tabs-on-exit', enabled),
  setTabPreviewsEnabled: (enabled) => ipcRenderer.invoke('set-tab-previews-enabled', enabled),
  on: (channel, callback) => ipcRenderer.on(channel, callback),
  showTabContextMenu: (tab) => ipcRenderer.send('show-tab-context-menu', tab),
  // Tab drag/drop APIs
  tabDragStart: (tab) => ipcRenderer.send('tab-drag-start', tab),
  // `tabMeta` should include at least `id` and `url`; it may include `webContentsId` and `sourceWinId`.
  tabDroppedHere: (tabMeta) => ipcRenderer.send('tab-dropped-here', tabMeta),
  detachTab: (tab) => ipcRenderer.send('detach-tab', tab),
  tabDragEnd: () => ipcRenderer.send('tab-drag-end'),
  checkDropTarget: (screenX, screenY, tabMeta) => ipcRenderer.invoke('check-drop-target', { screenX, screenY, tabMeta }),
  // Acknowledge that the renderer has attached an incoming tab and is ready
  attachTabAck: (tabId) => ipcRenderer.send('attach-tab-ack', tabId),
  
  // Window dragging APIs
  moveWindow: (deltaX, deltaY) => ipcRenderer.send('move-window', { deltaX, deltaY }),
  toggleMaximize: () => ipcRenderer.send('toggle-maximize'),
  
  // Persistent storage APIs (to replace localStorage)
  getStorageItem: (key) => ipcRenderer.invoke('storage-get', key),
  setStorageItem: (key, value) => ipcRenderer.invoke('storage-set', key, value),
  removeStorageItem: (key) => ipcRenderer.invoke('storage-remove', key),
  getAllStorageKeys: () => ipcRenderer.invoke('storage-get-all-keys'),
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

// Set up a global notification UI inside the page from the preload context
function setupGlobalToasts() {
  try {
    const styleId = 'global-toast-style';
    if (!document.getElementById(styleId)) {
      const s = document.createElement('style');
      s.id = styleId;
      s.textContent = `
      .global-toast-container { position: fixed; left: 16px; bottom: 16px; display: flex; flex-direction: column; gap: 8px; z-index: 99999; }
      .global-toast { min-width: 220px; max-width: 460px; padding: 12px 16px; border-radius: 8px; color: #fff; font-weight: 500; box-shadow: 0 6px 18px rgba(0,0,0,0.2); transition: transform 0.16s ease, opacity 0.16s ease; }
      .global-toast-info { background: #333; }
      .global-toast-success { background: #11a04b; }
      .global-toast-error { background: #e81123; }
      .global-toast.hide { opacity: 0; transform: translateY(8px); }`;
      document.head.appendChild(s);
    }

    let container = document.getElementById('global-toast-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'global-toast-container';
      container.className = 'global-toast-container';
      document.body.appendChild(container);
    }
    return container;
  } catch (e) {
    console.error('Failed to setup global toasts in preload:', e);
    return null;
  }
}

// Render a toast locally in this window (preload context)
function renderLocalToast({ message, type = 'info', duration = 3000 } = {}) {
  try {
    const container = setupGlobalToasts();
    if (!container) return;
    const t = document.createElement('div');
    t.className = `global-toast global-toast-${type}`;
    t.textContent = message;
    container.appendChild(t);
    setTimeout(() => { t.classList.add('hide'); setTimeout(() => t.remove(), 200); }, duration);
  } catch (e) { console.error('Failed to render local toast', e); }
}

// Listen for notify messages from main and render locally
ipcRenderer.on('notify', (_event, payload) => {
  renderLocalToast(payload);
});

// Inform main that renderer (preload) is ready to receive IPC messages
window.addEventListener('DOMContentLoaded', () => {
  try { ipcRenderer.send('renderer-ready'); } catch (e) { }
});

// Explicit UI ready signal for when renderer has finished initializing state and UI
contextBridge.exposeInMainWorld('electronUI', {
  uiReady: () => ipcRenderer.send('renderer-ui-ready')
});

// Optionally expose a `notifications` API for direct use in renderer code
contextBridge.exposeInMainWorld('notifications', {
  notify: (message, type = 'info', duration = 3000) => {
    try { ipcRenderer.send('notify', { message, type, duration }); } catch (e) {}
  }
});
