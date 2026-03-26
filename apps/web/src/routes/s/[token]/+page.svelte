<script lang="ts">
  import { onMount } from 'svelte';
  import { page as pageStore } from '$app/stores';
  import { api } from '$lib/api';
  import type { Asset } from '$lib/api';

  $: token = $pageStore.params.token;

  let data: any = null;
  let loading = true;
  let error = '';
  let needPassword = false;
  let password = '';
  let expired = false;

  onMount(() => resolve());

  async function resolve(pw?: string) {
    loading = true; error = '';
    try {
      data = await api.sharing.resolvePublic(token, pw);
      needPassword = false;
    } catch (e: any) {
      const msg = e?.message || '';
      if (msg.includes('Password required')) { needPassword = true; }
      else if (msg.includes('expired')) { expired = true; error = 'This share link has expired.'; }
      else if (msg.includes('Incorrect')) { error = 'Incorrect password.'; }
      else { error = msg || 'Link not found.'; }
    } finally { loading = false; }
  }

  function getAssets(): Asset[] {
    if (!data) return [];
    if (data.album) return (data.album.assets || []).map((aa: any) => aa.asset);
    if (data.asset) return [data.asset];
    return [];
  }

  function formatDate(d: string) {
    return new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  }
  function formatSize(b: string) {
    const n = parseInt(b, 10);
    return n < 1048576 ? `${(n/1024).toFixed(1)} KB` : `${(n/1048576).toFixed(1)} MB`;
  }
  function imgError(e: Event) {
    const el = e.currentTarget as HTMLImageElement;
    el.style.display = 'none';
    const next = el.nextElementSibling as HTMLElement;
    if (next) next.style.removeProperty('display');
  }
</script>

<style>
  :global(body) { background: #0a0a0a; color: #fff; font-family: system-ui, sans-serif; }
  .wrap { max-width: 1400px; margin: 0 auto; padding: 2rem 1.5rem; }
  .brand { font-size: 1.1rem; font-weight: 700; color: #4f8ef7; margin-bottom: 2rem; }
  .loading, .error-msg, .expired-msg { text-align: center; padding: 4rem 2rem; color: #666; }
  .error-msg { color: #f87171; }
  h1 { font-size: 1.5rem; font-weight: 700; margin-bottom: 0.5rem; }
  .meta { color: #666; font-size: 0.9rem; margin-bottom: 1.5rem; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 4px; }
  .tile { aspect-ratio: 1; overflow: hidden; border-radius: 4px; background: #1a1a1a; position: relative; }
  .tile img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .tile:hover .overlay { opacity: 1; }
  .overlay { position: absolute; inset: 0; background: linear-gradient(to top, rgba(0,0,0,0.7) 0%, transparent 50%); opacity: 0; transition: opacity 0.2s; display: flex; align-items: flex-end; padding: 0.4rem; }
  .info { font-size: 0.75rem; color: #fff; }
  .name { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .broken { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; font-size: 2rem; color: #333; }
  .pw-form { max-width: 360px; margin: 4rem auto; background: #111; border: 1px solid #333; border-radius: 12px; padding: 2rem; display: flex; flex-direction: column; gap: 1rem; }
  .pw-form h2 { font-size: 1.1rem; font-weight: 700; text-align: center; }
  .pw-form input { background: #0a0a0a; border: 1px solid #333; border-radius: 6px; color: #fff; padding: 0.5rem 0.75rem; font-size: 0.95rem; width: 100%; }
  .pw-form button { padding: 0.6rem; background: #4f8ef7; border: none; border-radius: 6px; color: #fff; font-weight: 600; font-size: 0.95rem; }
  .pw-err { color: #f87171; font-size: 0.85rem; text-align: center; }
</style>

<div class="wrap">
  <div class="brand">PhotoApp</div>

  {#if loading}
    <div class="loading">Loading...</div>
  {:else if needPassword}
    <div class="pw-form">
      <h2>&#128274; Password Protected</h2>
      <input type="password" bind:value={password} placeholder="Enter password" on:keydown={(e) => e.key === 'Enter' && resolve(password)} />
      {#if error}<div class="pw-err">{error}</div>{/if}
      <button on:click={() => resolve(password)}>Unlock</button>
    </div>
  {:else if expired || (error && !data)}
    <div class="error-msg">{error || 'This link is no longer available.'}</div>
  {:else if data}
    {@const assets = getAssets()}
    <h1>{data.album ? data.album.name : assets[0]?.fileName ?? 'Shared Photo'}</h1>
    <p class="meta">{assets.length} photo{assets.length !== 1 ? 's' : ''}</p>
    <div class="grid">
      {#each assets as asset (asset.id)}
        <div class="tile">
          {#if asset.type !== 'OTHER'}
            <img src="/api/assets/{asset.id}/thumbnail" alt={asset.fileName} loading="lazy"
              on:error={(e) => imgError(e)} />
            <div class="broken" style="display:none">&#128247;</div>
          {:else}
            <div class="broken">&#128196;</div>
          {/if}
          <div class="overlay">
            <div class="info">
              <div class="name">{asset.fileName}</div>
            </div>
          </div>
        </div>
      {/each}
    </div>
  {/if}
</div>
