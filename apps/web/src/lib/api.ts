const API_BASE = '/api';

function getAuthHeaders(): Record<string, string> {
  const token = typeof localStorage !== 'undefined' ? localStorage.getItem('photoapp_token') : null;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: { ...getAuthHeaders(), ...(options.headers || {}) },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: response.statusText }));
    throw new Error(error.message || `Request failed: ${response.status}`);
  }

  if (response.status === 204) return undefined as T;
  return response.json();
}

export interface User {
  id: string;
  email: string;
  name: string;
  isAdmin: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Asset {
  id: string;
  ownerId: string;
  originalPath: string;
  thumbnailSmallPath: string | null;
  thumbnailLargePath: string | null;
  fileName: string;
  fileSizeBytes: string;
  mimeType: string;
  checksum: string;
  type: 'IMAGE' | 'VIDEO' | 'OTHER';
  fileCreatedAt: string;
  deletedAt: string | null;
  isFavorite: boolean;
  isArchived: boolean;
  isDeleted: boolean;
  locationLat: number | null;
  locationLng: number | null;
  locationCity: string | null;
  locationCountry: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PaginatedAssets {
  assets: Asset[];
  total: number;
  page: number;
  limit: number;
}

export interface Album {
  id: string;
  ownerId: string;
  name: string;
  description: string | null;
  coverAssetId: string | null;
  createdAt: string;
  updatedAt: string;
  _count?: { assets: number };
  assets?: { asset: Asset; addedAt: string }[];
}

export interface ShareLink {
  id: string;
  token: string;
  ownerId: string;
  albumId: string | null;
  assetId: string | null;
  expiresAt: string | null;
  viewCount: number;
  createdAt: string;
  album?: { id: string; name: string } | null;
  asset?: { id: string; fileName: string } | null;
}

export interface SearchResult {
  mode: 'text' | 'semantic';
  assets: Asset[];
  total: number;
  page: number;
  limit: number;
}

export interface AuthResponse {
  accessToken: string;
  user: User;
}

export const api = {
  auth: {
    async register(email: string, password: string, name: string): Promise<AuthResponse> {
      return request<AuthResponse>('/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, name }),
      });
    },
    async login(email: string, password: string): Promise<AuthResponse> {
      return request<AuthResponse>('/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
    },
    async me(): Promise<User> {
      return request<User>('/auth/me');
    },
  },

  assets: {
    async list(page = 1, limit = 50): Promise<PaginatedAssets> {
      return request<PaginatedAssets>(`/assets?page=${page}&limit=${limit}`);
    },
    async get(id: string): Promise<Asset> {
      return request<Asset>(`/assets/${id}`);
    },
    async listFavorites(page = 1, limit = 50): Promise<PaginatedAssets> {
      return request<PaginatedAssets>(`/assets/favorites?page=${page}&limit=${limit}`);
    },
    async listArchived(page = 1, limit = 50): Promise<PaginatedAssets> {
      return request<PaginatedAssets>(`/assets/archived?page=${page}&limit=${limit}`);
    },
    async listTrashed(page = 1, limit = 50): Promise<PaginatedAssets> {
      return request<PaginatedAssets>(`/assets/trashed?page=${page}&limit=${limit}`);
    },
    async toggleFavorite(id: string): Promise<Asset> {
      return request<Asset>(`/assets/${id}/favorite`, { method: 'PATCH' });
    },
    async toggleArchive(id: string): Promise<Asset> {
      return request<Asset>(`/assets/${id}/archive`, { method: 'PATCH' });
    },
    async softDelete(id: string): Promise<void> {
      return request<void>(`/assets/${id}`, { method: 'DELETE' });
    },
    async restore(id: string): Promise<Asset> {
      return request<Asset>(`/assets/${id}/restore`, { method: 'POST' });
    },
    async permanentDelete(id: string): Promise<void> {
      return request<void>(`/assets/${id}/permanent`, { method: 'DELETE' });
    },
    async listMap(): Promise<Asset[]> {
      return request<Asset[]>('/assets/map');
    },
    async explore(): Promise<{ months: any[]; locations: any[]; tags: any[]; total: number }> {
      return request('/assets/explore');
    },
    thumbnailUrl(id: string): string {
      const token = typeof localStorage !== 'undefined' ? localStorage.getItem('photoapp_token') : null;
      const qs = token ? `?token=${encodeURIComponent(token)}` : '';
      return `${API_BASE}/assets/${id}/thumbnail${qs}`;
    },
    async upload(file: File, fileCreatedAt?: string): Promise<Asset> {
      const formData = new FormData();
      formData.append('file', file);
      if (fileCreatedAt) formData.append('fileCreatedAt', fileCreatedAt);
      const token = typeof localStorage !== 'undefined' ? localStorage.getItem('photoapp_token') : null;
      const response = await fetch(`${API_BASE}/assets/upload`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: formData,
      });
      if (!response.ok) {
        const error = await response.json().catch(() => ({ message: response.statusText }));
        throw new Error(error.message || `Upload failed: ${response.status}`);
      }
      return response.json();
    },
  },

  albums: {
    async list(): Promise<Album[]> {
      return request<Album[]>('/albums');
    },
    async get(id: string): Promise<Album> {
      return request<Album>(`/albums/${id}`);
    },
    async create(name: string, description?: string): Promise<Album> {
      return request<Album>('/albums', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, description }),
      });
    },
    async update(id: string, data: { name?: string; description?: string; coverAssetId?: string }): Promise<Album> {
      return request<Album>(`/albums/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
    },
    async remove(id: string): Promise<void> {
      return request<void>(`/albums/${id}`, { method: 'DELETE' });
    },
    async addAssets(id: string, assetIds: string[]): Promise<Album> {
      return request<Album>(`/albums/${id}/assets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assetIds }),
      });
    },
    async removeAssets(id: string, assetIds: string[]): Promise<Album> {
      return request<Album>(`/albums/${id}/assets`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assetIds }),
      });
    },
  },

  sharing: {
    async list(): Promise<ShareLink[]> {
      return request<ShareLink[]>('/sharing');
    },
    async create(data: { albumId?: string; assetId?: string; password?: string; expiresAt?: string }): Promise<ShareLink> {
      return request<ShareLink>('/sharing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
    },
    async remove(id: string): Promise<void> {
      return request<void>(`/sharing/${id}`, { method: 'DELETE' });
    },
    async resolvePublic(token: string, password?: string): Promise<any> {
      const qs = password ? `?password=${encodeURIComponent(password)}` : '';
      return fetch(`${API_BASE}/s/${token}${qs}`).then((r) => {
        if (!r.ok) return r.json().then((e) => Promise.reject(new Error(e.message)));
        return r.json();
      });
    },
    shareUrl(token: string): string {
      return `${window.location.origin}/s/${token}`;
    },
  },

  search: {
    async search(query: string, mode: 'text' | 'semantic' | 'auto' = 'auto', page = 1, limit = 30): Promise<SearchResult> {
      const qs = new URLSearchParams({ q: query, mode, page: String(page), limit: String(limit) });
      return request<SearchResult>(`/search?${qs}`);
    },
  },
};
