import { writable, derived } from 'svelte/store';
import type { User } from './api';

function createAuthStore() {
  const { subscribe, set, update } = writable<{
    user: User | null;
    token: string | null;
    loading: boolean;
  }>({
    user: null,
    token: null,
    loading: true,
  });

  return {
    subscribe,

    init() {
      if (typeof localStorage === 'undefined') {
        set({ user: null, token: null, loading: false });
        return;
      }
      const token = localStorage.getItem('photoapp_token');
      const userStr = localStorage.getItem('photoapp_user');
      if (token && userStr) {
        try {
          const user = JSON.parse(userStr) as User;
          set({ user, token, loading: false });
        } catch {
          localStorage.removeItem('photoapp_token');
          localStorage.removeItem('photoapp_user');
          set({ user: null, token: null, loading: false });
        }
      } else {
        set({ user: null, token: null, loading: false });
      }
    },

    login(token: string, user: User) {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('photoapp_token', token);
        localStorage.setItem('photoapp_user', JSON.stringify(user));
      }
      set({ user, token, loading: false });
    },

    logout() {
      if (typeof localStorage !== 'undefined') {
        localStorage.removeItem('photoapp_token');
        localStorage.removeItem('photoapp_user');
      }
      set({ user: null, token: null, loading: false });
    },
  };
}

export const auth = createAuthStore();

export const isAuthenticated = derived(auth, ($auth) => $auth.user !== null && $auth.token !== null);
