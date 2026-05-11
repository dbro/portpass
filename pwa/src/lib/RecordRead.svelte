<script>
  import Icon from './Icon.svelte'

  let { record, isDesktop, onback, onedit, ondelete, oncopy } = $props()

  let menuOpen    = $state(false)
  let revealed    = $state(false)
  let showHistory = $state(false)

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
  <div style="position:relative">
    <button class="icon-btn" onclick={() => menuOpen = !menuOpen} aria-label="More">
      <Icon name="more" size={20}/>
    </button>
    {#if menuOpen}
      <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
      <div class="popmenu" onclick={() => menuOpen = false}>
        <button class="popmenu-item" onclick={onedit}>
          <Icon name="edit" size={16}/><span>Edit</span>
        </button>
        <button class="popmenu-item danger" onclick={ondelete}>
          <Icon name="trash" size={16}/><span>Delete</span>
        </button>
      </div>
    {/if}
  </div>
</div>

<!-- Desktop pane header (hidden on mobile via CSS) -->
{#if isDesktop}
  <div class="record-pane-header">
    <span class="record-bar-group muted">{record.Group ?? ''}</span>
    <div class="record-pane-actions">
      <button class="btn-text" onclick={ondelete} style="color:var(--danger)">Delete</button>
      <button class="btn btn-ghost" onclick={onedit} style="height:36px;padding:0 14px;font-size:14px">Edit</button>
    </div>
  </div>
{/if}

<div class="record-body">
  <h1 class="record-title">{record.Title}</h1>

  <div class="copy-rows">
    {#if record.Username}
      <div class="copy-row">
        <div class="copy-row-label muted">Username</div>
        <div class="copy-row-main">
          <button class="copy-row-value" onclick={() => oncopy(record.Username, 'Username')}>
            {record.Username}
          </button>
          <div class="copy-row-actions">
            <button class="icon-btn-flat copy-btn" onclick={() => oncopy(record.Username, 'Username')} aria-label="Copy username">
              <Icon name="copy" size={18}/>
            </button>
          </div>
        </div>
      </div>
    {/if}

    {#if record.Password}
      <div class="copy-row">
        <div class="copy-row-label muted">Password</div>
        <div class="copy-row-main">
          <button class="copy-row-value" onclick={() => oncopy(record.Password, 'Password')}>
            <span class="mono">{revealed ? record.Password : '•'.repeat(Math.min(record.Password.length, 12))}</span>
          </button>
          <div class="copy-row-actions">
            <button class="icon-btn-flat" onclick={() => { revealed = !revealed; if (!revealed) showHistory = false }} aria-label="Reveal password">
              <Icon name={revealed ? 'eye-off' : 'eye'} size={18}/>
            </button>
            <button class="icon-btn-flat copy-btn" onclick={() => oncopy(record.Password, 'Password')} aria-label="Copy password">
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
              <div class="history-entry">
                <span class="history-time muted">{relTimeUnix(entry.ts)}</span>
                <span class="history-pw mono">{entry.password}</span>
                <button class="icon-btn-flat" onclick={() => oncopy(entry.password, 'Password')} aria-label="Copy">
                  <Icon name="copy" size={15}/>
                </button>
              </div>
            {/each}
          </div>
        {/if}
      </div>
    {/if}

    {#if record.URL}
      <div class="copy-row">
        <div class="copy-row-label muted">URL</div>
        <div class="copy-row-main">
          <button class="copy-row-value" onclick={() => oncopy(record.URL, 'URL')}>
            {record.URL}
          </button>
          <div class="copy-row-actions">
            <a class="icon-btn-flat" href={record.URL} target="_blank" rel="noreferrer" aria-label="Open URL">
              <Icon name="external" size={18}/>
            </a>
            <button class="icon-btn-flat copy-btn" onclick={() => oncopy(record.URL, 'URL')} aria-label="Copy URL">
              <Icon name="copy" size={18}/>
            </button>
          </div>
        </div>
      </div>
    {/if}
  </div>

  {#if record.Notes}
    <div class="record-notes">
      <div class="copy-row-label muted">Notes</div>
      <div class="notes-text">{record.Notes}</div>
    </div>
  {/if}

  {#if record.ModTime}
    <div class="record-meta muted">Modified {relTime(record.ModTime)}</div>
  {/if}
</div>

<style>
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
