<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { api } from '$lib/api';
  import type { Asset } from '$lib/api';
  import Hls from 'hls.js';
  import { settings } from '$lib/settings';

  /** The flat list of assets to navigate through. */
  export let assets: Asset[] = [];
  /** Index of the currently viewed asset. -1 = closed. Bind this in the parent. */
  export let viewerIndex: number = -1;
  /**
   * 'default' — shows Favorite / Archive / Trash actions.
   * 'trash'   — shows Restore / Delete Permanently instead.
   */
  export let mode: 'default' | 'trash' = 'default';

  const dispatch = createEventDispatcher<{
    /** An asset was modified in place (e.g. favorite toggled). */
    assetUpdated: Asset;
    /** An asset was removed from the current context (archived / trashed / restored). */
    assetRemoved: string;
  }>();

  $: viewerAsset = viewerIndex >= 0 && viewerIndex < assets.length
    ? assets[viewerIndex]
    : null;

  // ── zoom / pan ────────────────────────────────────────────────────────────
  let zoomScale = 1;
  let panX = 0;
  let panY = 0;
  let isPanning = false;
  let panStartX = 0;
  let panStartY = 0;
  let lastPinchDist = 0;

  function resetZoom() { zoomScale = 1; panX = 0; panY = 0; }

  const ZOOM_STEP = 1.5;
  function zoomIn()  {
    zoomScale = Math.min(10, zoomScale * ZOOM_STEP);
  }
  function zoomOut() {
    zoomScale = Math.max(1, zoomScale / ZOOM_STEP);
    if (zoomScale === 1) { panX = 0; panY = 0; }
  }

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
      lastPinchDist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY,
      );
    }
  }
  function onTouchMove(e: TouchEvent) {
    if (e.touches.length !== 2) return;
    e.preventDefault();
    const dist = Math.hypot(
      e.touches[0].clientX - e.touches[1].clientX,
      e.touches[0].clientY - e.touches[1].clientY,
    );
    if (lastPinchDist > 0) {
      zoomScale = Math.min(10, Math.max(1, zoomScale * (dist / lastPinchDist)));
      if (zoomScale === 1) { panX = 0; panY = 0; }
    }
    lastPinchDist = dist;
  }

  // ── keyboard ──────────────────────────────────────────────────────────────
  function onKey(e: KeyboardEvent) {
    if (!viewerAsset) return;
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowLeft'  && zoomScale === 1) prev();
    else if (e.key === 'ArrowRight' && zoomScale === 1) next();
  }

  function close() { viewerIndex = -1; resetZoom(); videoError = false; }
  function prev()  { if (viewerIndex > 0)                     { viewerIndex--; resetZoom(); videoError = false; } }
  function next()  { if (viewerIndex < assets.length - 1)     { viewerIndex++; resetZoom(); videoError = false; } }

  // ── actions ───────────────────────────────────────────────────────────────
  async function toggleFavorite() {
    if (!viewerAsset) return;
    const updated = await api.assets.toggleFavorite(viewerAsset.id);
    // Mutate the local list so the button label updates immediately
    assets = assets.map(a => a.id === updated.id ? updated : a);
    dispatch('assetUpdated', updated);
  }

  async function archiveAsset() {
    if (!viewerAsset) return;
    await api.assets.toggleArchive(viewerAsset.id);
    const id = viewerAsset.id;
    close();
    dispatch('assetRemoved', id);
  }

  async function trashAsset() {
    if (!viewerAsset) return;
    await api.assets.softDelete(viewerAsset.id);
    const id = viewerAsset.id;
    close();
    dispatch('assetRemoved', id);
  }

  async function restoreAsset() {
    if (!viewerAsset) return;
    await api.assets.restore(viewerAsset.id);
    const id = viewerAsset.id;
    close();
    dispatch('assetRemoved', id);
  }

  async function permanentDelete() {
    if (!viewerAsset) return;
    if (!confirm(`Permanently delete "${viewerAsset.fileName}"? This cannot be undone.`)) return;
    await api.assets.permanentDelete(viewerAsset.id);
    const id = viewerAsset.id;
    close();
    dispatch('assetRemoved', id);
  }

  // ── HLS video player ──────────────────────────────────────────────────────
  let videoError = false;

  function hlsUrl(asset: Asset) {
    const token = typeof localStorage !== 'undefined' ? localStorage.getItem('photoapp_token') : null;
    return `/api/assets/${asset.id}/stream/master.m3u8${token ? `?token=${encodeURIComponent(token)}` : ''}`;
  }

  function posterUrl(asset: Asset) {
    const token = typeof localStorage !== 'undefined' ? localStorage.getItem('photoapp_token') : null;
    return `/api/assets/${asset.id}/thumbnail${token ? `?token=${encodeURIComponent(token)}&size=large` : '?size=large'}`;
  }

  function hlsPlayer(node: HTMLVideoElement, src: string) {
    let hls: Hls | null = null;
    videoError = false;

    function init(s: string) {
      videoError = false;
      if (hls) { hls.destroy(); hls = null; }
      if (Hls.isSupported()) {
        hls = new Hls({
          // Start at lowest quality for fast initial load, then switch up
          startLevel: -1,
          abrEwmaDefaultEstimate: 500000,
          // Add Bearer token to every XHR request (m3u8 + all .ts segments)
          xhrSetup(xhr: XMLHttpRequest) {
            const token = typeof localStorage !== 'undefined'
              ? localStorage.getItem('photoapp_token')
              : null;
            if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
          },
        });
        hls.on(Hls.Events.ERROR, (_event: any, data: any) => {
          if (data.fatal) {
            videoError = true;
            hls?.destroy();
            hls = null;
          }
        });
        hls.loadSource(s);
        hls.attachMedia(node);
      } else if (node.canPlayType('application/vnd.apple.mpegurl')) {
        node.src = s; // Safari native HLS
      }
    }

    init(src);
    return {
      update(s: string) { init(s); },
      destroy()         { if (hls) { hls.destroy(); hls = null; } },
    };
  }

  // ── helpers ───────────────────────────────────────────────────────────────
  function fullUrl(asset: Asset) {
    const token = typeof localStorage !== 'undefined' ? localStorage.getItem('photoapp_token') : null;
    // If loadOriginalImage is on, use the download endpoint for full resolution
    if ($settings.assetViewer.loadOriginalImage) {
      return token ? `/api/assets/${asset.id}/download?token=${encodeURIComponent(token)}` : `/api/assets/${asset.id}/download`;
    }
    return `/api/assets/${asset.id}/thumbnail${token ? `?token=${encodeURIComponent(token)}&size=large` : '?size=large'}`;
  }
  function formatDate(d: string) {
    return new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  }
  function formatSize(b: string) {
    const n = parseInt(b, 10);
    return n < 1_048_576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1_048_576).toFixed(1)} MB`;
  }
</script>

<svelte:window on:keydown={onKey} />

{#if viewerAsset}
  <!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
  <div
    class="viewer-backdrop"
    role="dialog"
    aria-modal="true"
    on:click|self={close}
    on:wheel|nonpassive={onWheel}
    on:mousemove={onPanMove}
    on:mouseup={onPanEnd}
    on:mouseleave={onPanEnd}
    on:touchstart={onTouchStart}
    on:touchmove|nonpassive={onTouchMove}
  >
    <!-- Close -->
    <button class="viewer-close" on:click={close}>✕</button>

    <!-- Zoom controls (images only) -->
    {#if viewerAsset.type === 'IMAGE'}
      <div class="zoom-controls">
        <button class="zoom-btn" on:click={zoomOut} disabled={zoomScale <= 1} title="Zoom out">−</button>
        <button class="zoom-label" on:click={resetZoom} title="Reset zoom">{Math.round(zoomScale * 100)}%</button>
        <button class="zoom-btn" on:click={zoomIn} disabled={zoomScale >= 10} title="Zoom in">+</button>
      </div>
    {/if}

    <!-- Prev -->
    <button class="viewer-nav viewer-prev" on:click={prev} disabled={viewerIndex <= 0}>&#8592;</button>

    <!-- Media -->
    <div
      class="viewer-img-wrap"
      class:zoomed={zoomScale > 1}
      style="transform: scale({zoomScale}) translate({panX / zoomScale}px, {panY / zoomScale}px)"
      on:mousedown={onPanStart}
    >
      {#if viewerAsset.type === 'VIDEO'}
        {#if videoError}
          <div class="video-error">
            <div class="video-error-icon">⚠</div>
            <p>Unable to play this video</p>
            <a class="vbtn" href={api.assets.downloadUrl(viewerAsset.id)} download={viewerAsset.fileName}>
              ⬇ Download instead
            </a>
          </div>
        {:else}
          <!-- svelte-ignore a11y-media-has-caption -->
          <video
            class="viewer-video"
            controls
            autoplay={$settings.videos.autoPlay}
            loop={$settings.videos.looping}
            poster={posterUrl(viewerAsset)}
            use:hlsPlayer={hlsUrl(viewerAsset)}
            on:click|stopPropagation
          ></video>
        {/if}
      {:else if viewerAsset.type === 'IMAGE'}
        <img
          class="viewer-img"
          src={fullUrl(viewerAsset)}
          alt={viewerAsset.fileName}
          draggable="false"
        />
      {:else}
        <div class="viewer-broken">&#128196;</div>
      {/if}
    </div>

    <!-- Next -->
    <button class="viewer-nav viewer-next" on:click={next} disabled={viewerIndex >= assets.length - 1}>&#8594;</button>

    <!-- Bottom bar -->
    <div class="viewer-meta">
      <div class="viewer-info">
        <div class="viewer-fname">{viewerAsset.fileName}</div>
        <div class="viewer-sub">
          {formatSize(viewerAsset.fileSizeBytes)} &middot; {formatDate(viewerAsset.fileCreatedAt)}
          {#if viewerAsset.locationCity}
            &middot; {viewerAsset.locationCity}{viewerAsset.locationCountry ? `, ${viewerAsset.locationCountry}` : ''}
          {/if}
        </div>
      </div>

      <div class="viewer-actions">
        <a class="vbtn" href={api.assets.downloadUrl(viewerAsset.id)} download={viewerAsset.fileName} title="Download">
          &#11123; Download
        </a>
        {#if mode === 'default'}
          <button class="vbtn" class:fav-active={viewerAsset.isFavorite} on:click={toggleFavorite}>
            &#9829; {viewerAsset.isFavorite ? 'Unfavorite' : 'Favorite'}
          </button>
          <button class="vbtn" on:click={archiveAsset}>
            {viewerAsset.isArchived ? 'Unarchive' : 'Archive'}
          </button>
          <button class="vbtn danger" on:click={trashAsset}>Trash</button>
        {:else if mode === 'trash'}
          <button class="vbtn" on:click={restoreAsset}>Restore</button>
          <button class="vbtn danger" on:click={permanentDelete}>Delete permanently</button>
        {/if}
      </div>
    </div>
  </div>
{/if}

<style>
  .viewer-backdrop {
    position: fixed; inset: 0;
    background: rgba(0,0,0,0.92);
    z-index: 9999;
    display: flex; align-items: center; justify-content: center;
    overflow: hidden;
  }

  /* Media wrapper */
  .viewer-img-wrap {
    max-width: calc(100vw - 8rem);
    max-height: calc(100vh - 6rem);
    display: flex; align-items: center; justify-content: center;
    transform-origin: center center;
    will-change: transform;
  }
  .viewer-img-wrap.zoomed  { cursor: grab; }
  .viewer-img-wrap.zoomed:active { cursor: grabbing; }

  .viewer-img {
    max-width: 100%;
    max-height: calc(100vh - 6rem);
    border-radius: 4px;
    display: block;
    object-fit: contain;
    user-select: none;
    -webkit-user-drag: none;
  }
  .viewer-video {
    max-width: calc(100vw - 8rem);
    max-height: calc(100vh - 6rem);
    border-radius: 4px;
    display: block;
    outline: none;
    background: #000;
  }
  .viewer-broken { font-size: 5rem; color: #333; }

  .video-error {
    display: flex; flex-direction: column; align-items: center;
    gap: 0.75rem; color: #fff; text-align: center;
    padding: 2rem;
  }
  .video-error-icon { font-size: 3rem; opacity: 0.7; }
  .video-error p { font-size: 0.95rem; color: #ccc; margin: 0; }

  /* Close button */
  .viewer-close {
    position: fixed; top: 1rem; right: 1rem;
    background: rgba(0,0,0,0.6); border: none; border-radius: 50%;
    color: #fff; width: 2.5rem; height: 2.5rem; font-size: 1.2rem;
    cursor: pointer; display: flex; align-items: center; justify-content: center;
    z-index: 10000;
  }
  .viewer-close:hover { background: rgba(255,255,255,0.15); }

  /* Prev / Next nav */
  .viewer-nav {
    position: fixed; top: 50%; transform: translateY(-50%);
    background: rgba(0,0,0,0.5); border: none; border-radius: 50%;
    color: #fff; width: 3rem; height: 3rem; font-size: 1.3rem;
    cursor: pointer; display: flex; align-items: center; justify-content: center;
    z-index: 10000;
  }
  .viewer-nav:hover:not(:disabled) { background: rgba(255,255,255,0.15); }
  .viewer-nav:disabled { opacity: 0.2; cursor: default; }
  .viewer-prev { left: 1rem; }
  .viewer-next { right: 1rem; }

  /* Bottom metadata + actions */
  .viewer-meta {
    position: fixed; bottom: 0; left: 0; right: 0;
    padding: 1rem 1.5rem;
    background: linear-gradient(to top, rgba(0,0,0,0.85), transparent);
    display: flex; align-items: flex-end; justify-content: space-between;
    z-index: 10000;
  }
  .viewer-info { font-size: 0.9rem; color: #fff; }
  .viewer-fname { font-weight: 700; margin-bottom: 2px; }
  .viewer-sub   { color: #aaa; font-size: 0.8rem; }
  .viewer-actions { display: flex; gap: 0.5rem; flex-shrink: 0; }

  .vbtn {
    padding: 0.4rem 0.8rem; border-radius: 6px;
    border: 1px solid #444; background: rgba(0,0,0,0.5);
    color: #fff; font-size: 0.85rem; cursor: pointer;
  }
  .vbtn:hover         { background: rgba(255,255,255,0.1); }
  .vbtn.fav-active    { color: #f472b6; border-color: #f472b6; }
  .vbtn.danger:hover  { border-color: #f87171; color: #f87171; }

  /* Zoom controls */
  .zoom-controls {
    position: fixed; top: 1rem; left: 50%; transform: translateX(-50%);
    display: flex; align-items: center; gap: 0.25rem;
    background: rgba(0,0,0,0.6); border-radius: 8px; padding: 0.25rem 0.4rem;
    z-index: 10000;
  }
  .zoom-btn {
    background: transparent; border: none; color: #fff;
    width: 2rem; height: 2rem; font-size: 1.2rem; font-weight: 700;
    cursor: pointer; border-radius: 4px;
    display: flex; align-items: center; justify-content: center;
  }
  .zoom-btn:hover:not(:disabled) { background: rgba(255,255,255,0.15); }
  .zoom-btn:disabled { opacity: 0.3; cursor: default; }
  .zoom-label {
    background: transparent; border: none; color: #ccc;
    font-size: 0.8rem; min-width: 3rem; text-align: center;
    cursor: pointer; padding: 0 0.25rem;
  }
  .zoom-label:hover { color: #fff; }
</style>
