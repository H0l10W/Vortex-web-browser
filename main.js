const { app, BrowserWindow, BrowserView, ipcMain, dialog } = require('electron');
const { autoUpdater } = require('electron-updater');
const fs = require('fs');
const path = require('path');

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

// Persistent storage implementation
const userDataPath = app.getPath('userData');
const storageFilePath = path.join(userDataPath, 'browser-storage.json');

// Load storage data from file
function loadStorageData() {
  try {
    if (fs.existsSync(storageFilePath)) {
      const data = fs.readFileSync(storageFilePath, 'utf8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.error('Error loading storage data:', error);
  }
  return {};
}

// Save storage data to file
function saveStorageData(data) {
  try {
    // Ensure the directory exists
    const dir = path.dirname(storageFilePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    fs.writeFileSync(storageFilePath, JSON.stringify(data, null, 2));
    return true;
  } catch (error) {
    console.error('Error saving storage data:', error);
    return false;
  }
}

// Global storage object
let storageData = loadStorageData();

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
// Use proper detection for production
const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

// FORCE dev config for testing
autoUpdater.forceDevUpdateConfig = true;

autoUpdater.checkForUpdatesAndNotify();
autoUpdater.autoDownload = false; // Don't auto-download, let user choose
autoUpdater.autoInstallOnAppQuit = false; // We'll handle installation manually
autoUpdater.allowDowngrade = false; // Prevent downgrade attacks

// Configure auto-updater for GitHub releases
if (!isDev) { // Using forced production mode
  // FORCE auto-updater to work in development
  autoUpdater.forceDevUpdateConfig = true;
  
  autoUpdater.setFeedURL({
    provider: 'github',
    owner: 'H0l10W',
    repo: 'Vortex-web-browser'
  });
  
  // Force clear any cached update info
  autoUpdater.allowPrerelease = false;
  autoUpdater.allowDowngrade = false;
} else {
  // Auto-updater disabled in development
}

// Auto-updater event handlers
autoUpdater.on('checking-for-update', () => {
  // Notify all windows about update check
  BrowserWindow.getAllWindows().forEach(win => {
    win.webContents.send('update-checking');
  });
});

autoUpdater.on('update-available', (info) => {
  // Notify all windows about available update (shows "Update found" notification)
  BrowserWindow.getAllWindows().forEach(win => {
    win.webContents.send('update-available', info);
  });
  // Start download
  autoUpdater.downloadUpdate();
});

autoUpdater.on('update-not-available', (info) => {
  updateInProgress = false;
  // Notify all windows
  BrowserWindow.getAllWindows().forEach(win => {
    try {
      if (!win.isDestroyed()) {
        win.webContents.send('update-not-available', info);
      }
    } catch (err) {
      console.log('Error sending update notification:', err.message);
    }
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

// Memory Management Functions
// ===========================

function triggerGarbageCollectionIfNeeded() {
  const now = Date.now();
  if (now - memoryMonitoring.lastGC > MEMORY_CONFIG.gcIntervalMs) {
    if (global.gc) {
      global.gc();
      memoryMonitoring.lastGC = now;
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
let headerHeight = 129; // Title bar (48px) + Bookmark bar (37px) + Controls (44px)
const headerHeightWithoutBookmarks = 92; // Title bar (48px) + Controls (44px)

// Track bookmark bar visibility globally
let bookmarkBarVisible = true; // Default to true, will be updated by renderer

// Helper function to get the correct header height based on URL
function getHeaderHeightForUrl(url) {
  // Settings page should use reduced height since it has its own internal header
  if (url && url.includes('settings.html')) {
    return 51; // Increased from 43 to prevent overlap with tab bottoms
  }
  // Regular webpages need full header height to avoid overlapping with controls
  // Default to full header height when bookmarks are visible or when URL is unknown
  return bookmarkBarVisible ? 129 : 92; // Updated values
}

function createWindow(initialUrl) {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    frame: false, // Remove default window frame
    titleBarStyle: 'hidden', // Hide title bar
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
              const currentUrl = view.webContents.getURL();
              const effectiveHeaderHeight = getHeaderHeightForUrl(currentUrl);
              view.setBounds({ x: 0, y: effectiveHeaderHeight, width: bounds.width, height: bounds.height - effectiveHeaderHeight });
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
            const currentUrl = view.webContents.getURL();
            const effectiveHeaderHeight = getHeaderHeightForUrl(currentUrl);
            view.setBounds({ x: 0, y: effectiveHeaderHeight, width: bounds.width, height: bounds.height - effectiveHeaderHeight });
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
            const currentUrl = view.webContents.getURL();
            const effectiveHeaderHeight = getHeaderHeightForUrl(currentUrl);
            view.setBounds({ x: 0, y: effectiveHeaderHeight, width: bounds.width, height: bounds.height - effectiveHeaderHeight });
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
            const currentUrl = view.webContents.getURL();
            const effectiveHeaderHeight = getHeaderHeightForUrl(currentUrl);
            view.setBounds({ x: 0, y: effectiveHeaderHeight, width: bounds.width, height: bounds.height - effectiveHeaderHeight });
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
  ipcMain.removeAllListeners('close-app');ipcMain.on('view:create', async (event, id, settings = {}) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return;

  const state = windows.get(win.id);
  if (!state || state.views.has(id)) return;

  // Get JavaScript setting from settings or default
  const javascriptEnabled = settings.javascriptEnabled !== 'false';
  console.log('Creating view with JavaScript enabled:', javascriptEnabled);

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
      safeDialogs: true,
      javascript: javascriptEnabled // Apply JavaScript setting
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
    // Allow notifications, fullscreen, and geolocation permissions
    const allowedPermissions = ['notifications', 'fullscreen', 'geolocation'];
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
      const currentUrl = view.webContents.getURL();
      const effectiveHeaderHeight = getHeaderHeightForUrl(currentUrl);
      view.setBounds({ x: 0, y: effectiveHeaderHeight, width: bounds.width, height: bounds.height - effectiveHeaderHeight });
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
    const currentUrl = view.webContents.getURL();
    const effectiveHeaderHeight = getHeaderHeightForUrl(currentUrl);
    view.setBounds({ x: 0, y: effectiveHeaderHeight, width: bounds.width, height: bounds.height - effectiveHeaderHeight });
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

ipcMain.on('set-bookmark-bar-visibility', (event, visible) => {
  bookmarkBarVisible = visible;
  headerHeight = visible ? 129 : headerHeightWithoutBookmarks;
  
  // Update current BrowserView bounds for the window
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) {
    const currentView = win.getBrowserView();
    if (currentView) {
      const bounds = win.getContentBounds();
      
      // Use helper function to get correct header height
      const currentUrl = currentView.webContents.getURL();
      const effectiveHeaderHeight = getHeaderHeightForUrl(currentUrl); // Settings always use full height
      
      currentView.setBounds({ 
        x: 0, 
        y: effectiveHeaderHeight, 
        width: bounds.width, 
        height: bounds.height - effectiveHeaderHeight 
      });
    }
  }
});

ipcMain.on('toggle-devtools', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return;
  const state = windows.get(win.id);
  // Prefer toggling devtools of the active BrowserView (webpage) if present
  if (state && state.activeViewId && state.views.has(state.activeViewId)) {
    const view = state.views.get(state.activeViewId);
    if (view && view.webContents && !view.webContents.isDestroyed()) {
      view.webContents.toggleDevTools();
      return;
    }
  }
  // Fallback to toggling the main window devtools (UI)
  win.webContents.toggleDevTools();
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

// Storage API handlers
ipcMain.handle('storage-get', (event, key) => {
  return storageData[key] || null;
});

ipcMain.handle('storage-set', (event, key, value) => {
  storageData[key] = value;
  const ok = saveStorageData(storageData);
  try { console.debug(`storage-set ${key}: ${ok}`); } catch (e) { /* ignore */ }
  return ok;
});

ipcMain.handle('storage-remove', (event, key) => {
  delete storageData[key];
  return saveStorageData(storageData);
});

ipcMain.handle('storage-get-all-keys', () => {
  return Object.keys(storageData);
});

// Broadcast history updated event
ipcMain.on('history-updated', (_event) => {
  BrowserWindow.getAllWindows().forEach(win => {
    try { win.webContents.send('history-updated'); } catch (e) {}
  });
});

// Choose download folder dialog
ipcMain.handle('choose-download-folder', async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const result = await dialog.showOpenDialog(win, {
    properties: ['openDirectory'],
    title: 'Choose Download Folder'
  });
  
  if (!result.canceled && result.filePaths.length > 0) {
    return result.filePaths[0];
  }
  
  return null;
});

// Apply browser settings to views
ipcMain.handle('apply-browser-settings', async (event, viewId, settings) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const windowState = windows.get(win.id);
  
  if (!windowState) return false;
  
  const view = windowState.views.get(viewId);
  if (!view) return false;
  
  try {
    // Use provided settings or defaults
    const javascriptEnabled = settings?.javascriptEnabled !== 'false';
    const imagesEnabled = settings?.imagesEnabled !== 'false'; 
    const popupBlockerEnabled = settings?.popupBlockerEnabled !== 'false';
    const userAgent = settings?.userAgent;
    const smoothScrolling = settings?.smoothScrolling === 'true';
    const reducedAnimations = settings?.reducedAnimations === 'true';
    const pageZoom = settings?.pageZoom || '100';
    
    console.log('Applying browser settings:', { javascriptEnabled, imagesEnabled, popupBlockerEnabled, userAgent, smoothScrolling, reducedAnimations, pageZoom });
    
    // Apply JavaScript setting via webPreferences
    view.webContents.session.setPermissionRequestHandler((webContents, permission, callback) => {
      if (permission === 'javascript') {
        callback(javascriptEnabled);
      } else {
        callback(true);
      }
    });
    
    // Apply images setting
    if (!imagesEnabled) {
      view.webContents.session.webRequest.onBeforeRequest(
        { urls: ['*://*/*.jpg', '*://*/*.jpeg', '*://*/*.png', '*://*/*.gif', '*://*/*.webp', '*://*/*.svg'] },
        (details, callback) => {
          callback({ cancel: true });
        }
      );
    } else {
      // Clear image blocking if previously set
      view.webContents.session.webRequest.onBeforeRequest(null);
    }
    
    // Apply popup blocker setting
    if (popupBlockerEnabled) {
      view.webContents.setWindowOpenHandler(({ url }) => {
        console.log('Popup blocked:', url);
        return { action: 'deny' };
      });
    } else {
      view.webContents.setWindowOpenHandler(({ url }) => {
        return { action: 'allow' };
      });
    }
    
    // Apply custom user agent
    if (userAgent && userAgent.trim()) {
      view.webContents.setUserAgent(userAgent);
    }
    
    // Apply zoom level
    const zoomFactor = parseInt(pageZoom) / 100;
    view.webContents.setZoomFactor(zoomFactor);
    
    // Inject CSS for webpage-level settings
    view.webContents.on('dom-ready', () => {
      let cssToInject = '';
      
      // Smooth scrolling for webpages
      if (settings?.smoothScrolling === 'true') {
        cssToInject += `
          html { 
            scroll-behavior: smooth !important; 
          }
        `;
      }
      
      // Reduced animations for webpages
      if (settings?.reducedAnimations === 'true') {
        cssToInject += `
          *, *::before, *::after {
            animation-duration: 0.1s !important;
            transition-duration: 0.1s !important;
            animation-delay: 0s !important;
          }
        `;
      }
      
      if (cssToInject) {
        view.webContents.insertCSS(cssToInject);
      }
    });
    
    return true;
  } catch (error) {
    console.error('Error applying browser settings:', error);
    return false;
  }
});

// Update search engine setting
ipcMain.handle('set-search-engine', async (event, engine) => {
  storageData.searchEngine = engine;
  saveStorageData(storageData);
  return true;
});

// Update homepage setting  
ipcMain.handle('set-homepage', async (event, url) => {
  storageData.homepage = url;
  saveStorageData(storageData);
  return true;
});

// Update download location setting
ipcMain.handle('set-download-location', async (event, path) => {
  storageData.downloadLocation = path;
  saveStorageData(storageData);
  
  // Apply to all existing sessions
  const allWindows = BrowserWindow.getAllWindows();
  allWindows.forEach(win => {
    if (win.webContents.session) {
      win.webContents.session.setDownloadPath(path);
    }
  });
  
  return true;
});

// Apply UI settings to main browser window
ipcMain.handle('apply-ui-settings', async (event, settings) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return false;
  
  try {
    console.log('Applying UI settings:', settings);
    
    // Apply settings to main browser window
    if (settings.smoothScrolling !== undefined) {
      const smoothScrolling = settings.smoothScrolling === 'true';
      win.webContents.insertCSS(`
        html { 
          scroll-behavior: ${smoothScrolling ? 'smooth' : 'auto'} !important; 
        }
      `);
    }
    
    if (settings.reducedAnimations !== undefined) {
      const reduced = settings.reducedAnimations === 'true';
      const animationSpeed = reduced ? '0.1s' : '0.3s';
      win.webContents.insertCSS(`
        :root {
          --animation-speed: ${animationSpeed} !important;
          --transition-speed: ${animationSpeed} !important;
        }
        *, *::before, *::after {
          animation-duration: ${animationSpeed} !important;
          transition-duration: ${animationSpeed} !important;
        }
      `);
    }
    
    return true;
  } catch (error) {
    console.error('Error applying UI settings:', error);
    return false;
  }
});

// Set zoom level for all views
ipcMain.handle('set-zoom-level', async (event, zoomPercent) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return false;
  
  try {
    console.log('Setting zoom level:', zoomPercent + '%');
    const windowState = windows.get(win.id);
    
    if (windowState) {
      // Convert percentage to zoom factor (100% = 1.0, 150% = 1.5, 75% = 0.75)
      const zoomFactor = zoomPercent / 100;
      
      // Apply to all views in this window
      windowState.views.forEach((view, viewId) => {
        view.webContents.setZoomFactor(zoomFactor);
      });
    }
    
    return true;
  } catch (error) {
    console.error('Error setting zoom level:', error);
    return false;
  }
});

// Set close tabs on exit behavior
ipcMain.handle('set-close-tabs-on-exit', async (event, enabled) => {
  try {
    console.log('Setting close tabs on exit:', enabled);
    storageData.closeTabsOnExit = enabled.toString();
    saveStorageData(storageData);
    return true;
  } catch (error) {
    console.error('Error setting close tabs on exit:', error);
    return false;
  }
});

// Set tab previews enabled
ipcMain.handle('set-tab-previews-enabled', async (event, enabled) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return false;
  
  try {
    console.log('Setting tab previews enabled:', enabled);
    storageData.tabPreviewsEnabled = enabled.toString();
    saveStorageData(storageData);
    
    // Send setting to main window to update tab rendering
    win.webContents.send('tab-previews-setting-changed', enabled);
    return true;
  } catch (error) {
    console.error('Error setting tab previews:', error);
    return false;
  }
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

app.whenReady().then(() => {
  console.log('=== AUTO-UPDATER DEBUG INFO ===');
  console.log('App version:', app.getVersion());
  console.log('Repository configured: H0l10W/Vortex-web-browser');
  console.log('Expected API URL: https://api.github.com/repos/H0l10W/Vortex-web-browser/releases/latest');
  console.log('Auto-updater provider:', autoUpdater.getFeedURL());
  console.log('================================');
  
  // Initialize non-critical components after window creation
  setImmediate(() => {
    initAdBlocker();
    
    // Initialize auto-updater in production (restored from working v0.1.12)
    if (!isDev) { // Using forced production mode
      setTimeout(() => {
        console.log('=== SETIMMEDIATE AUTO-UPDATE CHECK ===');
        autoUpdater.checkForUpdatesAndNotify();
      }, 5000); // Wait 5 seconds after app start
    }
  });
  
  createWindow();

  // Send debug info to renderer console after window is created
  setTimeout(() => {
    const debugInfo = {
      appVersion: app.getVersion(),
      repository: 'H0l10W/Vortex-web-browser',
      apiUrl: 'https://api.github.com/repos/H0l10W/Vortex-web-browser/releases/latest',
      feedUrl: autoUpdater.getFeedURL()
    };
    
    BrowserWindow.getAllWindows().forEach(win => {
      if (!win.isDestroyed()) {
        win.webContents.send('auto-updater-debug-info', debugInfo);
      }
    });
  }, 2000);

  // Check for updates after app is ready (restored working pattern from v0.1.12)
  setTimeout(() => {
    if (!isDev) { // Using forced production mode
      const now = Date.now();
      if (!updateInProgress && (now - lastUpdateCheck) > UPDATE_CHECK_COOLDOWN) {
        console.log('=== MAIN AUTO-UPDATE CHECK ===');
        console.log('Checking for updates...');
        updateInProgress = true;
        lastUpdateCheck = now;
        autoUpdater.checkForUpdatesAndNotify().catch(err => {
          console.log('Update check failed (this is normal if no releases exist yet):', err.message);
          updateInProgress = false;
        });
      } else {
        console.log('Skipping update check - conditions not met');
        console.log('updateInProgress:', updateInProgress);
        console.log('time since last check:', (now - lastUpdateCheck), 'ms');
        console.log('required cooldown:', UPDATE_CHECK_COOLDOWN, 'ms');
      }
    } else {
      console.log('Auto-update check skipped - development mode');
    }
  }, 3000);

  // Handle IPC messages for updates
  ipcMain.handle('check-for-updates', async () => {
    console.log('=== MANUAL UPDATE CHECK TRIGGERED ===');
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
      
      console.log('Manual update check initiated...');
      console.log('Current app version:', app.getVersion());
      
      // Test direct GitHub API access first
      console.log('Testing direct GitHub API access...');
      try {
        const https = require('https');
        const apiTest = new Promise((resolve, reject) => {
          const options = {
            hostname: 'api.github.com',
            path: '/repos/H0l10W/Vortex-web-browser/releases/latest',
            method: 'GET',
            headers: {
              'User-Agent': 'VortexBrowser/0.1.31 (https://github.com/H0l10W/Vortex-web-browser)',
              'Accept': 'application/vnd.github.v3+json'
            }
          };
          
          const req = https.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
              console.log('Direct API test - Status:', res.statusCode);
              console.log('Direct API test - Headers:', res.headers);
              if (res.statusCode === 200) {
                const parsed = JSON.parse(data);
                console.log('Direct API test - Latest version:', parsed.tag_name);
                resolve(parsed);
              } else {
                console.log('Direct API test - Error response:', data);
                reject(new Error(`API returned ${res.statusCode}: ${data}`));
              }
            });
          });
          req.on('error', err => {
            console.log('Direct API test - Network error:', err.message);
            reject(err);
          });
          req.setTimeout(10000, () => {
            console.log('Direct API test - Timeout after 10 seconds');
            req.destroy();
            reject(new Error('API request timeout'));
          });
          req.end();
        });
        
        const apiResult = await apiTest;
        console.log('Direct API test successful, proceeding with auto-updater...');
      } catch (apiError) {
        console.error('Direct API test failed:', apiError.message);
        console.error('This suggests a network/firewall issue blocking GitHub API access');
      }
      
      // Force a fresh check by clearing any cached data
      const result = await autoUpdater.checkForUpdates();
      
      if (!result) {
        updateInProgress = false;
        console.log('No update result returned');
        return null;
      }
      
      console.log('Update check result:', JSON.stringify(result, null, 2));
      return result;
    } catch (error) {
      updateInProgress = false;
      console.error('Manual update check failed:', error);
      console.error('Error details - code:', error.code, 'message:', error.message);
      console.error('Full error object:', JSON.stringify(error, Object.getOwnPropertyNames(error), 2));
      
      // Don't throw 404 errors to the user interface
      if (error.message.includes('404')) {
        console.error('404 error detected - GitHub releases API not accessible');
        console.error('Expected API URL: https://api.github.com/repos/H0l10W/Vortex-web-browser/releases');
        throw new Error('No releases found. Updates will be available once the first release is published.');
      }
      throw error;
    }
  });

  ipcMain.handle('install-update', async () => {
    console.log('=== INSTALL UPDATE CALLED ===');
    console.log('App is packaged:', app.isPackaged);
    console.log('Current version:', app.getVersion());
    
    if (!app.isPackaged) {
      console.log('Development mode - just quitting app');
      setTimeout(() => app.quit(), 500);
      return { success: true, reason: 'Development mode' };
    }
    
    console.log('Packaged app mode - using quitAndInstall');
    
    try {
      // Respond immediately
      setImmediate(() => {
        console.log('Calling autoUpdater.quitAndInstall()...');
        try {
          autoUpdater.quitAndInstall(false, true); // Don't force close immediately, but restart after quit
          console.log('quitAndInstall called successfully');
        } catch (err) {
          console.error('quitAndInstall failed:', err);
          console.log('Force quitting as fallback...');
          app.exit(0);
        }
      });
      
      return { success: true };
    } catch (err) {
      console.error('Install update error:', err);
      return { success: false, error: err.message };
    }
  });

  // Window control IPC handlers
  ipcMain.handle('minimize-window', () => {
    const focusedWindow = BrowserWindow.getFocusedWindow();
    if (focusedWindow) {
      focusedWindow.minimize();
    }
  });

  ipcMain.handle('maximize-window', () => {
    const focusedWindow = BrowserWindow.getFocusedWindow();
    if (focusedWindow) {
      if (focusedWindow.isMaximized()) {
        focusedWindow.unmaximize();
      } else {
        focusedWindow.maximize();
      }
    }
  });

  ipcMain.handle('close-window', () => {
    const focusedWindow = BrowserWindow.getFocusedWindow();
    if (focusedWindow) {
      focusedWindow.close();
    }
  });

  ipcMain.handle('is-maximized', () => {
    const focusedWindow = BrowserWindow.getFocusedWindow();
    return focusedWindow ? focusedWindow.isMaximized() : false;
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
  console.log('Memory management system enabled');
  
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
  
  // Check close tabs on exit setting
  if (storageData.closeTabsOnExit === 'true') {
    console.log('Close tabs on exit enabled - clearing saved tabs');
    // Clear saved tabs data
    storageData.tabs = [];
    storageData.currentTabId = null;
    saveStorageData(storageData);
  }
  
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
