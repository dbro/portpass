<script>
  import { onMount } from 'svelte'
  import { selectedFile, dbItems, toast, clipboardSession } from '../store.js'
  import {
    getRecordData, getDatabaseData, saveDatabase, getDatabaseInfo,
    updateRecordFields, updateDBFields, deleteRecord as wasmDeleteRecord,
  } from '../wasm.js'
  import Icon from './Icon.svelte'
  import RecordList from './RecordList.svelte'
  import RecordRead from './RecordRead.svelte'
  import RecordEdit from './RecordEdit.svelte'
  import VaultSheet from './VaultSheet.svelte'

  let { onclosed, theme, accent, isDesktop, ontheme, onaccent } = $props()

  let query        = $state('')
  let selectedUUID = $state(null)
  let record       = $state(null)
  let isEditing    = $state(false)
  let isNew        = $state(false)
  let sheetOpen    = $state(false)
  let isDirty      = $state(false)
  let dbName = $state('')
  let dbKey  = $state('')

  onMount(() => {
    try {
      const info = getDatabaseInfo()
      dbName = info?.name ?? ''
      dbKey  = info?.uuid ?? ''
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
    if (isEditing && record) {
      // simple guard — discard changes
      if (!confirm('Discard unsaved changes?')) return
    }
    try {
      record = getRecordData(uuid)
      selectedUUID = uuid
      isEditing = false
      isNew = false
    } catch (e) {
      console.error(e)
    }
  }

  function startEdit() {
    isEditing = true
  }

  function startNew() {
    record = { Title: '', Group: '', Username: '', Password: '', URL: '', Notes: '' }
    selectedUUID = null
    isNew = true
    isEditing = true
  }

  function cancelEdit() {
    if (isNew) {
      record = null
      selectedUUID = null
      isNew = false
    }
    isEditing = false
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
      isDirty = true
      await saveFile(true)
    } catch (e) {
      showToast('Failed to save: ' + e.message)
    }
  }

  async function deleteRecord(uuid) {
    if (!confirm(`Delete "${record?.Title}"?`)) return
    try {
      wasmDeleteRecord(uuid)
      const items = getDatabaseData()
      dbItems.set(items)
      record = null
      selectedUUID = null
      isEditing = false
      isNew = false
      isDirty = true
      await saveFile(true)
      showToast('Record deleted')
    } catch (e) {
      showToast('Failed to delete: ' + e.message)
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
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
    return true
  }

  // Read clipboard, compare hash, clear only if it's still our data.
  // Only attempts readText if clipboard-read is already granted — calling it
  // without pre-existing permission shows a browser prompt that steals page
  // focus and breaks the subsequent writeText call.
  async function tryClearClipboard() {
    if (!clipHash) return
    try {
      let overwritten = false
      try {
        const perm = await navigator.permissions.query({ name: 'clipboard-read' })
        if (perm.state === 'granted') {
          const current = await navigator.clipboard.readText()
          if (!hashesEqual(await sha256(current), clipHash)) overwritten = true
        }
      } catch {}

      if (overwritten) {
        clipHash = null
        clipboardSession.set(null)
        return
      }

      await navigator.clipboard.writeText('')
      clipHash = null
      clipboardSession.set(null)
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

  async function copyToClipboard(value) {
    try {
      await navigator.clipboard.writeText(value)
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


  async function saveDBFields(fields) {
    try {
      updateDBFields(fields)
      await saveFile(true)
      dbName = fields.Name ?? dbName  // fields uses PascalCase for the WASM write API
      showToast('Vault info saved')
    } catch (e) {
      showToast('Failed to save vault info: ' + e.message)
    }
  }

  function lockVault() {
    sheetOpen = false
    onclosed()
  }

  function closeVault() {
    if (isDirty && !confirm('Close without saving?')) return
    sheetOpen = false
    onclosed()
  }

  // Warn on tab close with unsaved changes
  $effect(() => {
    const handler = e => { if (isDirty) { e.preventDefault(); e.returnValue = '' } }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  })

  let vaultName = $derived(dbName || $selectedFile?.name || 'Vault')
  let showRecord = $derived(!!record || isEditing)
</script>

<svelte:window onkeydown={e => {
  if (e.key === 'Escape' && sheetOpen) sheetOpen = false
}}/>

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
    {#if isDesktop}
      <button class="btn-text accent small" onclick={startNew} style="padding:6px 8px">
        <Icon name="plus" size={16}/> New
      </button>
    {/if}
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
    />
    {#if query}
      <button class="icon-btn-flat" onclick={() => query = ''} aria-label="Clear search">
        <Icon name="x" size={16} stroke="var(--text-soft)"/>
      </button>
    {/if}
  </div>

  <RecordList {query} {selectedUUID} storageKey={dbKey} ontap={selectRecord} oncopy={copyToClipboard}/>

  <!-- FAB (mobile) -->
  <button class="fab" onclick={startNew} aria-label="New record">
    <Icon name="plus" size={22} stroke="var(--accent-on)"/>
  </button>
</div>

<!-- RECORD PANE -->
<div class="record-screen" class:is-open={showRecord && !isDesktop}>
  {#if isEditing}
    <RecordEdit
      {record}
      {isNew}
      {isDesktop}
      oncancel={cancelEdit}
      onsave={saveRecord}
    />
  {:else if record}
    {#key selectedUUID}
      <RecordRead
        {record}
        {isDesktop}
        onback={() => { record = null; selectedUUID = null }}
        onedit={startEdit}
        ondelete={() => deleteRecord(selectedUUID)}
        oncopy={copyToClipboard}
      />
    {/key}
  {:else if isDesktop}
    <div class="record-empty">Select a record</div>
  {/if}
</div>

<!-- VAULT SHEET -->
{#if sheetOpen}
  <VaultSheet
    {theme}
    {accent}
    onclose={() => sheetOpen = false}
    onlock={lockVault}
    onclosevault={closeVault}
    ondbsave={saveDBFields}
    {ontheme}
    {onaccent}
  />
{/if}
