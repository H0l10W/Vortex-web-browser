window.addEventListener('DOMContentLoaded', () => {
  // Persistent storage helper to replace localStorage
  const storage = {
    async getItem(key) {
      try {
        return await window.electronAPI.getStorageItem(key);
      } catch (error) {
        console.error('Error getting storage item:', key, error);
        return null;
      }
    },
    async setItem(key, value) {
      try {
        return await window.electronAPI.setStorageItem(key, value);
      } catch (error) {
        console.error('Error setting storage item:', key, error);
        return false;
      }
    },
    async removeItem(key) {
      try {
        return await window.electronAPI.removeStorageItem(key);
      } catch (error) {
        console.error('Error removing storage item:', key, error);
        return false;
      }
    }
  };

  const settingsTabButtons = document.querySelectorAll('.settings-tab-button');
  const settingsTabContents = document.querySelectorAll('.settings-tab-content');
  const themeOptions = document.querySelectorAll('.theme-option');
  const appVersionSpan = document.getElementById('app-version');

  // Privacy settings elements
  const clearHistoryBtn = document.getElementById('clear-history-btn');
  const viewCookiesBtn = document.getElementById('view-cookies-btn');
  const clearCookiesBtn = document.getElementById('clear-cookies-btn');
  const clearAllDataBtn = document.getElementById('clear-all-data-btn');
  const cookieModal = document.getElementById('cookie-modal');
  const closeCookieModal = document.getElementById('close-cookie-modal');
  const cookiesList = document.getElementById('cookies-list');

  // Appearance settings elements
  const fontSizeSlider = document.getElementById('font-size-slider');
  const fontSizeValue = document.getElementById('font-size-value');
  const pageZoomSlider = document.getElementById('page-zoom-slider');
  const zoomValue = document.getElementById('zoom-value');
  const smoothScrollingToggle = document.getElementById('smooth-scrolling-toggle');
  const reducedAnimationsToggle = document.getElementById('reduced-animations-toggle');
  const closeTabsOnExitToggle = document.getElementById('close-tabs-on-exit-toggle');
  const showTabPreviewsToggle = document.getElementById('show-tab-previews-toggle');

  if (window.electronAPI && typeof window.electronAPI.getAppVersion === 'function') {
    window.electronAPI.getAppVersion().then(version => {
      if (appVersionSpan) {
        appVersionSpan.textContent = version;
      }
    });
  }

  function applyTheme(themeClassName) {
    const themeClasses = [
      'theme-light', 'theme-dark',
      'theme-light-mint', 'theme-light-sakura', 'theme-light-sunny',
      'theme-dark-purple', 'theme-dark-nord', 'theme-dark-forest', 'theme-dark-rose'
    ];
    // Remove all possible theme classes
    document.body.classList.remove(...themeClasses);
    
    // Add the single, correct class (e.g., 'theme-dark-purple')
    document.body.classList.add(themeClassName);
    
    // Broadcast the change to other windows
    if (window.electronAPI && typeof window.electronAPI.broadcastThemeChange === 'function') {
      window.electronAPI.broadcastThemeChange(themeClassName);
    }
  }

  function updateSelectedThemeUI(themeClassName) {
    if (themeOptions) {
      const themeName = themeClassName.replace('theme-', '');
      themeOptions.forEach(opt => {
        opt.classList.toggle('selected', opt.dataset.theme === themeName);
      });
    }
  }

  // Set up tab navigation
  if (settingsTabButtons) {
    settingsTabButtons.forEach(button => {
      button.addEventListener('click', () => {
        settingsTabButtons.forEach(btn => btn.classList.remove('active'));
        button.classList.add('active');

        const tabId = button.dataset.tab;
        settingsTabContents.forEach(content => {
          content.classList.toggle('active', content.id === `${tabId}-settings`);
        });
      });
    });
  }

  // Set up theme selection clicks
  if (themeOptions) {
    themeOptions.forEach(option => {
      option.addEventListener('click', () => {
        const themeName = option.dataset.theme; // e.g., 'dark-purple'
        const themeClassName = `theme-${themeName}`; // e.g., 'theme-dark-purple'
        
        localStorage.setItem('theme', themeClassName);
        storage.setItem('theme', themeClassName);
        applyTheme(themeClassName);
        updateSelectedThemeUI(themeClassName);
      });
    });
  }

  // Listen for theme changes from other windows
  if (window.electronAPI && typeof window.electronAPI.onThemeChanged === 'function') {
    window.electronAPI.onThemeChanged((themeClassName) => {
      localStorage.setItem('theme', themeClassName);
      applyTheme(themeClassName);
      updateSelectedThemeUI(themeClassName);
    });
  }

  // Apply saved theme on initial load
  storage.getItem('theme').then(currentTheme => {
    const theme = currentTheme || 'theme-light';
    applyTheme(theme);
    updateSelectedThemeUI(theme);
  });

  // --- Widget Settings Logic ---
  
  // Widget toggle elements
  const weatherToggle = document.getElementById('weather-widget-toggle');
  const newsToggle = document.getElementById('news-widget-toggle');
  const newsSettings = document.getElementById('news-settings-options');
  const newsCountrySelect = document.getElementById('news-country');
  const newsCategorySelect = document.getElementById('news-category');
  
  // Weather location elements
  const weatherSettings = document.getElementById('weather-settings-options');
  const weatherLocationInput = document.getElementById('weather-location');
  const updateWeatherBtn = document.getElementById('update-weather-location');
  const resetWeatherBtn = document.getElementById('reset-weather-location');
  
  console.log('Weather elements found:', {
    weatherSettings: !!weatherSettings,
    weatherLocationInput: !!weatherLocationInput,
    updateWeatherBtn: !!updateWeatherBtn,
    resetWeatherBtn: !!resetWeatherBtn
  });
  


  // Initialize widget settings
  if (weatherToggle) {
    weatherToggle.checked = localStorage.getItem('showWeatherWidget') !== 'false';
    weatherToggle.addEventListener('change', (e) => {
      localStorage.setItem('showWeatherWidget', e.target.checked);
      if (weatherSettings) {
        weatherSettings.style.display = e.target.checked ? 'block' : 'none';
      }
      // Broadcast setting change to main window
      if (window.electronAPI && typeof window.electronAPI.broadcastWidgetSettings === 'function') {
        window.electronAPI.broadcastWidgetSettings('weather', e.target.checked);
      }
    });
    
    // Show/hide weather settings based on toggle
    if (weatherSettings) {
      weatherSettings.style.display = weatherToggle.checked ? 'block' : 'none';
    }
  }

  if (newsToggle) {
    newsToggle.checked = localStorage.getItem('showNewsWidget') !== 'false';
    newsToggle.addEventListener('change', (e) => {
      localStorage.setItem('showNewsWidget', e.target.checked);
      if (newsSettings) {
        newsSettings.style.display = e.target.checked ? 'block' : 'none';
      }
      // Broadcast setting change to main window
      if (window.electronAPI && typeof window.electronAPI.broadcastWidgetSettings === 'function') {
        window.electronAPI.broadcastWidgetSettings('news', e.target.checked);
      }
    });
    
    // Show/hide news settings based on toggle
    if (newsSettings) {
      newsSettings.style.display = newsToggle.checked ? 'block' : 'none';
    }
  }

  // News settings
  if (newsCountrySelect) {
    const currentCountry = localStorage.getItem('newsCountry') || 'us';
    newsCountrySelect.value = currentCountry;

    
    newsCountrySelect.onchange = function() {
      const newCountry = this.value;
      localStorage.setItem('newsCountry', newCountry);
      
      if (window.electronAPI && window.electronAPI.broadcastWidgetSettings) {
        window.electronAPI.broadcastWidgetSettings('newsUpdate', true);
      }
      
      // Force immediate news update with multiple methods
      let updateAttempted = false;
      
      if (window.opener && window.opener.updateNewsWidget) {
        try {
          window.opener.updateNewsWidget();
          updateAttempted = true;
        } catch (err) {
          console.error('Direct function call failed:', err);
        }
      }
      
      if (window.opener) {
        try {
          window.opener.postMessage({
            type: 'newsSettingsChanged',
            country: newCountry,
            category: localStorage.getItem('newsCategory'),
            timestamp: Date.now()
          }, '*');
          updateAttempted = true;
        } catch (err) {
          console.error('PostMessage failed:', err);
        }
      }
      
      if (typeof window.updateNewsWidget === 'function') {
        window.updateNewsWidget();
        updateAttempted = true;
      }
      
      if (window.electronAPI?.broadcastWidgetSettings) {
        window.electronAPI.broadcastWidgetSettings('newsUpdate', true);
        updateAttempted = true;
      }
      

    };
  }

  if (newsCategorySelect) {
    const currentCategory = localStorage.getItem('newsCategory') || 'general';
    newsCategorySelect.value = currentCategory;
    
    newsCategorySelect.onchange = function() {
      const newCategory = this.value;
      localStorage.setItem('newsCategory', newCategory);
      
      if (window.electronAPI && window.electronAPI.broadcastWidgetSettings) {
        window.electronAPI.broadcastWidgetSettings('newsUpdate', true);
      }
      
      // Force immediate news update with multiple methods
      let updateAttempted = false;
      
      if (window.opener && window.opener.updateNewsWidget) {
        try {
          window.opener.updateNewsWidget();
          updateAttempted = true;
        } catch (err) {
          console.error('Direct function call failed:', err);
        }
      }
      
      if (window.opener) {
        try {
          window.opener.postMessage({
            type: 'newsSettingsChanged',
            category: newCategory,
            country: localStorage.getItem('newsCountry'),
            timestamp: Date.now()
          }, '*');
          updateAttempted = true;
        } catch (err) {
          console.error('PostMessage failed:', err);
        }
      }
      
      if (typeof window.updateNewsWidget === 'function') {
        window.updateNewsWidget();
        updateAttempted = true;
      }
      
      if (window.electronAPI?.broadcastWidgetSettings) {
        window.electronAPI.broadcastWidgetSettings('newsUpdate', true);
        updateAttempted = true;
      }
    };
  }

  // Weather location settings
  if (weatherLocationInput) {
    // Load saved value
    storage.getItem('weatherLocation').then(savedLocation => {
      weatherLocationInput.value = savedLocation || '';
    });
  }

  if (updateWeatherBtn) {
    console.log('Update weather button found, setting up click handler');
    updateWeatherBtn.onclick = async function() {
      console.log('=== BUTTON CLICKED! ===');
      const input = document.getElementById('weather-location');
      const location = input.value.trim();
      console.log('Location input value:', location);
      
      if (!location) {
        alert('Please enter a location');
        return;
      }
      
      console.log('Saving weather location to storage:', location);
      try {
        await storage.setItem('weatherLocation', location);
        await storage.setItem('useAutoLocation', 'false');
        await storage.removeItem('weatherCoords'); // Clear cached coords
        console.log('Storage operations completed successfully');
        
        // Verify the data was saved
        const savedLocation = await storage.getItem('weatherLocation');
        const savedAutoMode = await storage.getItem('useAutoLocation');
        console.log('Verification - saved location:', savedLocation, 'useAutoLocation:', savedAutoMode);
        
      } catch (error) {
        console.error('Error saving to storage:', error);
        alert('Error saving location: ' + error.message);
        return;
      }
      
      console.log('Broadcasting weather update to main window');
      if (window.electronAPI?.broadcastWidgetSettings) {
        try {
          window.electronAPI.broadcastWidgetSettings('weatherUpdate', true);
          console.log('Broadcast sent successfully');
        } catch (error) {
          console.error('Error broadcasting:', error);
        }
      } else {
        console.error('electronAPI.broadcastWidgetSettings not available');
      }
      
      alert(`Weather location set to: ${location}`);
    };
  } else {
    console.error('Update weather button not found!');
  }

  if (resetWeatherBtn) {
    resetWeatherBtn.onclick = async function() {
      const input = document.getElementById('weather-location');
      input.value = '';
      await storage.removeItem('weatherLocation');
      await storage.setItem('useAutoLocation', 'true');
      await storage.removeItem('weatherCoords');
      
      if (window.electronAPI?.broadcastWidgetSettings) {
        window.electronAPI.broadcastWidgetSettings('weatherUpdate', true);
      }
      
      alert('Weather location reset to automatic detection');
    };
  }

  // --- Privacy Settings Logic ---

  // Clear browsing history
  if (clearHistoryBtn) {
    clearHistoryBtn.addEventListener('click', () => {
      if (confirm('Are you sure you want to clear all browsing history?')) {
        localStorage.removeItem('history');
        alert('Browsing history cleared successfully.');
      }
    });
  }

  // View cookies modal
  if (viewCookiesBtn) {
    viewCookiesBtn.addEventListener('click', () => {
      displayCookies();
      cookieModal.style.display = 'block';
    });
  }

  // Close cookie modal
  if (closeCookieModal) {
    closeCookieModal.addEventListener('click', () => {
      cookieModal.style.display = 'none';
    });
  }

  // Clear all cookies
  if (clearCookiesBtn) {
    clearCookiesBtn.addEventListener('click', () => {
      if (confirm('Are you sure you want to clear all cookies? This may log you out of websites.')) {
        if (window.electronAPI && typeof window.electronAPI.clearAllCookies === 'function') {
          window.electronAPI.clearAllCookies().then(() => {
            alert('All cookies cleared successfully.');
          }).catch(() => {
            alert('Failed to clear cookies.');
          });
        }
      }
    });
  }

  // Clear all browsing data
  if (clearAllDataBtn) {
    clearAllDataBtn.addEventListener('click', () => {
      if (confirm('Are you sure you want to clear ALL browsing data? This includes history, cookies, bookmarks, and quick links. This action cannot be undone.')) {
        // Clear localStorage data
        const themeToKeep = localStorage.getItem('theme');
        localStorage.clear();
        if (themeToKeep) {
          localStorage.setItem('theme', themeToKeep);
        }
        
        // Clear cookies via Electron API
        if (window.electronAPI && typeof window.electronAPI.clearAllCookies === 'function') {
          window.electronAPI.clearAllCookies();
        }
        
        alert('All browsing data cleared successfully.');
      }
    });
  }

  // Function to display cookies
  function displayCookies() {
    if (window.electronAPI && typeof window.electronAPI.getAllCookies === 'function') {
      window.electronAPI.getAllCookies().then(cookies => {
        cookiesList.innerHTML = '';
        
        if (cookies.length === 0) {
          cookiesList.innerHTML = '<p>No cookies found.</p>';
          return;
        }

        cookies.forEach(cookie => {
          const cookieItem = document.createElement('div');
          cookieItem.className = 'cookie-item';
          cookieItem.innerHTML = `
            <div class="cookie-info">
              <strong>${cookie.name}</strong> - ${cookie.domain}
              <div class="cookie-details">
                <span>Value: ${cookie.value.substring(0, 50)}${cookie.value.length > 50 ? '...' : ''}</span>
                <span>Expires: ${cookie.expirationDate ? new Date(cookie.expirationDate * 1000).toLocaleDateString() : 'Session'}</span>
              </div>
            </div>
            <button class="delete-cookie-btn" data-name="${cookie.name}" data-domain="${cookie.domain}">Delete</button>
          `;
          cookiesList.appendChild(cookieItem);
        });

        // Add delete functionality to individual cookie buttons
        const deleteCookieBtns = cookiesList.querySelectorAll('.delete-cookie-btn');
        deleteCookieBtns.forEach(btn => {
          btn.addEventListener('click', (e) => {
            const name = e.target.dataset.name;
            const domain = e.target.dataset.domain;
            
            if (window.electronAPI && typeof window.electronAPI.deleteCookie === 'function') {
              window.electronAPI.deleteCookie(name, domain).then(() => {
                displayCookies(); // Refresh the list
              });
            }
          });
        });
      });
    } else {
      cookiesList.innerHTML = '<p>Cookie management not available.</p>';
    }
  }

  // Memory Management Functions
  // ===========================
  
  const refreshMemoryBtn = document.getElementById('refresh-memory-btn');
  const forceGcBtn = document.getElementById('force-gc-btn');
  const hibernateTabsBtn = document.getElementById('hibernate-tabs-btn');
  
  async function updateMemoryDisplay() {
    if (window.electronAPI && typeof window.electronAPI.getMemoryUsage === 'function') {
      try {
        const memoryInfo = await window.electronAPI.getMemoryUsage();
        
        document.getElementById('memory-rss').textContent = `${memoryInfo.rss} MB`;
        document.getElementById('memory-heap').textContent = `${memoryInfo.heapUsed} / ${memoryInfo.heapTotal} MB`;
        document.getElementById('memory-tabs').textContent = memoryInfo.totalTabs;
        document.getElementById('memory-hibernated').textContent = memoryInfo.hibernatedTabs.length;
        
        // Color code memory usage
        const rssElement = document.getElementById('memory-rss');
        if (memoryInfo.rss > 1024) {
          rssElement.style.color = '#e74c3c'; // Red for high usage
        } else if (memoryInfo.rss > 512) {
          rssElement.style.color = '#f39c12'; // Orange for medium usage
        } else {
          rssElement.style.color = '#27ae60'; // Green for low usage
        }
        
      } catch (error) {
        console.error('Failed to get memory usage:', error);
        document.getElementById('memory-rss').textContent = 'Error';
        document.getElementById('memory-heap').textContent = 'Error';
        document.getElementById('memory-tabs').textContent = 'Error';
        document.getElementById('memory-hibernated').textContent = 'Error';
      }
    }
  }
  
  if (refreshMemoryBtn) {
    refreshMemoryBtn.addEventListener('click', () => {
      updateMemoryDisplay();
    });
  }
  
  if (forceGcBtn) {
    forceGcBtn.addEventListener('click', async () => {
      if (window.electronAPI && typeof window.electronAPI.forceGarbageCollection === 'function') {
        try {
          forceGcBtn.textContent = 'Running GC...';
          forceGcBtn.disabled = true;
          
          const result = await window.electronAPI.forceGarbageCollection();
          if (result) {
            updateMemoryDisplay();
          }
          
          forceGcBtn.textContent = 'Force Garbage Collection';
          forceGcBtn.disabled = false;
        } catch (error) {
          console.error('Failed to run garbage collection:', error);
          forceGcBtn.textContent = 'Force Garbage Collection';
          forceGcBtn.disabled = false;
        }
      }
    });
  }
  
  if (hibernateTabsBtn) {
    hibernateTabsBtn.addEventListener('click', async () => {
      if (window.electronAPI && typeof window.electronAPI.hibernateInactiveTabs === 'function') {
        try {
          hibernateTabsBtn.textContent = 'Hibernating...';
          hibernateTabsBtn.disabled = true;
          
          const hibernatedTabs = await window.electronAPI.hibernateInactiveTabs();
          updateMemoryDisplay();
          
          hibernateTabsBtn.textContent = 'Hibernate Inactive Tabs';
          hibernateTabsBtn.disabled = false;
        } catch (error) {
          console.error('Failed to hibernate tabs:', error);
          hibernateTabsBtn.textContent = 'Hibernate Inactive Tabs';
          hibernateTabsBtn.disabled = false;
        }
      }
    });
  }
  
  // Update memory display when Performance tab is first opened
  settingsTabButtons.forEach(button => {
    button.addEventListener('click', () => {
      if (button.dataset.tab === 'performance') {
        setTimeout(() => {
          updateMemoryDisplay();
        }, 100);
      }
    });
  });

  // Close modal when clicking outside
  window.addEventListener('click', (e) => {
    if (e.target === cookieModal) {
      cookieModal.style.display = 'none';
    }
  });

  // --- Appearance Settings Functionality ---
  
  // Font Size Slider
  if (fontSizeSlider && fontSizeValue) {
    // Load saved font size
    storage.getItem('fontSize').then(savedSize => {
      const fontSize = savedSize || '14';
      fontSizeSlider.value = fontSize;
      fontSizeValue.textContent = fontSize + 'px';
      document.documentElement.style.setProperty('--base-font-size', fontSize + 'px');
    });

    fontSizeSlider.addEventListener('input', (e) => {
      const size = e.target.value;
      fontSizeValue.textContent = size + 'px';
      document.documentElement.style.setProperty('--base-font-size', size + 'px');
      storage.setItem('fontSize', size);
    });
  }

  // Page Zoom Slider
  if (pageZoomSlider && zoomValue) {
    // Load saved zoom level
    storage.getItem('pageZoom').then(savedZoom => {
      const zoom = savedZoom || '100';
      pageZoomSlider.value = zoom;
      zoomValue.textContent = zoom + '%';
      document.body.style.zoom = zoom + '%';
    });

    pageZoomSlider.addEventListener('input', (e) => {
      const zoom = e.target.value;
      zoomValue.textContent = zoom + '%';
      document.body.style.zoom = zoom + '%';
      storage.setItem('pageZoom', zoom);
    });
  }

  // Smooth Scrolling Toggle
  if (smoothScrollingToggle) {
    storage.getItem('smoothScrolling').then(enabled => {
      smoothScrollingToggle.checked = enabled === 'true';
      updateScrollBehavior(enabled === 'true');
    });

    smoothScrollingToggle.addEventListener('change', (e) => {
      const enabled = e.target.checked;
      storage.setItem('smoothScrolling', enabled.toString());
      updateScrollBehavior(enabled);
    });
  }

  function updateScrollBehavior(enabled) {
    document.documentElement.style.scrollBehavior = enabled ? 'smooth' : 'auto';
  }

  // Reduced Animations Toggle
  if (reducedAnimationsToggle) {
    storage.getItem('reducedAnimations').then(enabled => {
      reducedAnimationsToggle.checked = enabled === 'true';
      updateAnimationSettings(enabled === 'true');
    });

    reducedAnimationsToggle.addEventListener('change', (e) => {
      const enabled = e.target.checked;
      storage.setItem('reducedAnimations', enabled.toString());
      updateAnimationSettings(enabled);
    });
  }

  function updateAnimationSettings(reduced) {
    if (reduced) {
      document.documentElement.style.setProperty('--animation-speed', '0.1s');
      document.documentElement.style.setProperty('--transition-speed', '0.1s');
    } else {
      document.documentElement.style.removeProperty('--animation-speed');
      document.documentElement.style.removeProperty('--transition-speed');
    }
  }

  // Close Tabs on Exit Toggle
  if (closeTabsOnExitToggle) {
    storage.getItem('closeTabsOnExit').then(enabled => {
      closeTabsOnExitToggle.checked = enabled === 'true';
    });

    closeTabsOnExitToggle.addEventListener('change', (e) => {
      storage.setItem('closeTabsOnExit', e.target.checked.toString());
    });
  }

  // Show Tab Previews Toggle
  if (showTabPreviewsToggle) {
    storage.getItem('showTabPreviews').then(enabled => {
      showTabPreviewsToggle.checked = enabled !== 'false'; // Default to true
    });

    showTabPreviewsToggle.addEventListener('change', (e) => {
      storage.setItem('showTabPreviews', e.target.checked.toString());
      // Broadcast to main window to update tab display
      if (window.electronAPI?.broadcastWidgetSettings) {
        window.electronAPI.broadcastWidgetSettings('tabPreviews', e.target.checked);
      }
    });
  }

  // --- General Settings Tab Functionality ---
  
  // General tab elements
  const startPageSelectFull = document.getElementById('start-page-select-full');
  const homepageInputFull = document.getElementById('homepage-input-full');
  const newTabBehavior = document.getElementById('new-tab-behavior');
  const searchEngineSelectFull = document.getElementById('search-engine-select-full');
  const customSearchGroup = document.getElementById('custom-search-group');
  const customSearchUrl = document.getElementById('custom-search-url');
  const searchSuggestionsToggle = document.getElementById('search-suggestions-toggle');
  const downloadLocationInput = document.getElementById('download-location');
  const chooseDownloadFolderBtn = document.getElementById('choose-download-folder');
  const askDownloadLocationToggle = document.getElementById('ask-download-location-toggle');
  const userAgentInputFull = document.getElementById('user-agent-input-full');
  const javascriptEnabledToggle = document.getElementById('javascript-enabled-toggle');
  const imagesEnabledToggle = document.getElementById('images-enabled-toggle');
  const popupBlockerToggle = document.getElementById('popup-blocker-toggle');

  // Initialize General Settings
  if (startPageSelectFull) {
    storage.getItem('startPage').then(startPage => {
      startPageSelectFull.value = startPage || 'newtab';
    });

    startPageSelectFull.addEventListener('change', (e) => {
      storage.setItem('startPage', e.target.value);
    });
  }

  if (homepageInputFull) {
    storage.getItem('homepage').then(homepage => {
      homepageInputFull.value = homepage || 'https://www.google.com';
    });

    homepageInputFull.addEventListener('change', (e) => {
      storage.setItem('homepage', e.target.value);
    });
  }

  // Save homepage button functionality
  const saveHomepageFull = document.getElementById('save-homepage-full');
  if (saveHomepageFull && homepageInputFull) {
    saveHomepageFull.addEventListener('click', async () => {
      const url = homepageInputFull.value.trim();
      if (url) {
        await storage.setItem('homepage', url);
        
        // Visual feedback
        saveHomepageFull.textContent = 'Saved!';
        saveHomepageFull.style.background = '#34A853';
        
        setTimeout(() => {
          saveHomepageFull.textContent = 'Save';
          saveHomepageFull.style.background = '';
        }, 1500);
      }
    });
  }

  if (newTabBehavior) {
    storage.getItem('newTabBehavior').then(behavior => {
      newTabBehavior.value = behavior || 'newtab';
    });

    newTabBehavior.addEventListener('change', (e) => {
      storage.setItem('newTabBehavior', e.target.value);
    });
  }

  if (searchEngineSelectFull) {
    storage.getItem('searchEngine').then(engine => {
      searchEngineSelectFull.value = engine || 'google';
      // Show/hide custom search group
      if (customSearchGroup) {
        customSearchGroup.style.display = engine === 'custom' ? 'block' : 'none';
      }
    });

    searchEngineSelectFull.addEventListener('change', (e) => {
      storage.setItem('searchEngine', e.target.value);
      // Show/hide custom search group
      if (customSearchGroup) {
        customSearchGroup.style.display = e.target.value === 'custom' ? 'block' : 'none';
      }
    });
  }

  if (customSearchUrl) {
    storage.getItem('customSearchUrl').then(url => {
      customSearchUrl.value = url || '';
    });

    customSearchUrl.addEventListener('change', (e) => {
      storage.setItem('customSearchUrl', e.target.value);
    });
  }

  if (searchSuggestionsToggle) {
    storage.getItem('searchSuggestions').then(enabled => {
      searchSuggestionsToggle.checked = enabled !== 'false';
    });

    searchSuggestionsToggle.addEventListener('change', (e) => {
      storage.setItem('searchSuggestions', e.target.checked.toString());
    });
  }

  if (downloadLocationInput) {
    storage.getItem('downloadLocation').then(location => {
      downloadLocationInput.value = location || '';
    });
  }

  if (chooseDownloadFolderBtn) {
    chooseDownloadFolderBtn.addEventListener('click', async () => {
      try {
        if (window.electronAPI && window.electronAPI.chooseDownloadFolder) {
          const folderPath = await window.electronAPI.chooseDownloadFolder();
          if (folderPath && downloadLocationInput) {
            downloadLocationInput.value = folderPath;
            await storage.setItem('downloadLocation', folderPath);
          }
        }
      } catch (error) {
        console.error('Error choosing download folder:', error);
      }
    });
  }

  if (askDownloadLocationToggle) {
    storage.getItem('askDownloadLocation').then(enabled => {
      askDownloadLocationToggle.checked = enabled === 'true';
    });

    askDownloadLocationToggle.addEventListener('change', (e) => {
      storage.setItem('askDownloadLocation', e.target.checked.toString());
    });
  }

  if (userAgentInputFull) {
    storage.getItem('userAgent').then(userAgent => {
      userAgentInputFull.value = userAgent || '';
    });

    userAgentInputFull.addEventListener('change', (e) => {
      storage.setItem('userAgent', e.target.value);
    });
  }

  if (javascriptEnabledToggle) {
    storage.getItem('javascriptEnabled').then(enabled => {
      javascriptEnabledToggle.checked = enabled !== 'false';
    });

    javascriptEnabledToggle.addEventListener('change', (e) => {
      storage.setItem('javascriptEnabled', e.target.checked.toString());
    });
  }

  if (imagesEnabledToggle) {
    storage.getItem('imagesEnabled').then(enabled => {
      imagesEnabledToggle.checked = enabled !== 'false';
    });

    imagesEnabledToggle.addEventListener('change', (e) => {
      storage.setItem('imagesEnabled', e.target.checked.toString());
    });
  }

  if (popupBlockerToggle) {
    storage.getItem('popupBlocker').then(enabled => {
      popupBlockerToggle.checked = enabled !== 'false';
    });

    popupBlockerToggle.addEventListener('change', (e) => {
      storage.setItem('popupBlocker', e.target.checked.toString());
    });
  }
});
