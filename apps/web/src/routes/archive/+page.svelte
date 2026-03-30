<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { api } from '$lib/api';
  import { isAuthenticated } from '$lib/stores';
  import type { Asset } from '$lib/api';
  import PhotoViewer from '$lib/PhotoViewer.svelte';

  let assets: Asset[] = [];
  let loading = true;
  let error = '';
  let page = 1;
  let total = 0;
  const limit = 50;
  $: totalPages = Math.ceil(total / limit);

  let viewerIndex = -1;
  let selectMode = false;
  let selected = new Set<string>();
  let downloading = false;
  let deleting = false;
  let unarchiving = false;

  onMount(async () => {
    if (!$isAuthenticated) { goto('/'); return; }
    await load();
  });

  async function load() {
    loading = true; error = '';
    try { const r = await api.assets.listArchived(page, limit); assets = r.assets; total = r.total; }
    catch (e) { error = e instanceof Error ? e.message : 'Failed to load'; }
    finally { loading = false; }
  }

  function handleAssetUpdated(e: CustomEvent<Asset>) {
    if (!e.detail.isArchived) {
      assets = assets.filter(a => a.id !== e.detail.id);
      total--;
      viewerIndex = -1;
    } else {
      assets = assets.map(a => a.id === e.detail.id ? e.detail : a);
    }
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

  function onTileClick(asset: Asset, i: number) {
    if (selectMode) { toggleSelect(asset.id); }
    else { viewerIndex = i; }
  }

  async function downloadSelected() {
    if (!selected.size) return;
    downloading = true;
    try { await api.assets.downloadZip([...selected]); }
    catch { alert('Download failed'); }
    finally { downloading = false; }
  }

  async function unarchiveSelected() {
    if (!selected.size) return;
    unarchiving = true;
    try {
      await Promise.all([...selected].map(id => api.assets.toggleArchive(id)));
      assets = assets.filter(a => !selected.has(a.id));
      total -= selected.size;
      selected = new Set();
    } catch { alert('Unarchive failed'); }
    finally { unarchiving = false; }
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
    } catch { alert('Delete failed'); }
    finally { deleting = false; }
  }

  function imgError(e: Event) {
    const el = e.currentTarget as HTMLImageElement;
    el.style.display = 'none';
    const next = el.nextElementSibling as HTMLElement;
    if (next) next.style.removeProperty('display');
  }
  function formatDate(d: string) {
    return new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  }
  function formatSize(b: string) {
    const n = parseInt(b, 10);
    return n < 1048576 ? `${(n/1024).toFixed(1)} KB` : `${(n/1048576).toFixed(1)} MB`;
  }
</script>

<style>
  .page { padding: 1.5rem; max-width: 1600px; margin: 0 auto; }
  .header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.5rem; flex-wrap: wrap; gap: 0.5rem; }
  h2 { font-size: 1.5rem; font-weight: 700; }
  .count { color: var(--text-muted); font-size: 0.9rem; }
  .note { color: var(--text-muted); font-size: 0.85rem; margin-bottom: 1.5rem; }
  .header-actions { display: flex; gap: 0.5rem; }
  .select-btn { padding: 0.5rem 1rem; background: var(--surface); border: 1px solid var(--border); border-radius: 8px; color: var(--text-muted); font-size: 0.9rem; font-weight: 600; cursor: pointer; }
  .select-btn.active { background: var(--accent); border-color: var(--accent); color: #fff; }
  .select-toolbar { display: flex; align-items: center; gap: 0.75rem; padding: 0.6rem 1rem; background: var(--surface); border: 1px solid var(--border); border-radius: 8px; margin-bottom: 1rem; flex-wrap: wrap; }
  .sel-count { font-size: 0.9rem; font-weight: 600; color: var(--text); }
  .tb-btn { padding: 0.4rem 0.8rem; border-radius: 6px; border: 1px solid var(--border); background: var(--surface-2); color: var(--text-muted); font-size: 0.85rem; font-weight: 500; cursor: pointer; }
  .tb-btn:hover { border-color: var(--accent); color: var(--accent); }
  .tb-btn.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
  .tb-btn.primary:hover { background: var(--accent-hover); }
  .tb-btn.danger { border-color: var(--error, #ef4444); color: var(--error, #ef4444); }
  .tb-btn.danger:hover { background: var(--error, #ef4444); color: #fff; }
  .tb-btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .loading, .error-msg, .empty { text-align: center; padding: 4rem 2rem; color: var(--text-muted); }
  .error-msg { color: var(--error); }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 4px; }
  .tile { aspect-ratio: 1; overflow: hidden; border-radius: 4px; background: var(--surface-2); position: relative; cursor: pointer; }
  .tile.selected { outline: 3px solid var(--accent); }
  .tile img { width: 100%; height: 100%; object-fit: cover; display: block; transition: transform 0.2s; }
  .tile:hover img { transform: scale(1.03); }
  .tile:hover .overlay { opacity: 1; }
  .overlay { position: absolute; inset: 0; background: linear-gradient(to top, rgba(0,0,0,0.7) 0%, transparent 50%); opacity: 0; transition: opacity 0.2s; display: flex; flex-direction: column; justify-content: flex-end; padding: 0.4rem; pointer-events: none; }
  .tile.selected .overlay { opacity: 1; }
  .info { font-size: 0.75rem; color: #fff; }
  .name { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .meta { color: #ccc; }
  .broken { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; font-size: 2rem; color: var(--border-2); }
  .check-badge { position: absolute; top: 0.4rem; left: 0.4rem; width: 22px; height: 22px; border-radius: 50%; border: 2px solid #fff; background: rgba(0,0,0,0.4); display: flex; align-items: center; justify-content: center; font-size: 0.75rem; color: #fff; }
  .check-badge.checked { background: var(--accent); border-color: var(--accent); }
  .pagination { display: flex; align-items: center; justify-content: center; gap: 1rem; margin-top: 2rem; }
  .page-btn { padding: 0.4rem 0.8rem; background: var(--surface); border: 1px solid var(--border); border-radius: 6px; color: var(--text-muted); font-size: 0.9rem; cursor: pointer; }
  .page-btn:hover:not(:disabled) { border-color: var(--border-2); color: var(--text); }
  .page-btn:disabled { opacity: 0.4; cursor: not-allowed; }
  .page-info { color: var(--text-muted); font-size: 0.9rem; }
</style>

<div class="page">
  <div class="header">
    <div>
      <h2>Archive</h2>
      {#if !loading && total > 0}<span class="count">{total.toLocaleString()} items</span>{/if}
    </div>
    <div class="header-actions">
      {#if assets.length > 0}
        <button class="select-btn" class:active={selectMode} on:click={toggleSelectMode}>
          {selectMode ? 'Cancel' : 'Select'}
        </button>
      {/if}
    </div>
  </div>
  <p class="note">Archived photos are hidden from the main timeline but not deleted.</p>

  {#if selectMode && assets.length > 0}
    <div class="select-toolbar">
      <span class="sel-count">{selected.size} selected</span>
      <button class="tb-btn" on:click={() => selected = new Set(assets.map(a => a.id))}>Select All</button>
      <button class="tb-btn" on:click={() => selected = new Set()}>Clear</button>
      <button class="tb-btn" on:click={unarchiveSelected} disabled={selected.size === 0 || unarchiving}>
        {unarchiving ? 'Unarchiving…' : `↩ Unarchive (${selected.size})`}
      </button>
      <button class="tb-btn primary" on:click={downloadSelected} disabled={selected.size === 0 || downloading}>
        {downloading ? 'Downloading…' : `⬇ Download (${selected.size})`}
      </button>
      <button class="tb-btn danger" on:click={deleteSelected} disabled={selected.size === 0 || deleting}>
        {deleting ? 'Moving to trash…' : `🗑 Delete (${selected.size})`}
      </button>
    </div>
  {/if}

  {#if loading}
    <div class="loading">Loading archive...</div>
  {:else if error}
    <div class="error-msg">{error}</div>
  {:else if assets.length === 0}
    <div class="empty">No archived photos. Archive a photo from the gallery to hide it from the timeline.</div>
  {:else}
    <div class="grid">
      {#each assets as asset, i (asset.id)}
        <div class="tile" class:selected={selected.has(asset.id)}
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
          <div class="overlay">
            <div class="info">
              <div class="name">{asset.fileName}</div>
              <div class="meta">{formatSize(asset.fileSizeBytes)} &middot; {formatDate(asset.fileCreatedAt)}</div>
            </div>
          </div>
        </div>
      {/each}
    </div>
    {#if totalPages > 1}
      <div class="pagination">
        <button class="page-btn" on:click={() => { page--; load(); }} disabled={page <= 1}>&larr; Previous</button>
        <span class="page-info">Page {page} of {totalPages}</span>
        <button class="page-btn" on:click={() => { page++; load(); }} disabled={page >= totalPages}>Next &rarr;</button>
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
