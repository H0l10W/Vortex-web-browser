const { app, BrowserWindow, BrowserView, ipcMain, dialog } = require('electron');
const { autoUpdater } = require('electron-updater');
const fs = require('fs');
const path = require('path');
const { pathToFileURL, fileURLToPath } = require('url');

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
// Auto-download for production for reliability, but keep disabled in development
autoUpdater.autoDownload = !isDev;
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
  try {
    updateInProgress = true;
    _lastUpdaterPercent = 0;
    _downloadRetries = 0;
    autoUpdater.downloadUpdate();
  } catch (err) {
    console.error('Failed to start auto-update download:', err);
    // Notify all windows about the error
    BrowserWindow.getAllWindows().forEach(win => {
      try { win.webContents.send('update-error', err.message || String(err)); } catch(e){}
    });
  }
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
  // If this was a download error, attempt a small number of retries
  if (typeof _downloadRetries === 'undefined') _downloadRetries = 0;
  if (_downloadRetries < 3) {
    _downloadRetries++;
    console.log('Retrying update download in 5s (attempt', _downloadRetries, ')');
    setTimeout(() => {
      try {
        autoUpdater.downloadUpdate();
      } catch (e) {
        console.error('Retry downloadUpdate failed:', e);
      }
    }, 5000);
  } else {
    _downloadRetries = 0;
  }
});

let _lastUpdaterPercent = 0;
let _downloadRetries = 0;
autoUpdater.on('download-progress', (progressObj) => {
  const percent = Math.round(progressObj.percent);
  // Only forward progress updates in 10% increments or when complete, to reduce IPC noise
  if (percent >= _lastUpdaterPercent + 10 || percent === 100) {
    _lastUpdaterPercent = percent;
    console.log('Download progress:', percent + '%');
    BrowserWindow.getAllWindows().forEach(win => {
      try { win.webContents.send('update-download-progress', { percent }); } catch (e) { /* ignore */ }
    });
  }
});

autoUpdater.on('update-downloaded', (info) => {
  console.log('Update downloaded:', info.version);
  _lastUpdaterPercent = 100;
  updateInProgress = false;
  _downloadRetries = 0;
  
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

function createWindow(initialUrl, isFresh = false) {
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
    viewMeta: new Map(),
  };
  windows.set(win.id, windowState);

  // Load the main HTML file, optionally with an initial URL for a new-window request
  try {
    const indexPath = path.join(__dirname, 'index.html');
    let indexUrl = pathToFileURL(indexPath).href;
    const queryParts = [];
    if (initialUrl) queryParts.push(`newWindowUrl=${encodeURIComponent(initialUrl)}`);
    if (isFresh) queryParts.push('fresh=1');
    // Add a windowId so each renderer persists its tabs separately
    queryParts.push(`windowId=${win.id}`);
    if (queryParts.length) indexUrl += `?${queryParts.join('&')}`;
    win.loadURL(indexUrl);
  } catch (e) {
    console.error('Error loading initial URL for new window:', e);
    win.loadFile('index.html');
  }

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

  // If an initial URL is used, the renderer will pick it up from the query string

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

  // Attempt to recover failed loads, particularly file:// pages restored after restart
  view.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
    try {
      console.warn(`View ${id} failed to load: ${validatedURL} (${errorCode}) ${errorDescription}`);
      if (validatedURL && validatedURL.startsWith('file://')) {
        // Try loading using loadFile for local file paths
        try {
          const localPath = fileURLToPath(validatedURL);
          console.log(`Attempting to load local file fallback for view ${id}: ${localPath}`);
          view.webContents.loadFile(localPath).then(() => {
            console.log(`Successfully loaded fallback local file for view ${id}`);
          }).catch(err => {
            console.error(`Fallback loadFile failed for view ${id}:`, err);
          });
        } catch (innerErr) {
          console.error('Error while converting file URL to path for fallback:', innerErr);
        }
      }
    } catch (err) {
      console.error('Error in did-fail-load handler:', err);
    }
  });
  
  view.webContents.setWindowOpenHandler(({ url }) => {
    win.webContents.send('open-in-new-tab', url);
    return { action: 'deny' };
  });

  // Add context menu handling for links and media
  view.webContents.on('context-menu', (event, params) => {
    try {
      const { Menu, clipboard, shell } = require('electron');
      const template = [];
      if (params.linkURL) {
        template.push({ label: 'Open Link in New Tab', click: () => win.webContents.send('open-in-new-tab', params.linkURL) });
        template.push({ label: 'Open Link in New Window', click: () => {
          // Create a new (fresh) window that opens the link directly (no duplication)
          createWindow(params.linkURL, true);
        } });
        template.push({ type: 'separator' });
        template.push({ label: 'Open Link in Default Browser', click: () => shell.openExternal(params.linkURL) });
        template.push({ label: 'Copy Link', click: () => clipboard.writeText(params.linkURL) });
      }
      // Fallback inspect element for dev
      if (isDev) {
        template.push({ type: 'separator' });
        template.push({ label: 'Inspect Element', click: () => view.webContents.inspectElement(params.x, params.y) });
      }
      if (template.length) {
        const m = Menu.buildFromTemplate(template);
        m.popup({ window: win });
      }
    } catch (err) {
      console.error('Context menu error:', err);
    }
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
      if (state.viewMeta && state.viewMeta.has(id)) state.viewMeta.delete(id);
      
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

// --- Tab drag/drop across windows ---
let currentTabDrag = null; // { sourceWinId, tab }
// Tracks pending transfers waiting for destination renderer ack keyed by tabId
const pendingTransfers = new Map();
// Also track by transferId (string) for robust matching across windows
const pendingTransfersByTransferId = new Map();
const rendererReady = new Map(); // DOMContentLoaded map
const rendererUIReady = new Map(); // UI initialized map

ipcMain.on('renderer-ready', (event) => {
  try {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return;
    rendererReady.set(win.id, true);
    console.log(`Renderer ready for window ${win.id}`);
    win.once('closed', () => rendererReady.delete(win.id));
  } catch (e) { console.error('renderer-ready handling failed', e); }
});

ipcMain.on('renderer-ui-ready', (event) => {
  try {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return;
    rendererUIReady.set(win.id, true);
    console.log(`Renderer UI ready for window ${win.id}`);
    win.once('closed', () => rendererUIReady.delete(win.id));
  } catch (e) { console.error('renderer-ui-ready handling failed', e); }
});

ipcMain.on('tab-drag-start', (event, tab) => {
  try {
    const srcWin = BrowserWindow.fromWebContents(event.sender);
    if (!srcWin) return;
    const state = windows.get(srcWin.id);
    const tid = Number(tab.id);
    const viewRef = (state && state.views && state.views.has(tid)) ? state.views.get(tid) : null;
    
    // Generate a unique transferId for this drag operation
    const transferId = `transfer-${srcWin.id}-${tid}-${Date.now()}`;
    const webContentsId = viewRef && viewRef.webContents ? viewRef.webContents.id : undefined;
    
    // Store drag state globally
    currentTabDrag = {
      sourceWinId: srcWin.id,
      tab: { ...tab, id: tid, transferId, webContentsId },
      viewRef,
      transferId
    };
    
    // Store in pending transfers map for reliable lookup
    pendingTransfersByTransferId.set(transferId, {
      sourceWinId: srcWin.id,
      viewRef,
      tid,
      tab: { ...tab, id: tid, transferId, webContentsId },
      timeout: setTimeout(() => {
        pendingTransfersByTransferId.delete(transferId);
      }, 30000)
    });
    
    console.log('[DND] tab-drag-start:', { sourceWin: srcWin.id, tid, transferId, hasView: !!viewRef, webContentsId });
    
    // Broadcast to all other windows
    const dragPayload = {
      tabMeta: {
        id: tid,
        title: tab.title,
        url: tab.url,
        isIncognito: tab.isIncognito,
        transferId,
        webContentsId,
        sourceWinId: srcWin.id
      }
    };
    
    BrowserWindow.getAllWindows().forEach(w => {
      if (w.id !== srcWin.id && !w.isDestroyed()) {
        w.webContents.send('tab-drag-started', dragPayload);
      }
    });
  } catch (e) {
    console.error('[DND] tab-drag-start failed:', e);
  }
});

ipcMain.on('tab-dropped-here', (event, tabMeta) => {
  try {
    const destWin = BrowserWindow.fromWebContents(event.sender);
    if (!destWin) return;
    
    console.log('[DND] tab-dropped-here:', { destWin: destWin.id, tabMeta });
    
    // Get transferId from metadata
    const transferId = tabMeta?.transferId;
    if (!transferId) {
      console.warn('[DND] No transferId provided, cannot attach tab');
      BrowserWindow.getAllWindows().forEach(w => w.webContents.send('tab-drag-ended'));
      currentTabDrag = null;
      return;
    }
    
    // Look up the pending transfer
    const pending = pendingTransfersByTransferId.get(transferId);
    if (!pending) {
      console.warn('[DND] No pending transfer found for transferId:', transferId);
      BrowserWindow.getAllWindows().forEach(w => w.webContents.send('tab-drag-ended'));
      currentTabDrag = null;
      return;
    }
    
    const { sourceWinId, viewRef, tid, tab } = pending;
    const sourceState = windows.get(sourceWinId);
    const destState = windows.get(destWin.id);
    
    if (!viewRef || !destState) {
      console.warn('[DND] Invalid state for attachment:', { hasView: !!viewRef, hasDestState: !!destState });
      BrowserWindow.getAllWindows().forEach(w => w.webContents.send('tab-drag-ended'));
      currentTabDrag = null;
      pendingTransfersByTransferId.delete(transferId);
      return;
    }
    
    console.log('[DND] Attaching tab:', { sourceWin: sourceWinId, destWin: destWin.id, tid, transferId });
    // Find which window currently owns the view (might have moved during detach)
    let currentOwnerWinId = sourceWinId;
    let currentOwnerState = sourceState;
    
    for (const [wId, st] of windows.entries()) {
      if (st.views && st.views.has(tid)) {
        currentOwnerWinId = wId;
        currentOwnerState = st;
        console.log('[DND] Found view in window:', wId);
        break;
      }
    }
    
    const sourceWin = currentOwnerState?.win;

    // Detach from current owner if different from destination
    if (sourceWin && sourceWin.id !== destWin.id && !sourceWin.isDestroyed()) {
      try {
        if (sourceWin.getBrowserView() === viewRef) {
          sourceWin.setBrowserView(null);
        }
      } catch (e) {
        console.error('[DND] Error detaching view from source:', e);
      }
      
      // Remove from source state
      if (currentOwnerState && currentOwnerState.views) {
        currentOwnerState.views.delete(tid);
        if (currentOwnerState.viewMeta) {
          const meta = currentOwnerState.viewMeta.get(tid);
          if (meta) {
            currentOwnerState.viewMeta.delete(tid);
            destState.viewMeta.set(tid, meta);
          }
        }
      }
    }

    // Attach to destination
    destState.views.set(tid, viewRef);
    destState.activeViewId = tid;
    
    console.log('[DND] View attached to destination state');

    // Finalize attachment - set the BrowserView
    const finalizeAttachment = () => {
      try {
        destWin.setBrowserView(viewRef);
        const bounds = destWin.getContentBounds();
        const effectiveHeaderHeight = getHeaderHeightForUrl(viewRef.webContents.getURL());
        viewRef.setBounds({
          x: 0,
          y: effectiveHeaderHeight,
          width: bounds.width,
          height: bounds.height - effectiveHeaderHeight
        });
        viewRef.setAutoResize({ width: true, height: true });
        
        console.log('[DND] View physically attached to window');
        
        // Notify renderer that attachment is complete
        destWin.webContents.send('attach-tab-handled', {
          tab: {
            id: tid,
            url: tabMeta.url || tab?.url,
            title: tabMeta.title || tab?.title,
            isIncognito: tabMeta.isIncognito || tab?.isIncognito
          },
          viewCreated: true
        });
        
        // Close orphaned source window if it has no more tabs or was created for this drag
        if (sourceWin && sourceWin.id !== destWin.id && !sourceWin.isDestroyed()) {
          const srcState = windows.get(sourceWin.id);
          if (srcState && (srcState.views.size === 0 || srcState.createdForDragTab === tid)) {
            console.log('[DND] Closing source window (empty or drag-created):', sourceWin.id);
            setTimeout(() => {
              if (!sourceWin.isDestroyed()) {
                sourceWin.close();
              }
            }, 100);
          }
        }
        
        // Also check the current owner window (might be different from source)
        if (ownerWin && ownerWin.id !== destWin.id && ownerWin.id !== sourceWin?.id && !ownerWin.isDestroyed()) {
          const ownerState = windows.get(ownerWin.id);
          if (ownerState && (ownerState.views.size === 0 || ownerState.createdForDragTab === tid)) {
            console.log('[DND] Closing owner window (empty or drag-created):', ownerWin.id);
            setTimeout(() => {
              if (!ownerWin.isDestroyed()) {
                ownerWin.close();
              }
            }, 100);
          }
        }
      } catch (e) {
        console.error('[DND] Error in finalizeAttachment:', e);
      }
    };
    
    // Execute attachment immediately if UI is ready, otherwise wait
    if (rendererUIReady.get(destWin.id)) {
      finalizeAttachment();
    } else {
      const uiReadyListener = (event) => {
        const w = BrowserWindow.fromWebContents(event.sender);
        if (w && w.id === destWin.id) {
          finalizeAttachment();
          ipcMain.removeListener('renderer-ui-ready', uiReadyListener);
        }
      };
      ipcMain.on('renderer-ui-ready', uiReadyListener);
    }
    
    // Clean up
    pendingTransfersByTransferId.delete(transferId);
    BrowserWindow.getAllWindows().forEach(w => {
      if (!w.isDestroyed()) w.webContents.send('tab-drag-ended');
    });
    currentTabDrag = null;
    
  } catch (e) {
    console.error('[DND] tab-dropped-here failed:', e);
    BrowserWindow.getAllWindows().forEach(w => {
      if (!w.isDestroyed()) w.webContents.send('tab-drag-ended');
    });
    currentTabDrag = null;
  }
});



ipcMain.on('detach-tab', (event, tab) => {
  try {
    const srcWin = BrowserWindow.fromWebContents(event.sender);
    if (!srcWin) return;
    const srcState = windows.get(srcWin.id);
    const srcTid = Number(tab.id);
    
    console.log('[DND] detach-tab:', { sourceWin: srcWin.id, tabId: srcTid });
    
    // Block detach of newtab placeholders
    if (tab.url === 'newtab') {
      console.warn('[DND] Blocked detach of newtab placeholder');
      return;
    }
    
    if (srcState && srcState.views && srcState.views.has(srcTid)) {
      const view = srcState.views.get(srcTid);
      if (!view) {
        console.warn('[DND] detach-tab: view object missing');
        return;
      }
      
      // Create new window
      const newWin = createWindow(undefined, true);
      console.log('[DND] Created new window for detached tab:', newWin.id);
      
      // Mark this window as created for drag, track the original tab
      const newState = windows.get(newWin.id);
      if (newState) {
        newState.createdForDragTab = srcTid;
      }
      
      newWin.webContents.once('did-finish-load', () => {
        const destState = windows.get(newWin.id);
        if (!destState) return;
        
        // Detach from source
        try {
          if (!srcWin.isDestroyed() && srcWin.getBrowserView() === view) {
            srcWin.setBrowserView(null);
          }
        } catch (e) {
          console.error('[DND] Error detaching view:', e);
        }
        
        // Move metadata
        if (srcState.viewMeta && srcState.viewMeta.has(srcTid)) {
          const meta = srcState.viewMeta.get(srcTid);
          srcState.viewMeta.delete(srcTid);
          destState.viewMeta.set(srcTid, meta);
        }
        
        // Remove from source
        srcState.views.delete(srcTid);
        if (srcState.activeViewId === srcTid) srcState.activeViewId = null;
        
        // Add to destination
        destState.views.set(srcTid, view);
        destState.activeViewId = srcTid;
        
        const finalizeDetach = () => {
          try {
            newWin.setBrowserView(view);
            const bounds = newWin.getContentBounds();
            const effectiveHeaderHeight = getHeaderHeightForUrl(view.webContents.getURL());
            view.setBounds({
              x: 0,
              y: effectiveHeaderHeight,
              width: bounds.width,
              height: bounds.height - effectiveHeaderHeight
            });
            view.setAutoResize({ width: true, height: true });
            
            console.log('[DND] Detach finalized');
            
            // Notify new window
            newWin.webContents.send('attach-tab-handled', {
              tab: {
                id: srcTid,
                url: tab.url,
                title: tab.title,
                isIncognito: tab.isIncognito
              },
              viewCreated: true
            });
            
            // Notify source to remove tab
            if (!srcWin.isDestroyed()) {
              srcWin.webContents.send('remove-tab-record', srcTid);
            }
            
            // Close source window if empty
            if (srcState.views.size === 0 && !srcWin.isDestroyed()) {
              console.log('[DND] Closing emptied source window');
              srcWin.close();
            }
          } catch (e) {
            console.error('[DND] Error in finalizeDetach:', e);
          }
        };
        
        if (rendererUIReady.get(newWin.id)) {
          finalizeDetach();
        } else {
          const uiReadyListener = (event) => {
            const w = BrowserWindow.fromWebContents(event.sender);
            if (w && w.id === newWin.id) {
              finalizeDetach();
              ipcMain.removeListener('renderer-ui-ready', uiReadyListener);
            }
          };
          ipcMain.on('renderer-ui-ready', uiReadyListener);
        }
      });
    } else {
      console.warn('[DND] detach-tab: view not found in source');
    }
  } catch (e) {
    console.error('[DND] detach-tab failed:', e);
  }
});

ipcMain.on('tab-drag-end', (event) => {
  try {
    console.log('[DEBUG] tab-drag-end called');
    // Delay clearing drag state briefly to avoid races where drop handlers run slightly after dragend
    setTimeout(() => {
      currentTabDrag = null;
    }, 500);
    BrowserWindow.getAllWindows().forEach(w => w.webContents.send('tab-drag-ended'));
  } catch (e) { console.error('tab-drag-end failed', e); }
});

// Window dragging handlers
ipcMain.on('move-window', (event, { deltaX, deltaY }) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win && !win.isDestroyed() && !win.isMaximized()) {
    const [x, y] = win.getPosition();
    win.setPosition(x + deltaX, y + deltaY);
  }
});

ipcMain.on('toggle-maximize', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win && !win.isDestroyed()) {
    if (win.isMaximized()) {
      win.unmaximize();
    } else {
      win.maximize();
    }
  }
});

// Check if drop position is over another window and attach tab there
ipcMain.handle('check-drop-target', async (event, { screenX, screenY, tabMeta }) => {
  try {
    console.log('[DND] check-drop-target:', { screenX, screenY, tabMeta });
    
    const sourceWin = BrowserWindow.fromWebContents(event.sender);
    if (!sourceWin) return { handled: false };
    
    // Find window at screen position
    const allWindows = BrowserWindow.getAllWindows();
    let targetWin = null;
    
    for (const win of allWindows) {
      if (win.id === sourceWin.id || win.isDestroyed()) continue;
      
      const bounds = win.getBounds();
      if (screenX >= bounds.x && screenX <= bounds.x + bounds.width &&
          screenY >= bounds.y && screenY <= bounds.y + bounds.height) {
        targetWin = win;
        console.log('[DND] Found target window:', win.id, bounds);
        break;
      }
    }
    
    if (!targetWin) {
      console.log('[DND] No target window found at position');
      return { handled: false };
    }
    
    // Trigger attach on target window
    const transferId = tabMeta.transferId;
    if (!transferId) {
      console.warn('[DND] No transferId in tabMeta');
      return { handled: false };
    }
    
    const pending = pendingTransfersByTransferId.get(transferId);
    if (!pending) {
      console.warn('[DND] No pending transfer for transferId:', transferId);
      return { handled: false };
    }
    
    const { sourceWinId, viewRef, tid, tab } = pending;
    const sourceState = windows.get(sourceWinId);
    const destState = windows.get(targetWin.id);
    
    if (!viewRef || !destState) {
      console.warn('[DND] Invalid state for attachment');
      return { handled: false };
    }
    
    console.log('[DND] Attaching tab to target window:', { sourceWin: sourceWinId, targetWin: targetWin.id, tid });
    
    // Find current owner
    let currentOwnerWinId = sourceWinId;
    let currentOwnerState = sourceState;
    
    for (const [wId, st] of windows.entries()) {
      if (st.views && st.views.has(tid)) {
        currentOwnerWinId = wId;
        currentOwnerState = st;
        break;
      }
    }
    
    const ownerWin = currentOwnerState?.win;
    
    // Detach from current owner
    if (ownerWin && ownerWin.id !== targetWin.id && !ownerWin.isDestroyed()) {
      try {
        if (ownerWin.getBrowserView() === viewRef) {
          ownerWin.setBrowserView(null);
        }
      } catch (e) {
        console.error('[DND] Error detaching:', e);
      }
      
      if (currentOwnerState && currentOwnerState.views) {
        currentOwnerState.views.delete(tid);
        if (currentOwnerState.viewMeta) {
          const meta = currentOwnerState.viewMeta.get(tid);
          if (meta) {
            currentOwnerState.viewMeta.delete(tid);
            destState.viewMeta.set(tid, meta);
          }
        }
      }
    }
    
    // Attach to target
    destState.views.set(tid, viewRef);
    destState.activeViewId = tid;
    
    const finalizeAttachment = () => {
      try {
        targetWin.setBrowserView(viewRef);
        const bounds = targetWin.getContentBounds();
        const effectiveHeaderHeight = getHeaderHeightForUrl(viewRef.webContents.getURL());
        viewRef.setBounds({
          x: 0,
          y: effectiveHeaderHeight,
          width: bounds.width,
          height: bounds.height - effectiveHeaderHeight
        });
        viewRef.setAutoResize({ width: true, height: true });
        
        console.log('[DND] View attached to target window');
        
        targetWin.webContents.send('attach-tab-handled', {
          tab: {
            id: tid,
            url: tabMeta.url || tab?.url,
            title: tabMeta.title || tab?.title,
            isIncognito: tabMeta.isIncognito || tab?.isIncognito
          },
          viewCreated: true
        });
        
        // Close source window if empty OR if it was created for this drag operation
        if (ownerWin && ownerWin.id !== targetWin.id && !ownerWin.isDestroyed()) {
          const ownerState = windows.get(ownerWin.id);
          console.log('[DND] Checking owner window:', { 
            winId: ownerWin.id, 
            viewsSize: ownerState?.views.size,
            createdForDragTab: ownerState?.createdForDragTab,
            currentTid: tid
          });
          
          // Close if empty or if this was the tab the window was created for
          if (ownerState && (ownerState.views.size === 0 || ownerState.createdForDragTab === tid)) {
            console.log('[DND] Closing source window (empty or drag-created)');
            setTimeout(() => {
              if (!ownerWin.isDestroyed()) {
                ownerWin.close();
              }
            }, 100);
          }
        }
        
        // Also check if the original source window (from IPC) is now empty or was drag-created
        if (sourceWin && sourceWin.id !== targetWin.id && sourceWin.id !== ownerWin?.id && !sourceWin.isDestroyed()) {
          const srcState = windows.get(sourceWin.id);
          console.log('[DND] Checking source window:', { 
            winId: sourceWin.id, 
            viewsSize: srcState?.views.size,
            createdForDragTab: srcState?.createdForDragTab,
            currentTid: tid
          });
          
          if (srcState && (srcState.views.size === 0 || srcState.createdForDragTab === tid)) {
            console.log('[DND] Closing original source window (empty or drag-created)');
            setTimeout(() => {
              if (!sourceWin.isDestroyed()) {
                sourceWin.close();
              }
            }, 100);
          }
        }
      } catch (e) {
        console.error('[DND] Error in finalizeAttachment:', e);
      }
    };
    
    if (rendererUIReady.get(targetWin.id)) {
      finalizeAttachment();
    } else {
      const uiReadyListener = (event) => {
        const w = BrowserWindow.fromWebContents(event.sender);
        if (w && w.id === targetWin.id) {
          finalizeAttachment();
          ipcMain.removeListener('renderer-ui-ready', uiReadyListener);
        }
      };
      ipcMain.on('renderer-ui-ready', uiReadyListener);
    }
    
    // Clean up
    pendingTransfersByTransferId.delete(transferId);
    BrowserWindow.getAllWindows().forEach(w => {
      if (!w.isDestroyed()) w.webContents.send('tab-drag-ended');
    });
    
    return { handled: true, targetWindowId: targetWin.id };
  } catch (e) {
    console.error('[DND] check-drop-target failed:', e);
    return { handled: false };
  }
});

// Handle ACK from renderer that a transferred tab has been attached
ipcMain.on('attach-tab-ack', (event, tabId) => {
  try {
    console.log('[DEBUG] attach-tab-ack called', { tabId });
    const tid = Number(tabId);
    console.log(`attach-tab-ack received for ${tid}`);
    if (!pendingTransfers.has(tid)) {
      console.warn(`attach-tab-ack received but no pending transfer found for ${tid}`);
      return;
    }
    const entry = pendingTransfers.get(tid);
    if (!entry) return;
    // Clear timeout
    if (entry.timeout) clearTimeout(entry.timeout);
    // Tell source to remove its tab record now that destination is ready
    const src = windows.get(entry.sourceWinId);
    if (src && src.win && !src.win.isDestroyed()) src.win.webContents.send('remove-tab-record', tid);
    // Notify source window that the drop/attach completed successfully
    try { if (src && src.win && !src.win.isDestroyed()) src.win.webContents.send('tab-drop-complete', tid); } catch (err) { console.error('sending tab-drop-complete failed', err); }
    try {
      // Remove view entries from source state so main no longer tracks this view
      if (src && src.views && src.views.has(tid)) {
        const viewRef = entry.viewRef;
        if (src.win && src.win.getBrowserView && src.win.getBrowserView() === viewRef) {
          try { src.win.setBrowserView(null); } catch (e) {}
        }
        src.views.delete(tid);
      }
      if (src && src.viewMeta && src.viewMeta.has(tid)) src.viewMeta.delete(tid);
      if (src && src.activeViewId === tid) src.activeViewId = null;
    } catch (e) { console.error('attach-tab-ack cleanup of source state failed', e); }
    pendingTransfers.delete(tid);
    // Also clear any pendingTransfersByTransferId entries that refer to this tid
    try {
      for (const [key, val] of pendingTransfersByTransferId.entries()) {
        try {
          if (val && val.tid && Number(val.tid) === tid) {
            pendingTransfersByTransferId.delete(key);
            console.log(`attach-tab-ack cleaned pendingTransfersByTransferId ${key} for tid ${tid}`);
          }
        } catch (e) {}
      }
    } catch (e) {}
    // Clear any drag visual states
    BrowserWindow.getAllWindows().forEach(w => w.webContents.send('tab-drag-ended'));
  } catch (e) { console.error('attach-tab-ack failed', e); }
});

// Debug logging for pendingTransfers size
setInterval(() => {
  try { if (pendingTransfers.size > 0) console.log('Pending transfers:', Array.from(pendingTransfers.keys())); } catch (e) {}
}, 15000);

ipcMain.on('show-tab-context-menu', (event, tab) => {
  try {
    const win = BrowserWindow.fromWebContents(event.sender);
    const { Menu } = require('electron');
    const template = [
      { label: 'Open in New Window', click: () => { createWindow(tab.url, true); } },
      { label: 'Duplicate Tab', click: () => win.webContents.send('open-in-new-tab', tab.url) },
      { type: 'separator' },
      { label: 'Close Tab', click: () => win.webContents.send('remove-tab-by-id', tab.id) }
    ];
    const menu = Menu.buildFromTemplate(template);
    menu.popup({ window: win });
  } catch (e) { console.error('show-tab-context-menu failed', e); }
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

  // Normalize and convert internal file pages to absolute file:// URLs
  try {
      if (!url.startsWith('file://')) {
      if (url === 'settings.html' || url === '/settings.html' || url.endsWith('/settings.html')) {
        url = pathToFileURL(path.join(__dirname, 'settings.html')).href;
      } else if (url === 'history.html' || url === '/history.html' || url.endsWith('/history.html')) {
        url = pathToFileURL(path.join(__dirname, 'history.html')).href;
      }
    }
  } catch (e) {}

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
    // Helper to load URL with a few retries before showing an error page
    function loadUrlWithRetries(targetUrl, attemptsLeft = 3) {
      view.webContents.loadURL(targetUrl, {
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        extraHeaders: 'Accept-Language: en-US,en;q=0.9\r\n'
      }).then(() => {
        console.log(`Successfully loaded: ${targetUrl}`);
      }).catch(err => {
        console.error('Failed to load URL:', targetUrl, 'attemptsLeft:', attemptsLeft, err);
        if (err && err.code === 'ERR_ABORTED') {
          // Navigation was intentionally aborted (not an error state we care about)
          console.log('Navigation aborted, ignoring');
          return;
        }
        if (attemptsLeft > 1) {
          console.log('Retrying load in 1s...');
          setTimeout(() => loadUrlWithRetries(targetUrl, attemptsLeft - 1), 1000);
          return;
        }
        // Common network errors
        if (err && (err.code === 'ERR_NETWORK_CHANGED' || err.code === 'ERR_INTERNET_DISCONNECTED')) {
          view.webContents.loadURL('data:text/html,<h1>Network Error</h1><p>Check your internet connection and try again.</p>');
          return;
        }
        // Try fallback to HTTP for non-google URLs as before
        if (targetUrl.startsWith('https://') && !targetUrl.includes('google.com') && !targetUrl.includes('search')) {
          const httpUrl = targetUrl.replace('https://', 'http://');
          console.log(`Trying HTTP fallback: ${httpUrl}`);
          view.webContents.loadURL(httpUrl).catch(fallbackErr => {
            console.error('HTTP fallback also failed:', fallbackErr);
            view.webContents.loadURL('data:text/html,<h1>Failed to load page</h1><p>Unable to load ' + targetUrl + '</p>');
          });
        } else {
          view.webContents.loadURL('data:text/html,<h1>Failed to load page</h1><p>Unable to load ' + targetUrl + '</p><p>Error: ' + (err && err.message ? err.message : 'Unknown') + '</p>');
        }
      });
    }
    loadUrlWithRetries(url, 3);
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

// Simple notification forwarding so any renderer can show a global toast using the page's UI
ipcMain.on('notify', (event, { message, type, duration } = {}) => {
  // Forward to all windows; renderer should render notifications locally
  BrowserWindow.getAllWindows().forEach(win => {
    try {
      if (event && win.webContents !== event.sender) {
        win.webContents.send('notify', { message, type, duration });
      }
    } catch (e) {}
  });
  // Also instruct the originating window to show it (in case it's not listening to same events)
  try { event.sender.send('notify', { message, type, duration }); } catch (e) {}
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

// Apply or remove web dark mode CSS to a specific BrowserView
ipcMain.handle('apply-web-dark-mode', async (event, viewId, enabled) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return false;
  const state = windows.get(win.id);
  if (!state || !state.views.has(viewId)) return false;
  const view = state.views.get(viewId);
  try {
    if (!state.viewMeta) state.viewMeta = new Map();
    const meta = state.viewMeta.get(viewId) || {};
    const currentUrl = view.webContents.getURL() || '';
    const skipInternal = currentUrl.startsWith('file://') || currentUrl.includes('settings.html') || currentUrl.includes('history.html');
    if (skipInternal && enabled) return true; // do not force dark mode on internal pages
    if (enabled) {
      if (meta.darkCssKey) return true; // already applied
      const darkCss = `html, body { background: #121212 !important; color: #e0e0e0 !important; } img, video, svg { filter: none !important; } * { color-scheme: dark !important; }`;
      const key = await view.webContents.insertCSS(darkCss);
      meta.darkCssKey = key;
      state.viewMeta.set(viewId, meta);
      return true;
    } else {
      if (meta.darkCssKey) {
        const key = meta.darkCssKey;
        await view.webContents.removeInsertedCSS(key);
        delete meta.darkCssKey;
        state.viewMeta.set(viewId, meta);
      }
      return true;
    }
  } catch (e) {
    console.error('apply-web-dark-mode handler error:', e);
    return false;
  }
});

// Apply or remove web dark mode to all BrowserViews for a given window (sender)
ipcMain.handle('apply-web-dark-mode-all', async (event, enabled) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return false;
  const state = windows.get(win.id);
  if (!state) return false;
  try {
    const updates = [];
    for (const [id, view] of state.views) {
      const urlToCheck = view.webContents.getURL() || '';
      const skipInternal = (urlToCheck.startsWith('file://') || urlToCheck.includes('settings.html') || urlToCheck.includes('history.html'));
      if (skipInternal && enabled) {
        // skip inserting CSS on internal pages
        continue;
      }
      // Use the same handler to insert/remove CSS; ensure we collect promises
      if (!enabled) {
        // Remove CSS if present
        const meta = state.viewMeta && state.viewMeta.get(id);
        if (meta && meta.darkCssKey) {
          updates.push(view.webContents.removeInsertedCSS(meta.darkCssKey).then(() => {
            delete meta.darkCssKey;
            state.viewMeta.set(id, meta);
            return true;
          }).catch(() => false));
        }
      } else {
        const darkCss = `html, body { background: #121212 !important; color: #e0e0e0 !important; } * { color-scheme: dark !important; }`;
        updates.push(view.webContents.insertCSS(darkCss).then(key => {
          if (!state.viewMeta) state.viewMeta = new Map();
          const meta = state.viewMeta.get(id) || {};
          meta.darkCssKey = key;
          state.viewMeta.set(id, meta);
          return true;
        }).catch(() => false));
      }
    }
    const results = await Promise.all(updates);
    return results.every(Boolean);
  } catch (e) {
    console.error('apply-web-dark-mode-all handler error:', e);
    return false;
  }
});

// Broadcast history updated event
ipcMain.on('history-updated', (_event) => {
  BrowserWindow.getAllWindows().forEach(win => {
    try { win.webContents.send('history-updated'); } catch (e) {}
  });
});

// Request clear history across all windows
ipcMain.on('request-clear-history', (event) => {
  const senderWin = BrowserWindow.fromWebContents(event.sender);
  BrowserWindow.getAllWindows().forEach(win => {
    if (senderWin && win.id === senderWin.id) return; // Skip origin to avoid loops
    try { win.webContents.send('clear-history'); } catch (e) {}
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
    viewMeta: new Map(),
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
