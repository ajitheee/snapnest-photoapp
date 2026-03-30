<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { api } from '$lib/api';
  import { isAuthenticated } from '$lib/stores';
  import type { MemoryYearGroup, MemoryAsset } from '$lib/api';
  import PhotoViewer from '$lib/PhotoViewer.svelte';

  let data: { people: any[]; locations: any[]; months: any[]; tags: any[]; videos: any[] } | null = null;
  let loading = true;
  let error = '';

  let yearGroups: MemoryYearGroup[] = [];
  let memoriesLoading = true;

  // PhotoViewer state for memories
  let viewerAssets: any[] = [];
  let viewerIndex = -1;

  onMount(async () => {
    if (!$isAuthenticated) { goto('/'); return; }
    const [smartResult, memoriesResult] = await Promise.allSettled([
      api.smartAlbums.list(),
      api.memories.get(),
    ]);
    if (smartResult.status === 'fulfilled') data = smartResult.value;
    else error = smartResult.reason?.message ?? 'Failed to load';
    if (memoriesResult.status === 'fulfilled') yearGroups = memoriesResult.value.yearGroups;
    loading = false;
    memoriesLoading = false;
  });

  function openMemoryViewer(group: MemoryYearGroup, index: number) {
    viewerAssets = group.assets as MemoryAsset[];
    viewerIndex = index;
  }

  function openPerson(album: any) {
    goto(`/people/${album.criteria.personId}`);
  }

  function openLocation(album: any) {
    goto(`/search?location=${encodeURIComponent(album.name)}`);
  }

  function openMonth(album: any) {
    goto(`/search?month=${encodeURIComponent(album.criteria.month)}`);
  }

  function openTag(album: any) {
    goto(`/search?q=${encodeURIComponent(album.name)}`);
  }

  function openVideo(album: any) {
    goto(`/videos?month=${encodeURIComponent(album.criteria.month)}`);
  }
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

  /* ── Memories ── */
  .memory-group { margin-bottom: 1.75rem; }
  .memory-label { font-size: 1rem; font-weight: 700; margin-bottom: 0.5rem; color: var(--text); }
  .memory-sub { font-size: 0.8rem; color: var(--text-muted); margin-left: 0.5rem; font-weight: 400; }
  .memory-strip {
    display: flex;
    gap: 6px;
    overflow-x: auto;
    padding-bottom: 4px;
    scrollbar-width: thin;
    scrollbar-color: var(--border) transparent;
  }
  .memory-strip::-webkit-scrollbar { height: 4px; }
  .memory-strip::-webkit-scrollbar-thumb { background: var(--border); border-radius: 2px; }
  .memory-thumb {
    flex: 0 0 auto;
    width: 140px;
    height: 140px;
    border-radius: 8px;
    overflow: hidden;
    background: var(--surface-2);
    cursor: pointer;
    position: relative;
  }
  .memory-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; transition: transform 0.2s; }
  .memory-thumb:hover img { transform: scale(1.05); }
  .memory-thumb .mem-placeholder { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; font-size: 2rem; color: var(--text-muted); }
  .memory-more {
    flex: 0 0 auto;
    width: 140px;
    height: 140px;
    border-radius: 8px;
    background: var(--surface-2);
    border: 1px solid var(--border);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 0.85rem;
    color: var(--text-muted);
    cursor: default;
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
      {#each yearGroups as group}
        <div class="memory-group">
          <div class="memory-label">
            {group.label}
            <span class="memory-sub">{group.year} · {group.count} photo{group.count !== 1 ? 's' : ''}</span>
          </div>
          <div class="memory-strip">
            {#each group.assets as asset, i}
              <div class="memory-thumb" on:click={() => openMemoryViewer(group, i)}
                role="button" tabindex="0"
                on:keydown={(e) => e.key === 'Enter' && openMemoryViewer(group, i)}>
                {#if asset.thumbnailSmallPath}
                  <img src={api.assets.thumbnailUrl(asset.id)} alt={asset.fileName} loading="lazy" />
                {:else}
                  <div class="mem-placeholder">🖼</div>
                {/if}
              </div>
            {/each}
            {#if group.count > group.assets.length}
              <div class="memory-more">+{group.count - group.assets.length} more</div>
            {/if}
          </div>
        </div>
      {/each}
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
          <span class="section-count">{data.videos.reduce((s, v) => s + v.assetCount, 0)} videos · {data.videos.length} period{data.videos.length !== 1 ? 's' : ''}</span>
        </div>
        <div class="cards">
          {#each data.videos as album}
            <div class="card" on:click={() => openVideo(album)} role="button" tabindex="0"
              on:keydown={(e) => e.key === 'Enter' && openVideo(album)}>
              <div class="thumb-wrap">
                {#if album.coverAssetId}
                  <img class="card-img" src={api.assets.thumbnailUrl(album.coverAssetId)} alt={album.name} />
                {:else}
                  <div class="placeholder">🎬</div>
                {/if}
                <span class="video-overlay">VIDEO</span>
              </div>
              <div class="card-info">
                <div class="card-name">{album.name}</div>
                <div class="card-count">{album.assetCount} video{album.assetCount !== 1 ? 's' : ''}</div>
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
                {#if album.coverAssetId}
                  <img class="card-img" src={api.assets.thumbnailUrl(album.coverAssetId)} alt={album.name} />
                {:else}
                  <div class="placeholder">👤</div>
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
/>
