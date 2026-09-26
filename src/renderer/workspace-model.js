// Workspaces are explicit snapshots of public page URLs within the active profile.
export function snapshotTabs(tabs, groups = {}) {
  return tabs.filter(tab => !tab.isIncognito && /^https?:\/\//i.test(tab.url || '')).slice(0, 200).map(tab => ({
    url: tab.url,
    title: String(tab.title || '').slice(0, 200),
    ...(tab.groupId && groups[tab.groupId] ? { group: {
      key: String(tab.groupId), name: String(groups[tab.groupId].name || 'Group').slice(0, 60),
      color: /^#[0-9a-f]{6}$/i.test(groups[tab.groupId].color) ? groups[tab.groupId].color : '#3b82f6',
    } } : {}),
  }));
}
export function parseWorkspaces(raw) {
  try {
    const list = JSON.parse(raw || '[]');
    if (!Array.isArray(list)) return [];
    return list.filter(w => w && typeof w.id === 'string' && typeof w.name === 'string' && Array.isArray(w.tabs)).slice(0, 50).map(w => ({
      id: w.id, name: w.name.slice(0, 60),
      tabs: w.tabs.filter(t => t && !t.isIncognito && typeof t.url === 'string' && /^https?:\/\//i.test(t.url)).slice(0, 200).map(t => ({
        url: t.url, title: String(t.title || '').slice(0, 200),
        ...(t.group && typeof t.group.key === 'string' ? { group: {
          key: t.group.key, name: String(t.group.name || 'Group').slice(0, 60),
          color: /^#[0-9a-f]{6}$/i.test(t.group.color) ? t.group.color : '#3b82f6',
        } } : {}),
      })),
    }));
  } catch { return []; }
}
