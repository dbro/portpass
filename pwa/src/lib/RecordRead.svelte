<script>
  import { onMount, tick } from 'svelte'
  import { get } from 'svelte/store'
  import { clipboardSession, clipboardContext } from '../store.js'
  import { getTOTP, getFieldValue, getCustomFieldValue } from '../wasm.js'
  import Icon from './Icon.svelte'

  let { record, uuid, isDesktop, bookmarkletsSupported = false, hasDelegates = false, vaultUuid, onback, onedit, oncopy, oncopytotp,
        onwasmcopyfield, onwasmcopycustomfield } = $props()

  let revealed        = $state(false)
  let revealedPassword = $state(null)   // null = masked, string = revealed
  let showHistory     = $state(false)
  let revealedHistory  = $state(null)   // null = not loaded, array = loaded entries
  let notesRevealed   = $state(false)
  let revealedNotes    = $state(null)   // null = masked, string = revealed
  let totpData         = $state(null)   // { code, seconds, period } | null
  let totpRevealed     = $state(false)
  let totpBarInstant   = $state(false)
  let totpPrevSeconds  = -1

  // Clear revealed values when record changes
  $effect(() => {
    uuid  // track
    revealedPassword = null
    revealedNotes = null
    revealedHistory = null
    revealedCustomValues = Array(9).fill(null)
    customRevealed = Array(9).fill(false)
    revealed = false
    notesRevealed = false
    showHistory = false
  })

  // TwoFactorKey: undefined = not configured, null = configured (withheld)
  $effect(() => {
    if (record.TwoFactorKey === undefined) return
    function refresh() {
      try {
        const data = getTOTP(vaultUuid, uuid)
        if (totpPrevSeconds > 0 && data.seconds > totpPrevSeconds + 5) {
          totpBarInstant = true
          setTimeout(() => totpBarInstant = false, 50)
        }
        totpPrevSeconds = data.seconds
        totpData = data
      } catch { totpData = null }
    }
    refresh()
    const id = setInterval(refresh, 1000)
    return () => clearInterval(id)
  })

  let copiedField         = $state(null)
  let copiedToken         = null
  let animVariant         = $state(0)
  let customRevealed      = $state(Array(9).fill(false))
  let revealedCustomValues = $state(Array(9).fill(null))  // null = masked, string = revealed

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

  $effect(() => {
    const s = $clipboardSession
    if (!s || s.token !== copiedToken) {
      copiedField = null
      copiedToken = null
    }
  })

  // Reactively restore drain animation when clipboard context changes.
  // For sensitive fields (null value in record), skip hash verification — trust the token.
  $effect(() => {
    const s = $clipboardSession
    const ctx = $clipboardContext
    if (!s || !ctx || ctx.token !== s.token || ctx.uuid !== uuid || !ctx.field) return
    if (!ctx.hash && ctx.field !== 'otp') return  // otp has no hash — others require it
    if (copiedToken === ctx.token) return
    ;(async () => {
      let value
      const isSensitiveField = ctx.field === 'Password' || ctx.field === 'Notes'
        || ctx.field === 'otp'
        || ctx.field.startsWith('history-')
        || (ctx.field.startsWith('custom-') && record.CustomFields?.[parseInt(ctx.field.slice(7))]?.Value === null)

      if (isSensitiveField) {
        // Can't verify hash — restore drain based on token match alone
        if (get(clipboardSession)?.token !== ctx.token) return
        copiedToken = ctx.token
        copiedField = null
        await tick()
        if (get(clipboardSession)?.token !== ctx.token) return
        animVariant ^= 1
        copiedField = ctx.field
        return
      }

      if (ctx.field === 'otp') {
        value = totpData?.code
      } else if (ctx.field.startsWith('custom-')) {
        const idx = parseInt(ctx.field.slice(7))
        value = record.CustomFields?.[idx]?.Value
      } else {
        value = { Username: record.Username, URL: record.URL, Email: record.Email }[ctx.field]
      }
      if (!value) return
      if (hashesEqual(await sha256(value), new Uint8Array(ctx.hash))
          && get(clipboardSession)?.token === ctx.token) {
        copiedToken = ctx.token
        copiedField = null
        await tick()
        if (get(clipboardSession)?.token !== ctx.token) return
        animVariant ^= 1
        copiedField = ctx.field
      }
    })()
  })

  async function handleTOTPCopy() {
    if (!totpData?.code) return
    await oncopytotp(uuid)
  }

  async function handleCopy(value, field) {
    const token = await oncopy(value)
    if (token !== null) {
      const hash = Array.from(await sha256(value))
      clipboardContext.set({ token, field, uuid, hash })
      copiedToken = token
      copiedField = null
      await tick()
      animVariant ^= 1
      copiedField = field
    }
  }

  // Copy a sensitive standard field: WASM reads from vault and writes directly to clipboard
  async function handleWasmCopy(fieldname) {
    const { token, hashBytes } = await onwasmcopyfield(vaultUuid, uuid, fieldname)
    if (token !== null) {
      clipboardContext.set({ token, field: fieldname, uuid, hash: Array.from(hashBytes) })
      copiedToken = token
      copiedField = null
      await tick()
      animVariant ^= 1
      copiedField = fieldname
    }
  }

  // Copy a sensitive custom field via WASM
  async function handleWasmCustomCopy(fieldname, displayField) {
    const { token, hashBytes } = await onwasmcopycustomfield(vaultUuid, uuid, fieldname)
    if (token !== null) {
      clipboardContext.set({ token, field: displayField, uuid, hash: Array.from(hashBytes) })
      copiedToken = token
      copiedField = null
      await tick()
      animVariant ^= 1
      copiedField = displayField
    }
  }

  async function toggleRevealPassword() {
    if (revealedPassword !== null) {
      revealedPassword = null; revealed = false
      showHistory = false; revealedHistory = null
      return
    }
    revealedPassword = getFieldValue(vaultUuid, uuid, 'Password')
    revealed = true
  }

  async function toggleRevealNotes() {
    if (revealedNotes !== null) { revealedNotes = null; notesRevealed = false; return }
    revealedNotes = getFieldValue(vaultUuid, uuid, 'Notes')
    notesRevealed = true
  }

  async function loadHistory() {
    if (revealedHistory !== null) { revealedHistory = null; showHistory = false; return }
    const raw = getFieldValue(vaultUuid, uuid, 'PasswordHistory')
    revealedHistory = parseHistory(raw)
    showHistory = true
  }

  function drainStyle() {
    const s = $clipboardSession
    if (!s) return ''
    const remaining = Math.max(50, s.expiresAt - Date.now())
    const elapsed   = Math.max(0, 30000 - remaining)
    const flash = elapsed > 100 ? '0ms' : '450ms'
    return `--clip-delay: -${elapsed}ms; --drain-name: clip-drain-${animVariant}; --flash-name: clip-flash-${animVariant}; --flash-duration: ${flash}`
  }

  function relTime(str) {
    if (!str) return ''
    const d = new Date(str), now = new Date(), diff = (now - d) / 1000
    if (diff < 60)        return 'just now'
    if (diff < 3600)      return `${Math.floor(diff/60)}m ago`
    if (diff < 86400)     return `${Math.floor(diff/3600)}h ago`
    if (diff < 86400*7)   return `${Math.floor(diff/86400)}d ago`
    if (diff < 86400*30)  return `${Math.floor(diff/(86400*7))}w ago`
    return d.toLocaleDateString()
  }

  function relTimeUnix(ts) {
    return relTime(new Date(ts * 1000).toISOString())
  }

  function warnAutotype(seq) {
    if (!seq) return ''
    const supported = new Set(['u', 'p', 't', 'n', 'm', '2', 's', '\\', 'f', 'w', 'W'])
    const unknown = new Set()
    let i = 0
    while (i < seq.length) {
      if (seq[i] !== '\\') { i++; continue }
      if (i + 1 >= seq.length) break
      const code = seq[i + 1]
      if (code === 'f') {
        const d = seq[i + 2]
        d !== undefined && /^[0-9]$/.test(d) ? (i += 3) : (i += 2)
      } else if (code === 'w' || code === 'W') {
        let j = i + 2, count = 0
        while (j < seq.length && count < 3 && /^[0-9]$/.test(seq[j])) { j++; count++ }
        i = count ? j : i + 2
      } else {
        if (!supported.has(code)) unknown.add('\\' + code)
        i += 2
      }
    }
    if (!unknown.size) return ''
    return `Portpass will skip unsupported code${unknown.size > 1 ? 's' : ''}: ${[...unknown].join(', ')}`
  }

  function parseTokens(seq, cf) {
    if (!seq) return []
    const toks = []
    let lit = '', i = 0
    const fl = () => { if (lit) { toks.push({ type: 'literal', value: lit }); lit = '' } }
    while (i < seq.length) {
      if (seq[i] !== '\\') { lit += seq[i++]; continue }
      if (i + 1 >= seq.length) {
        fl()
        toks.push({ type: 'error', raw: '\\', label: 'trailing \\' })
        break
      }
      const c = seq[i + 1]
      if (c === '\\') { lit += '\\'; i += 2; continue }
      fl()
      if (c === 'u') { toks.push({ type: 'field', label: 'Username', raw: '\\u' }); i += 2 }
      else if (c === 'p') { toks.push({ type: 'field', label: 'Password', raw: '\\p' }); i += 2 }
      else if (c === 'm') { toks.push({ type: 'field', label: 'Email', raw: '\\m' }); i += 2 }
      else if (c === '2') { toks.push({ type: 'field', label: 'One-time code', raw: '\\2' }); i += 2 }
      else if (c === 't') { toks.push({ type: 'nav', label: 'Tab', suffix: '→', raw: '\\t' }); i += 2 }
      else if (c === 's') { toks.push({ type: 'nav', label: 'Shift-Tab', suffix: '←', raw: '\\s' }); i += 2 }
      else if (c === 'n') { toks.push({ type: 'nav', label: 'Enter', suffix: '↵', raw: '\\n' }); i += 2 }
      else if (c === 'f') {
        const d = seq[i + 2]
        if (d !== undefined && /^[0-9]$/.test(d)) {
          if (d === '0') {
            toks.push({ type: 'error', raw: '\\f0', label: '\\f0 invalid' }); i += 3
          } else {
            const n = parseInt(d)
            toks.push({ type: 'field', label: cf?.[n - 1]?.Name?.trim() || `Custom ${n}`, raw: `\\f${d}` }); i += 3
          }
        } else {
          toks.push({ type: 'field', label: cf?.[0]?.Name?.trim() || 'Custom 1', raw: '\\f' }); i += 2
        }
      } else if (c === 'w' || c === 'W') {
        let j = i + 2, cnt = 0
        while (j < seq.length && cnt < 3 && /^[0-9]$/.test(seq[j])) { j++; cnt++ }
        if (cnt === 0) {
          toks.push({ type: 'error', raw: `\\${c}`, label: `\\${c} no digits` }); i += 2
        } else {
          const unit = c === 'w' ? 'ms' : 's'
          toks.push({ type: 'wait', label: `Wait ${seq.slice(i + 2, j)}${unit}`, raw: seq.slice(i, j) }); i = j
        }
      } else {
        toks.push({ type: 'unknown', label: `Unknown \\${c}`, raw: `\\${c}` }); i += 2
      }
    }
    fl()
    return toks
  }

  let autofillMode    = $state('visual')
  let showAutofillInfo = $state(false)

  function parseHistory(raw) {
    if (!raw || raw.length < 5) return []
    const count = parseInt(raw.slice(3, 5), 16)
    const entries = []
    let pos = 5
    for (let i = 0; i < count; i++) {
      if (pos + 12 > raw.length) break
      const ts  = parseInt(raw.slice(pos, pos + 8), 16);  pos += 8
      const len = parseInt(raw.slice(pos, pos + 4), 16);  pos += 4
      if (pos + len > raw.length) break
      entries.push({ ts, password: raw.slice(pos, pos + len) })
      pos += len
    }
    return entries.reverse() // most recent first
  }

  // history is loaded lazily via loadHistory() — revealedHistory holds parsed entries
</script>

<!-- Mobile bar (hidden on desktop via CSS) -->
<div class="record-bar">
  <button class="icon-btn" onclick={onback} aria-label="Back">
    <Icon name="back" size={22}/>
  </button>
  <div class="record-bar-group muted">{record.Group ?? ''}</div>
  <button class="btn-text primary" onclick={onedit} style={onedit ? '' : 'visibility:hidden;pointer-events:none'}>Edit</button>
</div>

<!-- Desktop pane header (hidden on mobile via CSS) -->
{#if isDesktop}
  <div class="record-pane-header">
    <span class="record-bar-group muted">{record.Group ?? ''}</span>
    {#if onedit}
      <div class="record-pane-actions">
        <button class="btn btn-ghost" onclick={onedit} style="height:36px;padding:0 14px;font-size:14px">Edit</button>
      </div>
    {/if}
  </div>
{/if}

<div class="record-body">
  <h1 class="record-title">{record.Title}</h1>

  <div class="copy-rows">
    {#if record.Username}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
          <!-- svelte-ignore a11y_click_events_have_key_events -->
      <div class="copy-row" class:clipboard-active={copiedField === 'Username'} style={copiedField === 'Username' ? drainStyle() : ''}
        role="button" tabindex="0"
        onclick={() => handleCopy(record.Username, 'Username')}
        onkeydown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleCopy(record.Username, 'Username') } }}>
        <div class="copy-row-label muted">Username</div>
        <div class="copy-row-main">
          <div class="copy-row-value">{record.Username}</div>
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <div class="copy-row-actions" onclick={e => e.stopPropagation()}>
            <button class="icon-btn-flat copy-btn" onclick={() => handleCopy(record.Username, 'Username')} aria-label="Copy username">
              <Icon name="copy" size={18}/>
            </button>
          </div>
        </div>
      </div>
    {/if}

    {#if record.Password !== ''}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
          <!-- svelte-ignore a11y_click_events_have_key_events -->
      <div class="copy-row" class:clipboard-active={copiedField === 'Password'} style={copiedField === 'Password' ? drainStyle() : ''}
        role="button" tabindex="0"
        onclick={() => handleWasmCopy('Password')}
        onkeydown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleWasmCopy('Password') } }}>
        <div class="copy-row-label muted">Password</div>
        <div class="copy-row-main">
          <div class="copy-row-value">
            <span class="mono">{revealed && revealedPassword !== null ? revealedPassword : '••••••••••••'}</span>
          </div>
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <div class="copy-row-actions" onclick={e => e.stopPropagation()}>
            <button class="icon-btn-flat" onclick={toggleRevealPassword} aria-label="Reveal password">
              <Icon name={revealed ? 'eye-off' : 'eye'} size={18}/>
            </button>
            <button class="icon-btn-flat copy-btn" onclick={() => handleWasmCopy('Password')} aria-label="Copy password">
              <Icon name="copy" size={18}/>
            </button>
          </div>
        </div>
        <!-- svelte-ignore a11y_no_static_element_interactions -->
          <!-- svelte-ignore a11y_click_events_have_key_events -->
        <div onclick={e => e.stopPropagation()}>
          {#if revealed && record.PasswordHistory !== ''}
            <button class="history-toggle" onclick={loadHistory}>
              {showHistory ? 'Hide' : 'History'}{revealedHistory ? ` · ${revealedHistory.length} previous` : ''}
            </button>
          {/if}
          {#if showHistory && revealedHistory}
            <div class="history-list">
              {#each revealedHistory as entry}
                <div class="history-entry" class:clipboard-active={copiedField === `history-${entry.ts}`} style={copiedField === `history-${entry.ts}` ? drainStyle() : ''}>
                  <span class="history-time muted">{relTimeUnix(entry.ts)}</span>
                  <span class="history-pw mono">{entry.password}</span>
                  <button class="icon-btn-flat" onclick={() => handleCopy(entry.password, `history-${entry.ts}`)} aria-label="Copy">
                    <Icon name="copy" size={15}/>
                  </button>
                </div>
              {/each}
            </div>
          {/if}
        </div>
      </div>
    {/if}

  {#if record.TwoFactorKey !== undefined}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
          <!-- svelte-ignore a11y_click_events_have_key_events -->
    <div class="copy-row" class:clipboard-active={copiedField === 'otp'}
      style={copiedField === 'otp' ? `--drain-name: clip-drain-${animVariant}; --flash-name: clip-flash-${animVariant}; --clip-delay: -30000ms; --flash-duration: 450ms` : ''}
      role="button" tabindex="0"
      onclick={handleTOTPCopy}
      onkeydown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleTOTPCopy() } }}>
      <div class="copy-row-label muted">One-time code</div>
      <div class="copy-row-main">
        <div class="copy-row-value">
          <span class="mono">
            {#if totpData}
              {totpRevealed ? totpData.code : '•'.repeat(totpData.code.length)}
            {:else}
              <span class="muted">—</span>
            {/if}
          </span>
        </div>
        <!-- svelte-ignore a11y_no_static_element_interactions -->
          <!-- svelte-ignore a11y_click_events_have_key_events -->
        <div class="copy-row-actions" onclick={e => e.stopPropagation()}>
          <button class="icon-btn-flat" onclick={() => totpRevealed = !totpRevealed} aria-label={totpRevealed ? 'Hide code' : 'Reveal code'}>
            <Icon name={totpRevealed ? 'eye-off' : 'eye'} size={18}/>
          </button>
          <button class="icon-btn-flat copy-btn" onclick={handleTOTPCopy} aria-label="Copy one-time code" disabled={!totpData}>
            <Icon name="copy" size={18}/>
          </button>
        </div>
      </div>
      {#if totpData}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
          <!-- svelte-ignore a11y_click_events_have_key_events -->
        <div class="totp-bar" onclick={e => e.stopPropagation()}>
          <div class="totp-bar-fill" class:totp-instant={totpBarInstant}
            style="width:{(totpData.seconds / totpData.period) * 100}%"></div>
        </div>
      {/if}
    </div>
  {/if}

    {#if record.URL}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
          <!-- svelte-ignore a11y_click_events_have_key_events -->
      <div class="copy-row" class:clipboard-active={copiedField === 'URL'} style={copiedField === 'URL' ? drainStyle() : ''}
        role="button" tabindex="0"
        onclick={() => handleCopy(record.URL, 'URL')}
        onkeydown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleCopy(record.URL, 'URL') } }}>
        <div class="copy-row-label muted">URL</div>
        <div class="copy-row-main">
          <div class="copy-row-value">{record.URL}</div>
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <div class="copy-row-actions" onclick={e => e.stopPropagation()}>
            <a class="icon-btn-flat" href={record.URL} target="_blank" rel="noreferrer" aria-label="Open URL">
              <Icon name="external" size={18}/>
            </a>
            <button class="icon-btn-flat copy-btn" onclick={() => handleCopy(record.URL, 'URL')} aria-label="Copy URL">
              <Icon name="copy" size={18}/>
            </button>
          </div>
        </div>
      </div>
    {/if}

  {#if bookmarkletsSupported}
    {@const autotypeSeq = record.Autotype || ''}
    {@const isDefault = !autotypeSeq}
    {@const displaySeq = autotypeSeq || '\\u\\t\\p\\n'}
    <div class="record-autotype">
      <div class="autotype-header">
        <div class="autotype-label-group">
          <div class="copy-row-label muted">Autofill sequence</div>
          {#if isDefault}<span class="autofill-default-badge">default</span>{/if}
          {#if !hasDelegates}
            <button class="autofill-info-btn" type="button"
              onclick={() => showAutofillInfo = !showAutofillInfo}
              aria-label="About autofill">ⓘ</button>
          {/if}
        </div>
        <div class="mode-toggle">
          <button type="button" class:active={autofillMode === 'visual'} onclick={() => autofillMode = 'visual'}>Visual</button>
          <button type="button" class:active={autofillMode === 'raw'} onclick={() => autofillMode = 'raw'}>Raw</button>
        </div>
      </div>
      {#if showAutofillInfo}
        <div class="autofill-info-card">
          Autofill types your credentials into web forms automatically. To use it, open Vault settings and install a bookmarklet in your browser.
        </div>
      {/if}
      {#if autofillMode === 'visual'}
        {@const toks = parseTokens(displaySeq, record.CustomFields)}
        {@const warn = !isDefault ? warnAutotype(displaySeq) : ''}
        <div class="chip-area" role="list" class:chip-area-warn={warn} class:chip-area-default={isDefault}>
          {#each toks as tok, i}
            <div class="chip chip-{tok.type}" role="listitem">
              {#if tok.type === 'error'}<span class="chip-pre chip-pre-error">✕</span>
              {:else if tok.type === 'unknown'}<span class="chip-pre chip-pre-warn">⚠</span>{/if}
              <span class="chip-label">{#if tok.type === 'literal'}<span class="mono">{tok.value}</span>{:else}{tok.label}{/if}</span>
              {#if tok.suffix}<span class="chip-nav-suffix">{tok.suffix}</span>{/if}
            </div>
            {#if i < toks.length - 1}
              <span class="chip-sep" role="separator">→</span>
            {/if}
          {/each}
        </div>
        {#if warn}
          <div class="autotype-warning">{warn}</div>
        {/if}
      {:else}
        <div class="autotype-value mono">{displaySeq}</div>
      {/if}
    </div>
  {/if}

  {#if record.Email}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
          <!-- svelte-ignore a11y_click_events_have_key_events -->
    <div class="copy-row" class:clipboard-active={copiedField === 'Email'} style={copiedField === 'Email' ? drainStyle() : ''}
      role="button" tabindex="0"
      onclick={() => handleCopy(record.Email, 'Email')}
      onkeydown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleCopy(record.Email, 'Email') } }}>
      <div class="copy-row-label muted">Email</div>
      <div class="copy-row-main">
        <div class="copy-row-value">{record.Email}</div>
        <!-- svelte-ignore a11y_no_static_element_interactions -->
          <!-- svelte-ignore a11y_click_events_have_key_events -->
        <div class="copy-row-actions" onclick={e => e.stopPropagation()}>
          <button class="icon-btn-flat copy-btn" onclick={() => handleCopy(record.Email, 'Email')} aria-label="Copy email">
            <Icon name="copy" size={18}/>
          </button>
        </div>
      </div>
    </div>
  {/if}

  {#each (record.CustomFields ?? []).slice(0, 9) as cf, i}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
          <!-- svelte-ignore a11y_click_events_have_key_events -->
    <div class="copy-row" class:clipboard-active={copiedField === `custom-${i}`} style={copiedField === `custom-${i}` ? drainStyle() : ''}
      role="button" tabindex="0"
      onclick={() => cf.Value === null ? handleWasmCustomCopy(cf.Name, `custom-${i}`) : handleCopy(cf.Value, `custom-${i}`)}
      onkeydown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); cf.Value === null ? handleWasmCustomCopy(cf.Name, `custom-${i}`) : handleCopy(cf.Value, `custom-${i}`) } }}>
      <div class="copy-row-label muted">{cf.Name}</div>
      <div class="copy-row-main">
        <div class="copy-row-value">
          <span class:mono={cf.Sensitive}>
            {#if cf.Value === null}
              {customRevealed[i] && revealedCustomValues[i] !== null ? revealedCustomValues[i] : '••••••••••••'}
            {:else}
              {cf.Sensitive && !customRevealed[i] ? '••••••••••••' : cf.Value}
            {/if}
          </span>
        </div>
        <!-- svelte-ignore a11y_no_static_element_interactions -->
          <!-- svelte-ignore a11y_click_events_have_key_events -->
        <div class="copy-row-actions" onclick={e => e.stopPropagation()}>
          {#if cf.Sensitive}
            <button class="icon-btn-flat" onclick={() => {
              if (cf.Value === null) {
                if (customRevealed[i]) { customRevealed[i] = false; revealedCustomValues[i] = null }
                else { revealedCustomValues[i] = getCustomFieldValue(vaultUuid, uuid, cf.Name); customRevealed[i] = true }
              } else {
                customRevealed[i] = !customRevealed[i]
              }
            }} aria-label={customRevealed[i] ? 'Hide value' : 'Reveal value'}>
              <Icon name={customRevealed[i] ? 'eye-off' : 'eye'} size={18}/>
            </button>
          {/if}
          <button class="icon-btn-flat copy-btn" onclick={() => cf.Value === null ? handleWasmCustomCopy(cf.Name, `custom-${i}`) : handleCopy(cf.Value, `custom-${i}`)} aria-label="Copy {cf.Name}">
            <Icon name="copy" size={18}/>
          </button>
        </div>
      </div>
    </div>
  {/each}
  </div>

  {#if record.Notes !== ''}
    <div class="record-notes">
      <div class="notes-label-row">
        <span class="copy-row-label muted">Notes</span>
        <button class="icon-btn-flat" onclick={toggleRevealNotes} aria-label={notesRevealed ? 'Hide notes' : 'Reveal notes'}>
          <Icon name={notesRevealed ? 'eye-off' : 'eye'} size={16}/>
        </button>
      </div>
      <div class="notes-text mono">{notesRevealed && revealedNotes !== null ? revealedNotes : '••••••••••••••••'}</div>
    </div>
  {/if}

  {#if record.ModTime && new Date(record.ModTime).getTime() > 0}
    <div class="record-meta muted">Modified {relTime(record.ModTime)}</div>
  {/if}
</div>

<style>
  .totp-bar {
    height: 2px;
    background: var(--border);
    border-radius: 1px;
    margin-top: 6px;
    overflow: hidden;
  }
  .totp-bar-fill {
    height: 100%;
    background: var(--text-soft);
    border-radius: 1px;
    transition: width 1s linear;
  }
  .totp-bar-fill.totp-instant { transition: none; }

  .notes-label-row {
    display: flex;
    align-items: center;
    gap: 4px;
    margin-bottom: 4px;
  }
  .notes-label-row .copy-row-label {
    margin-bottom: 0;
  }
  .history-toggle {
    background: none;
    border: none;
    cursor: pointer;
    font-size: 12px;
    color: var(--text-soft);
    padding: 4px 4px 0;
    text-align: left;
  }
  .history-toggle:hover { color: var(--accent); }

  .history-list {
    margin-top: 6px;
    border-top: 1px solid var(--border);
    display: flex;
    flex-direction: column;
  }

  .history-entry {
    position: relative; isolation: isolate;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 7px 4px;
    border-bottom: 1px solid var(--border);
  }
  .history-entry:last-child { border-bottom: none; }

  .history-time {
    font-size: 12px;
    white-space: nowrap;
    flex-shrink: 0;
    min-width: 56px;
  }

  .history-pw {
    flex: 1;
    font-size: 13px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .record-autotype {
    padding: 12px 0 4px;
  }

  .autotype-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin-bottom: 6px;
  }
  .autotype-header .copy-row-label { margin-bottom: 0; }
  .autotype-label-group {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .autofill-default-badge {
    font-size: 11px;
    font-weight: 600;
    color: var(--text-muted);
    background: var(--surface-2);
    border: 1px solid var(--border-strong);
    border-radius: 4px;
    padding: 1px 5px;
  }
  .autofill-info-btn {
    background: none;
    border: none;
    cursor: pointer;
    font-size: 15px;
    color: var(--text-muted);
    padding: 0;
    line-height: 1;
  }
  .autofill-info-btn:hover { color: var(--accent); }
  .autofill-info-card {
    background: var(--surface-2);
    border: 1px solid var(--border-strong);
    border-radius: 8px;
    padding: 10px 12px;
    font-size: 13px;
    color: var(--text-soft);
    line-height: 1.5;
    margin-bottom: 8px;
  }
  .chip-area-default {
    opacity: 0.7;
  }

  .mode-toggle {
    display: flex;
    border: 1px solid var(--border-strong);
    border-radius: 8px;
    overflow: hidden;
  }
  .mode-toggle button {
    background: none;
    border: none;
    cursor: pointer;
    font-size: 12px;
    font-weight: 500;
    color: var(--text-muted);
    padding: 4px 10px;
    transition: background 0.1s, color 0.1s;
  }
  .mode-toggle button.active {
    background: var(--surface-2);
    color: var(--text);
    font-weight: 700;
  }

  .chip-area {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    border: 2px solid var(--border-strong);
    border-radius: 9px;
    background: var(--surface-2);
    padding: 10px 12px;
  }
  .chip-area-warn {
    border-color: var(--orange);
    background: var(--orange-bg-strong);
  }
  .chip-sep {
    color: var(--text-soft);
    font-size: 12px;
    user-select: none;
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    border-radius: 100px;
    padding: 4px 10px;
    font-size: 13px;
    font-weight: 500;
    cursor: default;
    user-select: none;
  }
  .chip-field {
    background: var(--amber-bg);
    color: var(--amber);
    font-weight: 600;
  }
  .chip-nav {
    background: var(--surface);
    color: var(--text-muted);
  }
  .chip-literal {
    background: transparent;
    color: var(--text);
    font-weight: 400;
    border: 1px solid var(--border-strong);
  }
  .chip-wait {
    background: var(--wait-blue-bg);
    color: var(--wait-blue);
  }
  .chip-unknown {
    background: transparent;
    color: var(--orange);
    font-weight: 600;
    border: 1.5px solid var(--orange);
  }
  .chip-error {
    background: transparent;
    color: var(--danger);
    font-weight: 600;
    border: 1.5px solid var(--danger);
  }
  .chip-pre { font-size: 11px; }
  .chip-pre-error { color: var(--danger); }
  .chip-pre-warn { color: var(--orange); }
  .chip-nav-suffix {
    font-size: 11px;
    opacity: 0.55;
    margin-left: 1px;
  }
  .chip-label { line-height: 1; }

  .autotype-value {
    font-size: 14px;
    color: var(--text-soft);
    padding: 2px 0;
  }

  .autotype-warning {
    font-size: 12px;
    color: var(--accent);
    margin-top: 4px;
  }
</style>
