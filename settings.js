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
    const savedLocation = localStorage.getItem('weatherLocation') || '';
    weatherLocationInput.value = savedLocation;
  }

  if (updateWeatherBtn) {
    updateWeatherBtn.onclick = function() {
      const input = document.getElementById('weather-location');
      const location = input.value.trim();
      
      if (!location) {
        alert('Please enter a location');
        return;
      }
      
      localStorage.setItem('weatherLocation', location);
      localStorage.setItem('useAutoLocation', 'false');
      
      if (window.electronAPI?.broadcastWidgetSettings) {
        window.electronAPI.broadcastWidgetSettings('weatherUpdate', true);
      }
      
      alert(`Weather location set to: ${location}`);
    };
  }

  if (resetWeatherBtn) {
    resetWeatherBtn.onclick = function() {
      const input = document.getElementById('weather-location');
      input.value = '';
      localStorage.removeItem('weatherLocation');
      localStorage.setItem('useAutoLocation', 'true');
      
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
            console.log('Garbage collection completed:', result);
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
          console.log('Hibernated tabs:', hibernatedTabs);
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
});
