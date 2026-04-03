<script lang="ts">
  import { settings } from './settings';
  import type { UserPreferences } from './api';

  export let open = false;

  function close() { open = false; }

  function toggleSection<K extends keyof UserPreferences>(section: K, key: keyof UserPreferences[K]) {
    const current = $settings[section][key] as boolean;
    settings.updateSection(section, { [key]: !current } as Partial<UserPreferences[K]>);
  }

  function setGridColumns(val: number) {
    settings.updateSection('photoGrid', { assetsPerRow: val });
  }

  function setPrimaryColor(color: string | null) {
    settings.updateSection('theme', { primaryColor: color });
  }

  let colorInput = $settings.theme.primaryColor ?? '#6366f1';

  $: if ($settings.theme.primaryColor) colorInput = $settings.theme.primaryColor;

  function onRangeInput(e: Event) {
    setGridColumns(parseInt((e.target as HTMLInputElement).value));
  }
</script>

{#if open}
  <!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
  <div class="overlay" role="dialog" aria-modal="true" on:click|self={close}>
    <div class="panel">
      <div class="panel-header">
        <div class="panel-title">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="3"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M4.93 4.93a10 10 0 0 0 0 14.14"/>
          </svg>
          User Settings
        </div>
        <button class="close-btn" on:click={close}>✕</button>
      </div>

      <div class="panel-body">

        <!-- Asset Viewer -->
        <div class="section">
          <div class="section-title">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect width="18" height="18" x="3" y="3" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>
            </svg>
            Asset Viewer
          </div>
          <div class="setting-row">
            <div class="setting-info">
              <div class="setting-label">Load preview image</div>
              <div class="setting-desc">Show compressed preview while loading</div>
            </div>
            <button
              class="toggle" class:on={$settings.assetViewer.loadPreviewImage}
              on:click={() => toggleSection('assetViewer', 'loadPreviewImage')}
              aria-label="Toggle load preview image"
            >
              <span class="thumb"></span>
            </button>
          </div>
          <div class="setting-row">
            <div class="setting-info">
              <div class="setting-label">Load original image</div>
              <div class="setting-desc">Always fetch the full-resolution original</div>
            </div>
            <button
              class="toggle" class:on={$settings.assetViewer.loadOriginalImage}
              on:click={() => toggleSection('assetViewer', 'loadOriginalImage')}
              aria-label="Toggle load original image"
            >
              <span class="thumb"></span>
            </button>
          </div>
        </div>

        <div class="divider"></div>

        <!-- Videos -->
        <div class="section">
          <div class="section-title">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="10"/><polygon points="10 8 16 12 10 16 10 8"/>
            </svg>
            Videos
          </div>
          <div class="setting-row">
            <div class="setting-info">
              <div class="setting-label">Auto play videos</div>
              <div class="setting-desc">Automatically start playing when opened</div>
            </div>
            <button
              class="toggle" class:on={$settings.videos.autoPlay}
              on:click={() => toggleSection('videos', 'autoPlay')}
              aria-label="Toggle auto play"
            >
              <span class="thumb"></span>
            </button>
          </div>
          <div class="setting-row">
            <div class="setting-info">
              <div class="setting-label">Looping</div>
              <div class="setting-desc">Automatically loop videos when they end</div>
            </div>
            <button
              class="toggle" class:on={$settings.videos.looping}
              on:click={() => toggleSection('videos', 'looping')}
              aria-label="Toggle looping"
            >
              <span class="thumb"></span>
            </button>
          </div>
        </div>

        <div class="divider"></div>

        <!-- Theme -->
        <div class="section">
          <div class="section-title">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32 1.41 1.41M2 12h2m16 0h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>
            </svg>
            Theme
          </div>
          <div class="setting-row">
            <div class="setting-info">
              <div class="setting-label">Automatic</div>
              <div class="setting-desc">Follow system dark/light mode setting</div>
            </div>
            <button
              class="toggle" class:on={$settings.theme.automatic}
              on:click={() => toggleSection('theme', 'automatic')}
              aria-label="Toggle automatic theme"
            >
              <span class="thumb"></span>
            </button>
          </div>
          <div class="setting-row">
            <div class="setting-info">
              <div class="setting-label">Primary color</div>
              <div class="setting-desc">Accent color for actions and highlights</div>
            </div>
            <div class="color-pick">
              <input
                type="color"
                bind:value={colorInput}
                on:change={() => setPrimaryColor(colorInput)}
                class="color-input"
                title="Pick primary color"
              />
              {#if $settings.theme.primaryColor}
                <button class="color-reset" on:click={() => setPrimaryColor(null)} title="Reset to default">✕</button>
              {/if}
            </div>
          </div>
          <div class="setting-row">
            <div class="setting-info">
              <div class="setting-label">Colorful interface</div>
              <div class="setting-desc">Apply primary color to background surfaces</div>
            </div>
            <button
              class="toggle" class:on={$settings.theme.colorfulInterface}
              on:click={() => toggleSection('theme', 'colorfulInterface')}
              aria-label="Toggle colorful interface"
            >
              <span class="thumb"></span>
            </button>
          </div>
        </div>

        <div class="divider"></div>

        <!-- Photo Grid -->
        <div class="section">
          <div class="section-title">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="14" y="3" rx="1"/><rect width="7" height="7" x="14" y="14" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/>
            </svg>
            Photo Grid
          </div>
          <div class="setting-row">
            <div class="setting-info">
              <div class="setting-label">Show asset title</div>
              <div class="setting-desc">Display filename and storage info on tiles</div>
            </div>
            <button
              class="toggle" class:on={$settings.photoGrid.showStorageIndicator}
              on:click={() => toggleSection('photoGrid', 'showStorageIndicator')}
              aria-label="Toggle show asset title"
            >
              <span class="thumb"></span>
            </button>
          </div>
          <div class="setting-row layout-row">
            <div class="setting-info">
              <div class="setting-label">Layout</div>
              <div class="setting-desc">Number of assets per row (2 – 8)</div>
            </div>
            <div class="range-control">
              <span class="range-val">{$settings.photoGrid.assetsPerRow}</span>
              <input
                type="range" min="2" max="8" step="1"
                value={$settings.photoGrid.assetsPerRow}
                on:input={onRangeInput}
                class="range-input"
              />
            </div>
          </div>
        </div>

      </div>
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
    width: 100%; max-width: 460px; max-height: 85vh;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 20px;
    box-shadow: var(--shadow-2xl);
    display: flex; flex-direction: column;
    overflow: hidden;
  }

  .panel-header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 1.1rem 1.4rem;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }

  .panel-title {
    display: flex; align-items: center; gap: 0.6rem;
    font-size: 1rem; font-weight: 700; color: var(--text);
  }

  .close-btn {
    width: 28px; height: 28px; border-radius: 8px;
    background: transparent; border: 1px solid var(--border);
    color: var(--text-muted); font-size: 0.85rem;
    display: flex; align-items: center; justify-content: center;
    transition: all 0.15s;
  }
  .close-btn:hover { background: var(--surface-hover); color: var(--text); }

  .panel-body {
    overflow-y: auto; padding: 0.5rem 0;
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
    gap: 1rem; padding: 0.6rem 0;
  }

  .setting-info { flex: 1; min-width: 0; }
  .setting-label { font-size: 0.875rem; font-weight: 500; color: var(--text); }
  .setting-desc { font-size: 0.775rem; color: var(--text-muted); margin-top: 0.1rem; }

  /* Toggle switch */
  .toggle {
    width: 40px; height: 22px; border-radius: 11px;
    background: var(--border); border: none;
    position: relative; flex-shrink: 0;
    transition: background 0.2s;
    padding: 0;
  }
  .toggle.on { background: var(--accent); }

  .thumb {
    position: absolute; top: 3px; left: 3px;
    width: 16px; height: 16px; border-radius: 50%;
    background: #fff;
    transition: transform 0.2s;
    box-shadow: 0 1px 3px rgba(0,0,0,0.2);
  }
  .toggle.on .thumb { transform: translateX(18px); }

  /* Color picker */
  .color-pick {
    display: flex; align-items: center; gap: 0.35rem; flex-shrink: 0;
  }

  .color-input {
    width: 36px; height: 28px; padding: 2px; border-radius: 8px;
    border: 1.5px solid var(--border); cursor: pointer;
    background: transparent;
  }

  .color-reset {
    width: 22px; height: 22px; border-radius: 6px;
    background: transparent; border: 1px solid var(--border);
    color: var(--text-muted); font-size: 0.7rem;
    display: flex; align-items: center; justify-content: center;
    transition: all 0.15s;
  }
  .color-reset:hover { background: var(--surface-hover); color: var(--text); }

  /* Range */
  .range-control {
    display: flex; align-items: center; gap: 0.6rem; flex-shrink: 0;
  }

  .range-val {
    font-size: 0.875rem; font-weight: 700; color: var(--accent);
    min-width: 1.2rem; text-align: center;
  }

  .range-input {
    width: 110px; accent-color: var(--accent);
    cursor: pointer;
  }

  .layout-row { align-items: flex-start; padding-top: 0.75rem; }
</style>
