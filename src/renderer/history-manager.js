import { createStorage, perfStart, perfEnd } from "./utils.js";

const MAX_HISTORY_ENTRIES = 500;
const FLUSH_DELAY_MS = 750;

export function createHistoryManager(electronAPI, { readOnly = false } = {}) {
  const storage = createStorage(electronAPI);
  const buffer = { entries: [] };
  let flushTimeout = null;
  let initPromise = null;

  function cacheLocally() {
    try {
      localStorage.setItem("browserHistory", JSON.stringify(buffer.entries));
    } catch (_error) {}
  }

  function init() {
    if (initPromise) return initPromise;
    initPromise = (async () => {
      try {
        const persisted = await storage.getItem("browserHistory");
        const fallback = localStorage.getItem("browserHistory");
        const parsed = JSON.parse(persisted || fallback || "[]");
        buffer.entries = Array.isArray(parsed)
          ? parsed.slice(-MAX_HISTORY_ENTRIES)
          : [];
        cacheLocally();
      } catch (_error) {
        buffer.entries = [];
      }
    })();
    return initPromise;
  }

  async function persist() {
    if (readOnly) return true;
    perfStart("flushHistory");
    const serialized = JSON.stringify(buffer.entries);
    const saved = await storage.setItem("browserHistory", serialized);
    perfEnd("flushHistory");
    cacheLocally();
    try {
      electronAPI.broadcastHistoryUpdated();
    } catch (_error) {}
    return saved;
  }

  function scheduleFlush() {
    if (readOnly) return;
    if (flushTimeout) clearTimeout(flushTimeout);
    flushTimeout = setTimeout(async () => {
      flushTimeout = null;
      try {
        await persist();
      } catch (error) {
        console.error("Failed to persist browser history", error);
      }
    }, FLUSH_DELAY_MS);
  }

  async function addToHistory(entry) {
    if (readOnly || !entry?.url) return;
    await init();
    const normalized = {
      ...entry,
      timestamp: Number(entry.timestamp) || Date.now(),
    };
    const lastIndex = buffer.entries.length - 1;
    if (lastIndex >= 0 && buffer.entries[lastIndex]?.url === normalized.url) {
      buffer.entries[lastIndex] = {
        ...buffer.entries[lastIndex],
        ...normalized,
      };
    } else {
      buffer.entries.push(normalized);
      if (buffer.entries.length > MAX_HISTORY_ENTRIES) {
        buffer.entries.splice(
          0,
          buffer.entries.length - MAX_HISTORY_ENTRIES,
        );
      }
    }
    cacheLocally();
    scheduleFlush();
    if (document.getElementById("settings-panel")?.classList.contains("active")) {
      try {
        window.renderSettingsHistory?.();
      } catch (_error) {}
    }
  }

  async function updateTitle(url, title) {
    if (readOnly || !url || !title) return;
    await init();
    for (let index = buffer.entries.length - 1; index >= 0; index -= 1) {
      if (buffer.entries[index]?.url !== url) continue;
      buffer.entries[index] = { ...buffer.entries[index], title };
      cacheLocally();
      scheduleFlush();
      break;
    }
  }

  async function flush() {
    if (readOnly) return;
    await init();
    if (flushTimeout) clearTimeout(flushTimeout);
    flushTimeout = null;
    await persist();
  }

  async function clear() {
    if (readOnly) return;
    await init();
    if (flushTimeout) clearTimeout(flushTimeout);
    flushTimeout = null;
    buffer.entries = [];
    await persist();
  }

  function getAll() {
    return buffer.entries.slice();
  }

  return { init, addToHistory, updateTitle, flush, clear, getAll };
}
