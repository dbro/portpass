<script>
  import { untrack } from 'svelte'
  import Icon from './Icon.svelte'
  import PasswordGenerator from './PasswordGenerator.svelte'
  import { generatePassword, loadOpts } from './passwordgen.js'
  import { getAutocompleteSuggestion, getFieldValue, getCustomFieldValue } from '../wasm.js'

  // --- TOTP helpers ---
  const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

  function base32Encode(bytes) {
    let bits = '', out = ''
    for (const b of bytes) bits += b.toString(2).padStart(8, '0')
    for (let i = 0; i + 5 <= bits.length; i += 5) out += B32[parseInt(bits.slice(i, i + 5), 2)]
    const rem = bits.length % 5
    if (rem > 0) out += B32[parseInt(bits.slice(-rem).padEnd(5, '0'), 2)]
    return out
  }

  function base64ToBase32(b64) {
    if (!b64) return ''
    try {
      const bin = atob(b64)
      const bytes = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
      return base32Encode(bytes)
    } catch { return '' }
  }

  function parseOtpAuthUri(uri) {
    // Use regex rather than new URL() — custom protocols are unreliable across browsers
    const m = uri.match(/^otpauth:\/\/([^/?#]+)(?:\/[^?#]*)?(?:\?(.*))?$/i)
    if (!m) return { error: 'Invalid URI' }
    const type = m[1].toLowerCase()
    if (type !== 'totp') return { error: 'Only TOTP is supported (not HOTP)' }
    const params = {}
    ;(m[2] || '').split('&').forEach(p => {
      const eq = p.indexOf('=')
      if (eq > 0) params[decodeURIComponent(p.slice(0, eq)).toLowerCase()] = decodeURIComponent(p.slice(eq + 1))
    })
    const secret = params.secret
    if (!secret) return { error: 'No secret found in URI' }
    const algorithm = (params.algorithm || 'SHA1').toUpperCase()
    if (algorithm !== 'SHA1') return { error: `Algorithm ${algorithm} is not supported` }
    const digits = parseInt(params.digits || '6')
    const period = parseInt(params.period || '30')
    return { secret: secret.toUpperCase().replace(/[\s-]/g, ''), digits, period }
  }

  let { record, isNew, isDesktop, vaultUuid, rwVaults = [], onvaultchange, oncancel, onsave, ondelete, ondirtychange } = $props()

  let vaultDropOpen = $state(false)

  function focusOnMount(node, condition = true) {
    if (condition) setTimeout(() => node.focus(), 0)
  }

  // Track which sensitive fields were withheld in the original record (null = withheld, '' = empty)
  const passwordWasWithheld = untrack(() => record?.Password === null)
  const notesWasWithheld    = untrack(() => record?.Notes    === null)
  const totpWasConfigured   = untrack(() => record?.TwoFactorKey === null)

  // Destructure once — null sensitive values start as '' in the edit form
  const initRec = untrack(() => record ?? {})
  const { Title = '', Group = '', Username = '', URL = '', Email = '', Autotype = '' } = initRec
  const Password = initRec.Password ?? ''
  const Notes    = initRec.Notes    ?? ''
  let draft = $state({ Title, Group, Username, Password, URL, Email, Notes, Autotype })

  // TOTP state — kept separate from draft; merged into save call
  let totpSecret   = $state(untrack(() => base64ToBase32(record?.TwoFactorKey ?? '')))
  let totpDigits   = $state(untrack(() => record?.TOTPLength || 6))
  let totpPeriod   = $state(untrack(() => record?.TOTPTimeStep || 30))

  // Custom fields — independent editable copy of initial prop value
  let customFields = $state(untrack(() => (record?.CustomFields ?? []).slice(0, 9).map(cf => ({ Name: cf.Name, Value: cf.Value, Sensitive: !!cf.Sensitive }))))
  let totpGearOpen = $state(false)
  let totpRevealed = $state(false)
  let totpError    = $state('')
  // When TOTP was configured (withheld), track if user has focused the field
  // (indicating intent to interact with it — used to detect intentional clearing)
  let totpFieldTouched  = $state(false)
  let totpLoadedSecret  = $state('')  // base32 secret loaded via GetFieldValue; used as baseline

  function onTOTPInput(e) {
    const val = e.target.value.trim()
    totpSecret = val
    totpFieldTouched = true
    totpError = ''
    if (!val) return
    if (val.toLowerCase().startsWith('otpauth://')) {
      const parsed = parseOtpAuthUri(val)
      if (!parsed) { totpError = 'Invalid URI'; return }
      if (parsed.error) { totpError = parsed.error; return }
      totpSecret = parsed.secret
      totpDigits = parsed.digits
      totpPeriod = parsed.period
      e.target.value = parsed.secret
    }
  }
  let showPw    = $state(false)
  let pwLoading = $state(false)

  async function revealOrTogglePassword() {
    if (passwordWasWithheld && !draft.Password) {
      // Load the withheld password into the draft on first reveal
      pwLoading = true
      const val = getFieldValue(vaultUuid, record?.UUID, 'Password')
      set('Password', val ?? '')
      pwLoading = false
    }
    showPw = !showPw
  }
  let genOpen     = $state(false)
  let showHistory = $state(false)

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
    return entries.reverse()
  }

  function relTimeUnix(ts) {
    const d = new Date(ts * 1000), now = new Date(), diff = (now - d) / 1000
    if (diff < 60)       return 'just now'
    if (diff < 3600)     return `${Math.floor(diff/60)}m ago`
    if (diff < 86400)    return `${Math.floor(diff/3600)}h ago`
    if (diff < 86400*7)  return `${Math.floor(diff/86400)}d ago`
    if (diff < 86400*30) return `${Math.floor(diff/(86400*7))}w ago`
    return d.toLocaleDateString()
  }

  // PasswordHistory is null (withheld) — load lazily on first access
  let loadedHistory = $state(null)
  $effect(() => {
    if (record?.PasswordHistory === null && loadedHistory === null) {
      const raw = getFieldValue(vaultUuid, record?.UUID, 'PasswordHistory')
      loadedHistory = parseHistory(raw ?? '')
    }
  })
  let history = $derived(
    typeof record?.PasswordHistory === 'string' ? parseHistory(record.PasswordHistory) :
    loadedHistory ?? []
  )

  let groupGhost    = $state('')
  let usernameGhost = $state('')

  let totpChanged = $derived(
    (totpWasConfigured && totpFieldTouched && !totpSecret) ||  // user focused and cleared
    totpSecret !== (totpLoadedSecret || base64ToBase32(record?.TwoFactorKey ?? '')) ||
    (totpDigits !== (record?.TOTPLength || 6)) ||
    (totpPeriod !== (record?.TOTPTimeStep || 30))
  )
  let customFieldsDirty = $derived.by(() => {
    const orig = (record?.CustomFields ?? []).slice(0, 9)
    if (orig.length !== customFields.length) return true
    return customFields.some((cf, i) =>
      cf.Name !== orig[i].Name || cf.Value !== orig[i].Value || cf.Sensitive !== !!orig[i].Sensitive
    )
  })
  let dirty   = $derived(!record || Object.keys(draft).some(k => (record[k] ?? '') !== draft[k]) || totpChanged || customFieldsDirty)
  // null Value = withheld sensitive field (counts as valid — keep existing)
  let customFieldsValid = $derived(customFields.every(cf => cf.Name.trim() !== '' && (cf.Value !== '' || cf.Value === null)))
  let canSave = $derived(dirty && !!draft.Title && (!!draft.Password || passwordWasWithheld) && !totpError && customFieldsValid && !autotypeError)

  function buildSaveDraft() {
    const d = { ...draft }
    // Omit withheld sensitive fields that the user didn't change — keep existing vault values
    if (passwordWasWithheld && !draft.Password) delete d.Password
    if (notesWasWithheld    && !draft.Notes)    delete d.Notes
    // Only update TOTP if the user changed it or is setting it for the first time
    if (!totpWasConfigured || totpChanged) {
      d.TwoFactorKey = totpSecret
      d.TOTPLength   = String(totpDigits)
      d.TOTPTimeStep = String(totpPeriod)
    }
    d.CustomFields = customFields.slice()
    return d
  }

  // Notify parent of dirty state changes
  $effect(() => {
    ondirtychange?.(dirty)
  })

  function set(k, v) { draft = { ...draft, [k]: v } }

  // Returns just the suffix to append, or '' if no useful suggestion
  function ghostFor(field, value) {
    if (!value) return ''
    const suggestion = getAutocompleteSuggestion(vaultUuid, field, value)
    if (!suggestion) return ''
    // Only offer if suggestion starts with what the user typed (case-insensitive)
    if (!suggestion.toLowerCase().startsWith(value.toLowerCase())) return ''
    // Don't offer if already an exact match
    if (suggestion.toLowerCase() === value.toLowerCase()) return ''
    return suggestion.slice(value.length)
  }

  function onGroupInput(e) {
    const v = e.target.value
    set('Group', v)
    groupGhost = ghostFor('group', v)
  }

  function onGroupKeydown(e) {
    if (e.key === 'Tab' && groupGhost) {
      e.preventDefault()
      const suggestion = getAutocompleteSuggestion(vaultUuid, 'group', draft.Group)
      set('Group', suggestion)
      groupGhost = ''
    } else if (e.key === 'Escape') {
      groupGhost = ''
    }
  }

  function onUsernameInput(e) {
    const v = e.target.value
    set('Username', v)
    usernameGhost = ghostFor('username', v)
  }

  function onUsernameKeydown(e) {
    if (e.key === 'Tab' && usernameGhost) {
      e.preventDefault()
      const suggestion = getAutocompleteSuggestion(vaultUuid, 'username', draft.Username)
      set('Username', suggestion)
      usernameGhost = ''
    } else if (e.key === 'Escape') {
      usernameGhost = ''
    }
  }

  function quickGenerate() {
    set('Password', generatePassword(loadOpts()))
  }

  function usePassword(pw) {
    set('Password', pw)
    genOpen = false
  }

  // Returns a blocking error string (prevents save) for structural problems.
  function validateAutotype(seq) {
    if (!seq) return ''
    let i = 0
    while (i < seq.length) {
      if (seq[i] !== '\\') { i++; continue }
      if (i + 1 >= seq.length) return 'Sequence ends with \\'
      const code = seq[i + 1]
      if (code === 'f') {
        const d = seq[i + 2]
        if (d !== undefined && /^[0-9]$/.test(d)) {
          if (d === '0') return '\\f0 is not valid — field numbers start at 1'
          i += 3
        } else {
          i += 2
        }
      } else if (code === 'w' || code === 'W') {
        let j = i + 2, count = 0
        while (j < seq.length && count < 3 && /^[0-9]$/.test(seq[j])) { j++; count++ }
        if (count === 0) return `\\${code} must be followed by 1–3 digits`
        i = j
      } else {
        i += 2  // known and unknown codes both advance; unknown flagged by warnAutotype
      }
    }
    return ''
  }

  // Returns a warning string (non-blocking) for codes Portpass doesn't support.
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

  let autotypeError   = $derived(validateAutotype(draft.Autotype))
  let autotypeWarning = $derived(!autotypeError ? warnAutotype(draft.Autotype) : '')

  // --- Visual chip builder ---
  function parseTokens(seq, cf) {
    if (!seq) return []
    const toks = []
    let lit = '', i = 0
    const fl = () => { if (lit) { toks.push({ type: 'literal', value: lit }); lit = '' } }
    while (i < seq.length) {
      if (seq[i] !== '\\') { lit += seq[i++]; continue }
      if (i + 1 >= seq.length) {
        fl()
        toks.push({ type: 'error', raw: '\\', label: 'trailing \\', message: 'Sequence ends with \\' })
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
            toks.push({ type: 'error', raw: '\\f0', label: '\\f0 invalid', message: '\\f0 is not valid — field numbers start at 1' }); i += 3
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
          toks.push({ type: 'error', raw: `\\${c}`, label: `\\${c} no digits`, message: `\\${c} must be followed by 1–3 digits` }); i += 2
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

  function tokensToRaw(toks) {
    return toks.map(t => t.type === 'literal' ? t.value.replace(/\\/g, '\\\\') : t.raw).join('')
  }

  const savedAutotype = untrack(() => record?.Autotype ?? '')
  let autofillMode = $state('visual')
  let dragIdx = $state(-1), dropIdx = $state(-1)
  let activeMiniForm = $state('')
  let literalInput = $state(''), waitAmount = $state('500'), waitUnit = $state('ms')
  let tokens = $derived(parseTokens(draft.Autotype, customFields))

  function removeToken(idx) {
    set('Autotype', tokensToRaw(tokens.filter((_, i) => i !== idx)))
  }
  function addRaw(raw) { set('Autotype', draft.Autotype + raw) }
  function addLiteralToken() {
    if (!literalInput) return
    addRaw(literalInput.replace(/\\/g, '\\\\'))
    literalInput = ''; activeMiniForm = ''
  }
  function addWaitToken() {
    const n = parseInt(waitAmount)
    if (!n || n < 1 || n > 999) return
    addRaw(`\\${waitUnit === 'ms' ? 'w' : 'W'}${n}`)
    waitAmount = '500'; activeMiniForm = ''
  }
  function onChipDrop() {
    if (dragIdx === -1) return
    const arr = tokens.slice()
    const [moved] = arr.splice(dragIdx, 1)
    arr.splice(dragIdx < dropIdx ? dropIdx - 1 : dropIdx, 0, moved)
    set('Autotype', tokensToRaw(arr))
    dragIdx = -1; dropIdx = -1
  }
  function resetAutotype() { set('Autotype', savedAutotype) }
</script>

{#if genOpen}
  <PasswordGenerator onclose={() => genOpen = false} onuse={usePassword}/>
{:else}

  <div class="record-bar" style={isDesktop ? 'display:none' : ''}>
    <button class="btn-text" onclick={oncancel}>Cancel</button>
    <div class="record-bar-group muted">{isNew ? 'New' : 'Edit'}</div>
    <button class="btn-text primary" disabled={!canSave} onclick={() => onsave(buildSaveDraft())}>Save</button>
  </div>

  {#if isDesktop}
    <div class="record-pane-header">
      <span class="record-bar-group muted">{isNew ? 'New' : 'Edit'}</span>
      <div class="record-pane-actions">
        <button class="btn-text" onclick={oncancel}>Cancel</button>
        <button class="btn btn-primary" disabled={!canSave} onclick={() => onsave(buildSaveDraft())}
          style="height:36px;padding:0 14px;font-size:14px">Save</button>
      </div>
    </div>
  {/if}

  <div class="record-body" style="display:flex;flex-direction:column;gap:16px">
    {#if isNew && rwVaults.length > 1}
      <div class="field">
        <span class="field-label muted">Save to vault</span>
        <div class="vault-select-wrap">
          <button type="button" class="input vault-select-trigger" onclick={() => vaultDropOpen = !vaultDropOpen}>
            <span>{rwVaults.find(v => v.uuid === vaultUuid)?.name ?? ''}</span>
            <span class="vault-select-arrow">▾</span>
          </button>
          {#if vaultDropOpen}
            <button type="button" class="vault-select-backdrop" tabindex="-1" aria-label="Close" onclick={() => vaultDropOpen = false}></button>
            <div class="vault-select-menu">
              {#each rwVaults as v}
                <button type="button" class="vault-select-option" class:on={v.uuid === vaultUuid}
                  onclick={() => { onvaultchange?.(v.uuid); vaultDropOpen = false }}>
                  {v.name}
                </button>
              {/each}
            </div>
          {/if}
        </div>
      </div>
    {/if}
    <label class="field">
      <span class="field-label muted">Title</span>
      <input class="input" class:warn={dirty && !draft.Title} value={draft.Title} oninput={e => set('Title', e.target.value)}
        placeholder="e.g. Bank of America" use:focusOnMount={isNew}/>
    </label>

    <div class="field">
      <span class="field-label muted">Group</span>
      <div class="ac-wrap">
        {#if groupGhost}
          <div class="ac-ghost" aria-hidden="true">
            <span class="ac-typed">{draft.Group}</span><span class="ac-suffix">{groupGhost}</span>
          </div>
        {/if}
        <input
          class="input"
          value={draft.Group}
          placeholder="e.g. Banking"
          oninput={onGroupInput}
          onkeydown={onGroupKeydown}
          onblur={() => groupGhost = ''}
        />
      </div>
    </div>

    <div class="field">
      <span class="field-label muted">Username</span>
      <div class="ac-wrap">
        {#if usernameGhost}
          <div class="ac-ghost" aria-hidden="true">
            <span class="ac-typed">{draft.Username}</span><span class="ac-suffix">{usernameGhost}</span>
          </div>
        {/if}
        <input
          class="input"
          value={draft.Username}
          oninput={onUsernameInput}
          onkeydown={onUsernameKeydown}
          onblur={() => usernameGhost = ''}
        />
      </div>
    </div>

    <div class="field">
      <span class="field-label muted">Password</span>
      <div class="input-wrap" class:warn={dirty && !draft.Password && !passwordWasWithheld}>
        <input
          class="input mono"
          type={showPw ? 'text' : 'password'}
          value={draft.Password}
          placeholder={passwordWasWithheld && !draft.Password ? '••••••••••••' : ''}
          oninput={e => set('Password', e.target.value)}
        />
        <button class="icon-btn-flat" onclick={() => genOpen = true} aria-label="Open password generator">
          <Icon name="refresh" size={18}/>
        </button>
        <button class="icon-btn-flat" onclick={revealOrTogglePassword} disabled={pwLoading} aria-label="Toggle visibility">
          <Icon name={showPw ? 'eye-off' : 'eye'} size={18}/>
        </button>
      </div>
      {#if history.length > 0}
        <div class="pw-gen-row">
          <button class="history-toggle" onclick={() => showHistory = !showHistory}>
            {showHistory ? 'Hide' : 'History'} · {history.length}
          </button>
        </div>
      {/if}
      {#if showHistory}
        <div class="history-list">
          {#each history as entry}
            <div class="history-entry">
              <span class="history-time muted">{relTimeUnix(entry.ts)}</span>
              <span class="history-pw mono">{entry.password}</span>
              <button class="icon-btn-flat" onclick={() => set('Password', entry.password)}
                title="Restore this password" aria-label="Restore">
                <Icon name="check" size={15}/>
              </button>
            </div>
          {/each}
        </div>
      {/if}
    </div>

    <div class="field">
      <span class="field-label muted">One-time code secret</span>
      <div class="input-wrap">
        <input
          class="input mono"
          type={totpRevealed ? 'text' : 'password'}
          value={totpSecret}
          oninput={onTOTPInput}
          onfocus={() => { totpFieldTouched = true }}
          placeholder={totpWasConfigured && !totpSecret ? '••••••••••••' : 'Base32 secret or otpauth:// URI'}
          autocomplete="off"
          spellcheck="false"
        />
        <button class="icon-btn-flat" type="button" onclick={() => totpGearOpen = !totpGearOpen}
          aria-label="TOTP settings" class:active={totpGearOpen}>
          <Icon name="settings" size={18}/>
        </button>
        <button class="icon-btn-flat" type="button" onclick={() => {
          if (totpWasConfigured && !totpLoadedSecret && !totpRevealed) {
            // Load withheld TOTP secret on first reveal (returned as base32)
            const val = getFieldValue(vaultUuid, record?.UUID, 'TwoFactorKey')
            if (val) { totpSecret = val; totpLoadedSecret = val; totpFieldTouched = false }
          }
          totpRevealed = !totpRevealed
        }}
          aria-label={totpRevealed ? 'Hide secret' : 'Reveal secret'}>
          <Icon name={totpRevealed ? 'eye-off' : 'eye'} size={18}/>
        </button>
      </div>
      {#if totpError}
        <div class="totp-error">{totpError}</div>
      {/if}
      {#if totpGearOpen}
        <div class="totp-gear">
          <label class="totp-gear-row">
            <span class="muted">Digits</span>
            <select class="input totp-select" bind:value={totpDigits}>
              <option value={6}>6</option>
              <option value={8}>8</option>
            </select>
          </label>
          <label class="totp-gear-row">
            <span class="muted">Period</span>
            <select class="input totp-select" bind:value={totpPeriod}>
              <option value={30}>30 s</option>
              <option value={60}>60 s</option>
            </select>
          </label>
        </div>
      {/if}
    </div>

    <label class="field">
      <span class="field-label muted">URL</span>
      <input class="input" value={draft.URL} oninput={e => set('URL', e.target.value)}/>
    </label>

    <label class="field">
      <span class="field-label muted">Email</span>
      <input class="input" type="email" value={draft.Email} oninput={e => set('Email', e.target.value)}/>
    </label>

    <div class="field-label muted">Custom fields</div>

    {#each customFields as cf, i}
      <div class="custom-field-row">
        <input class="input custom-field-name" class:warn={!cf.Name.trim()}
          placeholder="Field name"
          value={cf.Name}
          oninput={e => { customFields = customFields.map((f, j) => j === i ? { ...f, Name: e.target.value } : f) }}
        />
        <div class="input-wrap custom-field-value" class:warn={cf.Value !== null && !cf.Value.trim()}>
          <input class="input"
            type={cf.Sensitive ? 'password' : 'text'}
            placeholder={cf.Value === null && cf.Sensitive ? '••••••••••••' : 'Value'}
            value={cf.Value ?? ''}
            oninput={e => { customFields = customFields.map((f, j) => j === i ? { ...f, Value: e.target.value } : f) }}
          />
          <button class="icon-btn-flat" type="button"
            onclick={() => {
              if (cf.Sensitive && cf.Value === null) {
                // Withheld sensitive → load value then mark not-sensitive
                const val = getCustomFieldValue(vaultUuid, record?.UUID, cf.Name)
                customFields = customFields.map((f, j) => j === i ? { ...f, Sensitive: false, Value: val ?? '' } : f)
              } else {
                // Toggle sensitive flag
                customFields = customFields.map((f, j) => j === i ? { ...f, Sensitive: !f.Sensitive } : f)
              }
            }}
            aria-label={cf.Sensitive ? 'Show value' : 'Hide value'}>
            <Icon name={cf.Sensitive ? 'eye' : 'eye-off'} size={18}/>
          </button>
        </div>
        <button class="icon-btn-flat danger" type="button"
          onclick={() => { customFields = customFields.filter((_, j) => j !== i) }}
          aria-label="Remove field">
          <Icon name="trash" size={18}/>
        </button>
      </div>
    {/each}

    {#if customFields.length < 9}
      <button class="add-custom-field" type="button"
        onclick={() => { customFields = [...customFields, { Name: '', Value: '', Sensitive: false }] }}>
        + Add custom field
      </button>
    {/if}

    <label class="field">
      <span class="field-label muted">Notes</span>
      <textarea class="input mono" rows={4} value={draft.Notes}
        oninput={e => set('Notes', e.target.value)}></textarea>
    </label>

    <div class="field">
      <div class="autotype-header">
        <span class="field-label muted">Autofill sequence</span>
        <div class="autotype-header-right">
          {#if draft.Autotype !== savedAutotype}
            <button type="button" class="autotype-reset" onclick={resetAutotype}>↩ Reset</button>
          {/if}
          <div class="mode-toggle">
            <button type="button" class:active={autofillMode === 'visual'} onclick={() => autofillMode = 'visual'}>Visual</button>
            <button type="button" class:active={autofillMode === 'raw'} onclick={() => autofillMode = 'raw'}>Raw</button>
          </div>
        </div>
      </div>

      {#if autofillMode === 'visual'}
        <div class="chip-area" role="list"
          class:chip-area-error={autotypeError}
          class:chip-area-warn={!autotypeError && autotypeWarning}
          ondragover={e => { e.preventDefault(); dropIdx = tokens.length }}
          ondrop={onChipDrop}>
          {#if tokens.length === 0}
            <span class="chip-placeholder">Add tokens from the palette below</span>
          {/if}
          {#each tokens as tok, i}
            {#if dragIdx !== -1 && dropIdx === i}
              <div class="drop-indicator"></div>
            {/if}
            <div class="chip chip-{tok.type}" role="listitem"
              draggable={isDesktop}
              ondragstart={() => { dragIdx = i; dropIdx = i }}
              ondragover={e => { e.preventDefault(); e.stopPropagation(); dropIdx = i }}
              ondrop={e => { e.stopPropagation(); onChipDrop() }}
              ondragend={() => { dragIdx = -1; dropIdx = -1 }}>
              {#if tok.type === 'error'}<span class="chip-pre chip-pre-error">✕</span>
              {:else if tok.type === 'unknown'}<span class="chip-pre chip-pre-warn">⚠</span>{/if}
              <span class="chip-label">{#if tok.type === 'literal'}<span class="mono">{tok.value}</span>{:else}{tok.label}{/if}</span>
              {#if tok.suffix}<span class="chip-nav-suffix">{tok.suffix}</span>{/if}
              <button type="button" class="chip-remove" onclick={() => removeToken(i)} aria-label="Remove">×</button>
            </div>
            {#if i < tokens.length - 1}
              <span class="chip-sep" role="separator"
                ondragover={e => { e.preventDefault(); e.stopPropagation(); dropIdx = i + 1 }}>→</span>
            {/if}
          {/each}
          {#if dragIdx !== -1 && dropIdx === tokens.length}
            <div class="drop-indicator"></div>
          {/if}
        </div>

        <div class="palette">
          <div class="palette-row">
            <span class="palette-label muted">Fields</span>
            <div class="palette-chips">
              <button type="button" class="palette-btn palette-field" onclick={() => addRaw('\\u')}>+ Username</button>
              <button type="button" class="palette-btn palette-field" onclick={() => addRaw('\\p')}>+ Password</button>
              <button type="button" class="palette-btn palette-field" onclick={() => addRaw('\\m')}>+ Email</button>
              <button type="button" class="palette-btn palette-field" onclick={() => addRaw('\\2')}>+ One-time code</button>
              {#each customFields as cf, cfi}
                {#if cf.Name.trim()}
                  <button type="button" class="palette-btn palette-field" onclick={() => addRaw(`\\f${cfi + 1}`)}>+ {cf.Name.trim()}</button>
                {/if}
              {/each}
            </div>
          </div>
          <div class="palette-row">
            <span class="palette-label muted">Navigate</span>
            <div class="palette-chips">
              <button type="button" class="palette-btn" onclick={() => addRaw('\\t')}>+ Tab</button>
              <button type="button" class="palette-btn" onclick={() => addRaw('\\s')}>+ Shift-Tab</button>
              <button type="button" class="palette-btn" onclick={() => addRaw('\\n')}>+ Enter</button>
            </div>
          </div>
          <div class="palette-row">
            <span class="palette-label muted">Other</span>
            <div class="palette-chips">
              <button type="button" class="palette-btn" class:palette-active={activeMiniForm === 'literal'}
                onclick={() => activeMiniForm = activeMiniForm === 'literal' ? '' : 'literal'}>+ Text…</button>
              <button type="button" class="palette-btn palette-wait" class:palette-active={activeMiniForm === 'wait'}
                onclick={() => activeMiniForm = activeMiniForm === 'wait' ? '' : 'wait'}>+ Wait…</button>
            </div>
          </div>
          {#if activeMiniForm === 'literal'}
            <div class="mini-form">
              <span class="muted" style="font-size:12px;white-space:nowrap">Text:</span>
              <input class="input mini-input" bind:value={literalInput} placeholder="text to type"
                onkeydown={e => e.key === 'Enter' && (e.preventDefault(), addLiteralToken())}
                autocomplete="off" spellcheck="false"/>
              <button type="button" class="btn btn-primary mini-add" onclick={addLiteralToken} disabled={!literalInput}>Add</button>
              <button type="button" class="mini-close" onclick={() => activeMiniForm = ''}>×</button>
            </div>
          {/if}
          {#if activeMiniForm === 'wait'}
            <div class="mini-form">
              <span class="muted" style="font-size:12px;white-space:nowrap">Wait</span>
              <input class="input mini-input mini-number" type="number" min="1" max="999" bind:value={waitAmount}
                onkeydown={e => e.key === 'Enter' && (e.preventDefault(), addWaitToken())}/>
              <div class="unit-toggle">
                <button type="button" class:active={waitUnit === 'ms'} onclick={() => waitUnit = 'ms'}>ms</button>
                <button type="button" class:active={waitUnit === 's'} onclick={() => waitUnit = 's'}>s</button>
              </div>
              <button type="button" class="btn btn-primary mini-add" onclick={addWaitToken}>Add</button>
              <button type="button" class="mini-close" onclick={() => activeMiniForm = ''}>×</button>
            </div>
          {/if}
        </div>

        {#if tokens.length > 0}
          <div class="autotype-raw-equiv muted">Raw: <span class="mono">{draft.Autotype}</span></div>
        {/if}

      {:else}
        <input class="input mono autotype-input" value={draft.Autotype}
          placeholder="\u\t\p\n"
          oninput={e => set('Autotype', e.target.value)}
          autocomplete="off" spellcheck="false"/>
        <div class="raw-legend">
          <div class="raw-legend-row">
            <span class="raw-legend-cat muted">Fields</span>
            <span><span class="raw-code">\u</span> Username</span>
            <span><span class="raw-code">\p</span> Password</span>
            <span><span class="raw-code">\m</span> Email</span>
            <span><span class="raw-code">\2</span> OTP</span>
            <span><span class="raw-code">\fN</span> Custom N</span>
          </div>
          <div class="raw-legend-row">
            <span class="raw-legend-cat muted">Navigate</span>
            <span><span class="raw-code">\t</span> Tab</span>
            <span><span class="raw-code">\s</span> Shift-Tab</span>
            <span><span class="raw-code">\n</span> Enter</span>
          </div>
          <div class="raw-legend-row">
            <span class="raw-legend-cat muted">Other</span>
            <span><span class="raw-code">\wNNN</span> wait ms</span>
            <span><span class="raw-code">\WNNN</span> wait s</span>
            <span><span class="raw-code">\\</span> literal \</span>
          </div>
        </div>
      {/if}

      {#if autotypeError}
        <div class="autotype-banner banner-error">
          <span class="banner-icon">⚠</span>
          <div>
            <div class="banner-title">Cannot save — fix the error first</div>
            <div class="banner-body muted">{autotypeError}</div>
          </div>
        </div>
      {:else if autotypeWarning}
        <div class="autotype-banner banner-warn">
          <span class="banner-icon">⚠</span>
          <div>
            <div class="banner-title">Saved with warnings</div>
            <div class="banner-body muted">{autotypeWarning}</div>
          </div>
        </div>
      {/if}
    </div>

    {#if !isNew && ondelete}
      <div class="delete-row">
        <button class="btn-delete" onclick={ondelete}>
          <Icon name="trash" size={16}/>
          Delete {draft.Title}
        </button>
      </div>
    {/if}
  </div>
{/if}

<style>
  .vault-select-wrap {
    position: relative;
  }

  .vault-select-trigger {
    display: flex;
    align-items: center;
    justify-content: space-between;
    cursor: pointer;
    font-size: 15px;
    color: var(--text);
    text-align: left;
  }

  .vault-select-arrow {
    color: var(--text-soft);
    font-size: 14px;
    flex-shrink: 0;
    margin-left: 8px;
  }

  .vault-select-backdrop {
    position: fixed;
    inset: 0;
    z-index: 50;
    border: none;
    background: none;
    padding: 0;
    cursor: default;
  }

  .vault-select-menu {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    right: 0;
    z-index: 51;
    background: var(--surface);
    border: 1px solid var(--border-strong);
    border-radius: var(--r-input);
    box-shadow: var(--shadow);
    overflow: hidden;
  }

  .vault-select-option {
    display: block;
    width: 100%;
    padding: 11px 14px;
    background: none;
    border: none;
    border-bottom: 1px solid var(--border);
    cursor: pointer;
    font-size: 15px;
    color: var(--text);
    text-align: left;
  }
  .vault-select-option:last-child { border-bottom: none; }
  .vault-select-option:hover { background: var(--surface-2); }
  .vault-select-option.on { font-weight: 600; color: var(--accent); }

  .ac-wrap {
    position: relative;
  }

  .ac-ghost {
    position: absolute;
    inset: 0;
    padding: 12px 14px;
    pointer-events: none;
    font-size: 17px;
    font-family: var(--font-ui);
    line-height: 1.45;
    white-space: pre;
    overflow: hidden;
    border: 1px solid transparent;
    border-radius: var(--r-input);
    display: flex;
    align-items: center;
    z-index: 1;
  }

  .ac-typed  { color: transparent; }
  .ac-suffix { color: var(--text-soft); }

  .pw-gen-row {
    display: flex;
    align-items: center;
    gap: 4px;
    margin-top: 2px;
  }

  .history-toggle {
    background: none;
    border: none;
    cursor: pointer;
    font-size: 12px;
    color: var(--text-soft);
    padding: 0 4px;
    margin-left: auto;
  }
  .history-toggle:hover { color: var(--accent); }

  .history-list {
    margin-top: 6px;
    border-top: 1px solid var(--border);
    display: flex;
    flex-direction: column;
  }

  .history-entry {
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

  .totp-error {
    font-size: 12px;
    color: var(--danger);
    margin-top: 4px;
    padding: 0 2px;
  }

  .totp-gear {
    display: flex;
    gap: 12px;
    margin-top: 8px;
    padding: 10px 12px;
    background: var(--surface-2);
    border-radius: var(--r-input);
  }

  .totp-gear-row {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
  }

  .totp-select {
    width: auto;
    padding: 4px 8px;
    font-size: 13px;
  }

  .icon-btn-flat.active { color: var(--accent); }

  .delete-row {
    border-top: 1px solid var(--border);
    padding-top: 16px;
    margin-top: 8px;
  }

  .btn-delete {
    display: flex;
    align-items: center;
    gap: 6px;
    background: none;
    border: none;
    cursor: pointer;
    font-size: 14px;
    color: var(--danger);
    padding: 6px 2px;
    opacity: 0.75;
  }
  .btn-delete:hover { opacity: 1; }

  /* --- Autofill sequence header row --- */
  .autotype-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin-bottom: 6px;
  }
  .autotype-header .field-label { margin-bottom: 0; }
  .autotype-header-right {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-shrink: 0;
  }
  .autotype-reset {
    background: none;
    border: none;
    cursor: pointer;
    font-size: 12px;
    color: var(--text-muted);
    padding: 2px 6px;
    border-radius: 6px;
  }
  .autotype-reset:hover { color: var(--text); background: var(--surface-2); }

  /* Mode toggle pill */
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

  /* --- Chip display area --- */
  .chip-area {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    border: 2px solid var(--border-strong);
    border-radius: 9px;
    background: var(--surface-2);
    min-height: 52px;
    padding: 10px 12px;
  }
  .chip-area-error {
    border-color: var(--danger);
    background: var(--red-bg-strong);
  }
  .chip-area-warn {
    border-color: var(--orange);
    background: var(--orange-bg-strong);
  }
  .chip-placeholder {
    font-style: italic;
    color: var(--text-soft);
    font-size: 13px;
  }

  /* Drop indicator */
  .drop-indicator {
    width: 3px;
    min-height: 24px;
    align-self: stretch;
    background: var(--accent);
    border-radius: 2px;
    flex-shrink: 0;
  }

  /* Chip separator */
  .chip-sep {
    color: var(--text-soft);
    font-size: 12px;
    user-select: none;
  }

  /* Base chip */
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    border-radius: 100px;
    padding: 4px 8px 4px 10px;
    font-size: 13px;
    font-weight: 500;
    cursor: default;
    user-select: none;
  }
  .chip[draggable=true] { cursor: grab; }
  .chip[draggable=true]:active { cursor: grabbing; }

  /* Chip type variants */
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
  .chip-remove {
    background: none;
    border: none;
    cursor: pointer;
    font-size: 14px;
    line-height: 1;
    color: inherit;
    opacity: 0.45;
    padding: 0 0 0 2px;
    margin-left: 2px;
  }
  .chip-remove:hover { opacity: 1; }

  /* --- Palette --- */
  .palette {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-top: 8px;
  }
  .palette-row {
    display: flex;
    align-items: flex-start;
    gap: 8px;
  }
  .palette-label {
    font-size: 12px;
    font-weight: 600;
    min-width: 58px;
    padding-top: 5px;
    flex-shrink: 0;
  }
  .palette-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
  }
  .palette-btn {
    background: var(--surface);
    border: 1px solid var(--border-strong);
    border-radius: 100px;
    padding: 3px 10px;
    font-size: 12px;
    cursor: pointer;
    color: var(--text-muted);
    transition: background 0.1s, border-color 0.1s;
  }
  .palette-btn:hover { background: var(--surface-2); border-color: var(--accent); }
  .palette-field { color: var(--amber); }
  .palette-wait  { color: var(--wait-blue); }
  .palette-active { border-color: var(--accent); background: var(--surface-2); }

  /* --- Inline mini-forms --- */
  .mini-form {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-top: 4px;
    padding: 8px 10px;
    background: var(--surface-2);
    border-radius: 8px;
  }
  .mini-input {
    padding: 5px 10px;
    font-size: 13px;
    height: auto;
    flex: 1;
    min-width: 0;
  }
  .mini-number {
    flex: 0 0 70px;
    -moz-appearance: textfield;
  }
  .mini-number::-webkit-inner-spin-button,
  .mini-number::-webkit-outer-spin-button { display: none; }
  .mini-add {
    padding: 5px 12px;
    font-size: 13px;
    height: auto;
    white-space: nowrap;
    flex-shrink: 0;
  }
  .mini-close {
    background: none;
    border: none;
    cursor: pointer;
    font-size: 16px;
    color: var(--text-soft);
    padding: 0 2px;
    flex-shrink: 0;
  }
  .mini-close:hover { color: var(--text); }

  /* Unit toggle (ms / s) */
  .unit-toggle {
    display: flex;
    border: 1px solid var(--border-strong);
    border-radius: 6px;
    overflow: hidden;
    flex-shrink: 0;
  }
  .unit-toggle button {
    background: none;
    border: none;
    cursor: pointer;
    font-size: 12px;
    color: var(--text-muted);
    padding: 4px 8px;
  }
  .unit-toggle button.active {
    background: var(--surface);
    color: var(--text);
    font-weight: 600;
  }

  /* Raw equivalence line */
  .autotype-raw-equiv {
    font-size: 11px;
    margin-top: 4px;
    padding: 0 2px;
  }

  /* --- Raw mode legend --- */
  .raw-legend {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-top: 6px;
    font-size: 12px;
    color: var(--text-muted);
  }
  .raw-legend-row {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 4px 12px;
  }
  .raw-legend-cat {
    font-weight: 600;
    min-width: 64px;
    flex-shrink: 0;
  }
  .raw-code {
    font-family: var(--font-mono);
    color: var(--amber);
    font-size: 12px;
    letter-spacing: -0.005em;
  }

  /* --- Validation banners --- */
  .autotype-banner {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    border-radius: 8px;
    padding: 10px 14px;
    margin-top: 6px;
  }
  .banner-error {
    border: 1.5px solid var(--danger);
    background: var(--red-bg-strong);
  }
  .banner-warn {
    border: 1.5px solid var(--orange);
    background: var(--orange-bg-strong);
  }
  .banner-icon { font-size: 16px; line-height: 1.4; flex-shrink: 0; }
  .banner-title { font-size: 13px; font-weight: 700; }
  .banner-body { font-size: 12px; margin-top: 2px; }
</style>
