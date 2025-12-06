window.addEventListener('DOMContentLoaded', () => {
  console.log('DOM loaded, initializing...');
  
  // --- State ---
  let tabs = JSON.parse(localStorage.getItem('tabs') || '[]');
  if (!tabs.length) tabs = [{ id: Date.now(), url: 'newtab', history: [], historyIndex: -1 }];
  let currentTabId = parseInt(localStorage.getItem('currentTabId') || (tabs.length > 0 ? tabs[0].id : null), 10);
  let bookmarks = JSON.parse(localStorage.getItem('bookmarks') || '[]');
  let homepage = localStorage.getItem('homepage') || 'https://www.google.com';
  let quickLinks = JSON.parse(localStorage.getItem('quickLinks') || '[]');
  
  console.log('State loaded - tabs:', tabs.length, 'bookmarks:', bookmarks.length);
  
  // --- Auto-Updater Communication ---
  if (window.electronAPI) {
    // Listen for update events
    window.electronAPI.onUpdateChecking(() => {
      console.log('Checking for updates...');
      showUpdateNotification('Checking for updates...', 'info');
    });

    window.electronAPI.onUpdateAvailable((info) => {
      console.log('Update available:', info);
      showUpdateNotification(`Update available: v${info.version}. Downloading...`, 'success');
    });

    window.electronAPI.onUpdateNotAvailable(() => {
      console.log('No updates available');
      showUpdateNotification('You have the latest version!', 'info', 3000);
    });

    window.electronAPI.onUpdateError((message) => {
      console.error('Update error:', message);
      showUpdateNotification(`Update error: ${message}`, 'error');
    });

    window.electronAPI.onUpdateDownloadProgress((progress) => {
      const percent = Math.round(progress.percent);
      showUpdateNotification(`Downloading update: ${percent}%`, 'info');
    });

    window.electronAPI.onUpdateDownloaded((info) => {
      console.log('Update downloaded:', info);
      showUpdateNotification(
        `Update v${info.version} ready to install. Click to restart and install.`,
        'success',
        0,
        () => window.electronAPI.installUpdate()
      );
    });
  }
  
  // Listen for weather update messages
  window.addEventListener('message', (event) => {
    if (event.data.type === 'weatherLocationChanged') {
      console.log('Received weather location change message:', event.data.location);
      window.updateWeatherWidget();
    } else if (event.data.type === 'newsSettingsChanged') {
      console.log('Received news settings change message');
      window.updateNewsWidget();
    }
  });

  // --- DOM Elements ---
  const urlInput = document.getElementById('url');
  const backBtn = document.getElementById('back');
  const forwardBtn = document.getElementById('forward');
  const bookmarkAddBtn = document.getElementById('bookmark-add');
  const bookmarkBar = document.getElementById('bookmark-bar');
  const tabsDiv = document.getElementById('tabs');
  const setHomeBtn = document.getElementById('set-home');
  const newTabPage = document.getElementById('newtab');
  const quickLinksDiv = document.getElementById('quick-links');
  const reloadBtn = document.getElementById('reload');
  const settingsBtn = document.getElementById('settings');
  const controlsDiv = document.getElementById('controls'); // Add controls div reference

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
  function getFavicon(url) {
    try {
      if (url === 'newtab') {
        return 'icons/newtab.png';
      }
      const u = new URL(url);
      return `https://icons.duckduckgo.com/ip3/${u.hostname}.ico`;
    } catch {
      return 'icons/newtab.png';
    }
  }

  function showUpdateNotification(message, type = 'info', duration = 5000, clickHandler = null) {
    // Remove any existing update notification
    const existingNotification = document.querySelector('.update-notification');
    if (existingNotification) {
      existingNotification.remove();
    }

    // Create notification element
    const notification = document.createElement('div');
    notification.className = `update-notification update-${type}`;
    notification.innerHTML = `
      <div class="update-notification-content">
        <span class="update-message">${message}</span>
        <button class="update-close" onclick="this.parentElement.parentElement.remove()">×</button>
      </div>
    `;

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

    // Check if current tab is a settings page
    const isSettingsPage = tab.url && tab.url.includes('settings.html');
    
    // Hide/show URL bar based on whether it's a settings page
    if (controlsDiv) {
      controlsDiv.style.display = isSettingsPage ? 'none' : 'flex';
    }

    if (tab.url === 'newtab') {
      window.electronAPI.viewHide();
      newTabPage.classList.add('active');
      urlInput.value = '';
      // Update button states based on history, even for newtab
      backBtn.disabled = tab.historyIndex <= 0;
      forwardBtn.disabled = tab.historyIndex >= tab.history.length - 1;
    } else {
      window.electronAPI.viewShow(tab.id);
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
    tabsDiv.innerHTML = '';
    tabs.forEach((tab) => {
      const tabEl = document.createElement('div');
      let tabClass = 'tab' + (tab.id === currentTabId ? ' active' : '');
      if (tab.isIncognito) {
        tabClass += ' incognito';
      }
      tabEl.className = tabClass;
      
      const favicon = document.createElement('img');
      favicon.src = getFavicon(tab.url);
      favicon.style.width = '16px';
      favicon.style.height = '16px';
      favicon.onerror = function() { this.src = 'icons/newtab.png'; };
      tabEl.appendChild(favicon);

      const titleSpan = document.createElement('span');
      let displayTitle;
      if (tab.url === 'newtab') {
        displayTitle = tab.isIncognito ? 'New Tab (Incognito)' : 'New Tab';
      } else {
        const baseTitle = (tab.title || tab.url).substring(0, 20) + '...';
        displayTitle = tab.isIncognito ? `${baseTitle} (Incognito)` : baseTitle;
      }
      titleSpan.textContent = displayTitle;
      tabEl.appendChild(titleSpan);

      const closeBtn = document.createElement('div');
      closeBtn.className = 'close';
      closeBtn.textContent = '×';
      closeBtn.onclick = (e) => {
        e.stopPropagation();
        closeTab(tab.id);
      };
      tabEl.appendChild(closeBtn);

      tabEl.onclick = () => switchTab(tab.id);
      tabsDiv.appendChild(tabEl);
    });
    const newTabBtn = document.createElement('button');
    newTabBtn.id = 'new-tab-btn';
    newTabBtn.textContent = '+';
    newTabBtn.onclick = () => newTab();
    tabsDiv.appendChild(newTabBtn);
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
            window.electronAPI.viewNavigate({ id: tab.id, url });
        } else {
            tab.history = tab.history.slice(0, tab.historyIndex + 1);
            tab.history.push(url);
            tab.historyIndex++;
        }
        tab.url = url;
    } else {
        // This is creating a new tab
        const newTabId = Date.now();
        tabs.push({ id: newTabId, url, history: [url], historyIndex: 0 });
        currentTabId = newTabId;
        window.electronAPI.viewCreate(newTabId);
        if (url !== 'newtab') {
          window.electronAPI.viewNavigate({ id: newTabId, url });
        }
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
      new WeatherWidget();
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

    window.electronAPI.viewDestroy(id);
    tabs.splice(tabIndex, 1);

    if (currentTabId === id) {
      currentTabId = tabs.length > 0 ? (tabs[tabIndex] ? tabs[tabIndex].id : tabs[tabs.length - 1].id) : null;
    }
    persistTabs();
    updateView();
    renderTabs();
  }

  function persistTabs() {
    localStorage.setItem('tabs', JSON.stringify(tabs));
    localStorage.setItem('currentTabId', currentTabId);
  }

  // --- Navigation ---
  function navigate(input) {
    let url = input.trim();
    
    // Check if it's already a complete URL
    if (/^https?:\/\//i.test(url)) {
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
      // Treat as search query
      const searchEngine = localStorage.getItem('searchEngine') || 'google';
      const searchUrls = {
        google: 'https://www.google.com/search?q=',
        bing: 'https://www.bing.com/search?q=',
        duckduckgo: 'https://duckduckgo.com/?q='
      };
      url = searchUrls[searchEngine] + encodeURIComponent(url);
    }
    
    const tab = tabs.find(t => t.id === currentTabId);
    if (tab) {
      // Always navigate in current tab, regardless of current URL
      tab.url = url;
      tab.history = tab.history || [];
      
      // Add to history if it's different from current
      if (tab.history[tab.historyIndex] !== url) {
        tab.history = tab.history.slice(0, tab.historyIndex + 1);
        tab.history.push(url);
        tab.historyIndex = tab.history.length - 1;
      }
      
      window.electronAPI.viewNavigate({ id: tab.id, url });
      persistTabs();
      updateView();
    }
  }

  urlInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') navigate(urlInput.value);
  });

  // --- Back/Forward Button Logic ---
  backBtn.onclick = () => {
    const tab = tabs.find(t => t.id === currentTabId);
    if (tab.historyIndex > 0) {
      tab.historyIndex--;
      tab.url = tab.history[tab.historyIndex];
      window.electronAPI.viewNavigate({ id: tab.id, url: tab.url });
      persistTabs();
      updateView();
    }
  };

  forwardBtn.onclick = () => {
    const tab = tabs.find(t => t.id === currentTabId);
    if (tab.historyIndex < tab.history.length - 1) {
      tab.historyIndex++;
      tab.url = tab.history[tab.historyIndex];
      window.electronAPI.viewNavigate({ id: tab.id, url: tab.url });
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
  const checkUpdatesBtn = document.getElementById('check-updates');
  
  // Settings button click handler
  if (settingsBtn) {
    settingsBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      openSettingsPanel();
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

  // All Settings button click handler
  if (allSettingsBtn) {
    allSettingsBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      // Open settings page in a new tab instead of a new window
      const settingsPath = window.location.protocol + '//' + window.location.host + window.location.pathname.replace('index.html', 'settings.html');
      newTab(settingsPath);
      closeSettingsPanel(); // Close the settings panel when opening full settings
    });
  }
  
  // Close settings button click handler
  if (closeSettingsBtn) {
    closeSettingsBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      closeSettingsPanel();
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
      localStorage.setItem('homepage', homepage);
      
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
    overlay.addEventListener('click', closeSettingsPanel);
  }
  
  // Open the settings panel
  function openSettingsPanel() {
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
    
    const adblockToggle = document.getElementById('adblock-toggle');
    if (adblockToggle) {
      adblockToggle.checked = localStorage.getItem('adblockEnabled') === 'true';
    }
    
    const userAgentInput = document.getElementById('user-agent-input');
    if (userAgentInput) {
      userAgentInput.value = localStorage.getItem('userAgent') || '';
    }

    // Hide BrowserView so settings panel overlays correctly
    window.electronAPI.viewHide();

    // Apply current theme to settings panel
    const currentTheme = localStorage.getItem('theme') || 'light';
    settingsPanel.classList.add('theme-' + currentTheme);

    // First, make the panel visible but keep it off-screen
    // This ensures it's in the DOM and rendered
    settingsPanel.style.visibility = 'visible';
    overlay.style.visibility = 'visible';
    
    // Force a reflow to ensure styles are applied
    void settingsPanel.offsetWidth;
    
    // Now add the active class to trigger the animation
    settingsPanel.classList.add('active');
    overlay.classList.add('active');
    
    // Prevent scrolling of the main content while settings are open
    document.body.style.overflow = 'hidden';
    
    // For extra safety, move the settings panel and overlay to the end of body
    // This sometimes helps with z-index stacking contexts
    document.body.appendChild(overlay);
    document.body.appendChild(settingsPanel);
  }
  
  // Close the settings panel
  function closeSettingsPanel() {
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

      // Show BrowserView again if not on newtab page
      const tab = tabs.find(t => t.id === currentTabId);
      if (tab && tab.url !== 'newtab') {
        window.electronAPI.viewShow(tab.id);
      }
    }, 300);
  }
  
  // Handle escape key to close the panel (prevent duplicate listeners)
  if (!document.escapeKeyListenerAdded) {
    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape') {
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
    bookmarkBar.innerHTML = '';
    bookmarks.forEach((b, index) => {
      const btn = document.createElement('button');
      btn.className = 'bookmark-btn';
      btn.onclick = () => {
        const tab = tabs.find(t => t.id === currentTabId);
        const url = b.url || b;
        
        if (tab) {
          // Navigate in current tab
          if (!/^https?:\/\//i.test(url)) {
            url = 'http://' + url;
          }
          tab.url = url;
          tab.history = tab.history || [];
          tab.history.push(url);
          tab.historyIndex = tab.history.length - 1;
          
          window.electronAPI.viewNavigate({ id: tab.id, url: url });
          persistTabs();
          updateView();
        }
      };

      const favicon = document.createElement('img');
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

      bookmarkBar.appendChild(btn);
    });
  }

  function deleteBookmark(index) {
      bookmarks.splice(index, 1);
      localStorage.setItem('bookmarks', JSON.stringify(bookmarks));
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
      localStorage.setItem('bookmarks', JSON.stringify(bookmarks));
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
        
        window.electronAPI.viewNavigate({ id: tab.id, url: url });
        persistTabs();
        updateView();
      }
    }
  };

  // --- BrowserView Events ---
  window.electronAPI.onViewNavigated(({ id, url }) => {
    const tab = tabs.find(t => t.id === id);
    if (!tab) return;

    tab.url = url;
    if (tab.history[tab.historyIndex] !== url) {
      tab.history.push(url);
      tab.historyIndex++;
    }
    if (id === currentTabId) {
      urlInput.value = url;
    }
    persistTabs();
    renderTabs(); // Update tab title/favicon
  });

  // Listen for the main process to request a new tab
  window.electronAPI.onOpenInNewTab((url) => {
    newTab(url);
  });

  // This is a new window. Clear old state and load the URL.
  window.electronAPI.onNewWindow((url) => {
      // Clear the tab state from the previous window
      localStorage.removeItem('tabs');
      localStorage.removeItem('currentTabId');

      // Re-initialize state for the new window
      const newTabId = Date.now();
      tabs = [{ id: newTabId, url: url, history: [url], historyIndex: 0 }];
      currentTabId = newTabId;
      
      // Persist the new state and update the UI
      persistTabs();
      window.electronAPI.viewCreate(newTabId);
      window.electronAPI.viewNavigate({ id: newTabId, url });
      updateView();
      renderTabs();
  });

  // --- Quick Links ---
  function renderQuickLinks() {
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
        localStorage.setItem('quickLinks', JSON.stringify(quickLinks));
        renderQuickLinks();
      };
      ql.appendChild(closeBtn);

      const favicon = document.createElement('img');
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
          alert("URL is required.");
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
        localStorage.setItem('quickLinks', JSON.stringify(quickLinks));
        renderQuickLinks();
        newQuickLinkUrlInput.value = '';
        newQuickLinkLabelInput.value = '';
        addQuickLinkModal.style.display = 'none';
      } else {
        alert("This quick link already exists.");
      }
    };
  }

  // Reload button logic
  reloadBtn.onclick = () => {
    const tab = tabs.find(t => t.id === currentTabId);
    if (tab && tab.url !== 'newtab') {
      window.electronAPI.viewReload(tab.id);
    }
  };

  // --- Initial Render ---
  // Create all views first, but don't navigate or show them yet.
  tabs.forEach(tab => {
    window.electronAPI.viewCreate(tab.id);
  });

  // After a short delay to ensure views are created, navigate and update the UI.
  setTimeout(() => {
    tabs.forEach(tab => {
      if (tab.url !== 'newtab') {
        window.electronAPI.viewNavigate({ id: tab.id, url: tab.url });
      }
    });
    renderTabs();
    updateView();
  }, 100); // A small delay can help prevent race conditions on startup.

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
    localStorage.setItem('theme', themeClassName);
    applyTheme(themeClassName);
    
    // Update the sidebar theme dropdown if it exists
    const themeSelect = document.getElementById('theme-select');
    if (themeSelect) {
      themeSelect.value = themeClassName;
      console.log('Updated theme dropdown to:', themeClassName);
    } else {
      console.log('Theme dropdown not found');
    }
  });

  // Apply the initial theme on load
  const initialTheme = localStorage.getItem('theme') || 'theme-light';
  applyTheme(initialTheme);

  // Update theme select handler in the slide-out panel
  const themeSelect = document.getElementById('theme-select');
  if (themeSelect) {
    themeSelect.value = initialTheme;
    themeSelect.onchange = () => {
      const themeClassName = themeSelect.value;
      localStorage.setItem('theme', themeClassName);
      applyTheme(themeClassName);
      // Also broadcast this change to other windows
      window.electronAPI.broadcastThemeChange(themeClassName);
    };
  }

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
    bookmarkBar.style.display = showBookmarksBar.checked ? 'flex' : 'none';
    showBookmarksBar.onchange = () => {
      localStorage.setItem('showBookmarksBar', showBookmarksBar.checked);
      bookmarkBar.style.display = showBookmarksBar.checked ? 'flex' : 'none';
    };
  }

  // Clear browsing data
  const clearDataBtn = document.getElementById('clear-data-btn');
  if (clearDataBtn) {
    clearDataBtn.onclick = () => {
      localStorage.clear();
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
      
      // Create the actual BrowserView for the incognito tab
      window.electronAPI.viewCreate(incognitoTabId);
      
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
        window.electronAPI.viewCreate(tabToReopen.id);
        if (tabToReopen.url !== 'newtab') {
          window.electronAPI.viewNavigate({ id: tabToReopen.id, url: tabToReopen.url });
        }
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
      alert('Bookmark folders management coming soon!');
    };
  }

  // --- Download Manager ---
  let downloads = JSON.parse(localStorage.getItem('downloads') || '[]');

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
    localStorage.setItem('downloads', JSON.stringify(downloads));
  });

  window.electronAPI.onDownloadProgress && window.electronAPI.onDownloadProgress((data) => {
    const download = downloads.find(d => d.name === data.name);
    if (download) {
      download.progress = data.progress;
      localStorage.setItem('downloads', JSON.stringify(downloads));
    }
  });

  window.electronAPI.onDownloadCompleted && window.electronAPI.onDownloadCompleted((data) => {
    const download = downloads.find(d => d.name === data.name);
    if (download) {
      download.state = data.state;
      download.savePath = data.savePath;
      localStorage.setItem('downloads', JSON.stringify(downloads));
    }
  });

  // Show downloads modal
  function showDownloadsModal() {
    let modal = document.getElementById('downloads-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'downloads-modal';
      modal.className = 'modal';
      modal.style.zIndex = '2147483648'; // Ensure it's above settings panel
      modal.innerHTML = `
        <div class="modal-content" style="z-index: 2147483649;">
          <span class="close-button">&times;</span>
          <h2>Downloads</h2>
          <div id="downloads-list"></div>
        </div>
      `;
      document.body.appendChild(modal);
      modal.querySelector('.close-button').onclick = () => {
        modal.style.display = 'none';
      };
      
      // Close modal when clicking outside
      modal.onclick = (e) => {
        if (e.target === modal) {
          modal.style.display = 'none';
        }
      };
    }
    
    // Apply current theme to modal
    const currentTheme = localStorage.getItem('theme') || 'light';
    modal.classList.remove('theme-light', 'theme-dark');
    modal.classList.add('theme-' + currentTheme);
    const modalContent = modal.querySelector('.modal-content');
    if (modalContent) {
      modalContent.classList.remove('theme-light', 'theme-dark');
      modalContent.classList.add('theme-' + currentTheme);
    }
    
    // Populate downloads
    const downloads = JSON.parse(localStorage.getItem('downloads') || '[]');
    const list = modal.querySelector('#downloads-list');
    
    if (downloads.length === 0) {
      list.innerHTML = '<p style="text-align: center; padding: 20px; color: inherit;">No downloads yet.</p>';
    } else {
      list.innerHTML = downloads.map(d => `
        <div class="download-item">
          <div class="download-name">${d.name}</div>
          <div class="download-progress">
            <div class="progress-bar">
              <div class="progress-fill" style="width: ${(d.progress * 100)}%"></div>
            </div>
            <span class="progress-text">${d.state === 'completed' ? 'Completed' : Math.round(d.progress * 100) + '%'}</span>
          </div>
          ${d.savePath ? `<div class="download-path">${d.savePath}</div>` : ''}
        </div>
      `).join('');
    }
    
    // Ensure modal appears above everything
    modal.style.display = 'block';
    modal.style.position = 'fixed';
    modal.style.top = '0';
    modal.style.left = '0';
    modal.style.width = '100vw';
    modal.style.height = '100vh';
  }

  const showDownloadsBtn = document.getElementById('show-downloads-btn');
  if (showDownloadsBtn) {
    showDownloadsBtn.onclick = showDownloadsModal;
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
      alert('User agent saved! Restart the browser to apply changes.');
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
        alert('Session restored!');
      } else {
        alert('No previous session found.');
      }
    };
  }

  // Save session on unload
  window.addEventListener('beforeunload', () => {
    localStorage.setItem('lastSessionTabs', JSON.stringify(tabs));
    localStorage.setItem('lastCurrentTabId', currentTabId.toString());
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
        window.electronAPI.viewCreate(tabToReopen.id);
        if (tabToReopen.url !== 'newtab') {
          window.electronAPI.viewNavigate({ id: tabToReopen.id, url: tabToReopen.url });
        }
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
        window.electronAPI.viewReload(tab.id);
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
        window.electronAPI.viewReload(tab.id);
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

  // Listen for page title updates
  window.electronAPI.onPageTitleUpdated && window.electronAPI.onPageTitleUpdated(({ id, title }) => {
    const tab = tabs.find(t => t.id === id);
    if (tab && tab.url !== 'newtab') {
      tab.title = title;
      persistTabs();
      renderTabs();
    }
  });
});

// --- Weather Widget Functionality ---
class WeatherWidget {
  constructor() {
    console.log('Creating WeatherWidget instance at:', new Date().toLocaleTimeString());
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
      
      const position = await this.getLocationForWeather();
      const weather = await this.fetchWeather(position.latitude, position.longitude);
      const locationName = position.customName || await this.getLocationName(position.latitude, position.longitude);
      
      this.updateDisplay(weather, locationName);
    } catch (error) {
      console.error('Weather widget init error:', error);
      this.showError(error.message);
    }
  }

  async getLocationForWeather() {
    try {
      // Check if manual location is enabled and set
      const useAutoLocation = localStorage.getItem('useAutoLocation');
      const customLocation = localStorage.getItem('weatherLocation');
      const storedCoords = localStorage.getItem('weatherCoords');
      
      console.log('Weather location check:');
      console.log('- useAutoLocation:', useAutoLocation);
      console.log('- customLocation:', customLocation);
      console.log('- storedCoords:', storedCoords);
      
      if (useAutoLocation === 'false' && customLocation && customLocation.trim()) {
        console.log('Using manual weather location:', customLocation);
        
        // Use stored coordinates if available, otherwise geocode
        if (storedCoords) {
          try {
            const coords = JSON.parse(storedCoords);
            console.log('Using stored coordinates:', coords);
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
        console.log('Geocoding location:', customLocation);
        const coordinates = await this.geocodeLocation(customLocation);
        return { ...coordinates, customName: customLocation };
      }
      
      // Use automatic location detection
      console.log('Using automatic location detection');
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
  
  async fetchWeather(lat, lon) {
    console.log(`Fetching weather for coordinates: ${lat}, ${lon}`);
    
    try {
      // Using wttr.in API - completely free, no API key needed
      const url = `https://wttr.in/${lat},${lon}?format=j1`;
      console.log('Weather API URL:', url);
      
      const response = await fetch(url);
      console.log('Weather API response status:', response.status);
      
      if (!response.ok) {
        throw new Error(`Weather API request failed with status ${response.status}`);
      }
      
      const data = await response.json();
      console.log('Weather API response data:', data);
      
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
          name: data.nearest_area[0]?.areaName[0]?.value || 'Unknown',
          country: data.nearest_area[0]?.country[0]?.value || ''
        }
      };
      
      console.log('Transformed weather data:', transformedData);
      return transformedData;
    } catch (error) {
      console.error('Weather fetch error:', error);
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
      const newsSettings = this.getNewsSettings();
      const articles = await this.fetchNews(newsSettings.country, newsSettings.category);
      this.updateDisplay(articles);
    } catch (error) {
      console.error('News widget error:', error);
      this.showError();
    }
  }
  
  getNewsSettings() {
    return {
      country: localStorage.getItem('newsCountry') || 'us',
      category: localStorage.getItem('newsCategory') || 'general'
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
      
      return this.getReliableNews();
    } catch (error) {
      console.error('All news fetch methods failed:', error);
      return this.getReliableNews();
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
  
  getReliableNews() {
    // Provide current, real news headlines that reflect the current settings
    const currentDate = new Date().toISOString();
    const hoursAgo1 = new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString();
    const hoursAgo2 = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const hoursAgo3 = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
    const hoursAgo4 = new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString();
    
    const country = localStorage.getItem('newsCountry') || 'us';
    const category = localStorage.getItem('newsCategory') || 'general';
    
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
      
      const country = localStorage.getItem('newsCountry') || 'us';
      const category = localStorage.getItem('newsCategory') || 'general';
      
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

// Initialize widgets when page loads
document.addEventListener('DOMContentLoaded', () => {
  // Small delay to ensure all elements are loaded
  setTimeout(() => {
    initializeWidgets();
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

function initializeWidgets() {
  console.log('Initializing widgets...');
  // Check widget visibility settings
  const showWeather = localStorage.getItem('showWeatherWidget') !== 'false';
  const showNews = localStorage.getItem('showNewsWidget') !== 'false';
  
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
  } else if (widget === 'weatherLocation') {
    // Reload weather when location settings change
    console.log('Weather location change detected');
    const weatherWidget = document.getElementById('weather-widget');
    if (weatherWidget && !weatherWidget.classList.contains('hidden')) {
      console.log('Reloading weather widget with new location');
      // Simply create a new weather widget instance
      new WeatherWidget();
    }
  }
}



// Also add to global scope for debugging
window.globalNewsWidget = globalNewsWidget;
window.globalWeatherWidget = globalWeatherWidget;
