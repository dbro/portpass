<script>
  import { get } from 'svelte/store'
  import { tick, untrack } from 'svelte'
  import { selectedFile, dbItems, secondaryVaults, clipboardSession, clipboardContext } from '../store.js'
  import { searchRecords, getRecordData, getTOTP } from '../wasm.js'
  import Icon from './Icon.svelte'

  let { selectedUUID = null, excludeUUID = null, query = '', primaryVaultName = '', collapseSeq = '', ontap, oncopy, oncopytotp, onwasmcopyfield = null, onwasmcopycustomfield = null, storageKey = null } = $props()

  function loadGroupState() {
    if (!storageKey) return {}
    try { return JSON.parse(localStorage.getItem('groups-' + storageKey) ?? '{}') } catch { return {} }
  }

  function saveGroupState(state) {
    if (!storageKey) return
    try { localStorage.setItem('groups-' + storageKey, JSON.stringify(state)) } catch {}
  }

  let openGroups = $state({})

  $effect(() => {
    // Reload when storageKey becomes available (set after onMount in Dashboard)
    openGroups = loadGroupState()
  })
  let contextMenu  = $state(null) // { x, y, rec, uuid }
  let flashedUUID  = $state(null)
  let flashedToken = null
  let flashedField = $state(null)
  let animVariant  = $state(0)

  async function sha256(text) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
    return new Uint8Array(buf)
  }
  function hashesEqual(a, b) {
    if (!a || !b || a.length !== b.length) return false
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
    return true
  }

  $effect(() => {
    const s = $clipboardSession
    if (!s || s.token !== flashedToken) {
      flashedUUID  = null
      flashedToken = null
      flashedField = null
    }
  })

  // Reactively restore (or update) the drain whenever the clipboard context changes.
  // For sensitive fields (null value), skip hash verification — trust the token.
  $effect(() => {
    const s = $clipboardSession
    const ctx = $clipboardContext
    if (!s || !ctx || ctx.token !== s.token || !ctx.uuid || !ctx.field) return
    if (!ctx.hash && ctx.field !== 'otp') return  // otp has no hash — others require it
    if (flashedToken === ctx.token) return
    ;(async () => {
      try {
        const ctxVaultUuid = vaultUuidForRecord(ctx.uuid)
        const rec = ctx.field === 'otp' ? null : getRecordData(ctxVaultUuid, ctx.uuid)

        const isSensitive = ctx.field === 'Password'
          || ctx.field === 'otp'
          || (ctx.field.startsWith('custom-') && rec?.CustomFields?.[parseInt(ctx.field.slice(7))]?.Value === null)

        if (isSensitive) {
          if (get(clipboardSession)?.token !== ctx.token) return
          flashedToken = ctx.token
          flashedUUID  = null
          flashedField = null
          await tick()
          if (get(clipboardSession)?.token !== ctx.token) return
          animVariant ^= 1
          flashedUUID  = ctx.uuid
          flashedField = ctx.field
          return
        }

        let value
        if (ctx.field === 'otp') {
          value = getTOTP(ctxVaultUuid, ctx.uuid)?.code
        } else if (ctx.field.startsWith('custom-')) {
          const idx = parseInt(ctx.field.slice(7))
          value = rec.CustomFields?.[idx]?.Value
        } else {
          value = { Username: rec.Username, URL: rec.URL, Email: rec.Email }[ctx.field]
        }
        if (!value) return
        if (hashesEqual(await sha256(value), new Uint8Array(ctx.hash))
            && get(clipboardSession)?.token === ctx.token) {
          flashedToken = ctx.token
          flashedUUID  = null
          flashedField = null
          await tick()
          if (get(clipboardSession)?.token !== ctx.token) return
          animVariant ^= 1
          flashedUUID  = ctx.uuid
          flashedField = ctx.field
        }
      } catch {}
    })()
  })

  async function handleWasmCopy(vaultUuid, uuid, field) {
    if (!onwasmcopyfield) return
    const { token, hashBytes } = await onwasmcopyfield(vaultUuid, uuid, field)
    if (token !== null) {
      clipboardContext.set({ token, field, uuid, hash: Array.from(hashBytes) })
      flashedToken = token
      flashedUUID  = null
      flashedField = null
      await tick()
      animVariant ^= 1
      flashedUUID  = uuid
      flashedField = field
    }
  }

  async function handleWasmCustomCopy(vaultUuid, uuid, fieldName, displayField) {
    if (!onwasmcopycustomfield) return
    const { token, hashBytes } = await onwasmcopycustomfield(vaultUuid, uuid, fieldName)
    if (token !== null) {
      clipboardContext.set({ token, field: displayField, uuid, hash: Array.from(hashBytes) })
      flashedToken = token
      flashedUUID  = null
      flashedField = null
      await tick()
      animVariant ^= 1
      flashedUUID  = uuid
      flashedField = displayField
    }
  }

  async function handleCopy(value, uuid, field = 'Password') {
    const token = await oncopy(value)
    if (token !== null) {
      const hash = Array.from(await sha256(value))
      clipboardContext.set({ token, field, uuid, hash })
      // Claim the token synchronously before yielding — restore effect guard sees
      // flashedToken === ctx.token and bails, preventing a race with this function.
      flashedToken = token
      flashedUUID  = null
      flashedField = null
      await tick()
      animVariant ^= 1
      flashedUUID  = uuid
      flashedField = field
    }
  }

  function drainStyle() {
    const s = $clipboardSession
    if (!s) return ''
    const remaining = Math.max(50, s.expiresAt - Date.now())
    const elapsed   = Math.max(0, 30000 - remaining)
    const flash = elapsed > 100 ? '0ms' : '450ms'
    return `--clip-delay: -${elapsed}ms; --drain-name: clip-drain-${animVariant}; --flash-name: clip-flash-${animVariant}; --flash-duration: ${flash}`
  }

  function vaultUuidForRecord(recordUuid) {
    for (const sv of get(secondaryVaults)) {
      if (sv.items.find(i => i.uuid === recordUuid)) return sv.uuid
    }
    return get(selectedFile)?.uuid ?? ''
  }

  function buildGroups(items, q, vaultUuid) {
    let list = items
    if (excludeUUID) list = list.filter(i => i.uuid !== excludeUUID)
    if (q.trim() && vaultUuid) {
      try {
        const matched = new Set(searchRecords(vaultUuid, q, false))
        list = list.filter(i => matched.has(i.uuid))
      } catch { /* vault temporarily unavailable — show unfiltered */ }
    }
    const byGroup = {}
    list.forEach(r => {
      const g = r.group || 'Ungrouped'
      ;(byGroup[g] = byGroup[g] || []).push(r)
    })
    return Object.entries(byGroup)
      .map(([g, items]) => {
        const counts = {}
        items.forEach(r => { counts[r.title] = (counts[r.title] || 0) + 1 })
        const sorted = items
          .map(r => ({ ...r, showUsername: counts[r.title] > 1 }))
          .sort((a, b) => a.title.localeCompare(b.title))
        return { group: g, items: sorted }
      })
      .sort((a, b) => a.group.localeCompare(b.group))
  }

  let groups = $derived.by(() => buildGroups($dbItems, query, get(selectedFile)?.uuid ?? ''))

  let allVaultGroups = $derived.by(() => {
    if ($secondaryVaults.length === 0) return null
    return [
      { vaultName: primaryVaultName || 'Primary vault', filename: null, readonly: false, groups: buildGroups($dbItems, query, get(selectedFile)?.uuid ?? '') },
      ...$secondaryVaults.map(sv => ({
        vaultName: sv.name, filename: sv.filename, readonly: sv.readonly,
        groups: buildGroups(sv.items, query, sv.uuid),
      })),
    ]
  })

  // Auto-expand the group containing the newly-selected record (e.g. via arrow key navigation)
  $effect(() => {
    const uuid = selectedUUID
    if (!uuid) return
    const allItems = [
      ...get(dbItems),
      ...get(secondaryVaults).flatMap(sv => sv.items ?? [])
    ]
    const item = allItems.find(i => i.uuid === uuid)
    if (!item) return
    const group = item.group || 'Ungrouped'
    untrack(() => {
      if (openGroups[group] === false) {
        const next = { ...openGroups, [group]: true }
        openGroups = next
        saveGroupState(next)
      }
    })
  })

  let openVaults = $state({})

  $effect(() => {
    if (!collapseSeq) return
    untrack(() => {
      const allGroupNames = [
        ...groups.map(g => g.group),
        ...(allVaultGroups?.flatMap(v => v.groups.map(g => g.group)) ?? [])
      ]
      if (collapseSeq === 'collapse') {
        const next = Object.fromEntries(allGroupNames.map(g => [g, false]))
        openGroups = next
        saveGroupState(next)
      } else {
        const next = Object.fromEntries(allGroupNames.map(g => [g, true]))
        openGroups = next
        saveGroupState(next)
      }
    })
  })

  function isVaultOpen(name) {
    if (query.trim()) return true
    return name in openVaults ? openVaults[name] : true
  }
  function toggleVault(name) { openVaults = { ...openVaults, [name]: !isVaultOpen(name) } }

  function toggle(group) {
    const next = { ...openGroups, [group]: !isOpen(group) }
    openGroups = next
    saveGroupState(next)
  }

  function isOpen(group) {
    if (query.trim()) return true
    if (group in openGroups) return openGroups[group]
    return true
  }

  function handleClick(uuid, vaultUuid = null) {
    if (contextMenu) { contextMenu = null; return }
    if (uuid === selectedUUID && !vaultUuid) {
      copyPassword(uuid)
    } else {
      ontap(uuid, vaultUuid)
    }
  }

  function handleDblClick(uuid, vaultUuid = null) {
    if (vaultUuid) { ontap(uuid, vaultUuid); return }
    copyPassword(uuid)
  }

  function handleContextMenu(e, uuid) {
    e.preventDefault()
    try {
      const rec = getRecordData(vaultUuidForRecord(uuid), uuid)
      // Clamp to viewport so menu doesn't appear off-screen
      const menuW = 180, menuH = 500
      const x = Math.min(e.clientX, window.innerWidth  - menuW - 8)
      const y = Math.min(e.clientY, window.innerHeight - menuH - 8)
      contextMenu = { x, y, rec, uuid }
    } catch {}
  }

  function copyPassword(uuid) {
    try {
      const vaultUuid = vaultUuidForRecord(uuid)
      const rec = getRecordData(vaultUuid, uuid)
      if (rec.Password === null) handleWasmCopy(vaultUuid, uuid, 'Password')  // withheld — use WASM
      else if (rec.Password) handleCopy(rec.Password, uuid, 'Password')
    } catch {}
  }

  function closeMenu() { contextMenu = null }

  function truncate(str, max) {
    return str.length <= max ? str : str.slice(0, max - 1) + '…'
  }

  // Returns [{text, matched}] segments for inline highlighting
  function hl(text, q) {
    if (!q.trim() || !text) return [{ text: text || '', matched: false }]
    const terms = q.trim().split(/\s+/).filter(Boolean)
    const lower = text.toLowerCase()
    const ranges = []
    for (const term of terms) {
      const lt = term.toLowerCase()
      let pos = 0
      while (pos < lower.length) {
        const idx = lower.indexOf(lt, pos)
        if (idx === -1) break
        ranges.push([idx, idx + lt.length])
        pos = idx + lt.length
      }
    }
    if (ranges.length === 0) return [{ text, matched: false }]
    ranges.sort((a, b) => a[0] - b[0])
    const merged = [ranges[0].slice()]
    for (let i = 1; i < ranges.length; i++) {
      const last = merged[merged.length - 1]
      if (ranges[i][0] <= last[1]) last[1] = Math.max(last[1], ranges[i][1])
      else merged.push(ranges[i].slice())
    }
    const parts = []
    let pos = 0
    for (const [start, end] of merged) {
      if (start > pos) parts.push({ text: text.slice(pos, start), matched: false })
      parts.push({ text: text.slice(start, end), matched: true })
      pos = end
    }
    if (pos < text.length) parts.push({ text: text.slice(pos), matched: false })
    return parts
  }
</script>

<svelte:window
  onclick={e => { if (contextMenu && !e.target.closest('.ctx-menu')) closeMenu() }}
  onkeydown={e => { if (e.key === 'Escape') closeMenu() }}
/>

<div class="list-collapsible">
  {#if allVaultGroups}
    <!-- Multi-vault display: vault name as top-level collapsible group -->
    {#each allVaultGroups as vault}
      <section class="coll-vault" class:is-open={isVaultOpen(vault.vaultName)}>
        <button class="coll-vault-header" onclick={() => toggleVault(vault.vaultName)}>
          <Icon name={isVaultOpen(vault.vaultName) ? 'chevron-down' : 'chevron-right'} size={16} stroke="var(--text-soft)"/>
          <span class="coll-vault-name">{vault.vaultName}</span>
          {#if vault.readonly}<span class="coll-vault-ro muted">read-only</span>{/if}
        </button>
        {#if isVaultOpen(vault.vaultName)}
          {#each vault.groups as { group, items }}
            <section class="coll-group coll-group-nested" class:is-open={isOpen(group)}>
              <button class="coll-header" onclick={() => toggle(group)}>
                <Icon name={isOpen(group) ? 'chevron-down' : 'chevron-right'} size={16} stroke="var(--text-soft)"/>
                <span class="coll-name">{#each hl(group, query) as part}{#if part.matched}<span class="hl-secondary">{part.text}</span>{:else}{part.text}{/if}{/each}</span>
                <span class="coll-count muted">{items.length}</span>
              </button>
              {#if isOpen(group)}
                <div class="coll-body">
                  {#each items as r}
                    {@render recordRow(r)}
                  {/each}
                </div>
              {/if}
            </section>
          {/each}
          {#if vault.groups.length === 0 && query}
            <div class="muted" style="padding:6px 16px 6px 32px;font-size:13px">No matches</div>
          {/if}
        {/if}
      </section>
    {/each}
  {:else if groups.length === 0}
    {#if !query && $dbItems.length === 0}
      <div class="empty-vault">
        <img src="{import.meta.env.BASE_URL}icon-512.png" alt="Portpass" class="empty-vault-logo"/>
        <div class="empty-vault-prompt muted">Add your first password</div>
        <div class="empty-vault-nudge muted">↙</div>
      </div>
    {:else}
      <div class="empty-state muted">
        {query ? `No matches for "${query}"` : ''}
      </div>
    {/if}
  {:else}
    {#each groups as { group, items }}
      <section class="coll-group" class:is-open={isOpen(group)}>
        <button class="coll-header" onclick={() => toggle(group)}>
          <Icon name={isOpen(group) ? 'chevron-down' : 'chevron-right'} size={16} stroke="var(--text-soft)"/>
          <span class="coll-name">
            {#each hl(group, query) as part}
              {#if part.matched}<span class="hl-secondary">{part.text}</span>{:else}{part.text}{/if}
            {/each}
          </span>
          <span class="coll-count muted">{items.length}</span>
        </button>
        {#if isOpen(group)}
          <div class="coll-body">
            {#each items as r}
              {@render recordRow(r)}
            {/each}
          </div>
        {/if}
      </section>
    {/each}
  {/if}
</div>

{#snippet recordRow(r)}
  <button
    class="record-row"
    class:is-selected={r.uuid === selectedUUID}
    class:clipboard-active={flashedUUID === r.uuid}
    class:is-secondary={!!r.vaultUuid}
    style={flashedUUID === r.uuid
      ? (flashedField === 'otp'
         ? `--drain-name: clip-drain-${animVariant}; --flash-name: clip-flash-${animVariant}; --clip-delay: -30000ms; --flash-duration: 450ms`
         : drainStyle())
      : ''}
    onclick={() => handleClick(r.uuid, r.vaultUuid)}
    ondblclick={() => handleDblClick(r.uuid, r.vaultUuid)}
    oncontextmenu={e => handleContextMenu(e, r.uuid)}
  >
    <div class="record-row-main">
      <span class="record-row-title">
        {#each hl(r.title, query) as part}
          {#if part.matched}<mark class="hl-primary">{part.text}</mark>{:else}{part.text}{/if}
        {/each}
      </span>
      {#if r.showUsername && r.username}
        <span class="record-row-sub muted">{r.username}</span>
      {/if}
    </div>
    <Icon name="chevron-right" size={16} stroke="var(--text-soft)"/>
  </button>
{/snippet}

{#if contextMenu}
  <div
    class="ctx-menu"
    role="menu"
    style="left:{contextMenu.x}px; top:{contextMenu.y}px"
  >
    {#if contextMenu.rec.Username}
      <button onclick={() => { handleCopy(contextMenu.rec.Username, contextMenu.uuid, 'Username'); closeMenu() }}>
        <span>Copy username</span><span class="ctx-keys"><kbd>Ctrl</kbd><kbd>B</kbd></span>
      </button>
    {/if}
    {#if contextMenu.rec.Password !== ''}
      <button onclick={() => {
        if (contextMenu.rec.Password === null) handleWasmCopy(vaultUuidForRecord(contextMenu.uuid), contextMenu.uuid, 'Password')
        else handleCopy(contextMenu.rec.Password, contextMenu.uuid, 'Password')
        closeMenu()
      }}>
        <span>Copy password</span><span class="ctx-keys"><kbd>Ctrl</kbd><kbd>C</kbd></span>
      </button>
    {/if}
    {#if contextMenu.rec.URL}
      <button onclick={() => { handleCopy(contextMenu.rec.URL, contextMenu.uuid, 'URL'); closeMenu() }}>
        <span>Copy URL</span><span class="ctx-keys"><kbd>Ctrl</kbd><kbd>U</kbd></span>
      </button>
      <button onclick={() => { window.open(contextMenu.rec.URL, '_blank'); closeMenu() }}>
        <span>Visit URL</span><span class="ctx-keys"><kbd>↵</kbd></span>
      </button>
    {/if}
    {#if contextMenu.rec.TwoFactorKey !== undefined}
      <button onclick={async () => { const u = contextMenu.uuid; closeMenu(); await oncopytotp(u) }}>
        <span>Copy one-time code</span><span class="ctx-keys"><kbd>Ctrl</kbd><kbd>T</kbd></span>
      </button>
    {/if}
    {#each (contextMenu.rec.CustomFields ?? []).slice(0, 9) as cf, i}
      <button onclick={() => {
        const vaultUuid = vaultUuidForRecord(contextMenu.uuid)
        if (cf.Value === null) handleWasmCustomCopy(vaultUuid, contextMenu.uuid, cf.Name, `custom-${i}`)
        else handleCopy(cf.Value, contextMenu.uuid, `custom-${i}`)
        closeMenu()
      }}>
        <span>Copy {truncate(cf.Name, 14)}</span><span class="ctx-keys"><kbd>Ctrl</kbd><kbd>{i + 1}</kbd></span>
      </button>
    {/each}
  </div>
{/if}

<style>
  .coll-vault { border-bottom: 1px solid var(--border); }
  .coll-vault-header {
    display: flex; align-items: center; gap: 6px;
    width: 100%; padding: 10px 12px; border: none; background: var(--surface-2);
    cursor: pointer; font-size: 13px; font-weight: 600; color: var(--text);
    text-transform: uppercase; letter-spacing: 0.04em;
  }
  .coll-vault-name { flex: 1; text-align: left; }
  .coll-vault-ro { font-size: 11px; font-weight: 400; text-transform: none; letter-spacing: 0; }
  .coll-group-nested .coll-header { padding-left: 24px; }
  .coll-group-nested .coll-body .record-row { padding-left: 32px; }

  :global(.hl-primary) {
    background: var(--accent-soft);
    color: var(--accent-strong);
    border-radius: 2px;
    padding: 0 1px;
    font-style: normal;
  }

  :global(.hl-secondary) {
    color: var(--accent);
    font-weight: 700;
  }

  .ctx-menu {
    position: fixed;
    z-index: 100;
    min-width: 210px;
    background: var(--surface);
    border: 1px solid var(--border-strong);
    border-radius: var(--r-input);
    box-shadow: var(--shadow), 0 8px 24px rgba(0,0,0,0.18);
    padding: 4px;
    display: flex;
    flex-direction: column;
  }

  .ctx-menu button {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 20px;
    width: 100%;
    padding: 9px 12px;
    border: none;
    border-radius: 6px;
    background: none;
    cursor: pointer;
    font-size: 14px;
    color: var(--text);
  }

  .ctx-menu button:hover {
    background: var(--surface-2);
  }

  .ctx-keys {
    display: flex;
    gap: 3px;
    flex-shrink: 0;
  }

  .ctx-menu kbd {
    font-size: 11px;
    font-family: inherit;
    font-weight: normal;
    color: var(--text-soft);
  }
</style>
