<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { page as pageStore } from '$app/stores';
  import { api } from '$lib/api';
  import { isAuthenticated } from '$lib/stores';
  import type { Asset } from '$lib/api';
  import PhotoViewer from '$lib/PhotoViewer.svelte';

  $: query = $pageStore.url.searchParams.get('q') ?? '';
  $: month = $pageStore.url.searchParams.get('month') ?? '';
  $: location = $pageStore.url.searchParams.get('location') ?? '';

  let assets: Asset[] = [];
  let loading = false;
  let error = '';
  let resultMode = '';
  let total = 0;
  let searchMode: 'auto' | 'text' | 'semantic' = 'auto';
  let currentKey = '';
  let viewerIndex = -1;

  onMount(async () => {
    if (!$isAuthenticated) { goto('/'); return; }
    if (query || month || location) await doSearch(query, month, location);
  });

  $: {
    const key = query + '|' + month + '|' + location;
    if ((query || month || location) && key !== currentKey) {
      currentKey = key;
      doSearch(query, month, location);
    }
  }

  async function doSearch(q: string, m: string, loc: string) {
    if (!q.trim() && !m && !loc) return;
    loading = true; error = ''; viewerIndex = -1;
    try {
      const r = await api.search.search(q, searchMode, m, loc);
      assets = r.assets; total = r.total; resultMode = r.mode;
    } catch (e) { error = e instanceof Error ? e.message : 'Search failed'; }
    finally { loading = false; }
  }

  async function changeMode(mode: typeof searchMode) {
    searchMode = mode;
    if (query || month || location) await doSearch(query, month, location);
  }

  function handleAssetUpdated(e: CustomEvent<Asset>) {
    assets = assets.map(a => a.id === e.detail.id ? e.detail : a);
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
  function getSimilarity(asset: any): number | undefined { return asset.similarity; }
</script>

<style>
  .page { padding: 1.5rem; max-width: 1600px; margin: 0 auto; }
  .header { margin-bottom: 1rem; }
  h2 { font-size: 1.5rem; font-weight: 700; margin-bottom: 0.75rem; }
  .toolbar { display: flex; align-items: center; gap: 1rem; flex-wrap: wrap; }
  .mode-toggle { display: flex; gap: 0.3rem; }
  .mode-btn { padding: 0.3rem 0.7rem; background: var(--surface-2); border: 1px solid var(--border); border-radius: 6px; color: var(--text-muted); font-size: 0.85rem; cursor: pointer; }
  .mode-btn.active { background: var(--accent); border-color: var(--accent); color: #fff; }
  .result-info { color: var(--text-muted); font-size: 0.85rem; }
  .loading, .error-msg, .empty, .placeholder { text-align: center; padding: 4rem 2rem; color: var(--text-muted); }
  .error-msg { color: var(--error); }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 4px; }
  .tile { aspect-ratio: 1; overflow: hidden; border-radius: 4px; background: var(--surface-2); position: relative; cursor: pointer; }
  .tile img { width: 100%; height: 100%; object-fit: cover; display: block; transition: transform 0.2s; }
  .tile:hover img { transform: scale(1.03); }
  .tile:hover .overlay { opacity: 1; }
  .overlay { position: absolute; inset: 0; background: linear-gradient(to top, rgba(0,0,0,0.7) 0%, transparent 50%); opacity: 0; transition: opacity 0.2s; display: flex; align-items: flex-end; padding: 0.5rem; pointer-events: none; }
  .info { font-size: 0.75rem; color: #fff; }
  .name { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .meta { color: #ccc; }
  .broken { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; font-size: 2rem; color: var(--border-2); }
  .similarity { position: absolute; top: 0.4rem; right: 0.4rem; background: rgba(37,99,235,0.85); border-radius: 4px; padding: 2px 5px; font-size: 0.7rem; color: #fff; font-weight: 600; }
</style>

<div class="page">
  <div class="header">
    <h2>Search{month ? `: ${month}` : location ? `: ${location}` : query ? `: "${query}"` : ''}</h2>
    <div class="toolbar">
      <div class="mode-toggle">
        <button class="mode-btn" class:active={searchMode === 'auto'}     on:click={() => changeMode('auto')}>Auto</button>
        <button class="mode-btn" class:active={searchMode === 'text'}     on:click={() => changeMode('text')}>Text</button>
        <button class="mode-btn" class:active={searchMode === 'semantic'} on:click={() => changeMode('semantic')}>Semantic</button>
      </div>
      {#if !loading && assets.length > 0}
        <span class="result-info">{total} result{total !== 1 ? 's' : ''} via {resultMode} search</span>
      {/if}
    </div>
  </div>

  {#if !query && !month && !location}
    <div class="placeholder">Enter a search term in the search bar above.</div>
  {:else if loading}
    <div class="loading">Searching{searchMode === 'semantic' ? ' (semantic search may take a moment)' : ''}...</div>
  {:else if error}
    <div class="error-msg">{error}</div>
  {:else if assets.length === 0}
    <div class="empty">
      {#if searchMode === 'semantic'}
        No similar photos found. Make sure CLIP processing has run on your photos first.
      {:else}
        No results for "{query}".
      {/if}
    </div>
  {:else}
    <div class="grid">
      {#each assets as asset, i (asset.id)}
        <div class="tile" on:click={() => viewerIndex = i} role="button" tabindex="0"
          on:keydown={(e) => e.key === 'Enter' && (viewerIndex = i)}>
          {#if asset.type !== 'OTHER'}
            <img src={api.assets.thumbnailUrl(asset.id)} alt={asset.fileName} loading="lazy"
              on:error={(e) => imgError(e)} />
            <div class="broken" style="display:none">&#128247;</div>
          {:else}
            <div class="broken">&#128196;</div>
          {/if}
          {#if getSimilarity(asset) !== undefined}
            <span class="similarity">{Math.round(getSimilarity(asset) * 100)}%</span>
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
  {/if}
</div>

<PhotoViewer
  bind:viewerIndex
  {assets}
  mode="default"
  on:assetUpdated={handleAssetUpdated}
  on:assetRemoved={handleAssetRemoved}
/>
