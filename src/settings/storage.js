export function createSettingsStorage(electronAPI = window.electronAPI) {
  const hasElectronStorage =
    typeof electronAPI?.getStorageItem === "function";

  return {
    async getItem(key) {
      try {
        if (hasElectronStorage) {
          const value = await electronAPI.getStorageItem(key);
          if (value !== null && value !== undefined) return value;
        }
      } catch (error) {
        console.error("Error getting storage item:", key, error);
      }
      try {
        return localStorage.getItem(key);
      } catch (_error) {
        return null;
      }
    },

    async setItem(key, value) {
      let saved = false;
      try {
        if (hasElectronStorage && typeof electronAPI.setStorageItem === "function") {
          saved = !!(await electronAPI.setStorageItem(key, value));
        }
      } catch (error) {
        console.error("Error setting storage item:", key, error);
      }
      try {
        localStorage.setItem(key, value);
        return true;
      } catch (_error) {
        return saved;
      }
    },

    async removeItem(key) {
      let removed = false;
      try {
        if (hasElectronStorage && typeof electronAPI.removeStorageItem === "function") {
          removed = !!(await electronAPI.removeStorageItem(key));
        }
      } catch (error) {
        console.error("Error removing storage item:", key, error);
      }
      try {
        localStorage.removeItem(key);
        return true;
      } catch (_error) {
        return removed;
      }
    },
  };
}
