<script lang="ts">
  import { onMount, onDestroy, tick } from 'svelte';
  import { goto } from '$app/navigation';
  import { api } from '$lib/api';
  import { isAuthenticated } from '$lib/stores';
  import type { Asset } from '$lib/api';
  import PhotoViewer from '$lib/PhotoViewer.svelte';

  let mapEl: HTMLDivElement;
  let leafletMap: any = null;
  let assets: Asset[] = [];
  let loading = true;
  let error = '';
  let viewerIndex = -1;

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
    await tick();
    await initMap();
  });

  onDestroy(() => {
    if (leafletMap) { leafletMap.remove(); leafletMap = null; }
  });

  async function initMap() {
    if (!(window as any).L) {
      await loadCss('https://unpkg.com/leaflet@1.9.4/dist/leaflet.css');
      await loadScript('https://unpkg.com/leaflet@1.9.4/dist/leaflet.js');
    }
    const L = (window as any).L;

    leafletMap = L.map(mapEl, { zoomControl: true }).setView([20, 0], 2);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 19,
    }).addTo(leafletMap);

    setTimeout(() => leafletMap && leafletMap.invalidateSize(), 50);

    if (assets.length === 0) return;

    const bounds: [number, number][] = [];
    for (const asset of assets) {
      if (asset.locationLat == null || asset.locationLng == null) continue;
      const lat = asset.locationLat as number;
      const lng = asset.locationLng as number;
      bounds.push([lat, lng]);

      const thumbUrl = api.assets.thumbnailUrl(asset.id);
      const sizeFmt = formatSize(asset.fileSizeBytes);
      const dateFmt = formatDate(asset.fileCreatedAt);
      const locFmt  = [asset.locationCity, asset.locationState, asset.locationCountry].filter(Boolean).join(', ');

      const popupHtml = `
        <div style="width:200px;font-family:system-ui,sans-serif">
          <div data-open style="position:relative;cursor:pointer">
            <img src="${thumbUrl}"
              style="width:100%;height:130px;object-fit:cover;border-radius:6px 6px 0 0;display:block"
              onerror="this.style.display='none'" />
            <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;
              background:rgba(0,0,0,0.2);border-radius:6px 6px 0 0">
              <span style="color:#fff;font-size:2rem;text-shadow:0 2px 6px rgba(0,0,0,0.5)">&#9654;</span>
            </div>
          </div>
          <div style="padding:8px">
            <div style="font-size:0.82rem;font-weight:700;color:#111;white-space:nowrap;overflow:hidden;text-overflow:ellipsis"
              title="${asset.fileName}">${asset.fileName}</div>
            ${locFmt ? `<div style="font-size:0.75rem;color:#555;margin-top:4px">&#128205; ${locFmt}</div>` : ''}
            <div style="font-size:0.75rem;color:#777;margin-top:3px">&#128197; ${dateFmt}</div>
            <div style="font-size:0.75rem;color:#777;margin-top:3px">&#128190; ${sizeFmt}</div>
            <button data-open
              style="margin-top:10px;width:100%;padding:6px;background:#4f8ef7;border:none;border-radius:6px;
                color:#fff;font-size:0.82rem;font-weight:600;cursor:pointer">
              View Photo
            </button>
          </div>
        </div>`;

      const marker = L.circleMarker([lat, lng], {
        radius: 8, fillColor: '#4f8ef7', color: '#fff',
        weight: 2, opacity: 1, fillOpacity: 0.85,
      }).addTo(leafletMap);
      const popup = L.popup({ maxWidth: 220, minWidth: 204 }).setContent(popupHtml);
      marker.bindPopup(popup);
      // Attach click handlers after popup DOM is ready
      marker.on('popupopen', () => {
        const el = popup.getElement();
        if (!el) return;
        el.querySelectorAll('[data-open]').forEach((btn: Element) => {
          btn.addEventListener('click', () => {
            const idx = assets.findIndex(a => a.id === asset.id);
            if (idx >= 0) viewerIndex = idx;
          });
        });
      });
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
  function formatSize(b: string) {
    const n = parseInt(b, 10);
    return n < 1_048_576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1_048_576).toFixed(1)} MB`;
  }

  function handleAssetUpdated(e: CustomEvent) {
    assets = assets.map(a => a.id === e.detail.id ? e.detail : a);
  }
  function handleAssetRemoved(e: CustomEvent<string>) {
    assets = assets.filter(a => a.id !== e.detail);
  }
</script>

<style>
  .page { padding: 1.5rem; max-width: 1600px; margin: 0 auto; }
  .header { margin-bottom: 1rem; }
  h2 { font-size: 1.5rem; font-weight: 700; }
  .sub { color: var(--text-muted); font-size: 0.85rem; margin-top: 0.25rem; }
  .map-wrap { height: calc(100vh - 160px); min-height: 400px; border-radius: 12px; overflow: hidden; background: var(--surface-2); }
  .loading, .error-msg, .empty { text-align: center; padding: 4rem 2rem; color: var(--text-muted); }
  .error-msg { color: var(--error); }
  :global(.leaflet-container) { background: var(--surface-2); width: 100% !important; height: 100% !important; }
  :global(.leaflet-popup-content-wrapper) { background: #fff; border-radius: 10px; box-shadow: 0 4px 20px rgba(0,0,0,0.25); padding: 0; overflow: hidden; }
  :global(.leaflet-popup-content) { margin: 0; }
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
    </div>
  {/if}
</div>

<PhotoViewer
  bind:viewerIndex
  {assets}
  mode="default"
  on:assetUpdated={handleAssetUpdated}
  on:assetRemoved={handleAssetRemoved}
/>
