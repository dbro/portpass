<script>
  import { onMount } from 'svelte'
  import { get } from 'svelte/store'
  import { getDatabaseInfo, openDatabase, updateDBFields } from '../wasm.js'
  import { selectedFile, dbItems, secondaryVaults, switchboardUrl, switchboardConnected, crossProfileEnabled, delegatesVersion } from '../store.js'
  import { isBiometricSupported, isBiometricEnrolled, enrollBiometric, clearBiometric } from './biometric.js'
  import { makeDelegateBookmarkletUrl } from './bookmarklet.js'
  import { getDelegates, addDelegate, revokeDelegate, setSwitchboardUrl, setCrossProfileEnabled } from './delegates.js'
  import { createPairedAutofillProfile, removePairedAutofillProfile, parsePairingToken } from './pairedAutofill.js'
  import Icon from './Icon.svelte'

  let { isDesktop, bookmarkletsSupported = false, onback, onlock, onlockall, onlocksecondary, onunlockadditional, ondbsave, onsvdbsave, ondirtychange, theme, accent, ontheme, onaccent } = $props()

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

  $effect(() => {
    void $delegatesVersion
    getDelegates(_vaultUuid).then(d => {
      delegates = d
      if (d.length === 0 && get(crossProfileEnabled)) {
        setCrossProfileEnabled(_vaultUuid, false)
        crossProfileEnabled.set(false)
      }
    })
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
    onsvdbsave?.(uuid)
  }

  function saveAndBack() {
    save()
    selectedDetailVault = null
  }

  // ── Autofill delegates ─────────────────────────────────────────────────────
  let delegates = $state([])
  let newDelegateOpen = $state(false)
  let newDelegateName = $state('')
  let newDelegatePubKeySpki = $state(null)
  let newDelegateId   = $state(null)
  let newDelegateUrl  = $state('')
  let newDelegateError = $state('')
  let newDelegateBusy  = $state(false)
  let newDelegateBirthAt = $state(null)
  let chipCopied  = $state(false)
  let chipCopyTimer = null
  let chipDragged = $state(false)
  let chipLinked  = $state(false)  // persistent: set on copy, not reset by the feedback timer
  let globeTipOpen = $state(false)
  let pairDelegateOpen = $state(false)
  let pairDelegateName = $state('')
  let pairDelegateToken = $state('')
  let pairDelegateError = $state('')
  let pairDelegatePreview = $state(null)
  let pairDelegateUrl = $state('')
  let pairBookmarkletCopied = $state(false)
  let pairDelegateBusy = $state(false)

  let chipUsed   = $derived(chipDragged || chipLinked)
  let canUseChip = $derived(!!newDelegateName.trim() && !!newDelegatePubKeySpki)
  let canCommit  = $derived((!!newDelegateName.trim() || chipUsed) && !!newDelegatePubKeySpki && !newDelegateBusy)

  function defaultDelegateName() {
    return 'Bookmarklet created ' + new Date(newDelegateBirthAt ?? Date.now()).toLocaleString(
      undefined, { month: 'short', day: 'numeric', year: 'numeric',
                   hour: '2-digit', minute: '2-digit', second: '2-digit' }
    )
  }

  async function openNewDelegate() {
    newDelegateOpen = true
    newDelegateName = ''
    newDelegatePubKeySpki = null
    newDelegateId   = null
    newDelegateUrl  = ''
    newDelegateError = ''
    newDelegateBusy = false
    newDelegateBirthAt = Date.now()
    chipCopied = false
    chipDragged = false
    chipLinked  = false
    globeTipOpen = false
    try {
      const profile = await createPairedAutofillProfile({
        relayUrl: get(switchboardUrl),
      })
      newDelegateId = profile.delegateId
      newDelegatePubKeySpki = new Uint8Array(profile.publicKey).buffer
      newDelegateUrl = makeDelegateBookmarkletUrl(
        window.location.origin + import.meta.env.BASE_URL,
        newDelegateId,
        get(switchboardUrl)
      )
    } catch (e) {
      newDelegateError = 'Failed to generate key pair'
    }
  }

  function closeNewDelegate() {
    newDelegateOpen = false
    newDelegateName = ''
    newDelegatePubKeySpki = null
    newDelegateId   = null
    newDelegateUrl  = ''
    newDelegateError = ''
    chipCopied = false
    chipDragged = false
    chipLinked  = false
    globeTipOpen = false
    clearTimeout(chipCopyTimer)
  }

  async function commitDelegate() {
    if (!_vaultUuid || !newDelegatePubKeySpki || !newDelegateId) return
    const name = newDelegateName.trim() || defaultDelegateName()
    newDelegateBusy  = true
    newDelegateError = ''
    try {
      const delegate = await addDelegate(_vaultUuid, name, newDelegatePubKeySpki, newDelegateId)
      delegates = [delegate, ...delegates]
      closeNewDelegate()
    } catch (e) {
      newDelegateError = e.message || 'Failed to save bookmarklet'
      newDelegateBusy = false
    }
  }

  async function cancelOrSave() {
    if (chipUsed) await commitDelegate()
    else {
      if (newDelegateId) await removePairedAutofillProfile(newDelegateId).catch(() => {})
      closeNewDelegate()
    }
  }

  async function revokeOne(delegateId) {
    await revokeDelegate(_vaultUuid, delegateId)
    delegates = delegates.filter(d => d.id !== delegateId)
  }

  function openPairDelegate() {
    pairDelegateOpen = true
    pairDelegateName = ''
    pairDelegateToken = ''
    pairDelegateError = ''
    pairDelegatePreview = null
    pairDelegateUrl = ''
    pairBookmarkletCopied = false
    pairDelegateBusy = false
  }

  function closePairDelegate() {
    pairDelegateOpen = false
    pairDelegateName = ''
    pairDelegateToken = ''
    pairDelegateError = ''
    pairDelegatePreview = null
    pairDelegateUrl = ''
    pairBookmarkletCopied = false
    pairDelegateBusy = false
  }

  async function previewPairingToken() {
    pairDelegateError = ''
    pairDelegatePreview = null
    try {
      const parsed = await parsePairingToken(pairDelegateToken)
      pairDelegatePreview = parsed
      pairDelegateUrl = makeDelegateBookmarkletUrl(
        window.location.origin + import.meta.env.BASE_URL,
        parsed.delegateId,
        parsed.relayUrl || get(switchboardUrl)
      )
      if (!pairDelegateName.trim()) pairDelegateName = parsed.name || `Autofill profile ${parsed.displayCode}`
    } catch (e) {
      pairDelegateError = e.message || 'Pairing token is not valid'
    }
  }

  async function commitPairDelegate() {
    if (!_vaultUuid || pairDelegateBusy) return
    pairDelegateBusy = true
    pairDelegateError = ''
    try {
      const parsed = pairDelegatePreview || await parsePairingToken(pairDelegateToken)
      const name = pairDelegateName.trim() || parsed.name || `Autofill profile ${parsed.displayCode}`
      const delegate = await addDelegate(_vaultUuid, name, parsed.publicKey, parsed.delegateId, {
        pairingId: parsed.pairingId,
        relayUrl: parsed.relayUrl,
      })
      delegates = [delegate, ...delegates]
      if (parsed.relayUrl && parsed.relayUrl !== get(switchboardUrl)) {
        await setSwitchboardUrl(_vaultUuid, parsed.relayUrl)
        switchboardUrl.set(parsed.relayUrl)
      }
      closePairDelegate()
    } catch (e) {
      pairDelegateError = e.message || 'Failed to pair autofill profile'
    } finally {
      pairDelegateBusy = false
    }
  }

  function copyPairBookmarklet() {
    if (!pairDelegateUrl) return
    navigator.clipboard.writeText(pairDelegateUrl).then(() => {
      pairBookmarkletCopied = true
      setTimeout(() => { pairBookmarkletCopied = false }, 2200)
    })
  }

  // ── Advanced / switchboard ────────────────────────────────────────────────
  let advancedOpen        = $state(false)
  let editSwitchboardUrl  = $state('')
  let switchboardUrlDirty = $state(false)

  let totalRelayCount = $derived(delegates.reduce((n, d) => n + (d.relayCount ?? 0), 0))
  let lastRelayUsed   = $derived(
    delegates.reduce((t, d) => d.relayLastUsed ? Math.max(t, d.relayLastUsed) : t, 0) || null
  )

  function toggleAdvanced() {
    advancedOpen = !advancedOpen
    if (advancedOpen) {
      editSwitchboardUrl  = get(switchboardUrl)
      switchboardUrlDirty = false
    }
  }

  async function saveRelayUrl() {
    await setSwitchboardUrl(_vaultUuid, editSwitchboardUrl)
    switchboardUrl.set(editSwitchboardUrl)
    switchboardUrlDirty = false
  }

  function cancelRelayUrlEdit() {
    editSwitchboardUrl  = get(switchboardUrl)
    switchboardUrlDirty = false
  }

  function copyChip() {
    navigator.clipboard.writeText(newDelegateUrl).then(() => {
      chipCopied = true
      chipLinked  = true
      clearTimeout(chipCopyTimer)
      chipCopyTimer = setTimeout(() => { chipCopied = false }, 2200)
    })
  }

  function fmtDate(ts) {
    if (!ts) return '—'
    return new Date(ts).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
  }

  function fmtRelative(ts) {
    if (!ts) return 'never'
    const days = Math.floor((Date.now() - ts) / 86400000)
    if (days === 0) return 'today'
    if (days === 1) return 'yesterday'
    if (days < 7) return `${days} days ago`
    return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
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
  <div class="record-bar-group vs-title">
    {selectedDetailVault ? 'Vault' : 'Vault settings'}
  </div>
  {#if selectedDetailVault === 'primary' && dirty}
    <button class="btn-text primary" onclick={saveAndBack}>Save</button>
  {:else if selectedDetailVault && selectedDetailVault !== 'primary' && svDetailDirty}
    <button class="btn-text primary" onclick={saveSvAndBack}>Save</button>
  {:else}
    <div style="width:40px"></div>
  {/if}
</div>

<!-- ── Desktop header ─────────────────────────────────────────────────────── -->
{#if isDesktop}
  <div class="record-pane-header">
    <div style="min-width:80px;display:flex;align-items:center">
      <button class="icon-btn" onclick={selectedDetailVault ? () => selectedDetailVault = null : onback} aria-label="Back">
        <Icon name="back" size={20}/>
      </button>
    </div>
    <span class="record-bar-group vs-title" style="flex:1;text-align:center">
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

  <!-- Autofill delegates -->
  {#if bookmarkletsSupported}
  <div class="vault-section">
    <div class="vault-section-title">AUTOFILL</div>
    <p class="muted" style="font-size:14px;margin:0 0 14px;line-height:1.5">
      Create a uniquely keyed bookmarklet for each browser profile where you want autofill.
    </p>
    {#if delegates.length > 0}
      <div class="delegate-list">
        {#each delegates as d}
          {@const total   = (d.bcCount ?? 0) + (d.relayCount ?? 0)}
          {@const lastTs  = Math.max(d.bcLastUsed ?? 0, d.relayLastUsed ?? 0) || null}
          <div class="delegate-row">
            <div class="delegate-info">
              <span class="delegate-name">{d.name}</span>
              <span class="delegate-meta muted">Created {fmtDate(d.created)}{d.displayCode ? ' · ' + d.displayCode : ''} · {total} {total === 1 ? 'page filled' : 'pages filled'}{lastTs ? ' · Last filled ' + fmtRelative(lastTs) : ''}</span>
            </div>
            <button class="delegate-revoke" onclick={() => revokeOne(d.id)}>Revoke</button>
          </div>
        {/each}
      </div>
    {/if}
    <button class="vault-unlock-more" onclick={openNewDelegate}>+ New bookmarklet</button>
    <button class="vault-unlock-more" onclick={openPairDelegate}>+ Add autofill profile</button>

    <!-- Cross-profile autofill -->
    <button class="delegate-advanced-toggle muted" onclick={toggleAdvanced}>
      Cross-profile autofill {advancedOpen ? '▲' : '▼'}
    </button>
    {#if advancedOpen}
      <div class="delegate-advanced-body">
        <div class="vault-row" style="margin-bottom:4px">
          <span class="vault-label muted" style="font-size:13px">Enable cross-profile autofill</span>
          <div class="vault-segmented">
            <button class:on={!$crossProfileEnabled} disabled={!delegates.length} onclick={async () => { await setCrossProfileEnabled(_vaultUuid, false); crossProfileEnabled.set(false) }}>Off</button>
            <button class:on={$crossProfileEnabled}  disabled={!delegates.length} onclick={async () => { await setCrossProfileEnabled(_vaultUuid, true);  crossProfileEnabled.set(true)  }}>On</button>
          </div>
        </div>
        {#if $crossProfileEnabled}
          <label class="vault-label muted" style="font-size:12px;display:block;margin-bottom:4px">
            WebSocket Relay URL
            <input
              class="input"
              style="font-size:13px;display:block;width:100%;margin-top:4px"
              bind:value={editSwitchboardUrl}
              oninput={() => { switchboardUrlDirty = editSwitchboardUrl !== get(switchboardUrl) }}
              placeholder="ws://localhost:7577"
            />
          </label>
          {#if switchboardUrlDirty}
            <div class="switchboard-url-actions">
              <button class="btn btn-ghost" style="font-size:13px" onclick={cancelRelayUrlEdit}>Cancel</button>
              <button class="btn btn-primary" style="font-size:13px" onclick={saveRelayUrl}>Save</button>
            </div>
          {/if}
          <div class="switchboard-status-row">
            <span class="switchboard-status-dot" class:switchboard-ok={$switchboardConnected} class:switchboard-error={!$switchboardConnected}></span>
            <span class="muted" style="font-size:13px">
              {$switchboardConnected ? 'Cross-profile autofill ready' : 'websocket relay not connected'}
            </span>
          </div>
          <div class="muted" style="font-size:12px">
            Count of cross-profile autofill uses: {totalRelayCount}{#if lastRelayUsed} · Last {fmtRelative(lastRelayUsed)}{/if}
          </div>
          <div class="muted" style="font-size:12px;line-height:1.4;margin-top:8px">
            To pair another browser profile, open
            <span class="mono">{window.location.origin + import.meta.env.BASE_URL + 'autofill.html?pair=1'}</span>
            in that filling profile, then paste its token here with Add autofill profile.
          </div>
        {/if}
      </div>
    {/if}
  </div>
  {/if}

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

<!-- ── New delegate modal ─────────────────────────────────────────────────── -->
{#if newDelegateOpen}
  <div class="modal-overlay" role="presentation"
    onclick={e => { e.stopPropagation(); if (!newDelegateBusy) cancelOrSave() }}
    onkeydown={e => { if (e.key === 'Escape' && !newDelegateBusy) cancelOrSave() }}>
    <div class="modal modal-install" role="dialog" aria-modal="true" tabindex="-1" onclick={e => e.stopPropagation()} onkeydown={e => e.stopPropagation()}>
      <div class="vs-modal-header">
        <div class="modal-title">New autofill bookmarklet</div>
        <button class="vs-modal-x" onclick={() => { if (!newDelegateBusy) cancelOrSave() }} aria-label="Cancel">
          <Icon name="x" size={18}/>
        </button>
      </div>
      <label class="vault-field" style="margin-bottom:4px">
        <span class="vault-label muted">Name</span>
        <input
          class="input"
          bind:value={newDelegateName}
          placeholder="e.g. Chrome — work profile"
          onkeydown={e => { if (e.key === 'Enter' && canCommit) commitDelegate() }}
          use:focusOnMount
        />
      </label>
      {#if newDelegateError}<div class="unlock-error" style="font-size:13px">{newDelegateError}</div>{/if}
      <div class="vs-install-grid">
        <div class="vs-install-col vs-install-col-drag">
          <span class="vs-install-col-label">BOOKMARKS BAR VISIBLE</span>
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <a
            class="vs-bookmarklet-chip"
            class:chip-inactive={!canUseChip}
            href={newDelegateUrl || '#'}
            draggable={canUseChip ? 'true' : 'false'}
            onclick={e => e.preventDefault()}
            ondragstart={() => { chipDragged = true }}
            title={canUseChip ? 'Drag to your bookmarks bar' : 'Enter a name first'}
            aria-label="Portpass autofill bookmarklet — drag to your bookmarks bar"
          >
            <img src="{import.meta.env.BASE_URL}icon.svg" width="16" height="16" alt="" aria-hidden="true" draggable="false">
            {newDelegateName || 'Enter a name above'}
          </a>
          <span class="vs-install-col-hint">Drag to your bookmarks bar</span>
        </div>
        <div class="vs-install-col vs-install-col-copy">
          <span class="vs-install-col-label">BAR HIDDEN</span>
          <button class="vs-copy-link-btn" class:copied={chipCopied} disabled={!canUseChip} onclick={copyChip}>
            <Icon name={chipCopied ? 'check' : 'copy'} size={15}/>
            {chipCopied ? 'Copied!' : 'Copy link'}
          </button>
          <span class="vs-install-col-hint">Add a bookmark manually and paste the link</span>
        </div>
      </div>
      <button class="vs-globe-tip-toggle" onclick={() => globeTipOpen = !globeTipOpen}>
        <span class="vs-globe-tip-arrow" class:open={globeTipOpen}>▶</span>
        Bookmark showing a generic icon instead of the Portpass logo?
      </button>
      {#if globeTipOpen}
        <div class="vs-globe-tip-body">
          Bookmark this page normally first (⌘D / Ctrl+D), then right-click the bookmark → <strong>Edit bookmark</strong> → paste this link as the URL.
        </div>
      {/if}
      <div class="vs-install-warning">
        <Icon name="alert-triangle" size={28}/>
        <span>The bookmarklet contains no private key. Its paired signing key stays in this browser profile's Portpass storage and can be revoked here.</span>
      </div>
      <div style="margin-top:8px">
        <button class="vs-close-btn" disabled={!canCommit} onclick={commitDelegate}>
          {newDelegateBusy ? 'Saving…' : 'Save and Close'}
        </button>
      </div>
    </div>
  </div>
{/if}

<!-- ── Pair autofill profile modal ────────────────────────────────────────── -->
{#if pairDelegateOpen}
  <div class="modal-overlay" role="presentation"
    onclick={e => { e.stopPropagation(); if (!pairDelegateBusy) closePairDelegate() }}
    onkeydown={e => { if (e.key === 'Escape' && !pairDelegateBusy) closePairDelegate() }}>
    <div class="modal modal-install" role="dialog" aria-modal="true" tabindex="-1" onclick={e => e.stopPropagation()} onkeydown={e => e.stopPropagation()}>
      <div class="vs-modal-header">
        <div class="modal-title">Add autofill profile</div>
        <button class="vs-modal-x" onclick={() => { if (!pairDelegateBusy) closePairDelegate() }} aria-label="Cancel">
          <Icon name="x" size={18}/>
        </button>
      </div>
      <label class="vault-field" style="margin-bottom:10px">
        <span class="vault-label muted">Pairing token</span>
        <textarea
          class="input"
          rows={5}
          bind:value={pairDelegateToken}
          placeholder="Paste ppair1_… token from the autofill profile"
          oninput={() => { pairDelegatePreview = null; pairDelegateError = '' }}
          use:focusOnMount
        ></textarea>
      </label>
      <div style="display:flex;gap:8px;margin-bottom:12px">
        <button class="btn btn-ghost" disabled={!pairDelegateToken.trim() || pairDelegateBusy} onclick={previewPairingToken}>Check token</button>
      </div>
      {#if pairDelegatePreview}
        <div class="vs-install-warning" style="align-items:flex-start">
          <Icon name="check" size={22}/>
          <span>
            Pairing code <strong>{pairDelegatePreview.displayCode}</strong>{pairDelegatePreview.relayUrl ? ` · Relay ${pairDelegatePreview.relayUrl}` : ''}
          </span>
        </div>
        <div class="vs-install-grid" style="margin-top:10px">
          <div class="vs-install-col vs-install-col-drag">
            <span class="vs-install-col-label">FILLING PROFILE</span>
            <a
              class="vs-bookmarklet-chip"
              href={pairDelegateUrl || '#'}
              draggable={pairDelegateUrl ? 'true' : 'false'}
              onclick={e => e.preventDefault()}
              title="Drag to the filling profile bookmarks bar"
              aria-label="Paired Portpass autofill bookmarklet"
            >
              <img src="{import.meta.env.BASE_URL}icon.svg" width="16" height="16" alt="" aria-hidden="true" draggable="false">
              {pairDelegateName || pairDelegatePreview.name || 'Paired autofill'}
            </a>
            <span class="vs-install-col-hint">Drag or copy this bookmarklet into the filling profile</span>
          </div>
          <div class="vs-install-col vs-install-col-copy">
            <span class="vs-install-col-label">BAR HIDDEN</span>
            <button class="vs-copy-link-btn" class:copied={pairBookmarkletCopied} disabled={!pairDelegateUrl} onclick={copyPairBookmarklet}>
              <Icon name={pairBookmarkletCopied ? 'check' : 'copy'} size={15}/>
              {pairBookmarkletCopied ? 'Copied!' : 'Copy link'}
            </button>
            <span class="vs-install-col-hint">Paste as the bookmark URL in the filling profile</span>
          </div>
        </div>
        <label class="vault-field" style="margin:10px 0 4px">
          <span class="vault-label muted">Name</span>
          <input
            class="input"
            bind:value={pairDelegateName}
            placeholder="e.g. Firefox — daily profile"
            onkeydown={e => { if (e.key === 'Enter') commitPairDelegate() }}
          />
        </label>
      {/if}
      {#if pairDelegateError}<div class="unlock-error" style="font-size:13px">{pairDelegateError}</div>{/if}
      <div style="margin-top:12px">
        <button class="vs-close-btn" disabled={pairDelegateBusy || (!pairDelegatePreview && !pairDelegateToken.trim())} onclick={commitPairDelegate}>
          {pairDelegateBusy ? 'Pairing…' : 'Pair profile'}
        </button>
      </div>
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

  .vs-title {
    color: var(--text-muted);
    text-align: center;
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
    justify-content: center;
    gap: 28px;
    margin: 20px 0 20px;
  }

  .vault-stat {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
  }

  .vault-stat-num {
    font-size: 32px;
    font-weight: 700;
    line-height: 1;
    text-align: center;
  }

  .vault-stat-label {
    font-size: 13px;
    text-align: center;
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

  .vault-segmented button:disabled { opacity: 0.4; cursor: not-allowed; }

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

  /* ── Autofill delegates ──────────────────────────────────────────────────── */
  .delegate-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-bottom: 14px;
  }

  .delegate-row {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 14px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--r-card);
  }

  .delegate-info {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  .delegate-name {
    font-size: 14px;
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .delegate-meta {
    font-size: 12px;
  }

  .delegate-revoke {
    background: none;
    border: none;
    cursor: pointer;
    font-size: 13px;
    color: var(--danger);
    padding: 4px 2px;
    font-weight: 500;
    flex-shrink: 0;
  }
  .delegate-revoke:hover { text-decoration: underline; }

  .delegate-advanced-toggle {
    display: block;
    margin-top: 14px;
    background: none;
    border: none;
    cursor: pointer;
    font-size: 13px;
    padding: 0;
  }

  .delegate-advanced-body {
    margin-top: 12px;
    padding: 14px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--r-card);
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .switchboard-url-actions {
    display: flex;
    gap: 8px;
    justify-content: flex-end;
  }

  .switchboard-status-row {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 20px;
  }

  .switchboard-status-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--border);
    flex-shrink: 0;
  }
  .switchboard-status-dot.switchboard-ok    { background: #4caf50; }
  .switchboard-status-dot.switchboard-error { background: var(--text-soft); }

  /* ── Bookmarklet install modal ───────────────────────────────────────────── */
  :global(.modal.modal-install) { max-width: 425px; }

  .vs-modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .vs-modal-x {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border: none;
    background: none;
    cursor: pointer;
    color: var(--text-muted);
    border-radius: 6px;
    padding: 0;
    flex-shrink: 0;
    font-family: inherit;
  }
  .vs-modal-x:hover { color: var(--text); background: var(--surface-2); }

  .vs-bookmarklet-chip.chip-inactive {
    opacity: 0.4;
    cursor: default;
    pointer-events: none;
  }

  .vs-copy-link-btn:disabled { opacity: 0.4; cursor: not-allowed; }
  .vs-close-btn:disabled     { opacity: 0.45; cursor: not-allowed; }
  .vs-install-warning {
    display: flex;
    gap: 9px;
    align-items: flex-start;
    background: var(--orange-bg-strong);
    border: 1px solid var(--orange);
    border-radius: 8px;
    padding: 9px 12px;
    font-size: 13px;
    color: var(--orange);
    margin-bottom: 14px;
    line-height: 1.4;
  }
  .vs-install-warning :global(svg) { flex-shrink: 0; margin-top: 1px; }

  .vs-install-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
    margin-bottom: 12px;
  }

  .vs-install-col {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    border-radius: 11px;
    background: var(--surface);
    padding: 16px 12px;
  }
  .vs-install-col-drag { border: 1.5px dashed var(--border-strong); }
  .vs-install-col-copy { border: 1.5px solid var(--border-strong); }

  .vs-install-col-label {
    font-size: 11px;
    font-weight: 500;
    letter-spacing: 0.06em;
    color: var(--text-soft);
    text-transform: uppercase;
  }

  .vs-install-col-hint {
    font-size: 12px;
    color: var(--text-muted);
    text-align: center;
    line-height: 1.4;
  }

  .vs-bookmarklet-chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 8px 14px;
    background: var(--surface-2);
    border: 1.5px dashed var(--border-strong);
    border-radius: var(--r-pill);
    font-size: 14px;
    font-weight: 500;
    color: var(--text);
    text-decoration: none;
    cursor: grab;
    user-select: none;
    transition: border-color 0.15s, background 0.15s;
  }
  .vs-bookmarklet-chip:hover {
    border-color: var(--accent);
    background: var(--surface);
    color: var(--accent);
  }
  .vs-bookmarklet-chip:active { cursor: grabbing; }

  .vs-copy-link-btn {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    padding: 9px 18px;
    border: 1.5px solid var(--amber);
    border-radius: 8px;
    background: transparent;
    color: var(--amber);
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    font-family: inherit;
    transition: border-color 0.2s, color 0.2s;
  }
  .vs-copy-link-btn:hover { opacity: 0.85; }
  .vs-copy-link-btn.copied { border-color: var(--success); color: var(--success); }

  .vs-globe-tip-toggle {
    display: flex;
    align-items: center;
    gap: 6px;
    background: none;
    border: none;
    cursor: pointer;
    font-size: 12px;
    color: var(--text-soft);
    padding: 4px 0;
    font-family: inherit;
    text-align: left;
    width: 100%;
    margin-bottom: 2px;
  }
  .vs-globe-tip-arrow {
    display: inline-block;
    font-size: 10px;
    transition: transform 0.15s;
  }
  .vs-globe-tip-arrow.open { transform: rotate(90deg); }

  .vs-globe-tip-body {
    font-size: 12px;
    color: var(--text-muted);
    padding: 4px 0 12px 16px;
    line-height: 1.5;
  }

  .vs-close-btn {
    width: 100%;
    padding: 12px;
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: 9px;
    font-size: 14px;
    font-weight: 700;
    color: var(--text);
    cursor: pointer;
    font-family: inherit;
  }
  .vs-close-btn:hover { background: var(--surface); }
</style>
