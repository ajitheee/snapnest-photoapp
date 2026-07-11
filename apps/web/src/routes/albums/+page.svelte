<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { api } from '$lib/api';
  import { isAuthenticated } from '$lib/stores';
  import type { Album, AlbumExploreData, Asset, SmartAlbumItem } from '$lib/api';
  import PhotoViewer from '$lib/PhotoViewer.svelte';

  let data: AlbumExploreData | null = null;
  let loading = true;
  let error = '';
  let showCreate = false;
  let newName = '';
  let newDesc = '';
  let creating = false;
  let createError = '';

  let filterTitle = '';
  let filterAssets: Asset[] = [];
  let filterLoading = false;
  let filterTotal = 0;
  let filterPage = 1;
  const filterLimit = 50;
  $: filterTotalPages = Math.ceil(filterTotal / filterLimit);
  let filterParams: { month?: string; dateFrom?: string; dateTo?: string; q?: string; mode?: string } = {};
  let viewerIndex = -1;

  $: showFilter = filterTitle !== '';

  onMount(async () => {
    if (!$isAuthenticated) { goto('/'); return; }
    await load();
  });

  async function load() {
    loading = true; error = '';
    try {
      data = await api.albumExplore.get();
    } catch (e) {
      error = e instanceof Error ? e.message : 'Failed to load';
    } finally {
      loading = false;
    }
  }

  async function openFilter(title: string, params: typeof filterParams) {
    filterTitle = title;
    filterParams = params;
    filterPage = 1;
    viewerIndex = -1;
    await loadFilterPage();
  }

  async function loadFilterPage() {
    filterLoading = true;
    try {
      const r = await api.search.search(
        filterParams.q ?? '',
        (filterParams.mode as any) ?? 'text',
        filterParams.month ?? '',
        '',
        filterPage,
        filterLimit,
        filterParams.dateFrom ?? '',
        filterParams.dateTo ?? '',
      );
      filterAssets = r.assets;
      filterTotal = r.total;
    } catch (e) {
      filterAssets = [];
      filterTotal = 0;
    } finally {
      filterLoading = false;
    }
  }

  function closeFilter() {
    filterTitle = '';
    filterAssets = [];
    filterTotal = 0;
    filterPage = 1;
    filterParams = {};
    viewerIndex = -1;
  }

  async function filterPrev() { if (filterPage > 1) { filterPage--; await loadFilterPage(); } }
  async function filterNext() { if (filterPage < filterTotalPages) { filterPage++; await loadFilterPage(); } }

  async function createAlbum() {
    if (!newName.trim()) return;
    creating = true; createError = '';
    try {
      const album = await api.albums.create(newName.trim(), newDesc.trim() || undefined);
      if (data) data = { ...data, myAlbums: [album, ...data.myAlbums] };
      showCreate = false; newName = ''; newDesc = '';
    } catch (e) { createError = e instanceof Error ? e.message : 'Failed to create'; }
    finally { creating = false; }
  }

  async function deleteAlbum(album: Album) {
    if (!confirm(`Delete album "${album.name}"?`)) return;
    await api.albums.remove(album.id);
    if (data) data = { ...data, myAlbums: data.myAlbums.filter(a => a.id !== album.id) };
  }

  function formatDay(dateStr: string) {
    const d = new Date(dateStr + 'T12:00:00');
    const now = new Date();
    const diff = Math.floor((now.getTime() - d.getTime()) / 86400000);
    if (diff === 0) return 'Today';
    if (diff === 1) return 'Yesterday';
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  }

  function formatDate(d: string) {
    return new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  }
  function formatSize(b: string) {
    const n = parseInt(b, 10);
    return n < 1048576 ? `${(n/1024).toFixed(1)} KB` : `${(n/1048576).toFixed(1)} MB`;
  }
  function imgError(e: Event) {
    const el = e.currentTarget as HTMLImageElement;
    el.style.display = 'none';
    const next = el.nextElementSibling as HTMLElement;
    if (next) next.style.removeProperty('display');
  }
</script>

<style>
  .page { padding: 1.75rem 2rem; max-width: 1600px; margin: 0 auto; }

  /* Header */
  .header {
    display: flex; align-items: center; justify-content: space-between;
    margin-bottom: 1.75rem;
  }
  h2 { font-size: 1.6rem; font-weight: 800; letter-spacing: -0.03em; }
  .new-btn {
    padding: 0.5rem 1.1rem;
    background: linear-gradient(135deg, var(--accent) 0%, #8b5cf6 100%);
    border: none; border-radius: 10px; color: #fff;
    font-size: 0.875rem; font-weight: 600;
    box-shadow: 0 2px 8px var(--accent-glow);
    transition: opacity 0.15s, transform 0.15s;
  }
  .new-btn:hover { opacity: 0.9; transform: translateY(-1px); }

  .loading, .error-msg { text-align: center; padding: 4rem 2rem; color: var(--text-muted); }
  .error-msg { color: var(--error); }

  /* Create form */
  .create-form {
    background: var(--surface); border: 1px solid var(--border);
    border-radius: 12px; padding: 1.2rem; margin-bottom: 1.5rem;
    display: flex; flex-direction: column; gap: 0.8rem;
  }
  .create-form input, .create-form textarea {
    background: var(--surface-2); border: 1px solid var(--border);
    border-radius: 6px; color: var(--text); padding: 0.5rem 0.75rem; font-size: 0.9rem; width: 100%;
  }
  .create-form textarea { resize: vertical; min-height: 60px; }
  .form-actions { display: flex; gap: 0.5rem; justify-content: flex-end; }
  .btn-cancel { padding: 0.4rem 0.8rem; background: var(--surface-2); border: 1px solid var(--border-2); border-radius: 6px; color: var(--text-muted); font-size: 0.9rem; }
  .btn-save { padding: 0.4rem 0.8rem; background: var(--accent); border: none; border-radius: 6px; color: #fff; font-size: 0.9rem; font-weight: 600; }
  .btn-save:disabled { opacity: 0.5; cursor: not-allowed; }
  .form-err { color: var(--error); font-size: 0.85rem; }

  /* Section */
  .section {
    margin-bottom: 2rem;
  }
  .section-header {
    display: flex; align-items: center; justify-content: space-between;
    margin-bottom: 0.75rem;
  }
  .section-title {
    font-size: 1.05rem; font-weight: 700; color: var(--text);
    display: flex; align-items: center; gap: 0.5rem;
  }
  .section-icon { font-size: 1.1rem; }
  .section-count {
    font-size: 0.72rem; font-weight: 600; color: var(--text-muted);
    background: var(--surface-2); border: 1px solid var(--border);
    padding: 0.12rem 0.5rem; border-radius: 20px;
  }
  .see-all {
    font-size: 0.8rem; color: var(--accent); font-weight: 600;
    text-decoration: none; transition: opacity 0.15s;
  }
  .see-all:hover { opacity: 0.8; }

  /* Horizontal scroll strip */
  .h-strip {
    display: flex; gap: 10px; overflow-x: auto; padding-bottom: 6px;
    scrollbar-width: thin; scrollbar-color: var(--border) transparent;
  }
  .h-strip::-webkit-scrollbar { height: 4px; }
  .h-strip::-webkit-scrollbar-thumb { background: var(--border); border-radius: 2px; }

  /* Recent days strip */
  .day-card {
    flex: 0 0 auto; width: 130px; height: 155px;
    border-radius: 12px; overflow: hidden;
    background: var(--surface-2); cursor: pointer; position: relative;
    transition: transform 0.2s;
  }
  .day-card:hover { transform: scale(1.03); }
  .day-card img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .day-overlay {
    position: absolute; inset: 0;
    background: linear-gradient(to top, rgba(0,0,0,0.7) 0%, transparent 50%);
    display: flex; flex-direction: column; justify-content: flex-end;
    padding: 0.5rem 0.6rem;
  }
  .day-label { font-size: 0.78rem; font-weight: 700; color: #fff; }
  .day-count { font-size: 0.65rem; color: rgba(255,255,255,0.7); }

  /* Album grid */
  .album-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
    gap: 0.85rem;
  }
  .album-card {
    background: var(--surface); border: 1px solid var(--border);
    border-radius: 12px; overflow: hidden; cursor: pointer;
    transition: border-color 0.15s, transform 0.15s, box-shadow 0.15s;
  }
  .album-card:hover { border-color: var(--border-2); transform: translateY(-2px); box-shadow: var(--shadow-md); }
  .cover { aspect-ratio: 4/3; background: var(--surface-2); overflow: hidden; }
  .cover img { width: 100%; height: 100%; object-fit: cover; display: block; transition: transform 0.2s; }
  .album-card:hover .cover img { transform: scale(1.04); }
  .cover-placeholder { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; font-size: 2.5rem; color: var(--border-2); }
  .card-body { padding: 0.6rem 0.75rem; }
  .album-name { font-weight: 600; font-size: 0.88rem; margin-bottom: 0.15rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .album-meta { color: var(--text-muted); font-size: 0.75rem; display: flex; justify-content: space-between; align-items: center; }
  .del-btn { background: none; border: none; color: var(--text-subtle); font-size: 0.75rem; cursor: pointer; padding: 0; }
  .del-btn:hover { color: var(--error); }
  .shared-badge {
    display: inline-flex; align-items: center; gap: 0.2rem;
    font-size: 0.65rem; font-weight: 600; color: var(--accent);
    background: var(--active-bg); border-radius: 4px; padding: 1px 5px;
  }
  .shared-by { font-size: 0.7rem; color: var(--text-subtle); margin-top: 0.1rem; }


  /* Media type grid */
  .media-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
    gap: 0.75rem;
  }
  .media-card {
    background: var(--surface); border: 1px solid var(--border);
    border-radius: 10px; overflow: hidden; cursor: pointer;
    transition: all 0.15s;
  }
  .media-card:hover { border-color: var(--border-2); transform: translateY(-1px); }
  .media-card.disabled { opacity: 0.4; cursor: default; pointer-events: none; }
  .media-cover { aspect-ratio: 3/2; background: var(--surface-2); overflow: hidden; position: relative; }
  .media-cover img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .media-icon-badge {
    position: absolute; top: 0.35rem; left: 0.35rem;
    background: rgba(0,0,0,0.6); backdrop-filter: blur(4px);
    border-radius: 6px; padding: 2px 6px;
    font-size: 0.85rem;
  }
  .media-body { padding: 0.5rem 0.65rem; }
  .media-name { font-weight: 600; font-size: 0.82rem; }
  .media-count { font-size: 0.7rem; color: var(--text-muted); }


  /* Months scroll */
  .month-card {
    flex: 0 0 auto; width: 120px; height: 90px;
    border-radius: 10px; overflow: hidden;
    background: var(--surface-2); cursor: pointer; position: relative;
    transition: transform 0.2s;
  }
  .month-card:hover { transform: scale(1.03); }
  .month-card img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .month-overlay {
    position: absolute; inset: 0;
    background: linear-gradient(to top, rgba(0,0,0,0.65) 0%, transparent 50%);
    display: flex; flex-direction: column; justify-content: flex-end;
    padding: 0.35rem 0.5rem;
  }
  .month-label { font-size: 0.7rem; font-weight: 700; color: #fff; }
  .month-count { font-size: 0.58rem; color: rgba(255,255,255,0.7); }

  /* Inline filter view */
  .filter-header {
    display: flex; align-items: center; gap: 0.75rem;
    margin-bottom: 1.25rem;
  }
  .back-btn {
    display: flex; align-items: center; justify-content: center;
    width: 36px; height: 36px;
    background: var(--surface-2); border: 1px solid var(--border);
    border-radius: 8px; color: var(--text); font-size: 1.1rem;
    cursor: pointer; transition: all 0.15s;
  }
  .back-btn:hover { border-color: var(--accent); color: var(--accent); }
  .filter-title { font-size: 1.4rem; font-weight: 800; letter-spacing: -0.03em; }
  .filter-count { font-size: 0.85rem; color: var(--text-muted); margin-left: auto; }
  .filter-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
    gap: 4px;
  }
  .filter-tile {
    aspect-ratio: 1; overflow: hidden; border-radius: 4px;
    background: var(--surface-2); position: relative; cursor: pointer;
  }
  .filter-tile img { width: 100%; height: 100%; object-fit: cover; display: block; transition: transform 0.2s; }
  .filter-tile:hover img { transform: scale(1.03); }
  .filter-tile:hover .filter-overlay { opacity: 1; }
  .filter-overlay {
    position: absolute; inset: 0;
    background: linear-gradient(to top, rgba(0,0,0,0.7) 0%, transparent 50%);
    opacity: 0; transition: opacity 0.2s;
    display: flex; align-items: flex-end; padding: 0.5rem;
    pointer-events: none;
  }
  .filter-info { font-size: 0.75rem; color: #fff; }
  .filter-name { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .filter-meta { color: #ccc; }
  .filter-broken { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; font-size: 2rem; color: var(--border-2); }
  .filter-pagination {
    display: flex; align-items: center; justify-content: center;
    gap: 0.75rem; margin-top: 2rem; padding-bottom: 1rem;
  }
  .page-btn {
    padding: 0.5rem 1.1rem; background: var(--surface);
    border: 1.5px solid var(--border); border-radius: 10px;
    color: var(--text-muted); font-size: 0.875rem; font-weight: 500;
    transition: all 0.15s; font-family: inherit; cursor: pointer;
  }
  .page-btn:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); }
  .page-btn:disabled { opacity: 0.35; cursor: not-allowed; }
  .page-info {
    color: var(--text-muted); font-size: 0.875rem; font-weight: 500;
    background: var(--surface-2); border: 1px solid var(--border);
    padding: 0.4rem 0.9rem; border-radius: 8px;
  }
</style>

<div class="page">
  {#if showFilter}
    <!-- Inline filter gallery view -->
    <div class="filter-header">
      <button class="back-btn" on:click={closeFilter}>&larr;</button>
      <span class="filter-title">{filterTitle}</span>
      {#if !filterLoading && filterTotal > 0}
        <span class="filter-count">{filterTotal} photo{filterTotal !== 1 ? 's' : ''}</span>
      {/if}
    </div>

    {#if filterLoading}
      <div class="loading">Loading...</div>
    {:else if filterAssets.length === 0}
      <div class="loading">No photos found.</div>
    {:else}
      <div class="filter-grid">
        {#each filterAssets as asset, i (asset.id)}
          <div class="filter-tile" on:click={() => viewerIndex = i} role="button" tabindex="0"
            on:keydown={(e) => e.key === 'Enter' && (viewerIndex = i)}>
            {#if asset.type !== 'OTHER'}
              <img src={api.assets.thumbnailUrl(asset.id, asset.updatedAt)} alt={asset.fileName} loading="lazy"
                on:error={(e) => imgError(e)} />
              <div class="filter-broken" style="display:none">&#128247;</div>
            {:else}
              <div class="filter-broken">&#128196;</div>
            {/if}
            <div class="filter-overlay">
              <div class="filter-info">
                <div class="filter-name">{asset.fileName}</div>
                <div class="filter-meta">{formatSize(asset.fileSizeBytes)} &middot; {formatDate(asset.fileCreatedAt)}</div>
              </div>
            </div>
          </div>
        {/each}
      </div>
      {#if filterTotalPages > 1}
        <div class="filter-pagination">
          <button class="page-btn" on:click={filterPrev} disabled={filterPage <= 1}>&larr; Previous</button>
          <span class="page-info">Page {filterPage} of {filterTotalPages}</span>
          <button class="page-btn" on:click={filterNext} disabled={filterPage >= filterTotalPages}>Next &rarr;</button>
        </div>
      {/if}
    {/if}

    <PhotoViewer
      bind:viewerIndex
      assets={filterAssets}
      mode="default"
    />

  {:else}

  <div class="header">
    <h2>Albums</h2>
    <button class="new-btn" on:click={() => showCreate = !showCreate}>+ New Album</button>
  </div>

  {#if showCreate}
    <div class="create-form">
      <input bind:value={newName} placeholder="Album name" maxlength="200" />
      <textarea bind:value={newDesc} placeholder="Description (optional)"></textarea>
      {#if createError}<div class="form-err">{createError}</div>{/if}
      <div class="form-actions">
        <button class="btn-cancel" on:click={() => { showCreate = false; newName = ''; newDesc = ''; }}>Cancel</button>
        <button class="btn-save" on:click={createAlbum} disabled={creating || !newName.trim()}>
          {creating ? 'Creating...' : 'Create'}
        </button>
      </div>
    </div>
  {/if}

  {#if loading}
    <div class="loading">Loading albums...</div>
  {:else if error}
    <div class="error-msg">{error}</div>
  {:else if data}

    <!-- My Albums -->
    <div class="section">
      <div class="section-header">
        <span class="section-title">
          <span class="section-icon">&#128193;</span> My Albums
          {#if data.myAlbums.length > 0}<span class="section-count">{data.myAlbums.length}</span>{/if}
        </span>
      </div>
      {#if data.myAlbums.length > 0}
        <div class="album-grid">
          {#each data.myAlbums as album (album.id)}
            <!-- svelte-ignore a11y-click-events-have-key-events -->
            <div class="album-card" on:click={() => goto(`/albums/${album.id}`)} role="button" tabindex="0"
              on:keydown={(e) => e.key === 'Enter' && goto(`/albums/${album.id}`)}>
              <div class="cover">
                {#if album.coverAssetId}
                  <img src={api.assets.thumbnailUrl(album.coverAssetId)} alt={album.name} loading="lazy" />
                {:else}
                  <div class="cover-placeholder">&#128193;</div>
                {/if}
              </div>
              <div class="card-body">
                <div class="album-name">{album.name}</div>
                <div class="album-meta">
                  <span>{album._count?.assets ?? 0} photos</span>
                  <button class="del-btn" on:click|stopPropagation={() => deleteAlbum(album)}>Delete</button>
                </div>
              </div>
            </div>
          {/each}
        </div>
      {:else}
        <div style="text-align:center;padding:2rem;color:var(--text-muted);font-size:0.9rem">
          No albums yet. Tap + New Album to get started.
        </div>
      {/if}
    </div>

    <!-- Shared Albums -->
    {#if data.sharedAlbums.length > 0}
      <div class="section">
        <div class="section-header">
          <span class="section-title">
            <span class="section-icon">&#128279;</span> Shared Albums
            <span class="section-count">{data.sharedAlbums.length}</span>
          </span>
        </div>
        <div class="album-grid">
          {#each data.sharedAlbums as album (album.id)}
            <div class="album-card" on:click={() => goto(`/albums/${album.id}`)} role="button" tabindex="0"
              on:keydown={(e) => e.key === 'Enter' && goto(`/albums/${album.id}`)}>
              <div class="cover">
                {#if album.coverAssetId}
                  <img src={api.assets.thumbnailUrl(album.coverAssetId)} alt={album.name} loading="lazy" />
                {:else}
                  <div class="cover-placeholder">&#128193;</div>
                {/if}
              </div>
              <div class="card-body">
                <div class="album-name">{album.name}</div>
                <div class="album-meta">
                  <span>{album._count?.assets ?? 0} photos</span>
                  <span class="shared-badge">Shared</span>
                </div>
                {#if album['sharedByEmail']}
                  <div class="shared-by">by {album['sharedByName'] || album['sharedByEmail']}</div>
                {/if}
              </div>
            </div>
          {/each}
        </div>
      </div>
    {/if}

    <!-- Recent Days -->
    {#if data.recentDays.length > 0}
      <div class="section">
        <div class="section-header">
          <span class="section-title"><span class="section-icon">&#128197;</span> Recent Days</span>
          <a class="see-all" href="/photos">See All</a>
        </div>
        <div class="h-strip">
          {#each data.recentDays as day}
            <div class="day-card" on:click={() => openFilter(formatDay(day.date), { dateFrom: day.date, dateTo: day.date })} role="button" tabindex="0">
              <img src={api.assets.thumbnailUrl(day.coverAssetId)} alt={day.date} loading="lazy" />
              <div class="day-overlay">
                <div class="day-label">{formatDay(day.date)}</div>
                <div class="day-count">{day.count} photo{day.count !== 1 ? 's' : ''}</div>
              </div>
            </div>
          {/each}
        </div>
      </div>
    {/if}

    <!-- Months -->
    {#if data.months.length > 0}
      <div class="section">
        <div class="section-header">
          <span class="section-title"><span class="section-icon">&#128197;</span> Months</span>
          <a class="see-all" href="/smart-albums">See All</a>
        </div>
        <div class="h-strip">
          {#each data.months.slice(0, 12) as month}
            <div class="month-card" on:click={() => openFilter(month.name, { month: month.criteria.month })} role="button" tabindex="0">
              {#if month.coverAssetId}
                <img src={api.assets.thumbnailUrl(month.coverAssetId)} alt={month.name} loading="lazy" />
              {:else}
                <div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:1.3rem;color:var(--border-2)">&#128197;</div>
              {/if}
              <div class="month-overlay">
                <div class="month-label">{month.name}</div>
                <div class="month-count">{month.assetCount} photos</div>
              </div>
            </div>
          {/each}
        </div>
      </div>
    {/if}

    <!-- Media Types -->
    <div class="section">
      <div class="section-header">
        <span class="section-title"><span class="section-icon">&#127916;</span> Media Types</span>
      </div>
      <div class="media-grid">
        <div class="media-card" class:disabled={data.mediaTypes.videos.count === 0}
          on:click={() => data?.mediaTypes.videos.count && goto('/videos')} role="button" tabindex="0">
          <div class="media-cover">
            {#if data.mediaTypes.videos.coverAssetId}
              <img src={api.assets.thumbnailUrl(data.mediaTypes.videos.coverAssetId)} alt="Videos" loading="lazy" />
            {/if}
            <span class="media-icon-badge">&#127909;</span>
          </div>
          <div class="media-body">
            <div class="media-name">Videos</div>
            <div class="media-count">{data.mediaTypes.videos.count}</div>
          </div>
        </div>

        <div class="media-card" class:disabled={data.mediaTypes.livePhotos.count === 0}
          on:click={() => data?.mediaTypes.livePhotos.count && goto('/photos?isLivePhoto=true')} role="button" tabindex="0">
          <div class="media-cover">
            {#if data.mediaTypes.livePhotos.coverAssetId}
              <img src={api.assets.thumbnailUrl(data.mediaTypes.livePhotos.coverAssetId)} alt="Live Photos" loading="lazy" />
            {/if}
            <span class="media-icon-badge">&#9654;</span>
          </div>
          <div class="media-body">
            <div class="media-name">Live Photos</div>
            <div class="media-count">{data.mediaTypes.livePhotos.count}</div>
          </div>
        </div>

        <div class="media-card" class:disabled={data.mediaTypes.selfies.count === 0}
          on:click={() => data?.mediaTypes.selfies.count && openFilter('Selfies', { q: 'selfie', mode: 'semantic' })} role="button" tabindex="0">
          <div class="media-cover">
            {#if data.mediaTypes.selfies.coverAssetId}
              <img src={api.assets.thumbnailUrl(data.mediaTypes.selfies.coverAssetId)} alt="Selfies" loading="lazy" />
            {/if}
            <span class="media-icon-badge">&#129331;</span>
          </div>
          <div class="media-body">
            <div class="media-name">Selfies</div>
            <div class="media-count">{data.mediaTypes.selfies.count}</div>
          </div>
        </div>

        <div class="media-card" class:disabled={data.mediaTypes.screenshots.count === 0}
          on:click={() => data?.mediaTypes.screenshots.count && openFilter('Screenshots', { q: 'screenshot', mode: 'text' })} role="button" tabindex="0">
          <div class="media-cover">
            {#if data.mediaTypes.screenshots.coverAssetId}
              <img src={api.assets.thumbnailUrl(data.mediaTypes.screenshots.coverAssetId)} alt="Screenshots" loading="lazy" />
            {/if}
            <span class="media-icon-badge">&#128241;</span>
          </div>
          <div class="media-body">
            <div class="media-name">Screenshots</div>
            <div class="media-count">{data.mediaTypes.screenshots.count}</div>
          </div>
        </div>

        <div class="media-card" class:disabled={data.mediaTypes.panoramas.count === 0}
          on:click={() => data?.mediaTypes.panoramas.count && openFilter('Panoramas', { q: 'panorama', mode: 'semantic' })} role="button" tabindex="0">
          <div class="media-cover">
            {#if data.mediaTypes.panoramas.coverAssetId}
              <img src={api.assets.thumbnailUrl(data.mediaTypes.panoramas.coverAssetId)} alt="Panoramas" loading="lazy" />
            {/if}
            <span class="media-icon-badge">&#127748;</span>
          </div>
          <div class="media-body">
            <div class="media-name">Panoramas</div>
            <div class="media-count">{data.mediaTypes.panoramas.count}</div>
          </div>
        </div>
      </div>
    </div>

  {/if}

  {/if}
</div>
