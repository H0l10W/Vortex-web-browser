import { icon, button, element, panel } from './ui-elements.js';
import { snapshotTabs, parseWorkspaces } from './workspace-model.js';

const TOOLBAR_ITEMS = [
  ['tab-search-btn', 'Search tabs', 'search'], ['workspace-btn', 'Workspaces', 'workspace'],
  ['set-home', 'Home', 'home'], ['bookmark-add', 'Bookmark page', 'bookmark'],
  ['incognito-btn', 'Incognito', 'incognito'], ['history-btn', 'History', 'history'],
];
const DEFAULT_PINS = ['tab-search-btn', 'workspace-btn', 'bookmark-add'];
const sourceName = tab => tab.url === 'newtab' ? 'New tab' : tab.title || tab.url;

export async function initializeBrowserUI(api) {
  const { storage } = api;
  const controls = document.getElementById('controls');
  const titlebar = document.getElementById('title-bar');
  const tabs = document.getElementById('tabs');
  const newtab = document.getElementById('newtab');
  const read = async (key, fallback) => {
    try { return JSON.parse(await storage.getItem(key)) ?? fallback; } catch { return fallback; }
  };
  let pins = await read('toolbarPins', DEFAULT_PINS);
  if (!Array.isArray(pins)) pins = DEFAULT_PINS;
  const write = async (key, value, status) => {
    if (!await storage.setItem(key, JSON.stringify(value))) {
      if (status) status.textContent = 'Could not save. Please try again.';
      return false;
    }
    return true;
  };
  const toolbarPinsVersion = await read('toolbarPinsVersion', 1);
  if (toolbarPinsVersion < 2) {
    pins = [...new Set([...pins, 'tab-search-btn', 'workspace-btn'])];
    await write('toolbarPins', pins);
    await write('toolbarPinsVersion', 2);
  }
  for (const [id, , name] of [...TOOLBAR_ITEMS, ['back', '', 'back'], ['forward', '', 'forward'], ['reload', '', 'reload']]) {
    document.getElementById(id)?.replaceChildren(icon(name));
  }
  // Window controls update their own images when maximized; CSS supplies their vectors.
  for (const [id, name] of [['minimize-btn', 'minimize'], ['maximize-btn', 'maximize'], ['close-btn', 'close']]) {
    const control = document.getElementById(id);
    control?.append(icon(name));
    control?.setAttribute('aria-label', name.charAt(0).toUpperCase() + name.slice(1));
  }
  document.getElementById('resource-control-toggle')?.replaceChildren(icon('performance'));

  function tool(id, label, glyph, parent = controls) {
    const el = button('', null, 'icon-btn browser-tool'); el.id = id;
    el.title = label; el.setAttribute('aria-label', label); el.setAttribute('aria-haspopup', 'dialog');
    el.setAttribute('aria-expanded', 'false'); el.append(icon(glyph));
    parent.append(el); return el;
  }
  const tabTools = element('div', undefined, 'tab-tools');
  const dragSpace = element('div', undefined, 'titlebar-drag-space');
  dragSpace.id = 'titlebar-drag-space'; dragSpace.setAttribute('aria-hidden', 'true');
  titlebar.insertBefore(dragSpace, document.getElementById('window-controls'));
  titlebar.insertBefore(tabTools, document.getElementById('window-controls'));
  const searchButton = tool('tab-search-btn', 'Search tabs (Ctrl+Shift+A)', 'search', tabTools);
  const workspaceButton = tool('workspace-btn', 'Saved workspaces', 'workspace', tabTools);
  const downloadsButton = tool('downloads-toolbar-btn', 'Downloads', 'download');
  const profileButton = tool('profile-toolbar-btn', 'Browser profile', 'profile');
  const profileName = element('span', 'Profile', 'profile-toolbar-name'); profileButton.append(profileName);
  const moreButton = tool('toolbar-menu-btn', 'Browser menu', 'menu');
  const more = panel('toolbar-menu', 'Browser menu');
  const pinPanel = panel('toolbar-customize', 'Customize toolbar');
  pinPanel.content.append(element('p', 'Choose which shortcuts stay beside the address bar. All actions remain available in the browser menu.', 'dialog-note'));
  const pinStatus = element('p', '', 'dialog-note'); pinStatus.setAttribute('role', 'status');
  function applyPins() {
    for (const [id] of TOOLBAR_ITEMS) document.getElementById(id)?.classList.toggle('toolbar-unpinned', !pins.includes(id));
    fitToolbar();
  }
  function fitToolbar() {
    // Optional shortcuts remain available in the menu when the window is narrow.
    const addressBarItems = TOOLBAR_ITEMS.filter(([id]) => document.getElementById(id)?.closest('#controls'));
    for (const [id] of addressBarItems) document.getElementById(id)?.classList.remove('toolbar-overflow');
    for (const [id] of addressBarItems) {
      if (document.getElementById('url-bar-shell').getBoundingClientRect().width >= 160 && controls.scrollWidth <= controls.clientWidth + 1) break;
      document.getElementById(id)?.classList.add('toolbar-overflow');
    }
  }
  new ResizeObserver(fitToolbar).observe(controls);
  for (const [id, label, glyph] of TOOLBAR_ITEMS) {
    const action = button(label, () => { more.dialog.close(); document.getElementById(id).click(); }, 'menu-action');
    action.prepend(icon(glyph)); more.content.append(action);
    const row = element('label', undefined, 'preference-row');
    const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.checked = pins.includes(id);
    checkbox.dataset.toolbarItem = id;
    checkbox.addEventListener('change', async () => {
      pins = checkbox.checked ? [...new Set([...pins, id])] : pins.filter(pin => pin !== id);
      applyPins(); await write('toolbarPins', pins, pinStatus);
    });
    row.append(element('span', label), checkbox); pinPanel.content.append(row);
  }
  pinPanel.content.append(pinStatus);
  const quick = element('section', undefined, 'menu-quick-settings');
  const quickHeading = element('h3', 'Quick settings'); quickHeading.id = 'menu-quick-settings-title';
  quick.setAttribute('aria-labelledby', quickHeading.id); quick.append(quickHeading);
  // Move the original inputs so existing persistence and Electron handlers remain attached.
  for (const [id, label] of [
    ['page-zoom-select', 'Page zoom'], ['show-bookmarks-bar', 'Bookmarks bar'],
    ['force-web-dark-toggle', 'Dark web content'], ['adblock-toggle', 'Block ads'],
    ['adblock-strict-toggle', 'Strict ad blocking'], ['quick-tracker-blocking-toggle', 'Block trackers'],
  ]) {
    const input = document.getElementById(id);
    const row = element('label', undefined, 'preference-row'); row.htmlFor = id;
    input.className = input.type === 'checkbox' ? 'menu-switch' : '';
    row.append(element('span', label), input); quick.append(row);
  }
  more.content.prepend(quick);
  function menuAction(label, glyph, action) {
    const item = button(label, () => { more.dialog.close(); action(); }, 'menu-action');
    item.prepend(icon(glyph)); more.content.append(item);
  }
  menuAction('Manage bookmarks', 'bookmark', () => document.getElementById('manage-bookmark-folders-btn').click());
  menuAction('Downloads', 'download', () => downloadsButton.click());
  const footer = element('div', undefined, 'menu-footer');
  for (const [label, glyph, action] of [
    ['All settings', 'settings', () => api.openSettings()],
    ['Customize toolbar', 'widgets', () => pinPanel.open(moreButton)],
    ['Clear browsing data', 'privacy', () => api.openSettings('privacy')],
    ['Check for updates', 'reload', () => document.getElementById('check-updates').click()],
  ]) {
    menuAction(label, glyph, action); footer.append(more.content.lastElementChild);
  }
  more.content.append(footer);
  moreButton.addEventListener('click', () => {
    api.prepareQuickSettings();
    const top = Math.min(controls.getBoundingClientRect().bottom + 8, innerHeight - 160);
    more.dialog.style.top = `${Math.max(8, top)}px`;
    more.dialog.style.maxHeight = `${innerHeight - Math.max(8, top) - 12}px`;
    more.open(moreButton);
  }); applyPins();

  const search = panel('tab-search', 'Find an open tab');
  const searchInput = document.createElement('input'); searchInput.type = 'search'; searchInput.placeholder = 'Search by title, address, or group'; searchInput.setAttribute('aria-label', 'Search open tabs');
  const searchResults = element('div', undefined, 'tab-search-results');
  const count = element('p', '', 'dialog-note'); count.setAttribute('role', 'status');
  search.content.append(searchInput, count, searchResults);
  const sidebarHeader = element('div', undefined, 'vertical-sidebar-header');
  const collapseButton = button('', null, 'quiet-button'); collapseButton.id = 'collapse-tabs-btn';
  collapseButton.setAttribute('aria-controls', 'tabs');
  sidebarHeader.append(element('strong', 'Tabs'), collapseButton); document.body.append(sidebarHeader);
  let sidebarCollapsed = await read('verticalTabsCollapsed', false) === true;
  function applySidebarCollapse() {
    document.body.dataset.tabsCollapsed = String(sidebarCollapsed);
    collapseButton.replaceChildren(icon(sidebarCollapsed ? 'forward' : 'back'));
    collapseButton.title = sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar';
    collapseButton.setAttribute('aria-label', collapseButton.title);
    collapseButton.setAttribute('aria-expanded', String(!sidebarCollapsed));
  }
  applySidebarCollapse();
  collapseButton.addEventListener('click', async () => {
    sidebarCollapsed = !sidebarCollapsed; applySidebarCollapse();
    await write('verticalTabsCollapsed', sidebarCollapsed, count);
  });
  function setVertical(enabled) {
    document.body.dataset.tabLayout = enabled ? 'vertical' : 'horizontal';
    tabs.setAttribute('aria-orientation', enabled ? 'vertical' : 'horizontal');
    tabs.querySelector('.tab.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
  let verticalTabsEnabled = await read('verticalTabs', false) === true; setVertical(verticalTabsEnabled);
  const renderSearch = () => {
    const state = api.getState(); const query = searchInput.value.trim().toLocaleLowerCase();
    const found = state.tabs.filter(tab => `${sourceName(tab)} ${tab.url} ${state.groups[tab.groupId]?.name || ''}`.toLocaleLowerCase().includes(query));
    searchResults.replaceChildren(); count.textContent = `${found.length} ${found.length === 1 ? 'tab' : 'tabs'}`;
    for (const tab of found) {
      const row = button('', () => { search.dialog.close(); api.switchTab(tab.id); }, 'tab-search-result');
      row.dataset.tabId = tab.id;
      row.append(element('strong', sourceName(tab)), element('small', `${tab.isIncognito ? 'Incognito · ' : ''}${state.groups[tab.groupId]?.name ? `${state.groups[tab.groupId].name} · ` : ''}${tab.id === state.currentTabId ? 'Current tab · ' : ''}${tab.url}`));
      if (state.groups[tab.groupId]) row.style.setProperty('--result-group', state.groups[tab.groupId].color);
      searchResults.append(row);
    }
    if (!found.length) searchResults.append(element('p', 'No matching tabs. Try a different title or address.', 'dialog-empty'));
  };
  const openSearch = () => { searchInput.value = ''; renderSearch(); search.open(searchButton); searchInput.focus(); };
  searchButton.addEventListener('click', openSearch);
  searchInput.addEventListener('input', renderSearch);
  search.dialog.addEventListener('keydown', e => {
    const results = [...searchResults.querySelectorAll('button')];
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const index = results.indexOf(document.activeElement);
      const next = e.key === 'ArrowDown' ? (index + 1) % results.length : (index <= 0 ? results.length - 1 : index - 1);
      results[next]?.focus();
    } else if (e.key === 'Enter' && e.target === searchInput) { e.preventDefault(); results[0]?.click(); }
  });
  document.addEventListener('keydown', e => {
    if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'a') { e.preventDefault(); openSearch(); }
  });
  window.electronAPI?.on?.('open-tab-search', openSearch);
  tabs.addEventListener('wheel', e => {
    if (!verticalTabsEnabled && tabs.scrollWidth > tabs.clientWidth && Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
      e.preventDefault(); tabs.scrollLeft += e.deltaY;
    }
  }, { passive: false });

  const profilePanel = panel('profile-switcher', 'Browser profiles');
  async function refreshProfiles() {
    try {
      const result = await window.electronAPI.listProfiles();
      const active = result.profiles.find(p => p.id === result.activeProfileId);
      profileName.textContent = active?.name || 'Default';
      profileButton.title = `Active profile: ${active?.name || 'Default'}`; profileButton.setAttribute('aria-label', profileButton.title);
      profilePanel.content.replaceChildren(element('p', 'Each profile keeps its own history, bookmarks, settings, and workspaces. Switching restarts Vortex.', 'dialog-note'));
      for (const profile of result.profiles) {
        const row = element('div', undefined, 'preference-row');
        const activeProfile = profile.id === result.activeProfileId;
        const action = button(activeProfile ? 'Active' : 'Switch and restart', async () => {
          action.disabled = true;
          try { await api.flushSession(); if (!await window.electronAPI.switchProfile(profile.id)) throw new Error('Switch failed'); }
          catch { action.disabled = false; message.textContent = 'Could not switch profiles. Please try again.'; }
        });
        action.disabled = activeProfile; row.append(element('strong', profile.name), action); profilePanel.content.append(row);
      }
      const message = element('p', '', 'dialog-note'); message.setAttribute('role', 'status'); profilePanel.content.append(message);
      profilePanel.content.append(button('Manage profiles in Settings', () => { profilePanel.dialog.close(); api.openSettings(); }, 'menu-action'));
    } catch { profilePanel.content.replaceChildren(element('p', 'Could not load profiles. Reopen this panel to retry.', 'dialog-note')); }
  }
  profileButton.addEventListener('click', () => { refreshProfiles(); profilePanel.open(profileButton); });
  await refreshProfiles();

  const workspacePanel = panel('workspace-manager', 'Saved workspaces');
  let workspaces = parseWorkspaces(await storage.getItem('savedWorkspaces'));
  const workspaceNote = element('p', 'Save up to 200 website tabs in a named set in this profile. Opening a workspace adds its tabs to this window. Incognito and internal pages are never saved.', 'dialog-note');
  const workspaceForm = document.createElement('form'); workspaceForm.className = 'inline-form';
  const workspaceName = document.createElement('input'); workspaceName.placeholder = 'Workspace name, e.g. Research'; workspaceName.maxLength = 60; workspaceName.required = true; workspaceName.setAttribute('aria-label', 'Workspace name');
  const saveWorkspace = button('Save current tabs'); saveWorkspace.type = 'submit';
  workspaceForm.append(workspaceName, saveWorkspace);
  const workspaceStatus = element('p', '', 'dialog-note'); workspaceStatus.setAttribute('role', 'status');
  const workspaceList = element('div', undefined, 'workspace-list');
  workspacePanel.content.append(workspaceNote, workspaceForm, workspaceStatus, workspaceList);
  if (api.incognito) { workspaceForm.hidden = true; workspaceNote.textContent = 'Workspaces are unavailable in incognito. Open a normal window to save or open a workspace.'; }
  async function persistWorkspaces() { return write('savedWorkspaces', workspaces, workspaceStatus); }
  function renderWorkspaces() {
    workspaceList.replaceChildren(); if (api.incognito) return;
    for (const workspace of workspaces) {
      const row = element('article', undefined, 'workspace-row'); row.dataset.workspaceId = workspace.id;
      const name = document.createElement('input'); name.value = workspace.name; name.maxLength = 60; name.setAttribute('aria-label', `Rename ${workspace.name}`);
      name.addEventListener('change', async () => {
        const next = name.value.trim();
        if (!next || workspaces.some(w => w.id !== workspace.id && w.name.toLocaleLowerCase() === next.toLocaleLowerCase())) {
          name.value = workspace.name; workspaceStatus.textContent = 'Use a unique, non-empty workspace name.'; return;
        }
        workspace.name = next; await persistWorkspaces();
      });
      const actions = element('div', undefined, 'row-actions');
      actions.append(button('Open tabs', () => { api.openWorkspace(workspace.tabs); workspacePanel.dialog.close(); }), button('Update', async () => {
        const state = api.getState(); const snapshot = snapshotTabs(state.tabs, state.groups);
        if (!snapshot.length) { workspaceStatus.textContent = 'Open a website before updating this workspace.'; return; }
        workspace.tabs = snapshot; if (await persistWorkspaces()) { workspaceStatus.textContent = `Updated ${workspace.name}.`; renderWorkspaces(); }
      }), button('Delete', async () => {
        const removed = workspace; const index = workspaces.indexOf(workspace);
        workspaces = workspaces.filter(w => w.id !== workspace.id);
        if (await persistWorkspaces()) {
          renderWorkspaces(); workspaceStatus.replaceChildren(document.createTextNode(`Deleted ${removed.name}. `), button('Undo', async () => {
            workspaces.splice(index, 0, removed); if (await persistWorkspaces()) { workspaceStatus.textContent = 'Workspace restored.'; renderWorkspaces(); }
          }));
        }
      }, 'quiet-button'));
      row.append(name, element('small', `${workspace.tabs.length} saved tabs`), actions); workspaceList.append(row);
    }
    if (!workspaces.length) workspaceList.append(element('p', 'No saved workspaces yet. Open some websites, then save your first set above.', 'dialog-empty'));
  }
  workspaceForm.addEventListener('submit', async e => {
    e.preventDefault(); if (api.incognito) return;
    const name = workspaceName.value.trim();
    if (!name || workspaces.some(w => w.name.toLocaleLowerCase() === name.toLocaleLowerCase())) { workspaceStatus.textContent = 'Choose a unique workspace name, or use Update on an existing workspace.'; return; }
    const state = api.getState(); const snapshot = snapshotTabs(state.tabs, state.groups);
    if (!snapshot.length) { workspaceStatus.textContent = 'Open a website first. Incognito and internal pages are not saved.'; return; }
    if (workspaces.length >= 50) { workspaceStatus.textContent = 'You have 50 workspaces. Delete one before saving another.'; return; }
    workspaces.push({ id: crypto.randomUUID(), name, tabs: snapshot });
    if (await persistWorkspaces()) { workspaceName.value = ''; workspaceStatus.textContent = `Saved ${name}.`; renderWorkspaces(); }
  });
  workspaceButton.addEventListener('click', async () => {
    workspaces = parseWorkspaces(await storage.getItem('savedWorkspaces')); renderWorkspaces(); workspacePanel.open(workspaceButton);
  });

  const downloadsPanel = panel('downloads-panel', 'Recent downloads');
  const downloadList = element('div', undefined, 'compact-download-list');
  downloadsPanel.content.append(downloadList, button('View all downloads', () => { downloadsPanel.dialog.close(); api.showDownloads(); }, 'menu-action'));
  function renderDownloads() {
    const items = api.getDownloads(); const active = items.filter(item => item.state === 'downloading');
    downloadsButton.classList.toggle('has-downloads', active.length > 0);
    const percentage = active.length ? Math.round(active.reduce((sum, item) => sum + (item.progress || 0), 0) / active.length * 100) : 0;
    downloadsButton.style.setProperty('--download-progress', `${percentage}%`);
    downloadsButton.title = active.length ? `Downloads: ${active.length} active · ${percentage}%` : 'Downloads';
    downloadsButton.setAttribute('aria-label', downloadsButton.title);
    if (!downloadsPanel.dialog.open) return;
    const recent = items.slice().reverse().slice(0, 5);
    const signature = JSON.stringify(recent.map(item => [item.id, item.state, item.name, item.savePath]));
    if (downloadList.dataset.signature === signature) {
      recent.forEach((item, index) => {
        const row = downloadList.children[index];
        if (!row || item.state !== 'downloading') return;
        row.querySelector('small').textContent = `${Math.round((item.progress || 0) * 100)}% downloaded · ${api.formatSize(item.size)}`;
        const progress = row.querySelector('progress'); if (progress) progress.value = item.progress || 0;
      });
      return;
    }
    const focusedId = document.activeElement?.dataset.downloadId;
    downloadList.dataset.signature = signature;
    downloadList.replaceChildren();
    for (const item of recent) {
      const row = element('article', undefined, 'compact-download');
      row.append(element('strong', item.name), element('small', `${item.state === 'downloading' ? `${Math.round((item.progress || 0) * 100)}% downloaded` : item.state} · ${api.formatSize(item.size)}`));
      if (item.state === 'downloading') {
        const progress = document.createElement('progress'); progress.max = 1; progress.value = item.progress || 0; progress.setAttribute('aria-label', item.name); row.append(progress);
      }
      if (item.state === 'completed' && item.savePath) {
        const status = element('small', ''); status.setAttribute('role', 'status');
        const reveal = button('Show in folder', async () => {
          try { if (!await window.electronAPI.revealDownload(item.id)) status.textContent = 'File is no longer available.'; }
          catch { status.textContent = 'Could not open the folder.'; }
        });
        reveal.dataset.downloadId = item.id;
        row.append(reveal, status);
      }
      downloadList.append(row);
    }
    if (!items.length) downloadList.append(element('p', 'Your downloads will appear here.', 'dialog-empty'));
    if (focusedId) [...downloadList.querySelectorAll('button')].find(el => el.dataset.downloadId === focusedId)?.focus();
  }
  downloadsButton.addEventListener('click', () => { downloadsPanel.open(downloadsButton); renderDownloads(); });
  document.addEventListener('vortex-downloads-changed', renderDownloads); renderDownloads();

  const customize = panel('newtab-customize', 'Customize new tab');
  const customizeButton = button('Customize', () => { renderLinkOrder(); customize.open(customizeButton); }, 'newtab-customize-button'); customizeButton.id = 'newtab-customize-btn'; customizeButton.prepend(icon('appearance')); newtab.append(customizeButton);
  let layout = await read('newtabLayout', { mode: 'information', position: 'above', order: 'weather' });
  if (!layout || typeof layout !== 'object') layout = { mode: 'information', position: 'above', order: 'weather' };
  const layoutStatus = element('p', 'Changes apply immediately.', 'dialog-note'); layoutStatus.setAttribute('role', 'status');
  function applyLayout() {
    newtab.dataset.layout = layout.mode === 'minimal' ? 'minimal' : 'information';
    newtab.dataset.widgetPosition = layout.position === 'below' ? 'below' : 'above';
    document.getElementById('weather-widget').style.order = layout.order === 'news' ? '2' : '0';
  }
  function selectPreference(label, key, choices) {
    const row = element('label', undefined, 'preference-row'); const select = document.createElement('select');
    select.dataset.layoutKey = key;
    for (const [value, text] of choices) select.add(new Option(text, value)); select.value = layout[key] || choices[0][0];
    select.addEventListener('change', async () => { layout[key] = select.value; applyLayout(); await write('newtabLayout', layout, layoutStatus); });
    row.append(element('span', label), select); customize.content.append(row);
  }
  selectPreference('Layout', 'mode', [['information', 'Information rich'], ['minimal', 'Minimal']]);
  selectPreference('Widgets', 'position', [['above', 'Above quick links'], ['below', 'Below quick links']]);
  selectPreference('First widget', 'order', [['weather', 'Weather'], ['news', 'News']]);
  customize.content.append(button('Choose visible widgets in Settings', () => { customize.dialog.close(); api.openSettings('widgets'); }, 'menu-action'));
  customize.content.append(layoutStatus, element('h3', 'Quick link order'));
  const linkOrder = element('div', undefined, 'quick-link-order'); customize.content.append(linkOrder);
  function renderLinkOrder() {
    linkOrder.replaceChildren(); const links = api.getQuickLinks();
    links.forEach((link, index) => {
      const row = element('div', undefined, 'preference-row'); const actions = element('div', undefined, 'row-actions');
      for (const [label, delta] of [['Move up', -1], ['Move down', 1]]) {
        const move = button(label, async () => { await api.moveQuickLink(index, delta); renderLinkOrder(); linkOrder.children[index + delta]?.querySelector('button:not(:disabled)')?.focus(); });
        move.disabled = index + delta < 0 || index + delta >= links.length; move.setAttribute('aria-label', `${label}: ${link.label || link.url}`); actions.append(move);
      }
      row.append(element('span', link.label || link.url), actions); linkOrder.append(row);
    });
    if (!links.length) linkOrder.append(element('p', 'Add a quick link on the new-tab page to arrange it here.', 'dialog-note'));
  }
  applyLayout();
  window.electronAPI?.onStorageItemChanged?.(({ key, value }) => {
    if (key === 'toolbarPins') { try { const saved = JSON.parse(value); if (Array.isArray(saved)) { pins = saved; applyPins(); pinPanel.content.querySelectorAll('input').forEach(input => { input.checked = pins.includes(input.dataset.toolbarItem); }); } } catch {} }
    if (key === 'verticalTabs') { verticalTabsEnabled = value === 'true'; setVertical(verticalTabsEnabled); }
    if (key === 'newtabLayout') { try { const saved = JSON.parse(value); if (saved && typeof saved === 'object') { layout = saved; applyLayout(); customize.content.querySelectorAll('select').forEach(select => { select.value = layout[select.dataset.layoutKey]; }); } } catch {} }
  });
  document.documentElement.dataset.browserUiReady = 'true';
}
