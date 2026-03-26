<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { page as pageStore } from '$app/stores';
  import { api } from '$lib/api';
  import { isAuthenticated } from '$lib/stores';
  import type { Album, Asset } from '$lib/api';

  $: albumId = $pageStore.params.id;

  let album: Album | null = null;
  let loading = true;
  let error = '';
  let showAddPhotos = false;
  let allAssets: Asset[] = [];
  let selectedIds = new Set<string>();
  let adding = false;

  onMount(async () => {
    if (!$isAuthenticated) { goto('/'); return; }
    await loadAlbum();
  });

  async function loadAlbum() {
    loading = true; error = '';
    try { album = await api.albums.get(albumId); }
    catch (e) { error = e instanceof Error ? e.message : 'Failed to load'; }
    finally { loading = false; }
  }

  async function openAddPhotos() {
    showAddPhotos = true; selectedIds = new Set();
    const r = await api.assets.list(1, 200);
    const albumAssetIds = new Set((album?.assets || []).map(aa => aa.asset.id));
    allAssets = r.assets.filter(a => !albumAssetIds.has(a.id));
  }

  async function confirmAdd() {
    if (!selectedIds.size) return;
    adding = true;
    try {
      album = await api.albums.addAssets(albumId, [...selectedIds]);
      showAddPhotos = false;
    } finally { adding = false; }
  }

  async function removeAsset(assetId: string) {
    album = await api.albums.removeAssets(albumId, [assetId]);
  }

  async function setCover(assetId: string) {
    album = await api.albums.update(albumId, { coverAssetId: assetId });
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
  .header { display: flex; align-items: center; gap: 1rem; margin-bottom: 1.5rem; flex-wrap: wrap; }
  .back { color: #4f8ef7; text-decoration: none; font-size: 0.9rem; }
  h2 { font-size: 1.5rem; font-weight: 700; flex: 1; }
  .count { color: #666; font-size: 0.9rem; }
  .add-btn { padding: 0.5rem 1rem; background: #4f8ef7; border: none; border-radius: 8px; color: #fff; font-size: 0.9rem; font-weight: 600; }
  .add-btn:hover { background: #3a7de8; }
  .loading, .error-msg, .empty { text-align: center; padding: 4rem 2rem; color: #666; }
  .error-msg { color: #f87171; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 4px; }
  .tile { aspect-ratio: 1; overflow: hidden; border-radius: 4px; background: #1a1a1a; position: relative; cursor: pointer; }
  .tile img { width: 100%; height: 100%; object-fit: cover; display: block; transition: transform 0.2s; }
  .tile:hover img { transform: scale(1.03); }
  .tile:hover .overlay { opacity: 1; }
  .overlay { position: absolute; inset: 0; background: linear-gradient(to top, rgba(0,0,0,0.8) 0%, transparent 50%); opacity: 0; transition: opacity 0.2s; display: flex; flex-direction: column; justify-content: space-between; padding: 0.4rem; }
  .actions { display: flex; gap: 0.3rem; justify-content: flex-end; }
  .action-btn { background: rgba(0,0,0,0.6); border: none; border-radius: 4px; color: #fff; padding: 3px 7px; font-size: 0.75rem; cursor: pointer; }
  .action-btn:hover { background: rgba(0,0,0,0.85); }
  .action-btn.danger:hover { background: rgba(200,50,50,0.8); }
  .info { font-size: 0.75rem; color: #fff; }
  .name { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .meta { color: #ccc; }
  .broken { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; font-size: 2rem; color: #333; }
  /* Add photos modal */
  .modal-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.7); z-index: 100; display: flex; align-items: center; justify-content: center; padding: 1rem; }
  .modal { background: #111; border: 1px solid #333; border-radius: 12px; padding: 1.5rem; max-width: 900px; width: 100%; max-height: 80vh; display: flex; flex-direction: column; gap: 1rem; }
  .modal h3 { font-size: 1.1rem; font-weight: 700; }
  .modal-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 4px; overflow-y: auto; flex: 1; }
  .select-tile { aspect-ratio: 1; border-radius: 4px; background: #1a1a1a; position: relative; cursor: pointer; overflow: hidden; }
  .select-tile img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .select-tile.selected { outline: 3px solid #4f8ef7; }
  .check { position: absolute; top: 4px; right: 4px; width: 20px; height: 20px; background: #4f8ef7; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 0.75rem; color: #fff; }
  .modal-actions { display: flex; gap: 0.5rem; justify-content: flex-end; }
  .btn-cancel { padding: 0.4rem 0.8rem; background: #222; border: 1px solid #444; border-radius: 6px; color: #aaa; font-size: 0.9rem; }
  .btn-add { padding: 0.4rem 0.8rem; background: #4f8ef7; border: none; border-radius: 6px; color: #fff; font-size: 0.9rem; font-weight: 600; }
  .btn-add:disabled { opacity: 0.5; cursor: not-allowed; }
</style>

<div class="page">
  <div class="header">
    <a class="back" href="/albums">&larr; Albums</a>
    {#if album}
      <h2>{album.name}</h2>
      <span class="count">{album._count?.assets ?? album.assets?.length ?? 0} photos</span>
      <button class="add-btn" on:click={openAddPhotos}>+ Add Photos</button>
    {/if}
  </div>

  {#if loading}
    <div class="loading">Loading album...</div>
  {:else if error}
    <div class="error-msg">{error}</div>
  {:else if !album}
    <div class="error-msg">Album not found.</div>
  {:else if !album.assets || album.assets.length === 0}
    <div class="empty">
      <p>No photos in this album yet.</p>
      <p style="margin-top:0.5rem"><button class="add-btn" on:click={openAddPhotos}>+ Add Photos</button></p>
    </div>
  {:else}
    <div class="grid">
      {#each album.assets as aa (aa.asset.id)}
        <div class="tile">
          {#if aa.asset.type !== 'OTHER'}
            <img src={api.assets.thumbnailUrl(aa.asset.id)} alt={aa.asset.fileName} loading="lazy"
              on:error={(e) => imgError(e)} />
            <div class="broken" style="display:none">&#128247;</div>
          {:else}
            <div class="broken">&#128196;</div>
          {/if}
          <div class="overlay">
            <div class="actions">
              <button class="action-btn" on:click|stopPropagation={() => setCover(aa.asset.id)}>Set Cover</button>
              <button class="action-btn danger" on:click|stopPropagation={() => removeAsset(aa.asset.id)}>Remove</button>
            </div>
            <div class="info">
              <div class="name">{aa.asset.fileName}</div>
              <div class="meta">{formatSize(aa.asset.fileSizeBytes)} &middot; {formatDate(aa.asset.fileCreatedAt)}</div>
            </div>
          </div>
        </div>
      {/each}
    </div>
  {/if}
</div>

{#if showAddPhotos}
  <div class="modal-backdrop" on:click|self={() => showAddPhotos = false} role="dialog" aria-modal="true">
    <div class="modal">
      <h3>Add Photos — {selectedIds.size} selected</h3>
      <div class="modal-grid">
        {#each allAssets as asset (asset.id)}
          <div class="select-tile" class:selected={selectedIds.has(asset.id)}
            on:click={() => { if (selectedIds.has(asset.id)) { selectedIds.delete(asset.id); selectedIds = selectedIds; } else { selectedIds.add(asset.id); selectedIds = selectedIds; } }}
            role="checkbox" aria-checked={selectedIds.has(asset.id)} tabindex="0"
            on:keydown={(e) => e.key === ' ' && e.currentTarget.click()}>
            {#if asset.type !== 'OTHER'}
              <img src={api.assets.thumbnailUrl(asset.id)} alt={asset.fileName} loading="lazy" />
            {:else}
              <div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:1.5rem;color:#333">&#128196;</div>
            {/if}
            {#if selectedIds.has(asset.id)}<div class="check">&#10003;</div>{/if}
          </div>
        {/each}
      </div>
      <div class="modal-actions">
        <button class="btn-cancel" on:click={() => showAddPhotos = false}>Cancel</button>
        <button class="btn-add" on:click={confirmAdd} disabled={adding || !selectedIds.size}>
          {adding ? 'Adding...' : `Add ${selectedIds.size} Photo${selectedIds.size !== 1 ? 's' : ''}`}
        </button>
      </div>
    </div>
  </div>
{/if}
