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

  onMount(async () => {
    if (!$isAuthenticated) { goto('/'); return; }
    await load();
  });

  async function load() {
    loading = true; error = '';
    try { const r = await api.assets.listFavorites(page, limit); assets = r.assets; total = r.total; }
    catch (e) { error = e instanceof Error ? e.message : 'Failed to load'; }
    finally { loading = false; }
  }

  function handleAssetUpdated(e: CustomEvent<Asset>) {
    // If favorite was toggled off, remove from this list
    if (!e.detail.isFavorite) {
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
  .header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 1.5rem; }
  h2 { font-size: 1.5rem; font-weight: 700; }
  .count { color: var(--text-muted); font-size: 0.9rem; }
  .loading, .error-msg, .empty { text-align: center; padding: 4rem 2rem; color: var(--text-muted); }
  .error-msg { color: var(--error); }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 4px; }
  .tile { aspect-ratio: 1; overflow: hidden; border-radius: 4px; background: var(--surface-2); position: relative; cursor: pointer; }
  .tile img { width: 100%; height: 100%; object-fit: cover; display: block; transition: transform 0.2s; }
  .tile:hover img { transform: scale(1.03); }
  .tile:hover .overlay { opacity: 1; }
  .overlay { position: absolute; inset: 0; background: linear-gradient(to top, rgba(0,0,0,0.7) 0%, transparent 50%); opacity: 0; transition: opacity 0.2s; display: flex; flex-direction: column; justify-content: flex-end; padding: 0.4rem; pointer-events: none; }
  .info { font-size: 0.75rem; color: #fff; }
  .name { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .meta { color: #ccc; }
  .broken { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; font-size: 2rem; color: var(--border-2); }
  .pagination { display: flex; align-items: center; justify-content: center; gap: 1rem; margin-top: 2rem; }
  .page-btn { padding: 0.4rem 0.8rem; background: var(--surface); border: 1px solid var(--border); border-radius: 6px; color: var(--text-muted); font-size: 0.9rem; }
  .page-btn:hover:not(:disabled) { border-color: var(--border-2); color: var(--text); }
  .page-btn:disabled { opacity: 0.4; cursor: not-allowed; }
  .page-info { color: var(--text-muted); font-size: 0.9rem; }
</style>

<div class="page">
  <div class="header">
    <div>
      <h2>Favorites</h2>
      {#if !loading && total > 0}<span class="count">{total.toLocaleString()} items</span>{/if}
    </div>
  </div>

  {#if loading}
    <div class="loading">Loading favorites...</div>
  {:else if error}
    <div class="error-msg">{error}</div>
  {:else if assets.length === 0}
    <div class="empty">No favorites yet. Open a photo and tap the heart to add it here.</div>
  {:else}
    <div class="grid">
      {#each assets as asset, i (asset.id)}
        <div class="tile" on:click={() => viewerIndex = i} role="button" tabindex="0"
          on:keydown={(e) => e.key === 'Enter' && (viewerIndex = i)}>
          {#if asset.type !== 'OTHER'}
            <img src={api.assets.thumbnailUrl(asset.id, asset.updatedAt)} alt={asset.fileName} loading="lazy"
              on:error={(e) => imgError(e)} />
            <div class="broken" style="display:none">&#128247;</div>
          {:else}
            <div class="broken">&#128196;</div>
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
