<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { api } from '$lib/api';
  import { isAuthenticated } from '$lib/stores';

  interface UploadFile {
    file: File;
    status: 'pending' | 'uploading' | 'done' | 'error' | 'duplicate';
    error?: string;
    progress: number;
  }

  let files: UploadFile[] = [];
  let dragging = false;
  let uploading = false;
  let dropZone: HTMLElement;

  onMount(() => {
    if (!$isAuthenticated) {
      goto('/');
    }
  });

  function addFiles(newFiles: FileList | File[]) {
    const arr = Array.from(newFiles);
    const toAdd = arr.filter(
      (f) => !files.some((existing) => existing.file.name === f.name && existing.file.size === f.size)
    );
    files = [
      ...files,
      ...toAdd.map((f) => ({
        file: f,
        status: 'pending' as const,
        progress: 0,
      })),
    ];
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

    for (const item of pending) {
      item.status = 'uploading';
      item.progress = 0;
      files = files; // trigger reactivity

      try {
        const fileCreatedAt = new Date(item.file.lastModified).toISOString();
        await api.assets.upload(item.file, fileCreatedAt);
        item.status = 'done';
        item.progress = 100;
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
      files = files; // trigger reactivity
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
    color: #666;
    font-size: 0.9rem;
    transition: color 0.15s;
  }

  .back-link:hover {
    color: #fff;
  }

  .drop-zone {
    border: 2px dashed #333;
    border-radius: 12px;
    padding: 3rem 2rem;
    text-align: center;
    cursor: pointer;
    transition: border-color 0.15s, background 0.15s;
    margin-bottom: 1.5rem;
    position: relative;
  }

  .drop-zone.dragging {
    border-color: #4f8ef7;
    background: rgba(79, 142, 247, 0.05);
  }

  .drop-zone:hover {
    border-color: #444;
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
    color: #666;
    font-size: 0.9rem;
    margin-bottom: 1.5rem;
  }

  .browse-btn {
    display: inline-block;
    padding: 0.5rem 1.2rem;
    background: #1a1a1a;
    border: 1px solid #333;
    border-radius: 8px;
    color: #ccc;
    font-size: 0.9rem;
    transition: all 0.15s;
  }

  .browse-btn:hover {
    border-color: #555;
    color: #fff;
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
    background: #4f8ef7;
    border: none;
    border-radius: 8px;
    color: #fff;
    font-size: 0.95rem;
    font-weight: 600;
    transition: background 0.15s, opacity 0.15s;
  }

  .upload-btn:hover:not(:disabled) {
    background: #3a7de8;
  }

  .upload-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .clear-btn {
    padding: 0.6rem 1rem;
    background: transparent;
    border: 1px solid #333;
    border-radius: 8px;
    color: #666;
    font-size: 0.9rem;
    transition: all 0.15s;
  }

  .clear-btn:hover {
    border-color: #555;
    color: #aaa;
  }

  .summary {
    color: #666;
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
    background: #1a1a1a;
    border: 1px solid #2a2a2a;
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
    color: #555;
    margin-top: 2px;
  }

  .file-status {
    flex-shrink: 0;
    font-size: 0.82rem;
    padding: 2px 8px;
    border-radius: 4px;
  }

  .status-pending { color: #888; }
  .status-uploading { color: #4f8ef7; }
  .status-done { color: #4ade80; }
  .status-error { color: #f87171; }
  .status-duplicate { color: #fb923c; }

  .remove-btn {
    background: transparent;
    border: none;
    color: #444;
    font-size: 1rem;
    padding: 0 0.25rem;
    transition: color 0.15s;
    flex-shrink: 0;
  }

  .remove-btn:hover {
    color: #f87171;
  }

  .progress-bar {
    height: 2px;
    background: #222;
    border-radius: 1px;
    margin-top: 4px;
    overflow: hidden;
  }

  .progress-fill {
    height: 100%;
    background: #4f8ef7;
    border-radius: 1px;
    transition: width 0.2s;
  }
</style>

<div class="page">
  <div class="header">
    <h2>Upload Photos</h2>
    <a class="back-link" href="/photos">&larr; Back to photos</a>
  </div>

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
            {item.file.type.startsWith('video/') ? '&#127916;' : '&#128247;'}
          </span>

          <div class="file-info">
            <div class="file-name">{item.file.name}</div>
            <div class="file-meta">{formatSize(item.file.size)}</div>
            {#if item.status === 'uploading'}
              <div class="progress-bar">
                <div class="progress-fill" style="width: {item.progress}%"></div>
              </div>
            {/if}
            {#if item.error}
              <div class="file-meta" style="color: #f87171;">{item.error}</div>
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
