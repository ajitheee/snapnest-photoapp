<script lang="ts">
  import { goto } from '$app/navigation';
  import { auth } from './stores';
  import { settings } from './settings';
  import type { UserPreferences } from './api';

  export let open = false;

  let section: 'profile' | 'settings' = 'profile';
  let isDark = false;

  if (typeof localStorage !== 'undefined') {
    isDark = localStorage.getItem('theme') === 'dark';
  }

  function close() { open = false; section = 'profile'; }

  function toggleTheme() {
    isDark = !isDark;
    document.documentElement.setAttribute('data-theme', isDark ? 'dark' : '');
    localStorage.setItem('theme', isDark ? 'dark' : 'light');
  }

  function signOut() {
    auth.logout();
    close();
    goto('/');
  }

  function toggleSetting<K extends keyof UserPreferences>(sec: K, key: keyof UserPreferences[K]) {
    const current = $settings[sec][key] as boolean;
    settings.updateSection(sec, { [key]: !current } as Partial<UserPreferences[K]>);
  }

  function setPrimaryColor(color: string | null) {
    settings.updateSection('theme', { primaryColor: color });
  }

  let colorInput = $settings.theme.primaryColor ?? '#6366f1';
  $: if ($settings.theme.primaryColor) colorInput = $settings.theme.primaryColor;

  function onRangeInput(e: Event) {
    settings.updateSection('photoGrid', { assetsPerRow: parseInt((e.target as HTMLInputElement).value) });
  }

  $: initials = ($auth.user?.name ?? $auth.user?.email ?? 'U')
    .split(' ')
    .map((w: string) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
</script>

{#if open}
  <!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
  <div class="overlay" role="dialog" aria-modal="true" on:click|self={close}>
    <div class="panel">

      <!-- Header -->
      <div class="panel-header">
        {#if section === 'settings'}
          <button class="back-btn" on:click={() => section = 'profile'}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>
          </button>
          <span class="panel-title">Settings</span>
        {:else}
          <span class="panel-title">Profile</span>
        {/if}
        <button class="close-btn" on:click={close}>✕</button>
      </div>

      {#if section === 'profile'}
        <!-- ── Profile section ── -->
        <div class="profile-hero">
          <div class="avatar-lg">{initials}</div>
          <div class="profile-info">
            <div class="profile-name">{$auth.user?.name || 'User'}</div>
            <div class="profile-email">{$auth.user?.email || ''}</div>
          </div>
        </div>

        <div class="profile-actions">
          <!-- Settings entry -->
          <button class="action-row" on:click={() => section = 'settings'}>
            <span class="action-icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>
              </svg>
            </span>
            <span class="action-label">Settings</span>
            <svg class="chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>
          </button>

          <!-- Theme toggle -->
          <button class="action-row" on:click={toggleTheme}>
            <span class="action-icon">
              {#if isDark}
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32 1.41 1.41M2 12h2m16 0h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>
              {:else}
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>
              {/if}
            </span>
            <span class="action-label">{isDark ? 'Light mode' : 'Dark mode'}</span>
            <svg class="chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>
          </button>
        </div>

        <!-- Sign out -->
        <div class="signout-section">
          <button class="signout-btn" on:click={signOut}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
            Sign Out
          </button>
        </div>

      {:else}
        <!-- ── Settings section ── -->
        <div class="panel-body">

          <!-- Asset Viewer -->
          <div class="section">
            <div class="section-title">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>
              Asset Viewer
            </div>
            <div class="setting-row">
              <div class="setting-info">
                <div class="setting-label">Load preview image</div>
                <div class="setting-desc">Show compressed preview while loading</div>
              </div>
              <button class="toggle" class:on={$settings.assetViewer.loadPreviewImage}
                on:click={() => toggleSetting('assetViewer', 'loadPreviewImage')}>
                <span class="thumb"></span>
              </button>
            </div>
            <div class="setting-row">
              <div class="setting-info">
                <div class="setting-label">Load original image</div>
                <div class="setting-desc">Always fetch full-resolution original</div>
              </div>
              <button class="toggle" class:on={$settings.assetViewer.loadOriginalImage}
                on:click={() => toggleSetting('assetViewer', 'loadOriginalImage')}>
                <span class="thumb"></span>
              </button>
            </div>
          </div>

          <div class="divider"></div>

          <!-- Videos -->
          <div class="section">
            <div class="section-title">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polygon points="10 8 16 12 10 16 10 8"/></svg>
              Videos
            </div>
            <div class="setting-row">
              <div class="setting-info">
                <div class="setting-label">Auto play videos</div>
                <div class="setting-desc">Automatically start playing when opened</div>
              </div>
              <button class="toggle" class:on={$settings.videos.autoPlay}
                on:click={() => toggleSetting('videos', 'autoPlay')}>
                <span class="thumb"></span>
              </button>
            </div>
            <div class="setting-row">
              <div class="setting-info">
                <div class="setting-label">Looping</div>
                <div class="setting-desc">Loop videos when they end</div>
              </div>
              <button class="toggle" class:on={$settings.videos.looping}
                on:click={() => toggleSetting('videos', 'looping')}>
                <span class="thumb"></span>
              </button>
            </div>
          </div>

          <div class="divider"></div>

          <!-- Theme -->
          <div class="section">
            <div class="section-title">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32 1.41 1.41M2 12h2m16 0h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>
              Theme
            </div>
            <div class="setting-row">
              <div class="setting-info">
                <div class="setting-label">Follow system</div>
                <div class="setting-desc">Auto dark/light based on OS setting</div>
              </div>
              <button class="toggle" class:on={$settings.theme.automatic}
                on:click={() => toggleSetting('theme', 'automatic')}>
                <span class="thumb"></span>
              </button>
            </div>
            <div class="setting-row">
              <div class="setting-info">
                <div class="setting-label">Primary color</div>
                <div class="setting-desc">Accent color for highlights</div>
              </div>
              <div class="color-pick">
                <input type="color" bind:value={colorInput}
                  on:change={() => setPrimaryColor(colorInput)}
                  class="color-input" title="Pick primary color" />
                {#if $settings.theme.primaryColor}
                  <button class="color-reset" on:click={() => setPrimaryColor(null)}>✕</button>
                {/if}
              </div>
            </div>
            <div class="setting-row">
              <div class="setting-info">
                <div class="setting-label">Colorful interface</div>
                <div class="setting-desc">Tint surfaces with primary color</div>
              </div>
              <button class="toggle" class:on={$settings.theme.colorfulInterface}
                on:click={() => toggleSetting('theme', 'colorfulInterface')}>
                <span class="thumb"></span>
              </button>
            </div>
          </div>

          <div class="divider"></div>

          <!-- Photo Grid -->
          <div class="section">
            <div class="section-title">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="14" y="3" rx="1"/><rect width="7" height="7" x="14" y="14" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/></svg>
              Photo Grid
            </div>
            <div class="setting-row">
              <div class="setting-info">
                <div class="setting-label">Show asset title</div>
                <div class="setting-desc">Display filename on tiles</div>
              </div>
              <button class="toggle" class:on={$settings.photoGrid.showStorageIndicator}
                on:click={() => toggleSetting('photoGrid', 'showStorageIndicator')}>
                <span class="thumb"></span>
              </button>
            </div>
            <div class="setting-row layout-row">
              <div class="setting-info">
                <div class="setting-label">Layout</div>
                <div class="setting-desc">Assets per row (2–8)</div>
              </div>
              <div class="range-control">
                <span class="range-val">{$settings.photoGrid.assetsPerRow}</span>
                <input type="range" min="2" max="8" step="1"
                  value={$settings.photoGrid.assetsPerRow}
                  on:input={onRangeInput} class="range-input" />
              </div>
            </div>
          </div>

        </div>
      {/if}

    </div>
  </div>
{/if}

<style>
  .overlay {
    position: fixed; inset: 0; z-index: 1000;
    background: rgba(0,0,0,0.45); backdrop-filter: blur(2px);
    display: flex; align-items: center; justify-content: center;
    padding: 1rem;
  }

  .panel {
    width: 100%; max-width: 420px; max-height: 88vh;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 20px;
    box-shadow: var(--shadow-2xl);
    display: flex; flex-direction: column;
    overflow: hidden;
  }

  .panel-header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 1rem 1.2rem;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
    gap: 0.5rem;
  }

  .panel-title {
    flex: 1;
    font-size: 1rem; font-weight: 700; color: var(--text);
  }

  .back-btn {
    width: 28px; height: 28px; border-radius: 8px;
    background: transparent; border: 1px solid var(--border);
    color: var(--text-muted); display: flex; align-items: center; justify-content: center;
    transition: all 0.15s; flex-shrink: 0;
  }
  .back-btn:hover { background: var(--surface-hover); color: var(--text); }

  .close-btn {
    width: 28px; height: 28px; border-radius: 8px;
    background: transparent; border: 1px solid var(--border);
    color: var(--text-muted); font-size: 0.85rem;
    display: flex; align-items: center; justify-content: center;
    transition: all 0.15s; flex-shrink: 0;
  }
  .close-btn:hover { background: var(--surface-hover); color: var(--text); }

  /* Profile hero */
  .profile-hero {
    display: flex; align-items: center; gap: 1rem;
    padding: 1.4rem 1.4rem 1rem;
  }

  .avatar-lg {
    width: 56px; height: 56px; border-radius: 50%;
    background: linear-gradient(135deg, var(--accent) 0%, #8b5cf6 100%);
    display: flex; align-items: center; justify-content: center;
    font-size: 1.2rem; font-weight: 700; color: #fff;
    flex-shrink: 0; letter-spacing: 0.02em;
  }

  .profile-info { flex: 1; min-width: 0; }

  .profile-name {
    font-size: 1rem; font-weight: 700; color: var(--text);
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }

  .profile-email {
    font-size: 0.8rem; color: var(--text-muted); margin-top: 0.15rem;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }

  /* Action rows */
  .profile-actions {
    padding: 0.25rem 0.75rem;
  }

  .action-row {
    display: flex; align-items: center; gap: 0.75rem;
    width: 100%; padding: 0.7rem 0.6rem;
    background: transparent; border: none; border-radius: 10px;
    color: var(--text); font-size: 0.9rem; font-weight: 500;
    text-align: left; transition: background 0.15s;
  }
  .action-row:hover { background: var(--surface-hover); }

  .action-icon {
    width: 32px; height: 32px; border-radius: 8px;
    background: var(--surface-2); border: 1px solid var(--border);
    display: flex; align-items: center; justify-content: center;
    flex-shrink: 0; color: var(--text-muted);
  }

  .action-label { flex: 1; }

  .chevron { color: var(--text-subtle); flex-shrink: 0; }

  /* Sign out */
  .signout-section {
    padding: 0.75rem 1.2rem 1.2rem;
    margin-top: auto;
    border-top: 1px solid var(--border);
  }

  .signout-btn {
    width: 100%; padding: 0.6rem 1rem;
    background: transparent; border: 1px solid var(--border);
    border-radius: 10px; color: var(--error, #ef4444);
    font-size: 0.875rem; font-weight: 600;
    display: flex; align-items: center; justify-content: center; gap: 0.5rem;
    transition: all 0.15s;
  }
  .signout-btn:hover { background: rgba(239,68,68,0.07); border-color: var(--error, #ef4444); }

  /* Settings sub-panel */
  .panel-body {
    overflow-y: auto; padding: 0.5rem 0; flex: 1;
    scrollbar-width: thin; scrollbar-color: var(--border) transparent;
  }

  .section { padding: 0.75rem 1.4rem; }

  .section-title {
    display: flex; align-items: center; gap: 0.5rem;
    font-size: 0.72rem; font-weight: 700; color: var(--text-subtle);
    text-transform: uppercase; letter-spacing: 0.08em;
    margin-bottom: 0.65rem;
  }

  .divider { height: 1px; background: var(--border); margin: 0 1.4rem; }

  .setting-row {
    display: flex; align-items: center; justify-content: space-between;
    gap: 1rem; padding: 0.55rem 0;
  }

  .setting-info { flex: 1; min-width: 0; }
  .setting-label { font-size: 0.875rem; font-weight: 500; color: var(--text); }
  .setting-desc { font-size: 0.775rem; color: var(--text-muted); margin-top: 0.1rem; }

  .toggle {
    width: 40px; height: 22px; border-radius: 11px;
    background: var(--border); border: none;
    position: relative; flex-shrink: 0;
    transition: background 0.2s; padding: 0;
  }
  .toggle.on { background: var(--accent); }
  .thumb {
    position: absolute; top: 3px; left: 3px;
    width: 16px; height: 16px; border-radius: 50%; background: #fff;
    transition: transform 0.2s; box-shadow: 0 1px 3px rgba(0,0,0,0.2);
  }
  .toggle.on .thumb { transform: translateX(18px); }

  .color-pick { display: flex; align-items: center; gap: 0.35rem; flex-shrink: 0; }
  .color-input {
    width: 36px; height: 28px; padding: 2px; border-radius: 8px;
    border: 1.5px solid var(--border); cursor: pointer; background: transparent;
  }
  .color-reset {
    width: 22px; height: 22px; border-radius: 6px;
    background: transparent; border: 1px solid var(--border);
    color: var(--text-muted); font-size: 0.7rem;
    display: flex; align-items: center; justify-content: center;
    transition: all 0.15s;
  }
  .color-reset:hover { background: var(--surface-hover); color: var(--text); }

  .range-control { display: flex; align-items: center; gap: 0.6rem; flex-shrink: 0; }
  .range-val { font-size: 0.875rem; font-weight: 700; color: var(--accent); min-width: 1.2rem; text-align: center; }
  .range-input { width: 100px; accent-color: var(--accent); cursor: pointer; }
  .layout-row { align-items: flex-start; padding-top: 0.75rem; }
</style>
