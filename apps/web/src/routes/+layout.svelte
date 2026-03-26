<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import { auth, isAuthenticated } from '$lib/stores';
  import { api } from '$lib/api';

  const publicRoutes = ['/'];

  let searchQuery = '';
  let storageUsed = 0;
  let storageTotal = 0;

  onMount(() => {
    auth.init();
  });

  $: {
    if (!$auth.loading) {
      const isPublic = publicRoutes.includes($page.url.pathname);
      if (!$isAuthenticated && !isPublic) {
        goto('/');
      }
    }
  }

  $: if ($isAuthenticated) {
    api.assets.list(1, 1).then(r => { storageUsed = r.total; });
  }

  function handleSearch(e: Event) {
    e.preventDefault();
    if (searchQuery.trim()) {
      goto(`/search?q=${encodeURIComponent(searchQuery.trim())}`);
    }
  }

  function isActive(path: string) {
    return $page.url.pathname === path || $page.url.pathname.startsWith(path + '/');
  }
</script>

<style>
  :global(*) {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
  }

  :global(body) {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, sans-serif;
    background: #0f0f0f;
    color: #f0f0f0;
    min-height: 100vh;
  }

  :global(a) {
    color: inherit;
    text-decoration: none;
  }

  :global(button) {
    cursor: pointer;
  }

  .app-shell {
    display: flex;
    min-height: 100vh;
  }

  /* Sidebar */
  .sidebar {
    width: 220px;
    flex-shrink: 0;
    background: #111;
    border-right: 1px solid #1e1e1e;
    display: flex;
    flex-direction: column;
    position: fixed;
    top: 0;
    left: 0;
    height: 100vh;
    z-index: 50;
    overflow-y: auto;
  }

  .logo {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 1.2rem 1rem;
    border-bottom: 1px solid #1e1e1e;
    margin-bottom: 0.5rem;
  }

  .logo-text {
    font-size: 1.1rem;
    font-weight: 700;
    letter-spacing: -0.02em;
  }

  .logo-text span {
    color: #4f8ef7;
  }

  .search-form {
    padding: 0 0.75rem 0.75rem;
  }

  .search-input {
    width: 100%;
    padding: 0.45rem 0.7rem;
    background: #1a1a1a;
    border: 1px solid #2a2a2a;
    border-radius: 8px;
    color: #f0f0f0;
    font-size: 0.85rem;
    outline: none;
    transition: border-color 0.15s;
  }

  .search-input::placeholder {
    color: #555;
  }

  .search-input:focus {
    border-color: #4f8ef7;
  }

  .nav-section {
    padding: 0 0.5rem;
    margin-bottom: 0.25rem;
  }

  .nav-label {
    font-size: 0.7rem;
    font-weight: 600;
    color: #444;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    padding: 0.5rem 0.5rem 0.25rem;
  }

  .nav-item {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0.5rem 0.75rem;
    border-radius: 8px;
    font-size: 0.875rem;
    color: #888;
    transition: background 0.1s, color 0.1s;
    width: 100%;
    text-align: left;
    background: transparent;
    border: none;
  }

  .nav-item:hover {
    background: #1a1a1a;
    color: #ddd;
  }

  .nav-item.active {
    background: #1e2a3a;
    color: #4f8ef7;
  }

  .nav-icon {
    font-size: 1rem;
    width: 1.25rem;
    text-align: center;
    flex-shrink: 0;
  }

  .divider {
    height: 1px;
    background: #1e1e1e;
    margin: 0.5rem 0.75rem;
  }

  .spacer {
    flex: 1;
  }

  /* Storage */
  .storage-section {
    padding: 0.75rem;
    border-top: 1px solid #1e1e1e;
  }

  .storage-label {
    font-size: 0.75rem;
    color: #555;
    margin-bottom: 0.4rem;
    display: flex;
    justify-content: space-between;
  }

  .storage-bar {
    height: 4px;
    background: #1e1e1e;
    border-radius: 2px;
    overflow: hidden;
    margin-bottom: 0.75rem;
  }

  .storage-fill {
    height: 100%;
    background: #4f8ef7;
    border-radius: 2px;
    width: 10%;
  }

  .user-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
  }

  .user-email {
    font-size: 0.78rem;
    color: #666;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .signout-btn {
    padding: 0.3rem 0.6rem;
    background: transparent;
    border: 1px solid #2a2a2a;
    border-radius: 6px;
    color: #666;
    font-size: 0.75rem;
    white-space: nowrap;
    transition: all 0.15s;
  }

  .signout-btn:hover {
    border-color: #444;
    color: #aaa;
  }

  /* Main content */
  .main-content {
    margin-left: 220px;
    flex: 1;
    min-height: 100vh;
  }
</style>

{#if $isAuthenticated}
  <div class="app-shell">
    <aside class="sidebar">
      <div class="logo">
        <span class="logo-text">Photo<span>App</span></span>
      </div>

      <!-- Search -->
      <form class="search-form" on:submit={handleSearch}>
        <input
          class="search-input"
          type="text"
          placeholder="Search photos..."
          bind:value={searchQuery}
        />
      </form>

      <!-- Main nav -->
      <nav class="nav-section">
        <a href="/photos" class="nav-item" class:active={isActive('/photos')}>
          <span class="nav-icon">🖼</span> Photos
        </a>
        <a href="/explore" class="nav-item" class:active={isActive('/explore')}>
          <span class="nav-icon">✦</span> Explore
        </a>
        <a href="/map" class="nav-item" class:active={isActive('/map')}>
          <span class="nav-icon">🗺</span> Map
        </a>
        <a href="/sharing" class="nav-item" class:active={isActive('/sharing')}>
          <span class="nav-icon">🔗</span> Sharing
        </a>
      </nav>

      <div class="divider"></div>

      <nav class="nav-section">
        <div class="nav-label">Library</div>
        <a href="/favorites" class="nav-item" class:active={isActive('/favorites')}>
          <span class="nav-icon">♥</span> Favorites
        </a>
        <a href="/albums" class="nav-item" class:active={isActive('/albums')}>
          <span class="nav-icon">📁</span> Albums
        </a>
        <a href="/archive" class="nav-item" class:active={isActive('/archive')}>
          <span class="nav-icon">📦</span> Archive
        </a>
        <a href="/trash" class="nav-item" class:active={isActive('/trash')}>
          <span class="nav-icon">🗑</span> Trash
        </a>
      </nav>

      <div class="spacer"></div>

      <!-- Storage + user -->
      <div class="storage-section">
        <div class="storage-label">
          <span>Space usage</span>
          <span>{storageUsed} items</span>
        </div>
        <div class="storage-bar">
          <div class="storage-fill"></div>
        </div>
        <div class="user-row">
          <span class="user-email">{$auth.user?.email ?? ''}</span>
          <button class="signout-btn" on:click={() => { auth.logout(); goto('/'); }}>
            Sign out
          </button>
        </div>
      </div>
    </aside>

    <main class="main-content">
      <slot />
    </main>
  </div>
{:else}
  <slot />
{/if}
