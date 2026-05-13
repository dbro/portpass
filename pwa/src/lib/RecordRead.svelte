<script>
  import { get } from 'svelte/store'
  import { clipboardSession, clipboardContext } from '../store.js'
  import Icon from './Icon.svelte'

  let { record, uuid, isDesktop, onback, onedit, oncopy } = $props()

  let revealed      = $state(false)
  let showHistory   = $state(false)
  let notesRevealed = $state(false)
  let copiedField  = $state(null)
  let copiedToken  = null
  let animVariant  = $state(0)  // alternates 0/1 on each copy to force animation restart

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

  // Reactively restore (or update) the drain whenever the clipboard context changes.
  $effect(() => {
    const s = $clipboardSession
    const ctx = $clipboardContext
    if (!s || !ctx || ctx.token !== s.token || ctx.uuid !== uuid || !ctx.field || !ctx.hash) return
    if (copiedToken === ctx.token) return  // already showing the right drain
    ;(async () => {
      const history = parseHistory(record.PasswordHistory)
      let value
      if (ctx.field.startsWith('history-')) {
        const ts = parseInt(ctx.field.slice(8))
        value = history.find(e => e.ts === ts)?.password
      } else {
        value = { Username: record.Username, Password: record.Password, URL: record.URL }[ctx.field]
      }
      if (!value) return
      if (hashesEqual(await sha256(value), new Uint8Array(ctx.hash))
          && get(clipboardSession)?.token === ctx.token) {
        animVariant ^= 1
        copiedField = ctx.field
        copiedToken = ctx.token
      }
    })()
  })

  async function handleCopy(value, field) {
    const token = await oncopy(value)
    if (token !== null) {
      const hash = Array.from(await sha256(value))
      clipboardContext.set({ token, field, uuid, hash })
      animVariant ^= 1   // flip name so browser treats it as a fresh animation
      copiedField = field
      copiedToken = token
    }
  }

  function drainStyle() {
    const s = $clipboardSession
    if (!s) return ''
    const remaining = Math.max(50, s.expiresAt - Date.now())
    const elapsed   = Math.max(0, 30000 - remaining)
    const flash = elapsed > 100 ? '0ms' : '450ms'
    return `--clip-delay: -${elapsed}ms; --drain-name: clip-drain-${animVariant}; --flash-duration: ${flash}`
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

  let history = $derived(parseHistory(record.PasswordHistory))
</script>

<!-- Mobile bar (hidden on desktop via CSS) -->
<div class="record-bar">
  <button class="icon-btn" onclick={onback} aria-label="Back">
    <Icon name="back" size={22}/>
  </button>
  <div class="record-bar-group muted">{record.Group ?? ''}</div>
  <button class="icon-btn" onclick={onedit} aria-label="Edit">
    <Icon name="edit" size={20}/>
  </button>
</div>

<!-- Desktop pane header (hidden on mobile via CSS) -->
{#if isDesktop}
  <div class="record-pane-header">
    <span class="record-bar-group muted">{record.Group ?? ''}</span>
    <div class="record-pane-actions">
      <button class="btn btn-ghost" onclick={onedit} style="height:36px;padding:0 14px;font-size:14px">Edit</button>
    </div>
  </div>
{/if}

<div class="record-body">
  <h1 class="record-title">{record.Title}</h1>

  <div class="copy-rows">
    {#if record.Username}
      <div class="copy-row" class:clipboard-active={copiedField === 'Username'} style={copiedField === 'Username' ? drainStyle() : ''}>
        <div class="copy-row-label muted">Username</div>
        <div class="copy-row-main">
          <button class="copy-row-value" onclick={() => handleCopy(record.Username, 'Username')}>
            {record.Username}
          </button>
          <div class="copy-row-actions">
            <button class="icon-btn-flat copy-btn" onclick={() => handleCopy(record.Username, 'Username')} aria-label="Copy username">
              <Icon name="copy" size={18}/>
            </button>
          </div>
        </div>
      </div>
    {/if}

    {#if record.Password}
      <div class="copy-row" class:clipboard-active={copiedField === 'Password'} style={copiedField === 'Password' ? drainStyle() : ''}>
        <div class="copy-row-label muted">Password</div>
        <div class="copy-row-main">
          <button class="copy-row-value" onclick={() => handleCopy(record.Password, 'Password')}>
            <span class="mono">{revealed ? record.Password : '•'.repeat(Math.min(record.Password.length, 12))}</span>
          </button>
          <div class="copy-row-actions">
            <button class="icon-btn-flat" onclick={() => { revealed = !revealed; if (!revealed) showHistory = false }} aria-label="Reveal password">
              <Icon name={revealed ? 'eye-off' : 'eye'} size={18}/>
            </button>
            <button class="icon-btn-flat copy-btn" onclick={() => handleCopy(record.Password, 'Password')} aria-label="Copy password">
              <Icon name="copy" size={18}/>
            </button>
          </div>
        </div>
        {#if revealed && history.length > 0}
          <button class="history-toggle" onclick={() => showHistory = !showHistory}>
            {showHistory ? 'Hide' : 'History'} · {history.length} previous
          </button>
        {/if}
        {#if showHistory}
          <div class="history-list">
            {#each history as entry}
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
    {/if}

    {#if record.URL}
      <div class="copy-row" class:clipboard-active={copiedField === 'URL'} style={copiedField === 'URL' ? drainStyle() : ''}>
        <div class="copy-row-label muted">URL</div>
        <div class="copy-row-main">
          <button class="copy-row-value" onclick={() => handleCopy(record.URL, 'URL')}>
            {record.URL}
          </button>
          <div class="copy-row-actions">
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
  </div>

  {#if record.Notes}
    <div class="record-notes">
      <div class="notes-label-row">
        <span class="copy-row-label muted">Notes</span>
        <button class="icon-btn-flat" onclick={() => notesRevealed = !notesRevealed} aria-label={notesRevealed ? 'Hide notes' : 'Reveal notes'}>
          <Icon name={notesRevealed ? 'eye-off' : 'eye'} size={16}/>
        </button>
      </div>
      <div class="notes-text mono">{notesRevealed ? record.Notes : record.Notes.replace(/[^\n]/g, '•')}</div>
    </div>
  {/if}

  {#if record.ModTime}
    <div class="record-meta muted">Modified {relTime(record.ModTime)}</div>
  {/if}
</div>

<style>
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
</style>
