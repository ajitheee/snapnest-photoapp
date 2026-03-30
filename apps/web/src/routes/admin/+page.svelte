<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { auth } from '$lib/stores';
  import { api, type AdminUser, type AdminStats } from '$lib/api';

  let tab: 'users' | 'stats' = 'users';
  let loading = true;
  let error = '';

  let stats: AdminStats | null = null;
  let users: AdminUser[] = [];
  let total = 0;
  let page = 1;
  const limit = 50;

  // Edit state
  let editingId: string | null = null;
  let editName = '';
  let editIsAdmin = false;
  let editStorageLimit = '';
  let saving = false;

  onMount(async () => {
    if (!$auth.user?.isAdmin) {
      goto('/photos');
      return;
    }
    await loadData();
  });

  async function loadData() {
    loading = true;
    error = '';
    try {
      [stats] = await Promise.all([
        api.admin.getStats(),
        loadUsers(),
      ]);
    } catch (e: any) {
      error = e.message;
    } finally {
      loading = false;
    }
  }

  async function loadUsers() {
    const result = await api.admin.getUsers(page, limit);
    users = result.users;
    total = result.total;
  }

  function startEdit(u: AdminUser) {
    editingId = u.id;
    editName = u.name;
    editIsAdmin = u.isAdmin;
    editStorageLimit = u.storageLimitBytes
      ? String(Math.round(Number(u.storageLimitBytes) / 1073741824))
      : '';
  }

  function cancelEdit() {
    editingId = null;
  }

  async function saveEdit(u: AdminUser) {
    saving = true;
    try {
      const limitBytes = editStorageLimit
        ? String(BigInt(Math.round(parseFloat(editStorageLimit) * 1073741824)))
        : null;
      await api.admin.updateUser(u.id, {
        name: editName,
        isAdmin: editIsAdmin,
        storageLimitBytes: limitBytes,
      });
      editingId = null;
      await loadUsers();
    } catch (e: any) {
      alert('Failed to save: ' + e.message);
    } finally {
      saving = false;
    }
  }

  async function deleteUser(u: AdminUser) {
    if (!confirm(`Delete user ${u.email}? This cannot be undone.`)) return;
    try {
      await api.admin.deleteUser(u.id);
      await loadUsers();
    } catch (e: any) {
      alert('Failed to delete: ' + e.message);
    }
  }

  function fmtBytes(bytes: string | number): string {
    const n = Number(bytes);
    if (n === 0) return '0 B';
    if (n < 1024) return n + ' B';
    if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
    if (n < 1073741824) return (n / 1048576).toFixed(1) + ' MB';
    return (n / 1073741824).toFixed(2) + ' GB';
  }

  function queueTotal(q: Record<string, number>): number {
    return Object.values(q).reduce((a, b) => a + b, 0);
  }
</script>

<style>
  .page {
    padding: 2rem;
    max-width: 1200px;
  }

  h1 {
    font-size: 1.5rem;
    font-weight: 700;
    margin-bottom: 1.5rem;
    color: var(--text);
  }

  .tabs {
    display: flex;
    gap: 0.5rem;
    margin-bottom: 1.5rem;
    border-bottom: 1px solid var(--border);
  }

  .tab-btn {
    padding: 0.5rem 1rem;
    background: transparent;
    border: none;
    border-bottom: 2px solid transparent;
    font-size: 0.9rem;
    color: var(--text-muted);
    margin-bottom: -1px;
    transition: all 0.15s;
  }

  .tab-btn.active {
    color: var(--accent);
    border-bottom-color: var(--accent);
    font-weight: 600;
  }

  .tab-btn:hover:not(.active) {
    color: var(--text-2);
  }

  /* Stats cards */
  .stats-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
    gap: 1rem;
    margin-bottom: 2rem;
  }

  .stat-card {
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 1rem 1.25rem;
  }

  .stat-label {
    font-size: 0.75rem;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin-bottom: 0.4rem;
  }

  .stat-value {
    font-size: 1.5rem;
    font-weight: 700;
    color: var(--text);
  }

  .queues-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: 1rem;
  }

  .queue-card {
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 1rem;
  }

  .queue-name {
    font-size: 0.8rem;
    font-weight: 600;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin-bottom: 0.75rem;
  }

  .queue-row {
    display: flex;
    justify-content: space-between;
    font-size: 0.82rem;
    color: var(--text-2);
    padding: 0.15rem 0;
  }

  .queue-row .val {
    font-weight: 600;
    color: var(--text);
  }

  /* Users table */
  .table-wrap {
    overflow-x: auto;
    border: 1px solid var(--border);
    border-radius: 10px;
  }

  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.875rem;
  }

  thead {
    background: var(--surface-2);
  }

  th {
    padding: 0.65rem 0.9rem;
    text-align: left;
    font-weight: 600;
    font-size: 0.78rem;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    border-bottom: 1px solid var(--border);
    white-space: nowrap;
  }

  td {
    padding: 0.6rem 0.9rem;
    border-bottom: 1px solid var(--border);
    color: var(--text-2);
    vertical-align: middle;
  }

  tr:last-child td {
    border-bottom: none;
  }

  tr:hover td {
    background: var(--surface-2);
  }

  .badge {
    display: inline-block;
    padding: 0.2rem 0.5rem;
    border-radius: 999px;
    font-size: 0.7rem;
    font-weight: 600;
  }

  .badge-admin {
    background: #eff6ff;
    color: #1d4ed8;
  }

  .badge-user {
    background: var(--surface-2);
    color: var(--text-muted);
  }

  :global([data-theme='dark']) .badge-admin {
    background: #1e3a5f;
    color: #93c5fd;
  }

  .quota-bar {
    width: 80px;
    height: 5px;
    background: var(--border);
    border-radius: 3px;
    overflow: hidden;
    display: inline-block;
    vertical-align: middle;
    margin-right: 0.4rem;
  }

  .quota-fill {
    height: 100%;
    border-radius: 3px;
    background: var(--accent);
    transition: width 0.3s;
  }

  .quota-fill.warn { background: #f59e0b; }
  .quota-fill.danger { background: #ef4444; }

  .edit-input {
    padding: 0.3rem 0.5rem;
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--text);
    font-size: 0.82rem;
    width: 130px;
  }

  .edit-input:focus {
    outline: none;
    border-color: var(--accent);
  }

  .actions {
    display: flex;
    gap: 0.4rem;
    align-items: center;
  }

  .btn {
    padding: 0.3rem 0.65rem;
    border-radius: 6px;
    font-size: 0.8rem;
    border: 1px solid var(--border);
    background: transparent;
    color: var(--text-muted);
    transition: all 0.15s;
    white-space: nowrap;
  }

  .btn:hover { color: var(--text); border-color: var(--border-2); }

  .btn-primary {
    background: var(--accent);
    color: #fff;
    border-color: var(--accent);
  }

  .btn-primary:hover { opacity: 0.88; }

  .btn-danger {
    border-color: #fca5a5;
    color: #ef4444;
  }

  .btn-danger:hover { background: #fef2f2; }

  :global([data-theme='dark']) .btn-danger:hover { background: #3f1010; }

  .pagination {
    display: flex;
    align-items: center;
    gap: 1rem;
    margin-top: 1rem;
    font-size: 0.85rem;
    color: var(--text-muted);
  }

  .error {
    color: #ef4444;
    font-size: 0.9rem;
    padding: 1rem;
  }

  .loading-msg {
    color: var(--text-muted);
    padding: 2rem;
    text-align: center;
  }
</style>

<div class="page">
  <h1>⚙ Admin</h1>

  <div class="tabs">
    <button class="tab-btn" class:active={tab === 'users'} on:click={() => tab = 'users'}>
      Users
    </button>
    <button class="tab-btn" class:active={tab === 'stats'} on:click={() => tab = 'stats'}>
      System Stats
    </button>
  </div>

  {#if loading}
    <div class="loading-msg">Loading…</div>
  {:else if error}
    <div class="error">{error}</div>
  {:else if tab === 'stats' && stats}
    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-label">Total Users</div>
        <div class="stat-value">{stats.users}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Total Assets</div>
        <div class="stat-value">{stats.assets.toLocaleString()}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Storage Used</div>
        <div class="stat-value">{fmtBytes(stats.storageBytesTotal)}</div>
      </div>
      {#each Object.entries(stats.queues) as [name, counts]}
        <div class="stat-card">
          <div class="stat-label">{name} queue</div>
          <div class="stat-value">{queueTotal(counts)}</div>
        </div>
      {/each}
    </div>

    <div class="queues-grid">
      {#each Object.entries(stats.queues) as [name, counts]}
        <div class="queue-card">
          <div class="queue-name">{name}</div>
          {#each Object.entries(counts) as [state, count]}
            <div class="queue-row">
              <span>{state}</span>
              <span class="val">{count}</span>
            </div>
          {/each}
        </div>
      {/each}
    </div>

  {:else if tab === 'users'}
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>User</th>
            <th>Role</th>
            <th>Assets</th>
            <th>Storage Used</th>
            <th>Quota (GB)</th>
            <th>Joined</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {#each users as u (u.id)}
            {@const usedNum = Number(u.storageUsedBytes)}
            {@const limitNum = u.storageLimitBytes ? Number(u.storageLimitBytes) : 0}
            {@const pct = limitNum > 0 ? Math.min(100, (usedNum / limitNum) * 100) : 0}
            <tr>
              <td>
                {#if editingId === u.id}
                  <input class="edit-input" bind:value={editName} placeholder="Name" />
                  <div style="font-size:0.75rem; color:var(--text-muted); margin-top:0.2rem">{u.email}</div>
                {:else}
                  <div style="font-weight:500;color:var(--text)">{u.name}</div>
                  <div style="font-size:0.75rem; color:var(--text-muted)">{u.email}</div>
                {/if}
              </td>
              <td>
                {#if editingId === u.id}
                  <label style="font-size:0.82rem; display:flex; align-items:center; gap:0.4rem">
                    <input type="checkbox" bind:checked={editIsAdmin} />
                    Admin
                  </label>
                {:else}
                  <span class="badge" class:badge-admin={u.isAdmin} class:badge-user={!u.isAdmin}>
                    {u.isAdmin ? 'Admin' : 'User'}
                  </span>
                {/if}
              </td>
              <td>{u._count.assets.toLocaleString()}</td>
              <td>{fmtBytes(u.storageUsedBytes)}</td>
              <td>
                {#if editingId === u.id}
                  <input
                    class="edit-input"
                    type="number"
                    min="0"
                    step="1"
                    bind:value={editStorageLimit}
                    placeholder="Unlimited"
                    style="width:100px"
                  />
                {:else if limitNum > 0}
                  <div style="display:flex; align-items:center; gap:0.4rem">
                    <div class="quota-bar">
                      <div
                        class="quota-fill"
                        class:warn={pct >= 80 && pct < 95}
                        class:danger={pct >= 95}
                        style="width:{pct}%"
                      ></div>
                    </div>
                    <span style="font-size:0.78rem;color:var(--text-muted)">
                      {(limitNum / 1073741824).toFixed(0)} GB
                    </span>
                  </div>
                {:else}
                  <span style="color:var(--text-muted); font-size:0.82rem">Unlimited</span>
                {/if}
              </td>
              <td style="white-space:nowrap;font-size:0.8rem">{new Date(u.createdAt).toLocaleDateString()}</td>
              <td>
                <div class="actions">
                  {#if editingId === u.id}
                    <button class="btn btn-primary" on:click={() => saveEdit(u)} disabled={saving}>
                      {saving ? 'Saving…' : 'Save'}
                    </button>
                    <button class="btn" on:click={cancelEdit}>Cancel</button>
                  {:else}
                    <button class="btn" on:click={() => startEdit(u)}>Edit</button>
                    {#if u.id !== $auth.user?.id}
                      <button class="btn btn-danger" on:click={() => deleteUser(u)}>Delete</button>
                    {/if}
                  {/if}
                </div>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>

    <div class="pagination">
      <button class="btn" on:click={() => { page--; loadUsers(); }} disabled={page <= 1}>
        Previous
      </button>
      <span>Page {page} · {total} users</span>
      <button class="btn" on:click={() => { page++; loadUsers(); }} disabled={page * limit >= total}>
        Next
      </button>
    </div>
  {/if}
</div>
