import {
  debouncedSetItem,
  perfStart,
  perfEnd,
  createStorage,
} from "./src/renderer/utils.js";
import { createHistoryManager } from "./src/renderer/history-manager.js";
import { initializeWindowControls } from "./src/renderer/window-controls.js";
import { getWidgetSetting } from "./src/renderer/widgets/widget-settings.js";

let WeatherWidget;
let NewsWidget;
let widgetModulesPromise;
function loadWidgetModules() {
  if (!widgetModulesPromise) {
    widgetModulesPromise = Promise.all([
      import("./src/renderer/widgets/weather-widget.js"),
      import("./src/renderer/widgets/news-widget.js"),
    ]).then(([weatherModule, newsModule]) => {
      WeatherWidget = weatherModule.WeatherWidget;
      NewsWidget = newsModule.NewsWidget;
    });
  }
  return widgetModulesPromise;
}

// Create a storage wrapper using the preload electronAPI
const _urlParams = new URLSearchParams(window.location.search || "");
const isIncognitoWindow = _urlParams.get("incognito") === "1";
const persistentStorage = createStorage(window.electronAPI);
const storage = isIncognitoWindow
  ? {
      getItem: (key) => persistentStorage.getItem(key),
      setItem: async () => true,
      removeItem: async () => true,
      getAllKeys: () => persistentStorage.getAllKeys?.() || Promise.resolve([]),
    }
  : persistentStorage;
window.storage = storage;

const DARK_THEMES = new Set([
  "theme-dark",
  "theme-dark-purple",
  "theme-dark-nord",
  "theme-dark-forest",
  "theme-dark-rose",
  "theme-dark-sakura",
  "theme-dark-sunny",
]);
const normalizeTheme = (theme) =>
  DARK_THEMES.has(theme) ? theme : "theme-dark";

// Persist tabs under a stable scope so they survive app restarts
const _windowId = _urlParams.get("windowId") || "global";
const storageKey = (key) => `global:${key}`;

// Initialize the history manager to replace inline buffer/flush logic
const historyManager = createHistoryManager(window.electronAPI, {
  readOnly: isIncognitoWindow,
});
historyManager.init().catch(() => {});
window.historyManager = historyManager;

window.addEventListener("DOMContentLoaded", () => {
  if (isIncognitoWindow) {
    document.body.classList.add("incognito-mode");
    document.title = "Vortex — Incognito";
  }
  const resourceControl = document.getElementById("resource-control");
  const resourcePanel = document.getElementById("resource-control-panel");
  const resourceToggle = document.getElementById("resource-control-toggle");
  const resourceClose = document.getElementById("resource-control-close");
  const resourceHideLauncher = document.getElementById(
    "resource-control-hide-launcher",
  );
  const resourceEnabled = document.getElementById("resource-limits-enabled");
  const cpuLimit = document.getElementById("resource-cpu-limit");
  const ramLimit = document.getElementById("resource-ram-limit");
  const networkLimit = document.getElementById("resource-network-limit");
  const cpuValue = document.getElementById("resource-cpu-value");
  const ramValue = document.getElementById("resource-ram-value");
  const networkValue = document.getElementById("resource-network-value");
  const resourceStatus = document.getElementById("resource-limit-status");

  if (resourcePanel && resourceToggle && window.electronAPI?.getResourceLimits) {
    const setPanelOpen = (open) => {
      resourcePanel.hidden = !open;
      resourceToggle.setAttribute("aria-expanded", open ? "true" : "false");
    };
    const updateResourceLabels = () => {
      cpuValue.value = `${cpuLimit.value}%`;
      ramValue.value = `${ramLimit.value} MB`;
      networkValue.value = Number(networkLimit.value) === 0
        ? "Unlimited"
        : `${networkLimit.value} Mbps`;
      const enabled = resourceEnabled.checked;
      cpuLimit.disabled = !enabled;
      ramLimit.disabled = !enabled;
      networkLimit.disabled = !enabled;
      [cpuLimit, ramLimit, networkLimit].forEach((control) => {
        const min = Number(control.min);
        const max = Number(control.max);
        const value = Number(control.value);
        const fill = ((value - min) / (max - min)) * 100;
        control.style.setProperty("--limit-fill", `${fill}%`);
      });
      resourceStatus.textContent = enabled
        ? `CPU ${cpuLimit.value}% · RAM ${ramLimit.value} MB · ${networkValue.value}`
        : "Limiters are off";
    };
    let resourceSaveTimer = null;
    const saveResourceLimits = () => {
      updateResourceLabels();
      clearTimeout(resourceSaveTimer);
      resourceSaveTimer = setTimeout(() => {
        window.electronAPI.setResourceLimits({
          enabled: resourceEnabled.checked,
          cpuPercent: Number(cpuLimit.value),
          ramMB: Number(ramLimit.value),
          networkMbps: Number(networkLimit.value),
        }).catch((error) => {
          resourceStatus.textContent = `Could not apply limits: ${error.message}`;
        });
      }, 180);
    };

    resourceToggle.addEventListener("click", () => setPanelOpen(true));
    resourceClose?.addEventListener("click", () => setPanelOpen(false));
    resourceHideLauncher?.addEventListener("click", async () => {
      await storage.setItem("showResourceControl", "false");
      window.electronAPI.setResourceControlVisibility?.(false);
      resourceControl.hidden = true;
      setPanelOpen(false);
    });
    [resourceEnabled, cpuLimit, ramLimit, networkLimit].forEach((control) => {
      control.addEventListener("input", saveResourceLimits);
      control.addEventListener("change", saveResourceLimits);
    });
    window.electronAPI.getResourceLimits().then((limits) => {
      resourceEnabled.checked = limits.enabled === true;
      cpuLimit.value = String(limits.cpuPercent || 100);
      ramLimit.value = String(limits.ramMB || 1024);
      networkLimit.value = String(limits.networkMbps || 0);
      updateResourceLabels();
    }).catch(() => updateResourceLabels());

    storage.getItem("showResourceControl").then((visible) => {
      resourceControl.hidden = visible === "false";
    });
    window.electronAPI.onResourceControlVisibilityChanged?.((visible) => {
      resourceControl.hidden = visible === false;
      if (!visible) setPanelOpen(false);
    });
  }

  // --- Settings Panel History Logic ---
  const settingsHistoryList = document.getElementById("settings-history-list");
  const clearHistoryBtn = document.getElementById("clear-history-btn");
  if (settingsHistoryList && clearHistoryBtn) {
    async function renderSettingsHistory() {
      perfStart("renderSettingsHistory");
      let history = JSON.parse(
        (await storage.getItem("browserHistory")) || "[]",
      );
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
        console.debug(
          "Failed to merge in-memory history into settings view",
          e,
        );
      }
      history = history.filter((e) => {
        if (!e || !e.url) return false;
        const u = e.url;
        if (u === "newtab") return false;
        if (u.includes("settings.html")) return false;
        if (u.includes("history.html")) return false;
        return true;
      });
      settingsHistoryList.innerHTML = "";
      if (!history.length) {
        settingsHistoryList.innerHTML =
          '<div style="color:#aaa;text-align:center;">No browsing history yet.</div>';
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
            next.forEach((entry) => {
              const item = document.createElement("div");
              item.style.display = "flex";
              item.style.alignItems = "center";
              item.style.padding = "8px 0";
              item.style.borderBottom = "1px solid rgba(0,0,0,0.08)";
              item.style.cursor = "pointer";
              const fav = document.createElement("img");
              const host = getHostFromUrl(entry.url);
              if (host) fav.dataset.faviconHost = host;
              fav.src = getFavicon(entry.url);
              fav.style.width = "18px";
              fav.style.height = "18px";
              fav.style.marginRight = "12px";
              fav.onerror = function () {
                this.src = "icons/newtab.png";
              };
              const title = document.createElement("div");
              title.textContent =
                entry.host && entry.host.length
                  ? entry.host.charAt(0).toUpperCase() + entry.host.slice(1)
                  : getSiteName(entry.url);
              title.style.fontSize = "1em";
              title.style.color = "var(--settings-header-color, #202124)";
              title.style.flex = "1";
              item.appendChild(fav);
              item.appendChild(title);
              item.onclick = () => {
                closeSettingsPanel();
                document.getElementById("url").value = entry.url;
                document.getElementById("url").dispatchEvent(
                  new KeyboardEvent("keydown", {
                    key: "Enter",
                    bubbles: true,
                  }),
                );
              };
              frag2.appendChild(item);
            });
            settingsHistoryList.appendChild(frag2);
            settingsOffset += pageSize;
          };
          if ("requestIdleCallback" in window) {
            window.requestIdleCallback(() => doAppend(), { timeout: 200 });
          } else {
            setTimeout(doAppend, 0);
          }
        }
        appendSettingsHistory();
        // load more when scrolled near bottom
        if (!settingsHistoryList._virtualizationListenerAdded) {
          settingsHistoryList.addEventListener(
            "scroll",
            () => {
              if (
                settingsHistoryList.scrollTop +
                  settingsHistoryList.clientHeight >
                settingsHistoryList.scrollHeight - 200
              ) {
                appendSettingsHistory();
              }
            },
            { passive: true },
          );
          settingsHistoryList._virtualizationListenerAdded = true;
        }
        settingsHistoryList.appendChild(frag);
        perfEnd("renderSettingsHistory");
      }
    }
    // Expose for other windows and modules to request a re-render
    window.renderSettingsHistory = renderSettingsHistory;
    // Render on open
    const origOpenSettingsPanel = openSettingsPanel;
    openSettingsPanel = function () {
      renderSettingsHistory();
      origOpenSettingsPanel();
    };
    // Listen for history updates and re-render the settings history
    if (window.electronAPI && typeof window.electronAPI.on === "function") {
      window.electronAPI.on("history-updated", () => {
        try {
          renderSettingsHistory();
        } catch (e) {}
      });
    }
    // Clear history
    if (isIncognitoWindow) {
      clearHistoryBtn.disabled = true;
      clearHistoryBtn.title = "History cannot be changed from an incognito window";
    }
    clearHistoryBtn.onclick = async () => {
      if (isIncognitoWindow) return;
      if (confirm("Are you sure you want to clear all browsing history?")) {
        try {
          await historyManager.clear();
          try {
            if (
              window.electronAPI &&
              window.electronAPI.broadcastHistoryUpdated
            )
              window.electronAPI.broadcastHistoryUpdated();
          } catch (e) {}
          try {
            if (window.electronAPI && window.electronAPI.requestClearHistory)
              window.electronAPI.requestClearHistory();
          } catch (e) {}
          renderSettingsHistory();
          showUpdateNotification(
            "Browsing history cleared successfully.",
            "success",
            3000,
          );
        } catch (e) {
          // Fallback
          await storage.setItem("browserHistory", "[]");
          try {
            localStorage.setItem("browserHistory", "[]");
          } catch (err) {}
          renderSettingsHistory();
          showUpdateNotification(
            "Browsing history cleared successfully.",
            "success",
            3000,
          );
        }
      }
    };
  }
  // Apply theme immediately to prevent flash
  storage.getItem("theme").then((savedTheme) => {
    const themeToApply = normalizeTheme(savedTheme);
    storage.setItem("theme", themeToApply);
    document.body.className = `${themeToApply}${isIncognitoWindow ? " incognito-mode" : ""}`;
  });

  // Apply UI settings immediately
  storage.getItem("smoothScrolling").then((smoothScrolling) => {
    if (smoothScrolling === "true") {
      document.documentElement.style.scrollBehavior = "smooth";
    }
  });

  storage.getItem("reducedAnimations").then((reducedAnimations) => {
    const reduced = reducedAnimations === "true";
    if (reduced) {
      document.body.classList.add("animations-disabled");
      document.documentElement.style.setProperty("--animation-speed", "0s");
      document.documentElement.style.setProperty("--transition-speed", "0s");
    } else {
      document.body.classList.remove("animations-disabled");
      document.documentElement.style.setProperty("--animation-speed", "0.12s");
      document.documentElement.style.setProperty("--transition-speed", "0.12s");
    }
  });

  storage.getItem("visualEffectsEnabled").then((visualEffectsEnabled) => {
    const effectsEnabled = visualEffectsEnabled !== "false";
    document.body.classList.toggle("effects-disabled", !effectsEnabled);
  });
  // Force web dark mode toggle handling
  const forceWebDarkToggle = document.getElementById("force-web-dark-toggle");
  let forceWebDarkEnabled = false;
  if (forceWebDarkToggle) {
    // Initialize from storage
    storage
      .getItem("forceWebDarkMode")
      .then((saved) => {
        forceWebDarkEnabled = saved === "true";
        try {
          forceWebDarkToggle.checked = forceWebDarkEnabled;
        } catch (e) {}
        try {
          const icon = document.getElementById("force-web-dark-icon");
          if (icon) icon.classList.toggle("active", forceWebDarkEnabled);
        } catch (e) {}
        // Apply to all current tabs (will be applied again on navigation for each view)
        if (
          forceWebDarkEnabled &&
          window.electronAPI &&
          typeof window.electronAPI.applyWebDarkMode === "function"
        ) {
          for (const tab of tabs) {
            try {
              window.electronAPI.applyWebDarkMode(tab.id, true);
            } catch (e) {}
          }
        }
      })
      .catch(() => {});

    forceWebDarkToggle.addEventListener("change", async (e) => {
      forceWebDarkEnabled = !!e.target.checked;
      try {
        await storage.setItem(
          "forceWebDarkMode",
          forceWebDarkEnabled ? "true" : "false",
        );
      } catch (err) {}
      // Apply or remove to all current tabs
      if (
        window.electronAPI &&
        typeof window.electronAPI.applyWebDarkMode === "function"
      ) {
        for (const tab of tabs) {
          try {
            window.electronAPI.applyWebDarkMode(tab.id, forceWebDarkEnabled);
          } catch (err) {}
        }
      }
      try {
        if (
          window.electronAPI &&
          typeof window.electronAPI.broadcastWidgetSettings === "function"
        )
          window.electronAPI.broadcastWidgetSettings(
            "forceWebDark",
            forceWebDarkEnabled,
          );
      } catch (e) {}
      try {
        const icon = document.getElementById("force-web-dark-icon");
        if (icon) icon.classList.toggle("active", forceWebDarkEnabled);
      } catch (e) {}
      // Also ask the main process to apply CSS to all BrowserViews for reliable coverage
      try {
        if (
          window.electronAPI &&
          typeof window.electronAPI.applyWebDarkModeAll === "function"
        )
          await window.electronAPI.applyWebDarkModeAll(forceWebDarkEnabled);
      } catch (e) {
        console.error("applyWebDarkModeAll failed", e);
      }
    });
  }

  // Initialize tab previews setting
  let tabPreviewsEnabled = true; // Default to true
  storage.getItem("showTabPreviews").then((enabled) => {
    tabPreviewsEnabled = enabled !== "false";
    renderTabs(); // Re-render tabs with correct setting
  });

  // Listen for tab previews setting changes
  window.electronAPI?.on?.("tab-previews-setting-changed", (event, enabled) => {
    tabPreviewsEnabled = enabled;
    renderTabs(); // Re-render tabs with new preview setting
  });

  // --- State ---
  // Initialize state asynchronously with persistent storage
  async function initializeState() {
    // Detect if this window should start with a specific URL (opened via Open in New Window)
    try {
      const params = new URLSearchParams(window.location.search || "");
      const newWindowUrl = params.get("newWindowUrl");
      const isFresh = params.get("fresh") === "1";
      console.log(
        "initializeState params newWindowUrl=",
        newWindowUrl,
        "fresh=",
        isFresh,
      );
      if (newWindowUrl) {
        const decoded = decodeURIComponent(newWindowUrl);
        const tabId = Date.now();
        const tabs = [
          {
            id: tabId,
            url: decoded,
            history: [decoded],
            historyIndex: 0,
            viewCreated: false,
          },
        ];
        const currentTabId = tabId;
        const bookmarks = JSON.parse(
          (await storage.getItem("bookmarks")) || "[]",
        );
        const homepage =
          (await storage.getItem("homepage")) || "https://www.google.com";
        const quickLinks = JSON.parse(
          (await storage.getItem("quickLinks")) || "[]",
        );
        // Mark this window as intentionally initialized for a single URL so onNewWindow events are ignored
        try {
          window._isNewWindowTarget = true;
        } catch (e) {}
        if (isFresh) {
          // keep only the specified URL in this window and avoid loading other saved tabs
        }
        try {
          const savedGroups = await storage.getItem(storageKey("tabGroups"));
          if (savedGroups) tabGroups = JSON.parse(savedGroups);
        } catch (_) {}
        return {
          tabs,
          currentTabId,
          bookmarks,
          homepage,
          quickLinks,
          tabGroups: tabGroups,
        };
      }
    } catch (err) {
      /* ignore */
    }
    const configuredHomepage =
      (await storage.getItem("homepage")) || "https://www.google.com";
    const startPage = (await storage.getItem("startPage")) || "newtab";
    let tabs = JSON.parse((await storage.getItem(storageKey("tabs"))) || "[]");
    const params = new URLSearchParams(window.location.search || "");
    const isFresh = params.get("fresh") === "1";
    if (isFresh) {
      console.log("initializeState: fresh window — skipping saved tabs");
      tabs = [
        { id: Date.now(), url: "newtab", history: ["newtab"], historyIndex: 0 },
      ];
    } else if (startPage !== "lastsession") {
      const startupUrl = startPage === "homepage" ? configuredHomepage : "newtab";
      console.log("initializeState: applying configured start page", startPage);
      tabs = [
        {
          id: Date.now(),
          url: startupUrl,
          history: [startupUrl],
          historyIndex: 0,
        },
      ];
    }

    // Validate and clean up tabs
    tabs = tabs.filter((tab) => tab && tab.id && typeof tab.url === "string");

    // If no valid tabs, create default tab
    if (!tabs.length) {
      tabs = [
        { id: Date.now(), url: "newtab", history: ["newtab"], historyIndex: 0 },
      ];
    }

    // Portable builds extract to a version-specific directory. Remap saved
    // internal file URLs from an older extraction path to this running build.
    tabs = tabs.map((tab) => {
      const url = normalizeRestoredInternalUrl(tab.url);
      const history = (Array.isArray(tab.history) && tab.history.length
        ? tab.history
        : [url || "newtab"]
      ).map(normalizeRestoredInternalUrl);
      const historyIndex = Math.min(
        Math.max(Number.isInteger(tab.historyIndex) ? tab.historyIndex : 0, 0),
        history.length - 1,
      );
      return {
        ...tab,
        url,
        history,
        historyIndex,
        viewCreated: false,
      };
    });

    let currentTabId = parseInt(
      (await storage.getItem(storageKey("currentTabId"))) ||
        (tabs.length > 0 ? tabs[0].id : null),
      10,
    );

    // Validate currentTabId exists in tabs
    if (!tabs.find((tab) => tab.id === currentTabId)) {
      currentTabId = tabs[0].id;
    }

    let bookmarks = JSON.parse((await storage.getItem("bookmarks")) || "[]");
    let homepage = configuredHomepage;
    let quickLinks = JSON.parse((await storage.getItem("quickLinks")) || "[]");

    try {
      const savedGroups = await storage.getItem(storageKey("tabGroups"));
      if (savedGroups) tabGroups = JSON.parse(savedGroups);
    } catch (_) {}
    return {
      tabs,
      currentTabId,
      bookmarks,
      homepage,
      quickLinks,
      tabGroups: tabGroups,
    };
  }

  // Initialize with temporary values, will be replaced by async loading
  let tabs = [{ id: Date.now(), url: "newtab", history: [], historyIndex: -1 }];
  let currentTabId = tabs[0].id;
  let bookmarks = [];
  let homepage = "https://www.google.com";
  let quickLinks = [];
  let hibernatedTabIds = new Set();
  let newTabBehaviorSetting = "newtab";
  let searchSuggestionsEnabled = true;
  let currentSearchEngine = "google";

  storage.getItem("newTabBehavior").then((value) => {
    newTabBehaviorSetting = ["newtab", "homepage", "blank"].includes(value)
      ? value
      : "newtab";
  });
  storage.getItem("searchSuggestions").then((value) => {
    searchSuggestionsEnabled = value !== "false";
  });
  storage.getItem("searchEngine").then((value) => {
    currentSearchEngine = ["google", "bing", "duckduckgo"].includes(value)
      ? value
      : "google";
  });
  storage.getItem("fontSize").then((value) => {
    if (value) document.documentElement.style.setProperty("--base-font-size", `${value}px`);
  });
  window.electronAPI?.onStorageItemChanged?.(({ key, value }) => {
    if (key === "newTabBehavior") newTabBehaviorSetting = value;
    if (key === "searchSuggestions") {
      searchSuggestionsEnabled = value !== "false";
      if (!searchSuggestionsEnabled) hideOmniboxSuggestions();
    }
    if (key === "searchEngine") currentSearchEngine = value;
    if (key === "fontSize")
      document.documentElement.style.setProperty("--base-font-size", `${value}px`);
    if (key === "visualEffectsEnabled")
      document.body.classList.toggle("effects-disabled", value === "false");
    if (key === "showResourceControl" && resourceControl) {
      resourceControl.hidden = value === "false";
      if (value === "false") {
        if (resourcePanel) resourcePanel.hidden = true;
        resourceToggle?.setAttribute("aria-expanded", "false");
      }
    }
  });

  // Tab groups state
  const GROUP_COLORS = [
    { name: "Red", value: "#ef4444" },
    { name: "Orange", value: "#f97316" },
    { name: "Yellow", value: "#eab308" },
    { name: "Green", value: "#22c55e" },
    { name: "Teal", value: "#14b8a6" },
    { name: "Blue", value: "#3b82f6" },
    { name: "Purple", value: "#a855f7" },
    { name: "Pink", value: "#ec4899" },
  ];
  let tabGroups = {}; // { [groupId]: { id, name, color, collapsed } }

  function isValidGroupColor(color) {
    return (
      typeof color === "string" &&
      (/^#[0-9a-f]{6}$/i.test(color) ||
        GROUP_COLORS.some((groupColor) => groupColor.value === color))
    );
  }

  function getLiveGroupIds() {
    const liveGroupIds = new Set();
    tabs.forEach((tab) => {
      if (tab.groupId && tabGroups[tab.groupId]) {
        liveGroupIds.add(tab.groupId);
      }
    });
    return liveGroupIds;
  }

  function normalizeTabGroups({ persist = false } = {}) {
    let changed = false;
    const normalizedGroups = {};

    if (!tabGroups || typeof tabGroups !== "object" || Array.isArray(tabGroups)) {
      tabGroups = {};
      changed = true;
    }

    Object.entries(tabGroups).forEach(([id, group]) => {
      if (!id || !group || typeof group !== "object") {
        changed = true;
        return;
      }

      const name =
        typeof group.name === "string" && group.name.trim()
          ? group.name.trim()
          : "Group";
      const color = isValidGroupColor(group.color) ? group.color : "#3b82f6";
      const normalizedGroup = {
        id,
        name,
        color,
        collapsed: !!group.collapsed,
      };
      normalizedGroups[id] = normalizedGroup;

      if (
        group.id !== id ||
        group.name !== name ||
        group.color !== color ||
        group.collapsed !== normalizedGroup.collapsed
      ) {
        changed = true;
      }
    });

    tabGroups = normalizedGroups;

    tabs.forEach((tab) => {
      if (tab.groupId && !tabGroups[tab.groupId]) {
        delete tab.groupId;
        changed = true;
      }
    });

    const liveGroupIds = getLiveGroupIds();
    Object.keys(tabGroups).forEach((groupId) => {
      if (!liveGroupIds.has(groupId)) {
        delete tabGroups[groupId];
        changed = true;
      }
    });

    if (changed && persist) {
      persistGroups();
      persistTabs();
    }
    return changed;
  }

  function getVisibleGroupIds() {
    normalizeTabGroups();
    return Array.from(getLiveGroupIds());
  }

  function setHibernatedTabIds(ids = []) {
    const nextIds = new Set(
      (Array.isArray(ids) ? ids : []).map((id) => Number(id)),
    );
    const changed =
      nextIds.size !== hibernatedTabIds.size ||
      Array.from(nextIds).some((id) => !hibernatedTabIds.has(id));
    hibernatedTabIds = nextIds;
    if (changed) {
      renderTabs();
    }
  }

  async function refreshHibernationState() {
    if (
      !window.electronAPI ||
      typeof window.electronAPI.getMemoryUsage !== "function"
    )
      return;
    try {
      const memoryInfo = await window.electronAPI.getMemoryUsage();
      setHibernatedTabIds(memoryInfo?.hibernatedTabs || []);
    } catch (error) {
      console.debug("Failed to refresh hibernation state", error);
    }
  }

  // Global drop zone for cross-window tab drops
  document.body.addEventListener(
    "dragover",
    (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
    },
    { passive: false },
  );

  function getExternalDragMetaForDrop() {
    const meta = window._externalDraggedTabMeta;
    if (!meta) return null;
    const sourceWinId = Number(meta.sourceWinId);
    const thisWinId = Number(_windowId);
    if (
      Number.isFinite(sourceWinId) &&
      Number.isFinite(thisWinId) &&
      sourceWinId === thisWinId
    ) {
      return null;
    }
    return {
      ...meta,
      transferId: window._currentDragTransferId || meta.transferId,
    };
  }

  document.body.addEventListener("drop", (e) => {
    const externalMeta = getExternalDragMetaForDrop();
    if (externalMeta) {
      e.preventDefault();
      e.stopPropagation();
      console.log(
        "[DND] body drop handler - external tab with stored transferId:",
        externalMeta,
      );

      if (window.electronAPI && window.electronAPI.tabDroppedHere) {
        window.electronAPI.tabDroppedHere(externalMeta);
        window._tabDropHandled = true;
        console.log("[DND] body drop - called tabDroppedHere");
      }
    }
  });

  // Load actual state asynchronously
  initializeState()
    .then((actualState) => {
      tabs = actualState.tabs;
      currentTabId = actualState.currentTabId;
      if (actualState.tabGroups) tabGroups = actualState.tabGroups;
      bookmarks = actualState.bookmarks;
      homepage = actualState.homepage;
      quickLinks = actualState.quickLinks;
      normalizeTabGroups({ persist: true });

      // Mark all tabs as needing view recreation since they're loaded from storage
      tabs.forEach((tab) => {
        tab.viewCreated = false;
      });

      // Re-render UI with loaded state
      renderTabs();
      renderBookmarkBar();
      switchTab(currentTabId);
      refreshHibernationState();
      // Notify main that the renderer UI is fully initialized and ready to accept attachments
      try {
        if (
          window.electronUI &&
          typeof window.electronUI.uiReady === "function"
        )
          window.electronUI.uiReady();
      } catch (err) {}
    })
    .catch((error) => {
      console.error("Error loading persistent state:", error);
    });

  // --- Auto-Updater Communication ---
  let updateState = {
    checking: false,
    downloading: false,
    available: false,
    downloaded: false,
    lastNotification: 0,
  };

  if (window.electronAPI) {
    window.electronAPI.on("hibernation-state-changed", (_event, ids) => {
      setHibernatedTabIds(ids || []);
    });

    // Listen for debug info from main process
    window.electronAPI.onAutoUpdaterDebugInfo((debugInfo) => {
      // Debug info received - could be logged to dev console if needed
    });

    // Listen for update events
    window.electronAPI.onUpdateChecking(() => {
      if (!updateState.checking) {
        showUpdateNotification("Checking for updates...", "info", 3000);
        updateState.checking = true;
        updateState.downloading = false;
        updateState.available = false;
        updateState.downloaded = false;
      }
    });

    window.electronAPI.onUpdateAvailable((info) => {
      const now = Date.now();
      if ((window.__updateSilence || 0) > Date.now()) {
        console.debug(
          "Update notification silenced until",
          window.__updateSilence,
        );
        return;
      }
      if (!updateState.available && now - updateState.lastNotification > 5000) {
        showUpdateNotification(
          `Update v${info.version} found. Downloading...`,
          "info",
          4000,
        );
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
        showUpdateNotification("You have the latest version!", "info", 3000);
        updateState = {
          checking: false,
          downloading: false,
          available: false,
          downloaded: false,
          lastNotification: Date.now(),
        };
      }
    });

    window.electronAPI.onUpdateError((message) => {
      if ((window.__updateSilence || 0) > Date.now()) return;
      console.error("Update error:", message);
      showUpdateNotification(`Update error: ${message}`, "error");
      updateState = {
        checking: false,
        downloading: false,
        available: false,
        downloaded: false,
        lastNotification: Date.now(),
      };
    });

    // Track progress in 10% increments to avoid too many UI updates
    window.electronAPI.onUpdateDownloadProgress((progress) => {
      if ((window.__updateSilence || 0) > Date.now()) return;
      if (updateState.downloading) {
        const percent = Math.round(progress.percent);
        if (!updateState.lastPercent) updateState.lastPercent = 0;
        // Only update progress when it increases by at least 10% or reaches 100%
        if (percent === 100 || percent >= updateState.lastPercent + 10) {
          updateState.lastPercent = percent;
          updateState.lastNotification = Date.now();
        }
      }
    });

    window.electronAPI.onUpdateDownloaded((info) => {
      const now = Date.now();
      if (
        !updateState.downloaded &&
        now - updateState.lastNotification > 2000
      ) {
        console.log("Update downloaded:", info);

        // Small delay to ensure progress notification is visible
        setTimeout(() => {
          showUpdateNotification(
            `Update v${info.version} ready to install. Click to restart and install.`,
            "success",
            0,
            () => {
              if (updateState.installing) return;
              updateState.installing = true;
              console.log("Install button clicked");
              window.electronAPI
                .installUpdate()
                .then((result) => {
                  if (result && result.success === false) {
                    updateState.installing = false;
                    showUpdateNotification(result.error || "Unable to install update.", "error");
                    return;
                  }
                  console.log("Install update called successfully");
                })
                .catch((err) => {
                  updateState.installing = false;
                  console.error("Install update failed:", err);
                });
            },
          );
          updateState.downloaded = true;
          updateState.downloading = false;
          updateState.lastPercent = 100;
          updateState.lastNotification = now;
        }, 1000);
      }
    });

    window.electronAPI.on("adblock-state-changed", (_event, enabled) => {
      const normalized =
        typeof enabled === "object" && enabled !== null
          ? {
              enabled: !!enabled.enabled,
              mode: enabled.mode === "strict" ? "strict" : "balanced",
            }
          : {
              enabled: !!enabled,
              mode:
                localStorage.getItem("adblockMode") === "strict"
                  ? "strict"
                  : "balanced",
            };

      try {
        localStorage.setItem(
          "adblockEnabled",
          normalized.enabled ? "true" : "false",
        );
        localStorage.setItem("adblockMode", normalized.mode);
      } catch (_error) {}

      const toggle = document.getElementById("adblock-toggle");
      if (toggle) toggle.checked = normalized.enabled;
      const strictToggle = document.getElementById("adblock-strict-toggle");
      if (strictToggle) strictToggle.checked = normalized.mode === "strict";

      for (const webview of tabWebviews.values()) {
        applyAdBlockCosmetics(webview);
      }
    });

    // Listen for widget settings changes from other windows (like settings page)
    if (window.electronAPI && window.electronAPI.onWidgetSettingsChanged) {
      window.electronAPI.onWidgetSettingsChanged(async (data) => {
        if (data.widget === "forceWebDark") {
          try {
            forceWebDarkToggle.checked = !!data.enabled;
            forceWebDarkEnabled = !!data.enabled;
          } catch (e) {}
          // Apply to all current tabs if enabled/disabled
          if (
            window.electronAPI &&
            typeof window.electronAPI.applyWebDarkMode === "function"
          ) {
            for (const tab of tabs) {
              try {
                window.electronAPI.applyWebDarkMode(tab.id, !!data.enabled);
              } catch (err) {}
            }
          }
          // Update toolbar icon
          try {
            const icon = document.getElementById("force-web-dark-icon");
            if (icon) icon.classList.toggle("active", !!data.enabled);
          } catch (e) {}
        }
        if (data.widget === "reducedAnimations") {
          const reduced = !!data.enabled;
          document.body.classList.toggle("animations-disabled", reduced);
          document.documentElement.style.setProperty(
            "--animation-speed",
            reduced ? "0s" : "0.12s",
          );
          document.documentElement.style.setProperty(
            "--transition-speed",
            reduced ? "0s" : "0.12s",
          );
        }
        if (data.widget === "visualEffects") {
          const effectsEnabled = !!data.enabled;
          document.body.classList.toggle("effects-disabled", !effectsEnabled);
        }
        if (data.widget === "weatherUpdate") {
          await loadWidgetModules();
          // Reload weather widget when location settings change
          const weatherWidget = document.querySelector("#weather-widget");
          if (weatherWidget && !weatherWidget.classList.contains("hidden")) {
            // Create a new weather widget instance which will use updated settings
            const widget = new WeatherWidget();
            weatherWidget.weatherWidgetInstance = widget;
          }
        }
      });
    }
  }

  // --- DOM Elements ---
  const urlInput = document.getElementById("url");
  const connectionInfoBtn = document.getElementById("connection-info-btn");
  const connectionInfoIcon = document.getElementById("connection-info-icon");
  const connectionInfoPanel = document.getElementById("connection-info-panel");
  const connectionInfoLargeIcon = document.getElementById("connection-info-large-icon");
  const connectionInfoTitle = document.getElementById("connection-info-title");
  const connectionInfoOrigin = document.getElementById("connection-info-origin");
  const connectionInfoMessage = document.getElementById("connection-info-message");
  const connectionInfoDetail = document.getElementById("connection-info-detail");
  const connectionHoverTooltip = document.getElementById("connection-hover-tooltip");
  const mediaControlsBtn = document.getElementById("media-controls-btn");
  const mediaControlsPanel = document.getElementById("media-controls-panel");
  const mediaPanelTitle = document.getElementById("media-panel-title");
  const mediaPanelState = document.getElementById("media-panel-state");
  const mediaPanelMessage = document.getElementById("media-panel-message");
  const mediaPlayPauseBtn = document.getElementById("media-play-pause");
  const mediaMuteBtn = document.getElementById("media-mute");
  const mediaPipBtn = document.getElementById("media-pip");

  function syncMediaControlsVisibility() {
    const tab = tabs.find((item) => item.id === currentTabId);
    if (!mediaControlsBtn) return;
    mediaControlsBtn.hidden = !(tab?.hasMedia || tab?.audible || tab?.muted);
    mediaControlsBtn.classList.toggle("is-playing", !!tab?.audible && !tab?.muted);
    if (mediaMuteBtn) mediaMuteBtn.textContent = tab?.muted ? "Unmute tab" : "Mute tab";
  }

  async function queryActiveMediaState() {
    const webview = getActiveWebview();
    if (!webview?.executeJavaScript) return null;
    try {
      return await webview.executeJavaScript(`(() => {
        const items = Array.from(document.querySelectorAll('video, audio'));
        const media = items.find(item => !item.paused && !item.ended) || items[0];
        if (!media) return null;
        return {
          paused: media.paused,
          isVideo: media.tagName === 'VIDEO',
          pip: !!document.pictureInPictureElement,
          title: document.title || 'Media in this tab'
        };
      })()`, false);
    } catch (_error) {
      return null;
    }
  }

  async function runActiveMediaAction(action) {
    const webview = getActiveWebview();
    if (!webview?.executeJavaScript) return { ok: false, message: "No active media" };
    try {
      return await webview.executeJavaScript(`(async () => {
        const items = Array.from(document.querySelectorAll('video, audio'));
        const media = items.find(item => !item.paused && !item.ended) || items[0];
        if (!media) return { ok: false, message: 'No playable media was found on this page.' };
        if (${JSON.stringify(action)} === 'play-pause') {
          if (media.paused) await media.play(); else media.pause();
          return { ok: true, paused: media.paused };
        }
        if (${JSON.stringify(action)} === 'pip') {
          if (media.tagName !== 'VIDEO' || !document.pictureInPictureEnabled) return { ok: false, message: 'Picture-in-Picture is unavailable for this media.' };
          if (document.pictureInPictureElement) await document.exitPictureInPicture();
          else await media.requestPictureInPicture();
          return { ok: true, pip: !!document.pictureInPictureElement };
        }
        return { ok: false, message: 'Unknown media action.' };
      })()`, true);
    } catch (_error) {
      return { ok: false, message: "The website blocked that media action." };
    }
  }

  async function refreshMediaPanel() {
    const state = await queryActiveMediaState();
    const tab = tabs.find((item) => item.id === currentTabId);
    mediaPanelTitle.textContent = state?.title || tab?.title || "Media in this tab";
    mediaPanelState.textContent = state?.paused ? "Paused" : "Playing";
    mediaPlayPauseBtn.textContent = state?.paused ? "Play" : "Pause";
    mediaPipBtn.disabled = !state?.isVideo;
    mediaPipBtn.textContent = state?.pip ? "Exit picture in picture" : "Picture in picture";
    mediaMuteBtn.textContent = tab?.muted ? "Unmute tab" : "Mute tab";
  }

  function getConnectionState(rawUrl) {
    try {
      const parsed = new URL(rawUrl);
      if (parsed.protocol === "https:") {
        return {
          type: "secure", icon: "connection-lock-icon", title: "Connection is secure",
          tooltip: "View site information (secure)", origin: parsed.hostname,
          message: "Your information, such as passwords or payment details, is private when sent to this site.",
          detail: "The connection to this site is encrypted with HTTPS.",
        };
      }
      if (parsed.protocol === "http:") {
        return {
          type: "insecure", icon: "connection-warning-icon", title: "Connection is not secure",
          tooltip: "Not secure", origin: parsed.hostname,
          message: "Do not enter sensitive information on this site. It could be viewed or changed by others.",
          detail: "This site is using an unencrypted HTTP connection.",
        };
      }
      return { type: "internal", icon: "connection-info-icon-vector", title: "Vortex page", tooltip: "Vortex page", origin: "", message: "This is a local browser page.", detail: "No website connection is being used." };
    } catch (_error) {
      return { type: "internal", icon: "connection-info-icon-vector", title: "No site information", tooltip: "No site information", origin: "", message: "Open a website to view its connection information.", detail: "" };
    }
  }

  function updateConnectionInfo(rawUrl) {
    const state = getConnectionState(rawUrl);
    connectionInfoBtn.dataset.state = state.type;
    connectionInfoBtn.dataset.tooltip = state.tooltip;
    connectionInfoBtn.setAttribute("aria-label", state.tooltip);
    connectionInfoIcon.querySelector("use").setAttribute("href", `#${state.icon}`);
    connectionInfoLargeIcon.querySelector("use").setAttribute("href", `#${state.icon}`);
    connectionInfoTitle.textContent = state.title;
    connectionInfoOrigin.textContent = state.origin;
    connectionInfoMessage.textContent = state.message;
    connectionInfoDetail.textContent = state.detail;
  }
  // Ensure url input is focusable for keyboard navigation
  try {
    if (urlInput && typeof urlInput.setAttribute === "function") {
      urlInput.setAttribute("tabindex", "0");
    }
  } catch (e) {}
  const backBtn = document.getElementById("back");
  const forwardBtn = document.getElementById("forward");
  const bookmarkAddBtn = document.getElementById("bookmark-add");
  const bookmarkBar = document.getElementById("bookmark-bar");
  const tabsDiv = document.getElementById("tabs");
  const setHomeBtn = document.getElementById("set-home");

  // Create group management button
  const groupMgmtBtn = document.createElement("button");
  groupMgmtBtn.id = "group-mgmt-btn";
  groupMgmtBtn.textContent = "\u25be";
  groupMgmtBtn.title = "Tab groups";
  groupMgmtBtn.setAttribute("aria-label", "Tab groups");
  groupMgmtBtn.setAttribute("aria-expanded", "false");
  groupMgmtBtn.style.cssText = `
    position: absolute;
    left: 6px;
    top: 8px;
    display: none;
    z-index: 100;
  `;
  groupMgmtBtn.onclick = (e) => {
    e.stopPropagation();
    if (_groupMgmtMenu) {
      closeGroupManagementMenu();
      return;
    }
    showGroupManagementMenu(e, groupMgmtBtn);
  };
  tabsDiv.parentElement.appendChild(groupMgmtBtn);
  const newTabPage = document.getElementById("newtab");
  const contentWebview = document.getElementById("content-webview");
  const mainContent = document.getElementById("main-content");
  const quickLinksDiv = document.getElementById("quick-links");
  const reloadBtn = document.getElementById("reload");

  const BUILT_IN_WALLPAPERS = new Set([
    "wallpapers/desert-stars.jpg",
    "wallpapers/aurora-lake.jpg",
    "wallpapers/mountain-twilight.jpg",
  ]);

  function normalizeNewTabBackground(background) {
    if (background?.type === "built-in" && BUILT_IN_WALLPAPERS.has(background.value)) {
      return background;
    }
    if (
      background?.type === "custom" &&
      /^data:image\/(?:jpeg|png|webp);base64,/i.test(background.value || "")
    ) {
      return background;
    }
    return { type: "color", value: "" };
  }

  function applyNewTabBackground(background) {
    if (!newTabPage) return;
    const normalized = normalizeNewTabBackground(background);
    if (normalized.type === "color") {
      newTabPage.classList.remove("has-wallpaper");
      newTabPage.style.removeProperty("background-image");
      return;
    }
    const imageUrl = normalized.value.replaceAll('"', '%22');
    newTabPage.classList.add("has-wallpaper");
    newTabPage.style.backgroundImage =
      `linear-gradient(rgba(10, 10, 13, 0.46), rgba(10, 10, 13, 0.62)), url("${imageUrl}")`;
  }

  storage.getItem("newTabBackground").then((saved) => {
    try {
      applyNewTabBackground(JSON.parse(saved || "null"));
    } catch (_error) {
      applyNewTabBackground(null);
    }
  });

  window.electronAPI?.onNewTabBackgroundChanged?.((background) => {
    storage.setItem("newTabBackground", JSON.stringify(background));
    applyNewTabBackground(background);
  });
  const settingsBtn = document.getElementById("settings");
  const historyBtn = document.getElementById("history-btn");
  const controlsDiv = document.getElementById("controls"); // Add controls div reference
  mediaControlsBtn?.addEventListener("click", async (event) => {
    event.stopPropagation();
    const opening = mediaControlsPanel.hidden;
    mediaControlsPanel.hidden = !opening;
    mediaControlsBtn.setAttribute("aria-expanded", String(opening));
    if (opening) {
      mediaPanelMessage.textContent = "";
      await refreshMediaPanel();
    }
  });
  mediaPlayPauseBtn?.addEventListener("click", async () => {
    const result = await runActiveMediaAction("play-pause");
    mediaPanelMessage.textContent = result.message || "";
    await refreshMediaPanel();
  });
  mediaMuteBtn?.addEventListener("click", () => {
    toggleTabMuted(currentTabId);
    refreshMediaPanel();
  });
  mediaPipBtn?.addEventListener("click", async () => {
    const result = await runActiveMediaAction("pip");
    mediaPanelMessage.textContent = result.message || (result.pip ? "Picture-in-Picture started." : "Picture-in-Picture closed.");
    await refreshMediaPanel();
  });
  document.addEventListener("click", (event) => {
    if (mediaControlsPanel?.hidden || mediaControlsPanel.contains(event.target) || mediaControlsBtn?.contains(event.target)) return;
    mediaControlsPanel.hidden = true;
    mediaControlsBtn.setAttribute("aria-expanded", "false");
  });
  connectionInfoBtn?.addEventListener("click", (event) => {
    event.stopPropagation();
    connectionHoverTooltip.hidden = true;
    const opening = connectionInfoPanel.hidden;
    connectionInfoPanel.hidden = !opening;
    connectionInfoBtn.setAttribute("aria-expanded", String(opening));
    if (opening) updateConnectionInfo(urlInput.value);
  });
  connectionInfoBtn?.addEventListener("mouseenter", () => {
    const rect = connectionInfoBtn.getBoundingClientRect();
    connectionHoverTooltip.textContent = connectionInfoBtn.dataset.tooltip;
    connectionHoverTooltip.style.left = `${Math.max(8, rect.left)}px`;
    connectionHoverTooltip.style.top = `${rect.bottom + 8}px`;
    connectionHoverTooltip.hidden = false;
  });
  connectionInfoBtn?.addEventListener("mouseleave", () => {
    connectionHoverTooltip.hidden = true;
  });
  connectionInfoBtn?.addEventListener("focus", () => {
    const rect = connectionInfoBtn.getBoundingClientRect();
    connectionHoverTooltip.textContent = connectionInfoBtn.dataset.tooltip;
    connectionHoverTooltip.style.left = `${Math.max(8, rect.left)}px`;
    connectionHoverTooltip.style.top = `${rect.bottom + 8}px`;
    connectionHoverTooltip.hidden = false;
  });
  connectionInfoBtn?.addEventListener("blur", () => {
    connectionHoverTooltip.hidden = true;
  });
  document.addEventListener("click", (event) => {
    if (connectionInfoPanel?.hidden || event.target.closest?.("#url-bar-shell")) return;
    connectionInfoPanel.hidden = true;
    connectionInfoBtn?.setAttribute("aria-expanded", "false");
  });
  // Recover URL focus only when clicking non-interactive empty space in controls.
  try {
    if (controlsDiv && urlInput) {
      controlsDiv.addEventListener("click", (event) => {
        const target = event.target;
        if (target === urlInput) return;
        if (target && typeof target.closest === "function") {
          const interactiveTarget = target.closest(
            'button, input, select, textarea, a, [role="button"], .url-suggestions-popup',
          );
          if (interactiveTarget) return;
        }
        try {
          urlInput.focus();
        } catch (e) {}
      });
    }
  } catch (e) {}

  function isSkippableHistoryUrl(u) {
    if (!u) return true;
    try {
      const parsed = new URL(u);
      const pathname = parsed.pathname || "";
      if (
        pathname.endsWith("/settings.html") ||
        pathname.endsWith("/history.html")
      )
        return true;
      if (u.includes("settings.html") || u.includes("history.html"))
        return true;
    } catch (e) {
      if (u === "newtab" || u === "settings.html" || u === "history.html")
        return true;
    }
    return u === "newtab";
  }

  function isInternalAppPageUrl(url) {
    if (!url || typeof url !== "string") return false;
    try {
      const parsed = new URL(url, window.location.href);
      const path = (parsed.pathname || "").toLowerCase();
      return path.endsWith("/settings.html") || path.endsWith("/history.html");
    } catch (_error) {
      const lower = url.toLowerCase();
      return (
        lower === "settings.html" ||
        lower === "history.html" ||
        lower.includes("settings.html") ||
        lower.includes("history.html")
      );
    }
  }

  const tabWebviews = new Map();

  function getActiveWebview() {
    return tabWebviews.get(currentTabId) || null;
  }

  function toggleWebviewDevTools(webview) {
    try {
      if (webview && typeof webview.isDevToolsOpened === "function") {
        if (webview.isDevToolsOpened()) {
          webview.closeDevTools();
        } else {
          webview.openDevTools();
        }
        return;
      }
    } catch (error) {
      console.error("Failed to toggle webview DevTools", error);
    }

    if (
      window.electronAPI &&
      typeof window.electronAPI.toggleDevTools === "function"
    ) {
      window.electronAPI.toggleDevTools();
    }
  }

  function registerWebviewDevToolsShortcut(webview) {
    try {
      if (
        !webview ||
        !window.electronAPI ||
        typeof window.electronAPI.registerWebviewDevToolsShortcut !==
          "function" ||
        typeof webview.getWebContentsId !== "function"
      ) {
        return;
      }

      const webContentsId = webview.getWebContentsId();
      if (
        !webContentsId ||
        webview._devToolsShortcutWebContentsId === webContentsId
      ) {
        return;
      }

      webview._devToolsShortcutWebContentsId = webContentsId;
      window.electronAPI.registerWebviewDevToolsShortcut(webContentsId);
    } catch (error) {
      console.error("Failed to register webview DevTools shortcut", error);
    }
  }

  function showOnlyTabWebview(tabId) {
    tabWebviews.forEach((webview, id) => {
      const isActive = id === tabId;
      // Keep webviews composited while hidden to avoid a white repaint flash.
      webview.style.display = "flex";
      webview.style.visibility = isActive ? "visible" : "hidden";
      webview.style.pointerEvents = isActive ? "auto" : "none";
    });
  }

  function removeTabWebview(tabId) {
    const webview = tabWebviews.get(tabId);
    if (!webview) return;
    tabWebviews.delete(tabId);
    if (webview === contentWebview) {
      try {
        webview.stop();
      } catch (e) {}
      webview.style.display = "none";
      webview.style.visibility = "hidden";
      webview.style.pointerEvents = "none";
      return;
    }
    try {
      webview.remove();
    } catch (e) {}
  }

  function getTabDisplayTitle(tab) {
    if (tab?.isIncognito) return "(Incognito)";
    const url = String(tab?.url || "").toLowerCase();
    if (url.includes("history.html")) return "History";
    if (url.includes("settings.html")) return "Settings";
    if (url === "newtab") return "New Tab";
    return tab?.title || tab?.url || "New Tab";
  }

  function normalizeRestoredInternalUrl(url) {
    if (!url || typeof url !== "string" || url === "newtab") return url;
    try {
      const parsed = new URL(url, window.location.href);
      if (parsed.protocol !== "file:") return url;
      const fileName = (parsed.pathname.split("/").pop() || "").toLowerCase();
      if (fileName !== "settings.html" && fileName !== "history.html") {
        return url;
      }
      const currentUrl = new URL(fileName, window.location.href);
      currentUrl.search = parsed.search;
      currentUrl.hash = parsed.hash;
      return currentUrl.href;
    } catch (_error) {
      return url;
    }
  }

  async function applyAdBlockCosmetics(webview) {
    if (!webview || !window.electronAPI?.getAdBlockCosmetics) return;

    const updateId = (webview._adBlockCssUpdateId || 0) + 1;
    webview._adBlockCssUpdateId = updateId;
    if (webview._adBlockCssKey) {
      try {
        await webview.removeInsertedCSS(webview._adBlockCssKey);
      } catch (_error) {}
      webview._adBlockCssKey = null;
    }

    if (localStorage.getItem("adblockEnabled") !== "true") return;

    try {
      const styles = await window.electronAPI.getAdBlockCosmetics(webview.getURL());
      if (!styles || webview._adBlockCssUpdateId !== updateId) return;
      webview._adBlockCssKey = await webview.insertCSS(styles);
    } catch (_error) {
      // Navigations can replace the guest while its filters are being resolved.
    }
  }

  function bindWebviewEvents(webview, tabId) {
    if (!webview || webview._listenersBound) return;

    webview.addEventListener("dom-ready", () => {
      registerWebviewDevToolsShortcut(webview);
      applyAdBlockCosmetics(webview);
      const tab = tabs.find((item) => item.id === tabId);
      if (tab?.muted) webview.setAudioMuted?.(true);
    });

    webview.addEventListener("media-started-playing", () => {
      const tab = tabs.find((item) => item.id === tabId);
      if (!tab) return;
      tab.audible = true;
      tab.hasMedia = true;
      tab.muted = webview.isAudioMuted?.() === true;
      renderTabs();
      if (tab.id === currentTabId) syncMediaControlsVisibility();
    });

    webview.addEventListener("media-paused", () => {
      const tab = tabs.find((item) => item.id === tabId);
      if (!tab) return;
      tab.audible = false;
      renderTabs();
      if (tab.id === currentTabId) syncMediaControlsVisibility();
    });

    window.electronAPI.on("guest-open-url", (_event, url) => {
      if (typeof url === "string" && /^https?:\/\//i.test(url)) newTab(url);
    });

    webview.addEventListener("before-input-event", (event) => {
      const input = event && event.input ? event.input : {};
      if (input.type === "keyDown" && input.key === "F12") {
        event.preventDefault();
        toggleWebviewDevTools(webview);
      }
    });

    const handleTrackedNavigation = (url) => {
      if (!url) return;
      const tab = tabs.find((t) => t.id === tabId);
      if (!tab) return;

      if (tab.url !== url) tab.title = "";
      tab.url = url;
      if (tab._pendingHistoryDirection) {
        const direction = tab._pendingHistoryDirection;
        const limit = direction < 0 ? -1 : tab.history.length;
        let matchingIndex = tab.historyIndex + direction;
        while (matchingIndex !== limit && tab.history[matchingIndex] !== url) {
          matchingIndex += direction;
        }
        if (matchingIndex !== limit) {
          tab.historyIndex = matchingIndex;
        } else {
          tab.historyIndex = Math.max(0, Math.min(tab.history.length - 1, tab.historyIndex + direction));
          tab.history[tab.historyIndex] = url;
        }
        delete tab._pendingHistoryDirection;
      } else if (Number.isInteger(tab._pendingNavigationIndex)) {
        const navigationIndex = Math.max(0, Math.min(tab.history.length - 1, tab._pendingNavigationIndex));
        tab.history[navigationIndex] = url;
        tab.historyIndex = navigationIndex;
        delete tab._pendingNavigationIndex;
      } else if (tab.history[tab.historyIndex] !== url) {
        tab.history = tab.history.slice(0, tab.historyIndex + 1);
        tab.history.push(url);
        tab.historyIndex = tab.history.length - 1;
      }

      if (tab.id === currentTabId) {
        urlInput.value = url;
        updateConnectionInfo(url);
      }

      persistTabs();
      updateTabPresentation(tab);

      if (
        !tab.isIncognito &&
        !isIncognitoWindow &&
        !isSkippableHistoryUrl(url)
      ) {
        try {
          const host = (() => {
            try {
              return new URL(url).hostname.replace(/^www\./, "");
            } catch (e) {
              return url;
            }
          })();
          historyManager.addToHistory({
            url,
            title: url,
            host,
            timestamp: Date.now(),
          });
          if (
            document.getElementById("settings-panel") &&
            document
              .getElementById("settings-panel")
              .classList.contains("active")
          ) {
            try {
              renderSettingsHistory();
            } catch (e) {}
          }
        } catch (e) {
          console.error("historyManager.addToHistory failed (webview)", e);
        }
      }
    };

    webview.addEventListener("did-navigate", (event) => {
      handleTrackedNavigation(event.url);
    });

    webview.addEventListener("did-navigate-in-page", (event) => {
      if (event.isMainFrame === false) return;
      handleTrackedNavigation(event.url);
    });

    webview.addEventListener("page-title-updated", (event) => {
      const tab = tabs.find((t) => t.id === tabId);
      if (!tab || tab.url === "newtab") return;
      tab.title = event.title;
      historyManager.updateTitle(tab.url, event.title).catch(() => {});
      persistTabs();
      updateTabPresentation(tab);
    });

    webview.addEventListener(
      "mousedown",
      () => {
        closeSettingsPanelIfOpen({ restoreUrlFocus: false });
        closeQuickHistoryPanelIfOpen({ restoreUrlFocus: false });
        closeGroupManagementMenu();
        const shieldPanel = document.getElementById("privacy-shield-panel");
        const shieldButton = document.getElementById("privacy-shield-btn");
        if (shieldPanel && !shieldPanel.hidden) {
          shieldPanel.hidden = true;
          shieldButton?.setAttribute("aria-expanded", "false");
        }
        const connectionPanel = document.getElementById("connection-info-panel");
        const connectionButton = document.getElementById("connection-info-btn");
        if (connectionPanel && !connectionPanel.hidden) {
          connectionPanel.hidden = true;
          connectionButton?.setAttribute("aria-expanded", "false");
        }
        const mediaPanel = document.getElementById("media-controls-panel");
        const mediaButton = document.getElementById("media-controls-btn");
        if (mediaPanel && !mediaPanel.hidden) {
          mediaPanel.hidden = true;
          mediaButton?.setAttribute("aria-expanded", "false");
        }
      },
      { passive: true },
    );

    webview.addEventListener("focus", () => {
      closeSettingsPanelIfOpen({ restoreUrlFocus: false });
      closeQuickHistoryPanelIfOpen({ restoreUrlFocus: false });
      closeGroupManagementMenu();
      const shieldPanel = document.getElementById("privacy-shield-panel");
      const shieldButton = document.getElementById("privacy-shield-btn");
      if (shieldPanel && !shieldPanel.hidden) {
        shieldPanel.hidden = true;
        shieldButton?.setAttribute("aria-expanded", "false");
      }
      const connectionPanel = document.getElementById("connection-info-panel");
      const connectionButton = document.getElementById("connection-info-btn");
      if (connectionPanel && !connectionPanel.hidden) {
        connectionPanel.hidden = true;
        connectionButton?.setAttribute("aria-expanded", "false");
      }
      const mediaPanel = document.getElementById("media-controls-panel");
      const mediaButton = document.getElementById("media-controls-btn");
      if (mediaPanel && !mediaPanel.hidden) {
        mediaPanel.hidden = true;
        mediaButton?.setAttribute("aria-expanded", "false");
      }
      registerWebviewDevToolsShortcut(webview);
    });

    webview._listenersBound = true;
  }

  function ensureTabWebview(tab, { forceLoadUrl = false } = {}) {
    if (!tab || !tab.id || !tab.url || tab.url === "newtab") return null;

    let webview = tabWebviews.get(tab.id);
    if (!webview) {
      if (
        tabWebviews.size === 0 &&
        contentWebview &&
        !contentWebview._everAssignedToTab &&
        !tab.isIncognito
      ) {
        webview = contentWebview;
        contentWebview._everAssignedToTab = true;
      } else {
        webview = document.createElement("webview");
        webview.style.position = "absolute";
        webview.style.inset = "0";
        webview.style.width = "100%";
        webview.style.height = "100%";
        webview.style.display = "none";
        webview.style.border = "none";
        webview.style.zIndex = "0";
        if (mainContent) mainContent.appendChild(webview);
      }
      tabWebviews.set(tab.id, webview);
      bindWebviewEvents(webview, tab.id);
    }

    if (
      (isIncognitoWindow || tab.isIncognito) &&
      webview.getAttribute("partition") !== "incognito"
    ) {
      webview.setAttribute("partition", "incognito");
    }

    const shouldUseInternalPreload = isInternalAppPageUrl(tab.url);
    const internalPreloadUrl = new URL("preload.js", window.location.href).href;
    if (shouldUseInternalPreload) {
      if (webview.getAttribute("preload") !== internalPreloadUrl) {
        webview.setAttribute("preload", internalPreloadUrl);
      }
    } else if (webview.hasAttribute("preload")) {
      webview.removeAttribute("preload");
    }

    const hasSrc = !!webview.getAttribute("src");
    if ((forceLoadUrl || !hasSrc) && webview.getAttribute("src") !== tab.url) {
      tab._pendingNavigationIndex = tab.historyIndex;
      webview.setAttribute("src", tab.url);
    }

    return webview;
  }

  const MAX_OMNIBOX_SUGGESTIONS = 8;
  let omniboxSuggestions = [];
  let omniboxSelectedIndex = -1;
  let omniboxHideTimer = null;

  const omniboxSuggestionsEl = document.createElement("div");
  omniboxSuggestionsEl.id = "url-suggestions";
  omniboxSuggestionsEl.className = "url-suggestions-popup";
  omniboxSuggestionsEl.style.display = "none";
  document.body.appendChild(omniboxSuggestionsEl);

  function getOmniboxOverlayPayload() {
    const rect = urlInput.getBoundingClientRect();
    const maxPopupHeight = Math.min(
      320,
      Math.max(90, window.innerHeight - rect.bottom - 10),
    );
    return {
      bounds: {
        x: Math.round(window.screenX + rect.left),
        y: Math.round(window.screenY + rect.bottom + 4),
        width: Math.round(rect.width),
        height: Math.round(maxPopupHeight),
      },
      themeClassName: document.body.className || "",
      suggestions: omniboxSuggestions,
      selectedIndex: omniboxSelectedIndex,
    };
  }

  function hideOmniboxSuggestions() {
    omniboxSuggestions = [];
    omniboxSelectedIndex = -1;
    omniboxSuggestionsEl.style.display = "none";
    try {
      if (
        window.electronAPI &&
        typeof window.electronAPI.hideSuggestionsOverlay === "function"
      ) {
        window.electronAPI.hideSuggestionsOverlay();
      }
    } catch (e) {
      console.debug("Failed to hide suggestions overlay", e);
    }
  }

  function positionOmniboxSuggestions() {
    if (!omniboxSuggestions.length) return;
    try {
      if (
        window.electronAPI &&
        typeof window.electronAPI.updateSuggestionsOverlay === "function"
      ) {
        window.electronAPI.updateSuggestionsOverlay(getOmniboxOverlayPayload());
      }
    } catch (e) {
      console.debug("Failed to reposition suggestions overlay", e);
    }
  }

  function getOmniboxCandidates() {
    const candidateMap = new Map();
    const addCandidate = (
      url,
      label = "",
      source = "history",
      timestamp = 0,
    ) => {
      if (!url || url === "newtab") return;
      const normalizedUrl = String(url).trim();
      if (!normalizedUrl) return;
      if (
        normalizedUrl.includes("settings.html") ||
        normalizedUrl.includes("history.html")
      )
        return;
      const key = normalizedUrl.toLowerCase();
      const existing = candidateMap.get(key);
      if (!existing) {
        candidateMap.set(key, {
          url: normalizedUrl,
          label: String(label || ""),
          source,
          timestamp: Number(timestamp) || 0,
        });
        return;
      }
      if ((Number(timestamp) || 0) > existing.timestamp) {
        existing.timestamp = Number(timestamp) || existing.timestamp;
      }
      if (!existing.label && label) existing.label = String(label);
      const sourcePriority = { history: 1, quicklink: 2, bookmark: 3, tab: 4 };
      if (
        (sourcePriority[source] || 0) > (sourcePriority[existing.source] || 0)
      ) {
        existing.source = source;
      }
    };

    try {
      const historyEntries = historyManager.getAll();
      if (Array.isArray(historyEntries)) {
        historyEntries.forEach((entry) => {
          if (!entry || !entry.url) return;
          addCandidate(
            entry.url,
            entry.title || entry.host || "",
            "history",
            entry.timestamp || 0,
          );
        });
      }
    } catch (e) {
      console.debug("Unable to read history suggestions", e);
    }

    try {
      (Array.isArray(bookmarks) ? bookmarks : []).forEach((entry) => {
        const entryUrl = entry?.url || entry;
        const entryLabel = entry?.label || "";
        addCandidate(entryUrl, entryLabel, "bookmark", 0);
      });
    } catch (e) {
      console.debug("Unable to read bookmark suggestions", e);
    }

    try {
      (Array.isArray(quickLinks) ? quickLinks : []).forEach((entry) => {
        addCandidate(entry?.url, entry?.label || "", "quicklink", 0);
      });
    } catch (e) {
      console.debug("Unable to read quick link suggestions", e);
    }

    try {
      (Array.isArray(tabs) ? tabs : []).forEach((tab) => {
        if (!tab || !tab.url) return;
        addCandidate(tab.url, tab.title || "", "tab", 0);
      });
    } catch (e) {
      console.debug("Unable to read tab suggestions", e);
    }

    return Array.from(candidateMap.values());
  }

  function scoreOmniboxCandidate(candidate, queryLower) {
    const urlLower = candidate.url.toLowerCase();
    const labelLower = String(candidate.label || "").toLowerCase();
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

    if (!urlLower.includes(queryLower) && !labelLower.includes(queryLower))
      return -1;

    const timeBoost = Math.min((candidate.timestamp || 0) / 1000000000000, 8);
    return score + timeBoost;
  }

  function buildOmniboxSuggestions(rawQuery) {
    const query = String(rawQuery || "").trim();
    const queryLower = query.toLowerCase();
    const candidates = getOmniboxCandidates();
    const scored = candidates
      .map((candidate) => ({
        ...candidate,
        score: scoreOmniboxCandidate(candidate, queryLower),
        isSearch: false,
      }))
      .filter((candidate) => candidate.score >= 0)
      .sort((a, b) => b.score - a.score || b.timestamp - a.timestamp);

    const topMatches = scored.slice(0, MAX_OMNIBOX_SUGGESTIONS);
    if (query && topMatches.length < MAX_OMNIBOX_SUGGESTIONS) {
      topMatches.push({
        url: query,
        label: `Search for "${query}"`,
        source: "search",
        timestamp: Date.now(),
        score: 0,
        isSearch: true,
      });
    }
    return topMatches;
  }

  function renderOmniboxSuggestions() {
    omniboxSuggestionsEl.innerHTML = "";
    if (!omniboxSuggestions.length) {
      hideOmniboxSuggestions();
      return;
    }

    const fragment = document.createDocumentFragment();
    omniboxSuggestions.forEach((suggestion, index) => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "url-suggestion-item";
      if (index === omniboxSelectedIndex) item.classList.add("active");

      const source = document.createElement("span");
      source.className = "url-suggestion-source";
      source.textContent = suggestion.isSearch ? "Search" : suggestion.source;

      const main = document.createElement("span");
      main.className = "url-suggestion-main";
      main.textContent = suggestion.isSearch
        ? suggestion.label
        : suggestion.url;

      const meta = document.createElement("span");
      meta.className = "url-suggestion-meta";
      meta.textContent = suggestion.isSearch ? "" : suggestion.label || "";

      item.appendChild(source);
      item.appendChild(main);
      item.appendChild(meta);

      item.addEventListener("mouseenter", () => {
        omniboxSelectedIndex = index;
        renderOmniboxSuggestions();
      });

      item.addEventListener("mousedown", (event) => {
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
    omniboxSuggestionsEl.style.display = "none";

    try {
      if (
        window.electronAPI &&
        typeof window.electronAPI.updateSuggestionsOverlay === "function"
      ) {
        window.electronAPI.updateSuggestionsOverlay(getOmniboxOverlayPayload());
        return;
      }
    } catch (e) {
      console.debug("Failed to render suggestions overlay", e);
    }

    // Fallback to in-page popup if overlay API is unavailable
    omniboxSuggestionsEl.style.display = "block";
    const rect = urlInput.getBoundingClientRect();
    omniboxSuggestionsEl.style.left = `${rect.left}px`;
    omniboxSuggestionsEl.style.top = `${rect.bottom + 4}px`;
    omniboxSuggestionsEl.style.width = `${rect.width}px`;
    omniboxSuggestionsEl.style.maxHeight = `${Math.min(320, Math.max(90, window.innerHeight - rect.bottom - 10))}px`;
  }

  function refreshOmniboxSuggestions() {
    if (!searchSuggestionsEnabled) {
      hideOmniboxSuggestions();
      return;
    }
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

  window.addEventListener("resize", positionOmniboxSuggestions);
  window.addEventListener("scroll", positionOmniboxSuggestions, true);

  document.addEventListener("mousedown", (event) => {
    if (
      event.target === urlInput ||
      omniboxSuggestionsEl.contains(event.target)
    )
      return;
    hideOmniboxSuggestions();
  });

  if (window.electronAPI && typeof window.electronAPI.on === "function") {
    window.electronAPI.on("suggestion-selected", (_event, selectionPayload) => {
      const payload =
        selectionPayload && typeof selectionPayload === "object"
          ? selectionPayload
          : { index: selectionPayload };
      const index = Number(payload.index);
      const payloadSuggestion =
        payload?.suggestion && typeof payload.suggestion.url === "string"
          ? payload.suggestion
          : null;

      if (
        Number.isFinite(index) &&
        index >= 0 &&
        index < omniboxSuggestions.length
      ) {
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
  const titleBar = document.getElementById("title-bar");
  if (titleBar) {
    // Also handle double-click to maximize/restore
    titleBar.addEventListener("dblclick", (e) => {
      const target = e.target;
      const isTab = target.closest(".tab");
      const isButton = target.closest("button");

      if (!isTab && !isButton) {
        if (
          window.electronAPI &&
          typeof window.electronAPI.toggleMaximize === "function"
        ) {
          window.electronAPI.toggleMaximize();
        }
      }
    });
  }

  // Make the tabs div itself a drop zone
  if (tabsDiv) {
    tabsDiv.addEventListener(
      "dragover",
      (e) => {
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = "move";
      },
      { passive: false },
    );

    tabsDiv.addEventListener("drop", (e) => {
      const externalMeta = getExternalDragMetaForDrop();
      if (externalMeta) {
        e.preventDefault();
        e.stopPropagation();
        console.log(
          "[DND] tabs div drop handler - external tab with stored transferId:",
          externalMeta,
        );

        if (window.electronAPI && window.electronAPI.tabDroppedHere) {
          window.electronAPI.tabDroppedHere(externalMeta);
          window._tabDropHandled = true;
          console.log("[DND] tabs div drop - called tabDroppedHere");
        }
      }
    });
  }

  // --- App Version Display ---
  const appVersionSpan = document.getElementById("app-version");
  if (
    window.electronAPI &&
    typeof window.electronAPI.getAppVersion === "function" &&
    appVersionSpan
  ) {
    window.electronAPI
      .getAppVersion()
      .then((version) => {
        appVersionSpan.textContent = version;
      })
      .catch((err) => {
        console.error("Failed to get app version:", err);
      });
  }

  // --- Modal Elements ---
  // Settings Modal
  const settingsModal = document.getElementById("settings-modal");

  // Quick Link Modal
  const addQuickLinkModal = document.getElementById("add-quick-link-modal");
  let closeButton,
    newQuickLinkUrlInput,
    newQuickLinkLabelInput,
    saveQuickLinkBtn;

  // Only try to get these elements if the modal exists
  if (addQuickLinkModal) {
    closeButton = document.querySelector("#add-quick-link-modal .close-button");
    newQuickLinkUrlInput = document.getElementById("new-quick-link-url");
    newQuickLinkLabelInput = document.getElementById("new-quick-link-label");
    saveQuickLinkBtn = document.getElementById("save-quick-link-btn");
  }

  // --- Utility ---
  // Lightweight favicon URL/base64 caching to avoid repeated generation, network calls and reflows
  const __faviconCache = new Map(); // host -> dataURL or remote URL
  const __faviconBase64Cache = new Map(); // host -> dataURL
  const __faviconFetchQueue = new Set();
  function getHostFromUrl(url) {
    try {
      const u = new URL(url);
      return u.hostname.replace(/^www\./, "");
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
      if (!response.ok) throw new Error("Failed to fetch favicon");
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
        document
          .querySelectorAll(`img[data-favicon-host="${host}"]`)
          .forEach((img) => {
            if (img && img.src && !img.src.startsWith("data:"))
              img.src = dataUrl;
          });
      } catch (e) {}
      return dataUrl;
    } catch (err) {
      __faviconFetchQueue.delete(host);
      return null;
    }
  }

  function getFavicon(url) {
    try {
      if (!url) return "icons/newtab.png";
      if (url === "newtab") return "icons/newtab.png";
      const host = getHostFromUrl(url);
      if (!host) return "icons/newtab.png";
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
      return "icons/newtab.png";
    }
  }

  // Helper: get a simplified site name from a URL (e.g., 'youtube.com' -> 'YouTube')
  function getSiteName(url) {
    try {
      const u = new URL(url);
      let host = u.hostname.replace(/^www\./, "");
      // Capitalize first letter
      return host.charAt(0).toUpperCase() + host.slice(1);
    } catch {
      return url;
    }
  }

  function showUpdateNotification(
    message,
    type = "info",
    duration = 5000,
    clickHandler = null,
  ) {
    // Respect silence setting set when user dismisses notifications
    if ((window.__updateSilence || 0) > Date.now()) {
      console.debug(
        "Update notifications silenced until",
        window.__updateSilence,
      );
      return null;
    }
    // Remove any existing update notification
    const existingNotification = document.querySelector(".update-notification");
    if (existingNotification) {
      existingNotification.remove();
    }

    // Create notification element with accessible DOM nodes (avoid inline handlers)
    const notification = document.createElement("div");
    notification.className = `update-notification update-${type}`;
    const content = document.createElement("div");
    content.className = "update-notification-content";
    const msg = document.createElement("span");
    msg.className = "update-message";
    msg.textContent = message;
    const closeBtn = document.createElement("button");
    closeBtn.className = "update-close";
    closeBtn.setAttribute("aria-label", "Close update notification");
    closeBtn.textContent = "×";
    closeBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      try {
        window.__updateSilence = Date.now() + 60000;
      } catch (err) {}
      if (notification.parentNode) notification.remove();
    });
    content.appendChild(msg);
    content.appendChild(closeBtn);
    notification.appendChild(content);

    // Add click handler if provided
    if (clickHandler) {
      notification.style.cursor = "pointer";
      notification.addEventListener("click", (e) => {
        if (!e.target.classList.contains("update-close")) {
          clickHandler();
          notification.remove();
        }
      });
    }

    // If there is no click handler, prefer to use the global notifications API for a consistent toast
    if (
      !clickHandler &&
      window.notifications &&
      typeof window.notifications.notify === "function"
    ) {
      try {
        window.notifications.notify(message, type, duration);
        return null;
      } catch (e) {
        /* fallthrough */
      }
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

  function updateView({ renderTabStrip = true, renderStaticChrome = true } = {}) {
    const tab = tabs.find((t) => t.id === currentTabId);
    if (!tab) return;

    // Identify special internal pages (settings/history) so we can hide unnecessary chrome
    const isSettingsPage = tab.url && tab.url.includes("settings.html");
    const isHistoryPage = tab.url && tab.url.includes("history.html");
    if (resourceControl) {
      resourceControl.classList.toggle(
        "hidden-for-internal-page",
        !!(isSettingsPage || isHistoryPage),
      );
    }

    // Hide/show URL bar based on whether it's a settings page or history page
    if (controlsDiv) {
      controlsDiv.style.display =
        isSettingsPage || isHistoryPage ? "none" : "flex";
    }

    if (tab.url === "newtab") {
      showOnlyTabWebview(null);
      newTabPage.classList.add("active");
      urlInput.value = "";
      updateConnectionInfo("");
      // Update button states based on history, even for newtab
      backBtn.disabled = tab.historyIndex <= 0;
      forwardBtn.disabled = tab.historyIndex >= tab.history.length - 1;
    } else {
      const activeWebview = ensureTabWebview(tab);
      showOnlyTabWebview(tab.id);
      if (activeWebview) activeWebview.style.display = "flex";
      newTabPage.classList.remove("active");
      urlInput.value = tab.url;
      updateConnectionInfo(tab.url);
      backBtn.disabled = tab.historyIndex <= 0;
      forwardBtn.disabled = tab.historyIndex >= tab.history.length - 1;
    }
    if (renderStaticChrome) {
      renderBookmarkBar();
      renderQuickLinks();
    }
    syncMediaControlsVisibility();
    if (renderTabStrip) renderTabs(); // Update tab title to reflect current URL
  }

  // --- Tabs ---
  function updateTabPresentation(tab) {
    if (!tab) return;
    const tabEl = tabsDiv.querySelector(
      `.tab[data-tab-id="${Number(tab.id)}"]`,
    );
    if (!tabEl) return;

    const titleSpan = tabEl.querySelector(".tab-title");
    if (titleSpan) {
      let displayTitle = getTabDisplayTitle(tab);
      if (displayTitle.length > 32) {
        displayTitle = displayTitle.substring(0, 32) + "...";
      }
      titleSpan.textContent = displayTitle;
    }

    const favicon = tabEl.querySelector(".tab-favicon");
    if (favicon && !tab.isIncognito) favicon.src = getFavicon(tab.url);
  }

  function renderTabs() {
    perfStart("renderTabs");
    normalizeTabGroups();
    tabsDiv.innerHTML = "";
    const frag = document.createDocumentFragment();
    const groupTabCounts = new Map();
    for (const tab of tabs) {
      if (tab.groupId) {
        groupTabCounts.set(tab.groupId, (groupTabCounts.get(tab.groupId) || 0) + 1);
      }
    }

    // Track which groups we've already rendered a header for
    const renderedGroupHeaders = new Set();

    tabs.forEach((tab) => {
      const groupId = tab.groupId;
      const group = groupId ? tabGroups[groupId] : null;

      // Render group header before the first tab of each group.
      // This MUST come before the collapsed early-return so the pill
      // stays visible even when all tabs in the group are hidden.
      if (group && !renderedGroupHeaders.has(groupId)) {
        renderedGroupHeaders.add(groupId);
        const header = document.createElement("div");
        header.className = "tab-group-label";
        header.style.background = group.color;
        header.title = group.collapsed
          ? "Click to expand group"
          : "Click to collapse group";
        header.dataset.groupId = groupId;
        // Show tab count on the pill when the group is collapsed
        const groupTabCount = groupTabCounts.get(groupId) || 0;
        const countText =
          group.collapsed && groupTabCount > 0 ? ` (${groupTabCount})` : "";
        const renderPillContent = () => {
          header.replaceChildren();

          const arrow = document.createElement("span");
          arrow.className = "tab-group-label-arrow";
          arrow.textContent = group.collapsed ? "\u25b6" : "\u25be";

          const name = document.createElement("span");
          name.className = "tab-group-label-name";
          name.textContent = `${tabGroups[groupId]?.name ?? group.name}${countText}`;

          header.appendChild(arrow);
          header.appendChild(name);
        };
        renderPillContent();

        // Single-click: collapse / expand
        header.addEventListener("click", (ev) => {
          if (ev.target.tagName === "INPUT") return;
          window.clearTimeout(header._groupClickTimer);
          header._groupClickTimer = window.setTimeout(() => {
            toggleGroupCollapse(groupId);
          }, 180);
        });

        // Double-click: inline rename
        header.addEventListener("dblclick", (ev) => {
          ev.stopPropagation();
          window.clearTimeout(header._groupClickTimer);
          const currentName = tabGroups[groupId]?.name ?? group.name;
          renderPillContent();
          const inp = document.createElement("input");
          inp.type = "text";
          inp.value = currentName;
          inp.className = "tab-group-rename-input";
          header.appendChild(inp);
          inp.focus();
          inp.select();
          let renameCancelled = false;
          let renameSaved = false;
          const save = () => {
            if (renameCancelled || renameSaved) return;
            renameSaved = true;
            if (!tabGroups[groupId]) {
              renderTabs();
              return;
            }
            const newName =
              inp.value.trim() || tabGroups[groupId]?.name || group.name;
            tabGroups[groupId].name = newName;
            persistGroups();
            renderTabs();
          };
          inp.addEventListener("blur", save);
          inp.addEventListener("keydown", (ke) => {
            ke.stopPropagation();
            if (ke.key === "Enter") {
              ke.preventDefault();
              inp.blur();
            }
            if (ke.key === "Escape") {
              ke.preventDefault();
              renameCancelled = true;
              renderTabs();
            }
          });
        });

        // Right-click: context menu
        header.addEventListener("contextmenu", (ev) => {
          ev.preventDefault();
          showGroupContextMenu(ev, groupId, header);
        });

        frag.appendChild(header);
      }

      // Skip rendering the tab itself if the group is collapsed and this isn't the active tab
      if (group && group.collapsed && tab.id !== currentTabId) return;

      const tabEl = document.createElement("div");
      let currentDragTransferId = null;
      let tabClass = "tab" + (tab.id === currentTabId ? " active" : "");
      if (tab.isIncognito) tabClass += " incognito";
      if (hibernatedTabIds.has(Number(tab.id))) tabClass += " hibernated";
      if (group) tabClass += " grouped";
      tabEl.className = tabClass;
      tabEl.dataset.tabId = String(tab.id);
      if (group) tabEl.style.setProperty("--group-color", group.color);
      // Favicon and title
      if (tabPreviewsEnabled || tab.isIncognito) {
        const favicon = document.createElement("img");
        favicon.src = tab.isIncognito
          ? "icons/incognito.png"
          : getFavicon(tab.url);
        favicon.alt = tab.isIncognito ? "Incognito" : "";
        favicon.onerror = function () {
          this.src = "icons/newtab.png";
        };
        favicon.style.width = "16px";
        favicon.style.height = "16px";
        favicon.classList.add("tab-favicon");
        tabEl.appendChild(favicon);
        const titleSpan = document.createElement("span");
        titleSpan.className = "tab-title";
        let displayTitle = getTabDisplayTitle(tab);
        if (displayTitle.length > 32)
          displayTitle = displayTitle.substring(0, 32) + "...";
        titleSpan.textContent = displayTitle;
        tabEl.appendChild(titleSpan);

        if (hibernatedTabIds.has(Number(tab.id))) {
          const hibernatedBadge = document.createElement("span");
          hibernatedBadge.className = "tab-hibernate-badge";
          hibernatedBadge.textContent = "💤";
          hibernatedBadge.title = "Tab is hibernated to save memory";
          tabEl.appendChild(hibernatedBadge);
        }
      } else {
        const titleSpan = document.createElement("span");
        titleSpan.className = "tab-title";
        let displayTitle = getTabDisplayTitle(tab);
        if (displayTitle.length > 32)
          displayTitle = displayTitle.substring(0, 32) + "...";
        titleSpan.textContent = displayTitle;
        tabEl.appendChild(titleSpan);
      }
      // Close button
      if (tab.audible || tab.muted) {
        const audioBtn = document.createElement("button");
        audioBtn.className = `tab-audio-button${tab.muted ? " muted" : ""}`;
        audioBtn.type = "button";
        audioBtn.title = tab.muted ? "Unmute tab" : "Mute tab";
        audioBtn.setAttribute("aria-label", audioBtn.title);
        audioBtn.innerHTML = tab.muted
          ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4V5Z"></path><path d="m17 9 4 4m0-4-4 4"></path></svg>'
          : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4V5Z"></path><path d="M15 9.5a4 4 0 0 1 0 5"></path><path d="M18 7a7 7 0 0 1 0 10"></path></svg>';
        audioBtn.addEventListener("click", (event) => {
          event.stopPropagation();
          toggleTabMuted(tab.id);
        });
        tabEl.appendChild(audioBtn);
      }

      const closeBtn = document.createElement("div");
      closeBtn.className = "close";
      closeBtn.textContent = "\u00d7";
      closeBtn.title = "Close tab";
      closeBtn.setAttribute("aria-label", "Close tab");
      closeBtn.setAttribute("role", "button");
      closeBtn.tabIndex = 0;
      closeBtn.onclick = (e) => {
        e.stopPropagation();
        closeTab(tab.id);
      };
      closeBtn.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          e.stopPropagation();
          closeTab(tab.id);
        }
      });
            tabEl.appendChild(closeBtn);
      tabEl.onclick = () => switchTab(tab.id);
      // Context menu — use custom menu (includes group options + open in new window)
      tabEl.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        showTabGroupContextMenu(e, tab);
      });
      // --- Modern Drag & Drop ---
      tabEl.draggable = true;
      tabEl.addEventListener("dragstart", (e) => {
        try {
          const tabId = tab.id;
          const transferId = `transfer-${_windowId}-${tabId}-${Date.now()}`;
          currentDragTransferId = transferId;

          e.dataTransfer.setData("application/tab-id", String(tabId));
          e.dataTransfer.effectAllowed = "move";
          tabEl.classList.add("dragging");

          // Build complete metadata
          const meta = {
            id: tabId,
            url: tab.url,
            title: tab.title,
            isIncognito: tab.isIncognito || false,
            transferId,
            webContentsId: tab.webContentsId,
            sourceWinId: _windowId,
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

          console.log("[DND] dragstart - stored transferId:", transferId);
          console.log("[DND] dragstart - full meta:", meta);
        } catch (err) {
          console.error("[DND] dragstart error:", err);
        }
      });
      tabEl.addEventListener(
        "dragover",
        (e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
          tabEl.classList.add("drag-over");
        },
        { passive: false },
      );
      tabEl.addEventListener("dragleave", (e) => {
        tabEl.classList.remove("drag-over");
      });
      tabEl.addEventListener("drop", (e) => {
        e.preventDefault();
        e.stopPropagation();
        tabEl.classList.remove("drag-over");
        const data = e.dataTransfer.getData("application/tab-id");

        console.log("[DND] tab drop event:", {
          hasData: !!data,
          hasExternal: !!window._externalDraggedTabMeta,
        });

        if (data) {
          // Internal reorder
          const draggedId = parseInt(data, 10);
          if (!isNaN(draggedId) && draggedId !== tab.id) {
            const fromIndex = tabs.findIndex((t) => t.id === draggedId);
            const toIndex = tabs.findIndex((t) => t.id === tab.id);
            if (fromIndex !== -1 && toIndex !== -1) {
              const [moved] = tabs.splice(fromIndex, 1);
              tabs.splice(toIndex, 0, moved);
              persistTabs();
              renderTabs();
              window._tabDropHandled = true;
              console.log("[DND] reorder:", { from: fromIndex, to: toIndex });
            }
          }
        } else {
          const externalMeta = getExternalDragMetaForDrop();
          if (!externalMeta) return;
          // External drop - attach tab from another window - use stored transferId
          const metaWithTarget = { ...externalMeta, dropTargetTabId: tab.id };
          console.log(
            "[DND] external drop on tab with stored transferId:",
            metaWithTarget,
          );

          if (window.electronAPI && window.electronAPI.tabDroppedHere) {
            window.electronAPI.tabDroppedHere(metaWithTarget);
            window._tabDropHandled = true;
            console.log(
              "[DND] called tabDroppedHere with meta:",
              metaWithTarget,
            );
          }
        }
      });
      tabEl.addEventListener("dragend", async (e) => {
        tabEl.classList.remove("dragging");
        delete tabs._draggingId;

        console.log("[DND] dragend fired:", {
          clientX: e.clientX,
          clientY: e.clientY,
          screenX: e.screenX,
          screenY: e.screenY,
          dropHandled: window._tabDropHandled,
        });

        // Block newtab placeholder
        if (tab.url === "newtab") {
          console.log("[DND] Blocked drag of newtab placeholder");
          if (
            window.electronAPI &&
            typeof window.electronAPI.tabDragEnd === "function"
          ) {
            window.electronAPI.tabDragEnd();
          }
          return;
        }

        // Check if dragged outside tab area
        const tabsRect = tabsDiv.getBoundingClientRect();
        const outOfTabArea =
          e.clientY < tabsRect.top - 40 ||
          e.clientY > tabsRect.bottom + 40 ||
          e.clientX < tabsRect.left - 40 ||
          e.clientX > tabsRect.right + 40;
        const hasScreenCoords =
          Number.isFinite(e.screenX) && Number.isFinite(e.screenY);
        const outOfWindowByScreen =
          hasScreenCoords &&
          (e.screenX < window.screenX - 8 ||
            e.screenX > window.screenX + window.outerWidth + 8 ||
            e.screenY < window.screenY - 8 ||
            e.screenY > window.screenY + window.outerHeight + 8);
        const shouldDetachFromDragEnd = outOfTabArea || outOfWindowByScreen;

        console.log("[DND] dragend analysis:", {
          outOfTabArea,
          outOfWindowByScreen,
          shouldDetachFromDragEnd,
          dropHandled: window._tabDropHandled,
          screenPos: { x: e.screenX, y: e.screenY },
        });

        if (shouldDetachFromDragEnd) {
          // Wait briefly for any drop events
          await new Promise((resolve) => setTimeout(resolve, 100));

          if (window._tabDropHandled) {
            if (
              window.electronAPI &&
              typeof window.electronAPI.tabDragEnd === "function"
            ) {
              window.electronAPI.tabDragEnd();
            }
            currentDragTransferId = null;
            return;
          }

          // Use screen coordinates to check if dropped on another window
          if (
            window.electronAPI &&
            typeof window.electronAPI.checkDropTarget === "function"
          ) {
            console.log(
              "[DND] dragend - window._currentDragTransferId:",
              window._currentDragTransferId,
            );
            console.log(
              "[DND] dragend - window._tabDragState:",
              window._tabDragState,
            );

            const dragMeta = {
              id: tab.id,
              url: tab.url,
              title: tab.title,
              isIncognito: tab.isIncognito || false,
              transferId:
                currentDragTransferId || window._currentDragTransferId,
              webContentsId: tab.webContentsId,
              sourceWinId: _windowId,
            };

            console.log("[DND] dragend - dragMeta being sent:", dragMeta);

            const result = await window.electronAPI.checkDropTarget(
              e.screenX,
              e.screenY,
              dragMeta,
            );

            console.log("[DND] checkDropTarget result:", result);

            if (result && result.handled) {
              // Tab was attached to another window
              console.log(
                "[DND] Tab attached to window:",
                result.targetWindowId,
              );
              if (
                window.electronAPI &&
                typeof window.electronAPI.tabDragEnd === "function"
              ) {
                window.electronAPI.tabDragEnd();
              }
              return;
            }
          }

          // No target window - create new window
          console.log("[DND] Creating new window for detached tab");

          if (
            window.electronAPI &&
            typeof window.electronAPI.detachTab === "function"
          ) {
            window.electronAPI.detachTab({
              id: tab.id,
              url: tab.url,
              title: tab.title,
              isIncognito: tab.isIncognito,
            });
          }
        }

        if (
          window.electronAPI &&
          typeof window.electronAPI.tabDragEnd === "function"
        ) {
          window.electronAPI.tabDragEnd();
        }
        currentDragTransferId = null;
      });
      frag.appendChild(tabEl);
    });


    const newTabBtn = document.createElement("button");
    newTabBtn.id = "new-tab-btn";
    newTabBtn.textContent = "+";
    newTabBtn.onclick = () => newTab();

    // Make new tab button a drop zone
    newTabBtn.addEventListener(
      "dragover",
      (e) => {
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = "move";
      },
      { passive: false },
    );

    newTabBtn.addEventListener("drop", (e) => {
      e.preventDefault();
      e.stopPropagation();

      const externalMeta = getExternalDragMetaForDrop();
      if (externalMeta) {
        console.log(
          "[DND] new tab button drop - external tab with stored transferId:",
          externalMeta,
        );

        if (window.electronAPI && window.electronAPI.tabDroppedHere) {
          window.electronAPI.tabDroppedHere(externalMeta);
          window._tabDropHandled = true;
        }
      }
    });

    frag.appendChild(newTabBtn);
    tabsDiv.appendChild(frag);

    // Create an invisible drop zone overlay that covers the entire tabs area including empty space
    if (!tabsDiv.querySelector(".tabs-drop-overlay")) {
      const dropOverlay = document.createElement("div");
      dropOverlay.className = "tabs-drop-overlay";
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

      dropOverlay.addEventListener(
        "dragover",
        (e) => {
          e.preventDefault();
          e.stopPropagation();
          e.dataTransfer.dropEffect = "move";
        },
        { passive: false },
      );

      dropOverlay.addEventListener("drop", (e) => {
        e.preventDefault();
        e.stopPropagation();

        const externalMeta = getExternalDragMetaForDrop();
        if (externalMeta) {
          console.log(
            "[DND] drop overlay - external tab with stored transferId:",
            externalMeta,
          );

          if (window.electronAPI && window.electronAPI.tabDroppedHere) {
            window.electronAPI.tabDroppedHere(externalMeta);
            window._tabDropHandled = true;
          }
        }
      });

      // Enable pointer events only during drag
      tabsDiv.addEventListener("dragenter", () => {
        dropOverlay.style.display = "block";
        dropOverlay.style.pointerEvents = "auto";
      });

      tabsDiv.addEventListener("dragleave", (e) => {
        // Only disable if actually leaving the tabs area
        if (!tabsDiv.contains(e.relatedTarget)) {
          dropOverlay.style.pointerEvents = "none";
          dropOverlay.style.display = "none";
        }
      });

      tabsDiv.addEventListener("drop", () => {
        dropOverlay.style.pointerEvents = "none";
        dropOverlay.style.display = "none";
      });

      tabsDiv.addEventListener("dragend", () => {
        dropOverlay.style.pointerEvents = "none";
        dropOverlay.style.display = "none";
      });

      tabsDiv.insertBefore(dropOverlay, tabsDiv.firstChild);
    }

    // Allow dropping tabs on the empty tabs area to move to end or attach external tab
    if (!tabsDiv._dropListenersAdded) {
      tabsDiv.addEventListener(
        "dragover",
        (e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
        },
        { passive: false },
      );
      tabsDiv.addEventListener("drop", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const data = e.dataTransfer.getData("application/tab-id");

        console.log("[DND] tabs area drop:", {
          hasData: !!data,
          hasExternal: !!window._externalDraggedTabMeta,
        });

        if (data) {
          // Move to end
          const draggedId = parseInt(data, 10);
          if (!isNaN(draggedId)) {
            const fromIndex = tabs.findIndex((t) => t.id === draggedId);
            if (fromIndex !== -1) {
              const [moved] = tabs.splice(fromIndex, 1);
              tabs.push(moved);
              persistTabs();
              renderTabs();
              window._tabDropHandled = true;
              console.log("[DND] moved to end");
            }
          }
        } else {
          const externalMeta = getExternalDragMetaForDrop();
          if (!externalMeta) return;
          // External drop on tab area - use the stored transferId
          console.log(
            "[DND] external drop on tabs area with stored transferId:",
            externalMeta,
          );

          if (window.electronAPI && window.electronAPI.tabDroppedHere) {
            window.electronAPI.tabDroppedHere(externalMeta);
            window._tabDropHandled = true;
            console.log("[DND] called tabDroppedHere from tabs area");
          }
        }
      });
      tabsDiv._dropListenersAdded = true;
    }

    // Update group management button visibility
    const hasLiveGroups = getVisibleGroupIds().length > 0;
    groupMgmtBtn.style.display = hasLiveGroups ? "flex" : "none";
    tabsDiv.classList.toggle("has-tab-groups", hasLiveGroups);

    perfEnd("renderTabs");
  }

  function switchTab(id) {
    currentTabId = id;
    persistTabs();
    updateView({ renderTabStrip: false });
    tabsDiv.querySelectorAll('.tab[data-tab-id]').forEach((tabEl) => {
      tabEl.classList.toggle('active', Number(tabEl.dataset.tabId) === Number(id));
    });
  }

  function newTab(url = "newtab", fromNavigate = false, options = {}) {
    if (url === "newtab" && !fromNavigate && !options.incognito) {
      if (newTabBehaviorSetting === "homepage") url = homepage;
      if (newTabBehaviorSetting === "blank") url = "about:blank";
    }
    if (fromNavigate) {
      // This is a navigation within the current tab, not a new tab creation
      const tab = tabs.find((t) => t.id === currentTabId);
      if (tab.url === "newtab") {
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
      const newTabObj = {
        id: newTabId,
        url,
        history: [url],
        historyIndex: 0,
        viewCreated: true,
        isIncognito: options.incognito === true,
      };
      tabs.push(newTabObj);
      currentTabId = newTabId;
    }

    persistTabs();
    updateView();
    renderTabs();
  }

  // Make newTab globally accessible for widgets
  window.newTab = newTab;
  console.log("newTab function assigned to window:", typeof window.newTab);

  // Make weather widget update function globally accessible
  window.updateWeatherWidget = async function () {
    await loadWidgetModules();
    console.log("Global weather widget update called");
    const weatherWidget = document.getElementById("weather-widget");
    if (weatherWidget && !weatherWidget.classList.contains("hidden")) {
      console.log("Creating new weather widget instance");
      const widget = new WeatherWidget();
      weatherWidget.weatherWidgetInstance = widget; // Store instance on DOM element
    }
  };

  // Add a test function to manually trigger weather refresh
  window.testWeatherRefresh = async function () {
    await loadWidgetModules();
    console.log("=== MANUAL WEATHER REFRESH TEST ===");
    const weatherWidget = document.querySelector("#weather-widget");
    if (weatherWidget) {
      console.log("Weather widget found, creating new instance");
      const widget = new WeatherWidget();
      weatherWidget.weatherWidgetInstance = widget;
    } else {
      console.log("Weather widget not found");
    }
  };
  console.log("updateWeatherWidget function assigned to window");

  // Make news widget update function globally accessible
  window.updateNewsWidget = async function () {
    await loadWidgetModules();
    console.log("Global news widget update called");
    const newsWidget = document.getElementById("news-widget");
    if (newsWidget && !newsWidget.classList.contains("hidden")) {
      console.log("Creating new news widget instance");
      new NewsWidget();
    }
  };
  console.log("updateNewsWidget function assigned to window");

  const MAX_RECENTLY_CLOSED_TABS = 20;

  function readRecentlyClosedTabs() {
    if (isIncognitoWindow) return [];
    try {
      const entries = JSON.parse(localStorage.getItem("closedTabs") || "[]");
      return Array.isArray(entries) ? entries.slice(-MAX_RECENTLY_CLOSED_TABS) : [];
    } catch (_error) {
      return [];
    }
  }

  function saveRecentlyClosedTab(tab) {
    if (!tab || tab.isIncognito || isIncognitoWindow) return;
    const entries = readRecentlyClosedTabs();
    const { _pendingHistoryDirection, _pendingNavigationIndex, audible, ...recoverableTab } = tab;
    void _pendingHistoryDirection;
    void _pendingNavigationIndex;
    void audible;
    entries.push({ ...recoverableTab, closedAt: Date.now() });
    localStorage.setItem("closedTabs", JSON.stringify(entries.slice(-MAX_RECENTLY_CLOSED_TABS)));
  }

  function reopenRecentlyClosedTab() {
    const entries = readRecentlyClosedTabs();
    const recovered = entries.pop();
    if (!recovered) return false;
    localStorage.setItem("closedTabs", JSON.stringify(entries));
    let id = Date.now();
    while (tabs.some((tab) => tab.id === id)) id++;
    const tab = {
      ...recovered,
      id,
      history: Array.isArray(recovered.history) && recovered.history.length ? recovered.history : [recovered.url || "newtab"],
      historyIndex: Number.isInteger(recovered.historyIndex) ? recovered.historyIndex : 0,
      viewCreated: false,
    };
    delete tab.closedAt;
    tabs.push(tab);
    currentTabId = tab.id;
    persistTabs();
    updateView();
    renderTabs();
    return true;
  }

  function toggleTabMuted(tabId) {
    const tab = tabs.find((item) => item.id === tabId);
    if (!tab) return;
    tab.muted = !tab.muted;
    tabWebviews.get(tabId)?.setAudioMuted?.(tab.muted);
    persistTabs();
    renderTabs();
    if (tab.id === currentTabId) syncMediaControlsVisibility();
  }

  function closeTab(id) {
    const tabIndex = tabs.findIndex((t) => t.id === id);
    if (tabIndex === -1) return;

    const tabToClose = tabs[tabIndex];
    saveRecentlyClosedTab(tabToClose);

    // If this is the last tab, close the entire application
    if (tabs.length === 1) {
      window.electronAPI.closeApp();
      return;
    }

    const [closedTab] = tabs.splice(tabIndex, 1);
    removeTabWebview(id);

    if (currentTabId === id) {
      currentTabId =
        tabs.length > 0
          ? tabs[tabIndex]
            ? tabs[tabIndex].id
            : tabs[tabs.length - 1].id
          : null;
    }
    if (closedTab?.groupId) normalizeTabGroups({ persist: true });
    persistTabs();
    updateView();
    renderTabs();
  }

  // --- Tab Group Management ---

  function persistGroups() {
    if (isIncognitoWindow) return;
    try {
      storage.setItem(storageKey("tabGroups"), JSON.stringify(tabGroups));
    } catch (e) {}
  }

  function createTabGroup(name, color) {
    let id = "grp_" + Date.now();
    while (tabGroups[id]) {
      id = "grp_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7);
    }
    tabGroups[id] = {
      id,
      name: typeof name === "string" && name.trim() ? name.trim() : "Group",
      color: isValidGroupColor(color) ? color : "#3b82f6",
      collapsed: false,
    };
    persistGroups();
    return id;
  }

  function addTabToGroup(tabId, groupId) {
    const tab = tabs.find((t) => t.id === tabId);
    if (tab && tabGroups[groupId]) {
      tab.groupId = groupId;
      normalizeTabGroups();
      persistTabs();
      renderTabs();
    }
  }

  function removeTabFromGroup(tabId) {
    const tab = tabs.find((t) => t.id === tabId);
    if (tab) {
      delete tab.groupId;
      normalizeTabGroups({ persist: true });
      persistTabs();
      renderTabs();
    }
  }

  function toggleGroupCollapse(groupId) {
    if (!tabGroups[groupId]) return;
    tabGroups[groupId].collapsed = !tabGroups[groupId].collapsed;
    // If collapsing and active tab is in this group, switch to the first visible tab
    if (tabGroups[groupId].collapsed) {
      const activeTab = tabs.find((t) => t.id === currentTabId);
      if (activeTab && activeTab.groupId === groupId) {
        const visibleTab = tabs.find(
          (t) => !t.groupId || !tabGroups[t.groupId]?.collapsed,
        );
        if (visibleTab) switchTab(visibleTab.id);
      }
    }
    persistGroups();
    renderTabs();
  }

  function deleteGroup(groupId) {
    tabs.forEach((tab) => {
      if (tab.groupId === groupId) delete tab.groupId;
    });
    delete tabGroups[groupId];
    persistGroups();
    persistTabs();
    renderTabs();
  }

  // Custom DOM context menu for tab right-click (handles group options)
  let _tabContextMenu = null;
  function showTabGroupContextMenu(e, tab) {
    // Remove any existing menu
    if (_tabContextMenu) _tabContextMenu.remove();

    const menu = document.createElement("div");
    menu.className = "tab-ctx-menu";
    menu.style.cssText = `
      position: fixed;
      z-index: 999999;
      background: var(--settings-bg, #fff);
      border: 1px solid var(--border-color, #e0e0e0);
      border-radius: 8px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.18);
      padding: 4px 0;
      min-width: 180px;
      font-size: 13px;
    `;

    const addItem = (label, icon, onClick, danger = false, closeAfter = true) => {
      const item = document.createElement("div");
      item.className = "tab-ctx-item";
      item.style.cssText = `
        display: flex; align-items: center; gap: 8px;
        padding: 7px 14px; cursor: pointer;
        color: ${danger ? "#e53e3e" : "var(--settings-header-color, #202124)"};
        border-radius: 4px; margin: 0 4px;
      `;
      const iconSpan = document.createElement("span");
      iconSpan.style.fontSize = "15px";
      if (icon instanceof HTMLElement) {
        iconSpan.appendChild(icon);
      } else {
        iconSpan.textContent = icon;
      }
      const labelSpan = document.createElement("span");
      labelSpan.textContent = label;
      item.appendChild(iconSpan);
      item.appendChild(labelSpan);
      item.addEventListener(
        "mouseenter",
        () => (item.style.background = "var(--hover-bg, #f1f3f4)"),
      );
      item.addEventListener("mouseleave", () => (item.style.background = ""));
      item.addEventListener("mousedown", (ev) => {
        ev.stopPropagation();
        onClick();
        if (closeAfter) closeMenu();
      });
      menu.appendChild(item);
    };

    const addSeparator = () => {
      const sep = document.createElement("div");
      sep.style.cssText =
        "height:1px; background: var(--border-color, #e0e0e0); margin: 4px 0;";
      menu.appendChild(sep);
    };

    const closeMenu = () => {
      if (_tabContextMenu) {
        _tabContextMenu.remove();
        _tabContextMenu = null;
      }
    };

    // Open in new window
    addItem("Open in New Window", "\u2197", () => {
      if (window.electronAPI?.showTabContextMenu)
        window.electronAPI.showTabContextMenu({
          id: tab.id,
          url: tab.url,
          title: tab.title,
        });
    });

    addItem(tab.muted ? "Unmute tab" : "Mute tab", tab.muted ? "🔇" : "🔊", () => {
      toggleTabMuted(tab.id);
    });
    if (tab.hasMedia || tab.audible) {
      addItem("Play / pause media", "▶", () => {
        if (tab.id !== currentTabId) switchTab(tab.id);
        return runActiveMediaAction("play-pause");
      });
      addItem("Picture in picture", "▣", async () => {
        if (tab.id !== currentTabId) switchTab(tab.id);
        const result = await runActiveMediaAction("pip");
        if (!result.ok) showUpdateNotification(result.message, "info", 3000);
      });
    }

    if (readRecentlyClosedTabs().length) {
      addItem("Reopen closed tab", "↶", reopenRecentlyClosedTab);
    }

    addSeparator();

    // Group options
    if (tab.groupId && tabGroups[tab.groupId]) {
      const grp = tabGroups[tab.groupId];
      addItem(`Remove from "${grp.name}"`, "\u00d7", () =>
        removeTabFromGroup(tab.id),
      );
      addItem(`Delete Group "${grp.name}"`, "\u232b",
        () => deleteGroup(tab.groupId),
        true,
      );
    } else {
      // Create label and color row upfront so "Add to new group" can reference them
      const newGrpLabel = document.createElement("div");
      newGrpLabel.style.cssText =
        "padding: 6px 14px 2px; font-size:11px; color:#888; font-weight:600; text-transform:uppercase; letter-spacing:.5px;";
      newGrpLabel.textContent = "New group color";

      const colorRow = document.createElement("div");
      colorRow.style.cssText =
        "display:flex; gap:6px; padding: 4px 14px 8px; flex-wrap:wrap;";

      // Add to existing group submenu, or create new
      const existingGroupIds = Object.keys(tabGroups);
      if (existingGroupIds.length > 0) {
        existingGroupIds.forEach((gid) => {
          const grp = tabGroups[gid];
          // Colour dot as the icon so you can see which group is which at a glance
          const dotIcon = document.createElement("span");
          dotIcon.style.cssText = `display:inline-block;width:12px;height:12px;border-radius:50%;background:${grp.color};flex-shrink:0`;
          addItem(`Add to "${grp.name}"`, dotIcon, () =>
            addTabToGroup(tab.id, gid),
          );
        });
        addSeparator();
      }

      // Add to new group option
      addItem("Add to new group", "+", () => {
        // Show color picker for new group
        newGrpLabel.textContent = "Pick a color for new group";
        colorRow.innerHTML = "";

        GROUP_COLORS.forEach((c) => {
          const dot = document.createElement("div");
          dot.title = c.name;
          dot.style.cssText = `width:20px;height:20px;border-radius:50%;background:${c.value};cursor:pointer;border:2px solid transparent;transition:border-color .1s;`;
          dot.addEventListener(
            "mouseenter",
            () => (dot.style.borderColor = "#fff"),
          );
          dot.addEventListener(
            "mouseleave",
            () => (dot.style.borderColor = "transparent"),
          );
          dot.addEventListener("mousedown", (ev) => {
            ev.stopPropagation();
            // Replace colour picker with name input
            newGrpLabel.textContent = "Name your group";
            colorRow.innerHTML = "";
            const nameWrap = document.createElement("div");
            nameWrap.style.cssText =
              "padding:8px 14px;display:flex;gap:6px;align-items:center;";
            const preview = document.createElement("span");
            preview.style.cssText = `display:inline-block;width:14px;height:14px;border-radius:50%;background:${c.value};flex-shrink:0;`;
            const nameInput = document.createElement("input");
            nameInput.type = "text";
            nameInput.value = c.name;
            nameInput.placeholder = "Group name\u2026";
            nameInput.style.cssText =
              "flex:1;padding:4px 8px;border:1px solid #ccc;border-radius:4px;font-size:12px;outline:none;min-width:0;";
            const saveBtn = document.createElement("button");
            saveBtn.textContent = "Save";
            saveBtn.style.cssText =
              "padding:4px 12px;background:#4285f4;color:#fff;border:none;border-radius:4px;font-size:12px;cursor:pointer;flex-shrink:0;";
            nameWrap.appendChild(preview);
            nameWrap.appendChild(nameInput);
            nameWrap.appendChild(saveBtn);
            colorRow.appendChild(nameWrap);
            setTimeout(() => {
              nameInput.focus();
              nameInput.select();
            }, 30);
            const confirm = () => {
              const name = nameInput.value.trim() || c.name;
              const gid = createTabGroup(name, c.value);
              addTabToGroup(tab.id, gid);
              closeMenu();
            };
            nameInput.addEventListener("mousedown", (mev) =>
              mev.stopPropagation(),
            );
            saveBtn.addEventListener("mousedown", (mev) => {
              mev.stopPropagation();
              confirm();
            });
            nameInput.addEventListener("keydown", (ke) => {
              ke.stopPropagation();
              if (ke.key === "Enter") {
                ke.preventDefault();
                confirm();
              }
              if (ke.key === "Escape") {
                closeMenu();
              }
            });
          });
          colorRow.appendChild(dot);
        });

        // Ensure label and color row are in the menu
        if (!menu.contains(newGrpLabel)) {
          menu.appendChild(newGrpLabel);
        }
        if (!menu.contains(colorRow)) {
          menu.appendChild(colorRow);
        }
      }, false, false);

      addSeparator();
    }

    // Position menu near cursor, keep inside viewport
    document.body.appendChild(menu);
    _tabContextMenu = menu;
    const r = menu.getBoundingClientRect();
    let x = e.clientX,
      y = e.clientY;
    if (x + r.width > window.innerWidth) x = window.innerWidth - r.width - 8;
    if (y + r.height > window.innerHeight)
      y = window.innerHeight - r.height - 8;
    menu.style.left = x + "px";
    menu.style.top = y + "px";

    const dismiss = (ev) => {
      if (!menu.contains(ev.target)) {
        closeMenu();
        document.removeEventListener("mousedown", dismiss);
      }
    };
    setTimeout(() => document.addEventListener("mousedown", dismiss), 0);
  }

  // Context menu for group pill (right-click)
  let _groupContextMenu = null;
  function showGroupContextMenu(e, groupId, headerElement) {
    if (!tabGroups[groupId]) return;
    e.preventDefault();

    // Remove any existing menu
    if (_groupContextMenu) _groupContextMenu.remove();

    const menu = document.createElement("div");
    menu.className = "group-ctx-menu";
    menu.style.cssText = `
      position: fixed;
      z-index: 999999;
      background: var(--settings-bg, #fff);
      border: 1px solid var(--border-color, #e0e0e0);
      border-radius: 8px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.18);
      padding: 4px 0;
      min-width: 200px;
      font-size: 13px;
    `;

    const addItem = (label, icon, onClick, danger = false, closeAfter = true) => {
      const item = document.createElement("div");
      item.className = "group-ctx-item";
      item.style.cssText = `
        display: flex; align-items: center; gap: 8px;
        padding: 7px 14px; cursor: pointer;
        color: ${danger ? "#e53e3e" : "var(--settings-header-color, #202124)"};
        border-radius: 4px; margin: 0 4px;
      `;
      const iconSpan = document.createElement("span");
      iconSpan.style.fontSize = "15px";
      iconSpan.textContent = icon;
      const labelSpan = document.createElement("span");
      labelSpan.textContent = label;
      item.appendChild(iconSpan);
      item.appendChild(labelSpan);
      item.addEventListener(
        "mouseenter",
        () => (item.style.background = "var(--hover-bg, #f1f3f4)"),
      );
      item.addEventListener("mouseleave", () => (item.style.background = ""));
      item.addEventListener("mousedown", (ev) => {
        ev.stopPropagation();
        onClick();
        if (closeAfter) closeMenu();
      });
      menu.appendChild(item);
    };

    const addSeparator = () => {
      const sep = document.createElement("div");
      sep.style.cssText =
        "height:1px; background: var(--border-color, #e0e0e0); margin: 4px 0;";
      menu.appendChild(sep);
    };

    const closeMenu = () => {
      if (_groupContextMenu) {
        _groupContextMenu.remove();
        _groupContextMenu = null;
      }
    };

    const grp = tabGroups[groupId];

    // Rename option
    addItem("Rename", "A", () => {
      const dialog = document.createElement("div");
      dialog.style.cssText = `
        position: fixed;
        z-index: 999999;
        background: var(--settings-bg, #fff);
        border: 1px solid var(--border-color, #e0e0e0);
        border-radius: 8px;
        padding: 16px;
        box-shadow: 0 4px 20px rgba(0,0,0,0.18);
        min-width: 250px;
      `;

      const label = document.createElement("div");
      label.textContent = "Group name";
      label.style.cssText = `
        font-size: 12px;
        color: #888;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        margin-bottom: 8px;
      `;

      const input = document.createElement("input");
      input.type = "text";
      input.value = tabGroups[groupId]?.name || grp.name;
      input.style.cssText = `
        width: 100%;
        padding: 8px;
        border: 1px solid var(--border-color, #e0e0e0);
        border-radius: 4px;
        font-size: 13px;
        box-sizing: border-box;
        margin-bottom: 12px;
      `;

      const buttonContainer = document.createElement("div");
      buttonContainer.style.cssText = `
        display: flex;
        gap: 8px;
      `;

      const saveBtn = document.createElement("button");
      saveBtn.textContent = "Save";
      saveBtn.style.cssText = `
        flex: 1;
        padding: 6px 12px;
        background: var(--accent-color, #3b82f6);
        color: white;
        border: none;
        border-radius: 4px;
        cursor: pointer;
        font-size: 12px;
      `;

      const cancelBtn = document.createElement("button");
      cancelBtn.textContent = "Cancel";
      cancelBtn.style.cssText = `
        flex: 1;
        padding: 6px 12px;
        background: var(--border-color, #e0e0e0);
        color: var(--settings-header-color, #202124);
        border: none;
        border-radius: 4px;
        cursor: pointer;
        font-size: 12px;
      `;

      const closeDialog = () => {
        dialog.remove();
      };

      const save = () => {
        const currentGroup = tabGroups[groupId];
        if (!currentGroup) {
          closeDialog();
          return;
        }
        const newName = input.value.trim() || currentGroup.name;
        currentGroup.name = newName;
        persistGroups();
        renderTabs();
        closeDialog();
      };

      saveBtn.addEventListener("click", save);
      cancelBtn.addEventListener("click", closeDialog);

      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          save();
        }
        if (e.key === "Escape") {
          closeDialog();
        }
      });

      buttonContainer.appendChild(cancelBtn);
      buttonContainer.appendChild(saveBtn);
      dialog.appendChild(label);
      dialog.appendChild(input);
      dialog.appendChild(buttonContainer);
      document.body.appendChild(dialog);

      // Position dialog at the same location as the menu was, but lower
      const r = dialog.getBoundingClientRect();
      let x = e.clientX - 8;
      let y = e.clientY + 20;  // Move down 20px to show group name
      if (x + r.width > window.innerWidth - 8)
        x = window.innerWidth - r.width - 8;
      if (y + r.height > window.innerHeight - 8)
        y = window.innerHeight - r.height - 8;
      dialog.style.left = x + "px";
      dialog.style.top = y + "px";

      input.focus();
      input.select();

      // Close dialog when clicking outside
      const dismiss = (ev) => {
        if (!dialog.contains(ev.target)) {
          closeDialog();
          document.removeEventListener("mousedown", dismiss);
        }
      };
      setTimeout(() => document.addEventListener("mousedown", dismiss), 0);
    }, false, true);

    // Change color
    addItem("Change Color", "\u25cf", () => {
      const colorLabel = document.createElement("div");
      colorLabel.style.cssText =
        "padding: 6px 14px 2px; font-size:11px; color:#888; font-weight:600; text-transform:uppercase; letter-spacing:.5px;";
      colorLabel.textContent = "Pick a color";
      menu.innerHTML = "";
      menu.appendChild(colorLabel);

      const colorRow = document.createElement("div");
      colorRow.style.cssText =
        "display:flex; gap:6px; padding: 4px 14px 8px; flex-wrap:wrap;";
      GROUP_COLORS.forEach((c) => {
        const dot = document.createElement("div");
        dot.title = c.name;
        const isCurrentColor = c.value === tabGroups[groupId]?.color;
        dot.style.cssText = `width:20px;height:20px;border-radius:50%;background:${c.value};cursor:pointer;border:${isCurrentColor ? "3px" : "2px"} solid ${isCurrentColor ? "#333" : "transparent"};transition:border-color .1s;`;
        dot.addEventListener(
          "mouseenter",
          () => (dot.style.borderColor = "#333"),
        );
        dot.addEventListener("mouseleave", () => {
          if (c.value !== tabGroups[groupId]?.color) dot.style.borderColor = "transparent";
        });
        dot.addEventListener("mousedown", (ev) => {
          ev.stopPropagation();
          if (!tabGroups[groupId]) return;
          tabGroups[groupId].color = c.value;
          persistGroups();
          renderTabs();
          closeMenu();
        });
        colorRow.appendChild(dot);
      });
      menu.appendChild(colorRow);
    }, false, false);

    addSeparator();

    // Delete option
    addItem(`Delete "${grp.name}"`, "\u232b", () => deleteGroup(groupId), true);

    _groupContextMenu = menu;
    document.body.appendChild(menu);

    const r = menu.getBoundingClientRect();
    let x = e.clientX - 8;
    let y = e.clientY - 8;
    if (x + r.width > window.innerWidth - 8)
      x = window.innerWidth - r.width - 8;
    if (y + r.height > window.innerHeight - 8)
      y = window.innerHeight - r.height - 8;
    menu.style.left = x + "px";
    menu.style.top = y + "px";

    const dismiss = (ev) => {
      if (!menu.contains(ev.target)) {
        closeMenu();
        document.removeEventListener("mousedown", dismiss);
      }
    };
    setTimeout(() => document.addEventListener("mousedown", dismiss), 0);
  }

  // Group management dropdown menu
  let _groupMgmtMenu = null;
  let _groupMgmtDismissHandler = null;
  function showGroupManagementMenu(e, btn) {
    closeGroupManagementMenu();

    const menu = document.createElement("div");
    menu.className = "group-ctx-menu group-mgmt-menu";
    menu.style.cssText = `
      position: fixed;
      z-index: 999999;
      background: var(--settings-bg, #fff);
      border: 1px solid var(--border-color, #e0e0e0);
      border-radius: 8px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.18);
      padding: 4px 0;
      min-width: 200px;
      font-size: 13px;
    `;

    const groupIds = getVisibleGroupIds();
    if (groupIds.length === 0) return;

    groupIds.forEach((gid) => {
      const grp = tabGroups[gid];
      const item = document.createElement("button");
      item.type = "button";
      item.className = "group-mgmt-item";
      const colorDot = document.createElement("span");
      colorDot.style.cssText = `display:inline-block;width:12px;height:12px;border-radius:50%;background:${grp.color};flex-shrink:0`;
      const nameSpan = document.createElement("span");
      nameSpan.style.flex = "1";
      nameSpan.textContent = grp.name;
      const countSpan = document.createElement("span");
      countSpan.style.cssText = "color:#888;font-size:11px;";
      countSpan.textContent = String(tabs.filter((t) => t.groupId === gid).length);
      item.appendChild(colorDot);
      item.appendChild(nameSpan);
      item.appendChild(countSpan);
      item.addEventListener(
        "mouseenter",
        () => (item.style.background = "var(--hover-bg, #f1f3f4)"),
      );
      item.addEventListener("mouseleave", () => (item.style.background = ""));
      item.addEventListener("mousedown", (ev) => {
        ev.stopPropagation();
        showGroupManagementOptions(gid, menu, btn);
      });
      menu.appendChild(item);
    });

    _groupMgmtMenu = menu;
    btn.classList.add("open");
    btn.setAttribute("aria-expanded", "true");
    document.body.appendChild(menu);

    const r = menu.getBoundingClientRect();
    const btnRect = btn.getBoundingClientRect();
    let x = btnRect.left;
    let y = btnRect.bottom + 4;
    if (x + r.width > window.innerWidth) x = window.innerWidth - r.width - 8;
    if (y + r.height > window.innerHeight) y = window.innerHeight - r.height - 8;
    menu.style.left = x + "px";
    menu.style.top = y + "px";

    _groupMgmtDismissHandler = (ev) => {
      if (!menu.contains(ev.target) && !btn.contains(ev.target)) {
        closeGroupManagementMenu();
      }
    };
    setTimeout(() => document.addEventListener("pointerdown", _groupMgmtDismissHandler, true), 0);
  }

  function closeGroupManagementMenu() {
    groupMgmtBtn.classList.remove("open");
    groupMgmtBtn.setAttribute("aria-expanded", "false");
    if (_groupMgmtDismissHandler) {
      document.removeEventListener("pointerdown", _groupMgmtDismissHandler, true);
      _groupMgmtDismissHandler = null;
    }
    if (_groupMgmtMenu) {
      _groupMgmtMenu.remove();
      _groupMgmtMenu = null;
    }
  }

  window.addEventListener("blur", () => {
    closeGroupManagementMenu();
  });

  function showGroupRenameDialog(groupId, x, y, onClose = () => {}) {
    const currentGroup = tabGroups[groupId];
    if (!currentGroup) return;

    const dialog = document.createElement("div");
    dialog.className = "group-rename-popover";

    const label = document.createElement("label");
    label.className = "group-rename-label";
    label.textContent = "Group name";

    const input = document.createElement("input");
    input.type = "text";
    input.value = currentGroup.name;
    input.className = "group-rename-field";

    const actions = document.createElement("div");
    actions.className = "group-rename-actions";

    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "group-rename-button secondary";
    cancelBtn.textContent = "Cancel";

    const saveBtn = document.createElement("button");
    saveBtn.type = "button";
    saveBtn.className = "group-rename-button primary";
    saveBtn.textContent = "Save";

    const closeDialog = () => {
      dialog.remove();
      onClose();
    };

    const save = () => {
      const group = tabGroups[groupId];
      if (!group) {
        closeDialog();
        return;
      }
      group.name = input.value.trim() || group.name;
      persistGroups();
      renderTabs();
      closeDialog();
    };

    cancelBtn.addEventListener("click", closeDialog);
    saveBtn.addEventListener("click", save);
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        save();
      }
      if (event.key === "Escape") {
        event.preventDefault();
        closeDialog();
      }
    });

    actions.appendChild(cancelBtn);
    actions.appendChild(saveBtn);
    dialog.appendChild(label);
    dialog.appendChild(input);
    dialog.appendChild(actions);
    document.body.appendChild(dialog);
    positionFloatingElement(dialog, x, y);

    const dismiss = (event) => {
      if (!dialog.contains(event.target)) {
        closeDialog();
        document.removeEventListener("pointerdown", dismiss, true);
      }
    };
    setTimeout(() => document.addEventListener("pointerdown", dismiss, true), 0);
    input.focus();
    input.select();
  }
  // Show options for a specific group
  function showGroupManagementOptions(gid, parentMenu, btn) {
    const grp = tabGroups[gid];
    if (!grp) return;
    const menu = document.createElement("div");
    menu.className = "group-ctx-menu group-mgmt-options-menu";
    menu.style.cssText = `
      position: fixed;
      z-index: 999999;
      background: var(--settings-bg, #fff);
      border: 1px solid var(--border-color, #e0e0e0);
      border-radius: 8px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.18);
      padding: 4px 0;
      min-width: 160px;
      font-size: 13px;
    `;

    const addItem = (label, icon, onClick, danger = false) => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "group-mgmt-item";
      if (danger) item.classList.add("danger");
      const iconSpan = document.createElement("span");
      iconSpan.style.fontSize = "15px";
      iconSpan.textContent = icon;
      const labelSpan = document.createElement("span");
      labelSpan.textContent = label;
      item.appendChild(iconSpan);
      item.appendChild(labelSpan);
      item.addEventListener(
        "mouseenter",
        () => (item.style.background = "var(--hover-bg, #f1f3f4)"),
      );
      item.addEventListener("mouseleave", () => (item.style.background = ""));
      item.addEventListener("mousedown", (ev) => {
        ev.stopPropagation();
        onClick();
        closeGroupManagementMenu();
      });
      menu.appendChild(item);
    };

    addItem("Rename", "A", () => {
      showGroupRenameDialog(gid, parentMenu.getBoundingClientRect().right + 8, parentMenu.getBoundingClientRect().top, closeGroupManagementMenu);
    });

    addItem("Change Color", "\u25cf", () => {
      showGroupColorPicker(gid);
    });

    addItem(`Delete "${grp.name}"`, "\u232b", () => deleteGroup(gid), true);

    document.body.appendChild(menu);
    const parentRect = parentMenu.getBoundingClientRect();
    let x = parentRect.right + 4;
    let y = parentRect.top;
    if (x + 160 > window.innerWidth) x = parentRect.left - 160;
    if (y + menu.offsetHeight > window.innerHeight) y = window.innerHeight - menu.offsetHeight - 8;
    menu.style.left = x + "px";
    menu.style.top = y + "px";

    const dismiss = (ev) => {
      if (!menu.contains(ev.target) && !parentMenu.contains(ev.target)) {
        menu.remove();
        document.removeEventListener("mousedown", dismiss);
      }
    };
    setTimeout(() => document.addEventListener("mousedown", dismiss), 0);
  }

  // Show color picker for group
  function showGroupColorPicker(gid) {
    const grp = tabGroups[gid];
    if (!grp) return;
    const dialog = document.createElement("div");
    dialog.style.cssText = `
      position: fixed;
      z-index: 999999;
      background: var(--settings-bg, #fff);
      border: 1px solid var(--border-color, #e0e0e0);
      border-radius: 8px;
      padding: 16px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.18);
      min-width: 250px;
    `;

    const label = document.createElement("div");
    label.textContent = "Pick a color";
    label.style.cssText = `
      font-size: 12px;
      color: #888;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 12px;
    `;
    dialog.appendChild(label);

    const colorRow = document.createElement("div");
    colorRow.style.cssText = "display:flex; gap:6px; flex-wrap:wrap;";
    GROUP_COLORS.forEach((c) => {
      const dot = document.createElement("div");
      dot.title = c.name;
      const isCurrentColor = c.value === tabGroups[gid]?.color;
      dot.style.cssText = `width:20px;height:20px;border-radius:50%;background:${c.value};cursor:pointer;border:${isCurrentColor ? "3px" : "2px"} solid ${isCurrentColor ? "#333" : "transparent"};transition:border-color .1s;`;
      dot.addEventListener("mouseenter", () => (dot.style.borderColor = "#333"));
      dot.addEventListener("mouseleave", () => {
        if (c.value !== tabGroups[gid]?.color) dot.style.borderColor = "transparent";
      });
      dot.addEventListener("mousedown", (ev) => {
        ev.stopPropagation();
        if (!tabGroups[gid]) return;
        tabGroups[gid].color = c.value;
        persistGroups();
        renderTabs();
        dialog.remove();
      });
      colorRow.appendChild(dot);
    });
    dialog.appendChild(colorRow);

    document.body.appendChild(dialog);
    dialog.style.left = (window.innerWidth / 2 - 125) + "px";
    dialog.style.top = (window.innerHeight / 2 - 75) + "px";

    const dismiss = (ev) => {
      if (!dialog.contains(ev.target)) {
        dialog.remove();
        document.removeEventListener("mousedown", dismiss);
      }
    };
    setTimeout(() => document.addEventListener("mousedown", dismiss), 0);
  }

  // Persist tabs throttled to avoid many writes during rapid changes
  let _persistTabsTimeout = null;
  function persistTabs() {
    if (isIncognitoWindow) return;
    if (_persistTabsTimeout) clearTimeout(_persistTabsTimeout);
    _persistTabsTimeout = setTimeout(() => {
      const persistentTabs = tabs.filter((tab) => !tab.isIncognito).map((tab) => {
        const { _pendingHistoryDirection, _pendingNavigationIndex, audible, hasMedia, ...persistentTab } = tab;
        void _pendingHistoryDirection;
        void _pendingNavigationIndex;
        void audible;
        void hasMedia;
        return persistentTab;
      });
      const persistentCurrentTabId = persistentTabs.some(
        (tab) => tab.id === currentTabId,
      )
        ? currentTabId
        : persistentTabs[0]?.id || null;
      storage.setItem(storageKey("tabs"), JSON.stringify(persistentTabs));
      storage.setItem(storageKey("currentTabId"), persistentCurrentTabId);
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
    } else if (
      /^[a-zA-Z0-9][a-zA-Z0-9-]*[a-zA-Z0-9]*\.(com|org|net|edu|gov|mil|int|co|uk|de|fr|jp|au|ca|br|in|cn|ru|nl|it|es|se|no|dk|fi|pl|ch|at|be|cz|gr|hu|ie|pt|ro|sk|bg|hr|ee|lv|lt|lu|mt|si|cy|is|li|mc|ad|sm|va|md|me|rs|mk|al|ba|by|ua|am|az|ge|kz|kg|tj|tm|uz|af|bd|bt|bn|kh|cn|hk|id|in|ir|iq|il|jo|jp|kw|la|lb|my|mv|mn|mm|np|kp|kr|om|pk|ph|qa|sa|sg|lk|sy|tw|th|tl|tr|ae|uz|vn|ye)$/i.test(
        url,
      )
    ) {
      // Looks like a domain name, add https://
      url = "https://" + url;
    } else if (
      /^[a-zA-Z0-9][a-zA-Z0-9-]*[a-zA-Z0-9]*\.[a-zA-Z]{2,}$/i.test(url)
    ) {
      // Generic domain pattern, add https://
      url = "https://" + url;
    } else if (/\.(com|org|net|edu|gov)$/i.test(url) || url.includes(".")) {
      // Contains common TLD or has a dot, probably a domain
      url = "https://" + url;
    } else {
      // Treat as search query - improved encoding and URL construction
      const searchEngine = currentSearchEngine;
      const searchUrls = {
        google: "https://www.google.com/search?q=",
        bing: "https://www.bing.com/search?q=",
        duckduckgo: "https://duckduckgo.com/?q=",
      };

      // Properly encode the search query and handle special characters
      const encodedQuery = encodeURIComponent(url.trim());
      url = searchUrls[searchEngine] + encodedQuery;

      console.log("Search query:", url.trim(), "-> Encoded URL:", url);
    }

    const tab = tabs.find((t) => t.id === currentTabId);
    if (tab) {
      console.log("Navigating to:", url);

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
        if (url === "settings.html" || url.includes("/settings.html")) {
          url = new URL("settings.html", window.location.href).href;
        } else if (url === "history.html" || url.includes("/history.html")) {
          url = new URL("history.html", window.location.href).href;
        }
      } catch (e) {}
      if (url && url !== "newtab") {
        ensureTabWebview(tab, { forceLoadUrl: true });
      }
      persistTabs();
      updateView({ renderTabStrip: false, renderStaticChrome: false });
      updateTabPresentation(tab);
    }
  }

  urlInput.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") {
      if (!omniboxSuggestions.length) {
        refreshOmniboxSuggestions();
      }
      if (omniboxSuggestions.length) {
        e.preventDefault();
        omniboxSelectedIndex =
          (omniboxSelectedIndex + 1 + omniboxSuggestions.length) %
          omniboxSuggestions.length;
        renderOmniboxSuggestions();
      }
      return;
    }

    if (e.key === "ArrowUp" && omniboxSuggestions.length) {
      e.preventDefault();
      omniboxSelectedIndex =
        (omniboxSelectedIndex - 1 + omniboxSuggestions.length) %
        omniboxSuggestions.length;
      renderOmniboxSuggestions();
      return;
    }

    if (e.key === "Tab" && omniboxSuggestions.length) {
      e.preventDefault();
      applyOmniboxSuggestion({ navigateToSuggestion: false });
      return;
    }

    if (e.key === "Escape") {
      hideOmniboxSuggestions();
      return;
    }

    if (e.key === "Enter") {
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
    urlInput.addEventListener("focus", () => {
      console.debug("URL input focused");
      if (omniboxHideTimer) clearTimeout(omniboxHideTimer);
      refreshOmniboxSuggestions();
    });
    urlInput.addEventListener("click", () => {
      console.debug("URL input clicked");
      if (omniboxHideTimer) clearTimeout(omniboxHideTimer);
      refreshOmniboxSuggestions();
    });
    urlInput.addEventListener("input", () => {
      if (omniboxHideTimer) clearTimeout(omniboxHideTimer);
      refreshOmniboxSuggestions();
    });
    urlInput.addEventListener("blur", () => {
      if (omniboxHideTimer) clearTimeout(omniboxHideTimer);
      omniboxHideTimer = setTimeout(() => hideOmniboxSuggestions(), 120);
    });
    window.addEventListener("blur", () => {
      hideOmniboxSuggestions();
    });
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) hideOmniboxSuggestions();
    });
  } catch (e) {
    /* ignore errors if element not present */
  }

  // --- Back/Forward Button Logic ---
  backBtn.onclick = () => {
    const tab = tabs.find((t) => t.id === currentTabId);
    const activeWebview = getActiveWebview();
    if (activeWebview?.canGoBack?.()) {
      tab._pendingHistoryDirection = -1;
      activeWebview.goBack();
      return;
    }
    if (tab.historyIndex > 0) {
      tab.historyIndex--;
      tab.url = tab.history[tab.historyIndex];
      if (tab.url && tab.url !== "newtab")
        ensureTabWebview(tab, { forceLoadUrl: true });
      persistTabs();
      updateView({ renderTabStrip: false, renderStaticChrome: false });
      updateTabPresentation(tab);
    }
  };

  forwardBtn.onclick = () => {
    const tab = tabs.find((t) => t.id === currentTabId);
    const activeWebview = getActiveWebview();
    if (activeWebview?.canGoForward?.()) {
      tab._pendingHistoryDirection = 1;
      activeWebview.goForward();
      return;
    }
    if (tab.historyIndex < tab.history.length - 1) {
      tab.historyIndex++;
      tab.url = tab.history[tab.historyIndex];
      if (tab.url && tab.url !== "newtab")
        ensureTabWebview(tab, { forceLoadUrl: true });
      persistTabs();
      updateView({ renderTabStrip: false, renderStaticChrome: false });
      updateTabPresentation(tab);
    }
  };

  // --- Settings Panel Logic ---
  // Get the new elements
  const settingsPanel = document.getElementById("settings-panel");
  const closeSettingsBtn = document.getElementById("close-settings");
  const homepageInput = document.getElementById("homepage-input");
  const saveHomepageBtn = document.getElementById("save-homepage-btn");
  const overlay = document.getElementById("overlay");
  const allSettingsBtn = document.getElementById("all-settings-btn");
  const quickHistoryPanel = document.getElementById("quick-history-panel");
  const closeQuickHistoryBtn = document.getElementById("close-quick-history");
  const quickHistoryList = document.getElementById("quick-history-list");
  const reopenTabBtn = document.getElementById("reopen-tab-btn");
  const viewAllHistoryBtn = document.getElementById("view-all-history-btn");
  const checkUpdatesBtn = document.getElementById("check-updates");
  const adblockToggle = document.getElementById("adblock-toggle");
  const adblockStrictToggle = document.getElementById("adblock-strict-toggle");
  const quickTrackerBlockingToggle = document.getElementById(
    "quick-tracker-blocking-toggle",
  );

  if (quickTrackerBlockingToggle && window.electronAPI?.getPrivacySettings) {
    window.electronAPI.getPrivacySettings().then((privacy) => {
      quickTrackerBlockingToggle.checked = !!privacy.trackerBlockEnabled;
    }).catch(() => {});
    quickTrackerBlockingToggle.addEventListener("change", (event) => {
      window.electronAPI.toggleTrackerBlocking?.(event.target.checked);
    });
    window.electronAPI.onPrivacySettingsChanged?.((privacy) => {
      quickTrackerBlockingToggle.checked = !!privacy.trackerBlockEnabled;
    });
  }

  async function openFullHistoryPage() {
    try {
      await historyManager.flush();
    } catch (err) {
      console.error("Failed to flush history before opening history page", err);
    }
    try {
      const fileUrl = new URL("history.html", window.location.href).href;
      const snapshotEntries = await getRecentHistoryEntries(120);
      const compactEntries = snapshotEntries.map((entry) => ({
        url: entry.url,
        title: entry.title || "",
        host: entry.host || "",
        timestamp: Number(entry.timestamp) || Date.now(),
      }));
      const snapshot = encodeURIComponent(JSON.stringify(compactEntries));
      newTab(`${fileUrl}#historyData=${snapshot}`);
    } catch (err) {
      newTab("history.html");
    }
  }

  async function getRecentHistoryEntries(limit = 18) {
    let persisted = [];
    try {
      persisted = JSON.parse((await storage.getItem("browserHistory")) || "[]");
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
      if (
        !existing ||
        (Number(entry.timestamp) || 0) >= (Number(existing.timestamp) || 0)
      ) {
        byUrl.set(key, {
          ...entry,
          url: key,
          timestamp: Number(entry.timestamp) || Date.now(),
        });
      }
    });

    return Array.from(byUrl.values())
      .sort((a, b) => (Number(b.timestamp) || 0) - (Number(a.timestamp) || 0))
      .slice(0, limit);
  }

  async function renderQuickHistoryPanel() {
    if (!quickHistoryList) return;
    quickHistoryList.innerHTML = "";

    const entries = await getRecentHistoryEntries(18);
    if (!entries.length) {
      quickHistoryList.innerHTML =
        '<div class="quick-history-empty">No recent history yet.</div>';
      return;
    }

    const frag = document.createDocumentFragment();
    entries.forEach((entry) => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "quick-history-item";

      const favicon = document.createElement("img");
      favicon.src = getFavicon(entry.url);
      favicon.onerror = function () {
        this.src = "icons/newtab.png";
      };

      const textWrap = document.createElement("div");
      textWrap.className = "quick-history-item-text";

      const title = document.createElement("div");
      title.className = "quick-history-item-title";
      title.textContent = entry.title || getSiteName(entry.url);

      const meta = document.createElement("div");
      meta.className = "quick-history-item-meta";
      meta.textContent = entry.url;

      textWrap.appendChild(title);
      textWrap.appendChild(meta);
      item.appendChild(favicon);
      item.appendChild(textWrap);

      item.addEventListener("click", () => {
        closeQuickHistoryPanel({ restoreUrlFocus: false });
        navigate(entry.url);
      });

      frag.appendChild(item);
    });

    quickHistoryList.appendChild(frag);
  }

  function openQuickHistoryPanel() {
    closeSettingsPanelIfOpen({ restoreUrlFocus: false });
    const closedTabs = readRecentlyClosedTabs();
    if (reopenTabBtn) {
      reopenTabBtn.disabled = closedTabs.length === 0;
      reopenTabBtn.title = closedTabs.length
        ? `Reopen: ${closedTabs[closedTabs.length - 1].title || closedTabs[closedTabs.length - 1].url}`
        : "No recently closed tabs";
    }
    renderQuickHistoryPanel().catch((error) => {
      console.error("Failed to render quick history panel", error);
    });

    if (!quickHistoryPanel || !overlay) return;
    quickHistoryPanel.style.visibility = "visible";
    overlay.classList.add("active");
    void quickHistoryPanel.offsetWidth;
    quickHistoryPanel.classList.add("active");
    document.body.style.overflow = "hidden";
    document.body.appendChild(overlay);
    document.body.appendChild(quickHistoryPanel);
    try {
      urlInput && urlInput.blur();
    } catch (e) {}
  }

  reopenTabBtn?.addEventListener("click", () => {
    if (reopenRecentlyClosedTab()) {
      closeQuickHistoryPanel({ restoreUrlFocus: false });
    }
  });

  function closeQuickHistoryPanel({ restoreUrlFocus = true } = {}) {
    if (!quickHistoryPanel || !overlay) return;
    quickHistoryPanel.classList.remove("active");
    overlay.classList.remove("active");

    setTimeout(() => {
      quickHistoryPanel.style.visibility = "hidden";
      overlay.style.visibility = "hidden";
      document.body.style.overflow = "";
      if (restoreUrlFocus) {
        try {
          urlInput && urlInput.focus();
        } catch (e) {}
      } else {
        hideOmniboxSuggestions();
      }
    }, 300);
  }

  function closeQuickHistoryPanelIfOpen(options = {}) {
    if (quickHistoryPanel && quickHistoryPanel.classList.contains("active")) {
      closeQuickHistoryPanel(options);
    }
  }

  if (
    window.electronAPI &&
    typeof window.electronAPI.on === "function" &&
    !window.__historyClearListenerBound
  ) {
    window.__historyClearListenerBound = true;
    window.electronAPI.on("clear-history", async () => {
      try {
        await historyManager.clear();
      } catch (e) {}
      try {
        if (typeof window.renderSettingsHistory === "function") {
          window.renderSettingsHistory();
        }
      } catch (e) {}
      try {
        if (
          quickHistoryPanel &&
          quickHistoryPanel.classList.contains("active")
        ) {
          renderQuickHistoryPanel();
        }
      } catch (e) {}
    });
  }

  // Settings button click handler
  if (settingsBtn) {
    settingsBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      closeQuickHistoryPanelIfOpen({ restoreUrlFocus: false });
      openSettingsPanel();
    });
  }

  if (historyBtn) {
    historyBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      openQuickHistoryPanel();
    });
  }

  // Check Updates button click handler
  if (checkUpdatesBtn) {
    checkUpdatesBtn.addEventListener("click", async function (e) {
      e.stopPropagation();
      try {
        await window.electronAPI.checkForUpdates();
      } catch (error) {
        console.error("Manual update check failed:", error);
        showUpdateNotification(
          "Failed to check for updates. Please try again later.",
          "error",
        );
      }
    });
  }

  if (adblockToggle) {
    storage
      .getItem("adblockEnabled")
      .then((saved) => {
        const enabled = saved === "true";
        adblockToggle.checked = enabled;
        try {
          localStorage.setItem("adblockEnabled", enabled ? "true" : "false");
        } catch (_error) {}
        try {
          if (
            window.electronAPI &&
            typeof window.electronAPI.toggleAdBlock === "function"
          )
            window.electronAPI.toggleAdBlock(enabled);
        } catch (_error) {}
      })
      .catch(() => {
        adblockToggle.checked =
          localStorage.getItem("adblockEnabled") === "true";
      });

    adblockToggle.addEventListener("change", async (event) => {
      const enabled = !!event.target.checked;
      localStorage.setItem("adblockEnabled", enabled ? "true" : "false");
      await storage.setItem("adblockEnabled", enabled ? "true" : "false");
      if (
        window.electronAPI &&
        typeof window.electronAPI.toggleAdBlock === "function"
      ) {
        window.electronAPI.toggleAdBlock(enabled);
      }
      showUpdateNotification(
        enabled ? "Ad blocker enabled" : "Ad blocker disabled",
        "info",
        2000,
      );
    });
  }

  if (adblockStrictToggle) {
    storage
      .getItem("adblockMode")
      .then((savedMode) => {
        const mode = savedMode === "strict" ? "strict" : "balanced";
        adblockStrictToggle.checked = mode === "strict";
        try {
          localStorage.setItem("adblockMode", mode);
        } catch (_error) {}
        try {
          if (
            window.electronAPI &&
            typeof window.electronAPI.setAdBlockMode === "function"
          )
            window.electronAPI.setAdBlockMode(mode);
        } catch (_error) {}
      })
      .catch(() => {
        adblockStrictToggle.checked =
          localStorage.getItem("adblockMode") === "strict";
      });

    adblockStrictToggle.addEventListener("change", async (event) => {
      const mode = event.target.checked ? "strict" : "balanced";
      localStorage.setItem("adblockMode", mode);
      await storage.setItem("adblockMode", mode);
      if (
        window.electronAPI &&
        typeof window.electronAPI.setAdBlockMode === "function"
      ) {
        window.electronAPI.setAdBlockMode(mode);
      }
      showUpdateNotification(
        mode === "strict"
          ? "Ad blocker mode: strict"
          : "Ad blocker mode: balanced",
        "info",
        2000,
      );
    });
  }

  // All Settings button click handler
  if (allSettingsBtn) {
    allSettingsBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      let settingsPath = "settings.html";
      try {
        settingsPath = new URL("settings.html", window.location.href).href;
      } catch (err) {}
      newTab(settingsPath);
      closeSettingsPanel(); // Close the settings panel when opening full settings
    });
  }

  // Close settings button click handler
  if (closeSettingsBtn) {
    closeSettingsBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      closeSettingsPanel({ restoreUrlFocus: false });
    });
  }

  if (closeQuickHistoryBtn) {
    closeQuickHistoryBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      closeQuickHistoryPanel({ restoreUrlFocus: false });
    });
  }

  if (viewAllHistoryBtn) {
    viewAllHistoryBtn.addEventListener("click", async function (e) {
      e.stopPropagation();
      closeQuickHistoryPanel({ restoreUrlFocus: false });
      await openFullHistoryPage();
    });
  }

  // Save homepage button
  if (saveHomepageBtn) {
    saveHomepageBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      let url = homepageInput.value.trim();
      if (url && !/^https?:\/\//i.test(url)) {
        url = "http://" + url;
      }
      homepage = url;
      storage.setItem("homepage", homepage);

      // Visual feedback on save
      saveHomepageBtn.textContent = "Saved!";
      saveHomepageBtn.style.backgroundColor = "#34A853"; // Google green

      setTimeout(() => {
        saveHomepageBtn.textContent = "Save";
        saveHomepageBtn.style.backgroundColor = "";
      }, 1500);
    });
  }

  // Overlay click handler - close settings when clicking outside
  if (overlay) {
    overlay.addEventListener("click", () => {
      closeQuickHistoryPanelIfOpen({ restoreUrlFocus: false });
      closeSettingsPanelIfOpen({ restoreUrlFocus: false });
    });
    // Ensure overlay is not blocking interaction by default
    try {
      overlay.classList.remove("active");
      overlay.style.visibility = overlay.style.visibility || "hidden";
    } catch (e) {
      /* ignore */
    }
  }

  // Quick Settings Sidebar Accordion
  async function initializeSettingsAccordion() {
    const sections = document.querySelectorAll(
      "#settings-panel .settings-section",
    );
    if (!sections || sections.length === 0) return;

    let savedState = {};
    try {
      const rawState = await storage.getItem("quickSettingsAccordionState");
      savedState = rawState ? JSON.parse(rawState) : {};
    } catch (error) {
      console.debug("No saved quick settings accordion state found", error);
      savedState = {};
    }

    const persistState = () => {
      try {
        storage.setItem(
          "quickSettingsAccordionState",
          JSON.stringify(savedState),
        );
      } catch (error) {
        console.debug(
          "Failed to persist quick settings accordion state",
          error,
        );
      }
    };

    sections.forEach((section, index) => {
      const heading = section.querySelector("h3");
      if (!heading || heading.dataset.accordionReady === "true") return;

      if (section.classList.contains("non-collapsible")) {
        section.classList.remove("collapsed");
        heading.removeAttribute("role");
        heading.removeAttribute("tabindex");
        heading.removeAttribute("aria-expanded");
        return;
      }

      const sectionKey = section.id || `section-${index}`;
      const isSavedCollapsed =
        typeof savedState[sectionKey] === "boolean"
          ? savedState[sectionKey]
          : null;
      const shouldStartOpen =
        isSavedCollapsed === null ? index < 3 : !isSavedCollapsed;
      section.classList.toggle("collapsed", !shouldStartOpen);

      heading.setAttribute("role", "button");
      heading.setAttribute("tabindex", "0");
      heading.setAttribute("aria-expanded", shouldStartOpen ? "true" : "false");

      const toggleSection = () => {
        const collapsed = section.classList.toggle("collapsed");
        heading.setAttribute("aria-expanded", collapsed ? "false" : "true");
        savedState[sectionKey] = collapsed;
        persistState();
      };

      heading.addEventListener("click", (event) => {
        event.stopPropagation();
        toggleSection();
      });

      heading.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          toggleSection();
        }
      });

      heading.dataset.accordionReady = "true";
    });
  }

  initializeSettingsAccordion();

  // Open the settings panel
  function openSettingsPanel() {
    initializeSettingsAccordion();
    // Set all current setting values before showing
    if (homepageInput) {
      homepageInput.value = homepage || "";
    }

    // Update all settings controls with current values
    const searchEngineSelect = document.getElementById("search-engine-select");
    if (searchEngineSelect) {
      searchEngineSelect.value =
        localStorage.getItem("searchEngine") || "google";
    }

    const themeSelect = document.getElementById("theme-select");
    if (themeSelect) {
      themeSelect.value = normalizeTheme(localStorage.getItem("theme"));
    }

    const fontSizeInput = document.getElementById("font-size-input");
    if (fontSizeInput) {
      fontSizeInput.value = localStorage.getItem("fontSize") || "16";
    }

    const showBookmarksBar = document.getElementById("show-bookmarks-bar");
    if (showBookmarksBar) {
      showBookmarksBar.checked =
        localStorage.getItem("showBookmarksBar") !== "false";
    }

    const startPageSelect = document.getElementById("start-page-select");
    if (startPageSelect) {
      startPageSelect.value = localStorage.getItem("startPage") || "homepage";
    }

    if (adblockToggle) {
      adblockToggle.checked = localStorage.getItem("adblockEnabled") === "true";
    }
    if (adblockStrictToggle) {
      adblockStrictToggle.checked =
        localStorage.getItem("adblockMode") === "strict";
    }

    const userAgentInput = document.getElementById("user-agent-input");
    if (userAgentInput) {
      userAgentInput.value = localStorage.getItem("userAgent") || "";
    }

    // Apply current theme to settings panel
    const currentTheme = normalizeTheme(localStorage.getItem("theme"));
    settingsPanel.classList.remove(...DARK_THEMES);
    settingsPanel.classList.add(currentTheme);

    // First, make the panel visible but keep it off-screen
    // This ensures it's in the DOM and rendered
    settingsPanel.style.visibility = "visible";
    overlay.classList.add("active");

    // Force a reflow to ensure styles are applied
    void settingsPanel.offsetWidth;

    // Now add the active class to trigger the animation
    settingsPanel.classList.add("active");

    // Prevent scrolling of the main content while settings are open
    document.body.style.overflow = "hidden";

    // For extra safety, move the settings panel and overlay to the end of body
    // This sometimes helps with z-index stacking contexts
    document.body.appendChild(overlay);
    document.body.appendChild(settingsPanel);
    // Blur the URL input so keyboard input doesn't keep going to the url bar
    try {
      urlInput && urlInput.blur();
    } catch (e) {}
  }

  // Close the settings panel
  function closeSettingsPanel({ restoreUrlFocus = true } = {}) {
    // Remove the active class first to trigger the animation
    settingsPanel.classList.remove("active");
    overlay.classList.remove("active");

    // Wait for animation to complete before hiding
    setTimeout(() => {
      // Hide the panel and overlay after animation completes
      settingsPanel.style.visibility = "hidden";
      overlay.style.visibility = "hidden";

      // Restore scrolling
      document.body.style.overflow = "";
      if (restoreUrlFocus) {
        try {
          urlInput && urlInput.focus();
        } catch (e) {}
      } else {
        hideOmniboxSuggestions();
      }
    }, 300);
  }

  function closeSettingsPanelIfOpen(options = {}) {
    if (settingsPanel && settingsPanel.classList.contains("active")) {
      closeSettingsPanel(options);
    }
  }

  // Webview can sit above DOM overlays in Electron; close quick settings on direct webview interaction.
  if (contentWebview && !contentWebview._settingsCloseListenersBound) {
    contentWebview.addEventListener(
      "mousedown",
      () => {
        closeSettingsPanelIfOpen({ restoreUrlFocus: false });
        closeQuickHistoryPanelIfOpen({ restoreUrlFocus: false });
        closeGroupManagementMenu();
      },
      { passive: true },
    );

    contentWebview.addEventListener("focus", () => {
      closeSettingsPanelIfOpen({ restoreUrlFocus: false });
      closeQuickHistoryPanelIfOpen({ restoreUrlFocus: false });
    });

    contentWebview._settingsCloseListenersBound = true;
  }

  // Handle escape key to close the panel (prevent duplicate listeners)
  if (!document.escapeKeyListenerAdded) {
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") {
        closeQuickHistoryPanelIfOpen({ restoreUrlFocus: false });
        closeGroupManagementMenu();
        // Check if the settings panel is visible
        if (settingsPanel && settingsPanel.classList.contains("active")) {
          closeSettingsPanel();
        }
      }
    });
    document.escapeKeyListenerAdded = true;
  }

  // --- Bookmarks Bar ---
  function renderBookmarkBar() {
    perfStart("renderBookmarkBar");
    // Exit early if bookmark bar doesn't exist (e.g., on settings page)
    if (!bookmarkBar) return;
    const currentTab = tabs.find((t) => t.id === currentTabId);
    // Hide the bookmark bar for pages that shouldn't show it (settings/history)
    if (
      currentTab &&
      currentTab.url &&
      (currentTab.url.includes("settings.html") ||
        currentTab.url.includes("history.html"))
    ) {
      bookmarkBar.style.display = "none";
      perfEnd("renderBookmarkBar");
      return;
    }

    bookmarkBar.innerHTML = "";

    // Check if we should show the bookmark bar
    const shouldShowBar = bookmarks.length > 0;
    const showBookmarksBar = document.getElementById("show-bookmarks-bar");
    const userWantsToShow = !showBookmarksBar || showBookmarksBar.checked;

    // Hide bar if no bookmarks, regardless of user setting
    const actuallyVisible = shouldShowBar && userWantsToShow;
    if (!shouldShowBar) {
      bookmarkBar.style.display = "none";
    } else {
      // Show bar only if user wants it visible and there are bookmarks
      bookmarkBar.style.display = userWantsToShow ? "flex" : "none";
    }

    // Don't notify main process if we're on settings page (settings page always uses full header height)
    if (!window.location.href.includes("settings.html")) {
      // Notify main process about bookmark bar visibility change
      window.electronAPI.setBookmarkBarVisibility(actuallyVisible);
    }

    const frag = document.createDocumentFragment();
    bookmarks.forEach((b, index) => {
      const btn = document.createElement("button");
      btn.className = "bookmark-btn";
      btn.onclick = () => {
        const tab = tabs.find((t) => t.id === currentTabId);
        let url = b.url || b;

        if (tab) {
          // Navigate in current tab
          if (!/^https?:\/\//i.test(url)) {
            url = "http://" + url;
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

      const favicon = document.createElement("img");
      const host = getHostFromUrl(b.url || b);
      favicon.dataset.faviconHost = host;
      favicon.src = getFavicon(b.url || b);
      favicon.onerror = function () {
        this.src = "icons/newtab.png";
      };
      btn.appendChild(favicon);

      btn.appendChild(document.createTextNode(b.label || b.url || b));

      const deleteBtn = document.createElement("div");
      deleteBtn.className = "delete-bookmark";
      deleteBtn.onclick = (e) => {
        e.stopPropagation();
        deleteBookmark(index);
      };
      btn.appendChild(deleteBtn);

      frag.appendChild(btn);
    });
    bookmarkBar.appendChild(frag);
    perfEnd("renderBookmarkBar");
  }

  function deleteBookmark(index) {
    bookmarks.splice(index, 1);
    debouncedSetItem("bookmarks", JSON.stringify(bookmarks));
    renderBookmarkBar();
  }

  bookmarkAddBtn.onclick = () => {
    const tab = tabs.find((t) => t.id === currentTabId);
    if (
      tab.url &&
      tab.url !== "newtab" &&
      !bookmarks.some((b) => (b.url || b) === tab.url)
    ) {
      // Use the page title if available, otherwise generate a friendly name from URL
      let label = tab.title || "Untitled";
      if (label === tab.url || !tab.title) {
        try {
          // Generate a friendly name from URL (domain name)
          label = new URL(tab.url).hostname.replace(/^www\./, "");
        } catch {
          label = tab.url;
        }
      }
      bookmarks.push({ url: tab.url, label: label });
      debouncedSetItem("bookmarks", JSON.stringify(bookmarks));
      renderBookmarkBar();
    }
  };

  // --- Homepage ---
  // Navigate to homepage in current tab
  setHomeBtn.onclick = () => {
    if (homepage) {
      const tab = tabs.find((t) => t.id === currentTabId);
      if (tab) {
        let url = homepage;
        if (!/^https?:\/\//i.test(url)) {
          url = "http://" + url;
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
    try {
      localStorage.removeItem(storageKey("tabs"));
    } catch (e) {}
    try {
      localStorage.removeItem(storageKey("currentTabId"));
    } catch (e) {}

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
  window.electronAPI.on("tab-drag-started", (_event, payload) => {
    try {
      const indicator = document.getElementById("tab-drop-indicator");
      if (!indicator) {
        const div = document.createElement("div");
        div.id = "tab-drop-indicator";
        div.textContent = "Drop tab here to attach";
        div.style.position = "fixed";
        div.style.left = "50%";
        div.style.transform = "translateX(-50%)";
        div.style.top = "50%";
        div.style.marginTop = "-20px";
        div.style.padding = "12px 24px";
        div.style.background = "rgba(66, 133, 244, 0.9)";
        div.style.color = "#fff";
        div.style.borderRadius = "8px";
        div.style.zIndex = "999999";
        div.style.fontSize = "16px";
        div.style.fontWeight = "bold";
        div.style.pointerEvents = "none";
        document.body.appendChild(div);
      }
    } catch (err) {
      /* ignore */
    }

    // Store external drag metadata globally
    const incomingMeta = payload?.tabMeta || null;
    const incomingSourceWinId = Number(incomingMeta?.sourceWinId);
    const thisWinId = Number(_windowId);
    if (
      incomingMeta &&
      Number.isFinite(incomingSourceWinId) &&
      Number.isFinite(thisWinId) &&
      incomingSourceWinId !== thisWinId
    ) {
      window._externalDraggedTabMeta = incomingMeta;
      window._currentDragTransferId = incomingMeta.transferId || null;
    } else {
      window._externalDraggedTabMeta = null;
      window._currentDragTransferId = null;
    }
    window._tabDropHandled = false;
    console.log(
      "[DND] tab-drag-started received:",
      window._externalDraggedTabMeta,
      "transferId:",
      window._currentDragTransferId,
    );
  });

  window.electronAPI.on("tab-drag-ended", () => {
    try {
      const indicator = document.getElementById("tab-drop-indicator");
      if (indicator) indicator.remove();
    } catch (err) {}
    window._externalDraggedTabMeta = null;
    window._currentDragTransferId = null;
    window._tabDropHandled = true;
    console.log("[DND] tab-drag-ended");
  });

  // Specific signal that a drop for a tab id was successfully attached at destination
  window.electronAPI.on("tab-drop-complete", (_event, tabId) => {
    try {
      console.log("renderer: tab-drop-complete received for", tabId);
      // Mark this drag as handled — skip detach on source
      dropHandled = true;
    } catch (err) {
      console.error("tab-drop-complete handler failed", err);
    }
  });

  // When another window drops a tab onto this window's tab bar, handle the IPC
  window.electronAPI.on("open-in-new-tab", (url) => {
    // Ensure not duplicating this listener; renderer already handles open-in-new-tab above.
  });

  window.electronAPI.on("remove-tab-by-id", (_event, id) => {
    try {
      closeTab(id);
    } catch (err) {
      console.error("remove-tab-by-id failed", err);
    }
  });

  // Remove a tab record without destroying its BrowserView (used for transfers)
  window.electronAPI.on("remove-tab-record", (_event, id) => {
    try {
      const tabIndex = tabs.findIndex((t) => t.id === id);
      if (tabIndex === -1) return;

      // Remove the tab entry but do not call viewDestroy - the BrowserView has been
      // transferred to another window by the main process and should remain intact.
      console.log(
        "remove-tab-record: id=",
        id,
        "tabIndex=",
        tabIndex,
        "tabsLenBefore=",
        tabs.length,
      );
      tabs.splice(tabIndex, 1);
      removeTabWebview(id);

      // Adjust current tab selection or close window if no tabs remain
      if (currentTabId === id) {
        if (tabs.length > 0) {
          currentTabId = tabs[tabIndex]
            ? tabs[tabIndex].id
            : tabs[tabs.length - 1].id;
        } else {
          // No tabs left - if this was a transfer, close the window if only a 'newtab' placeholder would remain
          if (window._isNewWindowTarget) {
            setTimeout(() => {
              window.close();
            }, 300);
            return;
          }
          // Otherwise, create a 'newtab' placeholder
          const newId = Date.now();
          tabs.push({
            id: newId,
            url: "newtab",
            history: ["newtab"],
            historyIndex: 0,
            viewCreated: false,
          });
          currentTabId = newId;
        }
      }

      persistTabs();
      console.log(
        "remove-tab-record: tabsLenAfter=",
        tabs.length,
        "currentTabId=",
        currentTabId,
      );
      updateView();
      renderTabs();
    } catch (err) {
      console.error("remove-tab-record failed", err);
    }
  });

  // Handler for when a BrowserView has been attached to this window (via main process transfer)
  window.electronAPI.on("attach-tab-handled", (_event, payload) => {
    try {
      const { tab, viewCreated, dropTargetTabId } = payload || {};
      if (!tab || !tab.id) return;
      const normalizedDropTargetId = Number.isFinite(Number(dropTargetTabId))
        ? Number(dropTargetTabId)
        : null;
      let incomingTabId = Number(tab.id);
      if (!Number.isFinite(incomingTabId)) incomingTabId = Date.now();
      if (!viewCreated) {
        while (
          tabs.some(
            (existingTab) => existingTab && existingTab.id === incomingTabId,
          )
        ) {
          incomingTabId += 1;
        }
      }
      const incomingTabRecord = {
        id: incomingTabId,
        url: tab.url,
        history: [tab.url],
        historyIndex: 0,
        viewCreated: !!viewCreated,
      };
      // Remove any placeholder or duplicate tabs
      let replaced = false;
      if (tabs.length === 1 && tabs[0].url === "newtab") {
        tabs[0] = incomingTabRecord;
        replaced = true;
      } else {
        // Remove any 'newtab' placeholder tabs in this window (from a detached window)
        for (let i = tabs.length - 1; i >= 0; i--) {
          if (tabs[i].url === "newtab" && !tabs[i].viewCreated)
            tabs.splice(i, 1);
        }
        // Remove any tabs with the same id (shouldn't happen, but for safety)
        for (let i = tabs.length - 1; i >= 0; i--) {
          if (tabs[i].id === incomingTabId) tabs.splice(i, 1);
        }
        const targetIndex =
          normalizedDropTargetId !== null
            ? tabs.findIndex(
                (existingTab) => existingTab.id === normalizedDropTargetId,
              )
            : -1;
        if (targetIndex >= 0)
          tabs.splice(targetIndex + 1, 0, incomingTabRecord);
        else tabs.push(incomingTabRecord);
      }
      currentTabId = incomingTabId;
      persistTabs();
      renderTabs();
      const activeIncomingTab = tabs.find(
        (existingTab) => existingTab.id === incomingTabId,
      );
      if (
        !viewCreated &&
        activeIncomingTab &&
        activeIncomingTab.url &&
        activeIncomingTab.url !== "newtab"
      ) {
        try {
          ensureTabWebview(activeIncomingTab, { forceLoadUrl: true });
          activeIncomingTab.viewCreated = true;
        } catch (error) {
          console.error(
            "attach-tab-handled: failed to prepare incoming webview",
            error,
          );
        }
      }
      updateView();
      // If a BrowserView was attached by main, ack back that renderer is ready
      if (viewCreated) {
        try {
          if (window.electronAPI && window.electronAPI.attachTabAck)
            window.electronAPI.attachTabAck(incomingTabId);
        } catch (e) {}
      }
      // If this window was a detached/orphaned window, and now has no tabs except the reattached one, close it
      // Only close if this window is not the main/original window and is now empty or only has the reattached tab
      if (
        window._isNewWindowTarget &&
        tabs.length === 1 &&
        tabs[0].id === incomingTabId &&
        replaced
      ) {
        setTimeout(() => {
          window.close();
        }, 300);
      }
      console.log(
        "attach-tab-handled: tabId=",
        incomingTabId,
        "viewCreated=",
        viewCreated,
        "currentTabs=",
        tabs.length,
        "dropTargetTabId=",
        normalizedDropTargetId,
      );
    } catch (err) {
      console.error("attach-tab-handled failed", err);
    }
  });

  // --- Quick Links ---
  function renderQuickLinks() {
    perfStart("renderQuickLinks");
    quickLinksDiv.innerHTML = "";
    quickLinks.forEach((q, i) => {
      const ql = document.createElement("div");
      ql.className = "quick-link";
      ql.onclick = () => navigate(q.url);

      const closeBtn = document.createElement("div");
      closeBtn.className = "close";
      closeBtn.onclick = (e) => {
        e.stopPropagation();
        quickLinks.splice(i, 1);
        debouncedSetItem("quickLinks", JSON.stringify(quickLinks));
        renderQuickLinks();
      };
      ql.appendChild(closeBtn);

      const favicon = document.createElement("img");
      const host = getHostFromUrl(q.url);
      favicon.dataset.faviconHost = host;
      favicon.src = getFavicon(q.url);
      favicon.onerror = function () {
        this.src = "icons/newtab.png";
      };
      ql.appendChild(favicon);

      const label = document.createElement("div");
      label.className = "quick-link-label";
      label.textContent = q.label || q.url;
      ql.appendChild(label);

      quickLinksDiv.appendChild(ql);
    });

    // Add the "Add new" button at the end
    const addBtn = document.createElement("button");
    addBtn.id = "add-quick-link-btn";
    addBtn.textContent = "+";

    if (addQuickLinkModal) {
      addBtn.onclick = () => {
        addQuickLinkModal.style.display = "block";
      };
    }
    quickLinksDiv.appendChild(addBtn);
    perfEnd("renderQuickLinks");
  }

  // Modal Logic - only if the elements exist
  if (addQuickLinkModal && closeButton && saveQuickLinkBtn) {
    closeButton.onclick = () => {
      addQuickLinkModal.style.display = "none";
    };

    window.addEventListener("click", (event) => {
      if (event.target == addQuickLinkModal) {
        addQuickLinkModal.style.display = "none";
      }
    });

    saveQuickLinkBtn.onclick = () => {
      let url = newQuickLinkUrlInput.value.trim();
      let label = newQuickLinkLabelInput.value.trim();

      if (!url) {
        showUpdateNotification("URL is required.", "error", 3000);
        return;
      }

      if (!/^https?:\/\//i.test(url)) {
        url = "http://" + url;
      }

      if (!label) {
        try {
          label = new URL(url).hostname.replace(/^www\./, "");
        } catch {
          label = url;
        }
      }

      if (!quickLinks.some((q) => q.url === url)) {
        quickLinks.push({ url, label });
        debouncedSetItem("quickLinks", JSON.stringify(quickLinks));
        renderQuickLinks();
        newQuickLinkUrlInput.value = "";
        newQuickLinkLabelInput.value = "";
        addQuickLinkModal.style.display = "none";
      } else {
        showUpdateNotification("This quick link already exists.", "info", 3000);
      }
    };
  }

  // Reload button logic
  reloadBtn.onclick = () => {
    const tab = tabs.find((t) => t.id === currentTabId);
    if (tab && tab.url !== "newtab") {
      try {
        const activeWebview = getActiveWebview();
        if (activeWebview) activeWebview.reload();
      } catch (e) {}
    }
  };

  // --- Initial Render ---
  renderTabs();
  updateView();

  // --- Settings Panel Feature Logic ---
  // Theme switching
  function applyTheme(themeClassName) {
    themeClassName = normalizeTheme(themeClassName);
    const themeClasses = [
      "theme-dark",
      "theme-dark-purple",
      "theme-dark-nord",
      "theme-dark-forest",
      "theme-dark-rose",
      "theme-dark-sakura",
      "theme-dark-sunny",
    ];
    // Remove all possible theme classes to avoid conflicts
    document.body.classList.remove(...themeClasses);

    // Add the single, correct class (e.g., 'theme-dark' or 'theme-dark-purple')
    document.body.classList.add(themeClassName);
  }

  // --- Theme Broadcasting ---
  // Listen for theme changes from other windows (like the settings page)
  window.electronAPI.onThemeChanged((themeClassName) => {
    themeClassName = normalizeTheme(themeClassName);
    console.log("Theme change received in main window:", themeClassName);
    storage.setItem("theme", themeClassName);
    applyTheme(themeClassName);

    // Update the sidebar theme dropdown if it exists
    const themeSelect = document.getElementById("theme-select");
    if (themeSelect) {
      themeSelect.value = themeClassName;
    }
  });

  // Apply the initial theme on load
  storage.getItem("theme").then((initialTheme) => {
    const theme = normalizeTheme(initialTheme);
    storage.setItem("theme", theme);
    applyTheme(theme);

    // Update theme select handler in the slide-out panel
    const themeSelect = document.getElementById("theme-select");
    if (themeSelect) {
      themeSelect.value = theme;
      console.log("Set theme select to:", theme);
      themeSelect.onchange = () => {
        const themeClassName = normalizeTheme(themeSelect.value);
        console.log("Theme changed to:", themeClassName);
        storage.setItem("theme", themeClassName);
        applyTheme(themeClassName);
        // Also broadcast this change to other windows
        window.electronAPI.broadcastThemeChange(themeClassName);
      };
    } else {
      console.log("Theme select element not found");
    }
  });

  // Search engine selection
  const searchEngineSelect = document.getElementById("search-engine-select");
  if (searchEngineSelect) {
    searchEngineSelect.value = localStorage.getItem("searchEngine") || "google";
    searchEngineSelect.onchange = () => {
      localStorage.setItem("searchEngine", searchEngineSelect.value);
    };
  }

  // Font size
  const fontSizeInput = document.getElementById("font-size-input");
  if (fontSizeInput) {
    fontSizeInput.value = localStorage.getItem("fontSize") || "16";
    document.body.style.fontSize = fontSizeInput.value + "px";
    fontSizeInput.oninput = () => {
      localStorage.setItem("fontSize", fontSizeInput.value);
      document.body.style.fontSize = fontSizeInput.value + "px";
    };
  }

  // Bookmarks bar toggle
  const showBookmarksBar = document.getElementById("show-bookmarks-bar");
  if (showBookmarksBar) {
    showBookmarksBar.checked =
      localStorage.getItem("showBookmarksBar") !== "false";

    // Initial render respects both user setting and bookmark presence
    renderBookmarkBar();

    showBookmarksBar.onchange = () => {
      localStorage.setItem("showBookmarksBar", showBookmarksBar.checked);
      // Re-render to apply new visibility logic
      renderBookmarkBar();
    };
  }

  // Page zoom control
  const pageZoomSelect = document.getElementById("page-zoom-select");
  if (pageZoomSelect) {
    const currentZoom = localStorage.getItem("pageZoom") || "1";
    pageZoomSelect.value = currentZoom;
    document.body.style.zoom = currentZoom;

    pageZoomSelect.onchange = () => {
      const zoomLevel = pageZoomSelect.value;
      localStorage.setItem("pageZoom", zoomLevel);
      document.body.style.zoom = zoomLevel;

      // Apply zoom to all tabs if possible
      if (window.electronAPI && window.electronAPI.setZoomLevel) {
        window.electronAPI.setZoomLevel(parseFloat(zoomLevel));
      }
    };
  }

  // Clear browsing data
  const clearDataBtn = document.getElementById("clear-data-btn");
  if (clearDataBtn) {
    if (isIncognitoWindow) {
      clearDataBtn.disabled = true;
      clearDataBtn.title = "Browsing data cannot be changed from an incognito window";
    }
    clearDataBtn.onclick = async () => {
      if (isIncognitoWindow) return;
      localStorage.clear();
      await storage.setItem("browserHistory", "[]");
      location.reload();
    };
  }

  // Start page selection
  const startPageSelect = document.getElementById("start-page-select");
  if (startPageSelect) {
    startPageSelect.value = localStorage.getItem("startPage") || "homepage";
    startPageSelect.onchange = () => {
      localStorage.setItem("startPage", startPageSelect.value);
    };
  }

  // Incognito tabs use an in-memory Electron session with the existing chrome.
  const incognitoBtn = document.getElementById("incognito-btn");
  if (incognitoBtn) {
    incognitoBtn.onclick = () => {
      newTab("newtab", false, { incognito: true });
    };
  }

  const privacyShieldBtn = document.getElementById("privacy-shield-btn");
  const privacyShieldPanel = document.getElementById("privacy-shield-panel");
  const privacyShieldSite = document.getElementById("privacy-shield-site");
  const privacyShieldSummary = document.getElementById("privacy-shield-summary");
  const privacyShieldStatus = document.getElementById("privacy-shield-status");
  const privacySiteException = document.getElementById("privacy-site-exception");

  function activePrivacyUrl() {
    return tabs.find((tab) => tab.id === currentTabId)?.url || "";
  }

  async function refreshPrivacyShield() {
    const info = await window.electronAPI?.getSitePrivacy?.(activePrivacyUrl());
    if (!info) return;
    privacyShieldSite.textContent = info.hostname || "Privacy protection";
    privacySiteException.checked = !!info.exception;
    privacySiteException.disabled = !info.hostname;
    privacyShieldStatus.textContent = info.hostname ? (info.exception ? "Disabled" : "Active") : "Inactive";
    privacyShieldStatus.classList.toggle("is-disabled", !info.hostname || !!info.exception);
    const total = Object.values(info.stats || {}).reduce((sum, value) => sum + Number(value || 0), 0);
    privacyShieldSummary.textContent = info.exception
      ? "Protections are disabled for this site."
      : `${total.toLocaleString()} privacy interventions across this browser profile.`;
  }

  privacyShieldBtn?.addEventListener("click", async () => {
    const opening = privacyShieldPanel.hidden;
    privacyShieldPanel.hidden = !opening;
    privacyShieldBtn.setAttribute("aria-expanded", String(opening));
    if (opening) await refreshPrivacyShield();
  });
  document.addEventListener("click", (event) => {
    if (
      privacyShieldPanel?.hidden ||
      privacyShieldPanel?.contains(event.target) ||
      privacyShieldBtn?.contains(event.target)
    ) {
      return;
    }
    privacyShieldPanel.hidden = true;
    privacyShieldBtn.setAttribute("aria-expanded", "false");
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || connectionInfoPanel?.hidden) return;
    connectionInfoPanel.hidden = true;
    connectionInfoBtn?.setAttribute("aria-expanded", "false");
    connectionInfoBtn?.focus();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || privacyShieldPanel?.hidden) return;
    privacyShieldPanel.hidden = true;
    privacyShieldBtn.setAttribute("aria-expanded", "false");
    privacyShieldBtn.focus();
  });
  privacySiteException?.addEventListener("change", async (event) => {
    await window.electronAPI.setSitePrivacyException(activePrivacyUrl(), event.target.checked);
    await refreshPrivacyShield();
    getActiveWebview()?.reload();
  });
  document.getElementById("privacy-clear-site-data")?.addEventListener("click", async () => {
    if (await window.electronAPI.clearSiteData(activePrivacyUrl())) {
      showUpdateNotification("Site data cleared", "success", 2500);
      getActiveWebview()?.reload();
    }
  });
  document.getElementById("privacy-open-settings")?.addEventListener("click", () => {
    privacyShieldPanel.hidden = true;
    newTab("settings.html");
  });

  // Tab management
  const pinTabBtn = document.getElementById("pin-tab-btn");
  if (pinTabBtn) {
    pinTabBtn.onclick = () => {
      const tab = tabs.find((t) => t.id === currentTabId);
      if (tab) {
        tab.pinned = !tab.pinned;
        renderTabs();
        persistTabs();
      }
    };
  }
  const duplicateTabBtn = document.getElementById("duplicate-tab-btn");
  if (duplicateTabBtn) {
    duplicateTabBtn.onclick = () => {
      const tab = tabs.find((t) => t.id === currentTabId);
      if (tab) {
        newTab(tab.url);
      }
    };
  }

  // Bookmark folders (basic modal)
  const manageBookmarkFoldersBtn = document.getElementById(
    "manage-bookmark-folders-btn",
  );
  if (manageBookmarkFoldersBtn) {
    manageBookmarkFoldersBtn.onclick = () => {
      showUpdateNotification(
        "Bookmark folders management coming soon!",
        "info",
        3000,
      );
    };
  }

  // --- Download Manager ---
  let downloads = JSON.parse(localStorage.getItem("downloads") || "[]");

  storage.getItem("downloads").then((savedDownloads) => {
    try {
      const parsed = JSON.parse(savedDownloads || "[]");
      if (Array.isArray(parsed) && parsed.length) {
        downloads = parsed;
        localStorage.setItem("downloads", JSON.stringify(downloads));
      }
    } catch (error) {
      console.warn("Unable to restore downloads:", error);
    }
  });

  function persistDownloads() {
    const serialized = JSON.stringify(downloads);
    localStorage.setItem("downloads", serialized);
    debouncedSetItem("downloads", serialized);
  }

  function escapeDownloadText(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function formatDownloadSize(bytes) {
    const size = Number(bytes);
    if (!Number.isFinite(size) || size <= 0) return "Size unknown";
    if (size < 1024) return `${size} B`;
    if (size < 1024 ** 2) return `${(size / 1024).toFixed(1)} KB`;
    if (size < 1024 ** 3) return `${(size / 1024 ** 2).toFixed(1)} MB`;
    return `${(size / 1024 ** 3).toFixed(1)} GB`;
  }

  function refreshDownloadsModal() {
    const list = document.querySelector("#downloads-modal #downloads-list");
    if (list) renderDownloadsList(list, downloads);
  }

  function closeDownloadsModal() {
    const modal = document.getElementById("downloads-modal");
    if (modal) {
      modal.classList.remove("active");
    }
  }

  function getDownloadStatusText(download) {
    if (download.state === "completed") return "Completed";
    if (download.state === "interrupted") return "Interrupted";
    if (download.state === "cancelled") return "Cancelled";
    return `${Math.round((download.progress || 0) * 100)}%`;
  }

  function renderDownloadsList(listElement, items) {
    if (!listElement) return;

    if (!Array.isArray(items) || items.length === 0) {
      listElement.innerHTML =
        '<div class="downloads-empty">No downloads yet.</div>';
      return;
    }

    listElement.innerHTML = items
      .map((item) => {
        const progress = Math.max(
          0,
          Math.min(100, Math.round((item.progress || 0) * 100)),
        );
        const state = ["completed", "interrupted", "cancelled"].includes(
          item.state,
        )
          ? item.state
          : "downloading";
        const name = escapeDownloadText(item.name || "Unknown file");
        const path = escapeDownloadText(item.savePath || "");
        const started = item.startTime
          ? new Date(item.startTime).toLocaleString()
          : "Unknown time";
        return `
        <article class="download-item download-${state}">
          <div class="download-file-icon" aria-hidden="true">↓</div>
          <div class="download-details">
            <div class="download-item-heading">
              <div class="download-name" title="${name}">${name}</div>
              <span class="download-status">${getDownloadStatusText(item)}</span>
            </div>
            <div class="download-meta">${formatDownloadSize(item.size)} · ${escapeDownloadText(started)}</div>
          <div class="download-progress">
            <div class="progress-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${progress}">
              <div class="progress-fill" style="width: ${progress}%"></div>
            </div>
          </div>
          ${path ? `<div class="download-path" title="${path}">${path}</div>` : ""}
          </div>
        </article>
      `;
      })
      .join("");
  }

  function ensureDownloadsModal() {
    let modal = document.getElementById("downloads-modal");
    if (modal) return modal;

    modal = document.createElement("div");
    modal.id = "downloads-modal";
    modal.className = "modal";
    modal.innerHTML = `
      <div class="downloads-content" role="dialog" aria-modal="true" aria-label="Downloads">
        <div class="downloads-header">
          <div>
            <h2>Downloads</h2>
            <p>Files saved from your browsing sessions</p>
          </div>
          <div class="downloads-header-actions">
            <button class="downloads-clear-button" type="button">Clear finished</button>
            <button class="close-button" aria-label="Close downloads">&times;</button>
          </div>
        </div>
        <div id="downloads-list" class="downloads-list"></div>
      </div>
    `;

    document.body.appendChild(modal);

    const closeBtn = modal.querySelector(".close-button");
    if (closeBtn) {
      closeBtn.addEventListener("click", closeDownloadsModal);
    }

    modal
      .querySelector(".downloads-clear-button")
      ?.addEventListener("click", () => {
        downloads = downloads.filter((item) => item.state === "downloading");
        persistDownloads();
        refreshDownloadsModal();
      });

    modal.addEventListener("click", (event) => {
      if (event.target === modal) {
        closeDownloadsModal();
      }
    });

    return modal;
  }

  // Listen for download events
  window.electronAPI.onDownloadStarted &&
    window.electronAPI.onDownloadStarted((data) => {
      downloads.push({
        name: data.name,
        url: data.url,
        size: data.size,
        progress: 0,
        state: "downloading",
        startTime: Date.now(),
      });
      persistDownloads();
      refreshDownloadsModal();
    });

  window.electronAPI.onDownloadProgress &&
    window.electronAPI.onDownloadProgress((data) => {
      const download = downloads.find((d) => d.name === data.name);
      if (download) {
        download.progress = data.progress;
        persistDownloads();
        refreshDownloadsModal();
      }
    });

  window.electronAPI.onDownloadCompleted &&
    window.electronAPI.onDownloadCompleted((data) => {
      const download = downloads.find((d) => d.name === data.name);
      if (download) {
        download.state = data.state;
        download.savePath = data.savePath;
        persistDownloads();
        refreshDownloadsModal();
      }
    });

  // Show downloads modal
  function showDownloadsModal() {
    const modal = ensureDownloadsModal();
    const list = modal.querySelector("#downloads-list");
    renderDownloadsList(list, downloads);
    modal.classList.add("active");
  }

  const showDownloadsBtn = document.getElementById("show-downloads-btn");
  if (showDownloadsBtn) {
    showDownloadsBtn.onclick = showDownloadsModal;
  }

  if (!document.downloadsEscapeListenerAdded) {
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        closeDownloadsModal();
      }
    });
    document.downloadsEscapeListenerAdded = true;
  }

  // Custom User Agent
  const userAgentInput = document.getElementById("user-agent-input");
  const setUserAgentBtn = document.getElementById("set-user-agent-btn");
  if (setUserAgentBtn && userAgentInput) {
    userAgentInput.value = localStorage.getItem("userAgent") || "";
    setUserAgentBtn.onclick = () => {
      const userAgent = userAgentInput.value.trim();
      localStorage.setItem("userAgent", userAgent);
      // Note: User agent changes require app restart in Electron
      showUpdateNotification(
        "User agent saved! Restart the browser to apply changes.",
        "success",
        3000,
      );
    };
  }

  // Session Restore
  const restoreSessionBtn = document.getElementById("restore-session-btn");
  if (restoreSessionBtn) {
    restoreSessionBtn.onclick = () => {
      const lastTabs = JSON.parse(
        localStorage.getItem("lastSessionTabs") || "[]",
      );
      if (lastTabs.length) {
        tabs = lastTabs;
        currentTabId = Math.min(
          parseInt(localStorage.getItem("lastCurrentTabId") || "0"),
          tabs.length - 1,
        );
        persistTabs();
        renderTabs();
        updateView();
        showUpdateNotification("Session restored!", "success", 3000);
      } else {
        showUpdateNotification("No previous session found.", "info", 3000);
      }
    };
  }

  // Save session on unload
  window.addEventListener("beforeunload", () => {
    localStorage.setItem("lastSessionTabs", JSON.stringify(tabs));
    localStorage.setItem("lastCurrentTabId", currentTabId.toString());
    // Flush buffered history using the central manager
    try {
      historyManager.flush();
    } catch (e) {
      /* ignore */
    }
  });

  // Enhanced Keyboard Shortcuts (prevent duplicate listeners)
  if (!document.keyboardShortcutsListenerAdded) {
    document.addEventListener("keydown", function (e) {
      // Prevent shortcuts when typing in inputs
      if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") {
        return;
      }

      if (e.ctrlKey && e.key === "t" && !e.shiftKey) {
        e.preventDefault();
        newTab();
      } else if (e.ctrlKey && e.key === "w") {
        e.preventDefault();
        if (tabs.length > 1) {
          closeTab(currentTabId);
        }
      } else if (e.ctrlKey && e.shiftKey && e.key === "T") {
        e.preventDefault();
        reopenRecentlyClosedTab();
      } else if (e.ctrlKey && e.key === "Tab") {
        e.preventDefault();
        const currentIndex = tabs.findIndex((t) => t.id === currentTabId);
        switchTab(tabs[(currentIndex + 1) % tabs.length].id);
      } else if (e.ctrlKey && e.shiftKey && e.key === "Tab") {
        e.preventDefault();
        const currentIndex = tabs.findIndex((t) => t.id === currentTabId);
        switchTab(tabs[(currentIndex - 1 + tabs.length) % tabs.length].id);
      } else if (e.ctrlKey && e.key === "r") {
        e.preventDefault();
        const tab = tabs.find((t) => t.id === currentTabId);
        if (tab && tab.url !== "newtab") {
          try {
            const activeWebview = getActiveWebview();
            if (activeWebview) activeWebview.reload();
          } catch (err) {}
        }
      } else if (e.ctrlKey && e.key === "d") {
        e.preventDefault();
        const tab = tabs.find((t) => t.id === currentTabId);
        if (
          tab.url &&
          tab.url !== "newtab" &&
          !bookmarks.some((b) => (b.url || b) === tab.url)
        ) {
          // Use the page title if available, otherwise generate a friendly name from URL
          let label = tab.title || "Untitled";
          if (label === tab.url || !tab.title) {
            try {
              // Generate a friendly name from URL (domain name)
              label = new URL(tab.url).hostname.replace(/^www\./, "");
            } catch {
              label = tab.url;
            }
          }
          bookmarks.push({ url: tab.url, label: label });
          localStorage.setItem("bookmarks", JSON.stringify(bookmarks));
          renderBookmarkBar();
        }
      } else if (e.ctrlKey && e.shiftKey && e.key === "Delete") {
        e.preventDefault();
        localStorage.clear();
        location.reload();
      } else if (e.key === "F5") {
        e.preventDefault();
        const tab = tabs.find((t) => t.id === currentTabId);
        if (tab && tab.url !== "newtab") {
          try {
            const activeWebview = getActiveWebview();
            if (activeWebview) activeWebview.reload();
          } catch (err) {}
        }
      } else if (e.key === "F12") {
        e.preventDefault();
        window.electronAPI.toggleDevTools();
      }
    });
    document.keyboardShortcutsListenerAdded = true;
  }

  // Enhanced search engine functionality
  function performSearch(query, engine) {
    const engines = {
      google: "https://www.google.com/search?q=",
      bing: "https://www.bing.com/search?q=",
      duckduckgo: "https://duckduckgo.com/?q=",
    };
    const searchUrl = engines[engine] + encodeURIComponent(query);
    navigate(searchUrl);
  }

  // Enhanced navigation function
  const originalNavigate = navigate;
  navigate = function (url) {
    if (!url) return;

    // Check if it's a search query or URL
    if (
      !/^https?:\/\//i.test(url) &&
      !url.includes(".") &&
      url.indexOf(" ") !== -1
    ) {
      // It looks like a search query
      const searchEngine = currentSearchEngine;
      performSearch(url, searchEngine);
      return;
    }

    // Use original navigate function
    originalNavigate(url);
  };

  // Page title updates come from webview event listeners now.
});

// Global widget instances
let globalNewsWidget = null;
let globalWeatherWidget = null;

// Global function to update news widget - defined early
async function updateNewsWidget() {
  await loadWidgetModules();
  if (globalNewsWidget && typeof globalNewsWidget.refresh === "function") {
    try {
      globalNewsWidget.refresh();
    } catch (error) {
      console.error("News widget refresh failed:", error);
      globalNewsWidget = null;
    }
  }

  if (!globalNewsWidget) {
    const newsWidget = document.getElementById("news-widget");
    if (newsWidget && !newsWidget.classList.contains("hidden")) {
      try {
        globalNewsWidget = new NewsWidget();
        window.globalNewsWidget = globalNewsWidget;
      } catch (error) {
        console.error("News widget recreation failed:", error);
      }
    }
  }
}

// Make function globally accessible immediately
window.updateNewsWidget = updateNewsWidget;

// Initialize widgets when page loads
document.addEventListener("DOMContentLoaded", () => {
  // Initialize window controls
  initializeWindowControls();

  // Small delay to ensure all elements are loaded
  setTimeout(() => {
    initializeWidgets().catch((error) => {
      console.error("Failed to initialize widgets:", error);
    });
  }, 1000);

  // Listen for widget settings changes from settings window
  if (
    window.electronAPI &&
    typeof window.electronAPI.onWidgetSettingsChanged === "function"
  ) {
    window.electronAPI.onWidgetSettingsChanged((data) => {
      handleWidgetSettingsChange(data);
    });
  }

  // Listen for postMessage from settings window
  window.addEventListener("message", (event) => {
    if (event.data && event.data.type === "newsSettingsChanged") {
      setTimeout(() => {
        updateNewsWidget();
      }, 500);
    }
  });
});

async function initializeWidgets() {
  await loadWidgetModules();
  console.log("Initializing widgets...");
  // Check widget visibility settings
  const showWeather =
    (await getWidgetSetting("showWeatherWidget", "true")) !== "false";
  const showNews =
    (await getWidgetSetting("showNewsWidget", "true")) !== "false";

  console.log(
    "Widget settings - showWeather:",
    showWeather,
    "showNews:",
    showNews,
  );

  const weatherWidget = document.getElementById("weather-widget");
  const newsWidget = document.getElementById("news-widget");

  console.log(
    "Widget elements - weatherWidget:",
    !!weatherWidget,
    "newsWidget:",
    !!newsWidget,
  );

  if (showWeather && weatherWidget) {
    console.log("Initializing weather widget");
    weatherWidget.classList.remove("hidden");
    globalWeatherWidget = new WeatherWidget();
  } else if (weatherWidget) {
    weatherWidget.classList.add("hidden");
  }

  if (showNews && newsWidget) {
    console.log("Initializing news widget");
    newsWidget.classList.remove("hidden");
    globalNewsWidget = new NewsWidget();
  } else if (newsWidget) {
    newsWidget.classList.add("hidden");
  }
}

async function handleWidgetSettingsChange(data) {
  await loadWidgetModules();
  const { widget, enabled } = data;

  if (widget === "weather") {
    const weatherWidget = document.getElementById("weather-widget");
    if (weatherWidget) {
      if (enabled) {
        weatherWidget.classList.remove("hidden");
        if (!weatherWidget.hasAttribute("data-initialized")) {
          new WeatherWidget();
          weatherWidget.setAttribute("data-initialized", "true");
        }
      } else {
        weatherWidget.classList.add("hidden");
      }
    }
  } else if (widget === "news") {
    const newsWidget = document.getElementById("news-widget");
    if (newsWidget) {
      if (enabled) {
        newsWidget.classList.remove("hidden");
        if (!globalNewsWidget) {
          globalNewsWidget = new NewsWidget();
        }
      } else {
        newsWidget.classList.add("hidden");
        globalNewsWidget = null;
      }
    }
  } else if (widget === "newsUpdate") {
    try {
      updateNewsWidget();
    } catch (error) {
      console.error("Error calling updateNewsWidget:", error);
    }
  }
}
