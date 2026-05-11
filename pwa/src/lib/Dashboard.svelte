<script>
  import { selectedFile, dbItems, toast } from '../store.js'
  import {
    getRecordData, getDatabaseData, saveDatabase,
    updateRecordFields, deleteRecord as wasmDeleteRecord,
  } from '../wasm.js'
  import Icon from './Icon.svelte'
  import RecordList from './RecordList.svelte'
  import RecordRead from './RecordRead.svelte'
  import RecordEdit from './RecordEdit.svelte'
  import VaultSheet from './VaultSheet.svelte'

  let { onclosed, theme, accent, isDesktop, ontheme, onaccent } = $props()

  let query        = $state('')
  let selectedUUID = $state(null)
  let record       = $state(null)     // full record from WASM
  let isEditing    = $state(false)
  let isNew        = $state(false)
  let sheetOpen    = $state(false)
  let isDirty      = $state(false)    // unsaved DB changes

  function showToast(message, action) {
    toast.set({ message, action, duration: 4000 })
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

  async function copyToClipboard(value, label) {
    try {
      await navigator.clipboard.writeText(value)
      showToast(`${label} copied`)
    } catch (e) {
      showToast('Copy failed')
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

  let vaultName = $derived($selectedFile?.name ?? 'Vault')
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

  <RecordList {query} {selectedUUID} ontap={selectRecord}/>

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
    <RecordRead
      {record}
      {isDesktop}
      onback={() => { record = null; selectedUUID = null }}
      onedit={startEdit}
      ondelete={() => deleteRecord(selectedUUID)}
      oncopy={copyToClipboard}
    />
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
    {ontheme}
    {onaccent}
  />
{/if}
