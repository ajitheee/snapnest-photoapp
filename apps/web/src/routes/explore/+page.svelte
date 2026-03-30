<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { api } from '$lib/api';
  import { isAuthenticated } from '$lib/stores';

  let data: { months: any[]; locations: any[]; tags: any[]; total: number } | null = null;
  let loading = true;
  let error = '';

  onMount(async () => {
    if (!$isAuthenticated) { goto('/'); return; }
    try {
      data = await api.assets.explore();
    } catch (e) {
      error = e instanceof Error ? e.message : 'Failed to load';
    } finally {
      loading = false;
    }
  });

  function imgError(e: Event) {
    const el = e.currentTarget as HTMLImageElement;
    el.style.display = 'none';
    const next = el.nextElementSibling as HTMLElement;
    if (next) next.style.removeProperty('display');
  }

  function searchTag(tag: string) {
    goto(`/search?q=${encodeURIComponent(tag)}`);
  }
  function searchMonth(key: string) {
    goto(`/search?month=${encodeURIComponent(key)}`);
  }
  function searchLocation(loc: string) {
    goto(`/search?location=${encodeURIComponent(loc)}`);
  }
</script>

<style>
  .page { padding: 1.5rem; max-width: 1600px; margin: 0 auto; }
  h2 { font-size: 1.5rem; font-weight: 700; margin-bottom: 1.5rem; }
  .loading, .error-msg, .empty { text-align: center; padding: 4rem 2rem; color: var(--text-muted); }
  .error-msg { color: var(--error); }
  section { margin-bottom: 2.5rem; }
  .section-header { display: flex; align-items: baseline; gap: 0.75rem; margin-bottom: 1rem; }
  .section-title { font-size: 1.1rem; font-weight: 700; }
  .section-count { color: var(--text-muted); font-size: 0.85rem; }
  /* Month / location cards */
  .cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 8px; }
  .card { border-radius: 10px; overflow: hidden; background: var(--surface-2); cursor: pointer; position: relative; aspect-ratio: 4/3; }
  .card:hover .card-overlay { opacity: 1; }
  .card-img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .card-placeholder { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; font-size: 2rem; color: var(--border-2); }
  .card-overlay { position: absolute; inset: 0; background: linear-gradient(to top, rgba(0,0,0,0.75) 0%, transparent 55%);
    display: flex; flex-direction: column; justify-content: flex-end; padding: 0.6rem; transition: opacity 0.2s; opacity: 1; }
  .card-label { font-size: 0.85rem; font-weight: 700; color: #fff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .card-sub { font-size: 0.75rem; color: #ccc; margin-top: 1px; }
  /* Tags */
  .tag-cloud { display: flex; flex-wrap: wrap; gap: 0.5rem; }
  .tag-pill { padding: 0.3rem 0.75rem; background: var(--surface-2); border: 1px solid var(--border);
    border-radius: 999px; color: var(--text-2); font-size: 0.85rem; cursor: pointer; transition: border-color 0.15s, color 0.15s; }
  .tag-pill:hover { border-color: var(--accent); color: var(--accent); }
  .tag-count { color: var(--text-subtle); font-size: 0.75rem; margin-left: 0.25rem; }
  /* No-data hint */
  .hint { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 1.5rem; color: var(--text-muted); font-size: 0.85rem; }
</style>

<div class="page">
  <h2>Explore</h2>

  {#if loading}
    <div class="loading">Loading...</div>
  {:else if error}
    <div class="error-msg">{error}</div>
  {:else if !data || data.total === 0}
    <div class="empty">Upload some photos to start exploring your library.</div>
  {:else}

    <!-- Months -->
    {#if data.months.length > 0}
      <section>
        <div class="section-header">
          <span class="section-title">By Month</span>
          <span class="section-count">{data.months.length} period{data.months.length !== 1 ? 's' : ''}</span>
        </div>
        <div class="cards">
          {#each data.months as m}
            <div class="card" on:click={() => searchMonth(m.key)} role="button" tabindex="0"
              on:keydown={(e) => e.key === 'Enter' && searchMonth(m.key)}>
              {#if m.cover && m.cover.type !== 'OTHER'}
                <img class="card-img" src={api.assets.thumbnailUrl(m.cover.id)} alt={m.label} loading="lazy"
                  on:error={(e) => imgError(e)} />
                <div class="card-placeholder" style="display:none">📅</div>
              {:else}
                <div class="card-placeholder">📅</div>
              {/if}
              <div class="card-overlay">
                <div class="card-label">{m.label}</div>
                <div class="card-sub">{m.count} photo{m.count !== 1 ? 's' : ''}</div>
              </div>
            </div>
          {/each}
        </div>
      </section>
    {/if}

    <!-- Locations -->
    {#if data.locations.length > 0}
      <section>
        <div class="section-header">
          <span class="section-title">By Location</span>
          <span class="section-count">{data.locations.length} place{data.locations.length !== 1 ? 's' : ''}</span>
        </div>
        <div class="cards">
          {#each data.locations as loc}
            <div class="card" on:click={() => searchLocation(loc.key)} role="button" tabindex="0"
              on:keydown={(e) => e.key === 'Enter' && searchLocation(loc.key)}>
              {#if loc.cover && loc.cover.type !== 'OTHER'}
                <img class="card-img" src={api.assets.thumbnailUrl(loc.cover.id)} alt={loc.key} loading="lazy"
                  on:error={(e) => imgError(e)} />
                <div class="card-placeholder" style="display:none">📍</div>
              {:else}
                <div class="card-placeholder">📍</div>
              {/if}
              <div class="card-overlay">
                <div class="card-label">{loc.key}</div>
                <div class="card-sub">{loc.count} photo{loc.count !== 1 ? 's' : ''}</div>
              </div>
            </div>
          {/each}
        </div>
      </section>
    {/if}

    <!-- Tags -->
    <section>
      <div class="section-header">
        <span class="section-title">Scene Tags</span>
        {#if data.tags.length > 0}
          <span class="section-count">{data.tags.length} tag{data.tags.length !== 1 ? 's' : ''}</span>
        {/if}
      </div>
      {#if data.tags.length === 0}
        <div class="hint">Scene tags will appear here once the ML service has processed your photos.</div>
      {:else}
        <div class="tag-cloud">
          {#each data.tags as t}
            <button class="tag-pill" on:click={() => searchTag(t.tag)}>
              {t.tag}<span class="tag-count">{t.count}</span>
            </button>
          {/each}
        </div>
      {/if}
    </section>

  {/if}
</div>
