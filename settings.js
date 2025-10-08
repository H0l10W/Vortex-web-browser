window.addEventListener('DOMContentLoaded', () => {
  const settingsTabButtons = document.querySelectorAll('.settings-tab-button');
  const settingsTabContents = document.querySelectorAll('.settings-tab-content');
  const themeOptions = document.querySelectorAll('.theme-option');
  const appVersionSpan = document.getElementById('app-version');

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

  // --- Main Logic ---

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
  const currentTheme = localStorage.getItem('theme') || 'theme-light'; // Default to 'theme-light'
  applyTheme(currentTheme);
  updateSelectedThemeUI(currentTheme);
});
