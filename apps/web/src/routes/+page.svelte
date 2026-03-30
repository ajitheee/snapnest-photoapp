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
    background: linear-gradient(135deg, #667eea 0%, #764ba2 60%, #f093fb 100%);
    position: relative;
    overflow: hidden;
  }

  .container::before {
    content: '';
    position: absolute;
    inset: 0;
    background:
      radial-gradient(ellipse at 15% 85%, rgba(120, 119, 198, 0.5) 0%, transparent 55%),
      radial-gradient(ellipse at 85% 15%, rgba(240, 147, 251, 0.3) 0%, transparent 55%),
      radial-gradient(ellipse at 50% 50%, rgba(102, 126, 234, 0.2) 0%, transparent 60%);
  }

  .container::after {
    content: '';
    position: absolute;
    width: 600px;
    height: 600px;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.04);
    top: -200px;
    right: -200px;
    pointer-events: none;
  }

  .card {
    width: 100%;
    max-width: 420px;
    background: #ffffff;
    border-radius: 24px;
    padding: 2.75rem 2.5rem;
    box-shadow:
      0 32px 64px rgba(0, 0, 0, 0.28),
      0 8px 24px rgba(0, 0, 0, 0.16),
      0 0 0 1px rgba(255, 255, 255, 0.1);
    position: relative;
    z-index: 1;
  }

  :global([data-theme="dark"]) .card {
    background: #17172a;
    box-shadow:
      0 32px 64px rgba(0, 0, 0, 0.6),
      0 8px 24px rgba(0, 0, 0, 0.4),
      0 0 0 1px rgba(255, 255, 255, 0.06);
  }

  .brand {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    margin-bottom: 0.4rem;
  }

  .brand-icon {
    width: 44px;
    height: 44px;
    background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%);
    border-radius: 14px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 1.25rem;
    box-shadow: 0 6px 16px rgba(99, 102, 241, 0.35);
  }

  h1 {
    font-size: 1.8rem;
    font-weight: 800;
    letter-spacing: -0.04em;
    color: #0f0f23;
    line-height: 1;
  }

  :global([data-theme="dark"]) h1 {
    color: #f0f0ff;
  }

  h1 span {
    color: #6366f1;
  }

  .subtitle {
    color: #6b7280;
    font-size: 0.875rem;
    margin-bottom: 2rem;
    margin-top: 0.4rem;
  }

  :global([data-theme="dark"]) .subtitle {
    color: #8888aa;
  }

  .tab-row {
    display: flex;
    background: #f3f4f6;
    border-radius: 12px;
    padding: 4px;
    margin-bottom: 1.75rem;
    gap: 4px;
  }

  :global([data-theme="dark"]) .tab-row {
    background: #1e1e30;
  }

  .tab-btn {
    flex: 1;
    padding: 0.55rem;
    background: transparent;
    border: none;
    color: #6b7280;
    font-size: 0.9rem;
    font-weight: 500;
    border-radius: 9px;
    transition: all 0.2s;
    font-family: inherit;
  }

  .tab-btn.active {
    background: #ffffff;
    color: #0f0f23;
    font-weight: 600;
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.1), 0 1px 2px rgba(0, 0, 0, 0.06);
  }

  :global([data-theme="dark"]) .tab-btn.active {
    background: #2a2a40;
    color: #f0f0ff;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    margin-bottom: 1rem;
  }

  label {
    font-size: 0.83rem;
    font-weight: 500;
    color: #374151;
  }

  :global([data-theme="dark"]) label {
    color: #d4d4e8;
  }

  input {
    padding: 0.7rem 0.9rem;
    background: #f9fafb;
    border: 1.5px solid #e5e7eb;
    border-radius: 12px;
    color: #0f0f23;
    font-size: 0.95rem;
    outline: none;
    transition: border-color 0.2s, box-shadow 0.2s;
    font-family: inherit;
  }

  :global([data-theme="dark"]) input {
    background: #1e1e30;
    border-color: #2a2a40;
    color: #f0f0ff;
  }

  input::placeholder {
    color: #9ca3af;
  }

  input:focus {
    border-color: #6366f1;
    box-shadow: 0 0 0 4px rgba(99, 102, 241, 0.12);
    background: #ffffff;
  }

  :global([data-theme="dark"]) input:focus {
    background: #17172a;
  }

  .error {
    background: rgba(239, 68, 68, 0.07);
    border: 1px solid rgba(239, 68, 68, 0.2);
    color: #ef4444;
    padding: 0.65rem 0.9rem;
    border-radius: 10px;
    font-size: 0.85rem;
    margin-bottom: 1rem;
    font-weight: 500;
  }

  .submit-btn {
    width: 100%;
    padding: 0.8rem;
    background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%);
    border: none;
    border-radius: 12px;
    color: #fff;
    font-size: 0.95rem;
    font-weight: 600;
    letter-spacing: 0.01em;
    transition: opacity 0.15s, transform 0.15s, box-shadow 0.15s;
    margin-top: 0.5rem;
    box-shadow: 0 4px 12px rgba(99, 102, 241, 0.35);
    font-family: inherit;
  }

  .submit-btn:hover:not(:disabled) {
    opacity: 0.92;
    transform: translateY(-1px);
    box-shadow: 0 6px 20px rgba(99, 102, 241, 0.45);
  }

  .submit-btn:active:not(:disabled) {
    transform: translateY(0);
  }

  .submit-btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
</style>

<div class="container">
  <div class="card">
    <div class="brand">
      <div class="brand-icon">📷</div>
      <h1>Photo<span>App</span></h1>
    </div>
    <p class="subtitle">Your self-hosted photo library</p>

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
