<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { api } from '$lib/api';
  import { auth, isAuthenticated } from '$lib/stores';

  let mode: 'login' | 'register' = 'login';
  let email = '';
  let password = '';
  let name = '';
  let error = '';
  let loading = false;

  onMount(() => {
    auth.init();
  });

  $: if ($isAuthenticated) {
    goto('/photos');
  }

  async function handleSubmit() {
    error = '';
    loading = true;

    try {
      let result;
      if (mode === 'login') {
        result = await api.auth.login(email, password);
      } else {
        if (!name.trim()) {
          error = 'Name is required';
          loading = false;
          return;
        }
        result = await api.auth.register(email, password, name);
      }
      auth.login(result.accessToken, result.user);
      goto('/photos');
    } catch (e) {
      error = e instanceof Error ? e.message : 'An error occurred';
    } finally {
      loading = false;
    }
  }
</script>

<style>
  .container {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 100vh;
    padding: 2rem;
  }

  .card {
    width: 100%;
    max-width: 400px;
    background: #1a1a1a;
    border: 1px solid #2a2a2a;
    border-radius: 12px;
    padding: 2.5rem;
  }

  h1 {
    font-size: 1.75rem;
    font-weight: 700;
    margin-bottom: 0.25rem;
    letter-spacing: -0.03em;
  }

  h1 span {
    color: #4f8ef7;
  }

  .subtitle {
    color: #666;
    font-size: 0.9rem;
    margin-bottom: 2rem;
  }

  .tab-row {
    display: flex;
    background: #111;
    border-radius: 8px;
    padding: 4px;
    margin-bottom: 1.5rem;
    gap: 4px;
  }

  .tab-btn {
    flex: 1;
    padding: 0.5rem;
    background: transparent;
    border: none;
    color: #666;
    font-size: 0.9rem;
    border-radius: 6px;
    transition: all 0.15s;
  }

  .tab-btn.active {
    background: #2a2a2a;
    color: #fff;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    margin-bottom: 1rem;
  }

  label {
    font-size: 0.85rem;
    color: #aaa;
  }

  input {
    padding: 0.6rem 0.8rem;
    background: #111;
    border: 1px solid #333;
    border-radius: 8px;
    color: #fff;
    font-size: 0.95rem;
    outline: none;
    transition: border-color 0.15s;
  }

  input:focus {
    border-color: #4f8ef7;
  }

  .error {
    background: rgba(239, 68, 68, 0.1);
    border: 1px solid rgba(239, 68, 68, 0.3);
    color: #f87171;
    padding: 0.6rem 0.8rem;
    border-radius: 8px;
    font-size: 0.85rem;
    margin-bottom: 1rem;
  }

  .submit-btn {
    width: 100%;
    padding: 0.7rem;
    background: #4f8ef7;
    border: none;
    border-radius: 8px;
    color: #fff;
    font-size: 1rem;
    font-weight: 600;
    transition: background 0.15s, opacity 0.15s;
    margin-top: 0.5rem;
  }

  .submit-btn:hover:not(:disabled) {
    background: #3a7de8;
  }

  .submit-btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
</style>

<div class="container">
  <div class="card">
    <h1>Photo<span>App</span></h1>
    <p class="subtitle">Self-hosted photo management</p>

    <div class="tab-row">
      <button
        class="tab-btn"
        class:active={mode === 'login'}
        on:click={() => { mode = 'login'; error = ''; }}
      >
        Sign in
      </button>
      <button
        class="tab-btn"
        class:active={mode === 'register'}
        on:click={() => { mode = 'register'; error = ''; }}
      >
        Create account
      </button>
    </div>

    <form on:submit|preventDefault={handleSubmit}>
      {#if mode === 'register'}
        <div class="field">
          <label for="name">Full name</label>
          <input
            id="name"
            type="text"
            bind:value={name}
            placeholder="Jane Smith"
            autocomplete="name"
            required
          />
        </div>
      {/if}

      <div class="field">
        <label for="email">Email address</label>
        <input
          id="email"
          type="email"
          bind:value={email}
          placeholder="jane@example.com"
          autocomplete="email"
          required
        />
      </div>

      <div class="field">
        <label for="password">Password</label>
        <input
          id="password"
          type="password"
          bind:value={password}
          placeholder={mode === 'register' ? 'At least 8 characters' : ''}
          autocomplete={mode === 'login' ? 'current-password' : 'new-password'}
          required
        />
      </div>

      {#if error}
        <div class="error">{error}</div>
      {/if}

      <button class="submit-btn" type="submit" disabled={loading}>
        {loading ? 'Please wait...' : mode === 'login' ? 'Sign in' : 'Create account'}
      </button>
    </form>
  </div>
</div>
