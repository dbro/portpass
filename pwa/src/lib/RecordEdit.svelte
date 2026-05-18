<script>
  import { untrack } from 'svelte'
  import Icon from './Icon.svelte'
  import PasswordGenerator from './PasswordGenerator.svelte'
  import { generatePassword, loadOpts } from './passwordgen.js'
  import { getAutocompleteSuggestion, getFieldValue } from '../wasm.js'

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
  const { Title = '', Group = '', Username = '', URL = '', Email = '' } = initRec
  const Password = initRec.Password ?? ''
  const Notes    = initRec.Notes    ?? ''
  let draft = $state({ Title, Group, Username, Password, URL, Email, Notes })

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
  let totpFieldTouched = $state(false)

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
  let showPw      = $state(false)
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
    totpSecret !== base64ToBase32(record?.TwoFactorKey ?? '') ||
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
  let canSave = $derived(dirty && !!draft.Title && (!!draft.Password || passwordWasWithheld) && !totpError && customFieldsValid)

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
      <div class="input-wrap" class:warn={dirty && !draft.Password}>
        <input
          class="input mono"
          type={showPw ? 'text' : 'password'}
          value={draft.Password}
          oninput={e => set('Password', e.target.value)}
        />
        <button class="icon-btn-flat" onclick={() => genOpen = true} aria-label="Open password generator">
          <Icon name="refresh" size={18}/>
        </button>
        <button class="icon-btn-flat" onclick={() => showPw = !showPw} aria-label="Toggle visibility">
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
          placeholder="Base32 secret or otpauth:// URI"
          autocomplete="off"
          spellcheck="false"
        />
        <button class="icon-btn-flat" type="button" onclick={() => totpGearOpen = !totpGearOpen}
          aria-label="TOTP settings" class:active={totpGearOpen}>
          <Icon name="settings" size={18}/>
        </button>
        <button class="icon-btn-flat" type="button" onclick={() => totpRevealed = !totpRevealed}
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
        <div class="input-wrap custom-field-value" class:warn={!cf.Value.trim()}>
          <input class="input"
            type={cf.Sensitive ? 'password' : 'text'}
            placeholder="Value"
            value={cf.Value}
            oninput={e => { customFields = customFields.map((f, j) => j === i ? { ...f, Value: e.target.value } : f) }}
          />
          <button class="icon-btn-flat" type="button"
            onclick={() => { customFields = customFields.map((f, j) => j === i ? { ...f, Sensitive: !f.Sensitive } : f) }}
            aria-label={cf.Sensitive ? 'Show value' : 'Hide value'}>
            <Icon name={cf.Sensitive ? 'eye-off' : 'eye'} size={18}/>
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
</style>
