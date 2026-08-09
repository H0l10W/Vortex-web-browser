export async function getWidgetSetting(key, fallback = null) {
  try {
    const persisted = await window.storage.getItem(key);
    if (persisted !== null && persisted !== undefined) return persisted;
  } catch (error) {
    console.error(`Failed to read widget setting ${key}`, error);
  }

  try {
    const legacy = localStorage.getItem(key);
    return legacy !== null ? legacy : fallback;
  } catch (_error) {
    return fallback;
  }
}
