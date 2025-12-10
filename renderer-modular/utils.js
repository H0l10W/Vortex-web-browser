// Small utility exports used by renderer components
export const __debounceSetTimers = new Map();
export function debouncedSetItem(key, value, delay = 500) {
  if (__debounceSetTimers.has(key)) clearTimeout(__debounceSetTimers.get(key));
  const timer = setTimeout(() => {
    try { window.storage && window.storage.setItem(key, value); } catch(e) { console.error('debouncedSetItem: storage.setItem error', e); }
    __debounceSetTimers.delete(key);
  }, delay);
  __debounceSetTimers.set(key, timer);
}

export const perfMarks = new Set();
export function perfStart(name) {
  try { performance.mark(name + '-start'); perfMarks.add(name); } catch(e) {}
}
export function perfEnd(name) {
  try {
    if (!perfMarks.has(name)) return;
    performance.mark(name + '-end');
    performance.measure(name, name + '-start', name + '-end');
    const m = performance.getEntriesByName(name).pop();
    if (m) {
      console.debug(`PERF: ${name}: ${m.duration.toFixed(1)}ms`);
      if (!window.__perfMeasures) window.__perfMeasures = [];
      window.__perfMeasures.push({ name, duration: m.duration, ts: Date.now() });
      if (window.__perfMeasures.length > 500) window.__perfMeasures.shift();
      debouncedSetItem('perfMeasures', JSON.stringify(window.__perfMeasures));
    }
    perfMarks.delete(name);
  } catch(e) {}
}

// Storage helper wrapper for module consumers
export const createStorage = (electronAPI) => ({
  async getItem(key) { try { return await electronAPI.getStorageItem(key); } catch (err) { console.error('Error getItem', err); return null; } },
  async setItem(key, value) { try { return await electronAPI.setStorageItem(key, value); } catch (err) { console.error('Error setItem', err); return false; } },
  async removeItem(key) { try { return await electronAPI.removeStorageItem(key); } catch (err) { console.error('Error removeItem', err); return false; } }
});

export function getHostFromUrl(url) {
  try { return (new URL(url)).hostname.replace(/^www\./, ''); } catch (e) { return null; }
}

export function getSiteName(url) {
  try { const u = new URL(url); const host = u.hostname.replace(/^www\./, ''); return host.charAt(0).toUpperCase() + host.slice(1); } catch (e) { return url; }
}

// Simple favicon cache utilities
export const __faviconBase64Cache = new Map();
export const __faviconFetchQueue = new Set();
export async function fetchAndCacheFavicon(storage, host) {
  try {
    if (!host || __faviconFetchQueue.has(host)) return null;
    __faviconFetchQueue.add(host);
    const storageKey = `favicons:${host}`;
    const existing = await storage.getItem(storageKey) || localStorage.getItem(storageKey);
    if (existing) { __faviconBase64Cache.set(host, existing); __faviconFetchQueue.delete(host); return existing; }
    const response = await fetch(`https://icons.duckduckgo.com/ip3/${host}.ico`);
    if (!response.ok) throw new Error('Failed fetch');
    const blob = await response.blob();
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
    __faviconBase64Cache.set(host, dataUrl);
    try { await storage.setItem(storageKey, dataUrl); } catch(e) {}
    __faviconFetchQueue.delete(host);
    document.querySelectorAll(`img[data-favicon-host="${host}"]`).forEach(img => img.src = dataUrl);
    return dataUrl;
  } catch (err) { __faviconFetchQueue.delete(host); return null; }
}

export function getFaviconForUrl(storage, url) {
  try {
    if (url === 'newtab') return 'icons/newtab.png';
    const u = new URL(url);
    const host = getHostFromUrl(url);
    if (__faviconBase64Cache.has(host)) return __faviconBase64Cache.get(host);
    const remoteUrl = `https://icons.duckduckgo.com/ip3/${u.hostname}.ico`;
    fetchAndCacheFavicon(storage, host).catch(()=>{});
    return remoteUrl;
  } catch (e) { return 'icons/newtab.png'; }
}
