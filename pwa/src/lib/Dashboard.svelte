<script>
  import { onMount } from 'svelte'
  import { get } from 'svelte/store'
  import { selectedFile, dbItems, toast, clipboardSession, clipboardContext } from '../store.js'
  import {
    getRecordData, getDatabaseData, saveDatabase, getDatabaseInfo,
    updateRecordFields, updateDBFields, deleteRecord as wasmDeleteRecord,
    searchRecords, getTOTP,
  } from '../wasm.js'
  import Icon from './Icon.svelte'
  import RecordList from './RecordList.svelte'
  import RecordRead from './RecordRead.svelte'
  import RecordEdit from './RecordEdit.svelte'
  import VaultSheet from './VaultSheet.svelte'

  let { onclosed, theme, accent, isDesktop, ontheme, onaccent } = $props()

  function focusOnMount(node) {
    setTimeout(() => node.focus(), 0)
  }

  let query        = $state('')
  let selectedUUID = $state(null)
  let record       = $state(null)
  let isEditing    = $state(false)
  let isNew        = $state(false)
  let sheetOpen    = $state(false)
  let isDirty      = $state(false)
  let editDirty    = $state(false)
  let vaultDirty   = $state(false)
  let dbName   = $state('')
  let dbKey    = $state('')
  let lastSave = $state('')

  let passwordCount = $derived($dbItems.length)
  let groupCount    = $derived(new Set($dbItems.map(i => i.group).filter(Boolean)).size)

  function relSaveTime(when) {
    if (!when) return ''
    // Go time.String() format: "2006-01-02 15:04:05.999 +0000 UTC m=+..."
    const s = when.replace(/ m=[+-][\d.]+$/, '').replace(/\.\d+/, '').replace(/ [A-Z]{2,5}$/, '')
    const d = new Date(s)
    if (isNaN(d.getTime())) return ''
    const diff = (Date.now() - d) / 1000
    if (diff < 60)       return 'just now'
    if (diff < 3600)     return `${Math.floor(diff / 60)}m ago`
    if (diff < 86400)    return `${Math.floor(diff / 3600)}h ago`
    if (diff < 86400*7)  return `${Math.floor(diff / 86400)}d ago`
    if (diff < 86400*30) return `${Math.floor(diff / (86400*7))}w ago`
    return d.toLocaleDateString()
  }

  onMount(() => {
    try {
      const info = getDatabaseInfo()
      dbName   = info?.name ?? ''
      dbKey    = info?.uuid ?? ''
      lastSave = info?.when ?? ''
    } catch (e) {}
    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('focus', onWindowFocus)
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('focus', onWindowFocus)
    }
  })

  function showToast(message, action, duration = 4000) {
    toast.set({ message, action, duration })
  }

  // Load a record by UUID
  function selectRecord(uuid) {
    if (isEditing && editDirty) {
      if (!confirm('Discard unsaved changes?')) return
    }
    if (sheetOpen && vaultDirty) {
      if (!confirm('Discard unsaved changes?')) return
    }
    try {
      record = getRecordData(uuid)
      selectedUUID = uuid
      isEditing = false
      isNew = false
      editDirty = false
      sheetOpen = false
      vaultDirty = false
    } catch (e) {
      console.error(e)
    }
  }

  function startEdit() {
    isEditing = true
  }

  function startNew() {
    if (sheetOpen && vaultDirty) {
      if (!confirm('Discard unsaved changes?')) return
    }
    record = { Title: '', Group: '', Username: '', Password: '', URL: '', Notes: '' }
    selectedUUID = null
    isNew = true
    isEditing = true
    sheetOpen = false
    vaultDirty = false
  }

  function cancelEdit() {
    if (isNew) {
      record = null
      selectedUUID = null
      isNew = false
    }
    isEditing = false
    editDirty = false
  }

  async function saveRecord(draft) {
    try {
      const uuid = updateRecordFields(isNew ? null : selectedUUID, draft)
      const items = getDatabaseData()
      dbItems.set(items)
      selectedUUID = uuid ?? selectedUUID
      record = getRecordData(selectedUUID)
      isNew = false
      isEditing = false
      editDirty = false
      isDirty = true
      await saveFile(true)
    } catch (e) {
      showToast('Failed to save: ' + e.message)
    }
  }

  let pendingDeleteTimer = null
  let pendingDeleteUUID = $state(null)
  let pendingDeleteTitle = $state(null)

  async function deleteRecord(uuid) {
    try {
      // Capture title and UUID for toast and undo
      const snapshot = getRecordData(uuid)
      pendingDeleteUUID = uuid
      pendingDeleteTitle = snapshot.Title

      // Clear UI state (record disappears from view)
      record = null
      selectedUUID = null
      isEditing = false
      isNew = false

      // Clear any existing pending delete timer
      if (pendingDeleteTimer) clearTimeout(pendingDeleteTimer)

      // Show undo toast
      showToast(`Deleting "${pendingDeleteTitle}"...`, {
        label: 'Cancel',
        fn: undoDelete
      }, 5000)

      // Auto-delete and save after 5 seconds if not undone
      pendingDeleteTimer = setTimeout(async () => {
        try {
          wasmDeleteRecord(pendingDeleteUUID)
          const items = getDatabaseData()
          dbItems.set(items)
          isDirty = true
          await saveFile(true)
        } catch (e) {
          showToast('Failed to delete: ' + e.message)
        } finally {
          pendingDeleteTimer = null
          pendingDeleteUUID = null
          pendingDeleteTitle = null
        }
      }, 5000)

    } catch (e) {
      showToast('Failed to delete: ' + e.message)
    }
  }

  function undoDelete() {
    // Cancel the pending delete
    if (pendingDeleteTimer) {
      clearTimeout(pendingDeleteTimer)
      pendingDeleteTimer = null
    }

    // Re-select the restored record
    const uuid = pendingDeleteUUID
    pendingDeleteUUID = null
    pendingDeleteTitle = null

    if (uuid) {
      try {
        selectedUUID = uuid
        record = getRecordData(uuid)
        isEditing = false
        showToast('Delete cancelled', null, 2000)
      } catch (e) {
        showToast('Failed to cancel: ' + e.message)
      }
    }
  }

  async function saveFile(silent = false) {
    try {
      const data = saveDatabase()
      let handle = $selectedFile?.handle

      if (!handle) {
        handle = await window.showSaveFilePicker({
          suggestedName: $selectedFile?.name ?? 'vault.psafe3',
          types: [{ description: 'Password Safe', accept: { 'application/octet-stream': ['.psafe3', '.dat'] } }],
        })
        selectedFile.update(s => ({ ...s, handle, name: handle.name }))
      }

      const w = await handle.createWritable()
      await w.write(data)
      await w.close()
      isDirty = false
      try { lastSave = getDatabaseInfo()?.when ?? '' } catch {}
      if (!silent) showToast('Vault saved')
    } catch (e) {
      if (e.name !== 'AbortError') showToast('Save failed: ' + e.message)
    }
  }

  let clearTimer    = null
  let clipHash      = null  // SHA-256 of the value we copied; null when nothing pending
  let sessionSerial = 0     // increments on every copy to give each session a unique identity

  async function sha256(text) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
    return new Uint8Array(buf)
  }

  function hashesEqual(a, b) {
    if (!a || !b || a.length !== b.length) return false
    let diff = 0
    for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i]
    return diff === 0
  }

  // Read clipboard, compare hash, clear only if it's still our data.
  // Only attempts readText if clipboard-read is already granted — calling it
  // without pre-existing permission shows a browser prompt that steals page
  // focus and breaks the subsequent writeText call.
  async function tryClearClipboard() {
    if (!clipHash) return
    try {
      try {
        const perm = await navigator.permissions.query({ name: 'clipboard-read' })
        if (perm.state === 'granted') {
          const current = await navigator.clipboard.readText()
          if (!hashesEqual(await sha256(current), clipHash)) {
            // user already replaced clipboard contents — abandon clear
            clipHash = null
            clipboardSession.set(null)
            clipboardContext.set(null)
            return
          }
        }
      } catch {}

      await navigator.clipboard.writeText('')
      clipHash = null
      clipboardSession.set(null)
      clipboardContext.set(null)
      showToast('Clipboard cleared', null, 2000)
    } catch {
      // keep clipHash — retry on next visibilitychange
    }
  }

  function onVisibilityChange() {
    if (!document.hidden && clearTimer === null && clipHash !== null) {
      tryClearClipboard()
    }
  }

  // window.focus fires after the document is genuinely focused, which is required
  // for clipboard API access — more reliable than visibilitychange alone.
  function onWindowFocus() {
    if (clearTimer === null && clipHash !== null) {
      tryClearClipboard()
    }
  }

  async function copyToClipboard(value, { skipAutoclear = false } = {}) {
    try {
      await navigator.clipboard.writeText(value)
      if (skipAutoclear) {
        if (clearTimer) { clearTimeout(clearTimer); clearTimer = null }
        clipHash = null
        clipboardSession.set(null)
        clipboardContext.set(null)
        return null
      }
      clipHash = await sha256(value)
      const token = ++sessionSerial
      clipboardSession.set({ token, expiresAt: Date.now() + 30000 })
      if (clearTimer) clearTimeout(clearTimer)
      clearTimer = setTimeout(() => {
        clearTimer = null
        tryClearClipboard()
      }, 30000)
      return token
    } catch {
      showToast('Copy failed')
      return null
    }
  }

  async function copyTOTPForUUID(uuid) {
    try {
      const totp = getTOTP(uuid)
      await navigator.clipboard.writeText(totp.code)
      if (clearTimer) { clearTimeout(clearTimer); clearTimer = null }
      clipHash = null
      const token = ++sessionSerial
      const h = Array.from(await sha256(totp.code))
      // Short session drives the visual flash only — no autoclear timer
      clipboardSession.set({ token, expiresAt: Date.now() + 500 })
      clipboardContext.set({ token, field: 'otp', uuid, hash: h })
      setTimeout(() => {
        if (get(clipboardSession)?.token === token) {
          clipboardSession.set(null)
          clipboardContext.set(null)
        }
      }, 500)
    } catch {
      showToast('Copy failed')
    }
  }

  async function copyTOTP() {
    if (!record?.TwoFactorKey) return
    await copyTOTPForUUID(selectedUUID)
  }


  async function saveDBFields(fields) {
    try {
      updateDBFields(fields)
      await saveFile(true)
      dbName = fields.Name ?? dbName  // fields uses PascalCase for the WASM write API
      vaultDirty = false
      showToast('Vault info saved')
    } catch (e) {
      showToast('Failed to save vault info: ' + e.message)
    }
  }

  function closeVaultSheet() {
    if (vaultDirty) {
      if (!confirm('Discard unsaved changes?')) return
    }
    sheetOpen = false
    vaultDirty = false
  }

  function lockVault() {
    onclosed()
  }

  // Warn on tab close with unsaved changes
  $effect(() => {
    const handler = e => { if (isDirty) { e.preventDefault(); e.returnValue = '' } }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  })

  let vaultName = $derived(dbName || $selectedFile?.name || 'Vault')
  let showRecord = $derived(!!record || isEditing || sheetOpen)

  let searchInput = $state(null)
  let showHelp    = $state(false)

  // Flat ordered UUID list matching RecordList's sort, used for arrow navigation.
  let flatList = $derived.by(() => {
    let list = $dbItems
    if (pendingDeleteUUID) list = list.filter(i => i.uuid !== pendingDeleteUUID)
    if (query.trim()) {
      const matched = new Set(searchRecords(query, false))
      list = list.filter(i => matched.has(i.uuid))
    }
    return [...list].sort((a, b) => {
      const ga = a.group || 'Ungrouped', gb = b.group || 'Ungrouped'
      const gc = ga.localeCompare(gb)
      return gc !== 0 ? gc : a.title.localeCompare(b.title)
    }).map(i => i.uuid)
  })

  async function copyRecordField(field) {
    const value = record?.[field]
    if (!value) return
    const token = await copyToClipboard(value)
    if (token !== null) {
      const hash = Array.from(await sha256(value))
      clipboardContext.set({ token, field, uuid: selectedUUID, hash })
    }
  }

  async function copyCustomField(index) {
    const cf = record?.CustomFields?.[index]
    if (!cf?.Value) return
    const token = await copyToClipboard(cf.Value)
    if (token !== null) {
      const hash = Array.from(await sha256(cf.Value))
      clipboardContext.set({ token, field: `custom-${index}`, uuid: selectedUUID, hash })
    }
  }

  async function handleKeydown(e) {
    const inInput = e.target.matches('input, textarea, select, [contenteditable]')
    const inSearch = e.target === searchInput

    if (e.key === 'Escape') {
      if (showHelp) { showHelp = false; return }
      if (inSearch && query) { query = ''; return }
      if (sheetOpen) { sheetOpen = false; return }
      if (isEditing) { cancelEdit(); return }
      if (record) { record = null; selectedUUID = null; return }
      if (query) { query = ''; return }
      return
    }

    if (e.key === '?' && !inInput) { showHelp = !showHelp; return }

    if (e.key === '/' && !inInput) {
      e.preventDefault()
      searchInput?.focus()
      return
    }

    if (isEditing || sheetOpen) return
    if (inInput && !inSearch) return  // block shortcuts in edit form, but allow from search

    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (inSearch) {
        const next = flatList[0]
        if (next) { selectRecord(next); searchInput?.blur() }
      } else {
        const idx = flatList.indexOf(selectedUUID)
        if (idx === flatList.length - 1) {
          record = null; selectedUUID = null; searchInput?.focus()
        } else {
          const next = idx === -1 ? flatList[0] : flatList[idx + 1]
          if (next) selectRecord(next)
        }
      }
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (inSearch) {
        const prev = flatList[flatList.length - 1]
        if (prev) { selectRecord(prev); searchInput?.blur() }
      } else {
        const idx = flatList.indexOf(selectedUUID)
        if (idx === 0) {
          record = null; selectedUUID = null; searchInput?.focus()
        } else {
          const prev = idx <= 0 ? flatList[flatList.length - 1] : flatList[idx - 1]
          if (prev) selectRecord(prev)
        }
      }
      return
    }

    if (inSearch) return  // no other shortcuts while typing in search

    if (e.ctrlKey && e.key === 'l') { e.preventDefault(); lockVault(); return }
    if (e.ctrlKey && (e.key === '+' || e.key === '=')) { e.preventDefault(); startNew(); return }

    if (!record) return

    if (e.key === 'Enter' && !e.target.matches('button, a')) {
      e.preventDefault()
      if (record.URL) window.open(record.URL, '_blank')
      return
    }
    if (e.ctrlKey && e.key === 'c') {
      if (!window.getSelection()?.toString()) {
        e.preventDefault()
        copyRecordField('Password')
      }
      return
    }
    if (e.ctrlKey && e.key === 'b') { e.preventDefault(); copyRecordField('Username'); return }
    if (e.ctrlKey && e.key === 'u') { e.preventDefault(); copyRecordField('URL'); return }
    if (e.ctrlKey && e.key === 't') { e.preventDefault(); copyTOTP(); return }
    if (e.ctrlKey && e.key === 'e') { e.preventDefault(); startEdit(); return }
    if (e.ctrlKey && e.key >= '1' && e.key <= '9') { e.preventDefault(); copyCustomField(parseInt(e.key) - 1); return }
  }
</script>

<svelte:window onkeydown={handleKeydown}/>

<!-- TOP BAR -->
<div class="topbar">
  <div class="topbar-left">
    <button class="vault-pill" onclick={() => sheetOpen = true}>
      <Icon name="unlock" size={16}/>
      <span>{vaultName}</span>
      <Icon name="chevron-down" size={16}/>
    </button>
  </div>
  <div class="topbar-right">
  </div>
</div>

<!-- LIST PANE -->
<div class="list-screen">
  <div class="searchbar">
    <Icon name="search" size={18} stroke="var(--text-soft)"/>
    <input
      class="search-input"
      type="text"
      placeholder="Search vault"
      bind:value={query}
      bind:this={searchInput}
      use:focusOnMount
    />
    {#if query}
      <button class="icon-btn-flat" onclick={() => query = ''} aria-label="Clear search">
        <Icon name="x" size={16} stroke="var(--text-soft)"/>
      </button>
    {/if}
  </div>

  <RecordList {query} {selectedUUID} excludeUUID={pendingDeleteUUID} storageKey={dbKey} ontap={selectRecord} oncopy={copyToClipboard} oncopytotp={copyTOTPForUUID}/>

  <!-- FAB (mobile) -->
  <button class="fab" onclick={startNew} aria-label="New">
    <Icon name="plus" size={22} stroke="var(--accent-on)"/>
  </button>

  <!-- New button (desktop, bottom of left panel) -->
  {#if isDesktop}
    <button class="desktop-new-btn" onclick={startNew}>
      <Icon name="plus" size={18}/>
      <span>New</span>
    </button>
  {/if}
</div>

{#if showHelp}
  <div
    class="help-backdrop"
    role="presentation"
    onclick={() => showHelp = false}
    onkeydown={e => { if (e.key === 'Escape') showHelp = false }}
  >
    <div
      class="help-modal"
      role="dialog"
      aria-modal="true"
      tabindex="-1"
      onclick={e => e.stopPropagation()}
      onkeydown={e => e.stopPropagation()}
    >
      <div class="help-title">Keyboard shortcuts</div>
      <div class="help-rows">
        <div class="help-row"><span>Focus search</span><div class="help-keys"><kbd>/</kbd></div></div>
        <div class="help-row"><span>Navigate list</span><div class="help-keys"><kbd>↑</kbd><kbd>↓</kbd></div></div>
        <div class="help-row"><span>Visit URL</span><div class="help-keys"><kbd>↵</kbd></div></div>
        <div class="help-row"><span>New entry</span><div class="help-keys"><kbd>Ctrl</kbd><kbd>+</kbd></div></div>
        <div class="help-row"><span>Copy password</span><div class="help-keys"><kbd>Ctrl</kbd><kbd>C</kbd></div></div>
        <div class="help-row"><span>Copy username</span><div class="help-keys"><kbd>Ctrl</kbd><kbd>B</kbd></div></div>
        <div class="help-row"><span>Copy URL</span><div class="help-keys"><kbd>Ctrl</kbd><kbd>U</kbd></div></div>
        <div class="help-row"><span>Copy one-time code</span><div class="help-keys"><kbd>Ctrl</kbd><kbd>T</kbd></div></div>
        <div class="help-row"><span>Copy custom field 1–9</span><div class="help-keys"><kbd>Ctrl</kbd><kbd>1–9</kbd></div></div>
        <div class="help-row"><span>Edit entry</span><div class="help-keys"><kbd>Ctrl</kbd><kbd>E</kbd></div></div>
        <div class="help-row"><span>Lock vault</span><div class="help-keys"><kbd>Ctrl</kbd><kbd>L</kbd></div></div>
        <div class="help-row"><span>Clear search / close</span><div class="help-keys"><kbd>Esc</kbd></div></div>
        <div class="help-row"><span>This help</span><div class="help-keys"><kbd>?</kbd></div></div>
      </div>
    </div>
  </div>
{/if}

<!-- RECORD PANE -->
<div class="record-screen" class:is-open={showRecord && !isDesktop}>
  {#if sheetOpen}
    <VaultSheet
      {isDesktop}
      {theme}
      {accent}
      onback={closeVaultSheet}
      onlock={lockVault}
      ondbsave={saveDBFields}
      ondirtychange={(d) => vaultDirty = d}
      {ontheme}
      {onaccent}
    />
  {:else if isEditing}
    <RecordEdit
      {record}
      {isNew}
      {isDesktop}
      oncancel={cancelEdit}
      onsave={saveRecord}
      ondelete={() => deleteRecord(selectedUUID)}
      ondirtychange={(d) => editDirty = d}
    />
  {:else if record}
    {#key selectedUUID}
      <RecordRead
        {record}
        uuid={selectedUUID}
        {isDesktop}
        onback={() => { record = null; selectedUUID = null }}
        onedit={startEdit}
        oncopy={copyToClipboard}
        oncopytotp={copyTOTPForUUID}
      />
    {/key}
  {:else if isDesktop}
    <div class="record-empty">
      <img src="{import.meta.env.BASE_URL}icon-512.png" alt="Portpass" class="empty-logo"/>
      {#if passwordCount === 0}
        <div class="empty-prompt muted">Add your first password</div>
        <div class="empty-nudge muted">↙</div>
      {:else}
        <div class="empty-stats">
          <div class="empty-stat">
            <span class="empty-num">{passwordCount}</span>
            <span class="empty-label muted">passwords</span>
          </div>
          {#if groupCount > 0}
            <div class="empty-divider"></div>
            <div class="empty-stat">
              <span class="empty-num">{groupCount}</span>
              <span class="empty-label muted">groups</span>
            </div>
          {/if}
        </div>
        {#if lastSave}
          <div class="empty-save muted">Last saved {relSaveTime(lastSave)}</div>
        {/if}
      {/if}
    </div>
  {/if}
</div>

<style>
  .help-backdrop {
    position: fixed;
    inset: 0;
    z-index: 200;
    background: rgba(0,0,0,0.4);
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .help-modal {
    background: var(--surface);
    border: 1px solid var(--border-strong);
    border-radius: var(--r-sheet);
    box-shadow: 0 8px 32px rgba(0,0,0,0.24);
    padding: 20px 24px 24px;
    width: min(380px, 90vw);
  }

  .help-title {
    font-size: 14px;
    font-weight: 600;
    margin-bottom: 14px;
    color: var(--text-soft);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .help-rows {
    display: flex;
    flex-direction: column;
  }

  .help-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 7px 0;
    border-bottom: 1px solid var(--border);
    font-size: 13px;
  }
  .help-row:last-child { border-bottom: none; }

  .help-row span { color: var(--text); }

  .help-keys {
    display: flex;
    gap: 4px;
    flex-shrink: 0;
  }

  .help-keys kbd {
    font-size: 13px;
    font-family: inherit;
    font-weight: 500;
    color: var(--text-soft);
    background: var(--surface-2);
    border: 1px solid var(--border-strong);
    border-radius: 4px;
    padding: 1px 6px;
  }
</style>
