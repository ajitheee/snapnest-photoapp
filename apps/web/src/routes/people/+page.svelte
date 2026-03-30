<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { api } from '$lib/api';
  import { isAuthenticated } from '$lib/stores';

  let people: any[] = [];
  let loading = true;
  let clustering = false;
  let error = '';
  let clusterMsg = '';

  onMount(async () => {
    if (!$isAuthenticated) { goto('/'); return; }
    await load();
  });

  async function load() {
    loading = true; error = '';
    try { people = await api.people.list(); }
    catch (e) { error = e instanceof Error ? e.message : 'Failed to load'; }
    finally { loading = false; }
  }

  async function runClustering() {
    clustering = true; clusterMsg = '';
    try {
      const r = await api.people.cluster();
      clusterMsg = `Done — ${r.created} new, ${r.updated} updated, ${r.total} total groups`;
      await load();
    } catch (e) {
      error = e instanceof Error ? e.message : 'Clustering failed';
    } finally { clustering = false; }
  }
</script>

<style>
  .page { padding: 1.5rem; max-width: 1600px; margin: 0 auto; }
  .header { display: flex; align-items: center; gap: 1rem; margin-bottom: 1.5rem; flex-wrap: wrap; }
  h2 { font-size: 1.5rem; font-weight: 700; flex: 1; }
  .cluster-btn { padding: 0.5rem 1rem; background: var(--accent); border: none; border-radius: 8px; color: #fff; font-size: 0.9rem; font-weight: 600; }
  .cluster-btn:disabled { opacity: 0.6; cursor: not-allowed; }
  .cluster-msg { font-size: 0.85rem; color: var(--accent); }
  .loading, .error-msg, .empty { text-align: center; padding: 4rem 2rem; color: var(--text-muted); }
  .error-msg { color: var(--error); }
  .note { color: var(--text-muted); font-size: 0.85rem; margin-bottom: 1.5rem; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 12px; }
  .card { border-radius: 12px; overflow: hidden; background: var(--surface); border: 1px solid var(--border); cursor: pointer; position: relative; }
  .card:hover .card-overlay { opacity: 1; }
  .thumb { width: 100%; aspect-ratio: 1; background: var(--surface-2); position: relative; overflow: hidden; }
  .thumb img { width: 100%; height: 100%; object-fit: cover; display: block; transition: transform 0.2s; }
  .card:hover .thumb img { transform: scale(1.05); }
  .avatar-placeholder { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; font-size: 3rem; background: var(--surface-2); }
  .card-info { padding: 0.6rem 0.75rem 0.75rem; }
  .card-name { font-size: 0.9rem; font-weight: 600; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .card-count { font-size: 0.78rem; color: var(--text-muted); margin-top: 2px; }
</style>

<div class="page">
  <div class="header">
    <h2>People</h2>
    <button class="cluster-btn" on:click={runClustering} disabled={clustering}>
      {clustering ? 'Clustering…' : '⟳ Identify Faces'}
    </button>
  </div>

  {#if clusterMsg}
    <p class="cluster-msg" style="margin-bottom:1rem">{clusterMsg}</p>
  {/if}
  <p class="note">PhotoApp uses AI face recognition to group photos by person. Click "Identify Faces" to run clustering, then tap a person to rename them.</p>

  {#if loading}
    <div class="loading">Loading people…</div>
  {:else if error}
    <div class="error-msg">{error}</div>
  {:else if people.length === 0}
    <div class="empty">
      <p>No people identified yet.</p>
      <p style="margin-top:0.5rem">Click <strong>Identify Faces</strong> to analyse your photos.</p>
    </div>
  {:else}
    <div class="grid">
      {#each people as person (person.id)}
        <a class="card" href="/people/{person.id}">
          <div class="thumb">
            {#if person.coverAssetId}
              <img src={api.assets.thumbnailUrl(person.coverAssetId)} alt={person.name} />
            {:else}
              <div class="avatar-placeholder">👤</div>
            {/if}
          </div>
          <div class="card-info">
            <div class="card-name">{person.name}</div>
            <div class="card-count">{person.faceCount} photo{person.faceCount !== 1 ? 's' : ''}</div>
          </div>
        </a>
      {/each}
    </div>
  {/if}
</div>
