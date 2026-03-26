<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { api } from '$lib/api';
  import { isAuthenticated } from '$lib/stores';
  import type { Asset } from '$lib/api';
  import Hls from 'hls.js';

  let assets: Asset[] = [];
  let loading = true;
  let error = '';
  let page = 1;
  let total = 0;
  const limit = 50;
  $: totalPages = Math.ceil(total / limit);

  // Viewer state
  let viewerAsset: Asset | null = null;
  let viewerIndex = -1;

  // Zoom state
  let zoomScale = 1;
  let panX = 0;
  let panY = 0;
  let isPanning = false;
  let panStartX = 0;
  let panStartY = 0;
  // Pinch state
  let lastPinchDist = 0;

  function resetZoom() { zoomScale = 1; panX = 0; panY = 0; }

  function onWheel(e: WheelEvent) {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.85 : 1.18;
    zoomScale = Math.min(10, Math.max(1, zoomScale * delta));
    if (zoomScale === 1) { panX = 0; panY = 0; }
  }

  function onPanStart(e: MouseEvent) {
    if (zoomScale <= 1) return;
    isPanning = true;
    panStartX = e.clientX - panX;
    panStartY = e.clientY - panY;
  }
  function onPanMove(e: MouseEvent) {
    if (!isPanning) return;
    panX = e.clientX - panStartX;
    panY = e.clientY - panStartY;
  }
  function onPanEnd() { isPanning = false; }

  function onTouchStart(e: TouchEvent) {
    if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      lastPinchDist = Math.hypot(dx, dy);
    }
  }
  function onTouchMove(e: TouchEvent) {
    if (e.touches.length === 2) {
      e.preventDefault();
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.hypot(dx, dy);
      if (lastPinchDist > 0) {
        zoomScale = Math.min(10, Math.max(1, zoomScale * (dist / lastPinchDist)));
        if (zoomScale === 1) { panX = 0; panY = 0; }
      }
      lastPinchDist = dist;
    }
  }

  onMount(async () => {
    if (!$isAuthenticated) { goto('/'); return; }
    await loadAssets();
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

  async function toggleFavorite(asset: Asset) {
    const updated = await api.assets.toggleFavorite(asset.id);
    assets = assets.map(a => a.id === asset.id ? updated : a);
    if (viewerAsset?.id === asset.id) viewerAsset = updated;
  }

  async function archiveAsset(asset: Asset) {
    await api.assets.toggleArchive(asset.id);
    assets = assets.filter(a => a.id !== asset.id); total--;
    closeViewer();
  }

  async function trashAsset(asset: Asset) {
    await api.assets.softDelete(asset.id);
    assets = assets.filter(a => a.id !== asset.id); total--;
    closeViewer();
  }

  function openViewer(asset: Asset) {
    viewerAsset = asset;
    viewerIndex = assets.findIndex(a => a.id === asset.id);
  }
  function closeViewer() { viewerAsset = null; viewerIndex = -1; resetZoom(); }
  function viewerPrev() {
    if (viewerIndex > 0) { viewerIndex--; viewerAsset = assets[viewerIndex]; resetZoom(); }
  }
  function viewerNext() {
    if (viewerIndex < assets.length - 1) { viewerIndex++; viewerAsset = assets[viewerIndex]; resetZoom(); }
  }
  function onViewerKey(e: KeyboardEvent) {
    if (e.key === 'Escape') closeViewer();
    else if (e.key === 'ArrowLeft' && zoomScale === 1) viewerPrev();
    else if (e.key === 'ArrowRight' && zoomScale === 1) viewerNext();
  }

  async function prevPage() { if (page > 1) { page--; await loadAssets(); } }
  async function nextPage() { if (page < totalPages) { page++; await loadAssets(); } }

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
  function fullUrl(asset: Asset) {
    const token = typeof localStorage !== 'undefined' ? localStorage.getItem('photoapp_token') : null;
    const qs = token ? `?token=${encodeURIComponent(token)}&size=large` : '?size=large';
    return `/api/assets/${asset.id}/thumbnail${qs}`;
  }

  function hlsUrl(asset: Asset) {
    const token = typeof localStorage !== 'undefined' ? localStorage.getItem('photoapp_token') : null;
    const qs = token ? `?token=${encodeURIComponent(token)}` : '';
    return `/api/assets/${asset.id}/stream/master.m3u8${qs}`;
  }

  function hlsPlayer(node: HTMLVideoElement, src: string) {
    let hls: Hls | null = null;
    function init(s: string) {
      if (hls) { hls.destroy(); hls = null; }
      if (Hls.isSupported()) {
        hls = new Hls();
        hls.loadSource(s);
        hls.attachMedia(node);
      } else if (node.canPlayType('application/vnd.apple.mpegurl')) {
        node.src = s; // Safari native HLS
      }
    }
    init(src);
    return {
      update(s: string) { init(s); },
      destroy() { if (hls) { hls.destroy(); hls = null; } },
    };
  }
</script>

<svelte:window on:keydown={onViewerKey} />

<style>
  .page { padding: 1.5rem; max-width: 1600px; margin: 0 auto; }
  .header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 1.5rem; }
  h2 { font-size: 1.5rem; font-weight: 700; }
  .count { color: #666; font-size: 0.9rem; }
  .upload-btn { padding: 0.5rem 1rem; background: #4f8ef7; border: none; border-radius: 8px; color: #fff; font-size: 0.9rem; font-weight: 600; }
  .upload-btn:hover { background: #3a7de8; }
  .loading, .error-msg, .empty { text-align: center; padding: 4rem 2rem; color: #666; }
  .error-msg { color: #f87171; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 4px; }
  .asset-tile { aspect-ratio: 1; overflow: hidden; border-radius: 4px; background: #1a1a1a; position: relative; cursor: pointer; }
  .asset-tile:hover .overlay { opacity: 1; }
  .asset-tile img { width: 100%; height: 100%; object-fit: cover; display: block; transition: transform 0.2s; }
  .asset-tile:hover img { transform: scale(1.03); }
  .video-badge { position: absolute; top: 0.4rem; right: 0.4rem; background: rgba(0,0,0,0.7); border-radius: 4px; padding: 2px 6px; font-size: 0.7rem; color: #fff; }
  .overlay { position: absolute; inset: 0; background: linear-gradient(to top, rgba(0,0,0,0.7) 0%, transparent 50%); opacity: 0; transition: opacity 0.2s; display: flex; flex-direction: column; justify-content: space-between; padding: 0.4rem; }
  .tile-actions { display: flex; gap: 0.3rem; justify-content: flex-end; }
  .tile-btn { background: rgba(0,0,0,0.6); border: none; border-radius: 4px; color: #fff; padding: 3px 7px; font-size: 0.8rem; cursor: pointer; line-height: 1; }
  .tile-btn:hover { background: rgba(0,0,0,0.85); }
  .tile-btn.fav-active { color: #f472b6; }
  .overlay-info { font-size: 0.75rem; color: #fff; line-height: 1.3; }
  .overlay-name { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .overlay-size { color: #ccc; }
  .broken { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; font-size: 2rem; color: #333; }
  .pagination { display: flex; align-items: center; justify-content: center; gap: 1rem; margin-top: 2rem; }
  .page-btn { padding: 0.4rem 0.8rem; background: #1a1a1a; border: 1px solid #333; border-radius: 6px; color: #aaa; font-size: 0.9rem; }
  .page-btn:hover:not(:disabled) { border-color: #555; color: #fff; }
  .page-btn:disabled { opacity: 0.4; cursor: not-allowed; }
  .page-info { color: #666; font-size: 0.9rem; }

  /* Viewer / lightbox */
  .viewer-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.92); z-index: 200; display: flex; align-items: center; justify-content: center; overflow: hidden; }
  .viewer-img-wrap { max-width: calc(100vw - 8rem); max-height: calc(100vh - 6rem); position: relative; display: flex; align-items: center; justify-content: center; transform-origin: center center; will-change: transform; }
  .viewer-img-wrap.zoomed { cursor: grab; }
  .viewer-img-wrap.zoomed:active { cursor: grabbing; }
  .viewer-img { max-width: 100%; max-height: calc(100vh - 6rem); border-radius: 4px; display: block; object-fit: contain; user-select: none; -webkit-user-drag: none; }
  .viewer-video { max-width: calc(100vw - 8rem); max-height: calc(100vh - 6rem); border-radius: 4px; display: block; outline: none; }
  .viewer-broken { font-size: 5rem; color: #333; }
  .viewer-close { position: fixed; top: 1rem; right: 1rem; background: rgba(0,0,0,0.6); border: none; border-radius: 50%; color: #fff; width: 2.5rem; height: 2.5rem; font-size: 1.2rem; cursor: pointer; display: flex; align-items: center; justify-content: center; z-index: 201; }
  .viewer-close:hover { background: rgba(255,255,255,0.15); }
  .viewer-nav { position: fixed; top: 50%; transform: translateY(-50%); background: rgba(0,0,0,0.5); border: none; border-radius: 50%; color: #fff; width: 3rem; height: 3rem; font-size: 1.3rem; cursor: pointer; display: flex; align-items: center; justify-content: center; z-index: 201; }
  .viewer-nav:hover:not(:disabled) { background: rgba(255,255,255,0.15); }
  .viewer-nav:disabled { opacity: 0.2; cursor: default; }
  .viewer-prev { left: 1rem; }
  .viewer-next { right: 1rem; }
  .viewer-meta { position: fixed; bottom: 0; left: 0; right: 0; padding: 1rem 1.5rem; background: linear-gradient(to top, rgba(0,0,0,0.8), transparent); display: flex; align-items: flex-end; justify-content: space-between; z-index: 201; }
  .viewer-info { font-size: 0.9rem; color: #fff; }
  .viewer-fname { font-weight: 700; margin-bottom: 2px; }
  .viewer-sub { color: #aaa; font-size: 0.8rem; }
  .viewer-actions { display: flex; gap: 0.5rem; }
  .vbtn { padding: 0.4rem 0.8rem; border-radius: 6px; border: 1px solid #444; background: rgba(0,0,0,0.5); color: #fff; font-size: 0.85rem; cursor: pointer; }
  .vbtn:hover { background: rgba(255,255,255,0.1); }
  .vbtn.fav-active { color: #f472b6; border-color: #f472b6; }
  .vbtn.danger:hover { border-color: #f87171; color: #f87171; }
</style>

<div class="page">
  <div class="header">
    <div>
      <h2>Photos</h2>
      {#if !loading && total > 0}<span class="count">{total.toLocaleString()} items</span>{/if}
    </div>
    <a href="/upload"><button class="upload-btn">+ Upload</button></a>
  </div>

  {#if loading}
    <div class="loading">Loading your photos...</div>
  {:else if error}
    <div class="error-msg">{error}</div>
  {:else if assets.length === 0}
    <div class="empty">
      <p>No photos yet.</p>
      <p style="margin-top:0.5rem;font-size:0.9rem"><a href="/upload" style="color:#4f8ef7">Upload your first photo</a> to get started.</p>
    </div>
  {:else}
    <div class="grid">
      {#each assets as asset (asset.id)}
        <div class="asset-tile" on:click={() => openViewer(asset)} role="button" tabindex="0"
          on:keydown={(e) => e.key === 'Enter' && openViewer(asset)}>
          {#if asset.type !== 'OTHER'}
            <img src={api.assets.thumbnailUrl(asset.id)} alt={asset.fileName} loading="lazy"
              on:error={(e) => imgError(e)} />
            <div class="broken" style="display:none">&#128247;</div>
          {:else}
            <div class="broken">&#128196;</div>
          {/if}
          {#if asset.type === 'VIDEO'}<span class="video-badge">VIDEO</span>{/if}
          <div class="overlay">
            <div class="tile-actions">
              <button class="tile-btn" class:fav-active={asset.isFavorite} title={asset.isFavorite ? 'Unfavorite' : 'Favorite'}
                on:click|stopPropagation={() => toggleFavorite(asset)}>&#9829;</button>
              <button class="tile-btn" title="Archive" on:click|stopPropagation={() => archiveAsset(asset)}>&#8964;</button>
              <button class="tile-btn" title="Trash" on:click|stopPropagation={() => trashAsset(asset)}>&#128465;</button>
            </div>
            <div class="overlay-info">
              <div class="overlay-name">{asset.fileName}</div>
              <div class="overlay-size">{formatSize(asset.fileSizeBytes)} &middot; {formatDate(asset.fileCreatedAt)}</div>
            </div>
          </div>
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

{#if viewerAsset}
  <!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
  <div class="viewer-backdrop" on:click|self={closeViewer} on:wheel|passive={false}
    on:wheel={onWheel} on:mousemove={onPanMove} on:mouseup={onPanEnd} on:mouseleave={onPanEnd}
    on:touchstart={onTouchStart} on:touchmove|passive={false} on:touchmove={onTouchMove}
    role="dialog" aria-modal="true">
    <button class="viewer-close" on:click={closeViewer}>✕</button>
    <button class="viewer-nav viewer-prev" on:click={viewerPrev} disabled={viewerIndex <= 0}>&#8592;</button>
    <div class="viewer-img-wrap" class:zoomed={zoomScale > 1}
      style="transform: scale({zoomScale}) translate({panX / zoomScale}px, {panY / zoomScale}px)"
      on:mousedown={onPanStart}>
      {#if viewerAsset.type === 'VIDEO'}
        <!-- svelte-ignore a11y-media-has-caption -->
        <video class="viewer-video" controls autoplay
          use:hlsPlayer={hlsUrl(viewerAsset)}
          on:click|stopPropagation></video>
      {:else if viewerAsset.type === 'IMAGE'}
        <img class="viewer-img" src={fullUrl(viewerAsset)} alt={viewerAsset.fileName} draggable="false" />
      {:else}
        <div class="viewer-broken">&#128196;</div>
      {/if}
    </div>
    <button class="viewer-nav viewer-next" on:click={viewerNext} disabled={viewerIndex >= assets.length - 1}>&#8594;</button>
    <div class="viewer-meta">
      <div class="viewer-info">
        <div class="viewer-fname">{viewerAsset.fileName}</div>
        <div class="viewer-sub">{formatSize(viewerAsset.fileSizeBytes)} &middot; {formatDate(viewerAsset.fileCreatedAt)}</div>
      </div>
      <div class="viewer-actions">
        <button class="vbtn" class:fav-active={viewerAsset.isFavorite}
          on:click={() => viewerAsset && toggleFavorite(viewerAsset)}>
          &#9829; {viewerAsset.isFavorite ? 'Unfavorite' : 'Favorite'}
        </button>
        <button class="vbtn" on:click={() => viewerAsset && archiveAsset(viewerAsset)}>Archive</button>
        <button class="vbtn danger" on:click={() => viewerAsset && trashAsset(viewerAsset)}>Trash</button>
      </div>
    </div>
  </div>
{/if}
