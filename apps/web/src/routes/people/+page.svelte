<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { goto } from '$app/navigation';
  import { api } from '$lib/api';
  import { isAuthenticated } from '$lib/stores';

  const AUTO_REFRESH_MS = 5 * 60 * 1000; // 5 minutes
  let refreshTimer: ReturnType<typeof setInterval> | undefined;

  let people: any[] = [];
  let loading = true;
  let clustering = false;
  let error = '';
  let clusterMsg = '';

  // Merge mode: first click selects source, second click merges into target
  let mergeMode = false;
  let mergeSource: any | null = null;
  let merging = false;

  function toggleMergeMode() {
    mergeMode = !mergeMode;
    mergeSource = null;
  }

  async function handlePersonClick(person: any) {
    if (!mergeMode) return;
    if (!mergeSource) {
      mergeSource = person;
      return;
    }
    if (mergeSource.id === person.id) {
      mergeSource = null;
      return;
    }
    // Merge mergeSource → person (target keeps name + all faces)
    if (!confirm(`Merge "${mergeSource.name || 'Unnamed'}" into "${person.name || 'Unnamed'}"? This cannot be undone.`)) {
      mergeSource = null;
      return;
    }
    merging = true;
    try {
      await api.people.merge(mergeSource.id, person.id);
      mergeSource = null;
      mergeMode = false;
      await load();
    } catch (e) {
      error = e instanceof Error ? e.message : 'Merge failed';
    } finally {
      merging = false;
    }
  }

  onMount(async () => {
    if (!$isAuthenticated) { goto('/'); return; }
    await load();
    refreshTimer = setInterval(() => load(), AUTO_REFRESH_MS);
  });

  onDestroy(() => {
    if (refreshTimer !== undefined) clearInterval(refreshTimer);
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
  .card.merge-selected { border: 2.5px solid var(--accent); box-shadow: 0 0 0 3px var(--accent-light); }
  .thumb { width: 100%; aspect-ratio: 1; background: var(--surface-2); position: relative; overflow: hidden; }
  .thumb img { width: 100%; height: 100%; object-fit: cover; display: block; transition: transform 0.2s; }
  .card:hover .thumb img { transform: scale(1.05); }
  .avatar-placeholder { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; font-size: 3rem; background: var(--surface-2); }
  .card-info { padding: 0.6rem 0.75rem 0.75rem; }
  .card-name { font-size: 0.9rem; font-weight: 600; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .card-name.unnamed { color: var(--text-muted); font-weight: 400; font-style: italic; }
  .card-count { font-size: 0.78rem; color: var(--text-muted); margin-top: 2px; }
</style>

<div class="page">
  <div class="header">
    <h2>People</h2>
    <button class="cluster-btn" on:click={runClustering} disabled={clustering}>
      {clustering ? 'Clustering…' : '⟳ Identify Faces'}
    </button>
    <button class="cluster-btn" style="background:var(--surface);border:1.5px solid var(--border);color:var(--text-muted)"
      class:active={mergeMode} on:click={toggleMergeMode} disabled={merging}>
      {merging ? 'Merging…' : mergeMode ? '✕ Cancel Merge' : '⊕ Merge'}
    </button>
  </div>

  {#if mergeMode}
    <p class="cluster-msg" style="margin-bottom:1rem;color:var(--text-2)">
      {#if mergeSource}
        Now click the person to merge <strong>{mergeSource.name || 'Unnamed'}</strong> into.
      {:else}
        Click the person to merge away (their photos will be moved to the person you click next).
      {/if}
    </p>
  {/if}

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
        {#if mergeMode}
          <!-- svelte-ignore a11y-click-events-have-key-events -->
          <!-- svelte-ignore a11y-no-static-element-interactions -->
          <div class="card"
            class:merge-selected={mergeSource?.id === person.id}
            style="cursor:pointer"
            on:click={() => handlePersonClick(person)}>
            <div class="thumb">
              {#if person.faceCount > 0}
                <img src={api.people.faceThumbnailUrl(person.id)} alt={person.name}
                  on:error={(e) => { const el = e.currentTarget; el.style.display='none'; el.nextElementSibling?.removeAttribute('style'); }} />
                <div class="avatar-placeholder" style="display:none">👤</div>
              {:else}
                <div class="avatar-placeholder">👤</div>
              {/if}
            </div>
            <div class="card-info">
              <div class="card-name" class:unnamed={!person.name}>{person.name || 'Select'}</div>
              <div class="card-count">{person.faceCount} photo{person.faceCount !== 1 ? 's' : ''}</div>
            </div>
          </div>
        {:else}
          <a class="card" href="/people/{person.id}">
            <div class="thumb">
              {#if person.faceCount > 0}
                <img src={api.people.faceThumbnailUrl(person.id)} alt={person.name}
                  on:error={(e) => { const el = e.currentTarget; el.style.display='none'; el.nextElementSibling?.removeAttribute('style'); }} />
                <div class="avatar-placeholder" style="display:none">👤</div>
              {:else}
                <div class="avatar-placeholder">👤</div>
              {/if}
            </div>
            <div class="card-info">
              <div class="card-name" class:unnamed={!person.name}>{person.name || 'Tap to name'}</div>
              <div class="card-count">{person.faceCount} photo{person.faceCount !== 1 ? 's' : ''}</div>
            </div>
          </a>
        {/if}
      {/each}
    </div>
  {/if}
</div>
