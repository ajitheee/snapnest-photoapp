<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { api } from '$lib/api';
  import { isAuthenticated } from '$lib/stores';
  import type { Album } from '$lib/api';

  let albums: Album[] = [];
  let loading = true;
  let error = '';
  let showCreate = false;
  let newName = '';
  let newDesc = '';
  let creating = false;
  let createError = '';

  onMount(async () => {
    if (!$isAuthenticated) { goto('/'); return; }
    await load();
  });

  async function load() {
    loading = true; error = '';
    try { albums = await api.albums.list(); }
    catch (e) { error = e instanceof Error ? e.message : 'Failed to load'; }
    finally { loading = false; }
  }

  async function createAlbum() {
    if (!newName.trim()) return;
    creating = true; createError = '';
    try {
      const album = await api.albums.create(newName.trim(), newDesc.trim() || undefined);
      albums = [album, ...albums];
      showCreate = false; newName = ''; newDesc = '';
    } catch (e) { createError = e instanceof Error ? e.message : 'Failed to create'; }
    finally { creating = false; }
  }

  async function deleteAlbum(album: Album) {
    if (!confirm(`Delete album "${album.name}"?`)) return;
    await api.albums.remove(album.id);
    albums = albums.filter(a => a.id !== album.id);
  }
</script>

<style>
  .page { padding: 1.5rem; max-width: 1400px; margin: 0 auto; }
  .header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 1.5rem; }
  h2 { font-size: 1.5rem; font-weight: 700; }
  .new-btn { padding: 0.5rem 1rem; background: var(--accent); border: none; border-radius: 8px; color: #fff; font-size: 0.9rem; font-weight: 600; }
  .new-btn:hover { background: var(--accent-hover); }
  .create-form { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 1.2rem; margin-bottom: 1.5rem; display: flex; flex-direction: column; gap: 0.8rem; }
  .create-form input, .create-form textarea { background: var(--surface-2); border: 1px solid var(--border); border-radius: 6px; color: var(--text); padding: 0.5rem 0.75rem; font-size: 0.9rem; width: 100%; }
  .create-form textarea { resize: vertical; min-height: 60px; }
  .form-actions { display: flex; gap: 0.5rem; justify-content: flex-end; }
  .btn-cancel { padding: 0.4rem 0.8rem; background: var(--surface-2); border: 1px solid var(--border-2); border-radius: 6px; color: var(--text-muted); font-size: 0.9rem; }
  .btn-save { padding: 0.4rem 0.8rem; background: var(--accent); border: none; border-radius: 6px; color: #fff; font-size: 0.9rem; font-weight: 600; }
  .btn-save:disabled { opacity: 0.5; cursor: not-allowed; }
  .form-err { color: var(--error); font-size: 0.85rem; }
  .loading, .error-msg, .empty { text-align: center; padding: 4rem 2rem; color: var(--text-muted); }
  .error-msg { color: var(--error); }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 1rem; }
  .album-card { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; overflow: hidden; cursor: pointer; transition: border-color 0.15s; }
  .album-card:hover { border-color: var(--border-2); }
  .cover { aspect-ratio: 4/3; background: var(--surface-2); overflow: hidden; }
  .cover img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .cover-placeholder { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; font-size: 2.5rem; color: var(--border-2); }
  .card-body { padding: 0.75rem; }
  .album-name { font-weight: 600; font-size: 0.95rem; margin-bottom: 0.2rem; }
  .album-meta { color: var(--text-muted); font-size: 0.8rem; display: flex; justify-content: space-between; }
  .del-btn { background: none; border: none; color: var(--text-subtle); font-size: 0.8rem; cursor: pointer; padding: 0; }
  .del-btn:hover { color: var(--error); }
</style>

<div class="page">
  <div class="header">
    <h2>Albums</h2>
    <button class="new-btn" on:click={() => showCreate = !showCreate}>+ New Album</button>
  </div>

  {#if showCreate}
    <div class="create-form">
      <input bind:value={newName} placeholder="Album name" maxlength="200" />
      <textarea bind:value={newDesc} placeholder="Description (optional)"></textarea>
      {#if createError}<div class="form-err">{createError}</div>{/if}
      <div class="form-actions">
        <button class="btn-cancel" on:click={() => { showCreate = false; newName = ''; newDesc = ''; }}>Cancel</button>
        <button class="btn-save" on:click={createAlbum} disabled={creating || !newName.trim()}>
          {creating ? 'Creating...' : 'Create'}
        </button>
      </div>
    </div>
  {/if}

  {#if loading}
    <div class="loading">Loading albums...</div>
  {:else if error}
    <div class="error-msg">{error}</div>
  {:else if albums.length === 0}
    <div class="empty">No albums yet. Create one to organise your photos.</div>
  {:else}
    <div class="grid">
      {#each albums as album (album.id)}
        <div class="album-card" on:click={() => goto(`/albums/${album.id}`)} role="button" tabindex="0"
          on:keydown={(e) => e.key === 'Enter' && goto(`/albums/${album.id}`)}>
          <div class="cover">
            {#if album.coverAssetId}
              <img src={api.assets.thumbnailUrl(album.coverAssetId)} alt={album.name} />
            {:else}
              <div class="cover-placeholder">&#128193;</div>
            {/if}
          </div>
          <div class="card-body">
            <div class="album-name">{album.name}</div>
            <div class="album-meta">
              <span>{album._count?.assets ?? 0} photos</span>
              <button class="del-btn" on:click|stopPropagation={() => deleteAlbum(album)}>Delete</button>
            </div>
          </div>
        </div>
      {/each}
    </div>
  {/if}
</div>
