<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { page as pageStore } from '$app/stores';
  import { api } from '$lib/api';
  import { isAuthenticated } from '$lib/stores';
  import type { Album, Asset } from '$lib/api';
  import PhotoViewer from '$lib/PhotoViewer.svelte';

  $: albumId = $pageStore.params.id;

  let album: Album | null = null;
  let loading = true;
  let error = '';
  let showAddPhotos = false;
  let allAssets: Asset[] = [];
  let selectedIds = new Set<string>();
  let adding = false;
  let downloading = false;

  // Share modal state
  let showShare = false;
  let shareList: { sharedWithEmail: string; createdAt: string }[] = [];
  let shareEmail = '';
  let sharing = false;
  let shareError = '';
  let loadingShares = false;

  // Flat asset list extracted from album for the viewer
  $: viewerAssets = (album?.assets || []).map(aa => aa.asset);
  let viewerIndex = -1;

  onMount(async () => {
    if (!$isAuthenticated) { goto('/'); return; }
    await loadAlbum();
  });

  async function loadAlbum(silent = false) {
    if (!silent) { loading = true; error = ''; }
    try { album = await api.albums.get(albumId); }
    catch (e) { if (!silent) error = e instanceof Error ? e.message : 'Failed to load'; }
    finally { if (!silent) loading = false; }
  }

  async function openAddPhotos() {
    showAddPhotos = true; selectedIds = new Set();
    const albumAssetIds = new Set((album?.assets || []).map(aa => aa.asset.id));
    const fetched: Asset[] = [];
    let p = 1;
    while (true) {
      const r = await api.assets.list(p, 500);
      fetched.push(...r.assets);
      if (fetched.length >= r.total) break;
      p++;
    }
    allAssets = fetched.filter(a => !albumAssetIds.has(a.id));
  }

  async function confirmAdd() {
    if (!selectedIds.size) return;
    adding = true;
    try {
      album = await api.albums.addAssets(albumId, [...selectedIds]);
      showAddPhotos = false;
    } finally { adding = false; }
  }

  async function downloadAlbum() {
    if (!album) return;
    downloading = true;
    try { await api.albums.downloadZip(albumId, album.name); }
    catch (e) { alert('Download failed'); }
    finally { downloading = false; }
  }

  async function removeAsset(assetId: string) {
    if (album) {
      album = {
        ...album,
        assets: (album.assets || []).filter(aa => aa.asset.id !== assetId),
        _count: album._count ? { assets: Math.max(0, (album._count.assets ?? 1) - 1) } : album._count,
      };
    }
    try {
      album = await api.albums.removeAssets(albumId, [assetId]);
    } catch {
      await loadAlbum();
    }
  }

  async function setCover(assetId: string) {
    album = await api.albums.update(albumId, { coverAssetId: assetId });
  }

  function handleViewerRemoved(e: CustomEvent<string>) {
    if (!album?.assets) return;
    const filtered = album.assets.filter(aa => aa.asset.id !== e.detail);
    album = {
      ...album,
      assets: filtered,
      _count: album._count ? { assets: filtered.length } : album._count,
    };
    loadAlbum(true);
  }

  function handleViewerUpdated(e: CustomEvent<Asset>) {
    if (!album?.assets) return;
    album = {
      ...album,
      assets: album.assets.map(aa => aa.asset.id === e.detail.id ? { ...aa, asset: e.detail } : aa),
    };
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

  async function openShareModal() {
    showShare = true; shareEmail = ''; shareError = '';
    loadingShares = true;
    try { shareList = await api.albums.getShares(albumId); }
    catch (_) { shareList = []; }
    finally { loadingShares = false; }
  }

  async function addShare() {
    const email = shareEmail.trim().toLowerCase();
    if (!email || sharing) return;
    sharing = true; shareError = '';
    try {
      await api.albums.shareWithEmail(albumId, email);
      shareList = [...shareList, { sharedWithEmail: email, createdAt: new Date().toISOString() }];
      shareEmail = '';
    } catch (e) {
      shareError = e instanceof Error ? e.message : 'Failed to share';
    } finally { sharing = false; }
  }

  async function removeShare(email: string) {
    try {
      await api.albums.unshareWithEmail(albumId, email);
      shareList = shareList.filter(s => s.sharedWithEmail !== email);
    } catch (_) {}
  }
</script>

<style>
  .page { padding: 1.5rem; max-width: 1600px; margin: 0 auto; }
  .header { display: flex; align-items: center; gap: 1rem; margin-bottom: 1.5rem; flex-wrap: wrap; }
  .back { color: var(--accent); text-decoration: none; font-size: 0.9rem; }
  h2 { font-size: 1.5rem; font-weight: 700; flex: 1; }
  .count { color: var(--text-muted); font-size: 0.9rem; }
  .add-btn { padding: 0.5rem 1rem; background: var(--accent); border: none; border-radius: 8px; color: #fff; font-size: 0.9rem; font-weight: 600; }
  .add-btn:hover { background: var(--accent-hover); }
  .dl-btn { padding: 0.5rem 1rem; background: var(--surface); border: 1px solid var(--border); border-radius: 8px; color: var(--text-muted); font-size: 0.9rem; font-weight: 600; }
  .dl-btn:hover { border-color: var(--accent); color: var(--accent); }
  .dl-btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .share-btn { display: flex; align-items: center; gap: 0.4rem; padding: 0.5rem 0.9rem; background: var(--surface); border: 1px solid var(--accent); border-radius: 8px; color: var(--accent); font-size: 0.9rem; font-weight: 600; transition: all 0.15s; }
  .share-btn:hover { background: var(--active-bg); }
  .loading, .error-msg, .empty { text-align: center; padding: 4rem 2rem; color: var(--text-muted); }
  .error-msg { color: var(--error); }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 4px; }
  .tile { aspect-ratio: 1; overflow: hidden; border-radius: 4px; background: var(--surface-2); position: relative; cursor: pointer; }
  .tile img { width: 100%; height: 100%; object-fit: cover; display: block; transition: transform 0.2s; }
  .tile:hover img { transform: scale(1.03); }
  .tile:hover .overlay { opacity: 1; }
  .overlay { position: absolute; inset: 0; background: linear-gradient(to top, rgba(0,0,0,0.8) 0%, transparent 50%); opacity: 0; transition: opacity 0.2s; display: flex; flex-direction: column; justify-content: space-between; padding: 0.4rem; }
  .tile:hover .overlay { opacity: 1; }
  .actions { display: flex; gap: 0.3rem; justify-content: flex-end; }
  .cover-badge { position: absolute; top: 0.3rem; left: 0.3rem; background: rgba(0,0,0,0.7); color: #fbbf24; font-size: 0.7rem; font-weight: 700; padding: 2px 6px; border-radius: 4px; pointer-events: none; }
  .action-btn { background: rgba(0,0,0,0.6); border: none; border-radius: 4px; color: #fff; padding: 3px 7px; font-size: 0.75rem; cursor: pointer; }
  .action-btn:hover { background: rgba(0,0,0,0.85); }
  .action-btn.danger:hover { background: rgba(200,50,50,0.8); }
  .info { font-size: 0.75rem; color: #fff; }
  .name { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .meta { color: #ccc; }
  .broken { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; font-size: 2rem; color: var(--border-2); }
  /* Add photos modal */
  .modal-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.7); z-index: 100; display: flex; align-items: center; justify-content: center; padding: 1rem; }
  .modal { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 1.5rem; max-width: 900px; width: 100%; max-height: 80vh; display: flex; flex-direction: column; gap: 1rem; }
  .modal h3 { font-size: 1.1rem; font-weight: 700; }
  .modal-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 4px; overflow-y: auto; flex: 1; }
  .select-tile { position: relative; padding-bottom: 100%; border-radius: 4px; background: var(--surface-2); cursor: pointer; overflow: hidden; }
  .select-tile img { position: absolute; top: 0; left: 0; width: 100%; height: 100%; object-fit: cover; display: block; }
  .select-tile.selected { outline: 3px solid var(--accent); }
  .check { position: absolute; top: 4px; right: 4px; width: 20px; height: 20px; background: var(--accent); border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 0.75rem; color: #fff; }
  .modal-actions { display: flex; gap: 0.5rem; justify-content: flex-end; }
  .btn-cancel { padding: 0.4rem 0.8rem; background: var(--surface-2); border: 1px solid var(--border-2); border-radius: 6px; color: var(--text-muted); font-size: 0.9rem; }
  .btn-add { padding: 0.4rem 0.8rem; background: var(--accent); border: none; border-radius: 6px; color: #fff; font-size: 0.9rem; font-weight: 600; }
  .btn-add:disabled { opacity: 0.5; cursor: not-allowed; }

  /* Share modal */
  .share-modal { max-width: 440px; }
  .share-form { display: flex; gap: 0.5rem; margin-bottom: 1rem; }
  .share-input { flex: 1; background: var(--surface-2); border: 1px solid var(--border); border-radius: 6px; color: var(--text); padding: 0.45rem 0.75rem; font-size: 0.875rem; outline: none; }
  .share-input:focus { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-glow); }
  .share-add-btn { padding: 0.45rem 0.9rem; background: var(--accent); border: none; border-radius: 6px; color: #fff; font-size: 0.875rem; font-weight: 600; white-space: nowrap; }
  .share-add-btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .share-error { color: var(--error); font-size: 0.8rem; margin-bottom: 0.75rem; }
  .share-list { display: flex; flex-direction: column; gap: 0.4rem; max-height: 220px; overflow-y: auto; }
  .share-empty { color: var(--text-muted); font-size: 0.85rem; text-align: center; padding: 1rem 0; }
  .share-item { display: flex; align-items: center; gap: 0.6rem; padding: 0.5rem 0.6rem; background: var(--surface-2); border-radius: 8px; }
  .share-avatar { width: 28px; height: 28px; border-radius: 50%; background: linear-gradient(135deg, var(--accent) 0%, #8b5cf6 100%); display: flex; align-items: center; justify-content: center; font-size: 0.72rem; font-weight: 700; color: #fff; flex-shrink: 0; }
  .share-email { flex: 1; font-size: 0.85rem; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .share-date { font-size: 0.72rem; color: var(--text-subtle); flex-shrink: 0; }
  .share-remove { background: none; border: none; color: var(--text-subtle); font-size: 0.75rem; padding: 2px 6px; border-radius: 4px; cursor: pointer; flex-shrink: 0; }
  .share-remove:hover { color: var(--error); background: rgba(239,68,68,0.08); }
  .share-section-label { font-size: 0.72rem; font-weight: 700; color: var(--text-subtle); text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 0.5rem; }
</style>

<div class="page">
  <div class="header">
    <a class="back" href="/albums">&larr; Albums</a>
    {#if album}
      <h2>{album.name}</h2>
      <span class="count">{album._count?.assets ?? album.assets?.length ?? 0} photos</span>
      <button class="add-btn" on:click={openAddPhotos}>+ Add Photos</button>
      {#if album.assets && album.assets.length > 0}
        <button class="dl-btn" on:click={downloadAlbum} disabled={downloading}>
          {downloading ? 'Downloading…' : '⬇ Download All'}
        </button>
      {/if}
      <button class="share-btn" on:click={openShareModal}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" x2="15.42" y1="13.51" y2="17.49"/><line x1="15.41" x2="8.59" y1="6.51" y2="10.49"/></svg>
        Share
      </button>
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
      {#each album.assets as aa, i (aa.asset.id)}
        <div class="tile" on:click={() => viewerIndex = i} role="button" tabindex="0"
          on:keydown={(e) => e.key === 'Enter' && (viewerIndex = i)}>
          {#if aa.asset.type !== 'OTHER'}
            <img src={api.assets.thumbnailUrl(aa.asset.id)} alt={aa.asset.fileName} loading="lazy"
              on:error={(e) => imgError(e)} />
            <div class="broken" style="display:none">&#128247;</div>
          {:else}
            <div class="broken">&#128196;</div>
          {/if}
          {#if aa.asset.id === album?.coverAssetId}
            <div class="cover-badge">★ Cover</div>
          {/if}
          <div class="overlay">
            <div class="actions">
              {#if aa.asset.id !== album?.coverAssetId}
                <button class="action-btn" on:click|stopPropagation={() => setCover(aa.asset.id)}>★ Set Cover</button>
              {/if}
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
              <img src={api.assets.thumbnailUrl(asset.id, asset.updatedAt)} alt={asset.fileName} />
            {:else}
              <div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:1.5rem;color:var(--border-2)">&#128196;</div>
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

{#if showShare}
  <div class="modal-backdrop" on:click|self={() => showShare = false} role="dialog" aria-modal="true">
    <div class="modal share-modal">
      <h3>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline;vertical-align:middle;margin-right:6px"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" x2="15.42" y1="13.51" y2="17.49"/><line x1="15.41" x2="8.59" y1="6.51" y2="10.49"/></svg>
        Share "{album?.name}"
      </h3>
      <p style="font-size:0.82rem;color:var(--text-muted);margin:0.25rem 0 1rem">Share this album with other SnapNest users by email.</p>
      <div class="share-form">
        <input
          class="share-input"
          type="email"
          placeholder="Email address"
          bind:value={shareEmail}
          on:keydown={(e) => e.key === 'Enter' && addShare()}
        />
        <button class="share-add-btn" on:click={addShare} disabled={sharing || !shareEmail.trim()}>
          {sharing ? '...' : 'Add'}
        </button>
      </div>
      {#if shareError}<div class="share-error">{shareError}</div>{/if}
      <div class="share-section-label">Shared with</div>
      {#if loadingShares}
        <div class="share-empty">Loading...</div>
      {:else if shareList.length === 0}
        <div class="share-empty">Not shared with anyone yet.</div>
      {:else}
        <div class="share-list">
          {#each shareList as s (s.sharedWithEmail)}
            <div class="share-item">
              <div class="share-avatar">{s.sharedWithEmail[0].toUpperCase()}</div>
              <span class="share-email">{s.sharedWithEmail}</span>
              <span class="share-date">{new Date(s.createdAt).toLocaleDateString()}</span>
              <button class="share-remove" on:click={() => removeShare(s.sharedWithEmail)} title="Remove">✕</button>
            </div>
          {/each}
        </div>
      {/if}
      <div class="modal-actions" style="margin-top:1rem">
        <button class="btn-cancel" on:click={() => showShare = false}>Close</button>
      </div>
    </div>
  </div>
{/if}

<PhotoViewer
  bind:viewerIndex
  assets={viewerAssets}
  mode="default"
  on:assetUpdated={handleViewerUpdated}
  on:assetRemoved={handleViewerRemoved}
/>
