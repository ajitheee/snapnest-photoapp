<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { api } from '$lib/api';
  import { isAuthenticated } from '$lib/stores';
  import type { Asset } from '$lib/api';

  let assets: Asset[] = [];
  let loading = true;
  let error = '';
  let page = 1;
  let total = 0;
  const limit = 50;
  $: totalPages = Math.ceil(total / limit);

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

  async function unarchive(asset: Asset) {
    await api.assets.toggleArchive(asset.id);
    assets = assets.filter(a => a.id !== asset.id); total--;
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
  .page { padding: 1.5rem; max-width: 1600px; margin: 0 auto; }
  .header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.5rem; }
  h2 { font-size: 1.5rem; font-weight: 700; }
  .count { color: #666; font-size: 0.9rem; }
  .note { color: #666; font-size: 0.85rem; margin-bottom: 1.5rem; }
  .loading, .error-msg, .empty { text-align: center; padding: 4rem 2rem; color: #666; }
  .error-msg { color: #f87171; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 4px; }
  .tile { aspect-ratio: 1; overflow: hidden; border-radius: 4px; background: #1a1a1a; position: relative; cursor: pointer; }
  .tile img { width: 100%; height: 100%; object-fit: cover; display: block; transition: transform 0.2s; }
  .tile:hover img { transform: scale(1.03); }
  .tile:hover .overlay { opacity: 1; }
  .overlay { position: absolute; inset: 0; background: linear-gradient(to top, rgba(0,0,0,0.7) 0%, transparent 50%); opacity: 0; transition: opacity 0.2s; display: flex; flex-direction: column; justify-content: space-between; padding: 0.4rem; }
  .actions { display: flex; gap: 0.3rem; justify-content: flex-end; }
  .action-btn { background: rgba(0,0,0,0.6); border: none; border-radius: 4px; color: #fff; padding: 3px 7px; font-size: 0.85rem; cursor: pointer; }
  .action-btn:hover { background: rgba(0,0,0,0.85); }
  .info { font-size: 0.75rem; color: #fff; }
  .name { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .meta { color: #ccc; }
  .broken { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; font-size: 2rem; color: #333; }
  .pagination { display: flex; align-items: center; justify-content: center; gap: 1rem; margin-top: 2rem; }
  .page-btn { padding: 0.4rem 0.8rem; background: #1a1a1a; border: 1px solid #333; border-radius: 6px; color: #aaa; font-size: 0.9rem; }
  .page-btn:hover:not(:disabled) { border-color: #555; color: #fff; }
  .page-btn:disabled { opacity: 0.4; cursor: not-allowed; }
  .page-info { color: #666; font-size: 0.9rem; }
</style>

<div class="page">
  <div class="header">
    <div>
      <h2>Archive</h2>
      {#if !loading && total > 0}<span class="count">{total.toLocaleString()} items</span>{/if}
    </div>
  </div>
  <p class="note">Archived photos are hidden from the main timeline but not deleted.</p>

  {#if loading}
    <div class="loading">Loading archive...</div>
  {:else if error}
    <div class="error-msg">{error}</div>
  {:else if assets.length === 0}
    <div class="empty">No archived photos. Archive a photo from the gallery to hide it from the timeline.</div>
  {:else}
    <div class="grid">
      {#each assets as asset (asset.id)}
        <div class="tile">
          {#if asset.type !== 'OTHER'}
            <img src={api.assets.thumbnailUrl(asset.id)} alt={asset.fileName} loading="lazy"
              on:error={(e) => imgError(e)} />
            <div class="broken" style="display:none">&#128247;</div>
          {:else}
            <div class="broken">&#128196;</div>
          {/if}
          <div class="overlay">
            <div class="actions">
              <button class="action-btn" on:click|stopPropagation={() => unarchive(asset)}>Unarchive</button>
            </div>
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
