<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { api } from '$lib/api';
  import { isAuthenticated } from '$lib/stores';
  import type { MemoryYearGroup, MemoryAsset } from '$lib/api';
  import PhotoViewer from '$lib/PhotoViewer.svelte';

  let data: { people: any[]; locations: any[]; months: any[]; tags: any[]; videos: any[]; livePhotos: any[] } | null = null;
  let loading = true;
  let error = '';

  let yearGroups: MemoryYearGroup[] = [];
  let memoriesLoading = true;

  // Single PhotoViewer for memories, videos, and live photos
  let viewerAssets: any[] = [];
  let viewerIndex = -1;
  let activeGroup: MemoryYearGroup | null = null;

  onMount(async () => {
    if (!$isAuthenticated) { goto('/'); return; }
    const [smartResult, memoriesResult] = await Promise.allSettled([
      api.smartAlbums.list(),
      api.memories.get(),
    ]);
    if (smartResult.status === 'fulfilled') data = smartResult.value as any;
    else error = smartResult.reason?.message ?? 'Failed to load';
    if (memoriesResult.status === 'fulfilled') yearGroups = memoriesResult.value.yearGroups;
    loading = false;
    memoriesLoading = false;
  });

  function openMemoryViewer(group: MemoryYearGroup, index: number) {
    activeGroup = group;
    viewerAssets = group.assets as MemoryAsset[];
    viewerIndex = index;
  }

  function openInViewer(assets: any[], index: number) {
    activeGroup = null;
    viewerAssets = [...assets];
    viewerIndex = index;
  }

  function handleAssetUpdated(e: CustomEvent<any>) {
    const updated = e.detail;
    viewerAssets = viewerAssets.map(a => a.id === updated.id ? updated : a);
    if (data) {
      data = {
        ...data,
        videos: data.videos.map((a: any) => a.id === updated.id ? updated : a),
        livePhotos: data.livePhotos.map((a: any) => a.id === updated.id ? updated : a),
      };
    }
  }

  function handleAssetRemoved(e: CustomEvent<string>) {
    const removedId = e.detail;
    viewerAssets = viewerAssets.filter(a => a.id !== removedId);
    if (activeGroup) {
      activeGroup.assets = activeGroup.assets.filter(a => a.id !== removedId);
      activeGroup.count = Math.max(0, activeGroup.count - 1);
      yearGroups = yearGroups.map(g => g === activeGroup ? { ...activeGroup } : g).filter(g => g.count > 0);
    }
    if (data) {
      data = {
        ...data,
        videos: data.videos.filter((a: any) => a.id !== removedId),
        livePhotos: data.livePhotos.filter((a: any) => a.id !== removedId),
      };
    }
    api.smartAlbums.list().then(d => { data = d as any; }).catch(() => {});
  }

  function openPerson(album: any) { goto(`/people/${album.criteria.personId}`); }
  function openLocation(album: any) { goto(`/search?location=${encodeURIComponent(album.name)}`); }
  function openMonth(album: any) { goto(`/search?month=${encodeURIComponent(album.criteria.month)}`); }
  function openTag(album: any) { goto(`/search?q=${encodeURIComponent(album.name)}`); }
</script>

<style>
  .page { padding: 1.5rem; max-width: 1600px; margin: 0 auto; }
  h2 { font-size: 1.5rem; font-weight: 700; margin-bottom: 1.5rem; }
  .loading, .error-msg { text-align: center; padding: 4rem 2rem; color: var(--text-muted); }
  .error-msg { color: var(--error); }
  section { margin-bottom: 2.5rem; }
  .section-header { display: flex; align-items: baseline; gap: 0.75rem; margin-bottom: 1rem; }
  .section-title { font-size: 1.1rem; font-weight: 700; }
  .section-count { color: var(--text-muted); font-size: 0.85rem; }
  .cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 10px; }
  .card { border-radius: 10px; overflow: hidden; background: var(--surface); border: 1px solid var(--border); cursor: pointer; }
  .card:hover .card-img { transform: scale(1.05); }
  .card-summary { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent); }
  .thumb { aspect-ratio: 1; overflow: hidden; background: var(--surface-2); }
  .card-img { width: 100%; height: 100%; object-fit: cover; display: block; transition: transform 0.2s; }
  .placeholder { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; font-size: 2.5rem; }
  .card-info { padding: 0.5rem 0.6rem 0.6rem; }
  .card-name { font-size: 0.82rem; font-weight: 600; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .card-count { font-size: 0.75rem; color: var(--text-muted); margin-top: 1px; }
  .tag-cloud { display: flex; flex-wrap: wrap; gap: 0.5rem; }
  .tag-pill { padding: 0.3rem 0.75rem; background: var(--surface-2); border: 1px solid var(--border); border-radius: 999px; color: var(--text-2); font-size: 0.85rem; cursor: pointer; }
  .tag-pill:hover { border-color: var(--accent); color: var(--accent); }
  .tag-count { color: var(--text-subtle); font-size: 0.75rem; margin-left: 0.25rem; }
  .video-overlay { position: absolute; bottom: 4px; right: 4px; background: rgba(0,0,0,0.7); border-radius: 4px; padding: 2px 5px; font-size: 0.65rem; color: #fff; }
  .thumb-wrap { position: relative; aspect-ratio: 1; overflow: hidden; background: var(--surface-2); }

  /* ── Memories — horizontal card strip ── */
  .memory-strip {
    display: flex; gap: 10px; overflow-x: auto; padding-bottom: 4px;
    scrollbar-width: thin; scrollbar-color: var(--border) transparent;
    align-items: flex-start;
  }
  .memory-strip::-webkit-scrollbar { height: 4px; }
  .memory-strip::-webkit-scrollbar-thumb { background: var(--border); border-radius: 2px; }

  .mem-card {
    flex: 0 0 auto; width: 160px; height: 210px;
    border-radius: 14px; overflow: hidden;
    background: var(--surface-2); cursor: pointer; position: relative;
    transition: transform 0.2s, box-shadow 0.2s;
    box-shadow: 0 2px 8px rgba(0,0,0,0.18);
  }
  .mem-card:hover { transform: scale(1.03); box-shadow: 0 6px 20px rgba(0,0,0,0.28); }
  .mem-card img {
    width: 100%; height: 100%; object-fit: cover; display: block;
    transition: transform 0.25s;
  }
  .mem-card:hover img { transform: scale(1.06); }
  .mem-card-overlay {
    position: absolute; inset: 0;
    background: linear-gradient(to top, rgba(0,0,0,0.75) 0%, rgba(0,0,0,0.35) 45%, transparent 100%);
    display: flex; flex-direction: column; justify-content: flex-end;
    padding: 0.7rem 0.75rem;
  }
  .mem-card-label {
    font-size: 0.95rem; font-weight: 800; color: #fff;
    line-height: 1.2; letter-spacing: -0.01em;
    text-shadow: 0 1px 4px rgba(0,0,0,0.5);
  }
  .mem-card-sub {
    font-size: 0.72rem; color: rgba(255,255,255,0.75);
    margin-top: 0.2rem; font-weight: 500;
    text-shadow: 0 1px 3px rgba(0,0,0,0.5);
  }
  .mem-placeholder {
    width: 100%; height: 100%; display: flex; align-items: center;
    justify-content: center; font-size: 2.5rem; color: var(--text-muted);
  }
</style>

<div class="page">
  <h2>Smart Albums</h2>

  {#if !memoriesLoading && yearGroups.length > 0}
    <section>
      <div class="section-header">
        <span class="section-title">🕰 Memories</span>
        <span class="section-count">On this day in past years</span>
      </div>
      <div class="memory-strip">
        {#each yearGroups as group}
          <!-- svelte-ignore a11y-click-events-have-key-events -->
          <div class="mem-card" on:click={() => openMemoryViewer(group, 0)}
            role="button" tabindex="0"
            on:keydown={(e) => e.key === 'Enter' && openMemoryViewer(group, 0)}>
            {#if group.assets[0]?.thumbnailSmallPath}
              <img src={api.assets.thumbnailUrl(group.assets[0].id)} alt={group.label} loading="lazy" />
            {:else}
              <div class="mem-placeholder">🖼</div>
            {/if}
            <div class="mem-card-overlay">
              <div class="mem-card-label">{group.label}</div>
              <div class="mem-card-sub">{group.year} &middot; {group.count} photo{group.count !== 1 ? 's' : ''}</div>
            </div>
          </div>
        {/each}
      </div>
    </section>
  {/if}

  {#if loading}
    <div class="loading">Loading…</div>
  {:else if error}
    <div class="error-msg">{error}</div>
  {:else if data}

    {#if data.videos && data.videos.length > 0}
      <section>
        <div class="section-header">
          <span class="section-title">🎬 Videos</span>
          <span class="section-count">{data.videos.length} video{data.videos.length !== 1 ? 's' : ''}</span>
        </div>
        <div class="cards">
          {#each data.videos as asset, i}
            <!-- svelte-ignore a11y-no-static-element-interactions -->
            <div class="card" on:click={() => openInViewer(data.videos, i)} role="button" tabindex="0"
              on:keydown={(e) => e.key === 'Enter' && openInViewer(data.videos, i)}>
              <div class="thumb-wrap">
                {#if asset.id}
                  <img class="card-img" src={api.assets.thumbnailUrl(asset.id, asset.updatedAt)} alt={asset.fileName}
                    on:error={(e) => { e.currentTarget.style.display='none'; }} />
                {:else}
                  <div class="placeholder">🎬</div>
                {/if}
                <span class="video-overlay">▶</span>
              </div>
              <div class="card-info">
                <div class="card-name">{asset.fileName}</div>
                <div class="card-count">{asset.duration ? asset.duration + 's' : ''}</div>
              </div>
            </div>
          {/each}
        </div>
      </section>
    {/if}

    {#if data.livePhotos && data.livePhotos.length > 0}
      <section>
        <div class="section-header">
          <span class="section-title">&#9654; Live Photos</span>
          <span class="section-count">{data.livePhotos.length} photo{data.livePhotos.length !== 1 ? 's' : ''}</span>
        </div>
        <div class="cards">
          {#each data.livePhotos as asset, i}
            <!-- svelte-ignore a11y-no-static-element-interactions -->
            <div class="card" on:click={() => openInViewer(data.livePhotos, i)} role="button" tabindex="0"
              on:keydown={(e) => e.key === 'Enter' && openInViewer(data.livePhotos, i)}>
              <div class="thumb">
                <img class="card-img" src={api.assets.thumbnailUrl(asset.id, asset.updatedAt)} alt={asset.fileName}
                  on:error={(e) => { e.currentTarget.style.display='none'; }} />
              </div>
              <div class="card-info">
                <div class="card-name">{asset.fileName}</div>
                <div class="card-count" style="color:#22c55e">&#9654; Live</div>
              </div>
            </div>
          {/each}
        </div>
      </section>
    {/if}

    {#if data.people.length > 0}
      <section>
        <div class="section-header">
          <span class="section-title">👤 People</span>
          <span class="section-count">{data.people.length} people</span>
        </div>
        <div class="cards">
          {#each data.people as album}
            <div class="card" on:click={() => openPerson(album)} role="button" tabindex="0"
              on:keydown={(e) => e.key === 'Enter' && openPerson(album)}>
              <div class="thumb">
                <img class="card-img" src={api.people.faceThumbnailUrl(album.id)} alt={album.name}
                  on:error={(e) => { const el = e.currentTarget; el.style.display='none'; el.nextElementSibling?.removeAttribute('style'); }} />
                <div class="placeholder" style="display:none">👤</div>
              </div>
              <div class="card-info">
                <div class="card-name">{album.name || '…'}</div>
                <div class="card-count">{album.assetCount} photo{album.assetCount !== 1 ? 's' : ''}</div>
              </div>
            </div>
          {/each}
        </div>
      </section>
    {/if}

    {#if data.locations.length > 0}
      <section>
        <div class="section-header">
          <span class="section-title">📍 Locations</span>
          <span class="section-count">{data.locations.length} places</span>
        </div>
        <div class="cards">
          {#each data.locations as album}
            <div class="card" on:click={() => openLocation(album)} role="button" tabindex="0"
              on:keydown={(e) => e.key === 'Enter' && openLocation(album)}>
              <div class="thumb">
                {#if album.coverAssetId}
                  <img class="card-img" src={api.assets.thumbnailUrl(album.coverAssetId)} alt={album.name} />
                {:else}
                  <div class="placeholder">📍</div>
                {/if}
              </div>
              <div class="card-info">
                <div class="card-name">{album.name}</div>
                <div class="card-count">{album.assetCount} photo{album.assetCount !== 1 ? 's' : ''}</div>
              </div>
            </div>
          {/each}
        </div>
      </section>
    {/if}

    {#if data.months.length > 0}
      <section>
        <div class="section-header">
          <span class="section-title">📅 By Month</span>
          <span class="section-count">{data.months.length} periods</span>
        </div>
        <div class="cards">
          {#each data.months as album}
            <div class="card" on:click={() => openMonth(album)} role="button" tabindex="0"
              on:keydown={(e) => e.key === 'Enter' && openMonth(album)}>
              <div class="thumb">
                {#if album.coverAssetId}
                  <img class="card-img" src={api.assets.thumbnailUrl(album.coverAssetId)} alt={album.name} />
                {:else}
                  <div class="placeholder">📅</div>
                {/if}
              </div>
              <div class="card-info">
                <div class="card-name">{album.name}</div>
                <div class="card-count">{album.assetCount} item{album.assetCount !== 1 ? 's' : ''}</div>
              </div>
            </div>
          {/each}
        </div>
      </section>
    {/if}

    {#if data.tags.length > 0}
      <section>
        <div class="section-header">
          <span class="section-title">🏷 Scene Tags</span>
          <span class="section-count">{data.tags.length} tags</span>
        </div>
        <div class="tag-cloud">
          {#each data.tags as album}
            <button class="tag-pill" on:click={() => openTag(album)}>
              {album.name}<span class="tag-count">{album.assetCount}</span>
            </button>
          {/each}
        </div>
      </section>
    {/if}

  {/if}
</div>

<PhotoViewer
  bind:viewerIndex
  assets={viewerAssets}
  mode="default"
  on:assetUpdated={handleAssetUpdated}
  on:assetRemoved={handleAssetRemoved}
/>
