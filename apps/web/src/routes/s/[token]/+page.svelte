<script lang="ts">
  import { onMount } from 'svelte';
  import { page as pageStore } from '$app/stores';
  import { api } from '$lib/api';

  $: token = $pageStore.params.token;

  let data: any = null;
  let loading = true;
  let error = '';
  let needPassword = false;
  let password = '';
  let expired = false;

  // Lightbox
  let viewerIndex = -1;
  $: viewerAssets = data?.album
    ? (data.album.assets || []).map((aa: any) => aa.asset)
    : data?.asset ? [data.asset] : [];
  $: viewerAsset = viewerIndex >= 0 ? viewerAssets[viewerIndex] : null;

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

  function getAssets(): any[] {
    if (!data) return [];
    if (data.album) return (data.album.assets || []).map((aa: any) => aa.asset);
    if (data.asset) return [data.asset];
    return [];
  }

  function openViewer(i: number) { viewerIndex = i; }
  function closeViewer() { viewerIndex = -1; }
  function prevPhoto() { if (viewerIndex > 0) viewerIndex--; }
  function nextPhoto() { if (viewerIndex < viewerAssets.length - 1) viewerIndex++; }

  function handleKey(e: KeyboardEvent) {
    if (viewerIndex < 0) return;
    if (e.key === 'Escape') closeViewer();
    if (e.key === 'ArrowLeft') prevPhoto();
    if (e.key === 'ArrowRight') nextPhoto();
  }

  function imgError(e: Event) {
    const el = e.currentTarget as HTMLImageElement;
    el.style.display = 'none';
    const next = el.nextElementSibling as HTMLElement;
    if (next) next.style.removeProperty('display');
  }
</script>

<svelte:window on:keydown={handleKey} />

<style>
  :global(body) { background: #0a0a0a; color: #fff; font-family: system-ui, sans-serif; }
  .wrap { max-width: 1400px; margin: 0 auto; padding: 2rem 1.5rem; }
  .brand { font-size: 1.1rem; font-weight: 700; color: #60a5fa; margin-bottom: 2rem; }
  .loading, .error-msg { text-align: center; padding: 4rem 2rem; color: #9ca3af; }
  .error-msg { color: #f87171; }
  h1 { font-size: 1.5rem; font-weight: 700; margin-bottom: 0.5rem; }
  .meta { color: #9ca3af; font-size: 0.9rem; margin-bottom: 1.5rem; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 4px; }
  .tile { aspect-ratio: 1; overflow: hidden; border-radius: 4px; background: #1a1a1a; position: relative; cursor: pointer; }
  .tile img { width: 100%; height: 100%; object-fit: cover; display: block; transition: transform 0.2s; }
  .tile:hover img { transform: scale(1.03); }
  .tile:hover .overlay { opacity: 1; }
  .overlay { position: absolute; inset: 0; background: linear-gradient(to top, rgba(0,0,0,0.7) 0%, transparent 50%); opacity: 0; transition: opacity 0.2s; display: flex; align-items: flex-end; padding: 0.4rem; }
  .info { font-size: 0.75rem; color: #fff; }
  .name { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .broken { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; font-size: 2rem; color: #555; }
  .pw-form { max-width: 360px; margin: 4rem auto; background: #1a1a1a; border: 1px solid #333; border-radius: 12px; padding: 2rem; display: flex; flex-direction: column; gap: 1rem; }
  .pw-form h2 { font-size: 1.1rem; font-weight: 700; text-align: center; }
  .pw-form input { background: #111; border: 1px solid #333; border-radius: 6px; color: #fff; padding: 0.5rem 0.75rem; font-size: 0.95rem; width: 100%; }
  .pw-form button { padding: 0.6rem; background: #2563eb; border: none; border-radius: 6px; color: #fff; font-weight: 600; font-size: 0.95rem; }
  .pw-err { color: #f87171; font-size: 0.85rem; text-align: center; }
  /* Lightbox */
  .lightbox { position: fixed; inset: 0; background: rgba(0,0,0,0.95); z-index: 9999; display: flex; flex-direction: column; align-items: center; justify-content: center; }
  .lb-img { max-width: 100%; max-height: calc(100vh - 80px); object-fit: contain; display: block; }
  .lb-controls { position: fixed; top: 0; left: 0; right: 0; display: flex; align-items: center; justify-content: space-between; padding: 1rem 1.5rem; background: linear-gradient(to bottom, rgba(0,0,0,0.7), transparent); }
  .lb-title { font-size: 0.9rem; color: #ccc; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; margin: 0 1rem; }
  .lb-count { font-size: 0.85rem; color: #888; white-space: nowrap; }
  .lb-btn { background: rgba(255,255,255,0.1); border: none; border-radius: 8px; color: #fff; font-size: 1.1rem; padding: 0.5rem 0.9rem; cursor: pointer; }
  .lb-btn:hover { background: rgba(255,255,255,0.2); }
  .lb-btn:disabled { opacity: 0.3; cursor: not-allowed; }
  .lb-nav-prev, .lb-nav-next { position: fixed; top: 50%; transform: translateY(-50%); background: rgba(255,255,255,0.1); border: none; border-radius: 50%; color: #fff; font-size: 1.5rem; width: 48px; height: 48px; cursor: pointer; display: flex; align-items: center; justify-content: center; }
  .lb-nav-prev { left: 1rem; }
  .lb-nav-next { right: 1rem; }
  .lb-nav-prev:hover, .lb-nav-next:hover { background: rgba(255,255,255,0.2); }
  .lb-nav-prev:disabled, .lb-nav-next:disabled { opacity: 0.2; cursor: not-allowed; }
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
      {#each assets as asset, i (asset.id)}
        <div class="tile" on:click={() => openViewer(i)} role="button" tabindex="0"
          on:keydown={(e) => e.key === 'Enter' && openViewer(i)}>
          {#if asset.type !== 'OTHER'}
            <img src="/api/s/{token}/thumbnail/{asset.id}" alt={asset.fileName} loading="lazy"
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

{#if viewerAsset}
  <div class="lightbox" on:click|self={closeViewer} role="dialog" aria-modal="true">
    <div class="lb-controls">
      <button class="lb-btn" on:click={closeViewer}>✕ Close</button>
      <span class="lb-title">{viewerAsset.fileName}</span>
      <span class="lb-count">{viewerIndex + 1} / {viewerAssets.length}</span>
    </div>
    {#if viewerAsset.type !== 'OTHER'}
      <img class="lb-img" src="/api/s/{token}/thumbnail/{viewerAsset.id}?size=large"
        alt={viewerAsset.fileName} />
    {:else}
      <div style="color:#666;font-size:1rem">No preview available</div>
    {/if}
    <button class="lb-nav-prev" on:click={prevPhoto} disabled={viewerIndex === 0}>&#8249;</button>
    <button class="lb-nav-next" on:click={nextPhoto} disabled={viewerIndex === viewerAssets.length - 1}>&#8250;</button>
  </div>
{/if}
