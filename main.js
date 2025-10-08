const { app, BrowserWindow, BrowserView, ipcMain, Menu } = require('electron');
const path = require('path');

// Add this to track BrowserViews for each window
const windows = new Map();

// Ad blocker domains list (basic implementation)
const adDomains = [
  'doubleclick.net', 'googleadservices.com', 'googlesyndication.com',
  'facebook.com/tr', 'google-analytics.com', 'googletagmanager.com',
  'amazon-adsystem.com', 'adsystem.amazon.com', 'ads.twitter.com',
  'analytics.twitter.com', 'ads.yahoo.com', 'advertising.com'
];

let adBlockEnabled = false;

// Define the header height (height of tabs + controls)
const headerHeight = 120; // Adjust this value based on your actual UI

function createWindow(initialUrl) {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: false,
      nativeWindowOpen: true
    }
  });

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

  // --- Download Handling ---
  session.on('will-download', (event, item, webContents) => {
    win.webContents.send('download-started', {
      name: item.getFilename(),
      url: item.getURL(),
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
        const bounds = win.getContentBounds();
        view.setBounds({ x: 0, y: headerHeight, width: bounds.width, height: bounds.height - headerHeight });
      }
    }
  });

  win.on('maximize', () => {
    const state = windows.get(win.id);
    if (state && state.activeViewId) {
      const view = state.views.get(state.activeViewId);
      if (view) {
        const bounds = win.getContentBounds();
        view.setBounds({ x: 0, y: headerHeight, width: bounds.width, height: bounds.height - headerHeight });
      }
    }
  });

  win.on('restore', () => {
    const state = windows.get(win.id);
    if (state && state.activeViewId) {
      const view = state.views.get(state.activeViewId);
      if (view) {
        const bounds = win.getContentBounds();
        view.setBounds({ x: 0, y: headerHeight, width: bounds.width, height: bounds.height - headerHeight });
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
  });

  return win;
}

// --- IPC Handlers for BrowserView ---
ipcMain.on('view:create', (event, id) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return;

  const state = windows.get(win.id);
  if (!state || state.views.has(id)) return;

  const view = new BrowserView({
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    }
  });

  state.views.set(id, view);

  view.webContents.on('did-navigate', (e, url) => win.webContents.send('view:navigated', { id, url }));
  view.webContents.on('page-title-updated', (e, title) => win.webContents.send('page-title-updated', { id, title }));
  
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

  const view = state.views.get(id);
  if (view && !view.webContents.isDestroyed()) {
    view.webContents.loadURL(url).catch(err => console.error('Failed to load URL:', url, err));
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
  createSettingsWindow();
});

ipcMain.on('broadcast-theme-change', (event, theme) => {
  BrowserWindow.getAllWindows().forEach(win => {
    if (win.webContents !== event.sender) {
      win.webContents.send('theme-changed', theme);
    }
  });
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
  const settingsWin = new BrowserWindow({
    width: 960,
    height: 720,
    title: 'Settings',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    }
  });

  settingsWin.loadFile('settings.html');
  settingsWin.focus();
}

app.whenReady().then(() => {
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
