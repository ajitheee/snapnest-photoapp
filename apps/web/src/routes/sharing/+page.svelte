<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { api } from '$lib/api';
  import { isAuthenticated } from '$lib/stores';
  import type { ShareLink, Album } from '$lib/api';

  let links: ShareLink[] = [];
  let albums: Album[] = [];
  let loading = true;
  let error = '';
  let showCreate = false;
  let form = { type: 'album' as 'album' | 'asset', albumId: '', assetId: '', password: '', expiresAt: '' };
  let creating = false;
  let createError = '';
  let copied: string | null = null;
  let appUrl = 'http://192.168.86.170:8090';

  onMount(async () => {
    if (!$isAuthenticated) { goto('/'); return; }
    await Promise.all([load(), loadAlbums(), loadAppUrl()]);
  });

  async function loadAppUrl() {
    try {
      const info = await api.server.info();
      if (info?.appUrl) appUrl = info.appUrl;
    } catch {}
  }

  async function load() {
    loading = true; error = '';
    try { links = await api.sharing.list(); }
    catch (e) { error = e instanceof Error ? e.message : 'Failed to load'; }
    finally { loading = false; }
  }

  async function loadAlbums() {
    try { albums = await api.albums.list(); } catch {}
  }

  async function create() {
    creating = true; createError = '';
    try {
      const data: any = {};
      if (form.type === 'album') data.albumId = form.albumId;
      else data.assetId = form.assetId;
      if (form.password) data.password = form.password;
      if (form.expiresAt) data.expiresAt = new Date(form.expiresAt).toISOString();
      const link = await api.sharing.create(data);
      links = [link, ...links];
      showCreate = false;
      form = { type: 'album', albumId: '', assetId: '', password: '', expiresAt: '' };
    } catch (e) { createError = e instanceof Error ? e.message : 'Failed to create'; }
    finally { creating = false; }
  }

  async function deleteLink(link: ShareLink) {
    await api.sharing.remove(link.id);
    links = links.filter(l => l.id !== link.id);
  }

  function shareUrl(token: string) {
    return `${appUrl}/s/${token}`;
  }

  function copyLink(token: string) {
    navigator.clipboard.writeText(shareUrl(token));
    copied = token;
    setTimeout(() => copied = null, 2000);
  }

  function formatDate(d: string) {
    return new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  }
</script>

<style>
  .page { padding: 1.5rem; max-width: 900px; margin: 0 auto; }
  .header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 1.5rem; }
  h2 { font-size: 1.5rem; font-weight: 700; }
  .new-btn { padding: 0.5rem 1rem; background: var(--accent); border: none; border-radius: 8px; color: #fff; font-size: 0.9rem; font-weight: 600; }
  .new-btn:hover { background: var(--accent-hover); }
  .create-form { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 1.2rem; margin-bottom: 1.5rem; display: flex; flex-direction: column; gap: 0.8rem; }
  .form-row { display: flex; gap: 0.5rem; align-items: center; }
  .form-row label { color: var(--text-muted); font-size: 0.85rem; min-width: 80px; }
  .form-row input, .form-row select { background: var(--surface-2); border: 1px solid var(--border); border-radius: 6px; color: var(--text); padding: 0.4rem 0.6rem; font-size: 0.9rem; flex: 1; }
  .type-toggle { display: flex; gap: 0.5rem; }
  .type-btn { padding: 0.35rem 0.75rem; background: var(--surface-2); border: 1px solid var(--border); border-radius: 6px; color: var(--text-muted); font-size: 0.85rem; cursor: pointer; }
  .type-btn.active { background: var(--accent); border-color: var(--accent); color: #fff; }
  .form-actions { display: flex; gap: 0.5rem; justify-content: flex-end; }
  .btn-cancel { padding: 0.4rem 0.8rem; background: var(--surface-2); border: 1px solid var(--border-2); border-radius: 6px; color: var(--text-muted); font-size: 0.9rem; }
  .btn-save { padding: 0.4rem 0.8rem; background: var(--accent); border: none; border-radius: 6px; color: #fff; font-size: 0.9rem; font-weight: 600; }
  .btn-save:disabled { opacity: 0.5; cursor: not-allowed; }
  .form-err { color: var(--error); font-size: 0.85rem; }
  .loading, .error-msg, .empty { text-align: center; padding: 4rem 2rem; color: var(--text-muted); }
  .error-msg { color: var(--error); }
  .link-list { display: flex; flex-direction: column; gap: 0.75rem; }
  .link-card { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 1rem; display: flex; flex-direction: column; gap: 0.5rem; }
  .link-top { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; flex-wrap: wrap; }
  .link-target { font-weight: 600; font-size: 0.95rem; }
  .link-meta { color: var(--text-muted); font-size: 0.8rem; display: flex; gap: 0.8rem; flex-wrap: wrap; }
  .link-url-row { display: flex; gap: 0.5rem; align-items: center; }
  .link-url { font-family: monospace; font-size: 0.8rem; color: var(--accent); background: var(--surface-2); border: 1px solid var(--border); border-radius: 4px; padding: 3px 8px; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .copy-btn { padding: 3px 8px; background: var(--surface-2); border: 1px solid var(--border); border-radius: 4px; color: var(--text-muted); font-size: 0.8rem; cursor: pointer; white-space: nowrap; }
  .copy-btn.copied { color: #16a34a; border-color: #16a34a; }
  .del-btn { padding: 3px 8px; background: none; border: 1px solid var(--border); border-radius: 4px; color: var(--text-muted); font-size: 0.8rem; cursor: pointer; }
  .del-btn:hover { border-color: var(--error); color: var(--error); }
  .badge { padding: 2px 6px; border-radius: 4px; font-size: 0.75rem; background: var(--surface-2); color: var(--text-muted); }
  .badge.lock { background: #dcfce7; color: #16a34a; }
  .badge.expired { background: var(--error-bg); color: var(--error); }
</style>

<div class="page">
  <div class="header">
    <h2>Sharing</h2>
    <button class="new-btn" on:click={() => showCreate = !showCreate}>+ New Link</button>
  </div>

  {#if showCreate}
    <div class="create-form">
      <div class="form-row">
        <label>Share</label>
        <div class="type-toggle">
          <button class="type-btn" class:active={form.type === 'album'} on:click={() => form.type = 'album'}>Album</button>
          <button class="type-btn" class:active={form.type === 'asset'} on:click={() => form.type = 'asset'}>Asset ID</button>
        </div>
      </div>
      {#if form.type === 'album'}
        <div class="form-row">
          <label>Album</label>
          <select bind:value={form.albumId}>
            <option value="">Select album...</option>
            {#each albums as a}<option value={a.id}>{a.name}</option>{/each}
          </select>
        </div>
      {:else}
        <div class="form-row">
          <label>Asset ID</label>
          <input bind:value={form.assetId} placeholder="Paste asset ID" />
        </div>
      {/if}
      <div class="form-row">
        <label>Password</label>
        <input type="password" bind:value={form.password} placeholder="Optional" />
      </div>
      <div class="form-row">
        <label>Expires</label>
        <input type="date" bind:value={form.expiresAt} />
      </div>
      {#if createError}<div class="form-err">{createError}</div>{/if}
      <div class="form-actions">
        <button class="btn-cancel" on:click={() => { showCreate = false; }}>Cancel</button>
        <button class="btn-save" on:click={create} disabled={creating || (form.type === 'album' ? !form.albumId : !form.assetId)}>
          {creating ? 'Creating...' : 'Create Link'}
        </button>
      </div>
    </div>
  {/if}

  {#if loading}
    <div class="loading">Loading links...</div>
  {:else if error}
    <div class="error-msg">{error}</div>
  {:else if links.length === 0}
    <div class="empty">No share links yet. Create one to share an album or photo.</div>
  {:else}
    <div class="link-list">
      {#each links as link (link.id)}
        {@const isExpired = link.expiresAt ? new Date(link.expiresAt) < new Date() : false}
        <div class="link-card">
          <div class="link-top">
            <span class="link-target">
              {link.album ? `Album: ${link.album.name}` : link.asset ? `Photo: ${link.asset.fileName}` : 'Link'}
            </span>
            <div style="display:flex;gap:0.4rem;align-items:center">
              {#if link.passwordHash !== undefined}<span class="badge lock">&#128274; Password</span>{/if}
              {#if isExpired}<span class="badge expired">Expired</span>
              {:else if link.expiresAt}<span class="badge">Expires {formatDate(link.expiresAt)}</span>{/if}
              <button class="del-btn" on:click={() => deleteLink(link)}>Delete</button>
            </div>
          </div>
          <div class="link-meta">
            <span>Created {formatDate(link.createdAt)}</span>
            <span>{link.viewCount} view{link.viewCount !== 1 ? 's' : ''}</span>
          </div>
          <div class="link-url-row">
            <span class="link-url">{shareUrl(link.token)}</span>
            <button class="copy-btn" class:copied={copied === link.token} on:click={() => copyLink(link.token)}>
              {copied === link.token ? 'Copied!' : 'Copy'}
            </button>
          </div>
        </div>
      {/each}
    </div>
  {/if}
</div>
