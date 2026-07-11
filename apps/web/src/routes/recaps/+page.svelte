<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from '$lib/api';
  import type { Recap } from '$lib/api';

  let recaps: Recap[] = [];
  let loading = true;
  let generating = false;
  let generateMsg = '';
  let activeRecap: Recap | null = null;

  onMount(async () => {
    try {
      recaps = await api.recaps.list();
    } catch (e: any) {
      console.error('Failed to load recaps', e);
    } finally {
      loading = false;
    }
  });

  async function generateRecap() {
    generating = true;
    generateMsg = '';
    try {
      const result = await api.recaps.generate();
      if ('message' in result) {
        generateMsg = result.message;
      } else {
        generateMsg = 'Recap is being generated — this may take a minute...';
        setTimeout(async () => {
          recaps = await api.recaps.list();
          generating = false;
          generateMsg = '';
        }, 5000);
        return;
      }
    } catch (e: any) {
      generateMsg = e.message || 'Failed to generate recap';
    }
    generating = false;
  }

  function formatWeek(start: string, end: string): string {
    const s = new Date(start);
    const e = new Date(end);
    const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
    const startStr = s.toLocaleDateString('en-US', opts);
    const endStr = e.toLocaleDateString('en-US', { ...opts, year: 'numeric' });
    return `${startStr} – ${endStr}`;
  }

  function timeAgo(dateStr: string): string {
    const diff = Date.now() - new Date(dateStr).getTime();
    const days = Math.floor(diff / 86_400_000);
    if (days === 0) return 'This week';
    if (days < 7) return `${days} day${days > 1 ? 's' : ''} ago`;
    const weeks = Math.floor(days / 7);
    if (weeks < 5) return `${weeks} week${weeks > 1 ? 's' : ''} ago`;
    const months = Math.floor(days / 30);
    return `${months} month${months > 1 ? 's' : ''} ago`;
  }

  function openRecap(recap: Recap) {
    activeRecap = recap;
  }

  function closePlayer() {
    activeRecap = null;
  }

  function onPlayerKey(e: KeyboardEvent) {
    if (e.key === 'Escape') closePlayer();
  }
</script>

<svelte:window on:keydown={activeRecap ? onPlayerKey : undefined} />

<div class="recaps-page">
  <div class="page-header">
    <h1>Your Recaps</h1>
    <p class="subtitle">Weekly highlight reels from your photo library</p>
    <button class="generate-btn" on:click={generateRecap} disabled={generating}>
      {generating ? 'Generating...' : 'Generate This Week'}
    </button>
    {#if generateMsg}
      <p class="generate-msg">{generateMsg}</p>
    {/if}
  </div>

  {#if loading}
    <div class="loading">Loading recaps...</div>
  {:else if recaps.length === 0}
    <div class="empty">
      <div class="empty-icon">
        <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <polygon points="5 3 19 12 5 21 5 3"/>
          <line x1="19" y1="3" x2="19" y2="21"/>
        </svg>
      </div>
      <h2>No recaps yet</h2>
      <p>Click "Generate This Week" to create your first weekly photo recap.</p>
      <p class="hint">Recaps are automatically generated every Sunday at 10 AM.</p>
    </div>
  {:else}
    <div class="recaps-grid">
      {#each recaps as recap}
        <button class="recap-card" on:click={() => openRecap(recap)}>
          <div class="recap-cover">
            {#if recap.coverPath}
              <img src={api.recaps.coverUrl(recap.id)} alt="Week of {recap.weekStart}" />
            {:else}
              <div class="cover-placeholder">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                  <polygon points="5 3 19 12 5 21 5 3"/>
                </svg>
              </div>
            {/if}
            <div class="play-overlay">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="white">
                <polygon points="8 5 19 12 8 19 8 5"/>
              </svg>
            </div>
            <div class="recap-badge">{recap.photoCount} photos</div>
          </div>
          <div class="recap-info">
            <div class="recap-week">{formatWeek(recap.weekStart, recap.weekEnd)}</div>
            <div class="recap-meta">
              <span class="recap-ago">{timeAgo(recap.weekStart)}</span>
              {#if recap.locationSummary}
                <span class="recap-loc">{recap.locationSummary}</span>
              {/if}
            </div>
            {#if recap.peopleSummary}
              <div class="recap-people">With {recap.peopleSummary}</div>
            {/if}
          </div>
        </button>
      {/each}
    </div>
  {/if}
</div>

<!-- Full-screen video player -->
{#if activeRecap}
  <!-- svelte-ignore a11y-no-static-element-interactions -->
  <div class="player-backdrop" on:click|self={closePlayer}>
    <button class="player-close" on:click={closePlayer}>&#10005;</button>
    <div class="player-content">
      <div class="player-title">{formatWeek(activeRecap.weekStart, activeRecap.weekEnd)}</div>
      <!-- svelte-ignore a11y-media-has-caption -->
      <video
        class="player-video"
        src={api.recaps.videoUrl(activeRecap.id)}
        controls
        autoplay
        playsinline
      ></video>
      <div class="player-details">
        <span>{activeRecap.photoCount} moments</span>
        {#if activeRecap.locationSummary}
          <span>{activeRecap.locationSummary}</span>
        {/if}
        {#if activeRecap.peopleSummary}
          <span>With {activeRecap.peopleSummary}</span>
        {/if}
      </div>
    </div>
  </div>
{/if}

<style>
  .recaps-page {
    max-width: 1200px;
    margin: 0 auto;
    padding: 2rem;
  }

  .page-header {
    margin-bottom: 2rem;
  }

  .page-header h1 {
    font-size: 1.75rem;
    font-weight: 700;
    margin: 0 0 0.25rem;
  }

  .subtitle {
    color: var(--text-secondary, #888);
    font-size: 0.9rem;
    margin: 0 0 1rem;
  }

  .generate-btn {
    padding: 0.6rem 1.25rem;
    background: var(--accent, #6366f1);
    color: white;
    border: none;
    border-radius: 8px;
    font-size: 0.875rem;
    font-weight: 600;
    cursor: pointer;
    transition: opacity 0.15s;
  }
  .generate-btn:hover:not(:disabled) { opacity: 0.85; }
  .generate-btn:disabled { opacity: 0.5; cursor: not-allowed; }

  .generate-msg {
    margin-top: 0.5rem;
    font-size: 0.8rem;
    color: var(--text-secondary, #888);
  }

  .loading {
    text-align: center;
    padding: 4rem;
    color: var(--text-secondary, #888);
  }

  .empty {
    text-align: center;
    padding: 4rem 2rem;
    color: var(--text-secondary, #888);
  }
  .empty-icon {
    margin-bottom: 1rem;
    opacity: 0.3;
  }
  .empty h2 {
    font-size: 1.25rem;
    margin: 0 0 0.5rem;
    color: var(--text, #333);
  }
  .empty p { margin: 0.25rem 0; font-size: 0.9rem; }
  .hint { font-size: 0.8rem !important; opacity: 0.6; margin-top: 0.75rem !important; }

  .recaps-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 1.5rem;
  }

  .recap-card {
    background: var(--card, #fff);
    border: 1px solid var(--border, #e5e7eb);
    border-radius: 12px;
    overflow: hidden;
    cursor: pointer;
    transition: transform 0.15s, box-shadow 0.15s;
    text-align: left;
    padding: 0;
    width: 100%;
  }
  .recap-card:hover {
    transform: translateY(-2px);
    box-shadow: 0 8px 24px rgba(0,0,0,0.12);
  }

  .recap-cover {
    position: relative;
    aspect-ratio: 9/16;
    max-height: 320px;
    background: #111;
    overflow: hidden;
  }
  .recap-cover img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .cover-placeholder {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #444;
  }

  .play-overlay {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(0,0,0,0.25);
    opacity: 0;
    transition: opacity 0.2s;
  }
  .recap-card:hover .play-overlay { opacity: 1; }

  .recap-badge {
    position: absolute;
    bottom: 0.5rem;
    right: 0.5rem;
    background: rgba(0,0,0,0.7);
    color: white;
    font-size: 0.7rem;
    font-weight: 600;
    padding: 0.2rem 0.5rem;
    border-radius: 4px;
    backdrop-filter: blur(4px);
  }

  .recap-info {
    padding: 0.75rem 1rem;
  }

  .recap-week {
    font-weight: 600;
    font-size: 0.9rem;
    margin-bottom: 0.25rem;
  }

  .recap-meta {
    display: flex;
    gap: 0.5rem;
    font-size: 0.75rem;
    color: var(--text-secondary, #888);
    flex-wrap: wrap;
  }
  .recap-loc::before { content: '\b7\a0'; }

  .recap-people {
    font-size: 0.75rem;
    color: var(--text-secondary, #888);
    margin-top: 0.25rem;
  }

  /* ── Full-screen player ── */
  .player-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,0.95);
    z-index: 10000;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .player-close {
    position: fixed;
    top: 1rem;
    right: 1rem;
    background: rgba(255,255,255,0.1);
    border: none;
    border-radius: 50%;
    color: white;
    width: 2.5rem;
    height: 2.5rem;
    font-size: 1.2rem;
    cursor: pointer;
    z-index: 10001;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .player-close:hover { background: rgba(255,255,255,0.2); }

  .player-content {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1rem;
    max-width: 90vw;
    max-height: 90vh;
  }

  .player-title {
    color: white;
    font-size: 1.1rem;
    font-weight: 600;
  }

  .player-video {
    max-width: min(400px, 90vw);
    max-height: 70vh;
    border-radius: 12px;
    background: black;
    outline: none;
  }

  .player-details {
    display: flex;
    gap: 1rem;
    color: #aaa;
    font-size: 0.8rem;
  }
</style>
