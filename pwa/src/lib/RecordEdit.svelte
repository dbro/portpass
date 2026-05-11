<script>
  import Icon from './Icon.svelte'
  import PasswordGenerator from './PasswordGenerator.svelte'
  import { generatePassword, loadOpts } from './passwordgen.js'
  import { getAutocompleteSuggestion } from '../wasm.js'

  let { record, isNew, isDesktop, oncancel, onsave } = $props()

  let draft = $state({
    Title:    record?.Title    ?? '',
    Group:    record?.Group    ?? '',
    Username: record?.Username ?? '',
    Password: record?.Password ?? '',
    URL:      record?.URL      ?? '',
    Notes:    record?.Notes    ?? '',
  })
  let showPw  = $state(isNew)
  let genOpen = $state(false)

  let groupGhost    = $state('')
  let usernameGhost = $state('')

  let dirty   = $derived(!record || Object.keys(draft).some(k => (record[k] ?? '') !== draft[k]))
  let canSave = $derived(dirty && !!draft.Title)

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
    showPw = true
  }

  function usePassword(pw) {
    set('Password', pw)
    showPw = true
    genOpen = false
  }
</script>

{#if genOpen}
  <PasswordGenerator onclose={() => genOpen = false} onuse={usePassword}/>
{:else}

  <div class="record-bar" style={isDesktop ? 'display:none' : ''}>
    <button class="btn-text" onclick={oncancel}>Cancel</button>
    <div class="record-bar-group muted">{isNew ? 'New record' : 'Edit'}</div>
    <button class="btn-text primary" disabled={!canSave} onclick={() => onsave(draft)}>Save</button>
  </div>

  {#if isDesktop}
    <div class="record-pane-header">
      <span class="record-bar-group muted">{isNew ? 'New record' : 'Edit'}</span>
      <div class="record-pane-actions">
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
        placeholder="e.g. Bank of America" autofocus={isNew}/>
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
        <button class="icon-btn-flat" onclick={() => showPw = !showPw} aria-label="Toggle visibility">
          <Icon name={showPw ? 'eye-off' : 'eye'} size={18}/>
        </button>
      </div>
      <div class="pw-gen-row">
        <button class="btn-text accent small" onclick={quickGenerate}>Generate</button>
        <button class="icon-btn-flat" onclick={() => genOpen = true} aria-label="Password options">
          <Icon name="settings" size={16}/>
        </button>
      </div>
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
</style>
