<script>
  import { onMount } from 'svelte'
  import { get } from 'svelte/store'
  import { selectedFile, dbItems, secondaryVaults, toast, clipboardSession, clipboardContext } from '../store.js'
  import {
    getRecordData, getDatabaseData, saveDatabase, getDatabaseInfo,
    updateRecordFields, updateDBFields, deleteRecord as wasmDeleteRecord,
    searchRecords, getTOTP, closeDatabase, loadVaultFile,
    copyFieldToClipboard, copyCustomFieldToClipboard, copyTOTP as wasmCopyTOTP,
  } from '../wasm.js'
  import { addSecondaryCredential, removeSecondaryCredential } from './secondaryVaults.js'
  import { isBiometricEnrolledForFile, unlockWithBiometric } from './biometric.js'
  import Icon from './Icon.svelte'
  import RecordList from './RecordList.svelte'
  import RecordRead from './RecordRead.svelte'
  import RecordEdit from './RecordEdit.svelte'
  import VaultSheet from './VaultSheet.svelte'

  let { onclosed, theme, accent, isDesktop, ontheme, onaccent } = $props()

  function focusOnMount(node) {
    setTimeout(() => node.focus(), 0)
  }

  let query                  = $state('')
  let selectedUUID           = $state(null)
  let selectedVaultUuid      = $state(null) // null = primary vault
  let record                 = $state(null)
  let isEditing              = $state(false)
  let isNew                  = $state(false)
  let sheetOpen              = $state(false)
  let isDirty                = $state(false)
  let editDirty              = $state(false)
  let vaultDirty             = $state(false)
  let dbName   = $state('')
  let dbKey    = $state('')
  let lastSave = $state('')

  let passwordCount = $derived(
    $dbItems.length + $secondaryVaults.reduce((n, v) => n + (v.items?.length ?? 0), 0)
  )
  let groupCount = $derived(
    new Set($dbItems.map(i => i.group).filter(Boolean)).size
    + $secondaryVaults.reduce((n, v) => n + new Set(v.items?.map(i => i.group).filter(Boolean)).size, 0)
  )
  let secondaryCount    = $derived($secondaryVaults.length)
  let allVaultsReadonly = $derived($selectedFile?.readonly && $secondaryVaults.every(v => v.readonly))

  // State for the "unlock additional vault" modal flow.
  // handle is kept outside $state to prevent Svelte 5 from deep-proxying the FileSystemFileHandle.
  let _secondaryHandle = null
  let secondarySetup = $state(null) // { password, showPw, busy, error, needsAuth, filename }
  let newRecordVaultUuid = $state(null) // null = primary vault

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
      dbKey = get(selectedFile)?.uuid ?? ''
      const info = getDatabaseInfo(dbKey)
      dbName   = info?.name ?? ''
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

  // Load a record by UUID. vaultUuid is null for primary vault records.
  function selectRecord(uuid, vaultUuid = null) {
    if (isEditing && editDirty) {
      if (!confirm('Discard unsaved changes?')) return
    }
    if (sheetOpen && vaultDirty) {
      if (!confirm('Discard unsaved changes?')) return
    }
    // Reset navigation state first so the sheet always closes even if load fails.
    sheetOpen = false
    vaultDirty = false
    isEditing = false
    isNew = false
    editDirty = false
    try {
      record = getRecordData(vaultUuid || dbKey, uuid)
      selectedUUID = uuid
      selectedVaultUuid = vaultUuid
    } catch (e) {
      console.error(e)
      showToast('Could not load record.')
    }
  }

  function startEdit() {
    isEditing = true
  }

  let rwVaults = $derived([
    { uuid: dbKey, name: dbName || $selectedFile?.name || 'Vault' },
    ...$secondaryVaults.filter(v => !v.readonly).map(v => ({ uuid: v.uuid, name: v.name || v.filename })),
  ])

  function startNew() {
    if (sheetOpen && vaultDirty) {
      if (!confirm('Discard unsaved changes?')) return
    }
    newRecordVaultUuid = dbKey // default to primary
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
      const targetVault = isNew ? (newRecordVaultUuid || dbKey) : (selectedVaultUuid || dbKey)
      const uuid = updateRecordFields(targetVault, isNew ? null : selectedUUID, draft)
      selectedUUID = uuid ?? selectedUUID
      record = getRecordData(targetVault, selectedUUID)
      isNew = false
      isEditing = false
      editDirty = false
      newRecordVaultUuid = null

      if (targetVault === dbKey) {
        dbItems.set(getDatabaseData(dbKey))
        isDirty = true
        await saveFile(true)
      } else {
        // Secondary vault — update its item list and save to its file
        const sv = get(secondaryVaults).find(v => v.uuid === targetVault)
        if (sv) {
          const items = getDatabaseData(targetVault)
          secondaryVaults.update(vs => vs.map(v => v.uuid === targetVault
            ? { ...v, items: items.map(i => ({ ...i, vaultUuid: targetVault })) }
            : v
          ))
          selectedVaultUuid = targetVault
          const data = saveDatabase(targetVault)
          const w = await sv.handle.createWritable()
          await w.write(data)
          await w.close()
          showToast('Saved to ' + (sv.name || sv.filename), null, 2000)
        }
      }
    } catch (e) {
      showToast('Failed to save: ' + e.message)
    }
  }

  let pendingDeleteTimer = null
  let pendingDeleteUUID = $state(null)
  let pendingDeleteTitle = $state(null)

  async function deleteRecord(uuid) {
    const targetVault = selectedVaultUuid || dbKey
    try {
      const snapshot = getRecordData(targetVault, uuid)
      pendingDeleteUUID = uuid
      pendingDeleteTitle = snapshot.Title

      record = null
      selectedUUID = null
      isEditing = false
      isNew = false

      if (pendingDeleteTimer) clearTimeout(pendingDeleteTimer)

      showToast(`Deleting "${pendingDeleteTitle}"...`, { label: 'Cancel', fn: undoDelete }, 5000)

      pendingDeleteTimer = setTimeout(async () => {
        try {
          wasmDeleteRecord(targetVault, pendingDeleteUUID)
          if (targetVault === dbKey) {
            dbItems.set(getDatabaseData(dbKey))
            isDirty = true
            await saveFile(true)
          } else {
            const sv = get(secondaryVaults).find(v => v.uuid === targetVault)
            if (sv) {
              const items = getDatabaseData(targetVault)
              secondaryVaults.update(vs => vs.map(v => v.uuid === targetVault
                ? { ...v, items: items.map(i => ({ ...i, vaultUuid: targetVault })) }
                : v
              ))
              const data = saveDatabase(targetVault)
              const w = await sv.handle.createWritable()
              await w.write(data)
              await w.close()
            }
          }
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
        record = getRecordData(selectedVaultUuid || dbKey, uuid)
        isEditing = false
        showToast('Delete cancelled', null, 2000)
      } catch (e) {
        showToast('Failed to cancel: ' + e.message)
      }
    }
  }

  async function saveFile(silent = false) {
    try {
      const data = saveDatabase(dbKey)
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
      try { lastSave = getDatabaseInfo(dbKey)?.when ?? '' } catch {}
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

  function hexToBytes(hex) {
    const bytes = new Uint8Array(hex.length / 2)
    for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
    return bytes
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

  async function copyFieldViaWasm(recordVaultUuid, recordUuid, fieldname) {
    try {
      const { hash } = copyFieldToClipboard(recordVaultUuid, recordUuid, fieldname, true)
      const hashBytes = hexToBytes(hash)
      clipHash = hashBytes
      const token = ++sessionSerial
      clipboardSession.set({ token, expiresAt: Date.now() + 30000 })
      if (clearTimer) clearTimeout(clearTimer)
      clearTimer = setTimeout(() => { clearTimer = null; tryClearClipboard() }, 30000)
      return { token, hashBytes }
    } catch {
      showToast('Copy failed')
      return { token: null, hashBytes: null }
    }
  }

  async function copyCustomFieldViaWasm(recordVaultUuid, recordUuid, fieldname) {
    try {
      const { hash } = copyCustomFieldToClipboard(recordVaultUuid, recordUuid, fieldname, true)
      const hashBytes = hexToBytes(hash)
      clipHash = hashBytes
      const token = ++sessionSerial
      clipboardSession.set({ token, expiresAt: Date.now() + 30000 })
      if (clearTimer) clearTimeout(clearTimer)
      clearTimer = setTimeout(() => { clearTimer = null; tryClearClipboard() }, 30000)
      return { token, hashBytes }
    } catch {
      showToast('Copy failed')
      return { token: null, hashBytes: null }
    }
  }

  async function copyTOTPForUUID(uuid) {
    try {
      const totp = getTOTP(dbKey, uuid)
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
      updateDBFields(dbKey, fields)
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
    get(secondaryVaults).forEach(v => closeDatabase(v.uuid))
    closeDatabase(dbKey)
    secondaryVaults.set([])
    onclosed()
  }

  async function lockSecondaryVault(vaultUuid) {
    await removeSecondaryCredential(dbKey, vaultUuid)
    closeDatabase(vaultUuid)
    secondaryVaults.update(vs => vs.filter(v => v.uuid !== vaultUuid))
    if (selectedVaultUuid === vaultUuid) {
      record = null; selectedUUID = null; selectedVaultUuid = null
    }
  }

  async function lockAllVaults() {
    get(secondaryVaults).forEach(v => closeDatabase(v.uuid))
    closeDatabase(dbKey)
    secondaryVaults.set([])
    onclosed()
  }

  async function unlockAdditionalVault() {
    sheetOpen = false
    let secondaryHandle
    try {
      ;[secondaryHandle] = await window.showOpenFilePicker({
        types: [{ description: 'Password Safe', accept: { 'application/octet-stream': ['.psafe3', '.dat'] } }],
      })
    } catch (e) {
      sheetOpen = true
      if (e.name !== 'AbortError') showToast('Could not open file: ' + e.message)
      return
    }
    _secondaryHandle = secondaryHandle
    secondarySetup = {
      filename: secondaryHandle.name,
      password: '', showPw: false, busy: false, error: '',
      needsAuth: await isBiometricEnrolledForFile($selectedFile?.name ?? ''),
    }
  }

  async function confirmSecondarySetup() {
    if (!secondarySetup?.password) return
    secondarySetup = { ...secondarySetup, busy: true, error: '' }

    // Biometric confirmation gesture if enrolled (proves identity without exposing master password)
    if (secondarySetup.needsAuth) {
      try {
        await unlockWithBiometric($selectedFile?.name ?? '')
      } catch (e) {
        secondarySetup = { ...secondarySetup, busy: false,
          error: e.name === 'NotAllowedError' ? 'Authentication cancelled.' : 'Authentication failed: ' + e.message }
        return
      }
    }

    try {
      const secondaryUuid = await loadVaultFile(_secondaryHandle, secondarySetup.password)

      if (secondaryUuid === dbKey) {
        closeDatabase(secondaryUuid)
        secondarySetup = { ...secondarySetup, busy: false,
          error: `"${secondarySetup.filename}" is already open as your primary vault and cannot also be added as a secondary vault.` }
        return
      }

      const info  = getDatabaseInfo(secondaryUuid)
      const items = getDatabaseData(secondaryUuid)
      let readonly = true
      try { const w = await _secondaryHandle.createWritable(); await w.abort(); readonly = false } catch {}

      await addSecondaryCredential(dbKey, secondarySetup.filename, secondaryUuid, secondarySetup.password, _secondaryHandle)

      secondaryVaults.update(vs => {
        const filtered = vs.filter(v => v.uuid !== secondaryUuid)
        return [...filtered, {
          handle: _secondaryHandle,
          name: info?.name || secondarySetup.filename,
          filename: secondarySetup.filename,
          readonly,
          items: items.map(i => ({ ...i, vaultUuid: secondaryUuid })),
          uuid: secondaryUuid,
          masterPassword: secondarySetup.password,
        }]
      })
      secondarySetup = null
      sheetOpen = true
    } catch (e) {
      secondarySetup = { ...secondarySetup, busy: false, error: 'Wrong password or invalid file.' }
    }
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
  let showHelp      = $state(false)
  let collapseSeq   = $state('')

  // Flat ordered {uuid, vaultUuid} list spanning all open vaults, matching RecordList's sort.
  // vaultUuid is null for primary vault records (selectRecord defaults to dbKey).
  let flatList = $derived.by(() => {
    function sortedEntries(items, vaultUuid) {
      let list = items
      if (pendingDeleteUUID) list = list.filter(i => i.uuid !== pendingDeleteUUID)
      if (query.trim()) {
        try {
          const matched = new Set(searchRecords(vaultUuid ?? dbKey, query, false))
          list = list.filter(i => matched.has(i.uuid))
        } catch {}
      }
      return [...list].sort((a, b) => {
        const ga = a.group || 'Ungrouped', gb = b.group || 'Ungrouped'
        const gc = ga.localeCompare(gb)
        return gc !== 0 ? gc : a.title.localeCompare(b.title)
      }).map(i => ({ uuid: i.uuid, vaultUuid }))
    }
    return [
      ...sortedEntries($dbItems, null),
      ...$secondaryVaults.flatMap(sv => sortedEntries(sv.items ?? [], sv.uuid)),
    ]
  })

  async function copyRecordField(field) {
    const value = record?.[field]
    if (value === null) {  // null = withheld sensitive value — use WASM copy
      const vaultUuid = selectedVaultUuid || dbKey
      const { token, hashBytes } = await copyFieldViaWasm(vaultUuid, selectedUUID, field)
      if (token !== null) clipboardContext.set({ token, field, uuid: selectedUUID, hash: Array.from(hashBytes) })
      return
    }
    if (!value) return
    const token = await copyToClipboard(value)
    if (token !== null) {
      const hash = Array.from(await sha256(value))
      clipboardContext.set({ token, field, uuid: selectedUUID, hash })
    }
  }

  async function copyCustomField(index) {
    const cf = record?.CustomFields?.[index]
    if (!cf) return
    if (cf.Value === null) {  // null = withheld sensitive custom field — use WASM copy
      const vaultUuid = selectedVaultUuid || dbKey
      const { token, hashBytes } = await copyCustomFieldViaWasm(vaultUuid, selectedUUID, cf.Name)
      if (token !== null) clipboardContext.set({ token, field: `custom-${index}`, uuid: selectedUUID, hash: Array.from(hashBytes) })
      return
    }
    if (!cf.Value) return
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
      if (inSearch) { searchInput?.blur(); return }
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

    if (e.key === 'ArrowDown' && !e.ctrlKey) {
      e.preventDefault()
      if (inSearch) {
        const next = flatList[0]
        if (next) { selectRecord(next.uuid, next.vaultUuid); searchInput?.blur() }
      } else {
        const idx = flatList.findIndex(i => i.uuid === selectedUUID)
        if (idx === flatList.length - 1) {
          record = null; selectedUUID = null; searchInput?.focus()
        } else {
          const next = idx === -1 ? flatList[0] : flatList[idx + 1]
          if (next) selectRecord(next.uuid, next.vaultUuid)
        }
      }
      return
    }
    if (e.key === 'ArrowUp' && !e.ctrlKey) {
      e.preventDefault()
      if (inSearch) {
        const prev = flatList[flatList.length - 1]
        if (prev) { selectRecord(prev.uuid, prev.vaultUuid); searchInput?.blur() }
      } else {
        const idx = flatList.findIndex(i => i.uuid === selectedUUID)
        if (idx === 0) {
          record = null; selectedUUID = null; searchInput?.focus()
        } else {
          const prev = idx <= 0 ? flatList[flatList.length - 1] : flatList[idx - 1]
          if (prev) selectRecord(prev.uuid, prev.vaultUuid)
        }
      }
      return
    }

    if (inSearch) return  // no other shortcuts while typing in search

    if (e.ctrlKey && e.key === 'l') { e.preventDefault(); lockAllVaults(); return }
    if (e.ctrlKey && e.key === 'ArrowUp') { e.preventDefault(); collapseSeq = 'collapse'; return }
    if (e.ctrlKey && e.key === 'ArrowDown') { e.preventDefault(); collapseSeq = 'expand'; return }
    if (e.ctrlKey && e.key === ' ') { e.preventDefault(); startNew(); return }

    if (!record) return

    if (e.ctrlKey && e.key === 'Enter') { e.preventDefault(); startEdit(); return }
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
    if (e.ctrlKey && e.key === 'e') { e.preventDefault(); copyRecordField('Email'); return }
    if (e.ctrlKey && e.key >= '1' && e.key <= '9') { e.preventDefault(); copyCustomField(parseInt(e.key) - 1); return }
  }
</script>

<svelte:window onkeydown={handleKeydown}/>

{#if secondarySetup}
  <div class="modal-overlay" role="presentation"
    onclick={e => { if (!secondarySetup.busy) secondarySetup = null; sheetOpen = true }}
    onkeydown={e => { if (e.key === 'Escape' && !secondarySetup.busy) { secondarySetup = null; sheetOpen = true } }}>
    <div class="modal" role="dialog" aria-modal="true" tabindex="-1"
      onclick={e => e.stopPropagation()} onkeydown={e => e.stopPropagation()}>
      <div class="modal-title">Unlock {secondarySetup.filename}</div>
      {#if secondarySetup.needsAuth}
        <p class="modal-desc muted">You'll need to verify your primary vault identity before adding a secondary vault.</p>
      {/if}
      {#if secondarySetup.error}
        <p class="unlock-error" style="text-align:left;margin-bottom:8px">{secondarySetup.error}</p>
      {/if}
      <div class="modal-pw">
        <input
          type={secondarySetup.showPw ? 'text' : 'password'}
          bind:value={secondarySetup.password}
          placeholder="Master password for this vault"
          disabled={secondarySetup.busy}
          onkeydown={e => { if (e.key === 'Enter') confirmSecondarySetup() }}
        />
        <button class="icon-btn-flat" onclick={() => secondarySetup = { ...secondarySetup, showPw: !secondarySetup.showPw }} aria-label="Toggle visibility">
          <Icon name={secondarySetup.showPw ? 'eye-off' : 'eye'} size={18}/>
        </button>
      </div>
      <div class="modal-actions">
        <button class="btn btn-primary" disabled={!secondarySetup.password || secondarySetup.busy} onclick={confirmSecondarySetup}>
          {secondarySetup.busy ? 'Unlocking…' : secondarySetup.needsAuth ? 'Unlock & verify identity' : 'Unlock'}
        </button>
        <button class="btn btn-ghost" disabled={secondarySetup.busy} onclick={() => { secondarySetup = null; sheetOpen = true }}>Cancel</button>
      </div>
    </div>
  </div>
{/if}

<!-- TOP BAR -->
<div class="topbar">
  <div class="topbar-left">
    <button class="vault-pill" onclick={() => sheetOpen = true}>
      <Icon name="unlock" size={16}/>
      <span>{vaultName}{secondaryCount > 0 ? ` (+${secondaryCount})` : ''}</span>
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

  <RecordList {query} {selectedUUID} {collapseSeq} excludeUUID={pendingDeleteUUID} storageKey={dbKey} primaryVaultName={vaultName} ontap={selectRecord} oncopy={copyToClipboard} oncopytotp={copyTOTPForUUID} onwasmcopyfield={copyFieldViaWasm}/>

  <!-- FAB (mobile) — hidden when all open vaults are read-only -->
  {#if !allVaultsReadonly}
    <button class="fab" onclick={startNew} aria-label="New">
      <Icon name="plus" size={22} stroke="var(--accent-on)"/>
    </button>
  {/if}

  <!-- New button (desktop, bottom of left panel) -->
  {#if isDesktop && !allVaultsReadonly}
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
        <div class="help-row"><span>Clear search / close</span><div class="help-keys"><kbd>Esc</kbd></div></div>
        <div class="help-row"><span>Navigate list</span><div class="help-keys"><kbd>↑</kbd><kbd>↓</kbd></div></div>
        <div class="help-row"><span>Copy username</span><div class="help-keys"><kbd>Ctrl</kbd><kbd>B</kbd></div></div>
        <div class="help-row"><span>Copy password</span><div class="help-keys"><kbd>Ctrl</kbd><kbd>C</kbd></div></div>
        <div class="help-row"><span>Copy one-time code</span><div class="help-keys"><kbd>Ctrl</kbd><kbd>T</kbd></div></div>
        <div class="help-row"><span>Copy URL</span><div class="help-keys"><kbd>Ctrl</kbd><kbd>U</kbd></div></div>
        <div class="help-row"><span>Visit URL</span><div class="help-keys"><kbd>↵</kbd></div></div>
        <div class="help-row"><span>Copy email</span><div class="help-keys"><kbd>Ctrl</kbd><kbd>E</kbd></div></div>
        <div class="help-row"><span>Copy custom field 1–9</span><div class="help-keys"><kbd>Ctrl</kbd><kbd>1–9</kbd></div></div>
        <div class="help-row"><span>Edit entry</span><div class="help-keys"><kbd>Ctrl</kbd><kbd>↵</kbd></div></div>
        <div class="help-row"><span>New entry</span><div class="help-keys"><kbd>Ctrl</kbd><kbd>Space</kbd></div></div>
        <div class="help-row"><span>Collapse groups</span><div class="help-keys"><kbd>Ctrl</kbd><kbd>↑</kbd></div></div>
        <div class="help-row"><span>Expand groups</span><div class="help-keys"><kbd>Ctrl</kbd><kbd>↓</kbd></div></div>
        <div class="help-row"><span>Lock all vaults</span><div class="help-keys"><kbd>Ctrl</kbd><kbd>L</kbd></div></div>
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
      onlockall={lockAllVaults}
      onlocksecondary={lockSecondaryVault}
      onunlockadditional={unlockAdditionalVault}
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
      vaultUuid={isNew ? (newRecordVaultUuid || dbKey) : (selectedVaultUuid || dbKey)}
      {rwVaults}
      onvaultchange={(uuid) => newRecordVaultUuid = uuid}
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
        vaultUuid={selectedVaultUuid || dbKey}
        onback={() => { record = null; selectedUUID = null; selectedVaultUuid = null }}
        onedit={($secondaryVaults.find(v => v.uuid === selectedVaultUuid)?.readonly ?? $selectedFile?.readonly) ? null : startEdit}
        oncopy={copyToClipboard}
        oncopytotp={copyTOTPForUUID}
        onwasmcopyfield={copyFieldViaWasm}
        onwasmcopycustomfield={copyCustomFieldViaWasm}
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
          {#if secondaryCount > 0}
            <div class="empty-stat">
              <span class="empty-num">{1 + secondaryCount}</span>
              <span class="empty-label muted">vaults</span>
            </div>
            <div class="empty-divider"></div>
          {/if}
          {#if groupCount > 0}
            <div class="empty-stat">
              <span class="empty-num">{groupCount}</span>
              <span class="empty-label muted">groups</span>
            </div>
            <div class="empty-divider"></div>
          {/if}
          <div class="empty-stat">
            <span class="empty-num">{passwordCount}</span>
            <span class="empty-label muted">passwords</span>
          </div>
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
