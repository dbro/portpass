<script>
  import { onMount } from 'svelte'
  import { loadWasm } from './wasm.js'

  let wasmReady = $state(false)
  let wasmError = $state(null)
  let view = $state('start') // start | dashboard

  onMount(async () => {
    try {
      await loadWasm()
      wasmReady = true
    } catch (e) {
      console.error('WASM load error', e)
      wasmError = e.message
    }
  })
</script>

<main>
  {#if wasmError}
    <div class="status error">Failed to load: {wasmError}</div>
  {:else if !wasmReady}
    <div class="status">Loading…</div>
  {:else if view === 'start'}
    <div class="status">Start page (todo)</div>
  {:else}
    <div class="status">Dashboard (todo)</div>
  {/if}
</main>

<style>
  main {
    height: 100%;
    display: flex;
    flex-direction: column;
  }

  .status {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 1rem;
    opacity: 0.5;
  }

  .error {
    color: red;
    opacity: 1;
  }
</style>
