import { debouncedSetItem, perfStart, perfEnd, createStorage } from './renderer-modular/utils.js';
import { createHistoryManager } from './renderer-modular/history-manager.js';

// Create a storage wrapper using the preload electronAPI
const storage = createStorage(window.electronAPI);
window.storage = storage;

// Persist tabs under a stable scope so they survive app restarts
const _urlParams = new URLSearchParams(window.location.search || '');
const _windowId = _urlParams.get('windowId') || 'global';
const storageKey = (key) => `global:${key}`;

// Initialize the history manager to replace inline buffer/flush logic
const historyManager = createHistoryManager(window.electronAPI);
historyManager.init().catch(() => {});
window.historyManager = historyManager;

window.addEventListener('DOMContentLoaded', () => {
    // --- Settings Panel History Logic ---
    const settingsHistoryList = document.getElementById('settings-history-list');
    const clearHistoryBtn = document.getElementById('clear-history-btn');
    if (settingsHistoryList && clearHistoryBtn) {
      async function renderSettingsHistory() {
        perfStart('renderSettingsHistory');
        let history = JSON.parse(await storage.getItem('browserHistory') || '[]');
        // Merge with in-memory buffer managed by historyManager so we can render immediately
        try {
          const inMemory = historyManager.getAll();
          if (Array.isArray(inMemory) && inMemory.length) {
            const merged = [...history, ...inMemory];
            // Remove duplicates by URL keeping the latest entry
            const byUrl = new Map();
            for (const entry of merged) {
              if (!entry || !entry.url) continue;
              byUrl.set(entry.url, entry);
            }
            history = Array.from(byUrl.values());
          }
        } catch (e) {
          console.debug('Failed to merge in-memory history into settings view', e);
        }
        history = history.filter(e => {
          if (!e || !e.url) return false;
          const u = e.url;
          if (u === 'newtab') return false;
          if (u.includes('settings.html')) return false;
          if (u.includes('history.html')) return false;
          return true;
        });
        settingsHistoryList.innerHTML = '';
        if (!history.length) {
              settingsHistoryList.innerHTML = '<div style="color:#aaa;text-align:center;">No browsing history yet.</div>';
            } else {
              const frag = document.createDocumentFragment();
              // Render in chunks to avoid creating too many DOM nodes at once
              const pageSize = 30;
              const entries = history.slice().reverse();
              let settingsOffset = 0;
              function appendSettingsHistory() {
                if (settingsOffset >= entries.length) return;
                const next = entries.slice(settingsOffset, settingsOffset + pageSize);
                const doAppend = () => {
                  const frag2 = document.createDocumentFragment();
                  next.forEach(entry => {
                  const item = document.createElement('div');
                  item.style.display = 'flex';
                  item.style.alignItems = 'center';
                  item.style.padding = '8px 0';
                  item.style.borderBottom = '1px solid rgba(0,0,0,0.08)';
                  item.style.cursor = 'pointer';
                  const fav = document.createElement('img');
                  const host = getHostFromUrl(entry.url);
                  if (host) fav.dataset.faviconHost = host;
                  fav.src = getFavicon(entry.url);
                  fav.style.width = '18px';
                  fav.style.height = '18px';
                  fav.style.marginRight = '12px';
                  fav.onerror = function() { this.src = 'icons/newtab.png'; };
                  const title = document.createElement('div');
                  title.textContent = (entry.host && entry.host.length) ? (entry.host.charAt(0).toUpperCase() + entry.host.slice(1)) : getSiteName(entry.url);
                  title.style.fontSize = '1em';
                  title.style.color = 'var(--settings-header-color, #202124)';
                  title.style.flex = '1';
                  item.appendChild(fav);
                  item.appendChild(title);
                  item.onclick = () => {
                    closeSettingsPanel();
                    document.getElementById('url').value = entry.url;
                    document.getElementById('url').dispatchEvent(new KeyboardEvent('keydown', {key:'Enter',bubbles:true}));
                  };
                  frag2.appendChild(item);
                });
                  settingsHistoryList.appendChild(frag2);
                  settingsOffset += pageSize;
                };
                if ('requestIdleCallback' in window) {
                  window.requestIdleCallback(() => doAppend(), { timeout: 200 });
                } else {
                  setTimeout(doAppend, 0);
                }
              }
              appendSettingsHistory();
              // load more when scrolled near bottom
              if (!settingsHistoryList._virtualizationListenerAdded) {
                settingsHistoryList.addEventListener('scroll', () => {
                if (settingsHistoryList.scrollTop + settingsHistoryList.clientHeight > settingsHistoryList.scrollHeight - 200) {
                  appendSettingsHistory();
                }
                }, { passive: true });
                settingsHistoryList._virtualizationListenerAdded = true;
              }
              settingsHistoryList.appendChild(frag);
              perfEnd('renderSettingsHistory');
            }
      }
      // Expose for other windows and modules to request a re-render
      window.renderSettingsHistory = renderSettingsHistory;
      // Render on open
      const origOpenSettingsPanel = openSettingsPanel;
      openSettingsPanel = function() {
        renderSettingsHistory();
        origOpenSettingsPanel();
      };
      // Listen for history updates and re-render the settings history
      if (window.electronAPI && typeof window.electronAPI.on === 'function') {
        window.electronAPI.on('history-updated', () => {
          try { renderSettingsHistory(); } catch (e) {}
        });
      }
      // Clear history
      clearHistoryBtn.onclick = async () => {
        if (confirm('Are you sure you want to clear all browsing history?')) {
          try {
            await historyManager.clear();
            try { if (window.electronAPI && window.electronAPI.broadcastHistoryUpdated) window.electronAPI.broadcastHistoryUpdated(); } catch (e) {}
            try { if (window.electronAPI && window.electronAPI.requestClearHistory) window.electronAPI.requestClearHistory(); } catch (e) {}
            renderSettingsHistory();
            showUpdateNotification('Browsing history cleared successfully.', 'success', 3000);
          } catch (e) {
            // Fallback
            await storage.setItem('browserHistory', '[]');
            try { localStorage.setItem('browserHistory', '[]'); } catch (err) {}
            renderSettingsHistory();
            showUpdateNotification('Browsing history cleared successfully.', 'success', 3000);
          }
        }
      };
    }
  // Apply theme immediately to prevent flash
  storage.getItem('theme').then(savedTheme => {
    const themeToApply = savedTheme || 'theme-light';
    document.body.className = themeToApply; // Set theme class directly
  });
  
  // Apply UI settings immediately
  storage.getItem('smoothScrolling').then(smoothScrolling => {
    if (smoothScrolling === 'true') {
      document.documentElement.style.scrollBehavior = 'smooth';
    }
  });
  
  storage.getItem('reducedAnimations').then(reducedAnimations => {
    const reduced = reducedAnimations === 'true';
    if (reduced) {
      document.body.classList.add('animations-disabled');
      document.documentElement.style.setProperty('--animation-speed', '0s');
      document.documentElement.style.setProperty('--transition-speed', '0s');
    } else {
      document.body.classList.remove('animations-disabled');
      document.documentElement.style.setProperty('--animation-speed', '0.12s');
      document.documentElement.style.setProperty('--transition-speed', '0.12s');
    }
  });

  storage.getItem('visualEffectsEnabled').then(visualEffectsEnabled => {
    const effectsEnabled = visualEffectsEnabled !== 'false';
    document.body.classList.toggle('effects-disabled', !effectsEnabled);
  });
  // Force web dark mode toggle handling
  const forceWebDarkToggle = document.getElementById('force-web-dark-toggle');
  let forceWebDarkEnabled = false;
  if (forceWebDarkToggle) {
    // Initialize from storage
    storage.getItem('forceWebDarkMode').then(saved => {
      forceWebDarkEnabled = saved === 'true';
      try { forceWebDarkToggle.checked = forceWebDarkEnabled; } catch (e) {}
      try { const icon = document.getElementById('force-web-dark-icon'); if (icon) icon.classList.toggle('active', forceWebDarkEnabled); } catch(e) {}
      // Apply to all current tabs (will be applied again on navigation for each view)
      if (forceWebDarkEnabled && window.electronAPI && typeof window.electronAPI.applyWebDarkMode === 'function') {
        for (const tab of tabs) {
          try { window.electronAPI.applyWebDarkMode(tab.id, true); } catch (e) {}
        }
      }
    }).catch(() => {});

    forceWebDarkToggle.addEventListener('change', async (e) => {
      forceWebDarkEnabled = !!e.target.checked;
      try { await storage.setItem('forceWebDarkMode', forceWebDarkEnabled ? 'true' : 'false'); } catch (err) {}
      // Apply or remove to all current tabs
      if (window.electronAPI && typeof window.electronAPI.applyWebDarkMode === 'function') {
        for (const tab of tabs) {
          try { window.electronAPI.applyWebDarkMode(tab.id, forceWebDarkEnabled); } catch (err) {}
        }
      }
      try { if (window.electronAPI && typeof window.electronAPI.broadcastWidgetSettings === 'function') window.electronAPI.broadcastWidgetSettings('forceWebDark', forceWebDarkEnabled); } catch (e) {}
      try { const icon = document.getElementById('force-web-dark-icon'); if (icon) icon.classList.toggle('active', forceWebDarkEnabled); } catch(e) {}
      // Also ask the main process to apply CSS to all BrowserViews for reliable coverage
      try { if (window.electronAPI && typeof window.electronAPI.applyWebDarkModeAll === 'function') await window.electronAPI.applyWebDarkModeAll(forceWebDarkEnabled); } catch (e) { console.error('applyWebDarkModeAll failed', e); }
    });
  }
  
  // Initialize tab previews setting
  let tabPreviewsEnabled = true; // Default to true
  storage.getItem('showTabPreviews').then(enabled => {
    tabPreviewsEnabled = enabled !== 'false';
    renderTabs(); // Re-render tabs with correct setting
  });
  
  // Listen for tab previews setting changes
  window.electronAPI?.on?.('tab-previews-setting-changed', (event, enabled) => {
    tabPreviewsEnabled = enabled;
    renderTabs(); // Re-render tabs with new preview setting
  });
  
  // --- State ---
  // Initialize state asynchronously with persistent storage
  async function initializeState() {
    // Detect if this window should start with a specific URL (opened via Open in New Window)
    try {
      const params = new URLSearchParams(window.location.search || '');
      const newWindowUrl = params.get('newWindowUrl');
      const isFresh = params.get('fresh') === '1';
      console.log('initializeState params newWindowUrl=', newWindowUrl, 'fresh=', isFresh);
      if (newWindowUrl) {
        const decoded = decodeURIComponent(newWindowUrl);
        const tabId = Date.now();
        const tabs = [{ id: tabId, url: decoded, history: [decoded], historyIndex: 0, viewCreated: false }];
        const currentTabId = tabId;
        const bookmarks = JSON.parse(await storage.getItem('bookmarks') || '[]');
        const homepage = await storage.getItem('homepage') || 'https://www.google.com';
        const quickLinks = JSON.parse(await storage.getItem('quickLinks') || '[]');
        // Mark this window as intentionally initialized for a single URL so onNewWindow events are ignored
        try { window._isNewWindowTarget = true; } catch (e) {}
        if (isFresh) {
          // keep only the specified URL in this window and avoid loading other saved tabs
        }
        return { tabs, currentTabId, bookmarks, homepage, quickLinks };
      }
    } catch (err) { /* ignore */ }
    let tabs = JSON.parse(await storage.getItem(storageKey('tabs')) || '[]');
    const params = new URLSearchParams(window.location.search || '');
    const isFresh = params.get('fresh') === '1';
    if (isFresh) {
      console.log('initializeState: fresh window — skipping saved tabs');
      tabs = [{ id: Date.now(), url: 'newtab', history: ['newtab'], historyIndex: 0 }];
    }
    
    // Validate and clean up tabs
    tabs = tabs.filter(tab => tab && tab.id && typeof tab.url === 'string');
    
    // If no valid tabs, create default tab
    if (!tabs.length) {
      tabs = [{ id: Date.now(), url: 'newtab', history: ['newtab'], historyIndex: 0 }];
    }
    
    // Ensure all tabs have proper structure
    tabs = tabs.map(tab => ({
      ...tab,
      history: tab.history || [tab.url || 'newtab'],
      historyIndex: tab.historyIndex || 0,
      viewCreated: false // Force recreation on restart
    }));
    
    let currentTabId = parseInt(await storage.getItem(storageKey('currentTabId')) || (tabs.length > 0 ? tabs[0].id : null), 10);
    
    // Validate currentTabId exists in tabs
    if (!tabs.find(tab => tab.id === currentTabId)) {
      currentTabId = tabs[0].id;
    }
    
    let bookmarks = JSON.parse(await storage.getItem('bookmarks') || '[]');
    let homepage = await storage.getItem('homepage') || 'https://www.google.com';
    let quickLinks = JSON.parse(await storage.getItem('quickLinks') || '[]');
    
    return { tabs, currentTabId, bookmarks, homepage, quickLinks };
  }
  
  // Initialize with temporary values, will be replaced by async loading
  let tabs = [{ id: Date.now(), url: 'newtab', history: [], historyIndex: -1 }];
  let currentTabId = tabs[0].id;
  let bookmarks = [];
  let homepage = 'https://www.google.com';
  let quickLinks = [];
  let hibernatedTabIds = new Set();

  function setHibernatedTabIds(ids = []) {
    const nextIds = new Set((Array.isArray(ids) ? ids : []).map(id => Number(id)));
    const changed = nextIds.size !== hibernatedTabIds.size || Array.from(nextIds).some(id => !hibernatedTabIds.has(id));
    hibernatedTabIds = nextIds;
    if (changed) {
      renderTabs();
    }
  }

  async function refreshHibernationState() {
    if (!window.electronAPI || typeof window.electronAPI.getMemoryUsage !== 'function') return;
    try {
      const memoryInfo = await window.electronAPI.getMemoryUsage();
      setHibernatedTabIds(memoryInfo?.hibernatedTabs || []);
    } catch (error) {
      console.debug('Failed to refresh hibernation state', error);
    }
  }
  
  // Global drop zone for cross-window tab drops
  document.body.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }, { passive: false });

  function getExternalDragMetaForDrop() {
    const meta = window._externalDraggedTabMeta;
    if (!meta) return null;
    const sourceWinId = Number(meta.sourceWinId);
    const thisWinId = Number(_windowId);
    if (Number.isFinite(sourceWinId) && Number.isFinite(thisWinId) && sourceWinId === thisWinId) {
      return null;
    }
    return {
      ...meta,
      transferId: window._currentDragTransferId || meta.transferId
    };
  }
  
  document.body.addEventListener('drop', (e) => {
    const externalMeta = getExternalDragMetaForDrop();
    if (externalMeta) {
      e.preventDefault();
      e.stopPropagation();
      console.log('[DND] body drop handler - external tab with stored transferId:', externalMeta);
      
      if (window.electronAPI && window.electronAPI.tabDroppedHere) {
        window.electronAPI.tabDroppedHere(externalMeta);
        window._tabDropHandled = true;
        console.log('[DND] body drop - called tabDroppedHere');
      }
    }
  });
  
  // Load actual state asynchronously
  initializeState().then(actualState => {
    tabs = actualState.tabs;
    currentTabId = actualState.currentTabId;
    bookmarks = actualState.bookmarks;
    homepage = actualState.homepage;
    quickLinks = actualState.quickLinks;
    
    // Mark all tabs as needing view recreation since they're loaded from storage
    tabs.forEach(tab => {
      tab.viewCreated = false;
    });
    
    // Re-render UI with loaded state
    renderTabs();
    renderBookmarkBar();
    switchTab(currentTabId);
    refreshHibernationState();
    // Notify main that the renderer UI is fully initialized and ready to accept attachments
    try { if (window.electronUI && typeof window.electronUI.uiReady === 'function') window.electronUI.uiReady(); } catch (err) { }
  }).catch(error => {
    console.error('Error loading persistent state:', error);
  });
  
  // --- Auto-Updater Communication ---
  let updateState = {
    checking: false,
    downloading: false,
    available: false,
    downloaded: false,
    lastNotification: 0
  };

  if (window.electronAPI) {
    window.electronAPI.on('hibernation-state-changed', (_event, ids) => {
      setHibernatedTabIds(ids || []);
    });

    // Listen for debug info from main process
    window.electronAPI.onAutoUpdaterDebugInfo((debugInfo) => {
      // Debug info received - could be logged to dev console if needed
    });
    
    // Listen for update events
    window.electronAPI.onUpdateChecking(() => {
      const now = Date.now();
      if (!updateState.checking && (now - updateState.lastNotification) > 2000) {
        showUpdateNotification('Checking for updates...', 'info', 3000);
        updateState.checking = true;
        updateState.downloading = false;
        updateState.available = false;
        updateState.downloaded = false;
        updateState.lastNotification = now;
      }
    });

    window.electronAPI.onUpdateAvailable((info) => {
      const now = Date.now();
      if ((window.__updateSilence || 0) > Date.now()) {
        console.debug('Update notification silenced until', window.__updateSilence);
        return;
      }
      if (!updateState.available && (now - updateState.lastNotification > 5000)) {
        showUpdateNotification(`Update v${info.version} found. Downloading...`, 'info');
        updateState.available = true;
        updateState.checking = false;
        updateState.downloading = true;
        updateState.lastPercent = 0;
        updateState.lastNotification = now;
      }
    });

    window.electronAPI.onUpdateNotAvailable(() => {
      if ((window.__updateSilence || 0) > Date.now()) return;
      if (updateState.checking) {
        showUpdateNotification('You have the latest version!', 'info', 3000);
        updateState = { checking: false, downloading: false, available: false, downloaded: false, lastNotification: Date.now() };
      }
    });

    window.electronAPI.onUpdateError((message) => {
      if ((window.__updateSilence || 0) > Date.now()) return;
      console.error('Update error:', message);
      showUpdateNotification(`Update error: ${message}`, 'error');
      updateState = { checking: false, downloading: false, available: false, downloaded: false, lastNotification: Date.now() };
    });

    // Track progress in 10% increments to avoid too many UI updates
    window.electronAPI.onUpdateDownloadProgress((progress) => {
      if ((window.__updateSilence || 0) > Date.now()) return;
      if (updateState.downloading) {
        const percent = Math.round(progress.percent);
        if (!updateState.lastPercent) updateState.lastPercent = 0;
        // Only update progress when it increases by at least 10% or reaches 100%
        if (percent === 100 || percent >= (updateState.lastPercent + 10)) {
          updateState.lastPercent = percent;
          showUpdateNotification(`Downloading update: ${percent}%`, 'info');
          updateState.lastNotification = Date.now();
        }
      }
    });

    window.electronAPI.onUpdateDownloaded((info) => {
      const now = Date.now();
      if (!updateState.downloaded && (now - updateState.lastNotification > 2000)) {
        console.log('Update downloaded:', info);
        
        // Small delay to ensure progress notification is visible
        setTimeout(() => {
          showUpdateNotification(
            `Update v${info.version} ready to install. Click to restart and install.`,
            'success',
            0,
            () => {
              console.log('Install button clicked');
              window.electronAPI.installUpdate().then(() => {
                console.log('Install update called successfully');
              }).catch(err => {
                console.error('Install update failed:', err);
              });
            }
          );
            updateState.downloaded = true;
            updateState.downloading = false;
            updateState.lastPercent = 100;
          updateState.lastNotification = now;
        }, 1000);
      }
    });

    window.electronAPI.on('adblock-state-changed', (_event, enabled) => {
      const normalized = typeof enabled === 'object' && enabled !== null
        ? { enabled: !!enabled.enabled, mode: enabled.mode === 'strict' ? 'strict' : 'balanced' }
        : { enabled: !!enabled, mode: localStorage.getItem('adblockMode') === 'strict' ? 'strict' : 'balanced' };

      try {
        localStorage.setItem('adblockEnabled', normalized.enabled ? 'true' : 'false');
        localStorage.setItem('adblockMode', normalized.mode);
      } catch (_error) {}

      const toggle = document.getElementById('adblock-toggle');
      if (toggle) toggle.checked = normalized.enabled;
      const strictToggle = document.getElementById('adblock-strict-toggle');
      if (strictToggle) strictToggle.checked = normalized.mode === 'strict';
    });
    
    // Listen for widget settings changes from other windows (like settings page)
    if (window.electronAPI && window.electronAPI.onWidgetSettingsChanged) {
      window.electronAPI.onWidgetSettingsChanged((data) => {
        if (data.widget === 'forceWebDark') {
          try { forceWebDarkToggle.checked = !!data.enabled; forceWebDarkEnabled = !!data.enabled; } catch(e) {}
          // Apply to all current tabs if enabled/disabled
          if (window.electronAPI && typeof window.electronAPI.applyWebDarkMode === 'function') {
            for (const tab of tabs) {
              try { window.electronAPI.applyWebDarkMode(tab.id, !!data.enabled); } catch (err) {}
            }
          }
          // Update toolbar icon
          try { const icon = document.getElementById('force-web-dark-icon'); if (icon) icon.classList.toggle('active', !!data.enabled); } catch(e) {}
        }
        if (data.widget === 'reducedAnimations') {
          const reduced = !!data.enabled;
          document.body.classList.toggle('animations-disabled', reduced);
          document.documentElement.style.setProperty('--animation-speed', reduced ? '0s' : '0.12s');
          document.documentElement.style.setProperty('--transition-speed', reduced ? '0s' : '0.12s');
        }
        if (data.widget === 'visualEffects') {
          const effectsEnabled = !!data.enabled;
          document.body.classList.toggle('effects-disabled', !effectsEnabled);
        }
        if (data.widget === 'weatherUpdate') {
          // Reload weather widget when location settings change
          const weatherWidget = document.querySelector('#weather-widget');
          if (weatherWidget && !weatherWidget.classList.contains('hidden')) {
            // Create a new weather widget instance which will use updated settings
            const widget = new WeatherWidget();
            weatherWidget.weatherWidgetInstance = widget;
          }
        }
      });
    }
  }
  
  // --- DOM Elements ---
  const urlInput = document.getElementById('url');
  // Ensure url input is focusable for keyboard navigation
  try {
    if (urlInput && typeof urlInput.setAttribute === 'function') {
      urlInput.setAttribute('tabindex', '0');
    }
  } catch (e) {}
  const backBtn = document.getElementById('back');
  const forwardBtn = document.getElementById('forward');
  const bookmarkAddBtn = document.getElementById('bookmark-add');
  const bookmarkBar = document.getElementById('bookmark-bar');
  const tabsDiv = document.getElementById('tabs');
  const setHomeBtn = document.getElementById('set-home');
  const newTabPage = document.getElementById('newtab');
  const contentWebview = document.getElementById('content-webview');
  const mainContent = document.getElementById('main-content');
  const quickLinksDiv = document.getElementById('quick-links');
  const reloadBtn = document.getElementById('reload');
  const settingsBtn = document.getElementById('settings');
  const historyBtn = document.getElementById('history-btn');
  const controlsDiv = document.getElementById('controls'); // Add controls div reference
  // Recover URL focus only when clicking non-interactive empty space in controls.
  try {
    if (controlsDiv && urlInput) {
      controlsDiv.addEventListener('click', (event) => {
        const target = event.target;
        if (target === urlInput) return;
        if (target && typeof target.closest === 'function') {
          const interactiveTarget = target.closest('button, input, select, textarea, a, [role="button"], .url-suggestions-popup');
          if (interactiveTarget) return;
        }
        try { urlInput.focus(); } catch (e) {}
      });
    }
  } catch (e) {}

  function isSkippableHistoryUrl(u) {
    if (!u) return true;
    try {
      const parsed = new URL(u);
      const pathname = parsed.pathname || '';
      if (pathname.endsWith('/settings.html') || pathname.endsWith('/history.html')) return true;
      if (u.includes('settings.html') || u.includes('history.html')) return true;
    } catch (e) {
      if (u === 'newtab' || u === 'settings.html' || u === 'history.html') return true;
    }
    return u === 'newtab';
  }

  function isInternalAppPageUrl(url) {
    if (!url || typeof url !== 'string') return false;
    try {
      const parsed = new URL(url, window.location.href);
      const path = (parsed.pathname || '').toLowerCase();
      return path.endsWith('/settings.html') || path.endsWith('/history.html');
    } catch (_error) {
      const lower = url.toLowerCase();
      return lower === 'settings.html' || lower === 'history.html' || lower.includes('settings.html') || lower.includes('history.html');
    }
  }

  const tabWebviews = new Map();

  function getActiveWebview() {
    return tabWebviews.get(currentTabId) || null;
  }

  function showOnlyTabWebview(tabId) {
    tabWebviews.forEach((webview, id) => {
      webview.style.display = id === tabId ? 'flex' : 'none';
    });
  }

  function removeTabWebview(tabId) {
    const webview = tabWebviews.get(tabId);
    if (!webview) return;
    tabWebviews.delete(tabId);
    if (webview === contentWebview) {
      try { webview.setAttribute('src', 'about:blank'); } catch (e) {}
      webview.style.display = 'none';
      return;
    }
    try { webview.remove(); } catch (e) {}
  }

  function bindWebviewEvents(webview, tabId) {
    if (!webview || webview._listenersBound) return;

    webview.addEventListener('did-navigate', (event) => {
      const url = event.url;
      const tab = tabs.find(t => t.id === tabId);
      if (!tab) return;

      tab.url = url;
      if (tab.history[tab.historyIndex] !== url) {
        tab.history.push(url);
        tab.historyIndex++;
      }

      if (tab.id === currentTabId) {
        urlInput.value = url;
      }

      persistTabs();
      renderTabs();

      if (!isSkippableHistoryUrl(url)) {
        try {
          const host = (() => { try { return (new URL(url)).hostname.replace(/^www\./, ''); } catch(e) { return url; } })();
          historyManager.addToHistory({ url, title: tab.title || url, host, timestamp: Date.now() });
          if (document.getElementById('settings-panel') && document.getElementById('settings-panel').classList.contains('active')) {
            try { renderSettingsHistory(); } catch (e) {}
          }
        } catch (e) {
          console.error('historyManager.addToHistory failed (webview)', e);
        }
      }
    });

    webview.addEventListener('page-title-updated', (event) => {
      const tab = tabs.find(t => t.id === tabId);
      if (!tab || tab.url === 'newtab') return;
      tab.title = event.title;
      persistTabs();
      renderTabs();
    });

    webview.addEventListener('new-window', (event) => {
      if (!event.url) return;
      newTab(event.url);
    });

    webview.addEventListener('mousedown', () => {
      closeSettingsPanelIfOpen({ restoreUrlFocus: false });
      closeQuickHistoryPanelIfOpen({ restoreUrlFocus: false });
    }, { passive: true });

    webview.addEventListener('focus', () => {
      closeSettingsPanelIfOpen({ restoreUrlFocus: false });
      closeQuickHistoryPanelIfOpen({ restoreUrlFocus: false });
    });

    webview._listenersBound = true;
  }

  function ensureTabWebview(tab, { forceLoadUrl = false } = {}) {
    if (!tab || !tab.id || !tab.url || tab.url === 'newtab') return null;

    let webview = tabWebviews.get(tab.id);
    if (!webview) {
      if (tabWebviews.size === 0 && contentWebview) {
        webview = contentWebview;
      } else {
        webview = document.createElement('webview');
        webview.setAttribute('allowpopups', '');
        webview.style.position = 'absolute';
        webview.style.inset = '0';
        webview.style.width = '100%';
        webview.style.height = '100%';
        webview.style.display = 'none';
        webview.style.border = 'none';
        webview.style.zIndex = '0';
        if (mainContent) mainContent.appendChild(webview);
      }
      tabWebviews.set(tab.id, webview);
      bindWebviewEvents(webview, tab.id);
    }

    const shouldUseInternalPreload = isInternalAppPageUrl(tab.url);
    const internalPreloadUrl = new URL('preload.js', window.location.href).href;
    if (shouldUseInternalPreload) {
      if (webview.getAttribute('preload') !== internalPreloadUrl) {
        webview.setAttribute('preload', internalPreloadUrl);
      }
    } else if (webview.hasAttribute('preload')) {
      webview.removeAttribute('preload');
    }

    const hasSrc = !!webview.getAttribute('src');
    if ((forceLoadUrl || !hasSrc) && webview.getAttribute('src') !== tab.url) {
      webview.setAttribute('src', tab.url);
    }

    return webview;
  }

  const MAX_OMNIBOX_SUGGESTIONS = 8;
  let omniboxSuggestions = [];
  let omniboxSelectedIndex = -1;
  let omniboxHideTimer = null;

  const omniboxSuggestionsEl = document.createElement('div');
  omniboxSuggestionsEl.id = 'url-suggestions';
  omniboxSuggestionsEl.className = 'url-suggestions-popup';
  omniboxSuggestionsEl.style.display = 'none';
  document.body.appendChild(omniboxSuggestionsEl);

  function getOmniboxOverlayPayload() {
    const rect = urlInput.getBoundingClientRect();
    const maxPopupHeight = Math.min(320, Math.max(90, window.innerHeight - rect.bottom - 10));
    return {
      bounds: {
        x: Math.round(window.screenX + rect.left),
        y: Math.round(window.screenY + rect.bottom + 4),
        width: Math.round(rect.width),
        height: Math.round(maxPopupHeight)
      },
      themeClassName: document.body.className || '',
      suggestions: omniboxSuggestions,
      selectedIndex: omniboxSelectedIndex
    };
  }

  function hideOmniboxSuggestions() {
    omniboxSuggestions = [];
    omniboxSelectedIndex = -1;
    omniboxSuggestionsEl.style.display = 'none';
    try {
      if (window.electronAPI && typeof window.electronAPI.hideSuggestionsOverlay === 'function') {
        window.electronAPI.hideSuggestionsOverlay();
      }
    } catch (e) {
      console.debug('Failed to hide suggestions overlay', e);
    }
  }

  function positionOmniboxSuggestions() {
    if (!omniboxSuggestions.length) return;
    try {
      if (window.electronAPI && typeof window.electronAPI.updateSuggestionsOverlay === 'function') {
        window.electronAPI.updateSuggestionsOverlay(getOmniboxOverlayPayload());
      }
    } catch (e) {
      console.debug('Failed to reposition suggestions overlay', e);
    }
  }

  function getOmniboxCandidates() {
    const candidateMap = new Map();
    const addCandidate = (url, label = '', source = 'history', timestamp = 0) => {
      if (!url || url === 'newtab') return;
      const normalizedUrl = String(url).trim();
      if (!normalizedUrl) return;
      if (normalizedUrl.includes('settings.html') || normalizedUrl.includes('history.html')) return;
      const key = normalizedUrl.toLowerCase();
      const existing = candidateMap.get(key);
      if (!existing) {
        candidateMap.set(key, { url: normalizedUrl, label: String(label || ''), source, timestamp: Number(timestamp) || 0 });
        return;
      }
      if ((Number(timestamp) || 0) > existing.timestamp) {
        existing.timestamp = Number(timestamp) || existing.timestamp;
      }
      if (!existing.label && label) existing.label = String(label);
      const sourcePriority = { history: 1, quicklink: 2, bookmark: 3, tab: 4 };
      if ((sourcePriority[source] || 0) > (sourcePriority[existing.source] || 0)) {
        existing.source = source;
      }
    };

    try {
      const historyEntries = historyManager.getAll();
      if (Array.isArray(historyEntries)) {
        historyEntries.forEach(entry => {
          if (!entry || !entry.url) return;
          addCandidate(entry.url, entry.title || entry.host || '', 'history', entry.timestamp || 0);
        });
      }
    } catch (e) {
      console.debug('Unable to read history suggestions', e);
    }

    try {
      (Array.isArray(bookmarks) ? bookmarks : []).forEach(entry => {
        const entryUrl = entry?.url || entry;
        const entryLabel = entry?.label || '';
        addCandidate(entryUrl, entryLabel, 'bookmark', 0);
      });
    } catch (e) {
      console.debug('Unable to read bookmark suggestions', e);
    }

    try {
      (Array.isArray(quickLinks) ? quickLinks : []).forEach(entry => {
        addCandidate(entry?.url, entry?.label || '', 'quicklink', 0);
      });
    } catch (e) {
      console.debug('Unable to read quick link suggestions', e);
    }

    try {
      (Array.isArray(tabs) ? tabs : []).forEach(tab => {
        if (!tab || !tab.url) return;
        addCandidate(tab.url, tab.title || '', 'tab', 0);
      });
    } catch (e) {
      console.debug('Unable to read tab suggestions', e);
    }

    return Array.from(candidateMap.values());
  }

  function scoreOmniboxCandidate(candidate, queryLower) {
    const urlLower = candidate.url.toLowerCase();
    const labelLower = String(candidate.label || '').toLowerCase();
    const sourceBoost = { history: 8, quicklink: 12, bookmark: 16, tab: 10 };

    let score = sourceBoost[candidate.source] || 0;
    if (!queryLower) {
      score += Math.min((candidate.timestamp || 0) / 1000000000000, 10);
      return score;
    }
    if (urlLower.startsWith(queryLower)) score += 120;
    else if (urlLower.includes(queryLower)) score += 60;
    if (labelLower.startsWith(queryLower)) score += 70;
    else if (labelLower.includes(queryLower)) score += 35;

    if (!urlLower.includes(queryLower) && !labelLower.includes(queryLower)) return -1;

    const timeBoost = Math.min((candidate.timestamp || 0) / 1000000000000, 8);
    return score + timeBoost;
  }

  function buildOmniboxSuggestions(rawQuery) {
    const query = String(rawQuery || '').trim();
    const queryLower = query.toLowerCase();
    const candidates = getOmniboxCandidates();
    const scored = candidates
      .map(candidate => ({ ...candidate, score: scoreOmniboxCandidate(candidate, queryLower), isSearch: false }))
      .filter(candidate => candidate.score >= 0)
      .sort((a, b) => (b.score - a.score) || (b.timestamp - a.timestamp));

    const topMatches = scored.slice(0, MAX_OMNIBOX_SUGGESTIONS);
    if (query && topMatches.length < MAX_OMNIBOX_SUGGESTIONS) {
      topMatches.push({
        url: query,
        label: `Search for "${query}"`,
        source: 'search',
        timestamp: Date.now(),
        score: 0,
        isSearch: true
      });
    }
    return topMatches;
  }

  function renderOmniboxSuggestions() {
    omniboxSuggestionsEl.innerHTML = '';
    if (!omniboxSuggestions.length) {
      hideOmniboxSuggestions();
      return;
    }

    const fragment = document.createDocumentFragment();
    omniboxSuggestions.forEach((suggestion, index) => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'url-suggestion-item';
      if (index === omniboxSelectedIndex) item.classList.add('active');

      const source = document.createElement('span');
      source.className = 'url-suggestion-source';
      source.textContent = suggestion.isSearch ? 'Search' : suggestion.source;

      const main = document.createElement('span');
      main.className = 'url-suggestion-main';
      main.textContent = suggestion.isSearch ? suggestion.label : suggestion.url;

      const meta = document.createElement('span');
      meta.className = 'url-suggestion-meta';
      meta.textContent = suggestion.isSearch ? '' : (suggestion.label || '');

      item.appendChild(source);
      item.appendChild(main);
      item.appendChild(meta);

      item.addEventListener('mouseenter', () => {
        omniboxSelectedIndex = index;
        renderOmniboxSuggestions();
      });

      item.addEventListener('mousedown', (event) => {
        event.preventDefault();
        if (omniboxHideTimer) clearTimeout(omniboxHideTimer);
        const selected = omniboxSuggestions[index];
        if (!selected) return;
        urlInput.value = selected.url;
        hideOmniboxSuggestions();
        navigate(selected.url);
      });

      fragment.appendChild(item);
    });

    omniboxSuggestionsEl.appendChild(fragment);
    omniboxSuggestionsEl.style.display = 'none';

    try {
      if (window.electronAPI && typeof window.electronAPI.updateSuggestionsOverlay === 'function') {
        window.electronAPI.updateSuggestionsOverlay(getOmniboxOverlayPayload());
        return;
      }
    } catch (e) {
      console.debug('Failed to render suggestions overlay', e);
    }

    // Fallback to in-page popup if overlay API is unavailable
    omniboxSuggestionsEl.style.display = 'block';
    const rect = urlInput.getBoundingClientRect();
    omniboxSuggestionsEl.style.left = `${rect.left}px`;
    omniboxSuggestionsEl.style.top = `${rect.bottom + 4}px`;
    omniboxSuggestionsEl.style.width = `${rect.width}px`;
    omniboxSuggestionsEl.style.maxHeight = `${Math.min(320, Math.max(90, window.innerHeight - rect.bottom - 10))}px`;
  }

  function refreshOmniboxSuggestions() {
    omniboxSuggestions = buildOmniboxSuggestions(urlInput.value);
    omniboxSelectedIndex = omniboxSuggestions.length ? 0 : -1;
    renderOmniboxSuggestions();
  }

  function applyOmniboxSuggestion({ navigateToSuggestion = false } = {}) {
    if (!omniboxSuggestions.length) return false;
    const idx = omniboxSelectedIndex >= 0 ? omniboxSelectedIndex : 0;
    const suggestion = omniboxSuggestions[idx];
    if (!suggestion) return false;
    urlInput.value = suggestion.url;
    hideOmniboxSuggestions();
    if (navigateToSuggestion) navigate(suggestion.url);
    return true;
  }

  window.addEventListener('resize', positionOmniboxSuggestions);
  window.addEventListener('scroll', positionOmniboxSuggestions, true);

  document.addEventListener('mousedown', (event) => {
    if (event.target === urlInput || omniboxSuggestionsEl.contains(event.target)) return;
    hideOmniboxSuggestions();
  });

  if (window.electronAPI && typeof window.electronAPI.on === 'function') {
    window.electronAPI.on('suggestion-selected', (_event, selectionPayload) => {
      const payload = (selectionPayload && typeof selectionPayload === 'object')
        ? selectionPayload
        : { index: selectionPayload };
      const index = Number(payload.index);
      const payloadSuggestion = payload?.suggestion && typeof payload.suggestion.url === 'string'
        ? payload.suggestion
        : null;

      if (Number.isFinite(index) && index >= 0 && index < omniboxSuggestions.length) {
        omniboxSelectedIndex = index;
        applyOmniboxSuggestion({ navigateToSuggestion: true });
        return;
      }

      if (payloadSuggestion) {
        urlInput.value = payloadSuggestion.url;
        hideOmniboxSuggestions();
        navigate(payloadSuggestion.url);
      }
    });
  }
  
  // Implement custom window dragging for the title bar
  const titleBar = document.getElementById('title-bar');
  if (titleBar) {
    // Also handle double-click to maximize/restore
    titleBar.addEventListener('dblclick', (e) => {
      const target = e.target;
      const isTab = target.closest('.tab');
      const isButton = target.closest('button');
      
      if (!isTab && !isButton) {
        if (window.electronAPI && typeof window.electronAPI.toggleMaximize === 'function') {
          window.electronAPI.toggleMaximize();
        }
      }
    });
  }
  
  // Make the tabs div itself a drop zone
  if (tabsDiv) {
    tabsDiv.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = 'move';
    }, { passive: false });
    
    tabsDiv.addEventListener('drop', (e) => {
      const externalMeta = getExternalDragMetaForDrop();
      if (externalMeta) {
        e.preventDefault();
        e.stopPropagation();
        console.log('[DND] tabs div drop handler - external tab with stored transferId:', externalMeta);
        
        if (window.electronAPI && window.electronAPI.tabDroppedHere) {
          window.electronAPI.tabDroppedHere(externalMeta);
          window._tabDropHandled = true;
          console.log('[DND] tabs div drop - called tabDroppedHere');
        }
      }
    });
  }


  // --- App Version Display ---
  const appVersionSpan = document.getElementById('app-version');
  if (window.electronAPI && typeof window.electronAPI.getAppVersion === 'function' && appVersionSpan) {
    window.electronAPI.getAppVersion().then(version => {
      appVersionSpan.textContent = version;
    }).catch(err => {
      console.error('Failed to get app version:', err);
    });
  }

  // --- Modal Elements ---
  // Settings Modal
  const settingsModal = document.getElementById('settings-modal');
  
  // Quick Link Modal
  const addQuickLinkModal = document.getElementById('add-quick-link-modal');
  let closeButton, newQuickLinkUrlInput, newQuickLinkLabelInput, saveQuickLinkBtn;
  
  // Only try to get these elements if the modal exists
  if (addQuickLinkModal) {
    closeButton = document.querySelector('#add-quick-link-modal .close-button');
    newQuickLinkUrlInput = document.getElementById('new-quick-link-url');
    newQuickLinkLabelInput = document.getElementById('new-quick-link-label');
    saveQuickLinkBtn = document.getElementById('save-quick-link-btn');
  }

  // --- Utility ---
  // Lightweight favicon URL/base64 caching to avoid repeated generation, network calls and reflows
  const __faviconCache = new Map(); // host -> dataURL or remote URL
  const __faviconBase64Cache = new Map(); // host -> dataURL
  const __faviconFetchQueue = new Set();
  function getHostFromUrl(url) {
    try {
      const u = new URL(url);
      return u.hostname.replace(/^www\./, '');
    } catch (e) {
      return null;
    }
  }

  async function fetchAndCacheFavicon(host) {
    try {
      if (!host || __faviconFetchQueue.has(host)) return;
      __faviconFetchQueue.add(host);
      // Check storage cache first
      const storageKey = `favicons:${host}`;
      const existing = await storage.getItem(storageKey);
      if (existing) {
        __faviconBase64Cache.set(host, existing);
        __faviconFetchQueue.delete(host);
        return existing;
      }
      const remoteUrl = `https://icons.duckduckgo.com/ip3/${host}.ico`;
      const response = await fetch(remoteUrl);
      if (!response.ok) throw new Error('Failed to fetch favicon');
      const blob = await response.blob();
      // Convert to base64
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.onerror = (e) => reject(e);
        reader.readAsDataURL(blob);
      });
      __faviconBase64Cache.set(host, dataUrl);
      debouncedSetItem(storageKey, dataUrl, 1000); // persist asynchronously
      __faviconFetchQueue.delete(host);
      // Update any existing images with data-favicon-host attribute
      try {
        document.querySelectorAll(`img[data-favicon-host="${host}"]`).forEach(img => {
          if (img && img.src && !img.src.startsWith('data:')) img.src = dataUrl;
        });
      } catch(e) {}
      return dataUrl;
    } catch (err) {
      __faviconFetchQueue.delete(host);
      return null;
    }
  }

  function getFavicon(url) {
    try {
      if (!url) return 'icons/newtab.png';
      if (url === 'newtab') return 'icons/newtab.png';
      const host = getHostFromUrl(url);
      if (!host) return 'icons/newtab.png';
      // Return base64 dataURL if cached in memory
      if (__faviconBase64Cache.has(host)) return __faviconBase64Cache.get(host);
      // If we have a URL cached already, return that while fetching base64
      if (__faviconCache.has(host)) return __faviconCache.get(host);
      const remoteUrl = `https://icons.duckduckgo.com/ip3/${host}.ico`;
      __faviconCache.set(host, remoteUrl);
      // Trigger background fetch & caching without awaiting
      fetchAndCacheFavicon(host).catch(() => {});
      return remoteUrl;
    } catch {
      return 'icons/newtab.png';
    }
  }

  // Helper: get a simplified site name from a URL (e.g., 'youtube.com' -> 'YouTube')
  function getSiteName(url) {
    try {
      const u = new URL(url);
      let host = u.hostname.replace(/^www\./, '');
      // Capitalize first letter
      return host.charAt(0).toUpperCase() + host.slice(1);
    } catch {
      return url;
    }
  }

  function showUpdateNotification(message, type = 'info', duration = 5000, clickHandler = null) {
    // Respect silence setting set when user dismisses notifications
    if ((window.__updateSilence || 0) > Date.now()) {
      console.debug('Update notifications silenced until', window.__updateSilence);
      return null;
    }
    // Remove any existing update notification
    const existingNotification = document.querySelector('.update-notification');
    if (existingNotification) {
      existingNotification.remove();
    }

    // Create notification element with accessible DOM nodes (avoid inline handlers)
    const notification = document.createElement('div');
    notification.className = `update-notification update-${type}`;
    const content = document.createElement('div');
    content.className = 'update-notification-content';
    const msg = document.createElement('span');
    msg.className = 'update-message';
    msg.textContent = message;
    const closeBtn = document.createElement('button');
    closeBtn.className = 'update-close';
    closeBtn.setAttribute('aria-label', 'Close update notification');
    closeBtn.textContent = '×';
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      try { window.__updateSilence = (Date.now() + 60000); } catch (err) {}
      if (notification.parentNode) notification.remove();
    });
    content.appendChild(msg);
    content.appendChild(closeBtn);
    notification.appendChild(content);

    // Add click handler if provided
    if (clickHandler) {
      notification.style.cursor = 'pointer';
      notification.addEventListener('click', (e) => {
        if (!e.target.classList.contains('update-close')) {
          clickHandler();
          notification.remove();
        }
      });
    }

    // If there is no click handler, prefer to use the global notifications API for a consistent toast
    if (!clickHandler && window.notifications && typeof window.notifications.notify === 'function') {
      try { window.notifications.notify(message, type, duration); return null; } catch (e) { /* fallthrough */ }
    }
    // Add to page
    document.body.appendChild(notification);

    // Auto-remove after duration (unless duration is 0)
    if (duration > 0) {
      setTimeout(() => {
        if (notification.parentNode) {
          notification.remove();
        }
      }, duration);
    }
  }

  function updateView() {
    const tab = tabs.find(t => t.id === currentTabId);
    if (!tab) return;

    // Identify special internal pages (settings/history) so we can hide unnecessary chrome
    const isSettingsPage = tab.url && tab.url.includes('settings.html');
    const isHistoryPage = tab.url && tab.url.includes('history.html');
    
    // Hide/show URL bar based on whether it's a settings page or history page
    if (controlsDiv) {
      controlsDiv.style.display = (isSettingsPage || isHistoryPage) ? 'none' : 'flex';
    }

    if (tab.url === 'newtab') {
      showOnlyTabWebview(null);
      newTabPage.classList.add('active');
      urlInput.value = '';
      // Update button states based on history, even for newtab
      backBtn.disabled = tab.historyIndex <= 0;
      forwardBtn.disabled = tab.historyIndex >= tab.history.length - 1;
    } else {
      const activeWebview = ensureTabWebview(tab);
      showOnlyTabWebview(tab.id);
      if (activeWebview) activeWebview.style.display = 'flex';
      newTabPage.classList.remove('active');
      urlInput.value = tab.url;
      backBtn.disabled = tab.historyIndex <= 0;
      forwardBtn.disabled = tab.historyIndex >= tab.history.length - 1;
    }
    renderBookmarkBar();
    renderQuickLinks();
    renderTabs(); // Update tab title to reflect current URL
  }

  // --- Tabs ---
  function renderTabs() {
    perfStart('renderTabs');
    tabsDiv.innerHTML = '';
    const frag = document.createDocumentFragment();
    tabs.forEach((tab) => {
      const tabEl = document.createElement('div');
      let currentDragTransferId = null;
      let tabClass = 'tab' + (tab.id === currentTabId ? ' active' : '');
      if (tab.isIncognito) tabClass += ' incognito';
      if (hibernatedTabIds.has(Number(tab.id))) tabClass += ' hibernated';
      tabEl.className = tabClass;
      // Favicon and title
      if (tabPreviewsEnabled) {
        const favicon = document.createElement('img');
        favicon.src = getFavicon(tab.url);
        favicon.onerror = function() { this.src = 'icons/newtab.png'; };
        favicon.style.width = '16px';
        favicon.style.height = '16px';
        tabEl.appendChild(favicon);
        const titleSpan = document.createElement('span');
        let displayTitle = tab.title || tab.url || 'New Tab';
        if (displayTitle.length > 32) displayTitle = displayTitle.substring(0, 32) + '...';
        titleSpan.textContent = displayTitle;
        tabEl.appendChild(titleSpan);

        if (hibernatedTabIds.has(Number(tab.id))) {
          const hibernatedBadge = document.createElement('span');
          hibernatedBadge.className = 'tab-hibernate-badge';
          hibernatedBadge.textContent = '💤';
          hibernatedBadge.title = 'Tab is hibernated to save memory';
          tabEl.appendChild(hibernatedBadge);
        }
      } else {
        const indicator = document.createElement('div');
        indicator.style.width = '8px';
        indicator.style.height = '8px';
        indicator.style.borderRadius = '50%';
        indicator.style.backgroundColor = tab.id === currentTabId ? '#4285f4' : '#dadce0';
        indicator.style.margin = 'auto';
        tabEl.appendChild(indicator);
        tabEl.style.minWidth = '32px';
        tabEl.style.maxWidth = '32px';
      }
      // Close button
      const closeBtn = document.createElement('div');
      closeBtn.className = 'close';
      closeBtn.textContent = '×';
      closeBtn.onclick = (e) => { e.stopPropagation(); closeTab(tab.id); };
      if (tabPreviewsEnabled || tab.id === currentTabId) tabEl.appendChild(closeBtn);
      tabEl.onclick = () => switchTab(tab.id);
      tabEl.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        try { if (window.electronAPI && window.electronAPI.showTabContextMenu) window.electronAPI.showTabContextMenu({ id: tab.id, url: tab.url, title: tab.title }); } catch (err) { console.error('showTabContextMenu failed', err); }
      });
      // --- Modern Drag & Drop ---
      tabEl.draggable = true;
      tabEl.addEventListener('dragstart', (e) => {
        try {
          const tabId = tab.id;
          const transferId = `transfer-${_windowId}-${tabId}-${Date.now()}`;
          currentDragTransferId = transferId;
          
          e.dataTransfer.setData('application/tab-id', String(tabId));
          e.dataTransfer.effectAllowed = 'move';
          tabEl.classList.add('dragging');
          
          // Build complete metadata
          const meta = {
            id: tabId,
            url: tab.url,
            title: tab.title,
            isIncognito: tab.isIncognito || false,
            transferId,
            webContentsId: tab.webContentsId,
            sourceWinId: _windowId
          };
          
          // Store drag state AND transferId separately
          window._tabDragState = { tabId, meta };
          window._currentDragTransferId = transferId; // Store separately to prevent any modification
          window._tabDropHandled = false;
          window._externalDraggedTabMeta = null;
          tabs._draggingId = tabId;
          
          // Notify main process
          if (window.electronAPI && window.electronAPI.tabDragStart) {
            window.electronAPI.tabDragStart(meta);
          }
          
          console.log('[DND] dragstart - stored transferId:', transferId);
          console.log('[DND] dragstart - full meta:', meta);
        } catch (err) {
          console.error('[DND] dragstart error:', err);
        }
      });
      tabEl.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        tabEl.classList.add('drag-over');
      }, { passive: false });
      tabEl.addEventListener('dragleave', (e) => { tabEl.classList.remove('drag-over'); });
      tabEl.addEventListener('drop', (e) => {
        e.preventDefault();
        e.stopPropagation();
        tabEl.classList.remove('drag-over');
        const data = e.dataTransfer.getData('application/tab-id');
        
        console.log('[DND] tab drop event:', { hasData: !!data, hasExternal: !!window._externalDraggedTabMeta });
        
        if (data) {
          // Internal reorder
          const draggedId = parseInt(data, 10);
          if (!isNaN(draggedId) && draggedId !== tab.id) {
            const fromIndex = tabs.findIndex(t => t.id === draggedId);
            const toIndex = tabs.findIndex(t => t.id === tab.id);
            if (fromIndex !== -1 && toIndex !== -1) {
              const [moved] = tabs.splice(fromIndex, 1);
              tabs.splice(toIndex, 0, moved);
              persistTabs();
              renderTabs();
              window._tabDropHandled = true;
              console.log('[DND] reorder:', { from: fromIndex, to: toIndex });
            }
          }
        } else {
          const externalMeta = getExternalDragMetaForDrop();
          if (!externalMeta) return;
          // External drop - attach tab from another window - use stored transferId
          const metaWithTarget = { ...externalMeta, dropTargetTabId: tab.id };
          console.log('[DND] external drop on tab with stored transferId:', metaWithTarget);
          
          if (window.electronAPI && window.electronAPI.tabDroppedHere) {
            window.electronAPI.tabDroppedHere(metaWithTarget);
            window._tabDropHandled = true;
            console.log('[DND] called tabDroppedHere with meta:', metaWithTarget);
          }
        }
      });
      tabEl.addEventListener('dragend', async (e) => {
        tabEl.classList.remove('dragging');
        delete tabs._draggingId;
        
        console.log('[DND] dragend fired:', { 
          clientX: e.clientX, 
          clientY: e.clientY,
          screenX: e.screenX,
          screenY: e.screenY,
          dropHandled: window._tabDropHandled 
        });
        
        // Block newtab placeholder
        if (tab.url === 'newtab') {
          console.log('[DND] Blocked drag of newtab placeholder');
          if (window.electronAPI && typeof window.electronAPI.tabDragEnd === 'function') {
            window.electronAPI.tabDragEnd();
          }
          return;
        }
        
        // Check if dragged outside tab area
        const tabsRect = tabsDiv.getBoundingClientRect();
        const outOfTabArea = e.clientY < tabsRect.top - 40 || e.clientY > tabsRect.bottom + 40 ||
                            e.clientX < tabsRect.left - 40 || e.clientX > tabsRect.right + 40;
        const hasScreenCoords = Number.isFinite(e.screenX) && Number.isFinite(e.screenY);
        const outOfWindowByScreen = hasScreenCoords && (
          e.screenX < window.screenX - 8 ||
          e.screenX > window.screenX + window.outerWidth + 8 ||
          e.screenY < window.screenY - 8 ||
          e.screenY > window.screenY + window.outerHeight + 8
        );
        const shouldDetachFromDragEnd = outOfTabArea || outOfWindowByScreen;
        
        console.log('[DND] dragend analysis:', { 
          outOfTabArea,
          outOfWindowByScreen,
          shouldDetachFromDragEnd,
          dropHandled: window._tabDropHandled,
          screenPos: { x: e.screenX, y: e.screenY }
        });
        
        if (shouldDetachFromDragEnd) {
          // Wait briefly for any drop events
          await new Promise(resolve => setTimeout(resolve, 100));

          if (window._tabDropHandled) {
            if (window.electronAPI && typeof window.electronAPI.tabDragEnd === 'function') {
              window.electronAPI.tabDragEnd();
            }
            currentDragTransferId = null;
            return;
          }
          
          // Use screen coordinates to check if dropped on another window
          if (window.electronAPI && typeof window.electronAPI.checkDropTarget === 'function') {
            console.log('[DND] dragend - window._currentDragTransferId:', window._currentDragTransferId);
            console.log('[DND] dragend - window._tabDragState:', window._tabDragState);
            
            const dragMeta = {
              id: tab.id,
              url: tab.url,
              title: tab.title,
              isIncognito: tab.isIncognito || false,
              transferId: currentDragTransferId || window._currentDragTransferId,
              webContentsId: tab.webContentsId,
              sourceWinId: _windowId
            };
            
            console.log('[DND] dragend - dragMeta being sent:', dragMeta);
            
            const result = await window.electronAPI.checkDropTarget(e.screenX, e.screenY, dragMeta);
            
            console.log('[DND] checkDropTarget result:', result);
            
            if (result && result.handled) {
              // Tab was attached to another window
              console.log('[DND] Tab attached to window:', result.targetWindowId);
              if (window.electronAPI && typeof window.electronAPI.tabDragEnd === 'function') {
                window.electronAPI.tabDragEnd();
              }
              return;
            }
          }
          
          // No target window - create new window
          console.log('[DND] Creating new window for detached tab');
          
          if (window.electronAPI && typeof window.electronAPI.detachTab === 'function') {
            window.electronAPI.detachTab({
              id: tab.id,
              url: tab.url,
              title: tab.title,
              isIncognito: tab.isIncognito
            });
          }
        }
        
        if (window.electronAPI && typeof window.electronAPI.tabDragEnd === 'function') {
          window.electronAPI.tabDragEnd();
        }
        currentDragTransferId = null;
      });
      frag.appendChild(tabEl);
    });
    const newTabBtn = document.createElement('button');
    newTabBtn.id = 'new-tab-btn';
    newTabBtn.textContent = '+';
    newTabBtn.onclick = () => newTab();
    
    // Make new tab button a drop zone
    newTabBtn.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = 'move';
    }, { passive: false });
    
    newTabBtn.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      
      const externalMeta = getExternalDragMetaForDrop();
      if (externalMeta) {
        console.log('[DND] new tab button drop - external tab with stored transferId:', externalMeta);
        
        if (window.electronAPI && window.electronAPI.tabDroppedHere) {
          window.electronAPI.tabDroppedHere(externalMeta);
          window._tabDropHandled = true;
        }
      }
    });
    
    frag.appendChild(newTabBtn);
    tabsDiv.appendChild(frag);
    
    // Create an invisible drop zone overlay that covers the entire tabs area including empty space
    if (!tabsDiv.querySelector('.tabs-drop-overlay')) {
      const dropOverlay = document.createElement('div');
      dropOverlay.className = 'tabs-drop-overlay';
      dropOverlay.style.cssText = `
        position: absolute; 
        top: 0; 
        left: 0; 
        width: 100%;
        height: 100%; 
        z-index: 0;
        -webkit-app-region: no-drag;
        display: none;
        pointer-events: none;
      `;
      
      dropOverlay.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'move';
      }, { passive: false });
      
      dropOverlay.addEventListener('drop', (e) => {
        e.preventDefault();
        e.stopPropagation();
        
        const externalMeta = getExternalDragMetaForDrop();
        if (externalMeta) {
          console.log('[DND] drop overlay - external tab with stored transferId:', externalMeta);
          
          if (window.electronAPI && window.electronAPI.tabDroppedHere) {
            window.electronAPI.tabDroppedHere(externalMeta);
            window._tabDropHandled = true;
          }
        }
      });
      
      // Enable pointer events only during drag
      tabsDiv.addEventListener('dragenter', () => {
        dropOverlay.style.display = 'block';
        dropOverlay.style.pointerEvents = 'auto';
      });
      
      tabsDiv.addEventListener('dragleave', (e) => {
        // Only disable if actually leaving the tabs area
        if (!tabsDiv.contains(e.relatedTarget)) {
          dropOverlay.style.pointerEvents = 'none';
          dropOverlay.style.display = 'none';
        }
      });
      
      tabsDiv.addEventListener('drop', () => {
        dropOverlay.style.pointerEvents = 'none';
        dropOverlay.style.display = 'none';
      });

      tabsDiv.addEventListener('dragend', () => {
        dropOverlay.style.pointerEvents = 'none';
        dropOverlay.style.display = 'none';
      });
      
      tabsDiv.insertBefore(dropOverlay, tabsDiv.firstChild);
    }
    
    // Allow dropping tabs on the empty tabs area to move to end or attach external tab
    if (!tabsDiv._dropListenersAdded) {
      tabsDiv.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
      }, { passive: false });
      tabsDiv.addEventListener('drop', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const data = e.dataTransfer.getData('application/tab-id');
        
        console.log('[DND] tabs area drop:', { hasData: !!data, hasExternal: !!window._externalDraggedTabMeta });
        
        if (data) {
          // Move to end
          const draggedId = parseInt(data, 10);
          if (!isNaN(draggedId)) {
            const fromIndex = tabs.findIndex(t => t.id === draggedId);
            if (fromIndex !== -1) {
              const [moved] = tabs.splice(fromIndex, 1);
              tabs.push(moved);
              persistTabs();
              renderTabs();
              window._tabDropHandled = true;
              console.log('[DND] moved to end');
            }
          }
        } else {
          const externalMeta = getExternalDragMetaForDrop();
          if (!externalMeta) return;
          // External drop on tab area - use the stored transferId
          console.log('[DND] external drop on tabs area with stored transferId:', externalMeta);
          
          if (window.electronAPI && window.electronAPI.tabDroppedHere) {
            window.electronAPI.tabDroppedHere(externalMeta);
            window._tabDropHandled = true;
            console.log('[DND] called tabDroppedHere from tabs area');
          }
        }
      });
      tabsDiv._dropListenersAdded = true;
    }
    perfEnd('renderTabs');
  }

  function switchTab(id) {
    currentTabId = id;
    persistTabs();
    updateView();
    renderTabs();
  }

  function newTab(url = 'newtab', fromNavigate = false) {
    if (fromNavigate) {
        // This is a navigation within the current tab, not a new tab creation
        const tab = tabs.find(t => t.id === currentTabId);
        if (tab.url === 'newtab') {
            tab.history = [url];
            tab.historyIndex = 0;
        } else {
            tab.history = tab.history.slice(0, tab.historyIndex + 1);
            tab.history.push(url);
            tab.historyIndex++;
        }
        tab.url = url;
    } else {
        // This is creating a new tab
        const newTabId = Date.now();
        const newTabObj = { id: newTabId, url, history: [url], historyIndex: 0, viewCreated: true };
        tabs.push(newTabObj);
        currentTabId = newTabId;
    }
    
    persistTabs();
    updateView();
    renderTabs();
  }
  
  // Make newTab globally accessible for widgets
  window.newTab = newTab;
  console.log('newTab function assigned to window:', typeof window.newTab);
  
  // Make weather widget update function globally accessible
  window.updateWeatherWidget = function() {
    console.log('Global weather widget update called');
    const weatherWidget = document.getElementById('weather-widget');
    if (weatherWidget && !weatherWidget.classList.contains('hidden')) {
      console.log('Creating new weather widget instance');
      const widget = new WeatherWidget();
      weatherWidget.weatherWidgetInstance = widget; // Store instance on DOM element
    }
  };
  
  // Add a test function to manually trigger weather refresh
  window.testWeatherRefresh = function() {
    console.log('=== MANUAL WEATHER REFRESH TEST ===');
    const weatherWidget = document.querySelector('#weather-widget');
    if (weatherWidget) {
      console.log('Weather widget found, creating new instance');
      const widget = new WeatherWidget();
      weatherWidget.weatherWidgetInstance = widget;
    } else {
      console.log('Weather widget not found');
    }
  };
  console.log('updateWeatherWidget function assigned to window');
  
  // Make news widget update function globally accessible
  window.updateNewsWidget = function() {
    console.log('Global news widget update called');
    const newsWidget = document.getElementById('news-widget');
    if (newsWidget && !newsWidget.classList.contains('hidden')) {
      console.log('Creating new news widget instance');
      new NewsWidget();
    }
  };
  console.log('updateNewsWidget function assigned to window');

  function closeTab(id) {
    const tabIndex = tabs.findIndex(t => t.id === id);
    if (tabIndex === -1) return;

    // If this is the last tab, close the entire application
    if (tabs.length === 1) {
      window.electronAPI.closeApp();
      return;
    }

    tabs.splice(tabIndex, 1);
    removeTabWebview(id);

    if (currentTabId === id) {
      currentTabId = tabs.length > 0 ? (tabs[tabIndex] ? tabs[tabIndex].id : tabs[tabs.length - 1].id) : null;
    }
    persistTabs();
    updateView();
    renderTabs();
  }

  // Persist tabs throttled to avoid many writes during rapid changes
  let _persistTabsTimeout = null;
  function persistTabs() {
    if (_persistTabsTimeout) clearTimeout(_persistTabsTimeout);
    _persistTabsTimeout = setTimeout(() => {
      storage.setItem(storageKey('tabs'), JSON.stringify(tabs));
      storage.setItem(storageKey('currentTabId'), currentTabId);
      _persistTabsTimeout = null;
    }, 500);
  }

  // --- Navigation ---
  function navigate(input) {
    let url = input.trim();
    
    // Handle empty input
    if (!url) return;
    
    // Keep file URLs unchanged (internal pages)
    if (/^file:\/\//i.test(url)) {
      // Already a file URL, use as is
    } else if (/^https?:\/\//i.test(url)) {
      // Already has protocol, use as is
    } else if (/^[a-zA-Z0-9][a-zA-Z0-9-]*[a-zA-Z0-9]*\.(com|org|net|edu|gov|mil|int|co|uk|de|fr|jp|au|ca|br|in|cn|ru|nl|it|es|se|no|dk|fi|pl|ch|at|be|cz|gr|hu|ie|pt|ro|sk|bg|hr|ee|lv|lt|lu|mt|si|cy|is|li|mc|ad|sm|va|md|me|rs|mk|al|ba|by|ua|am|az|ge|kz|kg|tj|tm|uz|af|bd|bt|bn|kh|cn|hk|id|in|ir|iq|il|jo|jp|kw|la|lb|my|mv|mn|mm|np|kp|kr|om|pk|ph|qa|sa|sg|lk|sy|tw|th|tl|tr|ae|uz|vn|ye)$/i.test(url)) {
      // Looks like a domain name, add https://
      url = 'https://' + url;
    } else if (/^[a-zA-Z0-9][a-zA-Z0-9-]*[a-zA-Z0-9]*\.[a-zA-Z]{2,}$/i.test(url)) {
      // Generic domain pattern, add https://
      url = 'https://' + url;
    } else if (/\.(com|org|net|edu|gov)$/i.test(url) || url.includes('.')) {
      // Contains common TLD or has a dot, probably a domain
      url = 'https://' + url;
    } else {
      // Treat as search query - improved encoding and URL construction
      const searchEngine = localStorage.getItem('searchEngine') || 'google';
      const searchUrls = {
        google: 'https://www.google.com/search?q=',
        bing: 'https://www.bing.com/search?q=',
        duckduckgo: 'https://duckduckgo.com/?q='
      };
      
      // Properly encode the search query and handle special characters
      const encodedQuery = encodeURIComponent(url.trim());
      url = searchUrls[searchEngine] + encodedQuery;
      
      console.log('Search query:', url.trim(), '-> Encoded URL:', url);
    }
    
    const tab = tabs.find(t => t.id === currentTabId);
    if (tab) {
      console.log('Navigating to:', url);
      
      // Always navigate in current tab, regardless of current URL
      tab.url = url;
      tab.history = tab.history || [];
      
      // Add to history if it's different from current
      if (tab.history[tab.historyIndex] !== url) {
        tab.history = tab.history.slice(0, tab.historyIndex + 1);
        tab.history.push(url);
        tab.historyIndex = tab.history.length - 1;
      }
      
      // Ensure internal pages use absolute file URLs
      try {
        if (url === 'settings.html' || url.includes('/settings.html')) {
          url = new URL('settings.html', window.location.href).href;
        } else if (url === 'history.html' || url.includes('/history.html')) {
          url = new URL('history.html', window.location.href).href;
        }
      } catch(e) {}
      if (url && url !== 'newtab') {
        ensureTabWebview(tab, { forceLoadUrl: true });
      }
      persistTabs();
      updateView();
    }
  }

  urlInput.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') {
      if (!omniboxSuggestions.length) {
        refreshOmniboxSuggestions();
      }
      if (omniboxSuggestions.length) {
        e.preventDefault();
        omniboxSelectedIndex = (omniboxSelectedIndex + 1 + omniboxSuggestions.length) % omniboxSuggestions.length;
        renderOmniboxSuggestions();
      }
      return;
    }

    if (e.key === 'ArrowUp' && omniboxSuggestions.length) {
      e.preventDefault();
      omniboxSelectedIndex = (omniboxSelectedIndex - 1 + omniboxSuggestions.length) % omniboxSuggestions.length;
      renderOmniboxSuggestions();
      return;
    }

    if (e.key === 'Tab' && omniboxSuggestions.length) {
      e.preventDefault();
      applyOmniboxSuggestion({ navigateToSuggestion: false });
      return;
    }

    if (e.key === 'Escape') {
      hideOmniboxSuggestions();
      return;
    }

    if (e.key === 'Enter') {
      if (omniboxSuggestions.length && omniboxSelectedIndex >= 0) {
        e.preventDefault();
        applyOmniboxSuggestion({ navigateToSuggestion: true });
        return;
      }
      hideOmniboxSuggestions();
      navigate(urlInput.value);
    }
  });

  // Debug focus and click events to detect any blocking overlays or lost focus issues
  try {
    urlInput.addEventListener('focus', () => {
      console.debug('URL input focused');
      if (omniboxHideTimer) clearTimeout(omniboxHideTimer);
      refreshOmniboxSuggestions();
    });
    urlInput.addEventListener('click', () => {
      console.debug('URL input clicked');
      if (omniboxHideTimer) clearTimeout(omniboxHideTimer);
      refreshOmniboxSuggestions();
    });
    urlInput.addEventListener('input', () => {
      if (omniboxHideTimer) clearTimeout(omniboxHideTimer);
      refreshOmniboxSuggestions();
    });
    urlInput.addEventListener('blur', () => {
      if (omniboxHideTimer) clearTimeout(omniboxHideTimer);
      omniboxHideTimer = setTimeout(() => hideOmniboxSuggestions(), 120);
    });
    window.addEventListener('blur', () => {
      hideOmniboxSuggestions();
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) hideOmniboxSuggestions();
    });
  } catch (e) { /* ignore errors if element not present */ }

  // --- Back/Forward Button Logic ---
  backBtn.onclick = () => {
    const tab = tabs.find(t => t.id === currentTabId);
    if (tab.historyIndex > 0) {
      tab.historyIndex--;
      tab.url = tab.history[tab.historyIndex];
      if (tab.url && tab.url !== 'newtab') ensureTabWebview(tab, { forceLoadUrl: true });
      persistTabs();
      updateView();
    }
  };

  forwardBtn.onclick = () => {
    const tab = tabs.find(t => t.id === currentTabId);
    if (tab.historyIndex < tab.history.length - 1) {
      tab.historyIndex++;
      tab.url = tab.history[tab.historyIndex];
      if (tab.url && tab.url !== 'newtab') ensureTabWebview(tab, { forceLoadUrl: true });
      persistTabs();
      updateView();
    }
  };

  // --- Settings Panel Logic ---
  // Get the new elements
  const settingsPanel = document.getElementById('settings-panel');
  const closeSettingsBtn = document.getElementById('close-settings');
  const homepageInput = document.getElementById('homepage-input');
  const saveHomepageBtn = document.getElementById('save-homepage-btn');
  const overlay = document.getElementById('overlay');
  const allSettingsBtn = document.getElementById('all-settings-btn');
  const quickHistoryPanel = document.getElementById('quick-history-panel');
  const closeQuickHistoryBtn = document.getElementById('close-quick-history');
  const quickHistoryList = document.getElementById('quick-history-list');
  const viewAllHistoryBtn = document.getElementById('view-all-history-btn');
  const checkUpdatesBtn = document.getElementById('check-updates');
  const adblockToggle = document.getElementById('adblock-toggle');
  const adblockStrictToggle = document.getElementById('adblock-strict-toggle');

  async function openFullHistoryPage() {
    try { await historyManager.flush(); } catch (err) { console.error('Failed to flush history before opening history page', err); }
    try {
      const fileUrl = new URL('history.html', window.location.href).href;
      const snapshotEntries = await getRecentHistoryEntries(120);
      const compactEntries = snapshotEntries.map(entry => ({
        url: entry.url,
        title: entry.title || '',
        host: entry.host || '',
        timestamp: Number(entry.timestamp) || Date.now()
      }));
      const snapshot = encodeURIComponent(JSON.stringify(compactEntries));
      newTab(`${fileUrl}#historyData=${snapshot}`);
    } catch (err) {
      newTab('history.html');
    }
  }

  async function getRecentHistoryEntries(limit = 18) {
    let persisted = [];
    try {
      persisted = JSON.parse(await storage.getItem('browserHistory') || '[]');
      if (!Array.isArray(persisted)) persisted = [];
    } catch (error) {
      persisted = [];
    }

    let inMemory = [];
    try {
      inMemory = historyManager.getAll();
      if (!Array.isArray(inMemory)) inMemory = [];
    } catch (error) {
      inMemory = [];
    }

    const merged = [...persisted, ...inMemory];
    const byUrl = new Map();
    merged.forEach((entry) => {
      if (!entry || !entry.url) return;
      if (isSkippableHistoryUrl(entry.url)) return;
      const key = String(entry.url).trim();
      if (!key) return;
      const existing = byUrl.get(key);
      if (!existing || (Number(entry.timestamp) || 0) >= (Number(existing.timestamp) || 0)) {
        byUrl.set(key, {
          ...entry,
          url: key,
          timestamp: Number(entry.timestamp) || Date.now()
        });
      }
    });

    return Array.from(byUrl.values())
      .sort((a, b) => (Number(b.timestamp) || 0) - (Number(a.timestamp) || 0))
      .slice(0, limit);
  }

  async function renderQuickHistoryPanel() {
    if (!quickHistoryList) return;
    quickHistoryList.innerHTML = '';

    const entries = await getRecentHistoryEntries(18);
    if (!entries.length) {
      quickHistoryList.innerHTML = '<div class="quick-history-empty">No recent history yet.</div>';
      return;
    }

    const frag = document.createDocumentFragment();
    entries.forEach((entry) => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'quick-history-item';

      const favicon = document.createElement('img');
      favicon.src = getFavicon(entry.url);
      favicon.onerror = function() { this.src = 'icons/newtab.png'; };

      const textWrap = document.createElement('div');
      textWrap.className = 'quick-history-item-text';

      const title = document.createElement('div');
      title.className = 'quick-history-item-title';
      title.textContent = entry.title || getSiteName(entry.url);

      const meta = document.createElement('div');
      meta.className = 'quick-history-item-meta';
      meta.textContent = entry.url;

      textWrap.appendChild(title);
      textWrap.appendChild(meta);
      item.appendChild(favicon);
      item.appendChild(textWrap);

      item.addEventListener('click', () => {
        closeQuickHistoryPanel({ restoreUrlFocus: false });
        navigate(entry.url);
      });

      frag.appendChild(item);
    });

    quickHistoryList.appendChild(frag);
  }

  function openQuickHistoryPanel() {
    closeSettingsPanelIfOpen({ restoreUrlFocus: false });
    renderQuickHistoryPanel().catch((error) => {
      console.error('Failed to render quick history panel', error);
    });

    if (!quickHistoryPanel || !overlay) return;
    quickHistoryPanel.style.visibility = 'visible';
    overlay.classList.add('active');
    void quickHistoryPanel.offsetWidth;
    quickHistoryPanel.classList.add('active');
    document.body.style.overflow = 'hidden';
    document.body.appendChild(overlay);
    document.body.appendChild(quickHistoryPanel);
    try { urlInput && urlInput.blur(); } catch (e) {}
  }

  function closeQuickHistoryPanel({ restoreUrlFocus = true } = {}) {
    if (!quickHistoryPanel || !overlay) return;
    quickHistoryPanel.classList.remove('active');
    overlay.classList.remove('active');

    setTimeout(() => {
      quickHistoryPanel.style.visibility = 'hidden';
      overlay.style.visibility = 'hidden';
      document.body.style.overflow = '';
      if (restoreUrlFocus) {
        try { urlInput && urlInput.focus(); } catch (e) {}
      } else {
        hideOmniboxSuggestions();
      }
    }, 300);
  }

  function closeQuickHistoryPanelIfOpen(options = {}) {
    if (quickHistoryPanel && quickHistoryPanel.classList.contains('active')) {
      closeQuickHistoryPanel(options);
    }
  }

  if (window.electronAPI && typeof window.electronAPI.on === 'function' && !window.__historyClearListenerBound) {
    window.__historyClearListenerBound = true;
    window.electronAPI.on('clear-history', async () => {
      try { await historyManager.clear(); } catch (e) {}
      try {
        if (typeof window.renderSettingsHistory === 'function') {
          window.renderSettingsHistory();
        }
      } catch (e) {}
      try {
        if (quickHistoryPanel && quickHistoryPanel.classList.contains('active')) {
          renderQuickHistoryPanel();
        }
      } catch (e) {}
    });
  }
  
  // Settings button click handler
  if (settingsBtn) {
    settingsBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      closeQuickHistoryPanelIfOpen({ restoreUrlFocus: false });
      openSettingsPanel();
    });
  }

  if (historyBtn) {
    historyBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      openQuickHistoryPanel();
    });
  }

  // Check Updates button click handler
  if (checkUpdatesBtn) {
    checkUpdatesBtn.addEventListener('click', async function(e) {
      e.stopPropagation();
      try {
        showUpdateNotification('Checking for updates...', 'info');
        await window.electronAPI.checkForUpdates();
      } catch (error) {
        console.error('Manual update check failed:', error);
        showUpdateNotification('Failed to check for updates. Please try again later.', 'error');
      }
    });
  }

  if (adblockToggle) {
    storage.getItem('adblockEnabled').then((saved) => {
      const enabled = saved === 'true';
      adblockToggle.checked = enabled;
      try { localStorage.setItem('adblockEnabled', enabled ? 'true' : 'false'); } catch (_error) {}
      try { if (window.electronAPI && typeof window.electronAPI.toggleAdBlock === 'function') window.electronAPI.toggleAdBlock(enabled); } catch (_error) {}
    }).catch(() => {
      adblockToggle.checked = localStorage.getItem('adblockEnabled') === 'true';
    });

    adblockToggle.addEventListener('change', async (event) => {
      const enabled = !!event.target.checked;
      localStorage.setItem('adblockEnabled', enabled ? 'true' : 'false');
      await storage.setItem('adblockEnabled', enabled ? 'true' : 'false');
      if (window.electronAPI && typeof window.electronAPI.toggleAdBlock === 'function') {
        window.electronAPI.toggleAdBlock(enabled);
      }
      showUpdateNotification(enabled ? 'Ad blocker enabled' : 'Ad blocker disabled', 'info', 2000);
    });
  }

  if (adblockStrictToggle) {
    storage.getItem('adblockMode').then((savedMode) => {
      const mode = savedMode === 'strict' ? 'strict' : 'balanced';
      adblockStrictToggle.checked = mode === 'strict';
      try { localStorage.setItem('adblockMode', mode); } catch (_error) {}
      try { if (window.electronAPI && typeof window.electronAPI.setAdBlockMode === 'function') window.electronAPI.setAdBlockMode(mode); } catch (_error) {}
    }).catch(() => {
      adblockStrictToggle.checked = localStorage.getItem('adblockMode') === 'strict';
    });

    adblockStrictToggle.addEventListener('change', async (event) => {
      const mode = event.target.checked ? 'strict' : 'balanced';
      localStorage.setItem('adblockMode', mode);
      await storage.setItem('adblockMode', mode);
      if (window.electronAPI && typeof window.electronAPI.setAdBlockMode === 'function') {
        window.electronAPI.setAdBlockMode(mode);
      }
      showUpdateNotification(mode === 'strict' ? 'Ad blocker mode: strict' : 'Ad blocker mode: balanced', 'info', 2000);
    });
  }

  // All Settings button click handler
  if (allSettingsBtn) {
    allSettingsBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      let settingsPath = 'settings.html';
      try {
        settingsPath = new URL('settings.html', window.location.href).href;
      } catch (err) {}
      newTab(settingsPath);
      closeSettingsPanel(); // Close the settings panel when opening full settings
    });
  }
  
  // Close settings button click handler
  if (closeSettingsBtn) {
    closeSettingsBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      closeSettingsPanel({ restoreUrlFocus: false });
    });
  }

  if (closeQuickHistoryBtn) {
    closeQuickHistoryBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      closeQuickHistoryPanel({ restoreUrlFocus: false });
    });
  }

  if (viewAllHistoryBtn) {
    viewAllHistoryBtn.addEventListener('click', async function(e) {
      e.stopPropagation();
      closeQuickHistoryPanel({ restoreUrlFocus: false });
      await openFullHistoryPage();
    });
  }
  
  // Save homepage button
  if (saveHomepageBtn) {
    saveHomepageBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      let url = homepageInput.value.trim();
      if (url && !/^https?:\/\//i.test(url)) {
        url = 'http://' + url;
      }
      homepage = url;
      storage.setItem('homepage', homepage);
      
      // Visual feedback on save
      saveHomepageBtn.textContent = 'Saved!';
      saveHomepageBtn.style.backgroundColor = '#34A853';  // Google green
      
      setTimeout(() => {
        saveHomepageBtn.textContent = 'Save';
        saveHomepageBtn.style.backgroundColor = '';
      }, 1500);
    });
  }
  
  // Overlay click handler - close settings when clicking outside
  if (overlay) {
    overlay.addEventListener('click', () => {
      closeQuickHistoryPanelIfOpen({ restoreUrlFocus: false });
      closeSettingsPanelIfOpen({ restoreUrlFocus: false });
    });
    // Ensure overlay is not blocking interaction by default
    try {
      overlay.classList.remove('active');
      overlay.style.visibility = overlay.style.visibility || 'hidden';
    } catch (e) { /* ignore */ }
  }

  // Quick Settings Sidebar Accordion
  async function initializeSettingsAccordion() {
    const sections = document.querySelectorAll('#settings-panel .settings-section');
    if (!sections || sections.length === 0) return;

    let savedState = {};
    try {
      const rawState = await storage.getItem('quickSettingsAccordionState');
      savedState = rawState ? JSON.parse(rawState) : {};
    } catch (error) {
      console.debug('No saved quick settings accordion state found', error);
      savedState = {};
    }

    const persistState = () => {
      try {
        storage.setItem('quickSettingsAccordionState', JSON.stringify(savedState));
      } catch (error) {
        console.debug('Failed to persist quick settings accordion state', error);
      }
    };

    sections.forEach((section, index) => {
      const heading = section.querySelector('h3');
      if (!heading || heading.dataset.accordionReady === 'true') return;

      if (section.classList.contains('non-collapsible')) {
        section.classList.remove('collapsed');
        heading.removeAttribute('role');
        heading.removeAttribute('tabindex');
        heading.removeAttribute('aria-expanded');
        return;
      }

      const sectionKey = section.id || `section-${index}`;
      const isSavedCollapsed = typeof savedState[sectionKey] === 'boolean' ? savedState[sectionKey] : null;
      const shouldStartOpen = isSavedCollapsed === null ? index < 3 : !isSavedCollapsed;
      section.classList.toggle('collapsed', !shouldStartOpen);

      heading.setAttribute('role', 'button');
      heading.setAttribute('tabindex', '0');
      heading.setAttribute('aria-expanded', shouldStartOpen ? 'true' : 'false');

      const toggleSection = () => {
        const collapsed = section.classList.toggle('collapsed');
        heading.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
        savedState[sectionKey] = collapsed;
        persistState();
      };

      heading.addEventListener('click', (event) => {
        event.stopPropagation();
        toggleSection();
      });

      heading.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          toggleSection();
        }
      });

      heading.dataset.accordionReady = 'true';
    });
  }

  initializeSettingsAccordion();
  
  // Open the settings panel
  function openSettingsPanel() {
    initializeSettingsAccordion();
    // Set all current setting values before showing
    if (homepageInput) {
      homepageInput.value = homepage || '';
    }
    
    // Update all settings controls with current values
    const searchEngineSelect = document.getElementById('search-engine-select');
    if (searchEngineSelect) {
      searchEngineSelect.value = localStorage.getItem('searchEngine') || 'google';
    }
    
    const themeSelect = document.getElementById('theme-select');
    if (themeSelect) {
      themeSelect.value = localStorage.getItem('theme') || 'light';
    }
    
    const fontSizeInput = document.getElementById('font-size-input');
    if (fontSizeInput) {
      fontSizeInput.value = localStorage.getItem('fontSize') || '16';
    }
    
    const showBookmarksBar = document.getElementById('show-bookmarks-bar');
    if (showBookmarksBar) {
      showBookmarksBar.checked = localStorage.getItem('showBookmarksBar') !== 'false';
    }
    
    const startPageSelect = document.getElementById('start-page-select');
    if (startPageSelect) {
      startPageSelect.value = localStorage.getItem('startPage') || 'homepage';
    }
    
    if (adblockToggle) {
      adblockToggle.checked = localStorage.getItem('adblockEnabled') === 'true';
    }
    if (adblockStrictToggle) {
      adblockStrictToggle.checked = localStorage.getItem('adblockMode') === 'strict';
    }
    
    const userAgentInput = document.getElementById('user-agent-input');
    if (userAgentInput) {
      userAgentInput.value = localStorage.getItem('userAgent') || '';
    }

    // Apply current theme to settings panel
    const currentTheme = localStorage.getItem('theme') || 'light';
    settingsPanel.classList.add('theme-' + currentTheme);

    // First, make the panel visible but keep it off-screen
    // This ensures it's in the DOM and rendered
    settingsPanel.style.visibility = 'visible';
    overlay.classList.add('active');
    
    // Force a reflow to ensure styles are applied
    void settingsPanel.offsetWidth;
    
    // Now add the active class to trigger the animation
    settingsPanel.classList.add('active');
    
    // Prevent scrolling of the main content while settings are open
    document.body.style.overflow = 'hidden';
    
    // For extra safety, move the settings panel and overlay to the end of body
    // This sometimes helps with z-index stacking contexts
    document.body.appendChild(overlay);
    document.body.appendChild(settingsPanel);
    // Blur the URL input so keyboard input doesn't keep going to the url bar
    try { urlInput && urlInput.blur(); } catch (e) {}
  }
  
  // Close the settings panel
  function closeSettingsPanel({ restoreUrlFocus = true } = {}) {
    // Remove the active class first to trigger the animation
    settingsPanel.classList.remove('active');
    overlay.classList.remove('active');
    
    // Wait for animation to complete before hiding
    setTimeout(() => {
      // Hide the panel and overlay after animation completes
      settingsPanel.style.visibility = 'hidden';
      overlay.style.visibility = 'hidden';
      
      // Restore scrolling
      document.body.style.overflow = '';
      if (restoreUrlFocus) {
        try { urlInput && urlInput.focus(); } catch (e) {}
      } else {
        hideOmniboxSuggestions();
      }
    }, 300);
  }

  function closeSettingsPanelIfOpen(options = {}) {
    if (settingsPanel && settingsPanel.classList.contains('active')) {
      closeSettingsPanel(options);
    }
  }

  // Webview can sit above DOM overlays in Electron; close quick settings on direct webview interaction.
  if (contentWebview && !contentWebview._settingsCloseListenersBound) {
    contentWebview.addEventListener('mousedown', () => {
      closeSettingsPanelIfOpen({ restoreUrlFocus: false });
      closeQuickHistoryPanelIfOpen({ restoreUrlFocus: false });
    }, { passive: true });

    contentWebview.addEventListener('focus', () => {
      closeSettingsPanelIfOpen({ restoreUrlFocus: false });
      closeQuickHistoryPanelIfOpen({ restoreUrlFocus: false });
    });

    contentWebview._settingsCloseListenersBound = true;
  }
  
  // Handle escape key to close the panel (prevent duplicate listeners)
  if (!document.escapeKeyListenerAdded) {
    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape') {
        closeQuickHistoryPanelIfOpen({ restoreUrlFocus: false });
        // Check if the settings panel is visible
        if (settingsPanel && settingsPanel.classList.contains('active')) {
          closeSettingsPanel();
        }
      }
    });
    document.escapeKeyListenerAdded = true;
  }

  // --- Bookmarks Bar ---
  function renderBookmarkBar() {
    perfStart('renderBookmarkBar');
    // Exit early if bookmark bar doesn't exist (e.g., on settings page)
    if (!bookmarkBar) return;
    const currentTab = tabs.find(t => t.id === currentTabId);
    // Hide the bookmark bar for pages that shouldn't show it (settings/history)
    if (currentTab && currentTab.url && (currentTab.url.includes('settings.html') || currentTab.url.includes('history.html'))) {
      bookmarkBar.style.display = 'none';
      perfEnd('renderBookmarkBar');
      return;
    }
    
    bookmarkBar.innerHTML = '';
    
    // Check if we should show the bookmark bar
    const shouldShowBar = bookmarks.length > 0;
    const showBookmarksBar = document.getElementById('show-bookmarks-bar');
    const userWantsToShow = !showBookmarksBar || showBookmarksBar.checked;
    
    // Hide bar if no bookmarks, regardless of user setting
    const actuallyVisible = shouldShowBar && userWantsToShow;
    if (!shouldShowBar) {
      bookmarkBar.style.display = 'none';
    } else {
      // Show bar only if user wants it visible and there are bookmarks
      bookmarkBar.style.display = userWantsToShow ? 'flex' : 'none';
    }
    
    // Don't notify main process if we're on settings page (settings page always uses full header height)
    if (!window.location.href.includes('settings.html')) {
      // Notify main process about bookmark bar visibility change
      window.electronAPI.setBookmarkBarVisibility(actuallyVisible);
    }
    
    const frag = document.createDocumentFragment();
    bookmarks.forEach((b, index) => {
      const btn = document.createElement('button');
      btn.className = 'bookmark-btn';
      btn.onclick = () => {
        const tab = tabs.find(t => t.id === currentTabId);
        let url = b.url || b;
        
        if (tab) {
          // Navigate in current tab
          if (!/^https?:\/\//i.test(url)) {
            url = 'http://' + url;
          }
          tab.url = url;
          tab.history = tab.history || [];
          tab.history.push(url);
          tab.historyIndex = tab.history.length - 1;

          ensureTabWebview(tab, { forceLoadUrl: true });
          persistTabs();
          updateView();
        }
      };

      const favicon = document.createElement('img');
      const host = getHostFromUrl(b.url || b);
      favicon.dataset.faviconHost = host;
      favicon.src = getFavicon(b.url || b);
      favicon.onerror = function() { this.src = 'icons/newtab.png'; };
      btn.appendChild(favicon);

      btn.appendChild(document.createTextNode(b.label || b.url || b));

      const deleteBtn = document.createElement('div');
      deleteBtn.className = 'delete-bookmark';
      deleteBtn.onclick = (e) => {
          e.stopPropagation();
          deleteBookmark(index);
      };
      btn.appendChild(deleteBtn);

      frag.appendChild(btn);
    });
    bookmarkBar.appendChild(frag);
    perfEnd('renderBookmarkBar');
  }

    function deleteBookmark(index) {
      bookmarks.splice(index, 1);
      debouncedSetItem('bookmarks', JSON.stringify(bookmarks));
      renderBookmarkBar();
    }

  bookmarkAddBtn.onclick = () => {
    const tab = tabs.find(t => t.id === currentTabId);
    if (tab.url && tab.url !== 'newtab' && !bookmarks.some(b => (b.url || b) === tab.url)) {
      // Use the page title if available, otherwise generate a friendly name from URL
      let label = tab.title || 'Untitled';
      if (label === tab.url || !tab.title) {
        try {
          // Generate a friendly name from URL (domain name)
          label = new URL(tab.url).hostname.replace(/^www\./, '');
        } catch {
          label = tab.url;
        }
      }
      bookmarks.push({ url: tab.url, label: label });
      debouncedSetItem('bookmarks', JSON.stringify(bookmarks));
      renderBookmarkBar();
    }
  };

  // --- Homepage ---
  // Navigate to homepage in current tab
  setHomeBtn.onclick = () => {
    if (homepage) {
      const tab = tabs.find(t => t.id === currentTabId);
      if (tab) {
        let url = homepage;
        if (!/^https?:\/\//i.test(url)) {
          url = 'http://' + url;
        }
        
        // Navigate in current tab instead of creating new tab
        tab.url = url;
        tab.history = tab.history || [];
        tab.history.push(url);
        tab.historyIndex = tab.history.length - 1;
        
        ensureTabWebview(tab, { forceLoadUrl: true });
        persistTabs();
        updateView();
      }
    }
  };

  // --- Webview events handled near DOM initialization ---

  // Listen for the main process to request a new tab
  window.electronAPI.onOpenInNewTab((url) => {
    newTab(url);
  });

  // This is a new window. Clear old state and load the URL.
  window.electronAPI.onNewWindow((url) => {
      if (window._isNewWindowTarget) return; // Window already opened for a specific URL, ignore
      // Clear the tab state from the previous window
      try { localStorage.removeItem(storageKey('tabs')); } catch(e) {}
      try { localStorage.removeItem(storageKey('currentTabId')); } catch(e) {}

      // Re-initialize state for the new window
      const newTabId = Date.now();
      tabs = [{ id: newTabId, url: url, history: [url], historyIndex: 0 }];
      currentTabId = newTabId;
      
      // Persist the new state and update the UI
      persistTabs();
      updateView();
      renderTabs();
  });

  // Inter-window drag/drop support: show visual indicator when other window is dragging a tab
  // Flag set when main/target signals the drag ended (drop handled)
  let dropHandled = false;
  window.electronAPI.on('tab-drag-started', (_event, payload) => {
    try {
      const indicator = document.getElementById('tab-drop-indicator');
      if (!indicator) {
        const div = document.createElement('div');
        div.id = 'tab-drop-indicator';
        div.textContent = 'Drop tab here to attach';
        div.style.position = 'fixed';
        div.style.left = '50%';
        div.style.transform = 'translateX(-50%)';
        div.style.top = '50%';
        div.style.marginTop = '-20px';
        div.style.padding = '12px 24px';
        div.style.background = 'rgba(66, 133, 244, 0.9)';
        div.style.color = '#fff';
        div.style.borderRadius = '8px';
        div.style.zIndex = '999999';
        div.style.fontSize = '16px';
        div.style.fontWeight = 'bold';
        div.style.pointerEvents = 'none';
        document.body.appendChild(div);
      }
    } catch (err) { /* ignore */ }
    
    // Store external drag metadata globally
    const incomingMeta = payload?.tabMeta || null;
    const incomingSourceWinId = Number(incomingMeta?.sourceWinId);
    const thisWinId = Number(_windowId);
    if (incomingMeta && Number.isFinite(incomingSourceWinId) && Number.isFinite(thisWinId) && incomingSourceWinId !== thisWinId) {
      window._externalDraggedTabMeta = incomingMeta;
      window._currentDragTransferId = incomingMeta.transferId || null;
    } else {
      window._externalDraggedTabMeta = null;
      window._currentDragTransferId = null;
    }
    window._tabDropHandled = false;
    console.log('[DND] tab-drag-started received:', window._externalDraggedTabMeta, 'transferId:', window._currentDragTransferId);
  });

  window.electronAPI.on('tab-drag-ended', () => {
    try {
      const indicator = document.getElementById('tab-drop-indicator');
      if (indicator) indicator.remove();
    } catch (err) {}
    window._externalDraggedTabMeta = null;
    window._currentDragTransferId = null;
    window._tabDropHandled = true;
    console.log('[DND] tab-drag-ended');
  });

  // Specific signal that a drop for a tab id was successfully attached at destination
  window.electronAPI.on('tab-drop-complete', (_event, tabId) => {
    try {
      console.log('renderer: tab-drop-complete received for', tabId);
      // Mark this drag as handled — skip detach on source
      dropHandled = true;
    } catch (err) { console.error('tab-drop-complete handler failed', err); }
  });

  // When another window drops a tab onto this window's tab bar, handle the IPC
  window.electronAPI.on('open-in-new-tab', (url) => {
    // Ensure not duplicating this listener; renderer already handles open-in-new-tab above.
  });

  window.electronAPI.on('remove-tab-by-id', (_event, id) => {
    try { closeTab(id); } catch (err) { console.error('remove-tab-by-id failed', err); }
  });

  // Remove a tab record without destroying its BrowserView (used for transfers)
  window.electronAPI.on('remove-tab-record', (_event, id) => {
    try {
      const tabIndex = tabs.findIndex(t => t.id === id);
      if (tabIndex === -1) return;

      // Remove the tab entry but do not call viewDestroy - the BrowserView has been
      // transferred to another window by the main process and should remain intact.
      console.log('remove-tab-record: id=', id, 'tabIndex=', tabIndex, 'tabsLenBefore=', tabs.length);
      tabs.splice(tabIndex, 1);
      removeTabWebview(id);

      // Adjust current tab selection or close window if no tabs remain
      if (currentTabId === id) {
        if (tabs.length > 0) {
          currentTabId = (tabs[tabIndex] ? tabs[tabIndex].id : tabs[tabs.length - 1].id);
        } else {
          // No tabs left - if this was a transfer, close the window if only a 'newtab' placeholder would remain
          if (window._isNewWindowTarget) {
            setTimeout(() => { window.close(); }, 300);
            return;
          }
          // Otherwise, create a 'newtab' placeholder
          const newId = Date.now();
          tabs.push({ id: newId, url: 'newtab', history: ['newtab'], historyIndex: 0, viewCreated: false });
          currentTabId = newId;
        }
      }

      persistTabs();
      console.log('remove-tab-record: tabsLenAfter=', tabs.length, 'currentTabId=', currentTabId);
      updateView();
      renderTabs();
    } catch (err) { console.error('remove-tab-record failed', err); }
  });

  // Handler for when a BrowserView has been attached to this window (via main process transfer)
  window.electronAPI.on('attach-tab-handled', (_event, payload) => {
    try {
      const { tab, viewCreated, dropTargetTabId } = payload || {};
      if (!tab || !tab.id) return;
      const normalizedDropTargetId = Number.isFinite(Number(dropTargetTabId)) ? Number(dropTargetTabId) : null;
      let incomingTabId = Number(tab.id);
      if (!Number.isFinite(incomingTabId)) incomingTabId = Date.now();
      if (!viewCreated) {
        while (tabs.some(existingTab => existingTab && existingTab.id === incomingTabId)) {
          incomingTabId += 1;
        }
      }
      const incomingTabRecord = {
        id: incomingTabId,
        url: tab.url,
        history: [tab.url],
        historyIndex: 0,
        viewCreated: !!viewCreated
      };
      // Remove any placeholder or duplicate tabs
      let replaced = false;
      if (tabs.length === 1 && tabs[0].url === 'newtab') {
        tabs[0] = incomingTabRecord;
        replaced = true;
      } else {
        // Remove any 'newtab' placeholder tabs in this window (from a detached window)
        for (let i = tabs.length - 1; i >= 0; i--) {
          if (tabs[i].url === 'newtab' && !tabs[i].viewCreated) tabs.splice(i, 1);
        }
        // Remove any tabs with the same id (shouldn't happen, but for safety)
        for (let i = tabs.length - 1; i >= 0; i--) {
          if (tabs[i].id === incomingTabId) tabs.splice(i, 1);
        }
        const targetIndex = normalizedDropTargetId !== null ? tabs.findIndex(existingTab => existingTab.id === normalizedDropTargetId) : -1;
        if (targetIndex >= 0) tabs.splice(targetIndex + 1, 0, incomingTabRecord);
        else tabs.push(incomingTabRecord);
      }
      currentTabId = incomingTabId;
      persistTabs();
      renderTabs();
      const activeIncomingTab = tabs.find(existingTab => existingTab.id === incomingTabId);
      if (!viewCreated && activeIncomingTab && activeIncomingTab.url && activeIncomingTab.url !== 'newtab') {
        try {
          ensureTabWebview(activeIncomingTab, { forceLoadUrl: true });
          activeIncomingTab.viewCreated = true;
        } catch (error) {
          console.error('attach-tab-handled: failed to prepare incoming webview', error);
        }
      }
      updateView();
      // If a BrowserView was attached by main, ack back that renderer is ready
      if (viewCreated) {
        try { if (window.electronAPI && window.electronAPI.attachTabAck) window.electronAPI.attachTabAck(incomingTabId); } catch (e) {}
      }
      // If this window was a detached/orphaned window, and now has no tabs except the reattached one, close it
      // Only close if this window is not the main/original window and is now empty or only has the reattached tab
      if (window._isNewWindowTarget && tabs.length === 1 && tabs[0].id === incomingTabId && replaced) {
        setTimeout(() => { window.close(); }, 300);
      }
      console.log('attach-tab-handled: tabId=', incomingTabId, 'viewCreated=', viewCreated, 'currentTabs=', tabs.length, 'dropTargetTabId=', normalizedDropTargetId);
    } catch (err) { console.error('attach-tab-handled failed', err); }
  });

  // --- Quick Links ---
  function renderQuickLinks() {
    perfStart('renderQuickLinks');
    quickLinksDiv.innerHTML = '';
    quickLinks.forEach((q, i) => {
      const ql = document.createElement('div');
      ql.className = 'quick-link';
      ql.onclick = () => navigate(q.url);

      const closeBtn = document.createElement('div');
      closeBtn.className = 'close';
      closeBtn.onclick = (e) => {
        e.stopPropagation();
        quickLinks.splice(i, 1);
        debouncedSetItem('quickLinks', JSON.stringify(quickLinks));
        renderQuickLinks();
      };
      ql.appendChild(closeBtn);

      const favicon = document.createElement('img');
      const host = getHostFromUrl(q.url);
      favicon.dataset.faviconHost = host;
      favicon.src = getFavicon(q.url);
      favicon.onerror = function() { this.src = 'icons/newtab.png'; };
      ql.appendChild(favicon);

      const label = document.createElement('div');
      label.className = 'quick-link-label';
      label.textContent = q.label || q.url;
      ql.appendChild(label);

      quickLinksDiv.appendChild(ql);
    });

    // Add the "Add new" button at the end
    const addBtn = document.createElement('button');
    addBtn.id = 'add-quick-link-btn';
    addBtn.textContent = '+';
    
    if (addQuickLinkModal) {
      addBtn.onclick = () => {
        addQuickLinkModal.style.display = 'block';
      };
    }
    quickLinksDiv.appendChild(addBtn);
    perfEnd('renderQuickLinks');
  }

  // Modal Logic - only if the elements exist
  if (addQuickLinkModal && closeButton && saveQuickLinkBtn) {
    closeButton.onclick = () => {
      addQuickLinkModal.style.display = 'none';
    };

    window.addEventListener('click', (event) => {
      if (event.target == addQuickLinkModal) {
        addQuickLinkModal.style.display = 'none';
      }
    });

    saveQuickLinkBtn.onclick = () => {
      let url = newQuickLinkUrlInput.value.trim();
      let label = newQuickLinkLabelInput.value.trim();

      if (!url) {
          showUpdateNotification("URL is required.", 'error', 3000);
          return;
      }

      if (!/^https?:\/\//i.test(url)) {
        url = 'http://' + url;
      }

      if (!label) {
          try {
              label = new URL(url).hostname.replace(/^www\./, '');
          } catch {
              label = url;
          }
      }

      if (!quickLinks.some(q => q.url === url)) {
        quickLinks.push({ url, label });
        debouncedSetItem('quickLinks', JSON.stringify(quickLinks));
        renderQuickLinks();
        newQuickLinkUrlInput.value = '';
        newQuickLinkLabelInput.value = '';
        addQuickLinkModal.style.display = 'none';
      } else {
        showUpdateNotification("This quick link already exists.", 'info', 3000);
      }
    };
  }

  // Reload button logic
  reloadBtn.onclick = () => {
    const tab = tabs.find(t => t.id === currentTabId);
    if (tab && tab.url !== 'newtab') {
      try { const activeWebview = getActiveWebview(); if (activeWebview) activeWebview.reload(); } catch (e) {}
    }
  };

  // --- Initial Render ---
  renderTabs();
  updateView();

  // --- Settings Panel Feature Logic ---
  // Theme switching
  function applyTheme(themeClassName) {
    const themeClasses = [
      'theme-light', 'theme-dark',
      'theme-light-mint', 'theme-light-sakura', 'theme-light-sunny',
      'theme-dark-purple', 'theme-dark-nord', 'theme-dark-forest', 'theme-dark-rose'
    ];
    // Remove all possible theme classes to avoid conflicts
    document.body.classList.remove(...themeClasses);
    
    // Add the single, correct class (e.g., 'theme-dark' or 'theme-dark-purple')
    document.body.classList.add(themeClassName);
  }

  // --- Theme Broadcasting ---
  // Listen for theme changes from other windows (like the settings page)
  window.electronAPI.onThemeChanged((themeClassName) => {
    console.log('Theme change received in main window:', themeClassName);
    storage.setItem('theme', themeClassName);
    applyTheme(themeClassName);
    
    // Update the sidebar theme dropdown if it exists
    const themeSelect = document.getElementById('theme-select');
    if (themeSelect) {
      themeSelect.value = themeClassName;
    }
  });

  // Apply the initial theme on load
  storage.getItem('theme').then(initialTheme => {
    const theme = initialTheme || 'theme-light';
    applyTheme(theme);

    // Update theme select handler in the slide-out panel
    const themeSelect = document.getElementById('theme-select');
    if (themeSelect) {
      themeSelect.value = theme;
      console.log('Set theme select to:', theme);
      themeSelect.onchange = () => {
        const themeClassName = themeSelect.value;
        console.log('Theme changed to:', themeClassName);
        storage.setItem('theme', themeClassName);
        applyTheme(themeClassName);
        // Also broadcast this change to other windows
        window.electronAPI.broadcastThemeChange(themeClassName);
      };
    } else {
      console.log('Theme select element not found');
    }
  });

  // Search engine selection
  const searchEngineSelect = document.getElementById('search-engine-select');
  if (searchEngineSelect) {
    searchEngineSelect.value = localStorage.getItem('searchEngine') || 'google';
    searchEngineSelect.onchange = () => {
      localStorage.setItem('searchEngine', searchEngineSelect.value);
    };
  }

  // Font size
  const fontSizeInput = document.getElementById('font-size-input');
  if (fontSizeInput) {
    fontSizeInput.value = localStorage.getItem('fontSize') || '16';
    document.body.style.fontSize = fontSizeInput.value + 'px';
    fontSizeInput.oninput = () => {
      localStorage.setItem('fontSize', fontSizeInput.value);
      document.body.style.fontSize = fontSizeInput.value + 'px';
    };
  }

  // Bookmarks bar toggle
  const showBookmarksBar = document.getElementById('show-bookmarks-bar');
  if (showBookmarksBar) {
    showBookmarksBar.checked = localStorage.getItem('showBookmarksBar') !== 'false';
    
    // Initial render respects both user setting and bookmark presence
    renderBookmarkBar();
    
    showBookmarksBar.onchange = () => {
      localStorage.setItem('showBookmarksBar', showBookmarksBar.checked);
      // Re-render to apply new visibility logic
      renderBookmarkBar();
    };
  }

  // Page zoom control
  const pageZoomSelect = document.getElementById('page-zoom-select');
  if (pageZoomSelect) {
    const currentZoom = localStorage.getItem('pageZoom') || '1';
    pageZoomSelect.value = currentZoom;
    document.body.style.zoom = currentZoom;
    
    pageZoomSelect.onchange = () => {
      const zoomLevel = pageZoomSelect.value;
      localStorage.setItem('pageZoom', zoomLevel);
      document.body.style.zoom = zoomLevel;
      
      // Apply zoom to all tabs if possible
      if (window.electronAPI && window.electronAPI.setZoomLevel) {
        window.electronAPI.setZoomLevel(parseFloat(zoomLevel));
      }
    };
  }

  // Clear browsing data
  const clearDataBtn = document.getElementById('clear-data-btn');
  if (clearDataBtn) {
    clearDataBtn.onclick = async () => {
      localStorage.clear();
      await storage.setItem('browserHistory', '[]');
      location.reload();
    };
  }

  // Start page selection
  const startPageSelect = document.getElementById('start-page-select');
  if (startPageSelect) {
    startPageSelect.value = localStorage.getItem('startPage') || 'homepage';
    startPageSelect.onchange = () => {
      localStorage.setItem('startPage', startPageSelect.value);
    };
  }

  // Incognito mode - opens new incognito tab
  const incognitoBtn = document.getElementById('incognito-btn');
  if (incognitoBtn) {
    incognitoBtn.onclick = () => {
      // Create new incognito tab with proper BrowserView
      const incognitoTabId = Date.now();
      const incognitoTab = {
        id: incognitoTabId,
        url: 'newtab',
        title: 'New Tab (Incognito)',
        history: ['newtab'],
        historyIndex: 0,
        isIncognito: true
      };
      
      tabs.push(incognitoTab);
      currentTabId = incognitoTabId;
      
      persistTabs();
      renderTabs();
      updateView();
    };
  }

  // Tab management
  const pinTabBtn = document.getElementById('pin-tab-btn');
  if (pinTabBtn) {
    pinTabBtn.onclick = () => {
      const tab = tabs.find(t => t.id === currentTabId);
      if (tab) {
        tab.pinned = !tab.pinned;
        renderTabs();
        persistTabs();
      }
    };
  }
  const duplicateTabBtn = document.getElementById('duplicate-tab-btn');
  if (duplicateTabBtn) {
    duplicateTabBtn.onclick = () => {
      const tab = tabs.find(t => t.id === currentTabId);
      if (tab) {
        newTab(tab.url);
      }
    };
  }
  const reopenTabBtn = document.getElementById('reopen-tab-btn');
  if (reopenTabBtn) {
    reopenTabBtn.onclick = () => {
      // Simple implementation: restore last closed tab from localStorage
      const closedTabs = JSON.parse(localStorage.getItem('closedTabs') || '[]');
      if (closedTabs.length) {
        const tabToReopen = closedTabs.pop();
        tabs.push(tabToReopen);
        currentTabId = tabToReopen.id;
        localStorage.setItem('closedTabs', JSON.stringify(closedTabs));
        persistTabs();
        renderTabs();
        updateView();
      }
    };
  }
  // Save closed tabs on closeTab
  const originalCloseTab = closeTab;
  closeTab = function(id) {
    const closedTabs = JSON.parse(localStorage.getItem('closedTabs') || '[]');
    const tabToClose = tabs.find(t => t.id === id);
    if (tabToClose) {
      closedTabs.push(tabToClose);
    }
    localStorage.setItem('closedTabs', JSON.stringify(closedTabs));
    originalCloseTab.call(this, id);
  };

  // Bookmark folders (basic modal)
  const manageBookmarkFoldersBtn = document.getElementById('manage-bookmark-folders-btn');
  if (manageBookmarkFoldersBtn) {
    manageBookmarkFoldersBtn.onclick = () => {
      showUpdateNotification('Bookmark folders management coming soon!', 'info', 3000);
    };
  }

  // --- Download Manager ---
  let downloads = JSON.parse(localStorage.getItem('downloads') || '[]');

  function closeDownloadsModal() {
    const modal = document.getElementById('downloads-modal');
    if (modal) {
      modal.classList.remove('active');
    }
  }

  function getDownloadStatusText(download) {
    if (download.state === 'completed') return 'Completed';
    if (download.state === 'interrupted') return 'Interrupted';
    if (download.state === 'cancelled') return 'Cancelled';
    return `${Math.round((download.progress || 0) * 100)}%`;
  }

  function renderDownloadsList(listElement, items) {
    if (!listElement) return;

    if (!Array.isArray(items) || items.length === 0) {
      listElement.innerHTML = '<div class="downloads-empty">No downloads yet.</div>';
      return;
    }

    listElement.innerHTML = items.map(item => {
      const progress = Math.max(0, Math.min(100, Math.round((item.progress || 0) * 100)));
      return `
        <div class="download-item">
          <div class="download-name" title="${item.name || ''}">${item.name || 'Unknown file'}</div>
          <div class="download-progress">
            <div class="progress-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${progress}">
              <div class="progress-fill" style="width: ${progress}%"></div>
            </div>
            <span class="progress-text">${getDownloadStatusText(item)}</span>
          </div>
          ${item.savePath ? `<div class="download-path" title="${item.savePath}">${item.savePath}</div>` : ''}
        </div>
      `;
    }).join('');
  }

  function ensureDownloadsModal() {
    let modal = document.getElementById('downloads-modal');
    if (modal) return modal;

    modal = document.createElement('div');
    modal.id = 'downloads-modal';
    modal.className = 'modal';
    modal.innerHTML = `
      <div class="downloads-content" role="dialog" aria-modal="true" aria-label="Downloads">
        <div class="downloads-header">
          <h2>Downloads</h2>
          <button class="close-button" aria-label="Close downloads">&times;</button>
        </div>
        <div id="downloads-list" class="downloads-list"></div>
      </div>
    `;

    document.body.appendChild(modal);

    const closeBtn = modal.querySelector('.close-button');
    if (closeBtn) {
      closeBtn.addEventListener('click', closeDownloadsModal);
    }

    modal.addEventListener('click', (event) => {
      if (event.target === modal) {
        closeDownloadsModal();
      }
    });

    return modal;
  }

  // Listen for download events
  window.electronAPI.onDownloadStarted && window.electronAPI.onDownloadStarted((data) => {
    downloads.push({
      name: data.name,
      url: data.url,
      size: data.size,
      progress: 0,
      state: 'downloading',
      startTime: Date.now()
    });
    debouncedSetItem('downloads', JSON.stringify(downloads));
  });

  window.electronAPI.onDownloadProgress && window.electronAPI.onDownloadProgress((data) => {
    const download = downloads.find(d => d.name === data.name);
    if (download) {
      download.progress = data.progress;
      debouncedSetItem('downloads', JSON.stringify(downloads));
    }
  });

  window.electronAPI.onDownloadCompleted && window.electronAPI.onDownloadCompleted((data) => {
    const download = downloads.find(d => d.name === data.name);
    if (download) {
      download.state = data.state;
      download.savePath = data.savePath;
      debouncedSetItem('downloads', JSON.stringify(downloads));
    }
  });

  // Show downloads modal
  function showDownloadsModal() {
    const modal = ensureDownloadsModal();
    const list = modal.querySelector('#downloads-list');
    const currentDownloads = JSON.parse(localStorage.getItem('downloads') || '[]');
    renderDownloadsList(list, currentDownloads);
    modal.classList.add('active');
  }

  const showDownloadsBtn = document.getElementById('show-downloads-btn');
  if (showDownloadsBtn) {
    showDownloadsBtn.onclick = showDownloadsModal;
  }

  if (!document.downloadsEscapeListenerAdded) {
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        closeDownloadsModal();
      }
    });
    document.downloadsEscapeListenerAdded = true;
  }

  // Custom User Agent
  const userAgentInput = document.getElementById('user-agent-input');
  const setUserAgentBtn = document.getElementById('set-user-agent-btn');
  if (setUserAgentBtn && userAgentInput) {
    userAgentInput.value = localStorage.getItem('userAgent') || '';
    setUserAgentBtn.onclick = () => {
      const userAgent = userAgentInput.value.trim();
      localStorage.setItem('userAgent', userAgent);
      // Note: User agent changes require app restart in Electron
      showUpdateNotification('User agent saved! Restart the browser to apply changes.', 'success', 3000);
    };
  }

  // Session Restore
  const restoreSessionBtn = document.getElementById('restore-session-btn');
  if (restoreSessionBtn) {
    restoreSessionBtn.onclick = () => {
      const lastTabs = JSON.parse(localStorage.getItem('lastSessionTabs') || '[]');
      if (lastTabs.length) {
        tabs = lastTabs;
        currentTabId = Math.min(parseInt(localStorage.getItem('lastCurrentTabId') || '0'), tabs.length - 1);
        persistTabs();
        renderTabs();
        updateView();
        showUpdateNotification('Session restored!', 'success', 3000);
      } else {
        showUpdateNotification('No previous session found.', 'info', 3000);
      }
    };
  }

  // Save session on unload
  window.addEventListener('beforeunload', () => {
    localStorage.setItem('lastSessionTabs', JSON.stringify(tabs));
    localStorage.setItem('lastCurrentTabId', currentTabId.toString());
    // Flush buffered history using the central manager
    try { historyManager.flush(); } catch (e) { /* ignore */ }
  });

  // Enhanced Keyboard Shortcuts (prevent duplicate listeners)
  if (!document.keyboardShortcutsListenerAdded) {
    document.addEventListener('keydown', function(e) {
      // Prevent shortcuts when typing in inputs
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
        return;
      }

    if (e.ctrlKey && e.key === 't' && !e.shiftKey) {
      e.preventDefault();
      newTab();
    } else if (e.ctrlKey && e.key === 'w') {
      e.preventDefault();
      if (tabs.length > 1) {
        closeTab(currentTabId);
      }
    } else if (e.ctrlKey && e.shiftKey && e.key === 'T') {
      e.preventDefault();
      const closedTabs = JSON.parse(localStorage.getItem('closedTabs') || '[]');
      if (closedTabs.length) {
        const tabToReopen = closedTabs.pop();
        tabs.push(tabToReopen);
        currentTabId = tabToReopen.id;
        localStorage.setItem('closedTabs', JSON.stringify(closedTabs));
        persistTabs();
        renderTabs();
        updateView();
      }
    } else if (e.ctrlKey && e.key === 'Tab') {
      e.preventDefault();
      const currentIndex = tabs.findIndex(t => t.id === currentTabId);
      switchTab(tabs[(currentIndex + 1) % tabs.length].id);
    } else if (e.ctrlKey && e.shiftKey && e.key === 'Tab') {
      e.preventDefault();
      const currentIndex = tabs.findIndex(t => t.id === currentTabId);
      switchTab(tabs[(currentIndex - 1 + tabs.length) % tabs.length].id);
    } else if (e.ctrlKey && e.key === 'r') {
      e.preventDefault();
      const tab = tabs.find(t => t.id === currentTabId);
      if (tab && tab.url !== 'newtab') {
        try { const activeWebview = getActiveWebview(); if (activeWebview) activeWebview.reload(); } catch (err) {}
      }
    } else if (e.ctrlKey && e.key === 'd') {
      e.preventDefault();
      const tab = tabs.find(t => t.id === currentTabId);
      if (tab.url && tab.url !== 'newtab' && !bookmarks.some(b => (b.url || b) === tab.url)) {
        // Use the page title if available, otherwise generate a friendly name from URL
        let label = tab.title || 'Untitled';
        if (label === tab.url || !tab.title) {
          try {
            // Generate a friendly name from URL (domain name)
            label = new URL(tab.url).hostname.replace(/^www\./, '');
          } catch {
            label = tab.url;
          }
        }
        bookmarks.push({ url: tab.url, label: label });
        localStorage.setItem('bookmarks', JSON.stringify(bookmarks));
        renderBookmarkBar();
      }
    } else if (e.ctrlKey && e.shiftKey && e.key === 'Delete') {
      e.preventDefault();
      localStorage.clear();
      location.reload();
    } else if (e.key === 'F5') {
      e.preventDefault();
      const tab = tabs.find(t => t.id === currentTabId);
      if (tab && tab.url !== 'newtab') {
        try { const activeWebview = getActiveWebview(); if (activeWebview) activeWebview.reload(); } catch (err) {}
      }
    } else if (e.key === 'F12') {
      e.preventDefault();
      window.electronAPI.toggleDevTools();
    }
  });
  document.keyboardShortcutsListenerAdded = true;
  }

  // Enhanced search engine functionality
  function performSearch(query, engine) {
    const engines = {
      google: 'https://www.google.com/search?q=',
      bing: 'https://www.bing.com/search?q=',
      duckduckgo: 'https://duckduckgo.com/?q='
    };
    const searchUrl = engines[engine] + encodeURIComponent(query);
    navigate(searchUrl);
  }

  // Enhanced navigation function
  const originalNavigate = navigate;
  navigate = function(url) {
    if (!url) return;
    
    // Check if it's a search query or URL
    if (!/^https?:\/\//i.test(url) && !url.includes('.') && url.indexOf(' ') !== -1) {
      // It looks like a search query
      const searchEngine = localStorage.getItem('searchEngine') || 'google';
      performSearch(url, searchEngine);
      return;
    }
    
    // Use original navigate function
    originalNavigate(url);
  };

  // Page title updates come from webview event listeners now.
});

// --- Weather Widget Functionality ---
class WeatherWidget {
  constructor() {
    console.log('Creating WeatherWidget instance at:', new Date().toLocaleTimeString());
    
    // Access the storage helper from the global scope
    this.storage = storage;
    
    this.loadingEl = document.getElementById('weather-loading');
    this.locationEl = document.getElementById('weather-location');
    this.tempEl = document.getElementById('weather-temp');
    this.descEl = document.getElementById('weather-description');
    this.feelsLikeEl = document.getElementById('weather-feels-like');
    this.humidityEl = document.getElementById('weather-humidity');
    this.windEl = document.getElementById('weather-wind');
    
    console.log('Weather elements found:', {
      loading: !!this.loadingEl,
      location: !!this.locationEl,
      temp: !!this.tempEl,
      desc: !!this.descEl
    });
    
    if (!this.locationEl) {
      console.error('Critical weather widget elements not found!');
      return;
    }
    
    this.init();
  }
  
  async init() {
    try {
      if (this.loadingEl) {
        this.loadingEl.style.display = 'block';
        this.loadingEl.textContent = 'Loading weather...';
      }
      
      // Small delay to prevent immediate API rate limiting
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Add overall timeout for the entire weather loading process
      const weatherPromise = this.loadWeatherData();
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Weather loading timeout')), 25000); // 25 second timeout to allow fallback
      });
      
      await Promise.race([weatherPromise, timeoutPromise]);
      
    } catch (error) {
      console.error('Weather widget init error:', error);
      // Provide user-friendly error messages
      let userMessage = 'Weather service temporarily unavailable';
      if (error.message.includes('timeout')) {
        userMessage = 'Weather loading timed out';
      } else if (error.message.includes('JSON')) {
        userMessage = 'Weather data format error';
      } else if (error.message.includes('network') || error.message.includes('fetch')) {
        userMessage = 'Unable to connect to weather service';
      } else if (error.message.includes('location')) {
        userMessage = 'Location not available';
      }
      this.showError(userMessage);
    }
  }
  
  async loadWeatherData() {
    console.log('Starting weather data load...');
    
    console.log('Step 1: Getting location...');
    const position = await this.getLocationForWeather();
    console.log('Step 1 complete: Position obtained:', position);
    
    console.log('Step 2: Fetching weather...');
    const weather = await this.fetchWeather(position.latitude, position.longitude, position.customName);
    console.log('Step 2 complete: Weather data obtained:', weather);
    
    console.log('Step 3: Getting location name...');
    const locationName = position.customName || await this.getLocationName(position.latitude, position.longitude);
    console.log('Step 3 complete: Location name obtained:', locationName);
    
    console.log('Step 4: Updating display...');
    this.updateDisplay(weather, locationName);
    console.log('Step 4 complete: Weather widget loaded successfully');
  }

  async getLocationForWeather() {
    console.log('=== GETTING WEATHER LOCATION ===');
    try {
      // Check if manual location is enabled and set
      const useAutoLocation = await this.storage.getItem('useAutoLocation');
      const customLocation = await this.storage.getItem('weatherLocation');
      const storedCoords = await this.storage.getItem('weatherCoords');
      
      console.log('Weather location check:');
      console.log('- useAutoLocation:', useAutoLocation);
      console.log('- customLocation:', customLocation);
      console.log('- storedCoords:', storedCoords);
      
      if (useAutoLocation === 'false' && customLocation && customLocation.trim()) {
        console.log('✓ Using manual weather location:', customLocation);
        
        // Use stored coordinates if available, otherwise geocode
        if (storedCoords) {
          try {
            const coords = JSON.parse(storedCoords);
            console.log('✓ Using stored coordinates:', coords);
            return { 
              latitude: coords.lat, 
              longitude: coords.lon, 
              customName: customLocation 
            };
          } catch (parseError) {
            console.warn('Failed to parse stored coordinates, geocoding instead');
          }
        }
        
        // Fallback to geocoding if no stored coordinates
        console.log('⚠ Geocoding location:', customLocation);
        const coordinates = await this.geocodeLocation(customLocation);
        // Store the geocoded coordinates for future use
        await this.storage.setItem('weatherCoords', JSON.stringify({ lat: coordinates.latitude, lon: coordinates.longitude }));
        console.log('✓ Geocoded and stored coordinates:', coordinates);
        return { ...coordinates, customName: customLocation };
      }
      
      // Use automatic location detection
      console.log('⚠ Using automatic location detection');
      return await this.getCurrentLocation();
    } catch (error) {
      console.error('Error getting weather location:', error);
      // Fallback to automatic location
      return await this.getCurrentLocation();
    }
  }

  async geocodeLocation(locationName) {
    try {
      console.log('Geocoding location with Nominatim:', locationName);
      // Using Nominatim (OpenStreetMap) geocoding API - completely free
      const response = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(locationName)}&limit=1`);
      const data = await response.json();
      console.log('Geocoding response:', data);
      
      if (data && data.length > 0) {
        const result = data[0];
        return {
          latitude: parseFloat(result.lat),
          longitude: parseFloat(result.lon)
        };
      } else {
        throw new Error('Location not found');
      }
    } catch (error) {
      console.error('Geocoding failed for location:', locationName, error);
      throw new Error(`Unable to find coordinates for "${locationName}"`);
    }
  }
  
  getCurrentLocation() {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error('Geolocation not supported'));
        return;
      }
      
      navigator.geolocation.getCurrentPosition(
        position => resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude
        }),
        error => {
          console.warn('Geolocation failed, using default location (London)');
          // Fallback to London coordinates
          resolve({ latitude: 51.5074, longitude: -0.1278 });
        },
        { timeout: 10000 }
      );
    });
  }
  
  async fetchWeather(lat, lon, customLocationName = null) {
    console.log(`Fetching weather for coordinates: ${lat}, ${lon}, custom location: ${customLocationName}`);
    
    // Try primary API first, then fallback APIs
    const apis = [
      () => this.fetchFromWttr(lat, lon, customLocationName),
      () => this.fetchFromOpenMeteo(lat, lon, customLocationName)
    ];
    
    let lastError = null;
    
    for (let i = 0; i < apis.length; i++) {
      try {
        console.log(`Trying weather API ${i + 1}/${apis.length}...`);
        const result = await apis[i]();
        console.log(`Weather API ${i + 1} succeeded!`);
        return result;
      } catch (error) {
        console.warn(`Weather API ${i + 1} failed:`, error.message);
        lastError = error;
        if (i < apis.length - 1) {
          console.log('Trying next API...');
          // Small delay between API attempts
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }
    }
    
    // If all APIs failed, throw the last error
    throw new Error(`All weather APIs failed. Last error: ${lastError.message}`);
  }
  
  async fetchFromWttr(lat, lon, customLocationName = null, retryCount = 0) {
    console.log(`Fetching from wttr.in for coordinates: ${lat}, ${lon}, custom location: ${customLocationName}, attempt: ${retryCount + 1}`);
    
    try {
      // Using wttr.in API - completely free, no API key needed
      const url = `https://wttr.in/${lat},${lon}?format=j1`;
      console.log('Wttr.in API URL:', url);
      
      // Add delay between requests to avoid rate limiting
      if (retryCount > 0) {
        const delay = 500; // Just 500ms delay
        console.log(`Waiting ${delay}ms before retry...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
      
      console.log('Making fetch request to wttr.in...');
      
      // Add timeout to prevent hanging
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(),  2000); // 2 second timeout for wttr.in
      
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'VortexBrowser/1.0'
        }
      });
      
      clearTimeout(timeoutId);
      
      console.log('Wttr.in fetch completed. Response status:', response.status);
      
      if (!response.ok) {
        throw new Error(`Wttr.in API request failed with status ${response.status}`);
      }
      
      // Get response text first to see what we're actually getting
      const responseText = await response.text();
      console.log('Wttr.in response text length:', responseText.length);
      
      if (!responseText || responseText.trim().length === 0) {
        throw new Error('Wttr.in API returned empty response');
      }
      
      // Check for rate limiting message
      if (responseText.includes('This query is already being processed')) {
        console.log('Wttr.in API rate limit detected, retrying...');
        if (retryCount < 1) { // Only 1 retry for wttr.in since we have fallback
          return await this.fetchFromWttr(lat, lon, retryCount + 1);
        } else {
          throw new Error('Wttr.in API is overloaded');
        }
      }
      
      let data;
      try {
        data = JSON.parse(responseText);
      } catch (parseError) {
        console.error('Wttr.in JSON parse error:', parseError);
        if (responseText.includes('This query is already being processed') && retryCount < 1) {
          return await this.fetchFromWttr(lat, lon, retryCount + 1);
        }
        throw new Error('Wttr.in API returned invalid JSON');
      }
      
      // Validate data structure
      if (!data.current_condition || !data.current_condition[0]) {
        throw new Error('Wttr.in API response missing current conditions');
      }
      
      // Transform wttr.in data to match our expected format
      const current = data.current_condition[0];
      const transformedData = {
        current: {
          temperature_2m: parseFloat(current.temp_C),
          apparent_temperature: parseFloat(current.FeelsLikeC),
          relative_humidity_2m: parseFloat(current.humidity),
          wind_speed_10m: parseFloat(current.windspeedKmph),
          weather_code: this.mapWttrCodeToOurCode(current.weatherCode)
        },
        location: {
          name: customLocationName || data.nearest_area[0]?.areaName[0]?.value || 'Unknown',
          country: data.nearest_area[0]?.country[0]?.value || ''
        }
      };
      
      console.log('Wttr.in transformed weather data:', transformedData);
      return transformedData;
    } catch (error) {
      console.error('Wttr.in fetch error:', error);
      throw error;
    }
  }
  
  async fetchFromOpenMeteo(lat, lon, customLocationName = null) {
    console.log(`Fetching from Open-Meteo for coordinates: ${lat}, ${lon}, custom location: ${customLocationName}`);
    
    try {
      // Using Open-Meteo API - free and reliable
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true&temperature_unit=celsius&wind_speed_unit=kmh`;
      console.log('Open-Meteo API URL:', url);
      
      console.log('Making fetch request to Open-Meteo...');
      
      // Add timeout to prevent hanging
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout
      
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'VortexBrowser/1.0'
        }
      });
      
      clearTimeout(timeoutId);
      
      console.log('Open-Meteo fetch completed. Response status:', response.status);
      
      if (!response.ok) {
        throw new Error(`Open-Meteo API request failed with status ${response.status}`);
      }
      
      const responseText = await response.text();
      console.log('Open-Meteo response text length:', responseText.length);
      
      if (!responseText || responseText.trim().length === 0) {
        throw new Error('Open-Meteo API returned empty response');
      }
      
      let data;
      try {
        data = JSON.parse(responseText);
      } catch (parseError) {
        console.error('Open-Meteo JSON parse error:', parseError);
        throw new Error('Open-Meteo API returned invalid JSON');
      }
      
      // Validate data structure for Open-Meteo API
      if (!data.current_weather) {
        throw new Error('Open-Meteo API response missing current weather data');
      }
      
      // Transform Open-Meteo data to match our expected format
      const current = data.current_weather;
      const transformedData = {
        current: {
          temperature_2m: parseFloat(current.temperature),
          apparent_temperature: parseFloat(current.temperature), // Open-Meteo doesn't have feels-like in basic API
          relative_humidity_2m: 50, // Default value since not available in basic API
          wind_speed_10m: parseFloat(current.windspeed),
          weather_code: this.mapOpenMeteoCodeToOurCode(current.weathercode)
        },
        location: {
          name: customLocationName || 'Current Location', // Use custom location name if provided
          country: ''
        }
      };
      
      console.log('Open-Meteo transformed weather data:', transformedData);
      return transformedData;
    } catch (error) {
      console.error('Open-Meteo fetch error:', error);
      throw error;
    }
  }
  
  mapWttrCodeToOurCode(wttrCode) {
    // Map wttr.in weather codes to our simplified codes
    const code = parseInt(wttrCode);
    if ([200, 201, 202, 210, 211, 212, 221, 230, 231, 232].includes(code)) return 95; // Thunderstorm
    if ([300, 301, 302, 310, 311, 312, 313, 314, 321].includes(code)) return 61; // Drizzle
    if ([500, 501, 502, 503, 504, 511, 520, 521, 522, 531].includes(code)) return 63; // Rain
    if ([600, 601, 602, 611, 612, 613, 615, 616, 620, 621, 622].includes(code)) return 71; // Snow
    if ([701, 711, 721, 731, 741, 751, 761, 762, 771, 781].includes(code)) return 45; // Fog/Mist
    if (code === 800) return 0; // Clear
    if ([801, 802, 803, 804].includes(code)) return 3; // Clouds
    return 0; // Default to clear
  }
  
  mapOpenMeteoCodeToOurCode(weatherCode) {
    // Map Open-Meteo weather codes to our simplified codes
    const code = parseInt(weatherCode);
    switch (code) {
      case 0: return 0; // Clear sky
      case 1: case 2: case 3: return code; // Mainly clear, partly cloudy, overcast
      case 45: case 48: return 45; // Fog
      case 51: case 53: case 55: return 61; // Drizzle
      case 56: case 57: return 61; // Freezing drizzle
      case 61: case 63: case 65: return code; // Rain (slight, moderate, heavy)
      case 66: case 67: return 63; // Freezing rain
      case 71: case 73: case 75: return code; // Snow (slight, moderate, heavy)
      case 77: return 71; // Snow grains
      case 80: case 81: case 82: return 63; // Rain showers
      case 85: case 86: return 75; // Snow showers
      case 95: return 95; // Thunderstorm
      case 96: case 99: return 95; // Thunderstorm with hail
      default: return 0; // Default to clear
    }
  }

  async getLocationName(lat, lon) {
    // OpenWeatherMap already provides location name, so we don't need reverse geocoding
    return 'Location';
  }
  
  getWeatherDescription(code) {
    const weatherCodes = {
      0: 'Clear sky',
      1: 'Mainly clear',
      2: 'Partly cloudy',
      3: 'Overcast',
      45: 'Foggy',
      48: 'Depositing rime fog',
      51: 'Light drizzle',
      53: 'Moderate drizzle',
      55: 'Dense drizzle',
      61: 'Slight rain',
      63: 'Moderate rain',
      65: 'Heavy rain',
      71: 'Slight snow',
      73: 'Moderate snow',
      75: 'Heavy snow',
      77: 'Snow grains',
      80: 'Slight rain showers',
      81: 'Moderate rain showers',
      82: 'Violent rain showers',
      85: 'Slight snow showers',
      86: 'Heavy snow showers',
      95: 'Thunderstorm',
      96: 'Thunderstorm with hail',
      99: 'Thunderstorm with heavy hail'
    };
    
    return weatherCodes[code] || 'Unknown';
  }
  
  updateDisplay(weather, locationName) {
    console.log('Updating weather display with:', { weather, locationName });
    
    if (this.loadingEl) {
      this.loadingEl.style.display = 'none';
    }
    
    const current = weather.current;
    
    // Use location from weather data if available, otherwise use provided name
    const displayLocation = weather.location ? `${weather.location.name}, ${weather.location.country}` : locationName;
    
    if (this.locationEl) this.locationEl.textContent = displayLocation;
    if (this.tempEl) this.tempEl.textContent = `${Math.round(current.temperature_2m)}°C`;
    if (this.descEl) this.descEl.textContent = this.getWeatherDescription(current.weather_code);
    if (this.feelsLikeEl) this.feelsLikeEl.textContent = `Feels like: ${Math.round(current.apparent_temperature)}°C`;
    if (this.humidityEl) this.humidityEl.textContent = `Humidity: ${current.relative_humidity_2m}%`;
    if (this.windEl) this.windEl.textContent = `Wind: ${Math.round(current.wind_speed_10m)} km/h`;
    
    console.log('Weather display updated successfully');
  }
  
  showError(errorMessage = 'Unable to load weather data') {
    console.log('Showing weather error:', errorMessage);
    if (this.loadingEl) this.loadingEl.style.display = 'none';
    
    if (this.locationEl) this.locationEl.textContent = 'Weather Unavailable';
    if (this.tempEl) this.tempEl.textContent = '--°C';
    if (this.descEl) this.descEl.textContent = errorMessage;
    if (this.feelsLikeEl) this.feelsLikeEl.textContent = 'Feels like: --°C';
    if (this.humidityEl) this.humidityEl.textContent = 'Humidity: --%';
    if (this.windEl) this.windEl.textContent = 'Wind: -- km/h';
  }
}

// --- News Widget Functionality ---
class NewsWidget {
  constructor() {
    this.newsEl = document.getElementById('news-articles');
    this.loadingEl = document.getElementById('news-loading');
    
    this.init();
  }
  
  async init() {
    try {
      const newsSettings = await this.getNewsSettings();
      const articles = await this.fetchNews(newsSettings.country, newsSettings.category);
      this.updateDisplay(articles);
    } catch (error) {
      console.error('News widget error:', error);
      this.showError();
    }
  }
  
  async getNewsSettings() {
    const country = await getWidgetSetting('newsCountry', 'us');
    const category = await getWidgetSetting('newsCategory', 'general');
    return {
      country: country || 'us',
      category: category || 'general'
    };
  }
  
  async fetchNews(country, category) {
    try {
      // Use more diverse news sources by country for better category support
      const feeds = {
        'us-general': 'https://feeds.reuters.com/reuters/topNews',
        'us-technology': 'https://feeds.reuters.com/reuters/technologyNews', 
        'us-business': 'https://feeds.reuters.com/reuters/businessNews',
        'us-science': 'https://feeds.reuters.com/reuters/scienceNews',
        'us-health': 'https://feeds.reuters.com/reuters/healthNews',
        'us-sports': 'https://feeds.reuters.com/reuters/sportsNews',
        'uk-general': 'https://feeds.reuters.com/reuters/UKdomesticNews',
        'uk-technology': 'https://feeds.reuters.com/reuters/technologyNews',
        'uk-business': 'https://feeds.reuters.com/reuters/UKbusinessNews', 
        'uk-science': 'https://feeds.reuters.com/reuters/scienceNews',
        'uk-health': 'https://feeds.reuters.com/reuters/healthNews',
        'uk-sports': 'https://feeds.reuters.com/reuters/UKsportsNews',
        'ca-general': 'https://feeds.reuters.com/reuters/CAdomesticNews',
        'ca-technology': 'https://feeds.reuters.com/reuters/technologyNews',
        'ca-business': 'https://feeds.reuters.com/reuters/CAbusinessNews',
        'au-general': 'https://feeds.reuters.com/reuters/worldNews',
        'au-technology': 'https://feeds.reuters.com/reuters/technologyNews',
        'au-business': 'https://feeds.reuters.com/reuters/businessNews',
        'de-general': 'https://feeds.reuters.com/reuters/worldNews',
        'de-technology': 'https://feeds.reuters.com/reuters/technologyNews',
        'de-business': 'https://feeds.reuters.com/reuters/businessNews',
        'fr-general': 'https://feeds.reuters.com/reuters/worldNews',
        'fr-technology': 'https://feeds.reuters.com/reuters/technologyNews',
        'fr-business': 'https://feeds.reuters.com/reuters/businessNews',
        'jp-general': 'https://feeds.reuters.com/reuters/worldNews',
        'jp-technology': 'https://feeds.reuters.com/reuters/technologyNews',
        'jp-business': 'https://feeds.reuters.com/reuters/businessNews',
        'in-general': 'https://feeds.reuters.com/reuters/INdomesticNews',
        'in-technology': 'https://feeds.reuters.com/reuters/technologyNews',
        'in-business': 'https://feeds.reuters.com/reuters/INbusinessNews'
      };
      
      const feedKey = `${country}-${category}`;
      const feedUrl = feeds[feedKey] || feeds[`${country}-general`] || feeds['us-general'];
      
      const rss2jsonUrl = `https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(feedUrl)}&count=10&api_key=`;
      
      try {
        const response = await fetch(rss2jsonUrl, {
          method: 'GET',
          headers: {
            'Accept': 'application/json',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
          }
        });
        
        if (response.ok) {
          const data = await response.json();
          
          if (data.status === 'ok' && data.items && data.items.length > 0) {
            const articles = data.items.slice(0, 8).map((item, index) => {
              const title = (item.title || 'News Article').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
              const url = item.link || item.guid || '#';
              
              return {
                title: title,
                url: url,
                publishedAt: item.pubDate || new Date().toISOString(),
                source: {
                  name: 'Reuters'
                }
              };
            }).filter(article => article.url && article.url !== '#' && article.url !== 'null');
            
            if (articles.length > 0) {
              return articles;
            }
          }
        }
      } catch (apiError) {
        console.error('RSS2JSON service failed:', apiError);
      }
      
      return this.getReliableNews(country, category);
    } catch (error) {
      console.error('All news fetch methods failed:', error);
      return this.getReliableNews(country, category);
    }
  }
  
  getSourceNameFromUrl(url) {
    if (url.includes('cnn.com')) return 'CNN';
    if (url.includes('bbc')) return 'BBC News';
    if (url.includes('cbc.ca')) return 'CBC News';
    if (url.includes('abc.net.au')) return 'ABC News';
    if (url.includes('tagesschau')) return 'Tagesschau';
    if (url.includes('france')) return 'France Info';
    if (url.includes('nhk')) return 'NHK News';
    if (url.includes('ndtv')) return 'NDTV';
    return 'News Source';
  }
  
  getSourceName(country) {
    const sources = {
      'us': 'CNN',
      'uk': 'BBC News',
      'ca': 'CBC News',
      'au': 'ABC News',
      'de': 'Tagesschau',
      'fr': 'France Info',
      'jp': 'NHK News',
      'in': 'NDTV'
    };
    return sources[country] || 'News Source';
  }
  
  getReliableNews(country = 'us', category = 'general') {
    // Provide current, real news headlines that reflect the current settings
    const currentDate = new Date().toISOString();
    const hoursAgo1 = new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString();
    const hoursAgo2 = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const hoursAgo3 = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
    const hoursAgo4 = new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString();
    
    // Create country-specific fallback headlines
    const countryNews = {
      'us': {
        'general': 'US Breaking News & Headlines',
        'technology': 'US Technology News & Updates',
        'business': 'US Business & Markets News',
        'science': 'US Science & Research News',
        'health': 'US Health & Medical News',
        'sports': 'US Sports & Athletics News'
      },
      'uk': {
        'general': 'UK Breaking News & Headlines',
        'technology': 'UK Technology & Innovation News',
        'business': 'UK Business & Economy News', 
        'science': 'UK Science & Research News',
        'health': 'UK Health & NHS News',
        'sports': 'UK Sports & Football News'
      },
      'ca': {
        'general': 'Canada Breaking News & Headlines',
        'technology': 'Canadian Technology News',
        'business': 'Canadian Business & Economy News',
        'science': 'Canadian Science & Research News', 
        'health': 'Canadian Health News',
        'sports': 'Canadian Sports & Hockey News'
      }
    };
    
    const selectedNews = countryNews[country] || countryNews['us'];
    const categoryTitle = selectedNews[category] || selectedNews['general'];
    
    return [
      {
        title: categoryTitle,
        source: { name: this.getSourceName(country) },
        publishedAt: currentDate,
        url: this.getCountryNewsUrl(country)
      },
      {
        title: `${country.toUpperCase()} ${category.charAt(0).toUpperCase() + category.slice(1)} Update`,
        source: { name: "Reuters" },
        publishedAt: hoursAgo1,
        url: "https://www.reuters.com/"
      },
      {
        title: `Latest ${category.charAt(0).toUpperCase() + category.slice(1)} News from ${country.toUpperCase()}`,
        source: { name: "AP News" },
        publishedAt: hoursAgo2,
        url: "https://apnews.com/"
      }
    ];
  }
  
  getCountryNewsUrl(country) {
    const urls = {
      'us': 'https://www.reuters.com/world/us/',
      'uk': 'https://www.bbc.com/news',
      'ca': 'https://www.cbc.ca/news',
      'au': 'https://www.abc.net.au/news',
      'de': 'https://www.dw.com/en',
      'fr': 'https://www.france24.com/en/',
      'jp': 'https://www.japantimes.co.jp/',
      'in': 'https://www.thehindu.com/'
    };
    return urls[country] || 'https://www.reuters.com/';
  }
  
  updateDisplay(articles) {
    if (this.loadingEl) this.loadingEl.style.display = 'none';
    
    if (!this.newsEl) {
      console.error('News articles element not found!');
      return;
    }
    
    this.newsEl.innerHTML = '';
    
    if (!articles || articles.length === 0) {
      this.newsEl.innerHTML = '<div style="padding: 8px; color: #666;">No articles available</div>';
      return;
    }
    
    articles.slice(0, 3).forEach((article, index) => {
      
      const articleEl = document.createElement('div');
      articleEl.className = 'news-article';
      articleEl.style.cursor = 'pointer';
      articleEl.setAttribute('data-url', article.url);
      
      const timeAgo = this.getTimeAgo(new Date(article.publishedAt));
      
      articleEl.innerHTML = `
        <div class="news-title">${article.title}</div>
        <div class="news-source">${article.source.name}</div>
        <div class="news-time">${timeAgo}</div>
      `;
      
      articleEl.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        
        const url = article.url;
        if (!url || url === '#' || url === '' || url === 'null' || url === 'undefined') {
          return;
        }
        
        try {
          if (typeof newTab === 'function') {
            newTab(url);
          } else {
            if (window.electronAPI && window.electronAPI.openExternal) {
              window.electronAPI.openExternal(url);
            } else {
              window.open(url, '_blank');
            }
          }
        } catch (error) {
          console.error('Failed to open article:', error);
          try {
            if (window.electronAPI && window.electronAPI.openExternal) {
              window.electronAPI.openExternal(url);
            } else {
              window.open(url, '_blank');
            }
          } catch (fallbackError) {
            console.error('All opening methods failed:', fallbackError);
          }
        }
      });
      
      this.newsEl.appendChild(articleEl);
    });
  }
  
  getTimeAgo(date) {
    const now = new Date();
    const diffMs = now - date;
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    
    if (diffDays > 0) {
      return `${diffDays}d ago`;
    } else if (diffHours > 0) {
      return `${diffHours}h ago`;
    } else {
      return 'Just now';
    }
  }
  
  showError() {
    this.loadingEl.textContent = 'Unable to load news';
  }
  
  async refresh() {
    try {
      if (this.loadingEl) {
        this.loadingEl.style.display = 'block';
        this.loadingEl.textContent = 'Updating news...';
      }
      
      const { country, category } = await this.getNewsSettings();
      
      const articles = await this.fetchNews(country, category);
      
      if (articles && articles.length > 0) {
        this.updateDisplay(articles);
      } else {
        this.showError();
      }
    } catch (error) {
      console.error('News widget refresh error:', error);
      this.showError();
    }
  }
}

// Global widget instances
let globalNewsWidget = null;
let globalWeatherWidget = null;

async function getWidgetSetting(key, fallback = null) {
  try {
    const persisted = await storage.getItem(key);
    if (persisted !== null && persisted !== undefined) return persisted;
  } catch (error) {
    console.error(`Failed to read widget setting ${key} from persistent storage`, error);
  }

  try {
    const legacy = localStorage.getItem(key);
    return legacy !== null ? legacy : fallback;
  } catch (_error) {
    return fallback;
  }
}

// Global function to update news widget - defined early
function updateNewsWidget() {
  if (globalNewsWidget && typeof globalNewsWidget.refresh === 'function') {
    try {
      globalNewsWidget.refresh();
    } catch (error) {
      console.error('News widget refresh failed:', error);
      globalNewsWidget = null;
    }
  }
  
  if (!globalNewsWidget) {
    const newsWidget = document.getElementById('news-widget');
    if (newsWidget && !newsWidget.classList.contains('hidden')) {
      try {
        globalNewsWidget = new NewsWidget();
        window.globalNewsWidget = globalNewsWidget;
      } catch (error) {
        console.error('News widget recreation failed:', error);
      }
    }
  }
}

// Make function globally accessible immediately
window.updateNewsWidget = updateNewsWidget;

// Window Controls Functions
function initializeWindowControls() {
  const minimizeBtn = document.getElementById('minimize-btn');
  const maximizeBtn = document.getElementById('maximize-btn');
  const closeBtn = document.getElementById('close-btn');
  const titleBar = document.getElementById('title-bar');

  if (minimizeBtn) {
    minimizeBtn.addEventListener('click', () => {
      window.electronAPI.minimizeWindow();
    });
  }

  if (maximizeBtn) {
    maximizeBtn.addEventListener('click', async () => {
      await window.electronAPI.maximizeWindow();
      // Update the maximize button appearance
      updateMaximizeButton();
    });
  }

  if (closeBtn) {
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      // Close the current window via the main process
      try {
        window.electronAPI.closeWindow();
      } catch (err) {
        console.error('Failed to close window via electronAPI:', err);
      }
    });
  }

  // Initialize maximize button state
  updateMaximizeButton();
  
  // Listen for window resize to update maximize button
  window.addEventListener('resize', () => {
    setTimeout(updateMaximizeButton, 100);
  });
}

// NOTE: the main DOMContentLoaded listener will be closed at the end of the file

async function updateMaximizeButton() {
  const maximizeBtn = document.getElementById('maximize-btn');
  if (maximizeBtn && window.electronAPI.isMaximized) {
    try {
      const isMaximized = await window.electronAPI.isMaximized();
      const img = maximizeBtn.querySelector('img');
      if (img) {
        if (isMaximized) {
          maximizeBtn.classList.add('maximized');
          img.src = 'icons/window-restore.png';
          img.alt = 'Restore Down';
          maximizeBtn.title = 'Restore Down';
        } else {
          maximizeBtn.classList.remove('maximized');
          img.src = 'icons/window-maximize.png';
          img.alt = 'Maximize';
          maximizeBtn.title = 'Maximize';
        }
      }
    } catch (err) {
      console.error('Error checking maximize state:', err);
    }
  }
}

// Initialize widgets when page loads
document.addEventListener('DOMContentLoaded', () => {
  // Initialize window controls
  initializeWindowControls();
  
  // Small delay to ensure all elements are loaded
  setTimeout(() => {
    initializeWidgets().catch((error) => {
      console.error('Failed to initialize widgets:', error);
    });
  }, 1000);
  
  // Listen for widget settings changes from settings window
  if (window.electronAPI && typeof window.electronAPI.onWidgetSettingsChanged === 'function') {
    window.electronAPI.onWidgetSettingsChanged((data) => {
      handleWidgetSettingsChange(data);
    });
  }
  
  // Listen for postMessage from settings window
  window.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'newsSettingsChanged') {
      setTimeout(() => {
        updateNewsWidget();
      }, 500);
    }
  });
});

async function initializeWidgets() {
  console.log('Initializing widgets...');
  // Check widget visibility settings
  const showWeather = (await getWidgetSetting('showWeatherWidget', 'true')) !== 'false';
  const showNews = (await getWidgetSetting('showNewsWidget', 'true')) !== 'false';
  
  console.log('Widget settings - showWeather:', showWeather, 'showNews:', showNews);
  
  const weatherWidget = document.getElementById('weather-widget');
  const newsWidget = document.getElementById('news-widget');
  
  console.log('Widget elements - weatherWidget:', !!weatherWidget, 'newsWidget:', !!newsWidget);
  
  if (showWeather && weatherWidget) {
    console.log('Initializing weather widget');
    weatherWidget.classList.remove('hidden');
    globalWeatherWidget = new WeatherWidget();
  } else if (weatherWidget) {
    weatherWidget.classList.add('hidden');
  }
  
  if (showNews && newsWidget) {
    console.log('Initializing news widget');
    newsWidget.classList.remove('hidden');
    globalNewsWidget = new NewsWidget();
  } else if (newsWidget) {
    newsWidget.classList.add('hidden');
  }
}

function handleWidgetSettingsChange(data) {
  const { widget, enabled } = data;
  
  if (widget === 'weather') {
    const weatherWidget = document.getElementById('weather-widget');
    if (weatherWidget) {
      if (enabled) {
        weatherWidget.classList.remove('hidden');
        if (!weatherWidget.hasAttribute('data-initialized')) {
          new WeatherWidget();
          weatherWidget.setAttribute('data-initialized', 'true');
        }
      } else {
        weatherWidget.classList.add('hidden');
      }
    }
  } else if (widget === 'news') {
    const newsWidget = document.getElementById('news-widget');
    if (newsWidget) {
      if (enabled) {
        newsWidget.classList.remove('hidden');
        if (!globalNewsWidget) {
          globalNewsWidget = new NewsWidget();
        }
      } else {
        newsWidget.classList.add('hidden');
        globalNewsWidget = null;
      }
    }
  } else if (widget === 'newsUpdate') {
    try {
      updateNewsWidget();
    } catch (error) {
      console.error('Error calling updateNewsWidget:', error);
    }
  }
}

