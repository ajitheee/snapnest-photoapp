<script lang="ts">
  import '../app.css';
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import { auth, isAuthenticated } from '$lib/stores';
  import { api } from '$lib/api';
  import { settings } from '$lib/settings';
  import ProfilePanel from '$lib/ProfilePanel.svelte';

  const publicRoutes = ['/'];

  let searchQuery = '';
  let storageUsed = 0;
  let storageTotal = 0;
  let isDark = false;
  let profileOpen = false;

  $: isShareRoute = $page.url.pathname.startsWith('/s/');

  onMount(() => {
    auth.init();
    isDark = localStorage.getItem('theme') === 'dark';
    document.documentElement.setAttribute('data-theme', isDark ? 'dark' : '');
  });

  $: if ($isAuthenticated) {
    settings.init();
  }

  // Apply theme settings reactively
  $: {
    if (typeof document !== 'undefined' && $settings) {
      const prefs = $settings;

      // Automatic theme: follow system
      if (prefs.theme.automatic) {
        const systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        isDark = systemDark;
        document.documentElement.setAttribute('data-theme', systemDark ? 'dark' : '');
        localStorage.setItem('theme', systemDark ? 'dark' : 'light');
      }

      // Primary color
      if (prefs.theme.primaryColor) {
        document.documentElement.style.setProperty('--accent', prefs.theme.primaryColor);
        // Derive glow from color
        document.documentElement.style.setProperty('--accent-glow', prefs.theme.primaryColor + '26');
      } else {
        document.documentElement.style.removeProperty('--accent');
        document.documentElement.style.removeProperty('--accent-glow');
      }

      // Colorful interface: tint bg and sidebar with accent
      if (prefs.theme.colorfulInterface && prefs.theme.primaryColor) {
        document.documentElement.style.setProperty('--bg', prefs.theme.primaryColor + '0d');
        document.documentElement.style.setProperty('--sidebar', prefs.theme.primaryColor + '1a');
      } else {
        document.documentElement.style.removeProperty('--bg');
        document.documentElement.style.removeProperty('--sidebar');
      }
    }
  }

  function toggleTheme() {
    isDark = !isDark;
    document.documentElement.setAttribute('data-theme', isDark ? 'dark' : '');
    localStorage.setItem('theme', isDark ? 'dark' : 'light');
  }

  $: {
    if (!$auth.loading) {
      const isPublic = publicRoutes.includes($page.url.pathname) || isShareRoute;
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
    const q = searchQuery.trim();
    if (!q) return;
    const isMemoryQuery = /\b(photos?\s+of|pictures?\s+of|when\s+did|where\s+did|who\s+was|last\s+(week|month|year|summer|winter|spring|fall)|show\s+me)\b/i.test(q);
    const mode = isMemoryQuery ? 'memory' : 'auto';
    goto(`/search?q=${encodeURIComponent(q)}&mode=${mode}`);
  }

  function isActive(path: string) {
    return $page.url.pathname === path || $page.url.pathname.startsWith(path + '/');
  }
</script>

<style>
  :global(body) {
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
    background: var(--bg);
    color: var(--text);
    min-height: 100vh;
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
  }

  :global(a) {
    color: inherit;
    text-decoration: none;
  }

  :global(button) {
    cursor: pointer;
    font-family: inherit;
  }

  :global(input) {
    font-family: inherit;
  }

  .app-shell {
    display: flex;
    min-height: 100vh;
  }

  /* ── Sidebar ── */
  .sidebar {
    width: 280px;
    flex-shrink: 0;
    background: var(--sidebar);
    border-right: 1px solid var(--border);
    box-shadow: var(--shadow-sm);
    display: flex;
    flex-direction: column;
    position: fixed;
    top: 0;
    left: 0;
    height: 100vh;
    z-index: 50;
    overflow-y: auto;
  }

  /* Logo */
  .logo {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 1.4rem 1.25rem;
    border-bottom: 1px solid var(--border);
    margin-bottom: 0.75rem;
  }

  .logo-icon {
    flex-shrink: 0;
    display: flex;
    align-items: center;
  }

  .logo-icon img {
    width: 46px;
    height: 46px;
    object-fit: contain;
  }

  .logo-text {
    font-size: 1.3rem;
    font-weight: 700;
    letter-spacing: -0.03em;
    color: var(--text);
  }

  .logo-text span {
    color: var(--accent);
  }

  /* Search */
  .search-form {
    padding: 0 0.85rem 0.85rem;
  }

  .search-wrap {
    position: relative;
  }

  .search-icon {
    position: absolute;
    left: 0.65rem;
    top: 50%;
    transform: translateY(-50%);
    pointer-events: none;
    display: flex;
    align-items: center;
  }

  .search-input {
    width: 100%;
    padding: 0.5rem 0.75rem 0.5rem 2rem;
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: 10px;
    color: var(--text);
    font-size: 0.85rem;
    outline: none;
    transition: border-color 0.2s, box-shadow 0.2s;
  }

  .search-input::placeholder {
    color: var(--text-subtle);
  }

  .search-input:focus {
    border-color: var(--accent);
    box-shadow: 0 0 0 3px var(--accent-glow);
  }

  /* Nav sections */
  .nav-section {
    padding: 0 0.6rem;
    margin-bottom: 0.2rem;
  }

  .nav-label {
    font-size: 0.72rem;
    font-weight: 600;
    color: var(--text-subtle);
    text-transform: uppercase;
    letter-spacing: 0.1em;
    padding: 0.6rem 0.6rem 0.3rem;
  }

  .nav-item {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.62rem 0.9rem;
    border-radius: 10px;
    font-size: 0.975rem;
    font-weight: 500;
    color: var(--text-muted);
    transition: background 0.15s, color 0.15s;
    width: 100%;
    text-align: left;
    background: transparent;
    border: none;
    position: relative;
  }

  .nav-item:hover {
    background: var(--surface-hover);
    color: var(--text-2);
  }

  .nav-item.active {
    background: var(--active-bg);
    color: var(--accent);
    font-weight: 600;
  }

  .nav-item.active::before {
    content: '';
    position: absolute;
    left: 0;
    top: 20%;
    bottom: 20%;
    width: 3px;
    background: var(--accent);
    border-radius: 0 3px 3px 0;
  }

  .nav-icon {
    width: 22px;
    height: 22px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  .divider {
    height: 1px;
    background: var(--border);
    margin: 0.4rem 1rem;
  }

  .spacer {
    flex: 1;
  }

  /* ── Bottom user section ── */
  .storage-section {
    padding: 0.9rem;
    border-top: 1px solid var(--border);
    background: var(--surface-2);
  }

  .storage-label {
    font-size: 0.72rem;
    font-weight: 500;
    color: var(--text-muted);
    margin-bottom: 0.35rem;
    display: flex;
    justify-content: space-between;
  }

  .storage-bar {
    height: 5px;
    background: var(--border);
    border-radius: 3px;
    overflow: hidden;
    margin-bottom: 0.85rem;
  }

  .storage-fill {
    height: 100%;
    background: linear-gradient(90deg, var(--accent) 0%, #8b5cf6 100%);
    border-radius: 3px;
    width: 10%;
    transition: width 0.6s ease;
  }

  .user-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .user-avatar {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    background: linear-gradient(135deg, var(--accent) 0%, #8b5cf6 100%);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 0.7rem;
    font-weight: 700;
    color: #fff;
    flex-shrink: 0;
    letter-spacing: 0.02em;
  }

  .user-email {
    font-size: 0.72rem;
    font-weight: 400;
    color: var(--text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .icon-btn {
    width: 28px;
    height: 28px;
    background: transparent;
    border: 1px solid var(--border);
    border-radius: 8px;
    color: var(--text-muted);
    font-size: 0.85rem;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.15s;
    flex-shrink: 0;
    padding: 0;
  }

  .icon-btn:hover {
    border-color: var(--border-2);
    color: var(--text-2);
    background: var(--surface-hover);
  }

  .profile-btn {
    width: 100%;
    background: transparent;
    border: none;
    border-radius: 10px;
    padding: 0.4rem 0.5rem;
    cursor: pointer;
    transition: background 0.15s;
    text-align: left;
  }

  .profile-btn:hover {
    background: var(--surface-hover);
  }

  .user-info {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-width: 0;
  }

  .user-name {
    font-size: 0.8rem;
    font-weight: 600;
    color: var(--text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* Main content */
  .main-content {
    margin-left: 280px;
    flex: 1;
    min-height: 100vh;
  }
</style>

{#if $isAuthenticated && !isShareRoute}
  <div class="app-shell">
    <aside class="sidebar">
      <div class="logo">
        <div class="logo-icon"><img src="/logo.png" alt="SnapNest" /></div>
        <span class="logo-text">Snap<span>Nest</span></span>
      </div>

      <!-- Search -->
      <form class="search-form" on:submit={handleSearch}>
        <div class="search-wrap">
          <span class="search-icon">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--text-subtle)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
            </svg>
          </span>
          <input
            class="search-input"
            type="text"
            placeholder="Search photos..."
            bind:value={searchQuery}
          />
        </div>
      </form>

      <!-- Main nav -->
      <nav class="nav-section">
        <a href="/photos" class="nav-item" class:active={isActive('/photos')}>
          <span class="nav-icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect width="20" height="20" x="3" y="3" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>
            </svg>
          </span> Photos
        </a>
        <a href="/explore" class="nav-item" class:active={isActive('/explore')}>
          <span class="nav-icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#f97316" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="10"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/>
            </svg>
          </span> Explore
        </a>
        <a href="/recaps" class="nav-item" class:active={isActive('/recaps')}>
          <span class="nav-icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#f43f5e" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polygon points="5 3 19 12 5 21 5 3"/><line x1="19" y1="3" x2="19" y2="21"/>
            </svg>
          </span> Recaps
        </a>
        <a href="/map" class="nav-item" class:active={isActive('/map')}>
          <span class="nav-icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>
            </svg>
          </span> Map
        </a>
        <a href="/people" class="nav-item" class:active={isActive('/people')}>
          <span class="nav-icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#8b5cf6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
            </svg>
          </span> People
        </a>
        <a href="/smart-albums" class="nav-item" class:active={isActive('/smart-albums')}>
          <span class="nav-icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#ec4899" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/><path d="M20 3v4m2-2h-4"/><path d="M4 17v2m1-1H3"/>
            </svg>
          </span> Smart Albums
        </a>
        <a href="/videos" class="nav-item" class:active={isActive('/videos')}>
          <span class="nav-icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="10"/><polygon points="10 8 16 12 10 16 10 8"/>
            </svg>
          </span> Videos
        </a>
        <a href="/sharing" class="nav-item" class:active={isActive('/sharing')}>
          <span class="nav-icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#06b6d4" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" x2="15.42" y1="13.51" y2="17.49"/><line x1="15.41" x2="8.59" y1="6.51" y2="10.49"/>
            </svg>
          </span> Sharing
        </a>
      </nav>

      <div class="divider"></div>

      <nav class="nav-section">
        <div class="nav-label">Library</div>
        <a href="/favorites" class="nav-item" class:active={isActive('/favorites')}>
          <span class="nav-icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#f43f5e" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>
            </svg>
          </span> Favorites
        </a>
        <a href="/albums" class="nav-item" class:active={isActive('/albums')}>
          <span class="nav-icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>
            </svg>
          </span> Albums
        </a>
        <a href="/archive" class="nav-item" class:active={isActive('/archive')}>
          <span class="nav-icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#14b8a6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect width="20" height="5" x="2" y="3" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"/><path d="M10 12h4"/>
            </svg>
          </span> Archive
        </a>
        <a href="/trash" class="nav-item" class:active={isActive('/trash')}>
          <span class="nav-icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>
            </svg>
          </span> Trash
        </a>
      </nav>

      {#if $auth.user?.isAdmin}
        <div class="divider"></div>
        <nav class="nav-section">
          <div class="nav-label">System</div>
          <a href="/admin" class="nav-item" class:active={isActive('/admin')}>
            <span class="nav-icon">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#6366f1" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>
              </svg>
            </span> Admin
          </a>
        </nav>
      {/if}

      <div class="spacer"></div>

      <!-- Profile button -->
      <div class="storage-section">
        <div class="storage-label">
          <span>Library</span>
          <span>{storageUsed.toLocaleString()} items</span>
        </div>
        <div class="storage-bar">
          <div class="storage-fill"></div>
        </div>
        <button class="user-row profile-btn" on:click={() => profileOpen = true} title="Profile & Settings">
          <div class="user-avatar">{($auth.user?.name ?? $auth.user?.email ?? 'U')[0].toUpperCase()}</div>
          <div class="user-info">
            <span class="user-name">{$auth.user?.name ?? 'User'}</span>
            <span class="user-email">{$auth.user?.email ?? ''}</span>
          </div>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;color:var(--text-subtle)"><path d="m9 18 6-6-6-6"/></svg>
        </button>
      </div>
    </aside>

    <main class="main-content">
      <slot />
    </main>
  </div>

  <ProfilePanel bind:open={profileOpen} />
{:else}
  <slot />
{/if}
