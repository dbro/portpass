<script>
  import { onMount } from 'svelte'
  import { getDatabaseInfo, openDatabase } from '../wasm.js'
  import { selectedFile, dbItems } from '../store.js'
  import { isBiometricSupported, isBiometricEnrolled, enrollBiometric, clearBiometric } from './biometric.js'
  import Icon from './Icon.svelte'

  let { isDesktop, onback, onlock, ondbsave, ondirtychange, theme, accent, ontheme, onaccent } = $props()

  let biometricAvailable = $state(false)
  let biometricEnrolled  = $state(false)
  let setupMode          = $state(false)
  let setupPassword      = $state('')
  let setupError         = $state('')
  let setupBusy          = $state(false)
  let showSetupPw        = $state(false)

  onMount(async () => {
    biometricAvailable = await isBiometricSupported()
    biometricEnrolled  = await isBiometricEnrolled(info?.uuid)
  })

  async function disableBiometric() {
    await clearBiometric(info?.uuid)
    biometricEnrolled = false
    setupMode = false
  }

  function startSetup() {
    setupMode = true
    setupPassword = ''
    setupError = ''
    showSetupPw = false
  }

  function focusOnMount(node) {
    setTimeout(() => node.focus(), 0)
  }

  async function doSetup() {
    if (!setupPassword) return
    setupBusy = true
    setupError = ''
    try {
      // Verify password against the vault file before triggering WebAuthn
      const handle = $selectedFile?.handle
      if (handle) {
        const file = await handle.getFile()
        const buf  = await file.arrayBuffer()
        openDatabase(new Uint8Array(buf), setupPassword) // throws if wrong
      }
      // Password correct — now trigger WebAuthn enrollment
      await enrollBiometric(setupPassword, info?.uuid, filename)
      biometricEnrolled = true
      setupMode = false
      setupPassword = ''
      showSetupPw = false
    } catch (e) {
      if (e.name === 'NotAllowedError') {
        setupError = 'Setup cancelled.'
      } else if (e.message?.includes('decrypt')) {
        setupError = 'Wrong password.'
      } else {
        setupError = e.message
      }
    } finally {
      setupBusy = false
    }
  }

  const ACCENTS = ['amber', 'sage', 'slate', 'burgundy']
  const SWATCH  = { amber: '#b07418', sage: '#5a7a4f', slate: '#4a5d82', burgundy: '#8a3a3a' }

  let filename = $derived($selectedFile?.name ?? '')

  // Fetch once on mount — VaultSheet is only rendered while vault is open
  let info = (() => { try { return getDatabaseInfo() } catch { return null } })()

  let passwordCount = $derived($dbItems.length)
  let groupCount    = $derived(new Set($dbItems.map(i => i.group).filter(Boolean)).size)

  let draftName  = $state(info?.name        ?? '')
  let draftDesc  = $state(info?.description ?? '')
  let showNotes  = $state(!!(info?.description))

  let origName = info?.name        ?? ''
  let origDesc = info?.description ?? ''

  let dirty = $derived(origName !== draftName || origDesc !== draftDesc)

  // Notify parent of dirty state changes
  $effect(() => {
    ondirtychange?.(dirty)
  })

  function save() {
    ondbsave({ Name: draftName, Description: draftDesc })
    origName = draftName
    origDesc = draftDesc
  }
</script>

<!-- Mobile bar -->
<div class="record-bar" style={isDesktop ? 'display:none' : ''}>
  <button class="icon-btn" onclick={onback} aria-label="Back">
    <Icon name="back" size={22}/>
  </button>
  <div class="record-bar-group" style="text-transform:uppercase;font-size:13px;letter-spacing:0.04em;font-weight:600">Vault settings</div>
  {#if dirty}
    <button class="btn-text primary" onclick={save}>Save</button>
  {/if}
</div>

<!-- Desktop header -->
{#if isDesktop}
  <div class="record-pane-header">
    <button class="icon-btn" onclick={onback} aria-label="Back" style="margin-right:8px">
      <Icon name="back" size={20}/>
    </button>
    <span class="record-bar-group" style="text-transform:uppercase;font-size:13px;letter-spacing:0.04em;font-weight:600;flex:1">Vault settings</span>
    <div class="record-pane-actions" style="min-width:80px">
      {#if dirty}
        <button class="btn btn-primary" onclick={save} style="height:36px;padding:0 18px;font-size:14px">Save</button>
      {/if}
    </div>
  </div>
{/if}

<div class="record-body vault-settings-body">
  <div class="vault-section">
    <div class="vault-inputs">
      <label class="vault-field">
        <span class="vault-label muted">Name</span>
        <input
          class="input"
          value={draftName}
          oninput={e => draftName = e.target.value}
          placeholder="My vault"
        />
      </label>
      {#if showNotes}
        <label class="vault-field">
          <span class="vault-label muted">Notes</span>
          <textarea
            class="input"
            rows={3}
            value={draftDesc}
            oninput={e => draftDesc = e.target.value}
            placeholder="Optional description"
          ></textarea>
        </label>
      {:else}
        <button class="vault-add-notes" onclick={() => showNotes = true}>+ Add notes</button>
      {/if}
    </div>
    <div class="vault-stats">
      <div class="vault-stat">
        <span class="vault-stat-num">{passwordCount}</span>
        <span class="vault-stat-label muted">passwords</span>
      </div>
      {#if groupCount > 0}
        <div class="vault-stat-divider"></div>
        <div class="vault-stat">
          <span class="vault-stat-num">{groupCount}</span>
          <span class="vault-stat-label muted">groups</span>
        </div>
      {/if}
    </div>
    <div class="vault-file" style="margin-bottom:12px">
      <span class="vault-file-label">FILE</span>
      <span class="vault-file-value mono">{filename}</span>
    </div>
    <div class="vault-file-row">
      <div class="vault-file">
        <span class="vault-file-label">FORMAT</span>
        <span class="vault-file-value">{info?.version ?? '—'}</span>
      </div>
      <div class="vault-file">
        <span class="vault-file-label">UNLOCK DIFFICULTY</span>
        <span class="vault-file-value">{info?.iter?.toLocaleString() ?? '—'}</span>
      </div>
    </div>
  </div>

  {#if biometricAvailable}
    <div class="vault-section">
      <div class="vault-section-title">SECURITY</div>
      <div class="vault-toggle">
        <div class="vault-toggle-label">
          <span class="vault-toggle-name">Biometric/PIN unlock</span>
          <span class="vault-toggle-help">
            {biometricEnrolled ? 'Enabled' : 'Use Face ID, fingerprint, or PIN instead of typing your password'}
          </span>
        </div>
        <button
          class="switch"
          class:on={biometricEnrolled}
          onclick={biometricEnrolled ? disableBiometric : startSetup}
          aria-label="Biometric/PIN unlock"
        ></button>
      </div>
    </div>
  {/if}

  <div class="vault-section">
    <div class="vault-section-title">APPEARANCE</div>
    <div class="vault-row">
      <span class="vault-label muted">Theme</span>
      <div class="vault-segmented">
        <button class:on={theme === 'light'} onclick={() => ontheme('light')}>Light</button>
        <button class:on={theme === 'dark'}  onclick={() => ontheme('dark')}>Dark</button>
      </div>
    </div>
    <div class="vault-row" style="margin-top:16px">
      <span class="vault-label muted">Accent color</span>
      <div class="accent-swatches">
        {#each ACCENTS as a}
          <button class="swatch" class:on={accent === a} onclick={() => onaccent(a)} aria-label={a}>
            <span class="swatch-dot" style="background:{SWATCH[a]}"></span>
          </button>
        {/each}
      </div>
    </div>
  </div>

  <div class="vault-section">
    <div class="vault-section-title">ABOUT</div>
    <div class="about-row">
      <img src="{import.meta.env.BASE_URL}icon.svg" alt="Portpass" class="about-icon" />
      <div class="about-info">
        <div class="about-name">Portpass <span class="about-version muted">{__APP_VERSION__}</span></div>
        <a
          class="about-url muted"
          href="https://dbro.github.io/portpass"
          target="_blank"
          rel="noreferrer"
        >dbro.github.io/portpass</a>
      </div>
    </div>
  </div>

  <button class="btn btn-ghost" onclick={onlock} style="width:fit-content;margin-top:24px">
    <Icon name="lock" size={16}/> Lock vault
  </button>
</div>

{#if setupMode}
  <div class="modal-overlay" role="presentation"
    onclick={e => { e.stopPropagation(); setupMode = false; setupError = '' }}
    onkeydown={e => { if (e.key === 'Escape') { setupMode = false; setupError = '' } }}>
    <div class="modal" role="dialog" aria-modal="true" tabindex="-1" onclick={e => e.stopPropagation()} onkeydown={e => e.stopPropagation()}>
      <div class="modal-title">Enable biometric/PIN unlock</div>
      <p class="modal-desc muted">Confirm your master password to set up biometric unlock.</p>
      <div class="modal-pw">
        <input
          type={showSetupPw ? 'text' : 'password'}
          bind:value={setupPassword}
          placeholder="Master password"
          onkeydown={e => { if (e.key === 'Enter') doSetup() }}
          use:focusOnMount
        />
        <button class="icon-btn-flat" onclick={() => showSetupPw = !showSetupPw} aria-label="Toggle visibility">
          <Icon name={showSetupPw ? 'eye-off' : 'eye'} size={18}/>
        </button>
      </div>
      {#if setupError}<div class="unlock-error" style="font-size:13px">{setupError}</div>{/if}
      <div class="modal-actions">
        <button class="btn btn-ghost" onclick={() => { setupMode = false; setupError = '' }}>Cancel</button>
        <button class="btn btn-primary" disabled={!setupPassword || setupBusy} onclick={doSetup}>
          {setupBusy ? 'Setting up…' : 'Enable'}
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .vault-settings-body {
    max-width: none !important;
  }

  .vault-section {
    margin-bottom: 32px;
  }

  .vault-section-title {
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.06em;
    color: var(--text-soft);
    margin-bottom: 12px;
  }

  .vault-stats {
    display: flex;
    align-items: center;
    gap: 28px;
    margin: 20px 0 20px;
  }

  .vault-stat {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .vault-stat-num {
    font-size: 32px;
    font-weight: 700;
    line-height: 1;
  }

  .vault-stat-label {
    font-size: 13px;
  }

  .vault-stat-divider {
    width: 1px;
    height: 40px;
    background: var(--border);
  }

  .vault-inputs {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 16px;
    margin-bottom: 16px;
  }

  @media (max-width: 768px) {
    .vault-inputs {
      grid-template-columns: 1fr;
    }
  }

  .vault-field {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .vault-label {
    font-size: 14px;
  }

  .vault-add-notes {
    background: none;
    border: none;
    cursor: pointer;
    font-size: 14px;
    color: var(--accent);
    padding: 4px 0;
    text-align: left;
  }

  .vault-file-row {
    display: flex;
    gap: 32px;
    flex-wrap: wrap;
  }

  .vault-file {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .vault-file-label {
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.05em;
    color: var(--text-soft);
  }

  .vault-file-value {
    font-size: 14px;
    color: var(--text-muted);
  }

  .vault-row {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .vault-segmented {
    display: inline-flex;
    border-radius: var(--r-input);
    background: var(--surface-2);
    padding: 3px;
    gap: 4px;
    width: fit-content;
  }

  .vault-segmented button {
    padding: 8px 32px;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: var(--text-muted);
    font-size: 14px;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.15s, color 0.15s;
  }

  .vault-segmented button.on {
    background: var(--surface);
    color: var(--text);
    box-shadow: 0 1px 3px rgba(0,0,0,0.08);
  }

  .accent-swatches {
    display: flex;
    gap: 10px;
  }

  .swatch {
    width: 48px;
    height: 48px;
    border-radius: 50%;
    border: 2px solid var(--border);
    background: var(--surface);
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: border-color 0.15s, transform 0.15s;
    padding: 0;
  }

  .swatch:hover {
    transform: scale(1.08);
  }

  .swatch.on {
    border-color: var(--text);
    border-width: 3px;
  }

  .swatch-dot {
    width: 32px;
    height: 32px;
    border-radius: 50%;
  }

  .vault-toggle {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
  }

  .vault-toggle-label {
    display: flex;
    flex-direction: column;
    gap: 2px;
    flex: 1;
  }

  .vault-toggle-name {
    font-size: 15px;
    font-weight: 500;
  }

  .vault-toggle-help {
    font-size: 13px;
    color: var(--text-soft);
  }

  .about-row {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .about-icon {
    width: 44px;
    height: 44px;
    border-radius: 10px;
    flex-shrink: 0;
  }

  .about-info {
    display: flex;
    flex-direction: column;
    gap: 2px;
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
  }

  .about-url:hover {
    color: var(--accent);
  }

  .modal-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.55);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 100;
    padding: 24px;
  }

  .modal {
    background: var(--surface);
    border-radius: 16px;
    padding: 24px;
    width: 100%;
    max-width: 340px;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  .modal-title {
    font-size: 17px;
    font-weight: 600;
  }

  .modal-desc {
    font-size: 14px;
    margin: 0;
  }

  .modal-actions {
    display: flex;
    gap: 8px;
    justify-content: flex-end;
  }

  .modal-pw {
    display: flex;
    align-items: center;
    background: var(--surface);
    border: 1px solid var(--border-strong);
    border-radius: var(--r-input);
    padding: 0 6px 0 0;
  }

  .modal-pw:focus-within {
    border-color: var(--accent);
    box-shadow: 0 0 0 3px var(--accent-soft);
  }

  .modal-pw input {
    border: none;
    background: transparent;
    padding: 12px 14px;
    flex: 1;
    min-width: 0;
    outline: none;
    font-family: var(--font-ui);
    font-size: 17px;
    color: var(--text);
    appearance: none;
    -webkit-appearance: none;
  }
</style>
