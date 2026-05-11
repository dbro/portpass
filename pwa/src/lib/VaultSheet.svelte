<script>
  import { onMount } from 'svelte'
  import { getDatabaseInfo, openDatabase } from '../wasm.js'
  import { selectedFile } from '../store.js'
  import { isBiometricSupported, isBiometricEnrolled, enrollBiometric, clearBiometric } from './biometric.js'
  import Icon from './Icon.svelte'

  let { onclose, onlock, onclosevault, ondbsave, theme, accent, ontheme, onaccent } = $props()

  let biometricAvailable = $state(false)
  let biometricEnrolled  = $state(false)
  let setupMode          = $state(false)
  let setupPassword      = $state('')
  let setupError         = $state('')
  let setupBusy          = $state(false)

  onMount(async () => {
    biometricAvailable = await isBiometricSupported()
    biometricEnrolled  = await isBiometricEnrolled()
  })

  async function disableBiometric() {
    await clearBiometric()
    biometricEnrolled = false
    setupMode = false
  }

  function startSetup() {
    setupMode = true
    setupPassword = ''
    setupError = ''
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
      await enrollBiometric(setupPassword)
      biometricEnrolled = true
      setupMode = false
      setupPassword = ''
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

      {#if biometricAvailable}
        <div class="sheet-section">
          <div class="sheet-section-title">Security</div>
          <div class="sheet-toggle">
            <div class="sheet-toggle-label">
              <span class="sheet-toggle-name">Fast unlock</span>
              <span class="sheet-toggle-help">
                {biometricEnrolled ? 'Enabled' : 'Fingerprint, PIN, or passkey'}
              </span>
            </div>
            <button
              class="switch"
              class:on={biometricEnrolled}
              onclick={biometricEnrolled ? disableBiometric : startSetup}
              aria-label="Fast unlock"
            ></button>
          </div>

          {#if setupMode && !biometricEnrolled}
            <div class="setup-form">
              <p class="setup-prompt muted">Enter your master password to set up fast unlock:</p>
              <div class="unlock-pw" style="margin:0">
                <input
                  type="password"
                  bind:value={setupPassword}
                  placeholder="Master password"
                  onkeydown={e => { if (e.key === 'Enter') doSetup() }}
                  autofocus
                />
              </div>
              {#if setupError}<div class="unlock-error" style="font-size:13px">{setupError}</div>{/if}
              <div class="setup-actions">
                <button class="btn btn-primary" style="flex:1" disabled={!setupPassword || setupBusy} onclick={doSetup}>
                  {setupBusy ? 'Setting up…' : 'Enable fast unlock'}
                </button>
                <button class="btn btn-ghost" onclick={() => setupMode = false}>Cancel</button>
              </div>
            </div>
          {/if}
        </div>
      {/if}

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

  .setup-form {
    display: flex;
    flex-direction: column;
    gap: 10px;
    margin-top: 8px;
  }
  .setup-prompt {
    font-size: 13px;
    margin: 0;
  }
  .setup-actions {
    display: flex;
    gap: 8px;
  }
</style>
