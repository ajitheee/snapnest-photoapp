<script lang="ts">
  export let icon: string;
  export let title: string;
  export let description: string;
</script>

<style>
  .stub {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    min-height: 60vh;
    gap: 1rem;
    color: #555;
    text-align: center;
    padding: 2rem;
  }

  .stub-icon {
    font-size: 3rem;
    opacity: 0.5;
  }

  h2 {
    font-size: 1.25rem;
    font-weight: 600;
    color: #888;
  }

  p {
    font-size: 0.9rem;
    color: #444;
    max-width: 320px;
    line-height: 1.5;
  }

  .badge {
    display: inline-block;
    padding: 0.25rem 0.6rem;
    background: #1a2a1a;
    border: 1px solid #2a4a2a;
    border-radius: 99px;
    font-size: 0.75rem;
    color: #4caf50;
  }
</style>

<div class="stub">
  <div class="stub-icon">{icon}</div>
  <h2>{title}</h2>
  <p>{description}</p>
  <span class="badge">Coming in a future phase</span>
</div>
