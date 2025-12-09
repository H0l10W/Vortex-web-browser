// Dedicated history page script
(async function () {
  // Favicon caching for history page
  const __faviconBase64Cache = new Map();
  const __faviconFetchQueue = new Set();
  const getHostFromUrl = (url) => {
    try { const u = new URL(url); return u.hostname.replace(/^www\./,''); } catch (e) { return null; }
  };
  async function fetchAndCacheFavicon(host) {
    try {
      if (!host || __faviconFetchQueue.has(host)) return;
      __faviconFetchQueue.add(host);
      const storageKey = `favicons:${host}`;
      const existing = await window.electronAPI?.getStorageItem?.(storageKey) || localStorage.getItem(storageKey);
      if (existing) {
        __faviconBase64Cache.set(host, existing);
        __faviconFetchQueue.delete(host);
        return existing;
      }
      const response = await fetch(`https://icons.duckduckgo.com/ip3/${host}.ico`);
      if (!response.ok) throw new Error('Failed to fetch');
      const blob = await response.blob();
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
      __faviconBase64Cache.set(host, dataUrl);
      try { window.electronAPI?.setStorageItem?(storageKey, dataUrl) : localStorage.setItem(storageKey, dataUrl); } catch(e) {}
      __faviconFetchQueue.delete(host);
      document.querySelectorAll(`img[data-favicon-host="${host}"]`).forEach(img => img.src = dataUrl);
      return dataUrl;
    } catch (err) { __faviconFetchQueue.delete(host); return null; }
  }
  const getFavicon = (url) => {
    try {
      if (url === 'newtab') return 'icons/newtab.png';
      const u = new URL(url);
      const host = getHostFromUrl(url);
      if (__faviconBase64Cache.has(host)) return __faviconBase64Cache.get(host);
      const remoteUrl = `https://icons.duckduckgo.com/ip3/${u.hostname}.ico`;
      fetchAndCacheFavicon(host).catch(()=>{});
      return remoteUrl;
    } catch (e) {
      return 'icons/newtab.png';
    }
  };

  const getSiteName = (url) => {
    try {
      const u = new URL(url);
      const host = u.hostname.replace(/^www\./, '');
      return host.charAt(0).toUpperCase() + host.slice(1);
    } catch (e) {
      return url;
    }
  };

  async function renderHistory() {
    console.time('renderHistory');
    try {
      const theme = await window.electronAPI?.getStorageItem?.('theme') || localStorage.getItem('theme') || 'theme-light';
      document.body.className = theme;
      let raw = '[]';
      try {
        raw = await window.electronAPI?.getStorageItem?.('browserHistory') || localStorage.getItem('browserHistory') || '[]';
      } catch (err) {
        console.warn('history.js: storage get failed, falling back to localStorage or empty array', err);
        raw = localStorage.getItem('browserHistory') || '[]';
      }
      console.debug('history.js: raw stored value for browserHistory:', raw ? (raw.length ? raw.slice(0, 120) + (raw.length > 120 ? '...' : '') : raw) : null);
      let history = [];
      try {
        history = JSON.parse(raw || '[]');
      } catch (err) {
        console.error('history.js: failed to parse stored browserHistory, using empty array', err);
        history = [];
      }
      // If we are opened from the main window and it has an in-memory buffer, render it too
      try {
        if (window.opener && window.opener.__unsavedHistory && Array.isArray(window.opener.__unsavedHistory)) {
          const merged = [...history, ...window.opener.__unsavedHistory];
          // Remove duplicates by URL, keep latest
          const byUrl = new Map();
          for (const entry of merged) {
            if (!entry || !entry.url) continue;
            byUrl.set(entry.url, entry);
          }
          history = Array.from(byUrl.values());
        }
      } catch (e) { /* ignore cross-origin or access issues */ }
        // Filter out internal pages
        history = history.filter(e => {
          if (!e || !e.url) return false;
          const url = e.url;
          if (url === 'newtab') return false;
          if (url.includes('settings.html')) return false;
          if (url.includes('history.html')) return false;
          return true;
        });
      const list = document.getElementById('history-list');
      list.innerHTML = '';
      if (!history.length) {
        list.innerHTML = '<div class="no-history">No browsing history yet.</div>';
        return;
      }
      const PAGE_SIZE = 100;
      let offset = 0;
      const entries = history.slice().reverse();

      function appendNextPage() {
        if (offset >= entries.length) return;
        const frag2 = document.createDocumentFragment();
        const next = entries.slice(offset, offset + PAGE_SIZE);
        console.time('appendHistoryPage');
        next.forEach(entry => {
          const item = document.createElement('div');
          item.className = 'history-item';
          item.onclick = () => {
            if (window.opener) {
              window.opener.document.getElementById('url').value = entry.url;
              window.opener.document.getElementById('url').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
              window.close();
            }
          };

          const favicon = document.createElement('img');
          favicon.className = 'history-favicon';
          const host = getHostFromUrl(entry.url);
          if (host) favicon.dataset.faviconHost = host;
          favicon.src = getFavicon(entry.url);
          favicon.onerror = function () { this.src = 'icons/newtab.png'; };

          const title = document.createElement('span');
          title.className = 'history-title';
          title.textContent = (entry.host && entry.host.length) ? (entry.host.charAt(0).toUpperCase() + entry.host.slice(1)) : getSiteName(entry.url);

          item.appendChild(favicon);
          item.appendChild(title);
          frag2.appendChild(item);
        });
        list.appendChild(frag2);
        console.timeEnd('appendHistoryPage');
        offset += PAGE_SIZE;
      }
      appendNextPage();
      // listen to scroll to append more
      list.addEventListener('scroll', (e) => {
        if (list.scrollTop + list.clientHeight > list.scrollHeight - 300) {
          appendNextPage();
        }
      });
      console.timeEnd('renderHistory');
    } catch (err) {
      console.error('Error rendering history:', err);
    }
  }

  // Listen for theme changes (broadcast from main window)
  if (window.electronAPI && window.electronAPI.onThemeChanged) {
    window.electronAPI.onThemeChanged(theme => {
      document.body.className = theme;
    });
  }

  // Listen for history updates (broadcast by renderer flush)
  if (window.electronAPI && window.electronAPI.on) {
    window.electronAPI.on('history-updated', () => {
      try { renderHistory(); } catch (e) { /* ignore */ }
    });
  }

  await renderHistory();
  // Manual refresh button
  const refreshBtn = document.getElementById('refresh-history-btn');
  if (refreshBtn) refreshBtn.addEventListener('click', () => { try { renderHistory(); } catch(e) {} });
})();
