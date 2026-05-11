<script>
  import Icon from './Icon.svelte'
  import PasswordGenerator from './PasswordGenerator.svelte'

  let { record, isNew, isDesktop, oncancel, onsave } = $props()

  let draft = $state({
    Title:    record?.Title    ?? '',
    Group:    record?.Group    ?? '',
    Username: record?.Username ?? '',
    Password: record?.Password ?? '',
    URL:      record?.URL      ?? '',
    Notes:    record?.Notes    ?? '',
  })
  let showPw   = $state(isNew)
  let genOpen  = $state(false)

  let dirty = $derived(
    !record ||
    Object.keys(draft).some(k => (record[k] ?? '') !== draft[k])
  )
  let canSave = $derived(dirty && !!draft.Title)

  function set(k, v) { draft = { ...draft, [k]: v } }

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

    <label class="field">
      <span class="field-label muted">Group</span>
      <input class="input" value={draft.Group} oninput={e => set('Group', e.target.value)}
        placeholder="e.g. Banking"/>
    </label>

    <label class="field">
      <span class="field-label muted">Username</span>
      <input class="input" value={draft.Username} oninput={e => set('Username', e.target.value)}/>
    </label>

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
      <button class="btn-text accent small" onclick={() => genOpen = true}>Generate password</button>
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
