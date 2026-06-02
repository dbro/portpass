<script>
  import { onMount, untrack } from 'svelte'
  import { get } from 'svelte/store'
  import { selectedFile, dbItems, secondaryVaults, toast, clipboardSession, clipboardContext, switchboardUrl, switchboardConnected, crossProfileEnabled, delegatesVersion } from '../store.js'
  import {
    openDatabase,
    getRecordData, getDatabaseData, saveDatabase, getDatabaseInfo,
    updateRecordFields, updateDBFields, deleteRecord as wasmDeleteRecord,
    searchRecords, searchRecordResults, closeDatabase, loadVaultFile,
    copyFieldToClipboard, copyCustomFieldToClipboard, copyTOTP as wasmCopyTOTP,
    getTOTP, getFieldValue, getCustomFieldValue,
  } from '../wasm.js'
  import { addSecondaryCredential, updateSecondaryHandle, removeSecondaryCredential } from './secondaryVaults.js'
  import { getSwitchboardUrl, getCrossProfileEnabled } from './delegates.js'
  import { isBiometricEnrolledForFile, unlockWithBiometric } from './biometric.js'
  import { getDelegates, verifyDelegateById, recordFill } from './delegates.js'
  import Icon from './Icon.svelte'
  import RecordList from './RecordList.svelte'
  import RecordRead from './RecordRead.svelte'
  import RecordEdit from './RecordEdit.svelte'
  import VaultSheet from './VaultSheet.svelte'

  let { onclosed, isPopup = false, theme, accent, isDesktop, bookmarkletsSupported = false, ontheme, onaccent, intent = null, onclearintent } = $props()

  const supportsFilePicker = typeof window !== 'undefined' && typeof window.showOpenFilePicker === 'function'
  const supportsSaveAs     = typeof window !== 'undefined' && typeof window.showSaveFilePicker === 'function'

  function focusOnMount(node) {
    if (passwordCount > 0) setTimeout(() => node.focus(), 0)
  }

  let query                  = $state('')
  let debouncedQuery         = $state('')
  let _debounceTimer
  $effect(() => { const q = query; clearTimeout(_debounceTimer); _debounceTimer = setTimeout(() => { debouncedQuery = q }, 150) })
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
  let dbKey        = $state('')
  let lastSave     = $state('')
  let hasDelegates = $state(false)
  let searchWasActive = false
  let preSearchSelection = null
  let autofillNearMatchKeys = $state(null)
  let autofillNearMatchUrl = $state('')

  $effect(() => {
    void $delegatesVersion
    if (dbKey) getDelegates(dbKey).then(d => { hasDelegates = d.length > 0 })
  })

  let passwordCount = $derived(
    $dbItems.length + $secondaryVaults.reduce((n, v) => n + (v.items?.length ?? 0), 0)
  )
  let groupCount = $derived(
    new Set($dbItems.map(i => i.group).filter(Boolean)).size
    + $secondaryVaults.reduce((n, v) => n + new Set(v.items?.map(i => i.group).filter(Boolean)).size, 0)
  )
  let secondaryCount    = $derived($secondaryVaults.length)
  // True when the vault being edited/created is readonly (primary or secondary)
  let editVaultReadonly = $derived(
    isNew
      ? !!$selectedFile?.readonly && (!newRecordVaultUuid || newRecordVaultUuid === dbKey)
      : selectedVaultUuid
        ? !!($secondaryVaults.find(v => v.uuid === selectedVaultUuid)?.readonly)
        : !!$selectedFile?.readonly
  )

  // Tracked file modification timestamps — detect external changes before saving.
  // Kept outside $state; these are write-guards, not reactive UI state.
  let primaryModified = null   // lastModified of the primary vault file
  let secondaryModified = {}   // keyed by vault UUID
  // B1–B4 + IV (bytes 72–151) of the last write: Twofish-encrypted blocks of freshly
  // randomised keys plus the CBC IV, all re-randomised on every Encrypt() call.
  // Read from the unencrypted header with no decryption needed. Used to confirm a
  // lastModified mismatch is a real conflict and not just a cloud provider updating
  // the timestamp after upload sync.
  let primaryHead = null       // Uint8Array(80)
  let secondaryHead = {}       // keyed by vault UUID

  function sameHead(a, b) {
    if (!a || !b || a.length !== b.length) return false
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
    return true
  }

  // State for the "unlock additional vault" modal flow.
  // handle is kept outside $state to prevent Svelte 5 from deep-proxying the FileSystemFileHandle.
  let _secondaryHandle = null
  let _secondaryFallbackFile = null  // File object when showOpenFilePicker isn't available
  let secondaryFileInputEl = $state(null)
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
    const h = get(selectedFile)?.handle
    if (h) h.getFile().then(f => { primaryModified = f.lastModified }).catch(() => {})
    for (const sv of get(secondaryVaults)) {
      if (sv.handle) {
        const uuid = sv.uuid
        sv.handle.getFile().then(f => { secondaryModified[uuid] = f.lastModified }).catch(() => {})
      }
    }
    getSwitchboardUrl(dbKey).then(url => switchboardUrl.set(url)).catch(() => {})
    getCrossProfileEnabled(dbKey).then(v => crossProfileEnabled.set(v)).catch(() => {})
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

  // ---------------------------------------------------------------------------
  // Autofill utilities
  // ---------------------------------------------------------------------------

  // Mirror of Go's CanonicalURL: parse authority, then strip scheme, userinfo, www.,
  // query, fragment, and trailing slash.
  function canonicalURL(href) {
    const s = (href || '').trim()
    if (!s) return ''
    try {
      const parsed = new URL(s.includes('://') ? s : `https://${s}`)
      return (parsed.host.replace(/^www\./i, '') + parsed.pathname).toLowerCase().replace(/\/+$/, '')
    } catch {
      return ''
    }
  }

  function autofillURL(href) {
    const s = (href || '').trim()
    if (!s) return null
    try { return new URL(s.includes('://') ? s : `https://${s}`) }
    catch { return null }
  }

  function autofillOrigin(href) {
    return autofillURL(href)?.origin || ''
  }

  function autofillAuthorizeRecord(uuid, vaultUuid, destinationUrl, allowOriginOverride = false) {
    const rec = getRecordData(vaultUuid || dbKey, uuid)
    const saved = autofillURL(rec.URL || '')
    const destination = autofillURL(destinationUrl || '')
    if (!destination) throw new Error('Autofill destination could not be verified')
    if (destination.protocol !== 'https:') throw new Error('Passwords are only autofilled on HTTPS pages')
    if (!saved) {
      if (!allowOriginOverride) throw new Error('Fill requires confirmation for a different website')
      return rec
    }
    if (saved.protocol === 'https:' && destination.protocol !== 'https:')
      throw new Error('Passwords saved for HTTPS cannot be filled on HTTP pages')
    if (saved.origin !== destination.origin && !allowOriginOverride)
      throw new Error('Fill requires confirmation for a different website')
    return rec
  }

  function levenshtein(a, b) {
    const m = a.length, n = b.length
    const dp = Array.from({length: m + 1}, (_, i) =>
      Array.from({length: n + 1}, (_, j) => i ? (j ? 0 : i) : j))
    for (let i = 1; i <= m; i++)
      for (let j = 1; j <= n; j++)
        dp[i][j] = a[i-1] === b[j-1] ? dp[i-1][j-1]
          : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1])
    return dp[m][n]
  }

  // Search all open vaults for URL-matching records. Returns a list suitable for
  // the bookmarklet picker: exact URL matches first, then Levenshtein suggestions
  // (≤5 distance, up to 5 results). Each entry: { uuid, vaultUuid, title, existingUrl, isCurrent }.
  function autofillFindRecords(queryUrl) {
    const canonical = canonicalURL(queryUrl)
    if (!canonical) return []
    const allVaults = [
      { uuid: dbKey, items: get(dbItems), readonly: get(selectedFile)?.readonly || false },
      ...get(secondaryVaults).map(v => ({ uuid: v.uuid, items: v.items || [], readonly: v.readonly || false })),
    ]

    // Build a uuid→readonly lookup for the selected-record case below.
    const roMap = {}
    for (const v of allVaults) roMap[v.uuid] = v.readonly

    // Exact URL match (mode 2)
    const exact = []
    for (const { uuid: vaultUuid, readonly } of allVaults) {
      try {
        for (const uuid of searchRecords(vaultUuid, canonical, 2)) {
          const rec = getRecordData(vaultUuid, uuid)
          exact.push({ uuid, vaultUuid: vaultUuid === dbKey ? null : vaultUuid,
            title: rec.Title, existingUrl: rec.URL, isCurrent: uuid === selectedUUID,
            matchType: 'exact', readonly })
        }
      } catch {}
    }
    if (exact.length) return exact

    // Fuzzy fallback: Levenshtein on hostname, up to 5 suggestions ≤ distance 5
    const queryHost = canonical.split('/')[0]
    const candidates = []

    if (selectedUUID && record) {
      const svUuid = selectedVaultUuid || dbKey
      candidates.push({ uuid: selectedUUID, vaultUuid: selectedVaultUuid,
        title: record.Title, existingUrl: record.URL, isCurrent: true, matchType: 'current',
        readonly: roMap[svUuid] || false, _d: -1 })
    }

    for (const { uuid: vaultUuid, items, readonly } of allVaults) {
      for (const item of items) {
        if (item.uuid === selectedUUID) continue
        const itemHost = canonicalURL(item.url || '').split('/')[0]
        if (!itemHost) continue
        const d = levenshtein(queryHost, itemHost)
        if (d <= 5)
          candidates.push({ uuid: item.uuid, vaultUuid: vaultUuid === dbKey ? null : vaultUuid,
            title: item.title, existingUrl: item.url, isCurrent: false, matchType: 'fuzzy',
            readonly, _d: d })
      }
    }

    return candidates.sort((a, b) => a._d - b._d).slice(0, 5)
      .map(({ _d, ...rest }) => rest)
  }

  function autofillRecordMeta(uuid, vaultUuid) {
    const v = vaultUuid || dbKey
    const rec = getRecordData(v, uuid)
    const autotype = rec.Autotype || '\\u\\t\\p\\n'
    const parseErr = autofillValidateSequence(autotype)
    if (parseErr) throw new Error(`Could not parse autofill sequence: ${autotype}`)
    return {
      title: rec.Title, autotype,
      fields: [
        rec.Username ? { code: 'u', label: 'Username', value: rec.Username } : null,
        rec.Password !== '' && rec.Password !== undefined ? { code: 'p', label: 'Password', sensitive: true } : null,
        rec.Email ? { code: 'm', label: 'Email', value: rec.Email } : null,
        rec.TwoFactorKey !== undefined ? { code: '2', label: 'One-time code', sensitive: true } : null,
        ...(rec.CustomFields || []).slice(0, 9).filter(cf => cf.Value !== '').map(cf => ({
          code: `v{${cf.Name}}`, label: cf.Name, sensitive: !!cf.Sensitive,
          ...(cf.Sensitive ? {} : { value: cf.Value }),
        })),
        rec.Notes !== '' && rec.Notes !== undefined ? { code: 'notes', label: 'Notes', sensitive: true, notes: true } : null,
      ].filter(Boolean),
    }
  }

  function autofillFieldValue(uuid, vaultUuid, code) {
    const v = vaultUuid || dbKey
    const rec = getRecordData(v, uuid)
    if (code === 'u') return rec.Username ?? ''
    if (code === 'p') return getFieldValue(v, uuid, 'Password') ?? ''
    if (code === 'm') return rec.Email ?? ''
    if (code === '2') return getTOTP(v, uuid).code ?? ''
    if (code === 'notes') return getFieldValue(v, uuid, 'Notes') ?? ''
    const customFieldMatch = /^v\{([^}]*)\}$/.exec(code)
    if (customFieldMatch) {
      const cf = rec.CustomFields?.find(cf => cf.Name === customFieldMatch[1])
      return cf ? (cf.Value !== null ? cf.Value : (getCustomFieldValue(v, uuid, cf.Name) ?? '')) : ''
    }
    return ''
  }

  function autofillFieldData(uuid, vaultUuid, code) {
    if (code === '2') {
      const data = getTOTP(vaultUuid || dbKey, uuid)
      return { value: data.code ?? '', seconds: data.seconds, period: data.period }
    }
    return { value: autofillFieldValue(uuid, vaultUuid, code) }
  }

  async function autofillEncryptData(sessionKey, data) {
    const iv = crypto.getRandomValues(new Uint8Array(12))
    const pt = new TextEncoder().encode(JSON.stringify(data))
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, sessionKey, pt)
    return {
      iv: btoa(String.fromCharCode(...iv)),
      ciphertext: btoa(String.fromCharCode(...new Uint8Array(ct))),
    }
  }

  function autofillStageURL(uuid, vaultUuid, newUrl) {
    const v = vaultUuid || dbKey
    const readonly = vaultUuid
      ? !!get(secondaryVaults).find(s => s.uuid === vaultUuid)?.readonly
      : !!get(selectedFile)?.readonly
    if (readonly) throw new Error('This vault is read-only')
    const destination = autofillURL(newUrl)
    if (!destination || destination.protocol !== 'https:')
      throw new Error('Autofill destination could not be verified')
    loadRecordSelection(uuid, vaultUuid || null)
    record = { ...getRecordData(v, uuid), URL: destination.origin + destination.pathname }
    sheetOpen = false
    vaultDirty = false
    isNew = false
    isEditing = true
  }

  // ── Cross-profile autofill intent handler ────────────────────────────────

  // Encrypt data with the autofill popup's ECDH public key and send as a ws-relay reply.
  async function sha256B64(bytes) {
    const digest = await crypto.subtle.digest('SHA-256', bytes)
    return btoa(String.fromCharCode(...new Uint8Array(digest)))
  }

  async function sbEncryptReply(replyTo, ecdhSpkiB64Arg, data, meta = {}) {
    const ephPair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveKey'])
    const relayPub = await crypto.subtle.importKey('spki', Uint8Array.from(atob(ecdhSpkiB64Arg), c => c.charCodeAt(0)), { name: 'ECDH', namedCurve: 'P-256' }, false, [])
    const sk = await crypto.subtle.deriveKey({ name: 'ECDH', public: relayPub }, ephPair.privateKey, { name: 'AES-GCM', length: 256 }, false, ['encrypt'])
    const iv = crypto.getRandomValues(new Uint8Array(12))
    const envelope = {
      v: 1,
      requestId: replyTo,
      requestHash: meta.requestHash || null,
      delegateId: meta.delegateId || null,
      recipient: meta.recipient || 'autofill-popup',
      ts: Date.now(),
      data,
    }
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, sk, new TextEncoder().encode(JSON.stringify(envelope)))
    const ephPubJwk = await crypto.subtle.exportKey('jwk', ephPair.publicKey)
    if (_sbWs) _sbWs.send(JSON.stringify({
      type: 'reply', replyTo,
      ephPub: btoa(JSON.stringify(ephPubJwk)),
      iv: btoa(String.fromCharCode(...iv)),
      ciphertext: btoa(String.fromCharCode(...new Uint8Array(ct))),
    }))
  }

  async function processAutofillIntent({ url, nonce, ecdhSpkiB64 }) {
    const records = autofillFindRecords(url)
    try {
      // Return only metadata — credentials fetched separately via fill-uuid when user selects a record.
      await sbEncryptReply(nonce, ecdhSpkiB64, {
        records: records.map(r => ({
          uuid: r.uuid, vaultUuid: r.vaultUuid, title: r.title,
          matchType: r.matchType, isCurrent: r.isCurrent, existingUrl: r.existingUrl,
          readonly: r.readonly,
        })),
        theme:  localStorage.getItem('theme')  || 'dark',
        accent: localStorage.getItem('accent') || 'amber',
      })
    } catch(e) {
      if (_sbWs) _sbWs.send(JSON.stringify({ type: 'reply', replyTo: nonce, error: e.message || 'Autofill failed' }))
    }
  }

  $effect(() => {
    if (!intent) return
    onclearintent?.()
    processAutofillIntent(intent)
  })

  // ── Switchboard WebSocket (cross-profile autofill) ─────────────────────────
  // autofill.html connects to the switchboard and sends a signed request;
  // the switchboard routes it here via WebSocket. No polling.

  let _sbWs = null
  let _sbConnecting = false
  const sbSeenNonces = new Set()
  const bcSeenNonces = new Set()

  function rememberNonce(seen, nonce) {
    if (!nonce || seen.has(nonce)) return false
    seen.add(nonce)
    setTimeout(() => seen.delete(nonce), 120000)
    return true
  }

  function sbWsUrl() {
    // Accept both ws:// and http:// stored formats
    return get(switchboardUrl).replace(/^http/, 'ws').replace(/\/ws$/, '') + '/ws'
  }

  async function connectSwitchboard() {
    if (_sbWs || _sbConnecting) return
    if (!get(crossProfileEnabled)) return
    _sbConnecting = true
    if (_sbWs) { _sbConnecting = false; return }  // connected while we awaited
    let ws
    try { ws = new WebSocket(sbWsUrl()) } catch { _sbConnecting = false; return }
    ws.onopen = () => {
      _sbWs = ws
      _sbConnecting = false
      switchboardConnected.set(true)
      if (_sbWs === ws)
        ws.send(JSON.stringify({ type: 'subscribe', channels: ['portpass-autofill'] }))
    }
    ws.onmessage = async (event) => {
      try {
        const msg = JSON.parse(event.data)
        if (msg._switchboard_origin !== location.origin) return
        if (msg.type !== 'publish') return
        const age = Date.now() - msg.ts
        if (age > 60000 || age < -5000) return
        const sigBytes  = Uint8Array.from(atob(msg.sig), c => c.charCodeAt(0))
        if (!rememberNonce(sbSeenNonces, msg.replyTo)) return
        const message   = new TextEncoder().encode(JSON.stringify({ version: 1, sender: msg.delegateId || '', recipient: 'local-dashboard', url: msg.url || '', nonce: msg.replyTo, ecdh: msg.ecdh || '', ts: msg.ts,
          msgType: msg.msgType || '', uuid: msg.uuid || '', vaultUuid: msg.vaultUuid || '', query: msg.query || '' }))
        const requestHash = await sha256B64(message)
        const verified  = await verifyDelegateById(dbKey, msg.delegateId || '', message, sigBytes)
        if (!verified) return
        if (msg.msgType === 'fill-done') {
          await recordFill(dbKey, verified.id, 'relay')
          delegatesVersion.update(v => v + 1)
          if (_sbWs) _sbWs.send(JSON.stringify({ type: 'reply', replyTo: msg.replyTo }))
          return
        }
        if (msg.msgType === 'view-record') {
          if (msg.uuid) selectRecord(msg.uuid, msg.vaultUuid || null)
          if (_sbWs) _sbWs.send(JSON.stringify({ type: 'reply', replyTo: msg.replyTo }))
          return
        }
        if (msg.msgType === 'view-near-matches') {
          showAutofillNearMatches(msg.url || '')
          if (_sbWs) _sbWs.send(JSON.stringify({ type: 'reply', replyTo: msg.replyTo }))
          return
        }
        if (msg.msgType === 'search') {
          try { await sbEncryptReply(msg.replyTo, msg.ecdh, [], { delegateId: verified.id, requestHash }) } catch {}
          return
        }
        if (msg.msgType === 'fill-uuid') {
          try {
            const rec = getRecordData(msg.vaultUuid || dbKey, msg.uuid)
            const savedUrl = canonicalURL(rec.URL || '')
            if (!savedUrl || savedUrl !== canonicalURL(msg.url || '')) {
              if (_sbWs) _sbWs.send(JSON.stringify({ type: 'reply', replyTo: msg.replyTo, error: 'Credentials require an exact saved URL match' }))
              return
            }
            const meta = autofillRecordMeta(msg.uuid, msg.vaultUuid || null)
            await sbEncryptReply(msg.replyTo, msg.ecdh, [{
              uuid: msg.uuid, vaultUuid: msg.vaultUuid || null,
              title: rec.Title, matchType: 'search', existingUrl: rec.URL || '',
              autotype: meta.autotype, fields: meta.fields,
            }], { delegateId: verified.id, requestHash })
          } catch(e) {
            if (_sbWs) _sbWs.send(JSON.stringify({ type: 'reply', replyTo: msg.replyTo, error: e.message || 'Could not get credentials' }))
          }
          return
        }
        if (msg.msgType === 'field-value') {
          try {
            const rec = getRecordData(msg.vaultUuid || dbKey, msg.uuid)
            const savedUrl = canonicalURL(rec.URL || '')
            if (!savedUrl || savedUrl !== canonicalURL(msg.url || '')) {
              if (_sbWs) _sbWs.send(JSON.stringify({ type: 'reply', replyTo: msg.replyTo, error: 'Credentials require an exact saved URL match' }))
              return
            }
            await sbEncryptReply(msg.replyTo, msg.ecdh, {
              code: msg.query || '', ...autofillFieldData(msg.uuid, msg.vaultUuid || null, msg.query || ''),
            }, { delegateId: verified.id, requestHash })
          } catch(e) {
            if (_sbWs) _sbWs.send(JSON.stringify({ type: 'reply', replyTo: msg.replyTo, error: e.message || 'Could not get field value' }))
          }
          return
        }
        const records = autofillFindRecords(msg.url)
        const exact = records.filter(r => r.matchType === 'exact')
        const payload = exact.length
          ? { records: exact, theme: localStorage.getItem('theme') || 'dark', accent: localStorage.getItem('accent') || 'amber' }
          : { records: [], nearMatchCount: records.length, theme: localStorage.getItem('theme') || 'dark', accent: localStorage.getItem('accent') || 'amber' }
        await sbEncryptReply(msg.replyTo, msg.ecdh, payload, { delegateId: verified.id, requestHash })
      } catch(e) {}
    }
    let closed = false
    ws.onclose = ws.onerror = () => {
      if (closed) return
      closed = true
      if (_sbWs === ws) { _sbWs = null; switchboardConnected.set(false) }
      _sbConnecting = false
      setTimeout(connectSwitchboard, 2000)
    }
  }

  $effect(() => {
    if (isPopup) return
    const _url = $switchboardUrl       // re-connect when URL changes
    const _en  = $crossProfileEnabled  // re-connect when toggled on
    if (_sbWs) { _sbWs.close(); _sbWs = null }
    _sbConnecting = false
    connectSwitchboard()
    return () => { if (_sbWs) { _sbWs.close(); _sbWs = null }; _sbConnecting = false; switchboardConnected.set(false) }
  })

  // Autofill postMessage handler — ECDH key exchange then encrypted query response.
  function autofillValidateSequence(seq) {
    if (!seq) return ''
    let i = 0
    while (i < seq.length) {
      if (seq[i] !== '\\') { i++; continue }
      if (i + 1 >= seq.length) return 'Sequence ends with \\'
      const code = seq[i + 1]
      if (code === 'v') {
        if (seq[i + 2] !== '{') return '\\v must be followed by {custom field name}'
        const end = seq.indexOf('}', i + 3)
        if (end < 0) return '\\v{custom field name} must end with }'
        i = end + 1
      } else if (code === 'w' || code === 'W') {
        let j = i + 2, count = 0
        while (j < seq.length && count < 3 && /^[0-9]$/.test(seq[j])) { j++; count++ }
        if (count === 0) return `\\${code} must be followed by 1–3 digits`
        i = j
      } else {
        i += 2  // known and unknown codes advance; unknown silently skipped at fill time
      }
    }
    return ''
  }

  // BroadcastChannel handler — lets the autofill popup (opened by the bookmarklet) reach this
  // unlocked tab across browsing-context-group boundaries. Only the main (non-popup) tab
  // handles these messages so the popup's own dashboard (when unlocked directly) is unaffected.
  $effect(() => {
    if (isPopup) return

    const ch = new BroadcastChannel('portpass-autofill')
    let sessionKey = null
    let helloInProgress = false
    let bcSessionDelegateId = null

    ch.onmessage = async event => {
      const msg = event.data
      if (!msg?.type) return

      if (msg.type === 'ping') {
        ch.postMessage({ type: 'pong', nonce: msg.nonce })
        return
      }

      if (msg.type === 'fill-done') {
        if (bcSessionDelegateId) {
          await recordFill(dbKey, bcSessionDelegateId, 'bc')
          delegatesVersion.update(v => v + 1)
        }
        return
      }

      if (msg.type === 'hello') {
        if (helloInProgress) return
        helloInProgress = true
        try {
          // Verify ECDSA signature to authenticate the delegate bookmarklet.
          // Closes the masquerade attack: a content script cannot forge this.
          if (!msg.sig || !msg.pub || !msg.ecdhSpki) {
            ch.postMessage({ type: 'error', message: 'Autofill request not authorized — reinstall the bookmarklet', nonce: msg.nonce })
            return
          }
          const sigBytes  = Uint8Array.from(atob(msg.sig),  c => c.charCodeAt(0))
          const age = Date.now() - (msg.ts || 0)
          if (age > 60000 || age < -5000 || !rememberNonce(bcSeenNonces, msg.nonce)) {
            ch.postMessage({ type: 'error', message: 'Autofill request expired — click the bookmarklet again', nonce: msg.nonce })
            return
          }
          const sigMsg    = new TextEncoder().encode(JSON.stringify({ version: 1, sender: msg.delegateId || '', recipient: 'local-dashboard', nonce: msg.nonce, ecdhSpki: msg.ecdhSpki, ts: msg.ts }))
          const verified  = await verifyDelegateById(dbKey, msg.delegateId || '', sigMsg, sigBytes)
          if (!verified) {
            ch.postMessage({ type: 'error', message: 'Autofill request not authorized', nonce: msg.nonce })
            return
          }
          bcSessionDelegateId = verified.id
          const ecdhSpkiBytes = Uint8Array.from(atob(msg.ecdhSpki), c => c.charCodeAt(0))
          const openerPub = await crypto.subtle.importKey(
            'spki', ecdhSpkiBytes, { name: 'ECDH', namedCurve: 'P-256' }, false, []
          )
          const pair = await crypto.subtle.generateKey(
            { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveKey']
          )
          sessionKey = await crypto.subtle.deriveKey(
            { name: 'ECDH', public: openerPub }, pair.privateKey,
            { name: 'AES-GCM', length: 256 }, false, ['encrypt']
          )
          const pubJwk = await crypto.subtle.exportKey('jwk', pair.publicKey)
          ch.postMessage({ type: 'hello-response', pubkey: pubJwk, nonce: msg.nonce })
        } catch {
          sessionKey = null
          ch.postMessage({ type: 'error', message: 'Key exchange failed', nonce: msg.nonce })
        } finally {
          helloInProgress = false
        }
        return
      }

      if (msg.type === 'query') {
        if (!sessionKey) {
          ch.postMessage({ type: 'error', message: 'No secure session — click the bookmarklet again', nonce: msg.nonce })
          return
        }

        // URL search
        if (msg.url !== undefined && !msg.uuid) {
          ch.postMessage({ type: 'records', records: autofillFindRecords(msg.url), nonce: msg.nonce, theme: localStorage.getItem('theme') || 'dark', accent: localStorage.getItem('accent') || 'amber' })
          return
        }

        // Targeted record metadata fetch
        const uuid = msg.uuid || selectedUUID
        const vaultUuid = msg.uuid ? (msg.vaultUuid || null) : selectedVaultUuid
        if (!uuid) {
          ch.postMessage({ type: 'error', message: 'Open a record in Portpass first', nonce: msg.nonce })
          return
        }
        try {
          autofillAuthorizeRecord(uuid, vaultUuid, msg.url, !!msg.allowOriginOverride)
          const result = await autofillEncryptData(sessionKey, autofillRecordMeta(uuid, vaultUuid))
          ch.postMessage({ type: 'record', ...result, nonce: msg.nonce })
        } catch (e) {
          ch.postMessage({ type: 'error', message: e.message, nonce: msg.nonce })
        }
        return
      }

      if (msg.type === 'field-value') {
        if (!sessionKey) {
          ch.postMessage({ type: 'error', message: 'No secure session', nonce: msg.nonce })
          return
        }
        try {
          autofillAuthorizeRecord(msg.uuid, msg.vaultUuid || null, msg.url, !!msg.allowOriginOverride)
          const result = await autofillEncryptData(sessionKey, {
            code: msg.code || '', ...autofillFieldData(msg.uuid, msg.vaultUuid || null, msg.code || ''),
          })
          ch.postMessage({ type: 'field-value', ...result, nonce: msg.nonce })
        } catch (e) {
          ch.postMessage({ type: 'error', message: e.message, nonce: msg.nonce })
        }
        return
      }

      if (msg.type === 'stage-url') {
        if (!sessionKey) {
          ch.postMessage({ type: 'error', message: 'No secure session', nonce: msg.nonce })
          return
        }
        try {
          autofillStageURL(msg.uuid, msg.vaultUuid || null, msg.url)
          ch.postMessage({ type: 'url-staged', nonce: msg.nonce })
        } catch (e) {
          ch.postMessage({ type: 'error', message: e.message, nonce: msg.nonce })
        }
      }

      if (msg.type === 'view-record') {
        if (msg.uuid) selectRecord(msg.uuid, msg.vaultUuid || null)
      }

      if (msg.type === 'search') {
        if (!sessionKey) {
          ch.postMessage({ type: 'error', message: 'No secure session', nonce: msg.nonce })
          return
        }
        const allVaults = [
          { uuid: dbKey, readonly: get(selectedFile)?.readonly || false },
          ...get(secondaryVaults).map(v => ({ uuid: v.uuid, readonly: v.readonly || false })),
        ]
        const results = []
        for (const { uuid: vaultUuid, readonly } of allVaults) {
          try {
            for (const recUuid of searchRecords(vaultUuid, msg.query || '', 0)) {
              const rec = getRecordData(vaultUuid, recUuid)
              results.push({ uuid: recUuid,
                vaultUuid: vaultUuid === dbKey ? null : vaultUuid,
                title: rec.Title, existingUrl: rec.URL || '',
                matchType: 'search', readonly })
            }
          } catch {}
        }
        ch.postMessage({ type: 'search-results', records: results, nonce: msg.nonce })
      }
    }

    return () => ch.close()
  })

  // Load a record by UUID. vaultUuid is null for primary vault records.
  function loadRecordSelection(uuid, vaultUuid = null) {
    if (!uuid) {
      record = null
      selectedUUID = null
      selectedVaultUuid = null
      return
    }
    record = getRecordData(vaultUuid || dbKey, uuid)
    selectedUUID = uuid
    selectedVaultUuid = vaultUuid
  }

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
      loadRecordSelection(uuid, vaultUuid)
    } catch (e) {
      console.error(e)
      showToast('Could not load record.')
    }
  }

  function autofillRecordKey(uuid, vaultUuid = null) {
    return `${vaultUuid || ''}:${uuid}`
  }

  function clearAutofillNearMatches() {
    autofillNearMatchKeys = null
    autofillNearMatchUrl = ''
  }

  function showAutofillNearMatches(url) {
    if ((isEditing && editDirty) || (sheetOpen && vaultDirty)) {
      showToast('Finish editing before showing autofill near matches.')
      return
    }
    const matches = autofillFindRecords(url).filter(r => r.matchType !== 'exact')
    autofillNearMatchKeys = matches.map(r => autofillRecordKey(r.uuid, r.vaultUuid))
    autofillNearMatchUrl = canonicalURL(url)
    query = ''
    clearTimeout(_debounceTimer)
    debouncedQuery = ''
    sheetOpen = false
    vaultDirty = false
    isEditing = false
    isNew = false
    editDirty = false
    loadRecordSelection(null)
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

  // Save a secondary vault when it has no writable handle (Save As picker or iOS download).
  // Updates secondaryVaults state and stored credentials on success. Throws on abort/error.
  async function saveSecondaryAs(sv, data) {
    if (supportsSaveAs) {
      const handle = await window.showSaveFilePicker({
        suggestedName: sv.filename ?? 'vault.psafe3',
        types: [{ description: 'Password Safe', accept: { 'application/octet-stream': ['.psafe3', '.dat'] } }],
      })
      const w = await handle.createWritable()
      await w.write(data)
      await w.close()
      const filename = handle.name
      secondaryVaults.update(vs => vs.map(v => v.uuid === sv.uuid
        ? { ...v, handle, filename, readonly: false }
        : v
      ))
      secondaryHead[sv.uuid] = data.slice(72, 152)
      try { secondaryModified[sv.uuid] = (await handle.getFile()).lastModified } catch {}
      try { await updateSecondaryHandle(dbKey, sv.uuid, filename, handle) } catch {}
      showToast('Saved to ' + (sv.name || filename), null, 2000)
    } else {
      const fname = sv.filename ?? 'vault'
      const download = fname.endsWith('.psafe3') || fname.endsWith('.dat') ? fname : fname + '.psafe3'
      const blob = new Blob([data], { type: 'application/octet-stream' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = download
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      showToast('Vault downloaded', null, 2000)
    }
  }

  async function checkPrimaryConflict() {
    const handle = $selectedFile?.handle
    if (!handle || primaryModified === null) return true
    try {
      const file = await handle.getFile()
      if (file.lastModified !== primaryModified) {
        let realConflict = true
        if (primaryHead) {
          try {
            const buf = await file.slice(72, 152).arrayBuffer()
            realConflict = !sameHead(new Uint8Array(buf), primaryHead)
          } catch {}
        }
        if (realConflict) {
          if (!confirm('This vault was modified since it was loaded.\n\nSaving will overwrite those changes. Save anyway?')) return false
          primaryModified = file.lastModified
        }
      }
    } catch {}
    return true
  }

  async function saveRecord(draft) {
    try {
      const targetVault = isNew ? (newRecordVaultUuid || dbKey) : (selectedVaultUuid || dbKey)

      if (targetVault === dbKey) {
        if (!await checkPrimaryConflict()) return
      } else {
        const sv = get(secondaryVaults).find(v => v.uuid === targetVault)
        if (sv?.handle && !sv.readonly && secondaryModified[targetVault] !== undefined) {
          try {
            const file = await sv.handle.getFile()
            if (file.lastModified !== secondaryModified[targetVault]) {
              let realConflict = true
              if (secondaryHead[targetVault]) {
                try {
                  const buf = await file.slice(72, 152).arrayBuffer()
                  realConflict = !sameHead(new Uint8Array(buf), secondaryHead[targetVault])
                } catch {}
              }
              if (realConflict && !confirm(`"${sv.name || sv.filename}" was modified since it was loaded.\n\nSaving will overwrite those changes. Save anyway?`)) return
            }
          } catch {}
        }
      }

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
          if (sv.handle && !sv.readonly) {
            const w = await sv.handle.createWritable()
            await w.write(data)
            await w.close()
            secondaryHead[targetVault] = data.slice(72, 152)
            try { secondaryModified[targetVault] = (await sv.handle.getFile()).lastModified } catch {}
            showToast('Saved to ' + (sv.name || sv.filename), null, 2000)
          } else {
            await saveSecondaryAs(sv, data)
          }
        }
      }
    } catch (e) {
      if (e.name !== 'AbortError') showToast('Failed to save: ' + e.message)
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
          if (targetVault === dbKey) {
            if (!await checkPrimaryConflict()) return
            wasmDeleteRecord(targetVault, pendingDeleteUUID)
            dbItems.set(getDatabaseData(dbKey))
            isDirty = true
            await saveFile(true)
          } else {
            const sv = get(secondaryVaults).find(v => v.uuid === targetVault)
            if (sv) {
              if (sv.handle && !sv.readonly && secondaryModified[targetVault] !== undefined) {
                try {
                  const file = await sv.handle.getFile()
                  if (file.lastModified !== secondaryModified[targetVault]) {
                    let realConflict = true
                    if (secondaryHead[targetVault]) {
                      try {
                        const buf = await file.slice(72, 152).arrayBuffer()
                        realConflict = !sameHead(new Uint8Array(buf), secondaryHead[targetVault])
                      } catch {}
                    }
                    if (realConflict && !confirm(`"${sv.name || sv.filename}" was modified since it was loaded.\n\nSaving will overwrite those changes. Save anyway?`)) return
                  }
                } catch {}
              }
              wasmDeleteRecord(targetVault, pendingDeleteUUID)
              const items = getDatabaseData(targetVault)
              secondaryVaults.update(vs => vs.map(v => v.uuid === targetVault
                ? { ...v, items: items.map(i => ({ ...i, vaultUuid: targetVault })) }
                : v
              ))
              const data = saveDatabase(targetVault)
              if (sv.handle && !sv.readonly) {
                const w = await sv.handle.createWritable()
                await w.write(data)
                await w.close()
                secondaryHead[targetVault] = data.slice(72, 152)
                try { secondaryModified[targetVault] = (await sv.handle.getFile()).lastModified } catch {}
              } else {
                await saveSecondaryAs(sv, data)
              }
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
      let savedAs = false

      if (!handle || $selectedFile?.readonly) {
        if (supportsSaveAs) {
          handle = await window.showSaveFilePicker({
            suggestedName: $selectedFile?.name ?? 'vault.psafe3',
            types: [{ description: 'Password Safe', accept: { 'application/octet-stream': ['.psafe3', '.dat'] } }],
          })
          savedAs = true
        } else {
          // No file picker (iOS): trigger a download
          const fname = ($selectedFile?.name ?? 'vault')
          const download = fname.endsWith('.psafe3') || fname.endsWith('.dat') ? fname : fname + '.psafe3'
          const blob = new Blob([data], { type: 'application/octet-stream' })
          const url = URL.createObjectURL(blob)
          const a = document.createElement('a')
          a.href = url
          a.download = download
          document.body.appendChild(a)
          a.click()
          document.body.removeChild(a)
          URL.revokeObjectURL(url)
          isDirty = false
          try { lastSave = getDatabaseInfo(dbKey)?.when ?? '' } catch {}
          if (!silent) showToast('Vault saved')
          return true
        }
      }

      if (!savedAs && primaryModified !== null) {
        try {
          const file = await handle.getFile()
          if (file.lastModified !== primaryModified) {
            let realConflict = true
            if (primaryHead) {
              try {
                const buf = await file.slice(72, 152).arrayBuffer()
                realConflict = !sameHead(new Uint8Array(buf), primaryHead)
              } catch {}
            }
            if (realConflict && !confirm('This vault was modified since it was loaded.\n\nSaving will overwrite those changes. Save anyway?')) return false
          }
        } catch {}
      }
      const w = await handle.createWritable()
      await w.write(data)
      await w.close()
      primaryHead = data.slice(72, 152)
      try { primaryModified = (await handle.getFile()).lastModified } catch {}
      if (savedAs) {
        selectedFile.update(s => ({ ...s, handle, name: handle.name, readonly: false }))
      }
      isDirty = false
      try { lastSave = getDatabaseInfo(dbKey)?.when ?? '' } catch {}
      if (!silent) showToast('Vault saved')
      return true
    } catch (e) {
      if (e.name !== 'AbortError') showToast('Save failed: ' + e.message)
      return false
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

  function absoluteUrl(url) { return url.includes('://') ? url : 'https://' + url }

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
      const { hash } = await copyFieldToClipboard(recordVaultUuid, recordUuid, fieldname, true)
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
      const { hash } = await copyCustomFieldToClipboard(recordVaultUuid, recordUuid, fieldname, true)
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

  function vaultUuidForRecord(uuid) {
    if (get(dbItems).find(i => i.uuid === uuid)) return dbKey
    for (const sv of get(secondaryVaults)) {
      if (sv.items?.find(i => i.uuid === uuid)) return sv.uuid
    }
    return selectedVaultUuid || dbKey
  }

  async function copyTOTPForUUID(uuid, vaultUuidHint = null) {
    try {
      const vaultUuid = vaultUuidHint ?? vaultUuidForRecord(uuid)
      await wasmCopyTOTP(vaultUuid, uuid)
      if (clearTimer) { clearTimeout(clearTimer); clearTimer = null }
      clipHash = null
      const token = ++sessionSerial
      // Short session drives the visual flash only — no autoclear timer for TOTP
      clipboardSession.set({ token, expiresAt: Date.now() + 500 })
      clipboardContext.set({ token, field: 'otp', uuid, hash: null })
      setTimeout(() => {
        if (get(clipboardSession)?.token === token) {
          clipboardSession.set(null)
          clipboardContext.set(null)
        }
      }, 500)
      showToast('One-time code copied to clipboard', null, 2000)
    } catch {
      showToast('Copy failed')
    }
  }

  async function copyTOTP() {
    // TwoFactorKey is null (withheld = configured) or undefined (not configured)
    if (record?.TwoFactorKey === undefined) return
    await copyTOTPForUUID(selectedUUID)
  }


  async function saveDBFields(fields) {
    try {
      updateDBFields(dbKey, fields)
      if (await saveFile(true)) {
        dbName = fields.Name ?? dbName  // fields uses PascalCase for the WASM write API
        vaultDirty = false
        showToast('Vault info saved')
      }
    } catch (e) {
      showToast('Failed to save vault info: ' + e.message)
    }
  }

  async function saveSecondaryDBFields(uuid) {
    const sv = get(secondaryVaults).find(v => v.uuid === uuid)
    if (!sv || sv.readonly) return
    try {
      const data = saveDatabase(uuid)
      if (sv.handle) {
        const w = await sv.handle.createWritable()
        await w.write(data)
        await w.close()
        secondaryHead[uuid] = data.slice(72, 152)
        try { secondaryModified[uuid] = (await sv.handle.getFile()).lastModified } catch {}
        showToast('Saved to ' + (sv.name || sv.filename), null, 2000)
      }
    } catch (e) {
      if (e.name !== 'AbortError') showToast('Failed to save: ' + e.message)
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
    dbItems.set([])
    selectedFile.set(null)
    if (clearTimer) { clearTimeout(clearTimer); clearTimer = null }
    clipHash = null
    clipboardSession.set(null)
    clipboardContext.set(null)
    onclosed()
  }

  function closeSecondarySetup() {
    secondarySetup = null
    sheetOpen = true
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
    dbItems.set([])
    selectedFile.set(null)
    if (clearTimer) { clearTimeout(clearTimer); clearTimer = null }
    clipHash = null
    clipboardSession.set(null)
    clipboardContext.set(null)
    onclosed()
  }

  async function unlockAdditionalVault() {
    sheetOpen = false
    if (supportsFilePicker) {
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
      _secondaryFallbackFile = null
      secondarySetup = {
        filename: secondaryHandle.name,
        password: '', showPw: false, busy: false, error: '',
        needsAuth: await isBiometricEnrolledForFile($selectedFile?.name ?? ''),
      }
    } else {
      secondaryFileInputEl.click()
    }
  }

  function onSecondaryFileInput(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) { sheetOpen = true; return }
    _secondaryHandle = null
    _secondaryFallbackFile = file
    secondarySetup = {
      filename: file.name,
      password: '', showPw: false, busy: false, error: '',
      needsAuth: false,
    }
  }

  async function confirmSecondarySetup() {
    if (!secondarySetup?.password) return
    const setup = secondarySetup
    let secondaryPassword = setup.password
    secondarySetup = { ...setup, password: '', busy: true, error: '' }

    // Biometric confirmation gesture if enrolled (proves identity without exposing master password)
    if (setup.needsAuth) {
      try {
        await unlockWithBiometric($selectedFile?.name ?? '')
      } catch (e) {
        secondaryPassword = ''
        secondarySetup = { ...secondarySetup, busy: false,
          error: e.name === 'NotAllowedError' ? 'Authentication cancelled.' : 'Authentication failed: ' + e.message }
        return
      }
    }

    try {
      let secondaryUuid
      if (_secondaryHandle) {
        secondaryUuid = await loadVaultFile(_secondaryHandle, secondaryPassword)
      } else {
        const buf = await _secondaryFallbackFile.arrayBuffer()
        secondaryUuid = openDatabase(new Uint8Array(buf), secondaryPassword)
      }

      if (secondaryUuid === dbKey) {
        // Don't closeDatabase here — same UUID means this IS the primary vault.
        // Closing it would remove the primary from WASM memory.
        secondarySetup = { ...secondarySetup, busy: false,
          error: `"${setup.filename}" is already open as your primary vault and cannot also be added as a secondary vault.` }
        return
      }

      if (get(secondaryVaults).some(v => v.uuid === secondaryUuid)) {
        // Don't closeDatabase here — this secondary is already in the WASM map.
        // Closing it would break the already-open secondary vault.
        secondarySetup = { ...secondarySetup, busy: false,
          error: `"${setup.filename}" is already open as a secondary vault.` }
        return
      }

      const info  = getDatabaseInfo(secondaryUuid)
      const items = getDatabaseData(secondaryUuid)
      let readonly = true
      if (_secondaryHandle) {
        try { const w = await _secondaryHandle.createWritable(); await w.abort(); readonly = false } catch {}
      }

      await addSecondaryCredential(dbKey, setup.filename, secondaryUuid, secondaryPassword, _secondaryHandle)

      secondaryVaults.update(vs => {
        const filtered = vs.filter(v => v.uuid !== secondaryUuid)
        return [...filtered, {
          handle: _secondaryHandle,
          name: info?.name || setup.filename,
          filename: setup.filename,
          readonly,
          items: items.map(i => ({ ...i, vaultUuid: secondaryUuid })),
          uuid: secondaryUuid,
        }]
      })
      if (_secondaryHandle) {
        _secondaryHandle.getFile().then(f => { secondaryModified[secondaryUuid] = f.lastModified }).catch(() => {})
      }
      _secondaryFallbackFile = null
      secondarySetup = null
      sheetOpen = true
    } catch (e) {
      secondarySetup = { ...secondarySetup, busy: false, error: 'Wrong password or invalid file.' }
    } finally {
      secondaryPassword = ''
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

  let vaultSearchResults = $derived.by(() => {
    const results = new Map()
    if (!debouncedQuery.trim()) return results
    try {
      results.set('', searchRecordResults(dbKey, debouncedQuery, 0))
    } catch {}
    for (const sv of $secondaryVaults) {
      try {
        results.set(sv.uuid, searchRecordResults(sv.uuid, debouncedQuery, 0))
      } catch {}
    }
    return results
  })

  // Flat ordered {uuid, vaultUuid} list spanning all open vaults, matching RecordList's sort.
  // vaultUuid is null for primary vault records (selectRecord defaults to dbKey).
  let flatList = $derived.by(() => {
    function sortedEntries(items, vaultUuid) {
      let list = items
      if (pendingDeleteUUID) list = list.filter(i => i.uuid !== pendingDeleteUUID)
      if (autofillNearMatchKeys) {
        const included = new Set(autofillNearMatchKeys)
        list = list.filter(i => included.has(autofillRecordKey(i.uuid, vaultUuid)))
      }
      if (debouncedQuery.trim()) {
        const result = vaultSearchResults.get(vaultUuid ?? '')
        if (result) {
          const matched = new Set(result.uuids ?? [])
          list = list.filter(i => matched.has(i.uuid))
        }
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

  function bestSearchMatch(searchText, candidates) {
    if (!searchText.trim() || candidates.length === 0) return null
    let best = null
    let bestScore = Infinity
    for (const candidate of candidates) {
      const result = vaultSearchResults.get(candidate.vaultUuid ?? '')
      if (result?.autoSelectUuid === candidate.uuid && Number.isFinite(result.autoSelectScore)) {
        if (result.autoSelectScore < bestScore) {
          best = candidate
          bestScore = result.autoSelectScore
        }
      }
    }
    return best
  }

  $effect(() => {
    const searchText = debouncedQuery.trim()
    const hasSearch = !!searchText

    if (hasSearch && !searchWasActive) {
      untrack(() => {
        preSearchSelection = { uuid: selectedUUID, vaultUuid: selectedVaultUuid }
        searchWasActive = true
      })
    }

    if (!hasSearch) {
      if (searchWasActive && !isEditing && !isNew) {
        const restore = preSearchSelection
        searchWasActive = false
        preSearchSelection = null
        try {
          loadRecordSelection(restore?.uuid ?? null, restore?.vaultUuid ?? null)
        } catch (e) {
          console.error(e)
          showToast('Could not restore previous record.')
        }
      } else if (searchWasActive && (isEditing || isNew)) {
        searchWasActive = false
        preSearchSelection = null
      }
      return
    }

    if (isEditing || isNew || sheetOpen) return

    const best = bestSearchMatch(searchText, flatList)
    if (!best) return

    const alreadySelected = untrack(() =>
      selectedUUID === best.uuid && selectedVaultUuid === best.vaultUuid
    )
    if (alreadySelected) return

    try {
      loadRecordSelection(best.uuid, best.vaultUuid)
    } catch (e) {
      console.error(e)
      showToast('Could not load best search match.')
    }
  })

  async function copyRecordField(field) {
    const value = record?.[field]
    if (value === null) {  // null = withheld sensitive value — use WASM copy
      const vaultUuid = selectedVaultUuid || dbKey
      const { token, hashBytes } = await copyFieldViaWasm(vaultUuid, selectedUUID, field)
      if (token !== null) {
        clipboardContext.set({ token, field, uuid: selectedUUID, hash: Array.from(hashBytes) })
        showToast(`${field} copied to clipboard`, null, 2000)
      }
      return
    }
    if (!value) return
    const token = await copyToClipboard(value)
    if (token !== null) {
      const hash = Array.from(await sha256(value))
      clipboardContext.set({ token, field, uuid: selectedUUID, hash })
      showToast(`${field} copied to clipboard`, null, 2000)
    }
  }

  async function copyCustomField(index) {
    const cf = record?.CustomFields?.[index]
    if (!cf) return
    if (cf.Value === null) {  // null = withheld sensitive custom field — use WASM copy
      const vaultUuid = selectedVaultUuid || dbKey
      const { token, hashBytes } = await copyCustomFieldViaWasm(vaultUuid, selectedUUID, cf.Name)
      if (token !== null) {
        clipboardContext.set({ token, field: `custom-${index}`, uuid: selectedUUID, hash: Array.from(hashBytes) })
        showToast(`${cf.Name} copied to clipboard`, null, 2000)
      }
      return
    }
    if (!cf.Value) return
    const token = await copyToClipboard(cf.Value)
    if (token !== null) {
      const hash = Array.from(await sha256(cf.Value))
      clipboardContext.set({ token, field: `custom-${index}`, uuid: selectedUUID, hash })
      showToast(`${cf.Name} copied to clipboard`, null, 2000)
    }
  }

  async function handleKeydown(e) {
    const inInput = e.target.matches('input, textarea, select, [contenteditable]')
    const inSearch = e.target === searchInput

    if (e.key === 'Escape') {
      if (autofillNearMatchKeys) { clearAutofillNearMatches(); return }
      if (showHelp) { showHelp = false; return }
      if (inSearch && query) { query = ''; clearTimeout(_debounceTimer); debouncedQuery = ''; return }
      if (inSearch) { searchInput?.blur(); return }
      if (sheetOpen) { sheetOpen = false; return }
      if (isEditing) { cancelEdit(); return }
      if (record) { record = null; selectedUUID = null; return }
      if (query) { query = ''; clearTimeout(_debounceTimer); debouncedQuery = ''; return }
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
        const idx = flatList.findIndex(i => i.uuid === selectedUUID && i.vaultUuid === selectedVaultUuid)
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
        const idx = flatList.findIndex(i => i.uuid === selectedUUID && i.vaultUuid === selectedVaultUuid)
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
      if (record.URL) window.open(absoluteUrl(record.URL), '_blank', 'noopener,noreferrer')
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
    if (e.ctrlKey && e.key === 'y') { e.preventDefault(); copyTOTP(); return }
    if (e.ctrlKey && e.key === 'e') { e.preventDefault(); copyRecordField('Email'); return }
    if (e.ctrlKey && e.key >= '1' && e.key <= '9') { e.preventDefault(); copyCustomField(parseInt(e.key) - 1); return }
  }
</script>

<svelte:window onkeydown={handleKeydown}/>

{#if secondarySetup}
  <div class="modal-overlay" role="presentation"
    onclick={e => { if (!secondarySetup.busy) closeSecondarySetup() }}
    onkeydown={e => { if (e.key === 'Escape' && !secondarySetup.busy) closeSecondarySetup() }}>
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
        <button class="btn btn-ghost" disabled={secondarySetup.busy} onclick={closeSecondarySetup}>Cancel</button>
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
      oninput={clearAutofillNearMatches}
      bind:this={searchInput}
      use:focusOnMount
    />
    {#if query}
      <button class="icon-btn-flat" onclick={() => { clearAutofillNearMatches(); query = ''; clearTimeout(_debounceTimer); debouncedQuery = '' }} aria-label="Clear search">
        <Icon name="x" size={16} stroke="var(--text-soft)"/>
      </button>
    {/if}
  </div>

  {#if autofillNearMatchKeys}
    <div class="autofill-near-match-filter muted">
      Near URL matches for {autofillNearMatchUrl}
      <button class="icon-btn-flat" onclick={clearAutofillNearMatches} aria-label="Clear autofill near matches">
        <Icon name="x" size={14} stroke="var(--text-soft)"/>
      </button>
    </div>
  {/if}

  <RecordList query={debouncedQuery} includeKeys={autofillNearMatchKeys} {selectedUUID} {selectedVaultUuid} {collapseSeq} excludeUUID={pendingDeleteUUID} storageKey={dbKey} primaryVaultName={vaultName} ontap={selectRecord} oncopy={copyToClipboard} oncopytotp={copyTOTPForUUID} onwasmcopyfield={copyFieldViaWasm} onwasmcopycustomfield={copyCustomFieldViaWasm}/>

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

  <!-- Hidden file input for secondary vault fallback (when showOpenFilePicker isn't available) -->
  <input bind:this={secondaryFileInputEl} type="file" accept=".psafe3,.dat" style="display:none" onchange={onSecondaryFileInput} />
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
        <div class="help-row"><span>Copy one-time code</span><div class="help-keys"><kbd>Ctrl</kbd><kbd>Y</kbd></div></div>
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
      {bookmarkletsSupported}
      {theme}
      {accent}
      onback={closeVaultSheet}
      onlock={lockVault}
      onlockall={lockAllVaults}
      onlocksecondary={lockSecondaryVault}
      onunlockadditional={unlockAdditionalVault}
      ondbsave={saveDBFields}
      onsvdbsave={saveSecondaryDBFields}
      ondirtychange={(d) => vaultDirty = d}
      {ontheme}
      {onaccent}
    />
  {:else if isEditing}
    <RecordEdit
      {record}
      {isNew}
      {isDesktop}
      {bookmarkletsSupported}
      {hasDelegates}
      vaultUuid={isNew ? (newRecordVaultUuid || dbKey) : (selectedVaultUuid || dbKey)}
      {rwVaults}
      vaultReadonly={editVaultReadonly}
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
        {bookmarkletsSupported}
        {hasDelegates}
        vaultUuid={selectedVaultUuid || dbKey}
        onback={() => { record = null; selectedUUID = null; selectedVaultUuid = null }}
        onedit={startEdit}
        vaultReadonly={selectedVaultUuid ? !!$secondaryVaults.find(v => v.uuid === selectedVaultUuid)?.readonly : !!$selectedFile?.readonly}
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
  .autofill-near-match-filter {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 7px 12px;
    border-bottom: 1px solid var(--border);
    background: var(--surface-2);
    font-size: 12px;
  }

  :global(.vault-app.is-desktop) .autofill-near-match-filter {
    grid-column: 1;
    grid-row: 3;
    align-self: start;
    z-index: 2;
  }

  :global(.vault-app.is-desktop) .autofill-near-match-filter + :global(.list-collapsible) {
    padding-top: 35px;
  }

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
