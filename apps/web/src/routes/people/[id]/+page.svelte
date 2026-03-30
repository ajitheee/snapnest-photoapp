<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { page as pageStore } from '$app/stores';
  import { api } from '$lib/api';
  import { isAuthenticated } from '$lib/stores';
  import type { Asset } from '$lib/api';
  import PhotoViewer from '$lib/PhotoViewer.svelte';

  $: personId = $pageStore.params.id;

  let person: any = null;
  let assets: Asset[] = [];
  let loading = true;
  let error = '';
  let editing = false;
  let editName = '';
  let viewerIndex = -1;

  onMount(async () => {
    if (!$isAuthenticated) { goto('/'); return; }
    await load();
  });

  async function load() {
    loading = true; error = '';
    try {
      [person, { assets }] = await Promise.all([
        api.people.get(personId),
        api.people.getAssets(personId),
      ]);
      editName = person.name;
    } catch (e) {
      error = e instanceof Error ? e.message : 'Failed to load';
    } finally { loading = false; }
  }

  async function saveName() {
    if (!editName.trim()) return;
    try {
      person = await api.people.rename(personId, editName.trim());
      editing = false;
    } catch (e) { error = e instanceof Error ? e.message : 'Save failed'; }
  }

  function handleAssetUpdated(e: CustomEvent<Asset>) {
    assets = assets.map(a => a.id === e.detail.id ? e.detail : a);
  }
  function handleAssetRemoved(e: CustomEvent<string>) {
    assets = assets.filter(a => a.id !== e.detail);
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
  .back { color: var(--accent); text-decoration: none; font-size: 0.9rem; }
  .name-row { display: flex; align-items: center; gap: 0.5rem; flex: 1; }
  h2 { font-size: 1.5rem; font-weight: 700; }
  .edit-btn { background: none; border: 1px solid var(--border); border-radius: 6px; color: var(--text-muted); padding: 0.2rem 0.5rem; font-size: 0.8rem; }
  .edit-btn:hover { border-color: var(--border-2); color: var(--text); }
  .name-input { font-size: 1.3rem; font-weight: 700; background: var(--surface-2); border: 1px solid var(--accent); border-radius: 6px; color: var(--text); padding: 0.25rem 0.5rem; }
  .save-btn { background: var(--accent); border: none; border-radius: 6px; color: #fff; padding: 0.3rem 0.7rem; font-size: 0.85rem; font-weight: 600; }
  .count { color: var(--text-muted); font-size: 0.9rem; }
  .loading, .error-msg, .empty { text-align: center; padding: 4rem 2rem; color: var(--text-muted); }
  .error-msg { color: var(--error); }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 4px; }
  .tile { aspect-ratio: 1; overflow: hidden; border-radius: 4px; background: var(--surface-2); position: relative; cursor: pointer; }
  .tile img { width: 100%; height: 100%; object-fit: cover; display: block; transition: transform 0.2s; }
  .tile:hover img { transform: scale(1.03); }
  .broken { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; font-size: 2rem; color: var(--border-2); }
</style>

<div class="page">
  <div class="header">
    <a class="back" href="/people">&larr; People</a>
    {#if person}
      <div class="name-row">
        {#if editing}
          <input class="name-input" bind:value={editName} on:keydown={(e) => e.key === 'Enter' && saveName()} />
          <button class="save-btn" on:click={saveName}>Save</button>
          <button class="edit-btn" on:click={() => editing = false}>Cancel</button>
        {:else}
          <h2>{person.name}</h2>
          <button class="edit-btn" on:click={() => editing = true}>Rename</button>
        {/if}
      </div>
      <span class="count">{assets.length} photos</span>
    {/if}
  </div>

  {#if loading}
    <div class="loading">Loading…</div>
  {:else if error}
    <div class="error-msg">{error}</div>
  {:else if assets.length === 0}
    <div class="empty">No photos found for this person.</div>
  {:else}
    <div class="grid">
      {#each assets as asset, i (asset.id)}
        <div class="tile" on:click={() => viewerIndex = i} role="button" tabindex="0"
          on:keydown={(e) => e.key === 'Enter' && (viewerIndex = i)}>
          {#if asset.type !== 'OTHER'}
            <img src={api.assets.thumbnailUrl(asset.id)} alt={asset.fileName} loading="lazy"
              on:error={(e) => imgError(e)} />
            <div class="broken" style="display:none">📷</div>
          {:else}
            <div class="broken">📄</div>
          {/if}
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
