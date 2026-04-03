import { writable } from 'svelte/store';
import { api, DEFAULT_PREFERENCES } from './api';
import type { UserPreferences } from './api';

const STORAGE_KEY = 'snapnest_preferences';

function loadFromStorage(): UserPreferences {
  if (typeof localStorage === 'undefined') return { ...DEFAULT_PREFERENCES };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_PREFERENCES };
    const stored = JSON.parse(raw) as Partial<UserPreferences>;
    return {
      assetViewer: { ...DEFAULT_PREFERENCES.assetViewer, ...(stored.assetViewer ?? {}) },
      videos: { ...DEFAULT_PREFERENCES.videos, ...(stored.videos ?? {}) },
      theme: { ...DEFAULT_PREFERENCES.theme, ...(stored.theme ?? {}) },
      photoGrid: { ...DEFAULT_PREFERENCES.photoGrid, ...(stored.photoGrid ?? {}) },
    };
  } catch {
    return { ...DEFAULT_PREFERENCES };
  }
}

function saveToStorage(prefs: UserPreferences) {
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  }
}

function createSettingsStore() {
  const { subscribe, set, update } = writable<UserPreferences>(loadFromStorage());

  return {
    subscribe,

    async init() {
      // Load from localStorage immediately for fast startup
      const local = loadFromStorage();
      set(local);
      // Sync from backend
      try {
        const remote = await api.users.getPreferences();
        set(remote);
        saveToStorage(remote);
      } catch {
        // Network error — continue with local settings
      }
    },

    async updateSection<K extends keyof UserPreferences>(
      section: K,
      patch: Partial<UserPreferences[K]>,
    ) {
      update((current) => {
        const next = {
          ...current,
          [section]: { ...(current[section] as object), ...(patch as object) },
        } as UserPreferences;
        saveToStorage(next);
        // Fire-and-forget sync to backend
        api.users.updatePreferences({ [section]: next[section] } as Partial<UserPreferences>).catch(() => {});
        return next;
      });
    },
  };
}

export const settings = createSettingsStore();
