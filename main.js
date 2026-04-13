const { app, BrowserWindow, BrowserView, ipcMain, dialog } = require('electron');
const { autoUpdater } = require('electron-updater');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { pathToFileURL, fileURLToPath } = require('url');

const DEFAULT_WINDOW_WIDTH = 1200;
const DEFAULT_WINDOW_HEIGHT = 800;

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

// Apply persisted memory configuration overrides (if present)
if (storageData && storageData.memoryConfig && typeof storageData.memoryConfig === 'object') {
  const persistedConfig = storageData.memoryConfig;
  if (Number.isFinite(Number(persistedConfig.maxInactiveTabs))) {
    MEMORY_CONFIG.maxInactiveTabs = Math.max(1, Math.min(100, Number(persistedConfig.maxInactiveTabs)));
  }
  if (Number.isFinite(Number(persistedConfig.memoryThresholdMB))) {
    MEMORY_CONFIG.memoryThresholdMB = Math.max(256, Math.min(16384, Number(persistedConfig.memoryThresholdMB)));
  }
  if (Number.isFinite(Number(persistedConfig.hibernationDelayMs))) {
    MEMORY_CONFIG.hibernationDelayMs = Math.max(60000, Math.min(24 * 60 * 60 * 1000, Number(persistedConfig.hibernationDelayMs)));
  }
}

// Performance telemetry tracking
const networkTelemetry = {
  requestsStarted: 0,
  requestsCompleted: 0,
  requestsFailed: 0,
  bytesDownloaded: 0,
  activeRequests: new Map(), // requestId -> startTime
  latencySamples: [], // { ts, ms }
  requestSamples: [], // { ts }
  byteSamples: [] // { ts, bytes }
};

const instrumentedSessions = new WeakSet();
let previousSystemCpuSample = null;
let gpuInfoCache = { ts: 0, data: null };

function cleanupTelemetrySamples(now = Date.now()) {
  networkTelemetry.latencySamples = networkTelemetry.latencySamples.filter(item => now - item.ts <= 60000);
  networkTelemetry.requestSamples = networkTelemetry.requestSamples.filter(item => now - item.ts <= 60000);
  networkTelemetry.byteSamples = networkTelemetry.byteSamples.filter(item => now - item.ts <= 10000);
}

function getSystemCpuPercent() {
  const cpuTimes = os.cpus().map(core => core.times);
  const totals = cpuTimes.reduce((accumulator, times) => {
    const total = times.user + times.nice + times.sys + times.idle + times.irq;
    accumulator.total += total;
    accumulator.idle += times.idle;
    return accumulator;
  }, { total: 0, idle: 0 });

  const now = Date.now();
  if (!previousSystemCpuSample) {
    previousSystemCpuSample = { ...totals, now };
    return 0;
  }

  const totalDelta = totals.total - previousSystemCpuSample.total;
  const idleDelta = totals.idle - previousSystemCpuSample.idle;
  previousSystemCpuSample = { ...totals, now };

  if (totalDelta <= 0) return 0;
  const activeDelta = totalDelta - idleDelta;
  return Math.max(0, Math.min(100, (activeDelta / totalDelta) * 100));
}

function getHeaderNumber(responseHeaders, headerName) {
  if (!responseHeaders || typeof responseHeaders !== 'object') return 0;
  const headerEntry = Object.entries(responseHeaders).find(([key]) => key.toLowerCase() === headerName.toLowerCase());
  if (!headerEntry) return 0;
  const value = Array.isArray(headerEntry[1]) ? headerEntry[1][0] : headerEntry[1];
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function attachNetworkTelemetry(sessionInstance) {
  if (!sessionInstance || instrumentedSessions.has(sessionInstance)) return;
  instrumentedSessions.add(sessionInstance);

  sessionInstance.webRequest.onBeforeSendHeaders((details, callback) => {
    const now = Date.now();
    networkTelemetry.requestsStarted += 1;
    networkTelemetry.activeRequests.set(details.id, now);
    networkTelemetry.requestSamples.push({ ts: now });
    callback({ requestHeaders: details.requestHeaders });
  });

  sessionInstance.webRequest.onCompleted((details) => {
    const now = Date.now();
    const startedAt = networkTelemetry.activeRequests.get(details.id);
    if (startedAt) {
      networkTelemetry.latencySamples.push({ ts: now, ms: now - startedAt });
      networkTelemetry.activeRequests.delete(details.id);
    }

    networkTelemetry.requestsCompleted += 1;
    const bytes = getHeaderNumber(details.responseHeaders, 'content-length');
    if (bytes > 0) {
      networkTelemetry.bytesDownloaded += bytes;
      networkTelemetry.byteSamples.push({ ts: now, bytes });
    }
  });

  sessionInstance.webRequest.onErrorOccurred((details) => {
    networkTelemetry.requestsFailed += 1;
    networkTelemetry.activeRequests.delete(details.id);
  });
}

async function getCachedGpuInfo() {
  const now = Date.now();
  if (gpuInfoCache.data && now - gpuInfoCache.ts < 30000) {
    return gpuInfoCache.data;
  }

  try {
    const basicInfo = await app.getGPUInfo('basic');
    gpuInfoCache = { ts: now, data: basicInfo };
    return basicInfo;
  } catch (error) {
    return null;
  }
}

async function getSystemMetricsSnapshot() {
  const now = Date.now();
  cleanupTelemetrySamples(now);

  const appMetrics = app.getAppMetrics();
  const browserProcess = appMetrics.find(metric => metric.type === 'Browser');
  const gpuProcess = appMetrics.find(metric => metric.type === 'GPU');
  const rendererProcesses = appMetrics.filter(metric => metric.type === 'Tab' || metric.type === 'Renderer');

  const rendererCpuPercent = rendererProcesses.reduce((sum, metric) => sum + (metric.cpu?.percentCPUUsage || 0), 0);
  const appCpuPercent = (browserProcess?.cpu?.percentCPUUsage || 0) + rendererCpuPercent;
  const gpuCpuPercent = gpuProcess?.cpu?.percentCPUUsage || 0;
  const gpuMemoryMB = gpuProcess?.memory?.workingSetSize ? Math.round(gpuProcess.memory.workingSetSize / 1024) : 0;

  const latencyValues = networkTelemetry.latencySamples.map(sample => sample.ms);
  const averageLatencyMs = latencyValues.length
    ? Math.round(latencyValues.reduce((sum, value) => sum + value, 0) / latencyValues.length)
    : 0;

  const bytesInLast10s = networkTelemetry.byteSamples.reduce((sum, sample) => sum + sample.bytes, 0);
  const avgDownKbps = Math.round((bytesInLast10s * 8) / 10 / 1000);

  const gpuInfo = await getCachedGpuInfo();
  const gpuFeatureStatus = app.getGPUFeatureStatus();
  const processMemory = getMemoryUsage();

  return {
    timestamp: now,
    cpu: {
      appPercent: Number(appCpuPercent.toFixed(2)),
      browserPercent: Number((browserProcess?.cpu?.percentCPUUsage || 0).toFixed(2)),
      rendererPercent: Number(rendererCpuPercent.toFixed(2)),
      gpuPercent: Number(gpuCpuPercent.toFixed(2)),
      systemPercent: Number(getSystemCpuPercent().toFixed(2))
    },
    memory: {
      ...processMemory,
      systemTotalMB: Math.round(os.totalmem() / 1024 / 1024),
      systemFreeMB: Math.round(os.freemem() / 1024 / 1024)
    },
    gpu: {
      processCpuPercent: Number(gpuCpuPercent.toFixed(2)),
      processMemoryMB: gpuMemoryMB,
      featureStatus: gpuFeatureStatus,
      adapters: gpuInfo?.gpuDevice?.length || 0
    },
    network: {
      requestsStarted: networkTelemetry.requestsStarted,
      requestsCompleted: networkTelemetry.requestsCompleted,
      requestsFailed: networkTelemetry.requestsFailed,
      activeRequests: networkTelemetry.activeRequests.size,
      requestsPerMin: networkTelemetry.requestSamples.length,
      averageLatencyMs,
      averageDownKbps: avgDownKbps,
      totalDownloadedMB: Number((networkTelemetry.bytesDownloaded / 1024 / 1024).toFixed(2))
    },
    tabs: {
      totalTabs: Array.from(windows.values()).reduce((sum, state) => sum + state.views.size, 0),
      hibernatedTabs: Array.from(memoryMonitoring.hibernatedTabs).length
    }
  };
}

// Increase max listeners to prevent memory leak warnings
require('events').EventEmitter.defaultMaxListeners = 30;

// Optimize app startup
app.commandLine.appendSwitch('disable-features', 'VizDisplayCompositor');
app.commandLine.appendSwitch('disable-dev-shm-usage');
// Enable security features
app.commandLine.appendSwitch('enable-features', 'VizDisplayCompositor');

// Add this to track BrowserViews for each window
const windows = new Map();
const suggestionsOverlays = new Map();

function hideSuggestionsOverlayForWindow(winId) {
  const overlay = suggestionsOverlays.get(winId);
  if (!overlay || overlay.isDestroyed()) return;
  try { overlay.hide(); } catch (_error) {}
}

function ensureSuggestionsOverlay(parentWin) {
  if (!parentWin || parentWin.isDestroyed()) return null;
  const existing = suggestionsOverlays.get(parentWin.id);
  if (existing && !existing.isDestroyed()) return existing;

  const overlay = new BrowserWindow({
    parent: parentWin,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    show: false,
    focusable: true,
    alwaysOnTop: true,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, 'suggestions-overlay-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      sandbox: true
    }
  });

  overlay.setMenuBarVisibility(false);
  overlay.loadFile('suggestions-overlay.html').catch((error) => {
    console.error('Failed to load suggestions overlay:', error);
  });

  overlay.on('closed', () => {
    suggestionsOverlays.delete(parentWin.id);
  });

  const repositionOverlay = () => {
    try {
      if (overlay.isDestroyed() || !overlay.__lastPayload) return;
      const parentBounds = parentWin.getBounds();
      const lastParentBounds = overlay.__lastParentBounds;
      if (!lastParentBounds) {
        overlay.__lastParentBounds = parentBounds;
        return;
      }

      const deltaX = parentBounds.x - lastParentBounds.x;
      const deltaY = parentBounds.y - lastParentBounds.y;
      if (!deltaX && !deltaY) return;

      const currentBounds = overlay.getBounds();
      const nextBounds = {
        ...currentBounds,
        x: currentBounds.x + deltaX,
        y: currentBounds.y + deltaY
      };
      overlay.setBounds(nextBounds, false);
      overlay.__lastParentBounds = parentBounds;

      if (overlay.__lastPayload && overlay.__lastPayload.bounds) {
        overlay.__lastPayload.bounds.x = Number(overlay.__lastPayload.bounds.x) + deltaX;
        overlay.__lastPayload.bounds.y = Number(overlay.__lastPayload.bounds.y) + deltaY;
      }
    } catch (_error) {
      // ignore reposition failures
    }
  };

  parentWin.on('move', repositionOverlay);
  parentWin.on('resize', repositionOverlay);
  parentWin.on('enter-full-screen', repositionOverlay);
  parentWin.on('leave-full-screen', repositionOverlay);

  parentWin.on('closed', () => {
    try {
      if (!overlay.isDestroyed()) overlay.destroy();
    } catch (_error) {}
    suggestionsOverlays.delete(parentWin.id);
  });

  suggestionsOverlays.set(parentWin.id, overlay);
  return overlay;
}

// Ad blocker initialization using @cliqz/adblocker with uBlock Origin filters
let adblocker = null;
let blockers = new Map();
let adBlockEnabled = false;
let adBlockMode = 'balanced';
const adBlockInstrumentedSessions = new WeakSet();
const imageBlockingWebContents = new Map();

async function initAdBlocker() {
  try {
    const { FiltersEngine } = require('@cliqz/adblocker');
    
    // Try to use cached filters first
    const cacheDir = path.join(app.getPath('userData'), 'adblock-cache');
    const filtersCachePath = path.join(cacheDir, 'ublock.txt');
    
    try {
      await fs.promises.mkdir(cacheDir, { recursive: true });
    } catch (e) {}
    
    let filtersData = null;
    
    // Try to load from cache
    try {
      filtersData = await fs.promises.readFile(filtersCachePath, 'utf-8');
      console.log('Loaded AdBlock filters from cache');
    } catch (e) {
      console.log('Fetching uBlock Origin filter lists...');
      try {
        // Fetch uBlock Origin's filter lists
        const response = await fetch('https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/energy.txt');
        if (response.ok) {
          filtersData = await response.text();
          // Cache the filters
          try {
            await fs.promises.writeFile(filtersCachePath, filtersData);
          } catch (cacheErr) {
            console.debug('Could not cache filters:', cacheErr);
          }
        }
      } catch (fetchErr) {
        console.warn('Could not fetch uBlock filters, using fallback');
        // Fallback: use basic filter format
        filtersData = `||doubleclick.net^
||googlesyndication.com^
||googleadservices.com^
||adnxs.com^
||criteo.com^
||taboola.com^
||outbrain.com^
||amazon-adsystem.com^
||ads.yahoo.com^
||scorecardresearch.com^
`;
      }
    }
    
    if (filtersData) {
      adblocker = await FiltersEngine.parse(filtersData);
      console.log('AdBlock engine initialized with uBlock Origin filters');
    }
    
    const persisted = storageData?.adblockEnabled;
    adBlockEnabled = persisted === true || persisted === 'true';
    
    const persistedMode = storageData?.adblockMode;
    adBlockMode = persistedMode === 'strict' ? 'strict' : 'balanced';
  } catch (err) {
    console.error('Failed to initialize adblocker:', err);
    adblocker = null;
  }
}

// Check if a request should be blocked by adblocker
function shouldBlockAdRequest(details) {
  if (!adblocker) return false;
  
  try {
    const requestUrl = details.url;
    const referrer = details.referrer || details.initiator || '';
    const resourceType = details.resourceType || 'other';
    
    const result = adblocker.match({
      url: requestUrl,
      sourceUrl: referrer || undefined,
      type: resourceType
    });
    
    return result && result.match;
  } catch (err) {
    console.debug('Error in shouldBlockAdRequest:', err);
    return false;
  }
}

// Setup ad-blocking for a session
function setupAdBlockerForSession(session) {
  if (!session || adBlockInstrumentedSessions.has(session)) return;
  
  adBlockInstrumentedSessions.add(session);
  
  session.webRequest.onBeforeRequest((details, callback) => {
    // Check if ad-blocking is enabled
    if (!adBlockEnabled) {
      callback({ cancel: false });
      return;
    }
    
    // Check if it's a request that should be blocked
    if (shouldBlockAdRequest(details)) {
      console.debug('Blocked ad request:', details.url);
      callback({ cancel: true });
      return;
    }
    
    // For image blocking (only in strict mode)
    if (adBlockMode === 'strict' && details.resourceType === 'image') {
      if (shouldBlockAdRequest(details)) {
        callback({ cancel: true });
        return;
      }
    }
    
    callback({ cancel: false });
  });
}

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

function emitHibernationStateForWindow(win) {
  try {
    if (!win || win.isDestroyed()) return;
    const state = windows.get(win.id);
    if (!state) return;
    const hibernatedForWindow = Array.from(memoryMonitoring.hibernatedTabs).filter(tabId => state.views.has(tabId));
    win.webContents.send('hibernation-state-changed', hibernatedForWindow);
  } catch (error) {
    console.debug('Failed to emit hibernation state for window', error);
  }
}

function emitHibernationStateForTab(tabId) {
  for (const [winId, state] of windows) {
    if (state.views && state.views.has(tabId)) {
      emitHibernationStateForWindow(state.win);
    }
  }
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

  emitHibernationStateForTab(tabId);
}

function wakeUpTab(tabId) {
  if (!memoryMonitoring.hibernatedTabs.has(tabId)) return;
  
  console.log(`Waking up tab ${tabId}`);
  memoryMonitoring.hibernatedTabs.delete(tabId);
  memoryMonitoring.tabLastActivity.set(tabId, Date.now());
  emitHibernationStateForTab(tabId);
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

  const candidates = [];

  // Find tabs that haven't been active recently
  for (const [winId, state] of windows) {
    for (const [tabId, view] of state.views) {
      const lastActivity = memoryMonitoring.tabLastActivity.get(tabId) || now;
      const inactiveTime = now - lastActivity;

      // Candidate tabs: inactive beyond threshold, not active, not already hibernated
      if (
        inactiveTime > MEMORY_CONFIG.hibernationDelayMs &&
        tabId !== state.activeViewId &&
        !memoryMonitoring.hibernatedTabs.has(tabId)
      ) {
        candidates.push({ tabId, view, inactiveTime });
      }
    }
  }

  const remainingSlots = Math.max(0, MEMORY_CONFIG.maxInactiveTabs - memoryMonitoring.hibernatedTabs.size);
  if (remainingSlots <= 0 || candidates.length === 0) return;

  // Hibernate the most inactive tabs first
  candidates
    .sort((left, right) => right.inactiveTime - left.inactiveTime)
    .slice(0, remainingSlots)
    .forEach(candidate => {
      hibernateTab(candidate.tabId, candidate.view);
    });
}

function updateTabActivity(tabId) {
  memoryMonitoring.tabLastActivity.set(tabId, Date.now());
  wakeUpTab(tabId); // Wake up if hibernated
}

// Define the header height (height of tabs + controls)
let headerHeight = 92; // Title bar (48px) + Controls (44px)
const headerHeightWithoutBookmarks = 92; // Title bar (48px) + Controls (44px)

// Track bookmark bar visibility globally
let bookmarkBarVisible = false; // Default to false, renderer will enable when actually visible

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
    width: DEFAULT_WINDOW_WIDTH,
    height: DEFAULT_WINDOW_HEIGHT,
    frame: false, // Remove default window frame
    titleBarStyle: 'hidden', // Hide title bar
    icon: path.join(__dirname, 'icons', 'icon.png'), // Add icon for running app
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
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
  attachNetworkTelemetry(session);
  setupAdBlockerForSession(session);

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
    hideSuggestionsOverlayForWindow(win.id);
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
    hideSuggestionsOverlayForWindow(win.id);
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
    hideSuggestionsOverlayForWindow(win.id);
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
    hideSuggestionsOverlayForWindow(win.id);
    const state = windows.get(win.id);
    if (state && state.activeViewId) {
      const view = state.views.get(state.activeViewId);
      if (view) {
        setTimeout(() => {
          const bounds = win.getContentBounds();
          const currentUrl = view.webContents.getURL();
          const effectiveHeaderHeight = getHeaderHeightForUrl(currentUrl);
          view.setBounds({ x: 0, y: effectiveHeaderHeight, width: bounds.width, height: bounds.height - effectiveHeaderHeight });
        }, 10);
      }
    }
  });

  // Clean up IPC listeners when the window is closed
  win.on('closed', () => {
    hideSuggestionsOverlayForWindow(win.id);
    windowDragState.delete(win.id);
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
ipcMain.removeAllListeners('suggestions-overlay:update');
ipcMain.removeAllListeners('suggestions-overlay:hide');
ipcMain.removeAllListeners('suggestions-overlay:select');
ipcMain.removeAllListeners('open-incognito');
ipcMain.removeAllListeners('broadcast-theme-change');
ipcMain.removeAllListeners('toggle-adblock');
ipcMain.removeAllListeners('set-adblock-mode');
ipcMain.removeAllListeners('toggle-devtools');
ipcMain.removeAllListeners('broadcast-widget-settings');
ipcMain.removeAllListeners('close-app');
ipcMain.removeAllListeners('start-window-drag');
ipcMain.removeAllListeners('end-window-drag');

// --- Tab drag/drop across windows ---
let currentTabDrag = null; // { sourceWinId, tab }
const windowDragState = new Map(); // winId -> { offsetX, offsetY, lastScreenX, lastScreenY }
// Tracks pending transfers waiting for destination renderer ack keyed by tabId
const pendingTransfers = new Map();
// Also track by transferId (string) for robust matching across windows
const pendingTransfersByTransferId = new Map();
const rendererReady = new Map(); // DOMContentLoaded map
const rendererUIReady = new Map(); // UI initialized map

function closeWindowFast(win, reason = 'transfer-complete') {
  if (!win || win.isDestroyed()) return;
  try {
    win.hide();
  } catch (_error) {}

  setTimeout(() => {
    try {
      if (!win.isDestroyed()) {
        console.log(`[DND] Fast-closing window ${win.id} (${reason})`);
        win.close();
      }
    } catch (error) {
      console.error('[DND] Fast close failed:', error);
    }
  }, 0);
}

function closeDragCreatedSourceWindow(sourceWin, movedTabId, reason = 'logical-transfer') {
  if (!sourceWin || sourceWin.isDestroyed()) return;
  const sourceState = windows.get(sourceWin.id);
  if (!sourceState) return;
  const dragCreatedMarker = sourceState.createdForDragTab;
  if (dragCreatedMarker === undefined || dragCreatedMarker === null) return;
  closeWindowFast(sourceWin, reason);
}

ipcMain.on('renderer-ready', (event) => {
  try {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return;
    rendererReady.set(win.id, true);
    console.log(`Renderer ready for window ${win.id}`);
    emitHibernationStateForWindow(win);
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
    
    // Reuse renderer-provided transferId when available to avoid cross-process mismatch
    const providedTransferId = typeof tab?.transferId === 'string' ? tab.transferId : '';
    const transferId = providedTransferId || `transfer-${srcWin.id}-${tid}-${Date.now()}`;
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
    
    const sourceWinIdFromMeta = Number(tabMeta?.sourceWinId);
    const sourceWinFromMeta = BrowserWindow.getAllWindows().find(w => w.id === sourceWinIdFromMeta);
    const tabIdFromMeta = Number(tabMeta?.id);

    // Handle webview-based transfers directly from metadata when no BrowserView transfer exists.
    const logicalTransferFromMeta = () => {
      const movedTab = {
        id: Number.isFinite(tabIdFromMeta) ? tabIdFromMeta : Date.now(),
        url: tabMeta?.url,
        title: tabMeta?.title,
        isIncognito: !!tabMeta?.isIncognito
      };
      if (!movedTab.url) {
        console.warn('[DND] Missing URL for logical tab transfer');
        return false;
      }

      destWin.webContents.send('attach-tab-handled', {
        tab: movedTab,
        viewCreated: false,
        dropTargetTabId: Number.isFinite(Number(tabMeta?.dropTargetTabId)) ? Number(tabMeta.dropTargetTabId) : null
      });

      if (sourceWinFromMeta && !sourceWinFromMeta.isDestroyed() && sourceWinFromMeta.id !== destWin.id && Number.isFinite(tabIdFromMeta)) {
        closeDragCreatedSourceWindow(sourceWinFromMeta, tabIdFromMeta, 'tab-dropped-here-logical-from-meta');
        sourceWinFromMeta.webContents.send('remove-tab-record', tabIdFromMeta);
      }

      BrowserWindow.getAllWindows().forEach(w => {
        if (!w.isDestroyed()) w.webContents.send('tab-drag-ended');
      });
      currentTabDrag = null;
      return true;
    };

    // Ignore self-drops from metadata path.
    if (Number.isFinite(sourceWinIdFromMeta) && sourceWinIdFromMeta === destWin.id) {
      BrowserWindow.getAllWindows().forEach(w => {
        if (!w.isDestroyed()) w.webContents.send('tab-drag-ended');
      });
      currentTabDrag = null;
      return;
    }

    // Get transferId from metadata
    const transferId = tabMeta?.transferId;
    if (!transferId) {
      console.warn('[DND] No transferId provided; using logical transfer fallback');
      logicalTransferFromMeta();
      return;
    }
    
    // Look up the pending transfer
    const pending = pendingTransfersByTransferId.get(transferId);
    if (!pending) {
      console.warn('[DND] No pending transfer found for transferId; using logical transfer fallback:', transferId);
      logicalTransferFromMeta();
      return;
    }
    
    const { sourceWinId, viewRef, tid, tab } = pending;
    const sourceState = windows.get(sourceWinId);
    const destState = windows.get(destWin.id);
    const sourceWin = sourceState?.win;

    if (sourceWin && sourceWin.id === destWin.id) {
      pendingTransfersByTransferId.delete(transferId);
      BrowserWindow.getAllWindows().forEach(w => {
        if (!w.isDestroyed()) w.webContents.send('tab-drag-ended');
      });
      currentTabDrag = null;
      return;
    }

    if (!destState) {
      console.warn('[DND] Invalid destination state for attachment');
      BrowserWindow.getAllWindows().forEach(w => {
        if (!w.isDestroyed()) w.webContents.send('tab-drag-ended');
      });
      currentTabDrag = null;
      pendingTransfersByTransferId.delete(transferId);
      return;
    }

    // Webview-based tabs may not have a BrowserView reference; transfer logically via renderer state.
    if (!viewRef) {
      destWin.webContents.send('attach-tab-handled', {
        tab: {
          id: tid,
          url: tabMeta.url || tab?.url,
          title: tabMeta.title || tab?.title,
          isIncognito: tabMeta.isIncognito || tab?.isIncognito
        },
        viewCreated: false,
        dropTargetTabId: Number.isFinite(Number(tabMeta?.dropTargetTabId)) ? Number(tabMeta.dropTargetTabId) : null
      });

      if (sourceWinFromMeta && !sourceWinFromMeta.isDestroyed() && sourceWinFromMeta.id !== destWin.id) {
        const movedId = Number.isFinite(tabIdFromMeta) ? tabIdFromMeta : tid;
        closeDragCreatedSourceWindow(sourceWinFromMeta, movedId, 'tab-dropped-here-logical-no-viewref');
        sourceWinFromMeta.webContents.send('remove-tab-record', movedId);
      }

      pendingTransfersByTransferId.delete(transferId);
      BrowserWindow.getAllWindows().forEach(w => {
        if (!w.isDestroyed()) w.webContents.send('tab-drag-ended');
      });
      currentTabDrag = null;
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
    const ownerWin = currentOwnerState?.win;
    const viewSourceWin = currentOwnerState?.win;

    // Detach from current owner if different from destination
    if (viewSourceWin && viewSourceWin.id !== destWin.id && !viewSourceWin.isDestroyed()) {
      try {
        if (viewSourceWin.getBrowserView() === viewRef) {
          viewSourceWin.setBrowserView(null);
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
          viewCreated: true,
          dropTargetTabId: Number.isFinite(Number(tabMeta?.dropTargetTabId)) ? Number(tabMeta.dropTargetTabId) : null
        });
        
        // Close orphaned source window if it has no more tabs or was created for this drag
        if (viewSourceWin && viewSourceWin.id !== destWin.id && !viewSourceWin.isDestroyed()) {
          const srcState = windows.get(viewSourceWin.id);
          if (srcState && (srcState.views.size === 0 || srcState.createdForDragTab === tid)) {
            console.log('[DND] Closing source window (empty or drag-created):', viewSourceWin.id);
            closeWindowFast(viewSourceWin, 'source-empty-or-drag-created');
          }
        }
        
        // Also check the current owner window (might be different from source)
        if (ownerWin && ownerWin.id !== destWin.id && ownerWin.id !== viewSourceWin?.id && !ownerWin.isDestroyed()) {
          const ownerState = windows.get(ownerWin.id);
          if (ownerState && (ownerState.views.size === 0 || ownerState.createdForDragTab === tid)) {
            console.log('[DND] Closing owner window (empty or drag-created):', ownerWin.id);
            closeWindowFast(ownerWin, 'owner-empty-or-drag-created');
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
              closeWindowFast(srcWin, 'detach-source-emptied');
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
      // Internal tabs (settings/history/newtab) may not have a BrowserView; detach by opening URL in a fresh window.
      console.warn('[DND] detach-tab: view not found in source; falling back to URL detach');
      const fallbackUrl = tab && typeof tab.url === 'string' ? tab.url : null;
      const detachedWin = fallbackUrl ? createWindow(fallbackUrl, true) : createWindow(undefined, true);
      try {
        const detachedState = windows.get(detachedWin.id);
        if (detachedState) {
          detachedState.createdForDragTab = srcTid;
        }
      } catch (err) {
        console.error('[DND] Failed to tag fallback detached window with createdForDragTab', err);
      }
      try {
        if (!srcWin.isDestroyed()) srcWin.webContents.send('remove-tab-record', srcTid);
      } catch (e) {}
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
ipcMain.on('start-window-drag', (event, payload = {}) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win || win.isDestroyed()) return;

  const screenX = Number(payload?.screenX);
  const screenY = Number(payload?.screenY);
  const anchorRatio = Number(payload?.dragAnchorRatio);
  if (!Number.isFinite(screenX) || !Number.isFinite(screenY)) return;

  const clampedAnchor = Number.isFinite(anchorRatio)
    ? Math.max(0, Math.min(1, anchorRatio))
    : 0.5;

  if (win.isMaximized()) {
    win.unmaximize();
    win.setSize(DEFAULT_WINDOW_WIDTH, DEFAULT_WINDOW_HEIGHT);
    const restoredBounds = win.getBounds();
    const nextX = Math.round(screenX - (restoredBounds.width * clampedAnchor));
    const nextY = Math.round(screenY - 12);
    if (Number.isFinite(nextX) && Number.isFinite(nextY)) {
      win.setPosition(nextX, nextY);
    }
  }

  const [winX, winY] = win.getPosition();
  windowDragState.set(win.id, {
    offsetX: Math.max(0, Math.round(screenX - winX)),
    offsetY: Math.max(0, Math.round(screenY - winY)),
    lastScreenX: screenX,
    lastScreenY: screenY
  });
});

ipcMain.on('move-window', (event, payload = {}) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win || win.isDestroyed()) return;

  let dragState = windowDragState.get(win.id);
  const screenX = Number(payload?.screenX);
  const screenY = Number(payload?.screenY);

  if (!dragState && Number.isFinite(screenX) && Number.isFinite(screenY) && !win.isMaximized()) {
    const [winX, winY] = win.getPosition();
    dragState = {
      offsetX: Math.max(0, Math.round(screenX - winX)),
      offsetY: Math.max(0, Math.round(screenY - winY)),
      lastScreenX: screenX,
      lastScreenY: screenY
    };
    windowDragState.set(win.id, dragState);
  }

  if (dragState && Number.isFinite(screenX) && Number.isFinite(screenY)) {
    const movedX = Math.abs(screenX - dragState.lastScreenX);
    const movedY = Math.abs(screenY - dragState.lastScreenY);
    if (movedX < 1 && movedY < 1) return;

    const nextX = Math.round(screenX - dragState.offsetX);
    const nextY = Math.round(screenY - dragState.offsetY);
    if (Number.isFinite(nextX) && Number.isFinite(nextY)) {
      win.setPosition(nextX, nextY);
    }
    dragState.lastScreenX = screenX;
    dragState.lastScreenY = screenY;
    windowDragState.set(win.id, dragState);
    return;
  }

  const deltaX = Number(payload?.deltaX);
  const deltaY = Number(payload?.deltaY);
  const pointerScreenX = Number(payload?.screenX);
  const pointerScreenY = Number(payload?.screenY);
  const dragAnchorRatio = Number(payload?.dragAnchorRatio);

  if (!Number.isFinite(deltaX) || !Number.isFinite(deltaY)) return;

  if (win.isMaximized()) {
    win.unmaximize();
    win.setSize(DEFAULT_WINDOW_WIDTH, DEFAULT_WINDOW_HEIGHT);
    const restoredBounds = win.getBounds();
    if (Number.isFinite(pointerScreenX) && Number.isFinite(pointerScreenY)) {
      const clampedAnchor = Number.isFinite(dragAnchorRatio)
        ? Math.max(0, Math.min(1, dragAnchorRatio))
        : 0.5;
      const nextX = Math.round(pointerScreenX - (restoredBounds.width * clampedAnchor));
      const nextY = Math.round(pointerScreenY - Math.min(22, Math.max(8, restoredBounds.height * 0.08)));
      if (Number.isFinite(nextX) && Number.isFinite(nextY)) {
        win.setPosition(nextX, nextY);
      }
    }
    return;
  }

  if (win && !win.isDestroyed()) {
    const [x, y] = win.getPosition();
    const nextX = x + deltaX;
    const nextY = y + deltaY;
    if (Number.isFinite(nextX) && Number.isFinite(nextY)) {
      win.setPosition(nextX, nextY);
    }
  }
});

ipcMain.on('end-window-drag', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win || win.isDestroyed()) return;
  windowDragState.delete(win.id);
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
    const sourceWinIdFromMeta = Number(tabMeta?.sourceWinId);
    const sourceWinFromMeta = BrowserWindow.getAllWindows().find(w => w.id === sourceWinIdFromMeta);
    const tabIdFromMeta = Number(tabMeta?.id);

    const logicalTransferToTarget = () => {
      const movedTab = {
        id: Number.isFinite(tabIdFromMeta) ? tabIdFromMeta : Date.now(),
        url: tabMeta?.url,
        title: tabMeta?.title,
        isIncognito: !!tabMeta?.isIncognito
      };
      if (!movedTab.url) return { handled: false };

      targetWin.webContents.send('attach-tab-handled', {
        tab: movedTab,
        viewCreated: false,
        dropTargetTabId: Number.isFinite(Number(tabMeta?.dropTargetTabId)) ? Number(tabMeta.dropTargetTabId) : null
      });

      if (sourceWinFromMeta && !sourceWinFromMeta.isDestroyed() && sourceWinFromMeta.id !== targetWin.id && Number.isFinite(tabIdFromMeta)) {
        closeDragCreatedSourceWindow(sourceWinFromMeta, tabIdFromMeta, 'check-drop-target-logical-from-meta');
        sourceWinFromMeta.webContents.send('remove-tab-record', tabIdFromMeta);
      }

      if (transferId) {
        const pendingEntry = pendingTransfersByTransferId.get(transferId);
        if (pendingEntry?.timeout) clearTimeout(pendingEntry.timeout);
        pendingTransfersByTransferId.delete(transferId);
      }

      BrowserWindow.getAllWindows().forEach(w => {
        if (!w.isDestroyed()) w.webContents.send('tab-drag-ended');
      });
      currentTabDrag = null;
      return { handled: true, targetWindowId: targetWin.id };
    };

    if (!transferId) {
      console.warn('[DND] No transferId in tabMeta; using logical transfer fallback');
      return logicalTransferToTarget();
    }
    
    const pending = pendingTransfersByTransferId.get(transferId);
    if (!pending) {
      console.warn('[DND] No pending transfer for transferId; using logical transfer fallback:', transferId);
      return logicalTransferToTarget();
    }
    
    const { sourceWinId, viewRef, tid, tab } = pending;
    const sourceState = windows.get(sourceWinId);
    const destState = windows.get(targetWin.id);

    if (!destState) {
      console.warn('[DND] Invalid destination state for attachment');
      return { handled: false };
    }

    // Webview-based tabs do not have BrowserView references; transfer logical tab state only.
    if (!viewRef) {
      targetWin.webContents.send('attach-tab-handled', {
        tab: {
          id: tid,
          url: tabMeta.url || tab?.url,
          title: tabMeta.title || tab?.title,
          isIncognito: tabMeta.isIncognito || tab?.isIncognito
        },
        viewCreated: false,
        dropTargetTabId: Number.isFinite(Number(tabMeta?.dropTargetTabId)) ? Number(tabMeta.dropTargetTabId) : null
      });

      if (sourceWinFromMeta && !sourceWinFromMeta.isDestroyed() && sourceWinFromMeta.id !== targetWin.id) {
        const movedId = Number.isFinite(tabIdFromMeta) ? tabIdFromMeta : tid;
        closeDragCreatedSourceWindow(sourceWinFromMeta, movedId, 'check-drop-target-logical-no-viewref');
        sourceWinFromMeta.webContents.send('remove-tab-record', movedId);
      }

      pendingTransfersByTransferId.delete(transferId);
      BrowserWindow.getAllWindows().forEach(w => {
        if (!w.isDestroyed()) w.webContents.send('tab-drag-ended');
      });

      return { handled: true, targetWindowId: targetWin.id };
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
          viewCreated: true,
          dropTargetTabId: Number.isFinite(Number(tabMeta?.dropTargetTabId)) ? Number(tabMeta.dropTargetTabId) : null
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
            closeWindowFast(ownerWin, 'check-drop-owner-empty-or-drag-created');
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
            closeWindowFast(sourceWin, 'check-drop-source-empty-or-drag-created');
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

ipcMain.on('suggestions-overlay:update', (event, payload = {}) => {
  const parentWin = BrowserWindow.fromWebContents(event.sender);
  if (!parentWin || parentWin.isDestroyed()) return;

  const overlay = ensureSuggestionsOverlay(parentWin);
  if (!overlay || overlay.isDestroyed()) return;

  const bounds = payload?.bounds || {};
  const x = Number(bounds.x);
  const y = Number(bounds.y);
  const width = Number(bounds.width);
  const height = Number(bounds.height);

  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    hideSuggestionsOverlayForWindow(parentWin.id);
    return;
  }

  const safeBounds = {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.max(120, Math.round(width)),
    height: Math.max(50, Math.round(height))
  };

  try {
    overlay.setBounds(safeBounds, false);
    overlay.__lastPayload = payload;

    const sendPayload = () => {
      try {
        if (!overlay.isDestroyed()) {
          overlay.webContents.send('overlay-data', overlay.__lastPayload || payload);
        }
      } catch (_error) {}
    };

    if (overlay.webContents.isLoadingMainFrame()) {
      overlay.webContents.once('did-finish-load', sendPayload);
    } else {
      sendPayload();
    }

    if (!overlay.isVisible()) {
      if (typeof overlay.showInactive === 'function') overlay.showInactive();
      else overlay.show();
    }
  } catch (error) {
    console.error('Failed to update suggestions overlay:', error);
  }
});

ipcMain.on('suggestions-overlay:hide', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win || win.isDestroyed()) return;

  if (suggestionsOverlays.has(win.id)) {
    hideSuggestionsOverlayForWindow(win.id);
    return;
  }

  const parent = win.getParentWindow();
  if (parent && !parent.isDestroyed()) {
    hideSuggestionsOverlayForWindow(parent.id);
  }
});

ipcMain.on('suggestions-overlay:select', (event, selectedIndex) => {
  const overlay = BrowserWindow.fromWebContents(event.sender);
  if (!overlay || overlay.isDestroyed()) return;

  const parent = overlay.getParentWindow();
  if (!parent || parent.isDestroyed()) return;

  const numericIndex = Number(selectedIndex);
  const suggestions = Array.isArray(overlay.__lastPayload?.suggestions)
    ? overlay.__lastPayload.suggestions
    : [];
  const suggestion = Number.isFinite(numericIndex) && numericIndex >= 0 && numericIndex < suggestions.length
    ? suggestions[numericIndex]
    : null;

  parent.webContents.send('suggestion-selected', {
    index: numericIndex,
    suggestion
  });
  hideSuggestionsOverlayForWindow(parent.id);
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

ipcMain.on('toggle-adblock', (_event, enabled) => {
  adBlockEnabled = !!enabled;
  storageData.adblockEnabled = adBlockEnabled;
  saveStorageData(storageData);

  BrowserWindow.getAllWindows().forEach(win => {
    try {
      setupAdBlockerForSession(win.webContents.session);
      win.webContents.send('adblock-state-changed', { enabled: adBlockEnabled, mode: adBlockMode });
    } catch (_error) {
      // ignore per-window session setup failures
    }
  });
});

ipcMain.on('set-adblock-mode', (_event, mode) => {
  adBlockMode = mode === 'strict' ? 'strict' : 'balanced';
  storageData.adblockMode = adBlockMode;
  saveStorageData(storageData);

  BrowserWindow.getAllWindows().forEach(win => {
    try {
      setupAdBlockerForSession(win.webContents.session);
      win.webContents.send('adblock-state-changed', { enabled: adBlockEnabled, mode: adBlockMode });
    } catch (_error) {
      // ignore per-window session setup failures
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
  return Object.prototype.hasOwnProperty.call(storageData, key) ? storageData[key] : null;
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
  BrowserWindow.getAllWindows().forEach(win => {
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
    
    // Apply images setting without resetting global onBeforeRequest handlers
    imageBlockingWebContents.set(view.webContents.id, !imagesEnabled);
    setupAdBlockerForSession(view.webContents.session);
    
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
            animation-duration: 0s !important;
            transition-duration: 0s !important;
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
      const animationSpeed = reduced ? '0s' : '0.12s';
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
      partition: 'incognito',
      webSecurity: true,
      allowRunningInsecureContent: false,
      experimentalFeatures: false,
      enableRemoteModule: false,
      sandbox: true,
      safeDialogs: true
    }
  });

  // Remove menu bar
  incognitoWin.setMenuBarVisibility(false);
  setupAdBlockerForSession(incognitoWin.webContents.session);

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

app.whenReady().then(() => {
  console.log('=== AUTO-UPDATER DEBUG INFO ===');
  console.log('App version:', app.getVersion());
  console.log('Repository configured: H0l10W/Vortex-web-browser');
  console.log('Expected API URL: https://api.github.com/repos/H0l10W/Vortex-web-browser/releases/latest');
  console.log('Auto-updater provider:', autoUpdater.getFeedURL());
  console.log('================================');

  initAdBlocker();
  
  // Initialize non-critical components after window creation
  setImmediate(() => {
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

  ipcMain.handle('get-system-metrics', async () => {
    return await getSystemMetricsSnapshot();
  });

  ipcMain.handle('get-performance-config', () => {
    return {
      maxInactiveTabs: MEMORY_CONFIG.maxInactiveTabs,
      memoryThresholdMB: MEMORY_CONFIG.memoryThresholdMB,
      hibernationDelayMs: MEMORY_CONFIG.hibernationDelayMs
    };
  });

  ipcMain.handle('set-performance-config', (event, config = {}) => {
    if (config.memoryThresholdMB !== undefined) {
      MEMORY_CONFIG.memoryThresholdMB = Math.max(256, Math.min(16384, Number(config.memoryThresholdMB) || MEMORY_CONFIG.memoryThresholdMB));
    }

    if (config.maxInactiveTabs !== undefined) {
      MEMORY_CONFIG.maxInactiveTabs = Math.max(1, Math.min(100, Number(config.maxInactiveTabs) || MEMORY_CONFIG.maxInactiveTabs));
    }

    if (config.hibernationDelayMs !== undefined) {
      MEMORY_CONFIG.hibernationDelayMs = Math.max(60000, Math.min(24 * 60 * 60 * 1000, Number(config.hibernationDelayMs) || MEMORY_CONFIG.hibernationDelayMs));
    }

    storageData.memoryConfig = {
      maxInactiveTabs: MEMORY_CONFIG.maxInactiveTabs,
      memoryThresholdMB: MEMORY_CONFIG.memoryThresholdMB,
      hibernationDelayMs: MEMORY_CONFIG.hibernationDelayMs
    };
    saveStorageData(storageData);

    return {
      success: true,
      config: storageData.memoryConfig
    };
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
