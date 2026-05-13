<script>
  import Icon from './Icon.svelte'
  import PasswordGenerator from './PasswordGenerator.svelte'
  import { generatePassword, loadOpts } from './passwordgen.js'
  import { getAutocompleteSuggestion } from '../wasm.js'

  let { record, isNew, isDesktop, oncancel, onsave, ondelete, ondirtychange } = $props()

  function focusOnMount(node, condition = true) {
    if (condition) setTimeout(() => node.focus(), 0)
  }

  // Destructure once to capture initial prop values — draft is an independent editable copy
  const { Title = '', Group = '', Username = '', Password = '', URL = '', Notes = '' } = record ?? {}
  let draft = $state({ Title, Group, Username, Password, URL, Notes })
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

  let history = $derived(parseHistory(record?.PasswordHistory))

  let groupGhost    = $state('')
  let usernameGhost = $state('')

  let dirty   = $derived(!record || Object.keys(draft).some(k => (record[k] ?? '') !== draft[k]))
  let canSave = $derived(dirty && !!draft.Title)

  // Notify parent of dirty state changes
  $effect(() => {
    ondirtychange?.(dirty)
  })

  function set(k, v) { draft = { ...draft, [k]: v } }

  // Returns just the suffix to append, or '' if no useful suggestion
  function ghostFor(field, value) {
    if (!value) return ''
    const suggestion = getAutocompleteSuggestion(field, value)
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
      const suggestion = getAutocompleteSuggestion('group', draft.Group)
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
      const suggestion = getAutocompleteSuggestion('username', draft.Username)
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
    <div class="record-bar-group muted">{isNew ? 'New record' : 'Edit'}</div>
    <div style="display:flex;align-items:center;gap:8px">
      {#if !isNew && ondelete}
        <button class="icon-btn" onclick={ondelete} aria-label="Delete">
          <Icon name="trash" size={20} stroke="var(--danger)"/>
        </button>
      {/if}
      <button class="btn-text primary" disabled={!canSave} onclick={() => onsave(draft)}>Save</button>
    </div>
  </div>

  {#if isDesktop}
    <div class="record-pane-header">
      <span class="record-bar-group muted">{isNew ? 'New record' : 'Edit'}</span>
      <div class="record-pane-actions">
        {#if !isNew && ondelete}
          <button class="btn-text" onclick={ondelete} style="color:var(--danger)">Delete</button>
        {/if}
        <button class="btn-text" onclick={oncancel}>Cancel</button>
        <button class="btn btn-primary" disabled={!canSave} onclick={() => onsave(draft)}
          style="height:36px;padding:0 14px;font-size:14px">Save</button>
      </div>
    </div>
  {/if}

  <div class="record-body" style="display:flex;flex-direction:column;gap:16px">
    <label class="field">
      <span class="field-label muted">Title</span>
      <input class="input" value={draft.Title} oninput={e => set('Title', e.target.value)}
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
      <div class="input-wrap">
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

    <label class="field">
      <span class="field-label muted">URL</span>
      <input class="input" value={draft.URL} oninput={e => set('URL', e.target.value)}/>
    </label>

    <label class="field">
      <span class="field-label muted">Notes</span>
      <textarea class="input" rows={4} value={draft.Notes}
        oninput={e => set('Notes', e.target.value)}></textarea>
    </label>
  </div>
{/if}

<style>
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
</style>
