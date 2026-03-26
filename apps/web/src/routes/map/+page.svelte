<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { goto } from '$app/navigation';
  import { api } from '$lib/api';
  import { isAuthenticated } from '$lib/stores';
  import type { Asset } from '$lib/api';

  let mapEl: HTMLDivElement;
  let leafletMap: any = null;
  let assets: Asset[] = [];
  let loading = true;
  let error = '';
  let selected: Asset | null = null;

  onMount(async () => {
    if (!$isAuthenticated) { goto('/'); return; }
    try {
      assets = await api.assets.listMap();
    } catch (e) {
      error = e instanceof Error ? e.message : 'Failed to load';
      loading = false;
      return;
    }
    loading = false;
    await initMap();
  });

  onDestroy(() => {
    if (leafletMap) { leafletMap.remove(); leafletMap = null; }
  });

  async function initMap() {
    // Load CSS first, then JS
    if (!(window as any).L) {
      await loadCss('https://unpkg.com/leaflet@1.9.4/dist/leaflet.css');
      await loadScript('https://unpkg.com/leaflet@1.9.4/dist/leaflet.js');
    }
    const L = (window as any).L;

    // Invalidate size after render tick
    leafletMap = L.map(mapEl, { zoomControl: true }).setView([20, 0], 2);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 19,
    }).addTo(leafletMap);

    // Force Leaflet to recalculate container size
    setTimeout(() => leafletMap && leafletMap.invalidateSize(), 50);

    if (assets.length === 0) return;

    const bounds: [number, number][] = [];
    for (const asset of assets) {
      if (asset.locationLat == null || asset.locationLng == null) continue;
      const lat = asset.locationLat as number;
      const lng = asset.locationLng as number;
      bounds.push([lat, lng]);

      const thumbUrl = api.assets.thumbnailUrl(asset.id);
      const popupHtml = `
        <div style="width:160px">
          <img src="${thumbUrl}" style="width:100%;border-radius:4px;display:block" onerror="this.style.display='none'" />
          <div style="padding:4px 0;font-size:0.8rem;font-weight:600;color:#111;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${asset.fileName}</div>
          ${asset.locationCity ? `<div style="font-size:0.75rem;color:#555">${[asset.locationCity, asset.locationCountry].filter(Boolean).join(', ')}</div>` : ''}
        </div>`;

      const marker = L.circleMarker([lat, lng], {
        radius: 8, fillColor: '#4f8ef7', color: '#fff',
        weight: 2, opacity: 1, fillOpacity: 0.85,
      }).addTo(leafletMap);
      marker.bindPopup(popupHtml, { maxWidth: 180 });
      marker.on('click', () => { selected = asset; });
    }

    if (bounds.length > 0) {
      leafletMap.fitBounds(bounds, { padding: [40, 40], maxZoom: 14 });
    }
  }

  function loadScript(src: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src; s.onload = () => resolve(); s.onerror = reject;
      document.head.appendChild(s);
    });
  }
  function loadCss(href: string): Promise<void> {
    return new Promise((resolve) => {
      const l = document.createElement('link');
      l.rel = 'stylesheet'; l.href = href;
      l.onload = () => resolve();
      document.head.appendChild(l);
    });
  }

  function formatDate(d: string) {
    return new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  }
</script>

<style>
  .page { padding: 1.5rem; max-width: 1600px; margin: 0 auto; }
  .header { margin-bottom: 1rem; }
  h2 { font-size: 1.5rem; font-weight: 700; }
  .sub { color: #666; font-size: 0.85rem; margin-top: 0.25rem; }
  /* Fixed height — does not rely on flex from parent */
  .map-wrap { height: calc(100vh - 160px); min-height: 400px; border-radius: 12px; overflow: hidden; position: relative; background: #1a1a1a; }
  .loading, .error-msg, .empty { text-align: center; padding: 4rem 2rem; color: #666; }
  .error-msg { color: #f87171; }
  .sidebar { position: absolute; top: 1rem; right: 1rem; z-index: 1000; background: #111; border: 1px solid #333;
    border-radius: 10px; padding: 1rem; width: 220px; font-size: 0.8rem; }
  .sidebar img { width: 100%; border-radius: 6px; margin-bottom: 0.5rem; display: block; }
  .sidebar .fname { font-weight: 600; color: #fff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .sidebar .loc { color: #aaa; margin-top: 2px; }
  .sidebar .date { color: #666; margin-top: 2px; }
  .close-btn { position: absolute; top: 0.4rem; right: 0.4rem; background: none; border: none; color: #666; font-size: 1rem; cursor: pointer; line-height: 1; }
  .close-btn:hover { color: #fff; }
  :global(.leaflet-container) { background: #1a1a1a; width: 100% !important; height: 100% !important; }
  :global(.leaflet-popup-content-wrapper) { background: #fff; border-radius: 8px; }
  :global(.leaflet-popup-tip) { background: #fff; }
</style>

<div class="page">
  <div class="header">
    <h2>Map</h2>
    {#if !loading && assets.length > 0}
      <div class="sub">{assets.length} photo{assets.length !== 1 ? 's' : ''} with GPS data</div>
    {/if}
  </div>

  {#if loading}
    <div class="loading">Loading map...</div>
  {:else if error}
    <div class="error-msg">{error}</div>
  {:else if assets.length === 0}
    <div class="empty">No photos with GPS data yet. Upload photos with location EXIF data to see them on the map.</div>
  {:else}
    <div class="map-wrap">
      <div bind:this={mapEl} style="width:100%;height:100%"></div>
      {#if selected}
        <div class="sidebar">
          <button class="close-btn" on:click={() => selected = null}>✕</button>
          <img src={api.assets.thumbnailUrl(selected.id)} alt={selected.fileName} />
          <div class="fname">{selected.fileName}</div>
          {#if selected.locationCity}
            <div class="loc">📍 {[selected.locationCity, selected.locationCountry].filter(Boolean).join(', ')}</div>
          {/if}
          <div class="date">{formatDate(selected.fileCreatedAt)}</div>
        </div>
      {/if}
    </div>
  {/if}
</div>
