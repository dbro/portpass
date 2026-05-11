<script>
  import { getDatabaseInfo } from '../wasm.js'
  import { selectedFile } from '../store.js'
  import Icon from './Icon.svelte'

  let { onclose, onlock, onclosevault, theme, accent, ontheme, onaccent } = $props()

  const ACCENTS = ['amber', 'sage', 'slate', 'burgundy']
  const SWATCH  = { amber: '#b07418', sage: '#5a7a4f', slate: '#4a5d82', burgundy: '#8a3a3a' }

  let info = $state(null)
  let filename = $derived($selectedFile?.name ?? '')

  $effect(() => {
    try { info = getDatabaseInfo() } catch (e) { info = null }
  })
</script>

<div class="sheet-backdrop" role="dialog" aria-modal="true" onclick={onclose}>
  <div class="sheet" onclick={e => e.stopPropagation()}>
    <div class="sheet-handle"></div>
    <div class="sheet-body">

      <div class="sheet-section">
        {#if info}
          <div class="sheet-row">
            <span class="sheet-label muted">File</span>
            <span class="sheet-value">{filename}</span>
          </div>
          {#if info.Name}
            <div class="sheet-row">
              <span class="sheet-label muted">Vault name</span>
              <span class="sheet-value">{info.Name}</span>
            </div>
          {/if}
          {#if info.Description}
            <div class="sheet-row">
              <span class="sheet-label muted">Description</span>
              <span class="sheet-value">{info.Description}</span>
            </div>
          {/if}
        {:else}
          <div class="sheet-row">
            <span class="sheet-value">{filename}</span>
          </div>
        {/if}
      </div>

      <div class="sheet-section">
        <div class="sheet-section-title">Appearance</div>
        <div class="sheet-row">
          <span class="sheet-label muted">Theme</span>
          <div class="sheet-segmented" style="margin-top:4px">
            <button class:on={theme === 'light'} onclick={() => ontheme('light')}>Light</button>
            <button class:on={theme === 'dark'}  onclick={() => ontheme('dark')}>Dark</button>
          </div>
        </div>
        <div class="sheet-row" style="margin-top:10px">
          <span class="sheet-label muted">Accent</span>
          <div class="accent-swatches" style="margin-top:6px">
            {#each ACCENTS as a}
              <button class="swatch" class:on={accent === a} onclick={() => onaccent(a)} aria-label={a}>
                <span class="swatch-dot" style="background:{SWATCH[a]}"></span>
              </button>
            {/each}
          </div>
        </div>
      </div>

      <div class="sheet-actions">
        <button class="btn btn-ghost" onclick={onlock}>
          <Icon name="lock" size={16}/> Lock vault
        </button>
        <button class="btn btn-ghost danger" onclick={onclosevault}>Close vault</button>
      </div>

    </div>
  </div>
</div>
