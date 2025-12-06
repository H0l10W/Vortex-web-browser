const { app, BrowserWindow, BrowserView, ipcMain } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');

// Increase max listeners to prevent memory leak warnings
require('events').EventEmitter.defaultMaxListeners = 30;

// Optimize app startup
app.commandLine.appendSwitch('disable-features', 'VizDisplayCompositor');
app.commandLine.appendSwitch('disable-dev-shm-usage');
// Enable security features
app.commandLine.appendSwitch('enable-features', 'VizDisplayCompositor');

// Add this to track BrowserViews for each window
const windows = new Map();

// Track settings window to prevent multiple instances
let settingsWindow = null;

// Defer ad blocker initialization
let adDomains = [];
let adBlockEnabled = false;

// Auto-updater configuration
autoUpdater.checkForUpdatesAndNotify();
autoUpdater.autoDownload = false; // Don't auto-download, let user choose
autoUpdater.autoInstallOnAppQuit = true;

// Configure auto-updater for GitHub releases
if (process.env.NODE_ENV !== 'development') {
  autoUpdater.setFeedURL({
    provider: 'github',
    owner: 'H0l10W',
    repo: 'web-browser-with-js'
  });
}

// Initialize ad blocker after app ready
function initAdBlocker() {
  adDomains = [
    'doubleclick.net', 'googleadservices.com', 'googlesyndication.com',
    'facebook.com/tr', 'google-analytics.com', 'googletagmanager.com',
    'amazon-adsystem.com', 'adsystem.amazon.com', 'ads.twitter.com',
    'analytics.twitter.com', 'ads.yahoo.com', 'advertising.com'
  ];
}

// Define the header height (height of tabs + controls)
const headerHeight = 130; // Increased further to prevent overlap with navigation controls

function createWindow(initialUrl) {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    icon: path.join(__dirname, 'icons', 'icon.png'), // Add icon for running app
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: false,
      nativeWindowOpen: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      experimentalFeatures: false,
      enableRemoteModule: false,
      sandbox: true,
      safeDialogs: true
    }
  });

  // Remove menu bar
  win.setMenuBarVisibility(false);

  const windowState = {
    win,
    views: new Map(),
    activeViewId: null,
  };
  windows.set(win.id, windowState);

  // Load the main HTML file
  win.loadFile('index.html');

  // --- Ad Blocker Implementation ---
  const session = win.webContents.session;
  if (adBlockEnabled) {
    session.webRequest.onBeforeRequest((details, callback) => {
      const url = details.url.toLowerCase();
      const shouldBlock = adDomains.some(domain => url.includes(domain));
      callback({ cancel: shouldBlock });
    });
  }

  // --- Enhanced Download Handling with Security ---
  session.on('will-download', (event, item, webContents) => {
    const filename = item.getFilename();
    const url = item.getURL();
    
    // Security: Check for potentially dangerous file extensions
    const dangerousExtensions = ['.exe', '.bat', '.cmd', '.com', '.pif', '.scr', '.vbs', '.ws', '.wsf'];
    const isDangerous = dangerousExtensions.some(ext => filename.toLowerCase().endsWith(ext));
    
    if (isDangerous) {
      // Show warning for potentially dangerous downloads
      console.warn('Potentially dangerous download blocked:', filename, 'from', url);
      event.preventDefault();
      return;
    }
    
    // Security: Check URL protocol
    if (!url.startsWith('https://') && !url.startsWith('http://')) {
      console.warn('Download from non-HTTP(S) protocol blocked:', url);
      event.preventDefault();
      return;
    }
    
    win.webContents.send('download-started', {
      name: filename,
      url: url,
      size: item.getTotalBytes(),
      savePath: item.getSavePath()
    });
    
    item.on('updated', (event, state) => {
      win.webContents.send('download-progress', {
        name: item.getFilename(),
        progress: item.getReceivedBytes() / item.getTotalBytes()
      });
    });
    
    item.once('done', (event, state) => {
      win.webContents.send('download-completed', {
        name: item.getFilename(),
        state: state,
        savePath: item.getSavePath()
      });
    });
  });

  if (initialUrl) {
    win.webContents.on('did-finish-load', () => {
      win.webContents.send('new-window', initialUrl);
    });
  }

  win.on('resize', () => {
    const state = windows.get(win.id);
    if (state && state.activeViewId) {
      const view = state.views.get(state.activeViewId);
      if (view) {
        // Small delay to ensure window bounds are updated
        setTimeout(() => {
          const bounds = win.getContentBounds();
          view.setBounds({ x: 0, y: headerHeight, width: bounds.width, height: bounds.height - headerHeight });
        }, 10);
      }
    }
  });

  win.on('maximize', () => {
    const state = windows.get(win.id);
    if (state && state.activeViewId) {
      const view = state.views.get(state.activeViewId);
      if (view) {
        setTimeout(() => {
          const bounds = win.getContentBounds();
          view.setBounds({ x: 0, y: headerHeight, width: bounds.width, height: bounds.height - headerHeight });
        }, 10);
      }
    }
  });

  win.on('restore', () => {
    const state = windows.get(win.id);
    if (state && state.activeViewId) {
      const view = state.views.get(state.activeViewId);
      if (view) {
        setTimeout(() => {
          const bounds = win.getContentBounds();
          view.setBounds({ x: 0, y: headerHeight, width: bounds.width, height: bounds.height - headerHeight });
        }, 10);
      }
    }
  });

  win.on('unmaximize', () => {
    const state = windows.get(win.id);
    if (state && state.activeViewId) {
      const view = state.views.get(state.activeViewId);
      if (view) {
        setTimeout(() => {
          const bounds = win.getContentBounds();
          view.setBounds({ x: 0, y: headerHeight, width: bounds.width, height: bounds.height - headerHeight });
        }, 10);
      }
    }
  });

  // Clean up IPC listeners when the window is closed
  win.on('closed', () => {
    const state = windows.get(win.id);
    if (state) {
      state.views.forEach(view => {
        if (view && !view.webContents.isDestroyed()) {
          view.webContents.destroy();
        }
      });
      windows.delete(win.id);
    }
    // Remove all event listeners from this window to prevent memory leaks
    win.removeAllListeners();
  });

  return win;
}

// --- IPC Handlers for BrowserView ---
// Remove existing listeners to prevent duplicates
ipcMain.removeAllListeners('view:create');
ipcMain.removeAllListeners('view:destroy');
ipcMain.removeAllListeners('view:show');
ipcMain.removeAllListeners('view:hide');
ipcMain.removeAllListeners('view:navigate');
ipcMain.removeAllListeners('view:reload');
ipcMain.removeAllListeners('view:back');
ipcMain.removeAllListeners('view:forward');
ipcMain.removeAllListeners('open-settings-window');
ipcMain.removeAllListeners('open-incognito');
ipcMain.removeAllListeners('broadcast-theme-change');
ipcMain.removeAllListeners('toggle-devtools');
  ipcMain.removeAllListeners('broadcast-widget-settings');
  ipcMain.removeAllListeners('close-app');ipcMain.on('view:create', (event, id) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return;

  const state = windows.get(win.id);
  if (!state || state.views.has(id)) return;

  const view = new BrowserView({
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      experimentalFeatures: false,
      enableRemoteModule: false,
      sandbox: true,
      safeDialogs: true
    }
  });

  state.views.set(id, view);

  view.webContents.on('did-navigate', (e, url) => win.webContents.send('view:navigated', { id, url }));
  view.webContents.on('page-title-updated', (e, title) => win.webContents.send('page-title-updated', { id, title }));
  
  // Security: Certificate error handling
  view.webContents.on('certificate-error', (event, url, error, certificate, callback) => {
    // Deny invalid certificates for better security
    console.warn('Certificate error for:', url, error);
    callback(false);
  });

  // Security: Permission request handling
  view.webContents.session.setPermissionRequestHandler((webContents, permission, callback) => {
    // Deny sensitive permissions by default
    const allowedPermissions = ['notifications'];
    const allowed = allowedPermissions.includes(permission);
    console.log(`Permission request: ${permission} - ${allowed ? 'Allowed' : 'Denied'}`);
    callback(allowed);
  });
  
  view.webContents.setWindowOpenHandler(({ url }) => {
    win.webContents.send('open-in-new-tab', url);
    return { action: 'deny' };
  });
});

ipcMain.on('view:destroy', (event, id) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return;
  const state = windows.get(win.id);
  if (!state || !state.views.has(id)) return;

  const view = state.views.get(id);
  if (view) {
    if (win.getBrowserView() === view) {
      win.setBrowserView(null);
    }
    if (!view.webContents.isDestroyed()) {
      view.webContents.destroy();
    }
    state.views.delete(id);
  }
});

ipcMain.on('view:show', (event, id) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return;

  const state = windows.get(win.id);
  if (!state || !state.views.has(id)) return;

  const view = state.views.get(id);
  if (view) {
    win.setBrowserView(view);
    const bounds = win.getContentBounds();
    view.setBounds({ x: 0, y: headerHeight, width: bounds.width, height: bounds.height - headerHeight });
    view.setAutoResize({ width: true, height: true });
    state.activeViewId = id;
  }
});

ipcMain.on('view:hide', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) {
    win.setBrowserView(null);
    const state = windows.get(win.id);
    if (state) state.activeViewId = null;
  }
});

ipcMain.on('view:navigate', (event, { id, url }) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return;
  const state = windows.get(win.id);
  if (!state || !state.views.has(id)) return;

  // HTTPS enforcement (except for localhost and special URLs)
  if (url && !url.startsWith('https://') && !url.startsWith('http://localhost') && 
      !url.startsWith('http://127.0.0.1') && !url.startsWith('file://') && 
      !url.includes('settings.html') && url !== 'newtab') {
    // Convert HTTP to HTTPS for better security
    if (url.startsWith('http://')) {
      url = url.replace('http://', 'https://');
    } else if (!url.includes('://')) {
      // Add HTTPS to URLs without protocol
      url = 'https://' + url;
    }
  }

  const view = state.views.get(id);
  if (view && !view.webContents.isDestroyed()) {
    view.webContents.loadURL(url).catch(err => {
      console.error('Failed to load URL:', url, err);
      // Try fallback to HTTP if HTTPS fails (for development)
      if (url.startsWith('https://')) {
        const httpUrl = url.replace('https://', 'http://');
        view.webContents.loadURL(httpUrl).catch(fallbackErr => {
          console.error('Fallback also failed:', fallbackErr);
        });
      }
    });
  }
});

ipcMain.on('view:reload', (event, id) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return;
  const state = windows.get(win.id);
  if (!state || !state.views.has(id)) return;
  const view = state.views.get(id);
  if (!view.webContents.isDestroyed()) {
    view.webContents.reload();
  }
});

ipcMain.on('view:back', (event, id) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return;
  const state = windows.get(win.id);
  if (!state || !state.views.has(id)) return;
  const view = state.views.get(id);
  if (!view.webContents.isDestroyed() && view.webContents.canGoBack()) {
    view.webContents.goBack();
  }
});

ipcMain.on('view:forward', (event, id) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return;
  const state = windows.get(win.id);
  if (!state || !state.views.has(id)) return;
  const view = state.views.get(id);
  if (!view.webContents.isDestroyed() && view.webContents.canGoForward()) {
    view.webContents.goForward();
  }
});

ipcMain.on('open-settings-window', () => {
  // Prevent multiple settings windows
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.focus();
    return;
  }
  createSettingsWindow();
});

ipcMain.on('open-incognito', () => {
  createIncognitoWindow();
});

ipcMain.on('broadcast-theme-change', (event, theme) => {
  BrowserWindow.getAllWindows().forEach(win => {
    if (win.webContents !== event.sender) {
      win.webContents.send('theme-changed', theme);
    }
  });
});

ipcMain.on('broadcast-widget-settings', (event, data) => {
  BrowserWindow.getAllWindows().forEach(win => {
    if (win.webContents !== event.sender) {
      win.webContents.send('widget-settings-changed', data);
    }
  });
});

ipcMain.on('close-app', () => {
  app.quit();
});

ipcMain.on('toggle-devtools', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) {
    win.webContents.toggleDevTools();
  }
});

ipcMain.handle('get-app-version', () => {
  const version = app.getVersion();
  console.log('App version requested:', version);
  console.log('Package.json version should be: 0.0.6');
  return version;
});

// Cookie management handlers
ipcMain.handle('get-all-cookies', async () => {
  const allWindows = BrowserWindow.getAllWindows();
  if (allWindows.length > 0) {
    const cookies = await allWindows[0].webContents.session.cookies.get({});
    return cookies;
  }
  return [];
});

ipcMain.handle('clear-all-cookies', async () => {
  const allWindows = BrowserWindow.getAllWindows();
  const promises = allWindows.map(win => {
    return win.webContents.session.clearStorageData({
      storages: ['cookies']
    });
  });
  await Promise.all(promises);
  return true;
});

ipcMain.handle('delete-cookie', async (event, { name, domain }) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) {
    const url = `http://${domain}`;
    await win.webContents.session.cookies.remove(url, name);
    return true;
  }
  return false;
});

// Create incognito window (no session persistence)
function createIncognitoWindow() {
  const incognitoWin = new BrowserWindow({
    width: 1200,
    height: 800,
    title: 'Vortex - Incognito',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      partition: 'incognito'
    }
  });

  // Remove menu bar
  incognitoWin.setMenuBarVisibility(false);

  incognitoWin.loadFile('index.html');
  
  const incognitoState = {
    win: incognitoWin,
    views: new Map(),
    activeViewId: null,
  };
  windows.set(incognitoWin.id, incognitoState);

  return incognitoWin;
}

function createSettingsWindow() {
  // Prevent multiple settings windows
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.focus();
    return;
  }

  settingsWindow = new BrowserWindow({
    width: 960,
    height: 720,
    title: 'Settings',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      experimentalFeatures: false,
      enableRemoteModule: false,
      sandbox: true,
      safeDialogs: true
    }
  });

  // Remove menu bar
  settingsWindow.setMenuBarVisibility(false);

  settingsWindow.loadFile('settings.html');
  settingsWindow.focus();

  // Clear reference when window is closed
  settingsWindow.on('closed', () => {
    // Remove all event listeners from settings window to prevent memory leaks
    if (settingsWindow) {
      settingsWindow.removeAllListeners();
    }
    settingsWindow = null;
  });
}

// Auto-updater event handlers
autoUpdater.on('checking-for-update', () => {
  console.log('Checking for update...');
  // Notify all windows about update check
  BrowserWindow.getAllWindows().forEach(win => {
    win.webContents.send('update-checking');
  });
});

autoUpdater.on('update-available', (info) => {
  console.log('Update available:', info.version);
  // Notify all windows about available update
  BrowserWindow.getAllWindows().forEach(win => {
    win.webContents.send('update-available', info);
  });
});

autoUpdater.on('update-not-available', (info) => {
  console.log('Update not available');
  // Notify all windows
  BrowserWindow.getAllWindows().forEach(win => {
    win.webContents.send('update-not-available', info);
  });
});

autoUpdater.on('error', (err) => {
  console.error('Update error:', err);
  // Only show error notification for non-404 errors to avoid spamming users
  if (!err.message.includes('404')) {
    // Notify all windows about error
    BrowserWindow.getAllWindows().forEach(win => {
      win.webContents.send('update-error', err.message);
    });
  }
});

autoUpdater.on('download-progress', (progressObj) => {
  console.log('Download progress:', Math.round(progressObj.percent) + '%');
  // Notify all windows about download progress
  BrowserWindow.getAllWindows().forEach(win => {
    win.webContents.send('update-download-progress', progressObj);
  });
});

autoUpdater.on('update-downloaded', (info) => {
  console.log('Update downloaded:', info.version);
  // Notify all windows that update is ready to install
  BrowserWindow.getAllWindows().forEach(win => {
    win.webContents.send('update-downloaded', info);
  });
});

app.whenReady().then(() => {
  // Initialize non-critical components after window creation
  setImmediate(() => {
    initAdBlocker();
    
    // Initialize auto-updater in production
    if (process.env.NODE_ENV !== 'development') {
      setTimeout(() => {
        autoUpdater.checkForUpdatesAndNotify();
      }, 5000); // Wait 5 seconds after app start
    }
  });
  
  createWindow();

  // Check for updates after app is ready (delay to ensure window is loaded)
  setTimeout(() => {
    if (process.env.NODE_ENV !== 'development') {
      console.log('Checking for updates...');
      autoUpdater.checkForUpdatesAndNotify().catch(err => {
        console.log('Update check failed (this is normal if no releases exist yet):', err.message);
      });
    }
  }, 3000);

  // Handle IPC messages for updates
  ipcMain.handle('check-for-updates', async () => {
    try {
      if (process.env.NODE_ENV === 'development') {
        throw new Error('Update checking is disabled in development mode');
      }
      return await autoUpdater.checkForUpdates();
    } catch (error) {
      console.error('Manual update check failed:', error);
      // Don't throw 404 errors to the user interface
      if (error.message.includes('404')) {
        throw new Error('No releases found. Updates will be available once the first release is published.');
      }
      throw error;
    }
  });

  ipcMain.handle('install-update', () => {
    autoUpdater.quitAndInstall();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    // Clean up all remaining windows and their listeners
    BrowserWindow.getAllWindows().forEach(window => {
      if (!window.isDestroyed()) {
        window.removeAllListeners();
      }
    });
    app.quit();
  }
});

app.on('before-quit', () => {
  // Final cleanup: remove all listeners from all windows before quitting
  BrowserWindow.getAllWindows().forEach(window => {
    if (!window.isDestroyed()) {
      window.removeAllListeners();
    }
  });
});
