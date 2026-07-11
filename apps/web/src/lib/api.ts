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

  if (response.status === 401 && !path.startsWith('/auth/')) {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem('photoapp_token');
      localStorage.removeItem('photoapp_user');
    }
    if (typeof window !== 'undefined') window.location.href = '/';
    throw new Error('Session expired — please log in again');
  }

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
  editedPath: string | null;
  editParams: Record<string, unknown> | null;
  isLivePhoto: boolean;
  livePhotoVideoPath: string | null;
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

export interface Person {
  id: string;
  name: string;
  faceCount: number;
  coverFaceId: string | null;
  coverAssetId: string | null;
  createdAt: string;
}

export interface SmartAlbumGroup {
  people: SmartAlbumItem[];
  locations: SmartAlbumItem[];
  months: SmartAlbumItem[];
  tags: SmartAlbumItem[];
  videos: Asset[];
  livePhotos: Asset[];
}

export interface SmartAlbumItem {
  id: string;
  name: string;
  type: string;
  assetCount: number;
  coverAssetId: string | null;
  criteria: Record<string, string>;
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
    async list(page = 1, limit = 50, isLivePhoto?: boolean): Promise<PaginatedAssets> {
      const qs = new URLSearchParams({ page: String(page), limit: String(limit) });
      if (isLivePhoto) qs.set('isLivePhoto', 'true');
      return request<PaginatedAssets>(`/assets?${qs}`);
    },
    async get(id: string): Promise<Asset> {
      return request<Asset>(`/assets/${id}`);
    },
    async listVideos(page = 1, limit = 50, month = ''): Promise<PaginatedAssets> {
      const qs = new URLSearchParams({ page: String(page), limit: String(limit) });
      if (month) qs.set('month', month);
      return request<PaginatedAssets>(`/assets/videos?${qs}`);
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
    async syncStatus(): Promise<SyncStatus> {
      return request<SyncStatus>('/assets/sync-status');
    },
    thumbnailUrl(id: string, updatedAt?: string): string {
      const token = typeof localStorage !== 'undefined' ? localStorage.getItem('photoapp_token') : null;
      let qs = token ? `?token=${encodeURIComponent(token)}` : '';
      if (updatedAt) {
        const v = new Date(updatedAt).getTime();
        qs += qs ? `&_v=${v}` : `?_v=${v}`;
      }
      return `${API_BASE}/assets/${id}/thumbnail${qs}`;
    },
    downloadUrl(id: string): string {
      const token = typeof localStorage !== 'undefined' ? localStorage.getItem('photoapp_token') : null;
      const qs = token ? `?token=${encodeURIComponent(token)}` : '';
      return `${API_BASE}/assets/${id}/download${qs}`;
    },
    editedUrl(id: string): string {
      const token = typeof localStorage !== 'undefined' ? localStorage.getItem('photoapp_token') : null;
      const qs = token ? `?token=${encodeURIComponent(token)}` : '';
      return `${API_BASE}/assets/${id}/edited${qs}`;
    },
    liveVideoUrl(id: string): string {
      const token = typeof localStorage !== 'undefined' ? localStorage.getItem('photoapp_token') : null;
      const qs = token ? `?token=${encodeURIComponent(token)}` : '';
      return `${API_BASE}/assets/${id}/live-video${qs}`;
    },
    async editPreview(id: string, params: Record<string, unknown>): Promise<string> {
      const token = typeof localStorage !== 'undefined' ? localStorage.getItem('photoapp_token') : null;
      const response = await fetch(`${API_BASE}/assets/${id}/edit/preview`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(params),
      });
      if (!response.ok) {
        const err = await response.json().catch(() => ({ message: response.statusText }));
        throw new Error(err.message || 'Edit preview failed');
      }
      const blob = await response.blob();
      return URL.createObjectURL(blob);
    },
    async editSave(id: string, params: Record<string, unknown>): Promise<Asset> {
      return request<Asset>(`/assets/${id}/edit/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      });
    },
    async revertEdit(id: string): Promise<Asset> {
      return request<Asset>(`/assets/${id}/edit`, { method: 'DELETE' });
    },
    async batchEdit(assetIds: string[], edits: Record<string, unknown>): Promise<{ processed: number }> {
      return request<{ processed: number }>('/assets/batch-edit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assetIds, edits }),
      });
    },
    async removeRedEye(id: string): Promise<{ url: string }> {
      return request<{ url: string }>(`/assets/${id}/red-eye`, { method: 'POST' });
    },
    async applyMarkup(id: string, annotations: unknown[]): Promise<{ url: string }> {
      return request<{ url: string }>(`/assets/${id}/markup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ annotations }),
      });
    },
    async applyDepthBlur(id: string, opts?: { blurStrength?: number; focusPoint?: { x: number; y: number } }): Promise<{ url: string }> {
      return request<{ url: string }>(`/assets/${id}/depth-blur`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(opts || {}),
      });
    },
    async applyLiveEffect(id: string, effect: 'loop' | 'bounce' | 'long_exposure'): Promise<{ url: string }> {
      return request<{ url: string }>(`/assets/${id}/live-effect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ effect }),
      });
    },
    async removeLiveEffect(id: string): Promise<void> {
      return request<void>(`/assets/${id}/live-effect`, { method: 'DELETE' });
    },
    async setKeyPhoto(id: string, timestampMs: number): Promise<{ thumbnailUrl: string }> {
      return request<{ thumbnailUrl: string }>(`/assets/${id}/key-photo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ timestampMs }),
      });
    },
    async attachLiveVideo(id: string, file: File): Promise<Asset> {
      const token = typeof localStorage !== 'undefined' ? localStorage.getItem('photoapp_token') : null;
      const formData = new FormData();
      formData.append('file', file, file.name);
      const response = await fetch(`${API_BASE}/assets/${id}/live-video`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: formData,
      });
      if (!response.ok) {
        const err = await response.json().catch(() => ({ message: response.statusText }));
        throw new Error(err.message || 'Attach live video failed');
      }
      return response.json();
    },
    async downloadZip(assetIds: string[]): Promise<void> {
      const token = typeof localStorage !== 'undefined' ? localStorage.getItem('photoapp_token') : null;
      const response = await fetch(`${API_BASE}/assets/download-zip`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ assetIds }),
      });
      if (!response.ok) throw new Error('Download failed');
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `photos-${Date.now()}.zip`;
      a.click();
      URL.revokeObjectURL(url);
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
    async downloadZip(id: string, albumName: string): Promise<void> {
      const token = typeof localStorage !== 'undefined' ? localStorage.getItem('photoapp_token') : null;
      const response = await fetch(`${API_BASE}/albums/${id}/download`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!response.ok) throw new Error('Download failed');
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${albumName}.zip`;
      a.click();
      URL.revokeObjectURL(url);
    },
    async getShares(id: string): Promise<{ sharedWithEmail: string; createdAt: string }[]> {
      return request(`/albums/${id}/shares`);
    },
    async shareWithEmail(id: string, email: string): Promise<{ albumId: string; email: string; shared: boolean }> {
      return request(`/albums/${id}/share`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
    },
    async unshareWithEmail(id: string, email: string): Promise<void> {
      return request(`/albums/${id}/share/${encodeURIComponent(email)}`, { method: 'DELETE' });
    },
    async sharedWithMe(): Promise<Album[]> {
      return request('/albums/shared-with-me');
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
    async search(query: string, mode: 'text' | 'semantic' | 'auto' | 'memory' = 'auto', month = '', location = '', page = 1, limit = 50, dateFrom = '', dateTo = ''): Promise<SearchResult> {
      const params: Record<string, string> = { q: query, mode, page: String(page), limit: String(limit) };
      if (month) params.month = month;
      if (location) params.location = location;
      if (dateFrom) params.date_from = dateFrom;
      if (dateTo) params.date_to = dateTo;
      const qs = new URLSearchParams(params);
      return request<SearchResult>(`/search?${qs}`);
    },
  },

  people: {
    async list(): Promise<Person[]> {
      return request<Person[]>('/people');
    },
    async get(id: string): Promise<Person> {
      return request<Person>(`/people/${id}`);
    },
    async getAssets(id: string, page = 1, limit = 200): Promise<PaginatedAssets> {
      return request<PaginatedAssets>(`/people/${id}/assets?page=${page}&limit=${limit}`);
    },
    async cluster(): Promise<{ created: number; updated: number; total: number }> {
      return request('/people/cluster', { method: 'POST' });
    },
    async rename(id: string, name: string): Promise<Person> {
      return request<Person>(`/people/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
    },
    async remove(id: string): Promise<void> {
      return request<void>(`/people/${id}`, { method: 'DELETE' });
    },
    async merge(sourceId: string, targetId: string): Promise<Person> {
      return request<Person>(`/people/${sourceId}/merge/${targetId}`, { method: 'POST' });
    },
    faceThumbnailUrl(id: string): string {
      const token = typeof localStorage !== 'undefined' ? localStorage.getItem('photoapp_token') : null;
      return `/api/people/${id}/face-thumbnail${token ? `?token=${encodeURIComponent(token)}` : ''}`;
    },
  },

  smartAlbums: {
    async list(): Promise<SmartAlbumGroup> {
      return request<SmartAlbumGroup>('/albums/smart');
    },
  },

  albumExplore: {
    async get(): Promise<AlbumExploreData> {
      return request<AlbumExploreData>('/albums/explore');
    },
  },

  memories: {
    async get(): Promise<MemoriesResponse> {
      return request<MemoriesResponse>('/memories');
    },
  },

  recaps: {
    async list(): Promise<Recap[]> {
      return request<Recap[]>('/recaps');
    },
    async get(id: string): Promise<Recap> {
      return request<Recap>(`/recaps/${id}`);
    },
    async generate(): Promise<Recap | { message: string }> {
      return request<Recap | { message: string }>('/recaps/generate', { method: 'POST' });
    },
    videoUrl(id: string): string {
      const token = typeof localStorage !== 'undefined' ? localStorage.getItem('photoapp_token') : null;
      return `/api/recaps/${id}/video${token ? `?token=${encodeURIComponent(token)}` : ''}`;
    },
    coverUrl(id: string): string {
      const token = typeof localStorage !== 'undefined' ? localStorage.getItem('photoapp_token') : null;
      return `/api/recaps/${id}/cover${token ? `?token=${encodeURIComponent(token)}` : ''}`;
    },
  },

  users: {
    async getPreferences(): Promise<UserPreferences> {
      return request<UserPreferences>('/users/preferences');
    },
    async updatePreferences(patch: Partial<UserPreferences>): Promise<UserPreferences> {
      return request<UserPreferences>('/users/preferences', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
    },
  },

  admin: {
    async getStats(): Promise<AdminStats> {
      return request<AdminStats>('/admin/stats');
    },
    async getUsers(page = 1, limit = 50): Promise<AdminUsersResult> {
      return request<AdminUsersResult>(`/admin/users?page=${page}&limit=${limit}`);
    },
    async createUser(dto: { email: string; password: string; name: string; isAdmin: boolean }): Promise<AdminUser> {
      return request<AdminUser>('/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(dto),
      });
    },
    async updateUser(id: string, patch: { name?: string; isAdmin?: boolean; storageLimitBytes?: string | null }): Promise<AdminUser> {
      return request<AdminUser>(`/admin/users/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
    },
    async resetPassword(id: string, password: string): Promise<void> {
      return request<void>(`/admin/users/${id}/password`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
    },
    async deleteUser(id: string): Promise<void> {
      return request<void>(`/admin/users/${id}`, { method: 'DELETE' });
    },
  },
  server: {
    async info(): Promise<{ version: string; storage_used_bytes: number; storage_total_bytes: number; appUrl: string }> {
      return request('/server/info');
    },
  },
};

export interface UserPreferences {
  assetViewer: {
    loadPreviewImage: boolean;
    loadOriginalImage: boolean;
  };
  videos: {
    autoPlay: boolean;
    looping: boolean;
  };
  theme: {
    automatic: boolean;
    primaryColor: string | null;
    colorfulInterface: boolean;
  };
  photoGrid: {
    showStorageIndicator: boolean;
    assetsPerRow: number;
  };
}

export const DEFAULT_PREFERENCES: UserPreferences = {
  assetViewer: { loadPreviewImage: true, loadOriginalImage: true },
  videos: { autoPlay: true, looping: false },
  theme: { automatic: false, primaryColor: null, colorfulInterface: false },
  photoGrid: { showStorageIndicator: true, assetsPerRow: 4 },
};

export interface AdminUser {
  id: string;
  email: string;
  name: string;
  isAdmin: boolean;
  storageLimitBytes: string | null;
  storageUsedBytes: string;
  createdAt: string;
  _count: { assets: number };
}

export interface AdminUsersResult {
  users: AdminUser[];
  total: number;
  page: number;
  limit: number;
}

export interface AdminStats {
  users: number;
  assets: number;
  storageBytesTotal: string;
  queues: {
    thumbnail: Record<string, number>;
    metadata: Record<string, number>;
    transcode: Record<string, number>;
    ml: Record<string, number>;
  };
}

export interface MemoryAsset {
  id: string;
  fileName: string;
  fileCreatedAt: string;
  thumbnailSmallPath: string | null;
  thumbnailLargePath: string | null;
  locationCity: string | null;
  locationCountry: string | null;
  isFavorite: boolean;
  width: number | null;
  height: number | null;
  mimeType: string;
  type: 'IMAGE' | 'VIDEO' | 'OTHER';
}

export interface MemoryYearGroup {
  year: number;
  yearsAgo: number;
  label: string;
  count: number;
  assets: MemoryAsset[];
}

export interface MemoriesResponse {
  yearGroups: MemoryYearGroup[];
  randomPhoto: MemoryAsset | null;
  recentHighlights: MemoryAsset[];
  meta: { totalPhotos: number; generatedAt: string };
}

export interface SyncStatusItem {
  done: number;
  total: number;
}

export interface SyncStatus {
  totalAssets: number;
  videoCount: number;
  thumbnails: SyncStatusItem;
  metadata: SyncStatusItem;
  clipEmbeddings: SyncStatusItem;
  faceDetection: SyncStatusItem;
  sceneTags: SyncStatusItem;
  geocoding: SyncStatusItem;
  transcoding: SyncStatusItem;
  allDone: boolean;
}

export interface Recap {
  id: string;
  ownerId: string;
  weekStart: string;
  weekEnd: string;
  videoPath: string | null;
  coverPath: string | null;
  assetIds: string[];
  photoCount: number;
  locationSummary: string | null;
  peopleSummary: string | null;
  status: 'PENDING' | 'GENERATING' | 'READY' | 'FAILED';
  createdAt: string;
  updatedAt: string;
}

export interface MediaTypeCount {
  count: number;
  coverAssetId: string | null;
}

export interface RecentDay {
  date: string;
  count: number;
  coverAssetId: string;
}

export interface AlbumExploreData {
  myAlbums: Album[];
  sharedAlbums: Album[];
  people: SmartAlbumItem[];
  places: SmartAlbumItem[];
  months: SmartAlbumItem[];
  tags: SmartAlbumItem[];
  recentDays: RecentDay[];
  featured: Asset[];
  mediaTypes: {
    videos: MediaTypeCount;
    livePhotos: MediaTypeCount;
    selfies: MediaTypeCount;
    screenshots: MediaTypeCount;
    panoramas: MediaTypeCount;
  };
  utilities: {
    archived: number;
    trashed: number;
    favorites: number;
    total: number;
  };
}
