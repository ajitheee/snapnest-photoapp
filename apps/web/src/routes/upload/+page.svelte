<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { goto } from '$app/navigation';
  import { api } from '$lib/api';
  import type { SyncStatus } from '$lib/api';
  import { isAuthenticated } from '$lib/stores';

  let syncStatus: SyncStatus | null = null;
  let syncLoading = true;
  let syncInterval: ReturnType<typeof setInterval> | null = null;

  async function loadSyncStatus() {
    try {
      syncStatus = await api.assets.syncStatus();
    } catch { /* ignore */ }
    finally { syncLoading = false; }
  }

  interface UploadFile {
    file: File;
    status: 'pending' | 'uploading' | 'done' | 'error' | 'duplicate';
    error?: string;
    progress: number;
    isLivePair?: boolean;   // this MOV will be paired with the matching image
    pairedWith?: string;    // base name of the paired image file
  }

  const IMAGE_EXTS = new Set(['.heic', '.heif', '.jpg', '.jpeg', '.png', '.webp', '.avif']);
  const LIVE_VIDEO_EXTS = new Set(['.mov', '.mp4']);

  function getBaseName(name: string): string {
    return name.replace(/\.[^.]+$/, '').toLowerCase();
  }

  function detectLivePairs(all: UploadFile[]): UploadFile[] {
    const imageMap = new Map<string, UploadFile>();
    for (const f of all) {
      const ext = '.' + (f.file.name.split('.').pop() ?? '').toLowerCase();
      if (IMAGE_EXTS.has(ext)) imageMap.set(getBaseName(f.file.name), f);
    }
    return all.map(f => {
      const ext = '.' + (f.file.name.split('.').pop() ?? '').toLowerCase();
      if (LIVE_VIDEO_EXTS.has(ext)) {
        const base = getBaseName(f.file.name);
        if (imageMap.has(base)) return { ...f, isLivePair: true, pairedWith: base };
      }
      return f;
    });
  }

  let files: UploadFile[] = [];
  let dragging = false;
  let uploading = false;
  let dropZone: HTMLElement;

  onMount(() => {
    if (!$isAuthenticated) {
      goto('/');
      return;
    }
    loadSyncStatus();
    syncInterval = setInterval(loadSyncStatus, 5000);
  });

  onDestroy(() => {
    if (syncInterval) clearInterval(syncInterval);
  });

  function addFiles(newFiles: FileList | File[]) {
    const arr = Array.from(newFiles);
    const toAdd = arr.filter(
      (f) => !files.some((existing) => existing.file.name === f.name && existing.file.size === f.size)
    );
    const newItems = toAdd.map((f) => ({ file: f, status: 'pending' as const, progress: 0 }));
    files = detectLivePairs([...files, ...newItems]);
  }

  function handleDrop(e: DragEvent) {
    e.preventDefault();
    dragging = false;
    if (e.dataTransfer?.files) {
      addFiles(e.dataTransfer.files);
    }
  }

  function handleFileInput(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    if (input.files) {
      addFiles(input.files);
      input.value = '';
    }
  }

  function removeFile(index: number) {
    files = files.filter((_, i) => i !== index);
  }

  function clearCompleted() {
    files = files.filter((f) => f.status === 'pending' || f.status === 'error');
  }

  async function uploadAll() {
    const pending = files.filter((f) => f.status === 'pending');
    if (pending.length === 0) return;

    uploading = true;

    // Build a map of base name → uploaded asset id for live photo pairing
    const uploadedImages = new Map<string, string>();

    // Upload images first, then live video companions
    const images = pending.filter(f => !f.isLivePair);
    const livePairs = pending.filter(f => f.isLivePair);

    for (const item of [...images, ...livePairs]) {
      item.status = 'uploading';
      item.progress = 0;
      files = files;

      try {
        const fileCreatedAt = new Date(item.file.lastModified).toISOString();

        if (item.isLivePair && item.pairedWith) {
          // Attach as live photo companion to the previously uploaded image
          const parentId = uploadedImages.get(item.pairedWith);
          if (parentId) {
            await api.assets.attachLiveVideo(parentId, item.file);
            item.status = 'done';
            item.progress = 100;
            item.error = undefined;
          } else {
            item.status = 'error';
            item.error = 'Parent image not uploaded yet';
          }
        } else {
          const asset = await api.assets.upload(item.file, fileCreatedAt);
          uploadedImages.set(getBaseName(item.file.name), asset.id);
          item.status = 'done';
          item.progress = 100;
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Upload failed';
        if (msg.toLowerCase().includes('already exists')) {
          item.status = 'duplicate';
          item.error = 'Already in your library';
        } else {
          item.status = 'error';
          item.error = msg;
        }
      }
      files = files;
    }

    uploading = false;
  }

  function formatSize(bytes: number) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  $: pendingCount = files.filter((f) => f.status === 'pending').length;
  $: doneCount = files.filter((f) => f.status === 'done').length;
</script>

<style>
  .page {
    padding: 2rem 1.5rem;
    max-width: 900px;
    margin: 0 auto;
  }

  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 2rem;
  }

  h2 {
    font-size: 1.5rem;
    font-weight: 700;
  }

  .back-link {
    color: var(--text-muted);
    font-size: 0.9rem;
    transition: color 0.15s;
  }

  .back-link:hover {
    color: var(--text);
  }

  .drop-zone {
    border: 2px dashed var(--border);
    border-radius: 12px;
    padding: 3rem 2rem;
    text-align: center;
    cursor: pointer;
    transition: border-color 0.15s, background 0.15s;
    margin-bottom: 1.5rem;
    position: relative;
  }

  .drop-zone.dragging {
    border-color: var(--accent);
    background: var(--active-bg);
  }

  .drop-zone:hover {
    border-color: var(--border-2);
  }

  .drop-icon {
    font-size: 3rem;
    margin-bottom: 1rem;
    display: block;
  }

  .drop-title {
    font-size: 1.1rem;
    font-weight: 600;
    margin-bottom: 0.5rem;
  }

  .drop-sub {
    color: var(--text-muted);
    font-size: 0.9rem;
    margin-bottom: 0.5rem;
  }
  .live-photo-hint {
    font-size: 0.78rem;
    color: var(--text-muted);
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 0.4rem 0.75rem;
    margin-bottom: 1rem;
    max-width: 400px;
  }
  .live-photo-hint code {
    font-family: monospace;
    background: var(--surface);
    padding: 0 3px;
    border-radius: 3px;
  }

  .browse-btn {
    display: inline-block;
    padding: 0.5rem 1.2rem;
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: 8px;
    color: var(--text-2);
    font-size: 0.9rem;
    transition: all 0.15s;
  }

  .browse-btn:hover {
    border-color: var(--border-2);
    color: var(--text);
  }

  .file-input {
    position: absolute;
    inset: 0;
    opacity: 0;
    cursor: pointer;
    width: 100%;
    height: 100%;
  }

  .actions {
    display: flex;
    gap: 0.75rem;
    align-items: center;
    margin-bottom: 1.5rem;
  }

  .upload-btn {
    padding: 0.6rem 1.4rem;
    background: var(--accent);
    border: none;
    border-radius: 8px;
    color: #fff;
    font-size: 0.95rem;
    font-weight: 600;
    transition: background 0.15s, opacity 0.15s;
  }

  .upload-btn:hover:not(:disabled) {
    background: var(--accent-hover);
  }

  .upload-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .clear-btn {
    padding: 0.6rem 1rem;
    background: transparent;
    border: 1px solid var(--border);
    border-radius: 8px;
    color: var(--text-muted);
    font-size: 0.9rem;
    transition: all 0.15s;
  }

  .clear-btn:hover {
    border-color: var(--border-2);
    color: var(--text-2);
  }

  .summary {
    color: var(--text-muted);
    font-size: 0.9rem;
    margin-left: auto;
  }

  .file-list {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .file-row {
    display: flex;
    align-items: center;
    gap: 1rem;
    padding: 0.75rem 1rem;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 8px;
  }

  .file-icon {
    font-size: 1.4rem;
    flex-shrink: 0;
  }

  .file-info {
    flex: 1;
    min-width: 0;
  }

  .file-name {
    font-size: 0.9rem;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .file-meta {
    font-size: 0.78rem;
    color: var(--text-muted);
    margin-top: 2px;
  }

  .file-status {
    flex-shrink: 0;
    font-size: 0.82rem;
    padding: 2px 8px;
    border-radius: 4px;
  }

  .status-pending { color: var(--text-muted); }
  .status-uploading { color: var(--accent); }
  .status-done { color: #16a34a; }
  .status-error { color: var(--error); }
  .status-duplicate { color: #d97706; }

  .remove-btn {
    background: transparent;
    border: none;
    color: var(--text-subtle);
    font-size: 1rem;
    padding: 0 0.25rem;
    transition: color 0.15s;
    flex-shrink: 0;
  }

  .remove-btn:hover {
    color: var(--error);
  }

  .progress-bar {
    height: 2px;
    background: var(--border);
    border-radius: 1px;
    margin-top: 4px;
    overflow: hidden;
  }

  .progress-fill {
    height: 100%;
    background: var(--accent);
    border-radius: 1px;
    transition: width 0.2s;
  }

  /* Sync status panel */
  .sync-panel {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 1rem 1.25rem;
    margin-bottom: 1.5rem;
  }

  .sync-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 0.75rem;
  }

  .sync-title {
    font-size: 0.95rem;
    font-weight: 700;
    color: var(--text);
  }

  .sync-summary {
    font-size: 0.8rem;
    color: var(--text-muted);
  }

  .sync-grid {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .sync-row {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .sync-label {
    font-size: 0.8rem;
    color: var(--text-2);
    min-width: 110px;
    flex-shrink: 0;
  }

  .sync-bar {
    flex: 1;
    height: 6px;
    background: var(--border);
    border-radius: 3px;
    overflow: hidden;
  }

  .sync-fill {
    height: 100%;
    background: var(--accent);
    border-radius: 3px;
    transition: width 0.4s ease;
  }

  .sync-fill.complete {
    background: #16a34a;
  }

  .sync-count {
    font-size: 0.75rem;
    color: var(--text-muted);
    min-width: 50px;
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
</style>

<div class="page">
  <div class="header">
    <h2>Upload Photos</h2>
    <a class="back-link" href="/photos">&larr; Back to photos</a>
  </div>

  {#if syncStatus && syncStatus.totalAssets > 0}
    <div class="sync-panel">
      <div class="sync-header">
        <span class="sync-title">
          {syncStatus.allDone ? '✓ Processing Complete' : '⟳ Processing Status'}
        </span>
        <span class="sync-summary">{syncStatus.totalAssets} asset{syncStatus.totalAssets !== 1 ? 's' : ''}</span>
      </div>
      <div class="sync-grid">
        {#each [
          { label: 'Thumbnails', item: syncStatus.thumbnails },
          { label: 'Metadata', item: syncStatus.metadata },
          { label: 'CLIP Embeddings', item: syncStatus.clipEmbeddings },
          { label: 'Face Detection', item: syncStatus.faceDetection },
          { label: 'Scene Tags', item: syncStatus.sceneTags },
          { label: 'Geocoding', item: syncStatus.geocoding },
          ...(syncStatus.videoCount > 0 ? [{ label: 'Transcoding', item: syncStatus.transcoding }] : []),
        ] as row}
          <div class="sync-row">
            <span class="sync-label">{row.label}</span>
            <div class="sync-bar">
              <div class="sync-fill" class:complete={row.item.done === row.item.total && row.item.total > 0}
                style="width: {row.item.total > 0 ? (row.item.done / row.item.total * 100) : 0}%"></div>
            </div>
            <span class="sync-count">{row.item.done}/{row.item.total}</span>
          </div>
        {/each}
      </div>
    </div>
  {/if}

  <!-- svelte-ignore a11y-no-static-element-interactions -->
  <div
    class="drop-zone"
    class:dragging
    bind:this={dropZone}
    on:dragover|preventDefault={() => (dragging = true)}
    on:dragleave={() => (dragging = false)}
    on:drop={handleDrop}
  >
    <input
      class="file-input"
      type="file"
      multiple
      accept="image/*,video/*"
      on:change={handleFileInput}
    />
    <span class="drop-icon">&#128247;</span>
    <div class="drop-title">Drop photos and videos here</div>
    <div class="drop-sub">Supports JPEG, PNG, HEIC, MP4, MOV and more</div>
    <div class="live-photo-hint"><strong>iPhone Live Photos:</strong> select both the image <em>and</em> its companion <code>.MOV</code> together. For automatic pairing, use the SnapNest app.</div>
    <span class="browse-btn">Browse files</span>
  </div>

  {#if files.length > 0}
    <div class="actions">
      <button
        class="upload-btn"
        on:click={uploadAll}
        disabled={uploading || pendingCount === 0}
      >
        {uploading ? 'Uploading...' : `Upload ${pendingCount} file${pendingCount !== 1 ? 's' : ''}`}
      </button>

      {#if doneCount > 0}
        <button class="clear-btn" on:click={clearCompleted}>
          Clear completed
        </button>
      {/if}

      <span class="summary">
        {doneCount}/{files.length} uploaded
      </span>
    </div>

    <div class="file-list">
      {#each files as item, i (item.file.name + item.file.size)}
        <div class="file-row">
          <span class="file-icon">
            {item.isLivePair ? '&#9654;' : item.file.type.startsWith('video/') ? '&#127916;' : '&#128247;'}
          </span>

          <div class="file-info">
            <div class="file-name">
              {item.file.name}
              {#if item.isLivePair}<span style="font-size:0.72rem;color:#22c55e;margin-left:0.4rem">&#9654; Live</span>{/if}
            </div>
            <div class="file-meta">{formatSize(item.file.size)}</div>
            {#if item.status === 'uploading'}
              <div class="progress-bar">
                <div class="progress-fill" style="width: {item.progress}%"></div>
              </div>
            {/if}
            {#if item.error}
              <div class="file-meta" style="color: var(--error);">{item.error}</div>
            {/if}
          </div>

          <span class="file-status status-{item.status}">
            {#if item.status === 'pending'}Queued
            {:else if item.status === 'uploading'}Uploading...
            {:else if item.status === 'done'}Done
            {:else if item.status === 'duplicate'}Duplicate
            {:else}Failed{/if}
          </span>

          {#if item.status !== 'uploading'}
            <button
              class="remove-btn"
              on:click={() => removeFile(i)}
              title="Remove"
            >
              &times;
            </button>
          {/if}
        </div>
      {/each}
    </div>
  {/if}
</div>
