<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { page as pageStore } from '$app/stores';
  import { api } from '$lib/api';
  import { isAuthenticated } from '$lib/stores';
  import type { Asset } from '$lib/api';
  import PhotoViewer from '$lib/PhotoViewer.svelte';

  let assets: Asset[] = [];
  let loading = true;
  let error = '';
  let pgNum = 1;
  let total = 0;
  const limit = 50;
  $: totalPages = Math.ceil(total / limit);

  let viewerIndex = -1;
  let downloading = false;
  let deleting = false;
  let selected = new Set<string>();
  let selectMode = false;

  // Month filter from query param — reactive to URL changes
  $: monthFilter = $pageStore.url.searchParams.get('month') || '';

  let ready = false;
  onMount(() => {
    if (!$isAuthenticated) { goto('/'); return; }
    ready = true;
  });

  // Re-fetch whenever the month filter changes or the page becomes ready
  $: if (ready) {
    monthFilter; // track URL param changes
    pgNum = 1;
    loadVideos();
  }

  async function loadVideos() {
    loading = true; error = '';
    try {
      const result = await api.assets.listVideos(pgNum, limit, monthFilter);
      assets = result.assets;
      total = result.total;
    } catch (e) {
      error = e instanceof Error ? e.message : 'Failed to load videos';
    } finally { loading = false; }
  }

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

  async function downloadSelected() {
    if (!selected.size) return;
    downloading = true;
    try { await api.assets.downloadZip([...selected]); }
    catch (e) { alert('Download failed'); }
    finally { downloading = false; }
  }

  async function deleteSelected() {
    if (!selected.size) return;
    if (!confirm(`Move ${selected.size} video${selected.size !== 1 ? 's' : ''} to trash?`)) return;
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

  function formatDate(d: string) {
    return new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  }
  function formatSize(b: string) {
    const n = parseInt(b, 10);
    return n < 1048576 ? `${(n/1024).toFixed(1)} KB` : `${(n/1048576).toFixed(1)} MB`;
  }
  function formatDuration(s: number | null) {
    if (!s) return '';
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${String(sec).padStart(2, '0')}`;
  }
</script>

<style>
  .page { padding: 1.5rem; max-width: 1600px; margin: 0 auto; }
  .header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 1rem; flex-wrap: wrap; gap: 0.5rem; }
  h2 { font-size: 1.5rem; font-weight: 700; }
  .subtitle { color: var(--text-muted); font-size: 0.85rem; margin-top: 0.15rem; }
  .count { color: var(--text-muted); font-size: 0.9rem; }
  .header-actions { display: flex; gap: 0.5rem; align-items: center; }
  .select-btn { padding: 0.5rem 1rem; background: var(--surface); border: 1px solid var(--border); border-radius: 8px; color: var(--text-muted); font-size: 0.9rem; font-weight: 600; }
  .select-btn.active { background: var(--accent); border-color: var(--accent); color: #fff; }
  .select-toolbar { display: flex; align-items: center; gap: 0.75rem; padding: 0.6rem 1rem; background: var(--surface); border: 1px solid var(--border); border-radius: 8px; margin-bottom: 1rem; flex-wrap: wrap; }
  .sel-count { font-size: 0.9rem; font-weight: 600; color: var(--text); }
  .tb-btn { padding: 0.4rem 0.8rem; border-radius: 6px; border: 1px solid var(--border); background: var(--surface-2); color: var(--text-muted); font-size: 0.85rem; font-weight: 500; }
  .tb-btn:hover { border-color: var(--accent); color: var(--accent); }
  .tb-btn.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
  .tb-btn.primary:hover { background: var(--accent-hover); }
  .tb-btn.danger { border-color: var(--error, #ef4444); color: var(--error, #ef4444); }
  .tb-btn.danger:hover { background: var(--error, #ef4444); color: #fff; }
  .tb-btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .loading, .error-msg, .empty { text-align: center; padding: 4rem 2rem; color: var(--text-muted); }
  .error-msg { color: var(--error); }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 4px; }
  .tile { aspect-ratio: 16/10; overflow: hidden; border-radius: 6px; background: var(--surface-2); position: relative; cursor: pointer; }
  .tile img { width: 100%; height: 100%; object-fit: cover; display: block; transition: transform 0.2s; }
  .tile:hover img { transform: scale(1.03); }
  .tile.selected { outline: 3px solid var(--accent); }
  .video-icon { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; font-size: 2.5rem; color: rgba(255,255,255,0.85); pointer-events: none; }
  .video-badge { position: absolute; top: 0.4rem; right: 0.4rem; background: rgba(0,0,0,0.7); border-radius: 4px; padding: 2px 6px; font-size: 0.7rem; color: #fff; }
  .duration-badge { position: absolute; bottom: 0.4rem; right: 0.4rem; background: rgba(0,0,0,0.75); border-radius: 4px; padding: 2px 6px; font-size: 0.75rem; color: #fff; font-variant-numeric: tabular-nums; }
  .check-badge { position: absolute; top: 0.4rem; left: 0.4rem; width: 22px; height: 22px; border-radius: 50%; border: 2px solid #fff; background: rgba(0,0,0,0.4); display: flex; align-items: center; justify-content: center; font-size: 0.75rem; color: #fff; }
  .check-badge.checked { background: var(--accent); border-color: var(--accent); }
  .overlay { position: absolute; inset: 0; background: linear-gradient(to top, rgba(0,0,0,0.75) 0%, transparent 55%); opacity: 0; transition: opacity 0.2s; display: flex; flex-direction: column; justify-content: flex-end; padding: 0.4rem; pointer-events: none; }
  .tile:hover .overlay { opacity: 1; }
  .overlay-name { font-size: 0.75rem; font-weight: 600; color: #fff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .overlay-meta { font-size: 0.7rem; color: #ccc; margin-top: 1px; }
  .placeholder-video { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; font-size: 3rem; background: #111; }
  .pagination { display: flex; align-items: center; justify-content: center; gap: 1rem; margin-top: 2rem; }
  .page-btn { padding: 0.4rem 0.8rem; background: var(--surface); border: 1px solid var(--border); border-radius: 6px; color: var(--text-muted); font-size: 0.9rem; }
  .page-btn:hover:not(:disabled) { border-color: var(--border-2); color: var(--text); }
  .page-btn:disabled { opacity: 0.4; cursor: not-allowed; }
  .page-info { color: var(--text-muted); font-size: 0.9rem; }
  .clear-filter { display: inline-flex; align-items: center; gap: 0.4rem; padding: 0.25rem 0.6rem; background: var(--surface-2); border: 1px solid var(--border); border-radius: 999px; color: var(--text-muted); font-size: 0.8rem; text-decoration: none; margin-left: 0.5rem; }
  .clear-filter:hover { border-color: var(--accent); color: var(--accent); }
</style>

<div class="page">
  <div class="header">
    <div>
      <h2>
        🎬 Videos
        {#if monthFilter}
          <a class="clear-filter" href="/videos">✕ {monthFilter}</a>
        {/if}
      </h2>
      {#if !loading}<span class="count">{total} video{total !== 1 ? 's' : ''}</span>{/if}
    </div>
    <div class="header-actions">
      {#if assets.length > 0}
        <button class="select-btn" class:active={selectMode} on:click={toggleSelectMode}>
          {selectMode ? 'Cancel' : 'Select'}
        </button>
      {/if}
    </div>
  </div>

  {#if selectMode && assets.length > 0}
    <div class="select-toolbar">
      <span class="sel-count">{selected.size} selected</span>
      <button class="tb-btn" on:click={() => { selected = new Set(assets.map(a => a.id)); }}>Select All</button>
      <button class="tb-btn" on:click={() => selected = new Set()}>Clear</button>
      <button class="tb-btn primary" on:click={downloadSelected} disabled={selected.size === 0 || downloading}>
        {downloading ? 'Downloading…' : `⬇ Download (${selected.size})`}
      </button>
      <button class="tb-btn danger" on:click={deleteSelected} disabled={selected.size === 0 || deleting}>
        {deleting ? 'Moving to trash…' : `🗑 Delete (${selected.size})`}
      </button>
    </div>
  {/if}

  {#if loading}
    <div class="loading">Loading videos...</div>
  {:else if error}
    <div class="error-msg">{error}</div>
  {:else if assets.length === 0}
    <div class="empty">
      {#if monthFilter}
        <p>No videos found for {monthFilter}.</p>
        <p style="margin-top:0.5rem"><a href="/videos" style="color:var(--accent)">View all videos</a></p>
      {:else}
        <p>No videos yet. Upload some video files to see them here.</p>
      {/if}
    </div>
  {:else}
    <div class="grid">
      {#each assets as asset, i (asset.id)}
        <div class="tile" class:selected={selected.has(asset.id)}
          on:click={() => onTileClick(asset, i)} role="button" tabindex="0"
          on:keydown={(e) => e.key === 'Enter' && onTileClick(asset, i)}>
          {#if asset.thumbnailSmallPath}
            <img src={api.assets.thumbnailUrl(asset.id, asset.updatedAt)} alt={asset.fileName} loading="lazy" />
            <div class="video-icon">▶</div>
          {:else}
            <div class="placeholder-video">🎬</div>
          {/if}
          {#if selectMode}
            <div class="check-badge" class:checked={selected.has(asset.id)}>
              {#if selected.has(asset.id)}&#10003;{/if}
            </div>
          {/if}
          <span class="video-badge">VIDEO</span>
          {#if asset.duration}
            <span class="duration-badge">{formatDuration(asset.duration)}</span>
          {/if}
          <div class="overlay">
            <div class="overlay-name">{asset.fileName}</div>
            <div class="overlay-meta">{formatSize(asset.fileSizeBytes)} · {formatDate(asset.fileCreatedAt)}</div>
          </div>
        </div>
      {/each}
    </div>

    {#if totalPages > 1}
      <div class="pagination">
        <button class="page-btn" disabled={pgNum <= 1} on:click={() => { pgNum--; loadVideos(); }}>← Previous</button>
        <span class="page-info">Page {pgNum} of {totalPages}</span>
        <button class="page-btn" disabled={pgNum >= totalPages} on:click={() => { pgNum++; loadVideos(); }}>Next →</button>
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
