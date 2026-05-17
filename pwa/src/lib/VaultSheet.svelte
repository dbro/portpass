<script>
  import { onMount } from 'svelte'
  import { get } from 'svelte/store'
  import { getDatabaseInfo, openDatabase, updateDBFields } from '../wasm.js'
  import { selectedFile, dbItems, secondaryVaults } from '../store.js'
  import { isBiometricSupported, isBiometricEnrolled, enrollBiometric, clearBiometric } from './biometric.js'
  import Icon from './Icon.svelte'

  let { isDesktop, onback, onlock, onlockall, onlocksecondary, onunlockadditional, ondbsave, ondirtychange, theme, accent, ontheme, onaccent } = $props()

  // ── Biometric ──────────────────────────────────────────────────────────────
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
      const handle = $selectedFile?.handle
      if (handle) {
        const file = await handle.getFile()
        const buf  = await file.arrayBuffer()
        openDatabase(new Uint8Array(buf), setupPassword)
      }
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

  // ── Appearance ─────────────────────────────────────────────────────────────
  const ACCENTS = ['amber', 'sage', 'slate', 'burgundy']
  const SWATCH  = { amber: '#b07418', sage: '#5a7a4f', slate: '#4a5d82', burgundy: '#8a3a3a' }

  // ── Primary vault ──────────────────────────────────────────────────────────
  let filename = $derived($selectedFile?.name ?? '')

  const _vaultUuid = get(selectedFile)?.uuid ?? ''
  let info = (() => { try { return getDatabaseInfo(_vaultUuid) } catch { return null } })()

  let secondaryCount       = $derived($secondaryVaults.length)
  let primaryPasswordCount = $derived($dbItems.length)
  let primaryGroupCount    = $derived(new Set($dbItems.map(i => i.group).filter(Boolean)).size)
  let passwordCount        = $derived(
    $dbItems.length + $secondaryVaults.reduce((n, v) => n + (v.items?.length ?? 0), 0)
  )
  let groupCount           = $derived(
    new Set($dbItems.map(i => i.group).filter(Boolean)).size
    + $secondaryVaults.reduce((n, v) => n + new Set(v.items?.map(i => i.group).filter(Boolean)).size, 0)
  )

  let draftName = $state(info?.name        ?? '')
  let draftDesc = $state(info?.description ?? '')
  let origName  = info?.name        ?? ''
  let origDesc  = info?.description ?? ''
  let dirty     = $derived(origName !== draftName || origDesc !== draftDesc)

  $effect(() => { ondirtychange?.(dirty) })

  function save() {
    ondbsave({ Name: draftName, Description: draftDesc })
    origName = draftName
    origDesc = draftDesc
  }

  // ── Navigation ─────────────────────────────────────────────────────────────
  // null = main settings page, 'primary' = primary vault detail, uuid = secondary detail
  let selectedDetailVault = $state(null)
  let techOpen = $state(false)

  function openPrimaryDetail() {
    techOpen = false
    selectedDetailVault = 'primary'
  }

  // ── Secondary vault detail state ───────────────────────────────────────────
  let svDetailInfo      = $state(null)
  let svDetailDraftName = $state('')
  let svDetailDraftDesc = $state('')
  let svDetailOrigName  = $state('')
  let svDetailOrigDesc  = $state('')
  let svDetailDirty     = $derived(
    svDetailOrigName !== svDetailDraftName || svDetailOrigDesc !== svDetailDraftDesc
  )

  function openSecondaryDetail(sv) {
    try { svDetailInfo = getDatabaseInfo(sv.uuid) } catch { svDetailInfo = null }
    svDetailDraftName = svDetailInfo?.name        ?? ''
    svDetailDraftDesc = svDetailInfo?.description ?? ''
    svDetailOrigName  = svDetailDraftName
    svDetailOrigDesc  = svDetailDraftDesc
    techOpen = false
    selectedDetailVault = sv.uuid
  }

  function saveSvAndBack() {
    const uuid = selectedDetailVault
    updateDBFields(uuid, { Name: svDetailDraftName, Description: svDetailDraftDesc })
    svDetailOrigName = svDetailDraftName
    svDetailOrigDesc = svDetailDraftDesc
    secondaryVaults.update(vs => vs.map(v => v.uuid === uuid ? { ...v, name: svDetailDraftName } : v))
    selectedDetailVault = null
  }

  function saveAndBack() {
    save()
    selectedDetailVault = null
  }

  // ── Helpers ────────────────────────────────────────────────────────────────
  const appVersion = (__APP_VERSION__.match(/^v?\d+\.\d+\.\d+/) ?? [__APP_VERSION__])[0]

  function countLine(pwCount, grCount) {
    let s = `${pwCount} ${pwCount === 1 ? 'password' : 'passwords'}`
    if (grCount > 0) s += ` · ${grCount} ${grCount === 1 ? 'group' : 'groups'}`
    return s
  }
</script>

<!-- ── Mobile bar ─────────────────────────────────────────────────────────── -->
<div class="record-bar" style={isDesktop ? 'display:none' : ''}>
  <button class="icon-btn" onclick={selectedDetailVault ? () => selectedDetailVault = null : onback} aria-label="Back">
    <Icon name="back" size={22}/>
  </button>
  <div class="record-bar-group" style="text-transform:uppercase;font-size:13px;letter-spacing:0.04em;font-weight:600">
    {selectedDetailVault ? 'Vault' : 'Vault settings'}
  </div>
  {#if selectedDetailVault === 'primary' && dirty}
    <button class="btn-text primary" onclick={saveAndBack}>Save</button>
  {:else if selectedDetailVault && selectedDetailVault !== 'primary' && svDetailDirty}
    <button class="btn-text primary" onclick={saveSvAndBack}>Save</button>
  {/if}
</div>

<!-- ── Desktop header ─────────────────────────────────────────────────────── -->
{#if isDesktop}
  <div class="record-pane-header">
    <button class="icon-btn" onclick={selectedDetailVault ? () => selectedDetailVault = null : onback} aria-label="Back" style="margin-right:8px">
      <Icon name="back" size={20}/>
    </button>
    <span class="record-bar-group" style="text-transform:uppercase;font-size:13px;letter-spacing:0.04em;font-weight:600;flex:1">
      {selectedDetailVault ? 'Vault' : 'Vault settings'}
    </span>
    <div class="record-pane-actions" style="min-width:80px">
      {#if selectedDetailVault === 'primary' && dirty}
        <button class="btn btn-primary" onclick={saveAndBack} style="height:36px;padding:0 18px;font-size:14px">Save</button>
      {:else if selectedDetailVault && selectedDetailVault !== 'primary' && svDetailDirty}
        <button class="btn btn-primary" onclick={saveSvAndBack} style="height:36px;padding:0 18px;font-size:14px">Save</button>
      {/if}
    </div>
  </div>
{/if}

<!-- ═══════════════════════════════════════════════════════════════════════════
     MAIN SETTINGS PAGE
════════════════════════════════════════════════════════════════════════════ -->
{#if !selectedDetailVault}
<div class="record-body vault-settings-body">

  <!-- Aggregate stats -->
  <div class="vault-section">
    <div class="vault-stats">
      {#if secondaryCount > 0}
        <div class="vault-stat">
          <span class="vault-stat-num">{1 + secondaryCount}</span>
          <span class="vault-stat-label muted">vaults</span>
        </div>
        <div class="vault-stat-divider"></div>
      {/if}
      {#if groupCount > 0}
        <div class="vault-stat">
          <span class="vault-stat-num">{groupCount}</span>
          <span class="vault-stat-label muted">groups</span>
        </div>
        <div class="vault-stat-divider"></div>
      {/if}
      <div class="vault-stat">
        <span class="vault-stat-num">{passwordCount}</span>
        <span class="vault-stat-label muted">passwords</span>
      </div>
    </div>
  </div>

  <!-- Vault cards -->
  <div class="vault-section">
    <div class="vault-section-title">VAULTS</div>

    <!-- Primary vault card -->
    <button class="vault-card" onclick={openPrimaryDetail}>
      <div class="vault-card-icon" class:muted={$selectedFile?.readonly}>
        <Icon name="unlock" size={20}/>
      </div>
      <div class="vault-card-content">
        <div class="vault-card-name-row">
          <span class="vault-card-name">{draftName || filename}</span>
          {#if secondaryCount > 0}
            <span class="vault-badge-primary">primary</span>
          {/if}
        </div>
        {#if $selectedFile?.readonly}
          <span class="vault-badge-ro">READ-ONLY</span>
        {/if}
        <span class="vault-card-counts muted">{countLine(primaryPasswordCount, primaryGroupCount)}</span>
      </div>
      <Icon name="chevron-right" size={18}/>
    </button>

    <!-- Secondary vault cards -->
    {#each $secondaryVaults as sv}
      {@const svPwCount = sv.items?.length ?? 0}
      {@const svGrCount = new Set(sv.items?.map(i => i.group).filter(Boolean)).size}
      <button class="vault-card" onclick={() => openSecondaryDetail(sv)}>
        <div class="vault-card-icon" class:muted={sv.readonly}>
          <Icon name="unlock" size={20}/>
        </div>
        <div class="vault-card-content">
          <div class="vault-card-name-row">
            <span class="vault-card-name">{sv.name || sv.filename}</span>
          </div>
          {#if sv.readonly}
            <span class="vault-badge-ro">READ-ONLY</span>
          {/if}
          <span class="vault-card-counts muted">{countLine(svPwCount, svGrCount)}</span>
        </div>
        <Icon name="chevron-right" size={18}/>
      </button>
    {/each}

    <button class="vault-unlock-more" onclick={onunlockadditional}>
      + Unlock additional vault
    </button>
    <div class="vault-lock-full" style="margin-top:24px">
      <button class="btn btn-ghost vault-lock-full-btn" onclick={secondaryCount > 0 ? onlockall : onlock}>
        <Icon name="lock" size={16}/> {secondaryCount > 0 ? 'Lock all vaults' : 'Lock vault'}
      </button>
    </div>
  </div>

  <!-- Appearance -->
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

  <!-- About -->
  <div class="vault-section">
    <div class="vault-section-title">ABOUT</div>
    <div class="about-row">
      <img src="{import.meta.env.BASE_URL}icon.svg" alt="Portpass" class="about-icon" />
      <div class="about-info">
        <div class="about-name">Portpass <span class="about-version muted">{appVersion}</span></div>
        <a class="about-url muted" href="https://dbro.github.io/portpass" target="_blank" rel="noreferrer">dbro.github.io/portpass</a>
      </div>
    </div>
  </div>


</div>

<!-- ═══════════════════════════════════════════════════════════════════════════
     PER-VAULT DETAIL PAGE
════════════════════════════════════════════════════════════════════════════ -->
{:else}
  {@const isPrimary = selectedDetailVault === 'primary'}
  {@const detailSv  = isPrimary ? null : $secondaryVaults.find(v => v.uuid === selectedDetailVault)}
  {@const detailRO  = isPrimary ? !!$selectedFile?.readonly : !!detailSv?.readonly}
  {@const detailFile = isPrimary ? filename : (detailSv?.filename ?? '')}
  {@const detailPwCount = isPrimary ? primaryPasswordCount : (detailSv?.items?.length ?? 0)}
  {@const detailGrCount = isPrimary ? primaryGroupCount : new Set(detailSv?.items?.map(i => i.group).filter(Boolean)).size}
  {@const detailDraftName = isPrimary ? draftName : svDetailDraftName}
  {@const detailDraftDesc = isPrimary ? draftDesc : svDetailDraftDesc}
  {@const detailInfo = isPrimary ? info : svDetailInfo}

<div class="record-body vault-settings-body">

  <!-- Read-only notice -->
  {#if detailRO}
    <div class="vault-ro-notice">
      <span class="vault-ro-icon">ⓘ</span>
      <span><strong>Read-only.</strong> This vault file is write-protected. Records can be viewed and copied but not changed.</span>
    </div>
  {/if}

  <!-- File + counts -->
  <div class="vault-section" style="margin-bottom:24px">
    <div class="vault-file" style="margin-bottom:10px">
      <span class="vault-file-label">FILE</span>
      <span class="vault-file-value mono">{detailFile}</span>
    </div>
    <div class="vault-detail-stats">
      <span class="vault-detail-stat-num">{detailPwCount}</span>
      <span class="vault-detail-stat-label muted">{detailPwCount === 1 ? 'password' : 'passwords'}</span>
      {#if detailGrCount > 0}
        <span class="vault-detail-stat-sep muted">·</span>
        <span class="vault-detail-stat-num">{detailGrCount}</span>
        <span class="vault-detail-stat-label muted">{detailGrCount === 1 ? 'group' : 'groups'}</span>
      {/if}
    </div>
  </div>

  <!-- Name -->
  {#if detailRO}
    {#if detailDraftName}
      <div class="vault-section" style="margin-bottom:16px">
        <div class="vault-file">
          <span class="vault-file-label">NAME</span>
          <span class="vault-file-value">{detailDraftName}</span>
        </div>
      </div>
    {/if}
    {#if detailDraftDesc}
      <div class="vault-section" style="margin-bottom:16px">
        <div class="vault-file">
          <span class="vault-file-label">NOTES</span>
          <span class="vault-file-value">{detailDraftDesc}</span>
        </div>
      </div>
    {/if}
  {:else}
    <div class="vault-section" style="margin-bottom:16px">
      <div class="vault-detail-fields">
        <label class="vault-field">
          <span class="vault-label muted">Name</span>
          {#if isPrimary}
            <input class="input" value={draftName} oninput={e => draftName = e.target.value} placeholder="Optional name"/>
          {:else}
            <input class="input" value={svDetailDraftName} oninput={e => svDetailDraftName = e.target.value} placeholder="Optional name"/>
          {/if}
        </label>
        <label class="vault-field">
          <span class="vault-label muted">Notes</span>
          {#if isPrimary}
            <textarea class="input" rows={3} value={draftDesc} oninput={e => draftDesc = e.target.value} placeholder="Optional description"></textarea>
          {:else}
            <textarea class="input" rows={3} value={svDetailDraftDesc} oninput={e => svDetailDraftDesc = e.target.value} placeholder="Optional description"></textarea>
          {/if}
        </label>
      </div>
    </div>
  {/if}

  <!-- Security (primary vault only) -->
  {#if isPrimary && biometricAvailable}
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

  <!-- Technical details (collapsible) -->
  <div class="vault-section">
    <button class="vault-tech-header" onclick={() => techOpen = !techOpen}>
      <Icon name={techOpen ? 'chevron-down' : 'chevron-right'} size={16}/>
      <span>Technical details</span>
    </button>
    {#if techOpen}
      <div class="vault-file-row" style="margin-top:12px">
        <div class="vault-file">
          <span class="vault-file-label">Format</span>
          <span class="vault-file-value">{detailInfo?.version ?? '—'}</span>
        </div>
        <div class="vault-file">
          <span class="vault-file-label">Key strength</span>
          <span class="vault-file-value">{detailInfo?.iter != null ? `${detailInfo.iter.toLocaleString()} iterations` : '—'}</span>
        </div>
      </div>
    {/if}
  </div>

  <!-- Lock button -->
  <div class="vault-lock-full">
    {#if isPrimary}
      <button class="btn btn-ghost vault-lock-full-btn" onclick={secondaryCount > 0 ? onlockall : onlock}>
        <Icon name="lock" size={16}/> {secondaryCount > 0 ? 'Lock all vaults' : 'Lock vault'}
      </button>
      {#if secondaryCount > 0}
        <p class="vault-lock-caption muted">Remembers secondary vaults — they unlock automatically next session.</p>
      {/if}
    {:else}
      <button class="btn btn-ghost vault-lock-full-btn" onclick={() => onlocksecondary?.(selectedDetailVault)}>
        <Icon name="lock" size={16}/> Lock this vault
      </button>
      <p class="vault-lock-caption muted">Closes this vault and removes it from future sessions.</p>
    {/if}
  </div>

</div>
{/if}

<!-- ── Biometric setup modal ───────────────────────────────────────────────── -->
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

  /* ── Aggregate stats (main page) ─────────────────────────────────────────── */
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

  /* ── Vault cards (main page) ─────────────────────────────────────────────── */
  .vault-card {
    display: flex;
    align-items: center;
    gap: 14px;
    width: 100%;
    padding: 16px;
    margin-bottom: 10px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--r-card);
    box-shadow: var(--shadow);
    cursor: pointer;
    text-align: left;
    color: var(--text);
    transition: background 0.12s;
  }
  .vault-card:last-of-type { margin-bottom: 0; }
  .vault-card:hover { background: var(--surface-2); }

  .vault-card-icon {
    flex-shrink: 0;
    color: var(--accent);
    display: flex;
    align-items: center;
  }
  .vault-card-icon.muted { color: var(--text-soft); }

  .vault-card-content {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  .vault-card-name-row {
    display: flex;
    align-items: center;
    gap: 7px;
    flex-wrap: wrap;
  }

  .vault-card-name {
    font-size: 15px;
    font-weight: 700;
    line-height: 1.3;
  }

  .vault-card-counts {
    font-size: 13px;
  }

  .vault-badge-primary {
    font-size: 12px;
    font-weight: 500;
    color: var(--text-soft);
  }

  .vault-badge-ro {
    display: inline-block;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.06em;
    color: var(--text-soft);
    border: 1px solid var(--border-strong);
    border-radius: var(--r-pill);
    padding: 1px 8px;
    width: fit-content;
  }

  .vault-unlock-more {
    display: block;
    background: none;
    border: none;
    cursor: pointer;
    font-size: 15px;
    font-weight: 500;
    color: var(--accent);
    padding: 12px 0 0;
    text-align: left;
  }
  .vault-unlock-more:hover { color: var(--accent-strong); }

  /* ── Lock button (main + detail pages) ──────────────────────────────────── */
  .vault-lock-full {
    margin-top: 8px;
  }

  .vault-lock-full-btn {
    width: 100%;
    justify-content: center;
    height: 44px;
    font-size: 15px;
  }

  .vault-lock-caption {
    font-size: 13px;
    text-align: center;
    margin: 8px 0 0;
  }

  /* ── Per-vault detail page ───────────────────────────────────────────────── */
  .vault-ro-notice {
    display: flex;
    gap: 10px;
    align-items: flex-start;
    background: #eee8dc;
    color: #5a5040;
    border-radius: 10px;
    padding: 12px 14px;
    font-size: 14px;
    line-height: 1.5;
    margin-bottom: 24px;
  }

  .vault-ro-icon {
    font-size: 15px;
    flex-shrink: 0;
    margin-top: 1px;
  }

  .vault-detail-stats {
    display: flex;
    align-items: baseline;
    gap: 6px;
  }

  .vault-detail-stat-num {
    font-size: 24px;
    font-weight: 700;
    line-height: 1;
  }

  .vault-detail-stat-label {
    font-size: 14px;
  }

  .vault-detail-stat-sep {
    font-size: 14px;
    margin: 0 2px;
  }

  .vault-detail-fields {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 16px;
  }

  @media (max-width: 768px) {
    .vault-detail-fields {
      grid-template-columns: 1fr;
    }
  }

  .vault-tech-header {
    display: flex;
    align-items: center;
    gap: 6px;
    background: none;
    border: none;
    cursor: pointer;
    font-size: 14px;
    font-weight: 500;
    color: var(--text);
    padding: 0;
  }

  .vault-tech-header:hover { color: var(--accent); }

  /* ── Shared ──────────────────────────────────────────────────────────────── */
  .vault-field {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .vault-label {
    font-size: 14px;
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

  .swatch:hover { transform: scale(1.08); }

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

  .about-url:hover { color: var(--accent); }
</style>
