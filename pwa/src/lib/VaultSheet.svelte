<script>
  import { getDatabaseInfo } from '../wasm.js'
  import { selectedFile } from '../store.js'
  import Icon from './Icon.svelte'

  let { onclose, onlock, onclosevault, ondbsave, theme, accent, ontheme, onaccent } = $props()

  const ACCENTS = ['amber', 'sage', 'slate', 'burgundy']
  const SWATCH  = { amber: '#b07418', sage: '#5a7a4f', slate: '#4a5d82', burgundy: '#8a3a3a' }

  let filename = $derived($selectedFile?.name ?? '')

  // Fetch once on mount — VaultSheet is only rendered while vault is open
  let info = (() => { try { return getDatabaseInfo() } catch { return null } })()

  let draftName = $state(info?.name        ?? '')
  let draftDesc = $state(info?.description ?? '')

  let origName = info?.name        ?? ''
  let origDesc = info?.description ?? ''

  let dirty = $derived(origName !== draftName || origDesc !== draftDesc)

  function save() {
    ondbsave({ Name: draftName, Description: draftDesc })
    origName = draftName
    origDesc = draftDesc
    onclose()
  }
</script>

<div class="sheet-backdrop" role="dialog" aria-modal="true" onclick={onclose}>
  <div class="sheet" onclick={e => e.stopPropagation()}>
    <div class="sheet-handle"></div>
    <div class="sheet-body">

      <div class="sheet-section">
        <div class="sheet-section-title">Vault info</div>

        <div class="sheet-field">
          <span class="sheet-label muted">Name</span>
          <input
            class="input sheet-input"
            value={draftName}
            oninput={e => draftName = e.target.value}
            placeholder="My vault"
          />
        </div>

        <div class="sheet-field">
          <span class="sheet-label muted">Notes</span>
          <textarea
            class="input sheet-input"
            rows={3}
            value={draftDesc}
            oninput={e => draftDesc = e.target.value}
            placeholder="Optional description"
          ></textarea>
        </div>

        <div class="sheet-field">
          <span class="sheet-label muted">File</span>
          <span class="sheet-value">{filename}</span>
        </div>

        {#if dirty}
          <button class="btn btn-primary" style="width:100%;margin-top:4px" onclick={save}>
            Save vault info
          </button>
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
      </div>

      <div class="sheet-section">
        <div class="sheet-section-title">About</div>
        <div class="about-row">
          <span class="about-name">Portpass</span>
          <span class="about-version muted">{__APP_VERSION__}</span>
        </div>
        <a
          class="about-url muted"
          href="https://dbro.github.io/portpass"
          target="_blank"
          rel="noreferrer"
        >dbro.github.io/portpass</a>
      </div>

    </div>
  </div>
</div>

<style>
  .sheet-field {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .sheet-input {
    font-size: 15px;
    padding: 10px 12px;
  }
  .about-row {
    display: flex;
    align-items: baseline;
    gap: 8px;
  }
  .about-name {
    font-size: 15px;
    font-weight: 600;
  }
  .about-version {
    font-size: 13px;
  }
  .about-url {
    font-size: 13px;
    color: var(--text-soft);
    text-decoration: none;
    display: block;
    margin-top: 2px;
  }
  .about-url:hover {
    color: var(--accent);
  }
</style>
