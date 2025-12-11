import { createStorage, perfStart, perfEnd } from './utils.js';

export function createHistoryManager(electronAPI) {
  const storage = createStorage(electronAPI);
  const buffer = { entries: [] };
  let flushTimeout = null;

  async function init() {
    // Load existing storage value into buffer on first use
    try {
      const raw = await storage.getItem('browserHistory') || localStorage.getItem('browserHistory') || '[]';
      buffer.entries = JSON.parse(raw) || [];
    } catch (e) { buffer.entries = []; }
  }

  async function addToHistory(entry) {
    if (!entry || !entry.url) return;
    const last = buffer.entries[buffer.entries.length - 1];
    if (last && last.url === entry.url) return;
    buffer.entries.push(entry);
    if (buffer.entries.length > 500) buffer.entries.splice(0, buffer.entries.length - 500);
    // Debounced flush
    if (flushTimeout) clearTimeout(flushTimeout);
    flushTimeout = setTimeout(async () => {
      try {
        perfStart('flushHistory');
        const ok = await storage.setItem('browserHistory', JSON.stringify(buffer.entries || []));
        perfEnd('flushHistory');
        flushTimeout = null;
        try { window.electronAPI.broadcastHistoryUpdated(); } catch (e) {}
        if (!ok) { try { localStorage.setItem('browserHistory', JSON.stringify(buffer.entries || [])); } catch (e) {} }
      } catch (err) {
        console.error('Failed to persist browserHistory', err);
        try { localStorage.setItem('browserHistory', JSON.stringify(buffer.entries || [])); } catch (e) {}
        flushTimeout = null;
      }
    }, 1000);
    // If settings panel visible, try to update it synchronously (best effort)
    if (document.getElementById('settings-panel')?.classList.contains('active')) {
      try { window.renderSettingsHistory && window.renderSettingsHistory(); } catch (e) {}
    }
  }

  async function flush() {
    if (flushTimeout) clearTimeout(flushTimeout);
    try { await storage.setItem('browserHistory', JSON.stringify(buffer.entries || [])); } catch (e) { try { localStorage.setItem('browserHistory', JSON.stringify(buffer.entries || [])); } catch (e) {} }
    try { window.electronAPI.broadcastHistoryUpdated(); } catch (e) {}
  }

  async function clear() {
    buffer.entries = [];
    if (flushTimeout) clearTimeout(flushTimeout);
    try {
      await storage.setItem('browserHistory', '[]');
    } catch (e) {
      try { localStorage.setItem('browserHistory', '[]'); } catch (e) {}
    }
    try { window.electronAPI.broadcastHistoryUpdated(); } catch (e) {}
    // Note: we do not request broadcast clearing from here; UI actions should call requestClearHistory to propagate
  }

  function getAll() { return buffer.entries.slice(); }

  return { init, addToHistory, flush, clear, getAll };
}
