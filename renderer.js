window.addEventListener('DOMContentLoaded', () => {
  // --- State ---
  let tabs = JSON.parse(localStorage.getItem('tabs') || '[]');
  if (!tabs.length) tabs = [{ id: Date.now(), url: 'newtab', history: [], historyIndex: -1 }];
  let currentTabId = parseInt(localStorage.getItem('currentTabId') || (tabs.length > 0 ? tabs[0].id : null), 10);
  let bookmarks = JSON.parse(localStorage.getItem('bookmarks') || '[]');
  let homepage = localStorage.getItem('homepage') || 'https://www.example.com';
  let quickLinks = JSON.parse(localStorage.getItem('quickLinks') || '[]');

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

  function updateView() {
    const tab = tabs.find(t => t.id === currentTabId);
    if (!tab) return;

    if (tab.url === 'newtab') {
      window.electronAPI.viewHide();
      newTabPage.classList.add('active');
      urlInput.value = '';
      backBtn.disabled = true;
      forwardBtn.disabled = true;
    } else {
      window.electronAPI.viewShow(tab.id);
      newTabPage.classList.remove('active');
      urlInput.value = tab.url;
      backBtn.disabled = tab.historyIndex <= 0;
      forwardBtn.disabled = tab.historyIndex >= tab.history.length - 1;
    }
    renderBookmarkBar();
    renderQuickLinks();
  }

  // --- Tabs ---
  function renderTabs() {
    tabsDiv.innerHTML = '';
    tabs.forEach((tab) => {
      const tabEl = document.createElement('div');
      tabEl.className = 'tab' + (tab.id === currentTabId ? ' active' : '');
      
      const favicon = document.createElement('img');
      favicon.src = getFavicon(tab.url);
      favicon.style.width = '16px';
      favicon.style.height = '16px';
      favicon.onerror = function() { this.src = 'icons/newtab.png'; };
      tabEl.appendChild(favicon);

      const titleSpan = document.createElement('span');
      titleSpan.textContent = tab.url === 'newtab' ? 'New Tab' : (tab.title || tab.url).substring(0, 20) + '...';
      tabEl.appendChild(titleSpan);

      if (tabs.length > 1) {
        const closeBtn = document.createElement('div');
        closeBtn.className = 'close';
        closeBtn.onclick = (e) => {
          e.stopPropagation();
          closeTab(tab.id);
        };
        tabEl.appendChild(closeBtn);
      }

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

  function closeTab(id) {
    if (tabs.length === 1) return;
    const tabIndex = tabs.findIndex(t => t.id === id);
    if (tabIndex === -1) return;

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
  function navigate(url) {
    if (!/^https?:\/\//i.test(url)) {
      url = 'http://' + url;
    }
    const tab = tabs.find(t => t.id === currentTabId);
    if (tab && tab.url === 'newtab') {
      window.electronAPI.viewNavigate({ id: tab.id, url });
    }
    // Defer to newTab logic for state management
    newTab(url, true);
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
  
  // Settings button click handler
  if (settingsBtn) {
    settingsBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      openSettingsPanel();
    });
  }

  // All Settings button click handler
  if (allSettingsBtn) {
    allSettingsBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      window.electronAPI.openSettingsWindow();
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
  
  // Handle escape key to close the panel
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
      // Check if the settings panel is visible
      if (settingsPanel && settingsPanel.classList.contains('active')) {
        closeSettingsPanel();
      }
    }
  });

  // --- Bookmarks Bar ---
  function renderBookmarkBar() {
    bookmarkBar.innerHTML = '';
    bookmarks.forEach((b, index) => {
      const btn = document.createElement('button');
      btn.className = 'bookmark-btn';
      btn.onclick = () => navigate(b.url || b);

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
      bookmarks.push({ url: tab.url, label: tab.url });
      localStorage.setItem('bookmarks', JSON.stringify(bookmarks));
      renderBookmarkBar();
    }
  };

  // --- Homepage ---
  // Changed this to navigate to homepage instead of setting it
  setHomeBtn.onclick = () => {
    if (homepage) {
      navigate(homepage);
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
    
    // Add the base class ('theme-light' or 'theme-dark')
    if (themeClassName.startsWith('theme-dark')) {
      document.body.classList.add('theme-dark');
    } else {
      document.body.classList.add('theme-light');
    }

    // Add the specific variant class if it's not just the base theme
    if (themeClassName !== 'theme-light' && themeClassName !== 'theme-dark') {
      document.body.classList.add(themeClassName);
    }

    // Update the theme dropdown in the settings panel if it exists
    const themeSelect = document.getElementById('theme-select');
    if (themeSelect) {
      themeSelect.value = themeClassName;
    }
  }

  // --- Theme Broadcasting ---
  // Listen for theme changes from other windows (like the settings page)
  window.electronAPI.onThemeChanged((themeClassName) => {
    localStorage.setItem('theme', themeClassName);
    applyTheme(themeClassName);
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

  // Incognito mode (simple)
  const incognitoBtn = document.getElementById('incognito-btn');
  if (incognitoBtn) {
    incognitoBtn.onclick = () => {
      window.electronAPI.openIncognitoWindow && window.electronAPI.openIncognitoWindow();
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

  // Enhanced Keyboard Shortcuts
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
        bookmarks.push({ url: tab.url, label: tab.url });
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
    }
  });

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

  // Enhanced tab rendering with pinned tab support
  const originalRenderTabs = renderTabs;
  renderTabs = function() {
    tabsDiv.innerHTML = '';
    tabs.forEach((tab, i) => {
      const tabEl = document.createElement('div');
      tabEl.className = 'tab' + (tab.id === currentTabId ? ' active' : '') + (tab.pinned ? ' pinned' : '');
      
      const favicon = document.createElement('img');
      favicon.src = getFavicon(tab.url);
      favicon.style.width = '16px';
      favicon.style.height = '16px';
      favicon.onerror = function() { this.src = 'icons/newtab.png'; };
      tabEl.appendChild(favicon);

      if (!tab.pinned) {
        const titleSpan = document.createElement('span');
        titleSpan.textContent = tab.url === 'newtab' ? 'New Tab' : (tab.title || tab.url).substring(0, 20) + (tab.title && tab.title.length > 20 ? '...' : '');
        tabEl.appendChild(titleSpan);
      }

      if (tabs.length > 1 && !tab.pinned) {
        const closeBtn = document.createElement('div');
        closeBtn.className = 'close';
        closeBtn.onclick = (e) => {
          e.stopPropagation();
          closeTab(tab.id);
        };
        tabEl.appendChild(closeBtn);
      }

      tabEl.onclick = () => switchTab(tab.id);
      tabsDiv.appendChild(tabEl);
    });
    
    const newTabBtn = document.createElement('button');
    newTabBtn.id = 'new-tab-btn';
    newTabBtn.textContent = '+';
    newTabBtn.onclick = () => newTab();
    tabsDiv.appendChild(newTabBtn);
  }
});
