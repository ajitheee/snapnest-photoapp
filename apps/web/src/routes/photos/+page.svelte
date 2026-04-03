<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { api } from '$lib/api';
  import { isAuthenticated } from '$lib/stores';
  import type { Asset, MemoryYearGroup, MemoryAsset } from '$lib/api';
  import PhotoViewer from '$lib/PhotoViewer.svelte';
  import { settings } from '$lib/settings';

  let assets: Asset[] = [];
  let loading = true;
  let error = '';
  let page = 1;
  let total = 0;
  const limit = 50;
  $: totalPages = Math.ceil(total / limit);

  let viewerIndex = -1;

  // Memories
  let yearGroups: MemoryYearGroup[] = [];
  let memoriesLoading = true;
  let memoriesExpanded = true;
  let memViewerAssets: MemoryAsset[] = [];
  let memViewerIndex = -1;

  // Multi-select
  let selectMode = false;
  let selected = new Set<string>();
  let downloading = false;
  let deleting = false;

  onMount(async () => {
    if (!$isAuthenticated) { goto('/'); return; }
    const [assetsResult, memoriesResult] = await Promise.allSettled([
      loadAssets(),
      api.memories.get(),
    ]);
    if (memoriesResult.status === 'fulfilled') yearGroups = memoriesResult.value.yearGroups;
    memoriesLoading = false;
  });

  async function loadAssets() {
    loading = true; error = '';
    try {
      const result = await api.assets.list(page, limit);
      assets = result.assets; total = result.total;
    } catch (e) {
      error = e instanceof Error ? e.message : 'Failed to load photos';
    } finally { loading = false; }
  }

  function openMemory(group: MemoryYearGroup, idx: number) {
    memViewerAssets = group.assets as MemoryAsset[];
    memViewerIndex = idx;
  }

  async function prevPage() { if (page > 1) { page--; await loadAssets(); } }
  async function nextPage() { if (page < totalPages) { page++; await loadAssets(); } }

  function handleAssetUpdated(e: CustomEvent<Asset>) {
    assets = assets.map(a => a.id === e.detail.id ? e.detail : a);
  }

  function handleAssetRemoved(e: CustomEvent<string>) {
    assets = assets.filter(a => a.id !== e.detail);
    total--;
  }

  function toggleSelectMode() {
    selectMode = !selectMode;
    if (!selectMode) selected = new Set();
  }

  function toggleSelect(id: string) {
    if (selected.has(id)) { selected.delete(id); } else { selected.add(id); }
    selected = selected;
  }

  function selectAll() {
    selected = new Set(assets.map(a => a.id));
  }

  async function downloadSelected() {
    if (!selected.size) return;
    downloading = true;
    try { await api.assets.downloadZip([...selected]); }
    catch (e) { alert('Download failed'); }
    finally { downloading = false; }
  }

  async function deleteSelected() {
    if (!selected.size) return;
    if (!confirm(`Move ${selected.size} item${selected.size !== 1 ? 's' : ''} to trash?`)) return;
    deleting = true;
    try {
      await Promise.all([...selected].map(id => api.assets.softDelete(id)));
      assets = assets.filter(a => !selected.has(a.id));
      total -= selected.size;
      selected = new Set();
    } catch (e) { alert('Delete failed'); }
    finally { deleting = false; }
  }

  function onTileClick(asset: Asset, i: number) {
    if (selectMode) { toggleSelect(asset.id); }
    else { viewerIndex = i; }
  }

  function imgError(e: Event) {
    const el = e.currentTarget as HTMLImageElement;
    el.style.display = 'none';
    const next = el.nextElementSibling as HTMLElement;
    if (next) next.style.removeProperty('display');
  }
  function formatDate(d: string) {
    return new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  }
  function formatSize(b: string) {
    const n = parseInt(b, 10);
    return n < 1048576 ? `${(n/1024).toFixed(1)} KB` : `${(n/1048576).toFixed(1)} MB`;
  }
</script>

<style>
  .page { padding: 1.75rem 2rem; max-width: 1600px; margin: 0 auto; }

  /* Header */
  .header {
    display: flex; align-items: center; justify-content: space-between;
    margin-bottom: 1.25rem; flex-wrap: wrap; gap: 0.75rem;
  }
  .header-left { display: flex; align-items: baseline; gap: 0.75rem; }
  h2 { font-size: 1.6rem; font-weight: 800; letter-spacing: -0.03em; }
  .count {
    background: var(--surface-2);
    border: 1px solid var(--border);
    color: var(--text-muted);
    font-size: 0.78rem;
    font-weight: 600;
    padding: 0.2rem 0.65rem;
    border-radius: 20px;
  }
  .header-actions { display: flex; gap: 0.5rem; align-items: center; }

  .upload-btn {
    padding: 0.5rem 1.1rem;
    background: linear-gradient(135deg, var(--accent) 0%, #8b5cf6 100%);
    border: none; border-radius: 10px; color: #fff;
    font-size: 0.875rem; font-weight: 600;
    box-shadow: 0 2px 8px var(--accent-glow);
    transition: opacity 0.15s, transform 0.15s, box-shadow 0.15s;
    font-family: inherit;
  }
  .upload-btn:hover {
    opacity: 0.9;
    transform: translateY(-1px);
    box-shadow: 0 4px 14px var(--accent-glow);
  }

  .select-btn {
    padding: 0.5rem 1rem;
    background: var(--surface);
    border: 1.5px solid var(--border);
    border-radius: 10px; color: var(--text-muted);
    font-size: 0.875rem; font-weight: 600;
    transition: all 0.15s;
    font-family: inherit;
  }
  .select-btn:hover { border-color: var(--accent); color: var(--accent); }
  .select-btn.active { background: var(--accent); border-color: var(--accent); color: #fff; }

  /* Selection toolbar */
  .select-toolbar {
    display: flex; align-items: center; gap: 0.75rem;
    padding: 0.65rem 1rem;
    background: var(--accent-light);
    border: 1.5px solid var(--accent);
    border-radius: 12px; margin-bottom: 1.25rem; flex-wrap: wrap;
  }
  .sel-count { font-size: 0.875rem; font-weight: 700; color: var(--accent); }
  .tb-btn {
    padding: 0.38rem 0.75rem; border-radius: 8px;
    border: 1px solid var(--border); background: var(--surface);
    color: var(--text-muted); font-size: 0.82rem; font-weight: 500;
    transition: all 0.15s; font-family: inherit;
  }
  .tb-btn:hover { border-color: var(--accent); color: var(--accent); }
  .tb-btn.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
  .tb-btn.primary:hover { background: var(--accent-hover); }
  .tb-btn.danger { border-color: var(--error); color: var(--error); }
  .tb-btn.danger:hover { background: var(--error); color: #fff; }
  .tb-btn:disabled { opacity: 0.5; cursor: not-allowed; }

  /* States */
  .loading, .error-msg, .empty {
    text-align: center; padding: 5rem 2rem; color: var(--text-muted);
    font-size: 0.95rem;
  }
  .loading::before { content: ''; display: block; margin: 0 auto 1rem; }
  .error-msg { color: var(--error); }
  .empty-icon { font-size: 3.5rem; margin-bottom: 1rem; display: block; opacity: 0.5; }

  /* Grid */
  .grid {
    display: grid;
    gap: 6px;
  }

  .asset-tile {
    aspect-ratio: 1; overflow: hidden; border-radius: 8px;
    background: var(--surface-2); position: relative; cursor: pointer;
    transition: transform 0.2s, box-shadow 0.2s;
  }
  .asset-tile:hover { transform: scale(1.015); box-shadow: var(--shadow-lg); z-index: 1; }
  .asset-tile:hover .overlay { opacity: 1; }
  .asset-tile img {
    width: 100%; height: 100%; object-fit: cover; display: block;
    transition: transform 0.25s;
  }
  .asset-tile:hover img { transform: scale(1.04); }
  .asset-tile.selected { outline: 3px solid var(--accent); outline-offset: 0; }
  .asset-tile.selected img { transform: scale(1.03); }

  .video-badge {
    position: absolute; top: 0.45rem; right: 0.45rem;
    background: rgba(0,0,0,0.75); backdrop-filter: blur(4px);
    border-radius: 6px; padding: 2px 7px;
    font-size: 0.68rem; font-weight: 700; color: #fff; letter-spacing: 0.05em;
  }

  .check-badge {
    position: absolute; top: 0.45rem; left: 0.45rem;
    width: 22px; height: 22px; border-radius: 50%;
    border: 2px solid rgba(255,255,255,0.9);
    background: rgba(0,0,0,0.35); backdrop-filter: blur(4px);
    display: flex; align-items: center; justify-content: center;
    font-size: 0.7rem; color: #fff;
    transition: all 0.15s;
  }
  .check-badge.checked { background: var(--accent); border-color: var(--accent); }

  .overlay {
    position: absolute; inset: 0;
    background: linear-gradient(to top, rgba(0,0,0,0.75) 0%, rgba(0,0,0,0.1) 50%, transparent 100%);
    opacity: 0; transition: opacity 0.25s;
    display: flex; flex-direction: column; justify-content: flex-end;
    padding: 0.6rem; pointer-events: none;
  }
  .overlay-info { font-size: 0.73rem; color: #fff; line-height: 1.35; }
  .overlay-name { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .overlay-size { color: rgba(255,255,255,0.75); margin-top: 0.1rem; }

  .broken {
    width: 100%; height: 100%; display: flex; align-items: center;
    justify-content: center; font-size: 2rem; color: var(--border-2);
  }

  /* Pagination */
  .pagination {
    display: flex; align-items: center; justify-content: center;
    gap: 0.75rem; margin-top: 2.5rem; padding-bottom: 1rem;
  }
  .page-btn {
    padding: 0.5rem 1.1rem; background: var(--surface);
    border: 1.5px solid var(--border); border-radius: 10px;
    color: var(--text-muted); font-size: 0.875rem; font-weight: 500;
    transition: all 0.15s; font-family: inherit;
  }
  .page-btn:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); }
  .page-btn:disabled { opacity: 0.35; cursor: not-allowed; }
  .page-info {
    color: var(--text-muted); font-size: 0.875rem; font-weight: 500;
    background: var(--surface-2); border: 1px solid var(--border);
    padding: 0.4rem 0.9rem; border-radius: 8px;
  }

  /* ── Memories strip ── */
  .memories-section {
    margin-bottom: 2rem;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 16px;
    padding: 1.1rem 1.25rem;
    box-shadow: var(--shadow-xs);
  }
  .memories-header {
    display: flex; align-items: center; gap: 0.6rem;
    margin-bottom: 0.9rem; cursor: pointer; user-select: none;
  }
  .memories-title { font-size: 0.95rem; font-weight: 700; color: var(--text); }
  .mem-badge {
    background: linear-gradient(135deg, var(--accent), #8b5cf6);
    color: #fff; font-size: 0.65rem; font-weight: 700;
    padding: 0.15rem 0.5rem; border-radius: 20px;
  }
  .memories-subtitle { font-size: 0.8rem; color: var(--text-muted); }
  .memories-toggle {
    font-size: 0.73rem; font-weight: 500;
    color: var(--accent); margin-left: auto;
    background: var(--accent-light); padding: 0.2rem 0.55rem;
    border-radius: 6px;
  }
  .memory-group { margin-bottom: 1.1rem; }
  .memory-year-label {
    font-size: 0.82rem; font-weight: 700; color: var(--text); margin-bottom: 0.5rem;
  }
  .memory-year-sub {
    font-size: 0.75rem; color: var(--text-muted); font-weight: 400; margin-left: 0.4rem;
  }
  .memory-strip {
    display: flex; gap: 7px; overflow-x: auto; padding-bottom: 4px;
    scrollbar-width: thin; scrollbar-color: var(--border) transparent;
  }
  .memory-strip::-webkit-scrollbar { height: 4px; }
  .memory-strip::-webkit-scrollbar-thumb { background: var(--border); border-radius: 2px; }
  .mem-thumb {
    flex: 0 0 auto; width: 135px; height: 135px; border-radius: 12px;
    overflow: hidden; background: var(--surface-2); cursor: pointer; position: relative;
    transition: transform 0.2s, box-shadow 0.2s;
  }
  .mem-thumb:hover { transform: scale(1.04); box-shadow: var(--shadow-md); }
  .mem-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; transition: transform 0.2s; }
  .mem-thumb:hover img { transform: scale(1.06); }
  .mem-placeholder {
    width: 100%; height: 100%; display: flex; align-items: center;
    justify-content: center; font-size: 2rem; color: var(--text-muted);
  }
  .mem-more {
    flex: 0 0 auto; width: 135px; height: 135px; border-radius: 12px;
    background: var(--surface-2); border: 1.5px dashed var(--border-2);
    display: flex; align-items: center; justify-content: center;
    font-size: 0.82rem; font-weight: 600; color: var(--text-muted);
  }
</style>

<div class="page">
  <div class="header">
    <div class="header-left">
      <h2>Photos</h2>
      {#if !loading && total > 0}<span class="count">{total.toLocaleString()} items</span>{/if}
    </div>
    <div class="header-actions">
      <button class="select-btn" class:active={selectMode} on:click={toggleSelectMode}>
        {selectMode ? 'Cancel' : 'Select'}
      </button>
      <a href="/upload"><button class="upload-btn">+ Upload</button></a>
    </div>
  </div>

  {#if selectMode && assets.length > 0}
    <div class="select-toolbar">
      <span class="sel-count">{selected.size} selected</span>
      <button class="tb-btn" on:click={selectAll}>Select All</button>
      <button class="tb-btn" on:click={() => selected = new Set()}>Clear</button>
      <button class="tb-btn primary" on:click={downloadSelected} disabled={selected.size === 0 || downloading}>
        {downloading ? 'Downloading…' : `⬇ Download (${selected.size})`}
      </button>
      <button class="tb-btn danger" on:click={deleteSelected} disabled={selected.size === 0 || deleting}>
        {deleting ? 'Moving to trash…' : `🗑 Delete (${selected.size})`}
      </button>
    </div>
  {/if}

  {#if !memoriesLoading && yearGroups.length > 0}
    <div class="memories-section">
      <!-- svelte-ignore a11y-click-events-have-key-events -->
      <!-- svelte-ignore a11y-no-static-element-interactions -->
      <div class="memories-header" on:click={() => memoriesExpanded = !memoriesExpanded}>
        <span class="memories-title">Memories</span>
        <span class="mem-badge">✦ Today</span>
        <span class="memories-subtitle">On this day in past years</span>
        <span class="memories-toggle">{memoriesExpanded ? '▲ Hide' : '▼ Show'}</span>
      </div>
      {#if memoriesExpanded}
        {#each yearGroups as group}
          <div class="memory-group">
            <div class="memory-year-label">
              {group.label}
              <span class="memory-year-sub">{group.year} · {group.count} photo{group.count !== 1 ? 's' : ''}</span>
            </div>
            <div class="memory-strip">
              {#each group.assets as asset, i}
                <!-- svelte-ignore a11y-click-events-have-key-events -->
                <div class="mem-thumb" on:click={() => openMemory(group, i)}
                  role="button" tabindex="0"
                  on:keydown={(e) => e.key === 'Enter' && openMemory(group, i)}>
                  {#if asset.thumbnailSmallPath}
                    <img src={api.assets.thumbnailUrl(asset.id)} alt={asset.fileName} loading="lazy" />
                  {:else}
                    <div class="mem-placeholder">🖼</div>
                  {/if}
                </div>
              {/each}
              {#if group.count > group.assets.length}
                <div class="mem-more">+{group.count - group.assets.length} more</div>
              {/if}
            </div>
          </div>
        {/each}
      {/if}
    </div>
  {/if}

  {#if loading}
    <div class="loading">Loading your photos...</div>
  {:else if error}
    <div class="error-msg">{error}</div>
  {:else if assets.length === 0}
    <div class="empty">
      <span class="empty-icon">🖼️</span>
      <p style="font-weight:600;font-size:1rem;color:var(--text-2)">No photos yet</p>
      <p style="margin-top:0.5rem;font-size:0.875rem"><a href="/upload" style="color:var(--accent);font-weight:600">Upload your first photo</a> to get started.</p>
    </div>
  {:else}
    <div class="grid" style="grid-template-columns: repeat({$settings.photoGrid.assetsPerRow}, 1fr)">
      {#each assets as asset, i (asset.id)}
        <div class="asset-tile" class:selected={selected.has(asset.id)}
          on:click={() => onTileClick(asset, i)} role="button" tabindex="0"
          on:keydown={(e) => e.key === 'Enter' && onTileClick(asset, i)}>
          {#if asset.type !== 'OTHER'}
            <img src={api.assets.thumbnailUrl(asset.id)} alt={asset.fileName} loading="lazy"
              on:error={(e) => imgError(e)} />
            <div class="broken" style="display:none">&#128247;</div>
          {:else}
            <div class="broken">&#128196;</div>
          {/if}
          {#if selectMode}
            <div class="check-badge" class:checked={selected.has(asset.id)}>
              {#if selected.has(asset.id)}&#10003;{/if}
            </div>
          {/if}
          {#if asset.type === 'VIDEO'}<span class="video-badge">VIDEO</span>{/if}
          {#if $settings.photoGrid.showStorageIndicator}
          <div class="overlay">
            <div class="overlay-info">
              <div class="overlay-name">{asset.fileName}</div>
              <div class="overlay-size">{formatSize(asset.fileSizeBytes)} &middot; {formatDate(asset.fileCreatedAt)}</div>
            </div>
          </div>
          {/if}
        </div>
      {/each}
    </div>
    {#if totalPages > 1}
      <div class="pagination">
        <button class="page-btn" on:click={prevPage} disabled={page <= 1}>&larr; Previous</button>
        <span class="page-info">Page {page} of {totalPages}</span>
        <button class="page-btn" on:click={nextPage} disabled={page >= totalPages}>Next &rarr;</button>
      </div>
    {/if}
  {/if}
</div>

<PhotoViewer
  bind:viewerIndex
  {assets}
  mode="default"
  on:assetUpdated={handleAssetUpdated}
  on:assetRemoved={handleAssetRemoved}
/>

<PhotoViewer
  bind:viewerIndex={memViewerIndex}
  assets={memViewerAssets}
  mode="default"
/>
