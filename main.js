const { app, BrowserWindow, BrowserView, ipcMain } = require('electron');
const { autoUpdater } = require('electron-updater');

// Global update state tracking
let updateInProgress = false;
let lastUpdateCheck = 0;
const UPDATE_CHECK_COOLDOWN = 30000; // 30 seconds cooldown between checks

// Memory management configuration
const MEMORY_CONFIG = {
  maxInactiveTabs: 10, // Maximum inactive tabs before hibernation
  memoryThresholdMB: 1024, // Memory threshold for tab discarding (1GB)
  gcIntervalMs: 300000, // Garbage collection interval (5 minutes)
  hibernationDelayMs: 600000, // Hibernate tabs after 10 minutes of inactivity
};

// Memory tracking
let memoryMonitoring = {
  lastGC: Date.now(),
  tabLastActivity: new Map(), // Track last activity per tab
  hibernatedTabs: new Set(), // Track hibernated tabs
};

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
autoUpdater.autoInstallOnAppQuit = false; // We'll handle installation manually
autoUpdater.allowDowngrade = false; // Prevent downgrade attacks

// Configure auto-updater for GitHub releases
if (process.env.NODE_ENV !== 'development') {
  autoUpdater.setFeedURL({
    provider: 'github',
    owner: 'H0l10W',
    repo: 'web-browser-with-js'
  });
}

// Memory Management Functions
// ===========================

function triggerGarbageCollectionIfNeeded() {
  const now = Date.now();
  if (now - memoryMonitoring.lastGC > MEMORY_CONFIG.gcIntervalMs) {
    console.log('Triggering garbage collection...');
    if (global.gc) {
      global.gc();
      memoryMonitoring.lastGC = now;
      console.log('Garbage collection completed');
    }
  }
}

function getMemoryUsage() {
  const usage = process.memoryUsage();
  return {
    rss: Math.round(usage.rss / 1024 / 1024), // MB
    heapUsed: Math.round(usage.heapUsed / 1024 / 1024), // MB
    heapTotal: Math.round(usage.heapTotal / 1024 / 1024), // MB
    external: Math.round(usage.external / 1024 / 1024) // MB
  };
}

function hibernateTab(tabId, view) {
  if (memoryMonitoring.hibernatedTabs.has(tabId)) return;
  
  console.log(`Hibernating tab ${tabId} to save memory`);
  
  // Mark as hibernated
  memoryMonitoring.hibernatedTabs.add(tabId);
  
  // Clear cache and temporary data
  if (!view.webContents.isDestroyed()) {
    const session = view.webContents.session;
    session.clearStorageData({
      storages: ['shadercache', 'webrtc', 'appcache']
    }).catch(err => console.log('Hibernation cleanup error:', err));
  }
}

function wakeUpTab(tabId) {
  if (!memoryMonitoring.hibernatedTabs.has(tabId)) return;
  
  console.log(`Waking up tab ${tabId}`);
  memoryMonitoring.hibernatedTabs.delete(tabId);
  memoryMonitoring.tabLastActivity.set(tabId, Date.now());
}

function checkMemoryPressure() {
  const memUsage = getMemoryUsage();
  console.log(`Memory usage: ${memUsage.rss}MB RSS, ${memUsage.heapUsed}MB Heap`);
  
  // If memory usage is high, hibernate inactive tabs
  if (memUsage.rss > MEMORY_CONFIG.memoryThresholdMB) {
    console.log('Memory pressure detected, hibernating inactive tabs...');
    hibernateInactiveTabs();
  }
}

function hibernateInactiveTabs() {
  const now = Date.now();
  
  // Find tabs that haven't been active recently
  for (const [winId, state] of windows) {
    for (const [tabId, view] of state.views) {
      const lastActivity = memoryMonitoring.tabLastActivity.get(tabId) || now;
      const inactiveTime = now - lastActivity;
      
      // Hibernate tabs inactive for more than the threshold (except active tab)
      if (inactiveTime > MEMORY_CONFIG.hibernationDelayMs && 
          tabId !== state.activeViewId && 
          !memoryMonitoring.hibernatedTabs.has(tabId)) {
        hibernateTab(tabId, view);
      }
    }
  }
}

function updateTabActivity(tabId) {
  memoryMonitoring.tabLastActivity.set(tabId, Date.now());
  wakeUpTab(tabId); // Wake up if hibernated
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

  // --- Keyboard Shortcuts ---
  win.webContents.on('before-input-event', (event, input) => {
    // F11 for fullscreen toggle
    if (input.key === 'F11' && input.type === 'keyDown') {
      const isFullScreen = win.isFullScreen();
      win.setFullScreen(!isFullScreen);
      
      // Update view bounds when toggling fullscreen
      const state = windows.get(win.id);
      if (state && state.activeViewId) {
        const view = state.views.get(state.activeViewId);
        if (view) {
          setTimeout(() => {
            const bounds = win.getContentBounds();
            if (!isFullScreen) { // Going to fullscreen
              view.setBounds({ x: 0, y: 0, width: bounds.width, height: bounds.height });
            } else { // Exiting fullscreen
              view.setBounds({ x: 0, y: headerHeight, width: bounds.width, height: bounds.height - headerHeight });
            }
          }, 100);
        }
      }
    }
  });

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
          // Check if we're in fullscreen mode
          if (win.isFullScreen()) {
            // In fullscreen, use entire window space
            view.setBounds({ x: 0, y: 0, width: bounds.width, height: bounds.height });
          } else {
            // Normal mode, account for header
            view.setBounds({ x: 0, y: headerHeight, width: bounds.width, height: bounds.height - headerHeight });
          }
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
          // Check if we're in fullscreen mode
          if (win.isFullScreen()) {
            view.setBounds({ x: 0, y: 0, width: bounds.width, height: bounds.height });
          } else {
            view.setBounds({ x: 0, y: headerHeight, width: bounds.width, height: bounds.height - headerHeight });
          }
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
          // Check if we're in fullscreen mode
          if (win.isFullScreen()) {
            view.setBounds({ x: 0, y: 0, width: bounds.width, height: bounds.height });
          } else {
            view.setBounds({ x: 0, y: headerHeight, width: bounds.width, height: bounds.height - headerHeight });
          }
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
    // Allow notifications and fullscreen permissions
    const allowedPermissions = ['notifications', 'fullscreen'];
    const allowed = allowedPermissions.includes(permission);
    console.log(`Permission request: ${permission} - ${allowed ? 'Allowed' : 'Denied'}`);
    callback(allowed);
  });
  
  // Handle fullscreen requests from web content (e.g., YouTube, videos)
  view.webContents.on('enter-html-full-screen', () => {
    console.log('Entering fullscreen mode');
    win.setFullScreen(true);
    // Hide the BrowserView temporarily and show it fullscreen
    view.setBounds({ x: 0, y: 0, width: win.getBounds().width, height: win.getBounds().height });
  });

  view.webContents.on('leave-html-full-screen', () => {
    console.log('Leaving fullscreen mode');
    win.setFullScreen(false);
    // Restore normal bounds
    setTimeout(() => {
      const bounds = win.getContentBounds();
      view.setBounds({ x: 0, y: headerHeight, width: bounds.width, height: bounds.height - headerHeight });
    }, 100);
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
    // Enhanced memory cleanup with better error handling
    console.log(`Destroying view ${id} - Memory cleanup initiated`);
    
    try {
      // Remove from hibernated tabs if present
      memoryMonitoring.hibernatedTabs.delete(id);
      memoryMonitoring.tabLastActivity.delete(id);
      
      // Detach from window first - with error handling
      try {
        if (!win.isDestroyed() && win.getBrowserView() === view) {
          win.setBrowserView(null);
        }
      } catch (err) {
        console.log('Error detaching view from window:', err.message);
      }
      
      // Clear session data for this view - only if webContents still exists
      if (view.webContents && !view.webContents.isDestroyed()) {
        try {
          const session = view.webContents.session;
          
          // Clear cache, cookies, and storage for memory cleanup
          session.clearStorageData({
            storages: ['cookies', 'localstorage', 'sessionstorage', 'websql', 'indexdb', 'shadercache']
          }).catch(err => console.log('Storage cleanup error:', err));
          
          // Remove event listeners to prevent memory leaks
          view.webContents.removeAllListeners();
          
          // Destroy web contents
          view.webContents.destroy();
        } catch (err) {
          console.log('Error during webContents cleanup:', err.message);
        }
      }
      
    } catch (err) {
      console.log('Error during view destruction:', err.message);
    } finally {
      // Always remove from tracking, even if cleanup failed
      state.views.delete(id);
      
      console.log(`View ${id} destroyed. Remaining views: ${state.views.size}`);
      
      // Trigger garbage collection if needed
      try {
        triggerGarbageCollectionIfNeeded();
      } catch (err) {
        console.log('Error during garbage collection:', err.message);
      }
    }
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
    
    // Track tab activity for memory management
    updateTabActivity(id);
    console.log(`Tab ${id} activated - activity tracked`);
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
    console.log(`Navigating tab ${id} to: ${url}`);
    
    // Add better error handling and navigation
    view.webContents.loadURL(url, {
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      extraHeaders: 'Accept-Language: en-US,en;q=0.9\r\n'
    }).then(() => {
      console.log(`Successfully loaded: ${url}`);
    }).catch(err => {
      console.error('Failed to load URL:', url, err);
      
      // Enhanced error handling
      if (err.code === 'ERR_ABORTED') {
        console.log('Navigation was aborted, this is usually not an error');
        return; // Don't try fallback for aborted navigations
      }
      
      // Handle other common errors
      if (err.code === 'ERR_NETWORK_CHANGED' || err.code === 'ERR_INTERNET_DISCONNECTED') {
        view.webContents.loadURL('data:text/html,<h1>Network Error</h1><p>Check your internet connection and try again.</p>');
        return;
      }
      
      // Try fallback to HTTP if HTTPS fails (for development or specific sites)
      if (url.startsWith('https://') && !url.includes('google.com') && !url.includes('search')) {
        const httpUrl = url.replace('https://', 'http://');
        console.log(`Trying HTTP fallback: ${httpUrl}`);
        view.webContents.loadURL(httpUrl).catch(fallbackErr => {
          console.error('HTTP fallback also failed:', fallbackErr);
          // Load an error page or show error message
          view.webContents.loadURL('data:text/html,<h1>Failed to load page</h1><p>Unable to load ' + url + '</p>');
        });
      } else {
        // For search URLs or other critical URLs, show error page
        view.webContents.loadURL('data:text/html,<h1>Failed to load page</h1><p>Unable to load ' + url + '</p><p>Error: ' + err.message + '</p>');
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
  // Explicitly start download
  console.log('Starting download...');
  autoUpdater.downloadUpdate();
});

autoUpdater.on('update-not-available', (info) => {
  console.log('Update not available');
  updateInProgress = false;
  // Notify all windows
  BrowserWindow.getAllWindows().forEach(win => {
    win.webContents.send('update-not-available', info);
  });
});

autoUpdater.on('error', (err) => {
  console.error('Update error:', err);
  updateInProgress = false;
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
  
  try {
    // Notify all windows that update is ready to install
    BrowserWindow.getAllWindows().forEach(win => {
      try {
        if (!win.isDestroyed()) {
          win.webContents.send('update-downloaded', info);
        }
      } catch (err) {
        console.log('Error sending update notification to window:', err.message);
      }
    });
  } catch (err) {
    console.log('Error during update-downloaded notification:', err.message);
  }
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
      const now = Date.now();
      if (!updateInProgress && (now - lastUpdateCheck) > UPDATE_CHECK_COOLDOWN) {
        console.log('Checking for updates...');
        updateInProgress = true;
        lastUpdateCheck = now;
        autoUpdater.checkForUpdatesAndNotify().catch(err => {
          console.log('Update check failed (this is normal if no releases exist yet):', err.message);
          updateInProgress = false;
        });
      }
    }
  }, 3000);

  // Handle IPC messages for updates
  ipcMain.handle('check-for-updates', async () => {
    try {
      if (process.env.NODE_ENV === 'development') {
        throw new Error('Update checking is disabled in development mode');
      }
      
      const now = Date.now();
      if (updateInProgress) {
        throw new Error('Update check already in progress. Please wait.');
      }
      
      if ((now - lastUpdateCheck) < 5000) { // 5 second cooldown for manual checks
        throw new Error('Please wait before checking for updates again.');
      }
      
      updateInProgress = true;
      lastUpdateCheck = now;
      
      const result = await autoUpdater.checkForUpdates();
      if (!result) {
        updateInProgress = false;
      }
      return result;
    } catch (error) {
      updateInProgress = false;
      console.error('Manual update check failed:', error);
      // Don't throw 404 errors to the user interface
      if (error.message.includes('404')) {
        throw new Error('No releases found. Updates will be available once the first release is published.');
      }
      throw error;
    }
  });

  ipcMain.handle('install-update', () => {
    console.log('Installing update, initiating app restart...');
    
    // Immediate response to prevent hanging UI
    return Promise.resolve().then(() => {
      // Close all windows first
      const allWindows = BrowserWindow.getAllWindows();
      console.log(`Closing ${allWindows.length} windows before update...`);
      
      allWindows.forEach(window => {
        try {
          if (!window.isDestroyed()) {
            window.close();
          }
        } catch (err) {
          console.log('Error closing window:', err.message);
        }
      });
      
      // Give windows time to close, then force quit and install
      setTimeout(() => {
        try {
          console.log('Forcing quit and install...');
          autoUpdater.quitAndInstall(true, true); // Force close and install immediately
        } catch (err) {
          console.error('Error during quitAndInstall:', err);
          // Fallback: force quit if quitAndInstall fails
          app.exit(0);
        }
      }, 500); // 500ms should be enough for windows to close
    });
  });

  // Memory management IPC handlers
  ipcMain.handle('get-memory-usage', () => {
    return {
      ...getMemoryUsage(),
      hibernatedTabs: Array.from(memoryMonitoring.hibernatedTabs),
      totalTabs: Array.from(windows.values()).reduce((sum, state) => sum + state.views.size, 0)
    };
  });

  ipcMain.handle('force-garbage-collection', () => {
    if (global.gc) {
      global.gc();
      memoryMonitoring.lastGC = Date.now();
      return getMemoryUsage();
    }
    return null;
  });

  ipcMain.handle('hibernate-inactive-tabs', () => {
    hibernateInactiveTabs();
    return Array.from(memoryMonitoring.hibernatedTabs);
  });

  // Start memory monitoring and management
  console.log('Starting memory management system...');
  
  // Periodic memory monitoring
  setInterval(() => {
    checkMemoryPressure();
  }, 60000); // Check every minute
  
  // Periodic garbage collection
  setInterval(() => {
    triggerGarbageCollectionIfNeeded();
  }, MEMORY_CONFIG.gcIntervalMs);
  
  // Initial memory status
  console.log('Initial memory usage:', getMemoryUsage());
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
  console.log('App is quitting, performing final cleanup...');
  
  try {
    // Clean up all BrowserViews first
    for (const [winId, state] of windows) {
      try {
        for (const [viewId, view] of state.views) {
          try {
            if (view.webContents && !view.webContents.isDestroyed()) {
              view.webContents.removeAllListeners();
              view.webContents.destroy();
            }
          } catch (err) {
            console.log(`Error destroying view ${viewId}:`, err.message);
          }
        }
        state.views.clear();
      } catch (err) {
        console.log(`Error cleaning up window ${winId}:`, err.message);
      }
    }
    
    // Clear the windows map
    windows.clear();
    
    // Final cleanup: remove all listeners from all windows
    BrowserWindow.getAllWindows().forEach(window => {
      try {
        if (!window.isDestroyed()) {
          window.removeAllListeners();
        }
      } catch (err) {
        console.log('Error removing window listeners:', err.message);
      }
    });
    
  } catch (err) {
    console.log('Error during final cleanup:', err.message);
  }
  
  console.log('Final cleanup completed');
});
