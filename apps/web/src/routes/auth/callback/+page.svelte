<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import { auth } from '$lib/stores';
  import { api } from '$lib/api';

  let error = '';

  onMount(async () => {
    const token = $page.url.searchParams.get('token');
    if (!token) {
      error = 'No token received from SSO provider';
      return;
    }

    try {
      // Store token temporarily so api.auth.me() works
      localStorage.setItem('photoapp_token', token);
      const user = await api.auth.me();
      auth.login(token, user);
      goto('/photos');
    } catch (e) {
      localStorage.removeItem('photoapp_token');
      error = 'SSO login failed. Please try again.';
    }
  });
</script>

<style>
  .container {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 100vh;
    flex-direction: column;
    gap: 1rem;
    color: var(--text-muted);
  }

  .spinner {
    width: 32px;
    height: 32px;
    border: 3px solid var(--border);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .error {
    color: #ef4444;
    font-size: 0.9rem;
  }
</style>

<div class="container">
  {#if error}
    <div class="error">{error}</div>
    <a href="/" style="color:var(--accent); font-size:0.9rem">Back to login</a>
  {:else}
    <div class="spinner"></div>
    <span>Signing you in…</span>
  {/if}
</div>
