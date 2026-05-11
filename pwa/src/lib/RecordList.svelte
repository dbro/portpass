<script>
  import { dbItems } from '../store.js'
  import { searchRecords, getRecordData } from '../wasm.js'
  import Icon from './Icon.svelte'

  let { selectedUUID = null, query = '', ontap, oncopy } = $props()

  let openGroups  = $state({})
  let contextMenu = $state(null) // { x, y, rec }

  let groups = $derived.by(() => {
    const items = $dbItems
    let list = items
    if (query.trim()) {
      const matched = new Set(searchRecords(query, false))
      list = items.filter(i => matched.has(i.uuid))
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
  })

  function toggle(group) {
    openGroups = { ...openGroups, [group]: !isOpen(group) }
  }

  function isOpen(group) {
    if (query.trim()) return true
    if (group in openGroups) return openGroups[group]
    return true
  }

  function handleClick(uuid) {
    if (contextMenu) { contextMenu = null; return }
    if (uuid === selectedUUID) {
      copyPassword(uuid)
    } else {
      ontap(uuid)
    }
  }

  function handleDblClick(uuid) {
    copyPassword(uuid)
  }

  function handleContextMenu(e, uuid) {
    e.preventDefault()
    try {
      const rec = getRecordData(uuid)
      // Clamp to viewport so menu doesn't appear off-screen
      const menuW = 180, menuH = 160
      const x = Math.min(e.clientX, window.innerWidth  - menuW - 8)
      const y = Math.min(e.clientY, window.innerHeight - menuH - 8)
      contextMenu = { x, y, rec }
    } catch {}
  }

  function copyPassword(uuid) {
    try {
      const rec = getRecordData(uuid)
      if (rec.Password) oncopy(rec.Password, 'Password')
    } catch {}
  }

  function closeMenu() { contextMenu = null }

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
  {#if groups.length === 0}
    <div class="empty-state muted">
      {query ? `No matches for "${query}"` : 'No records'}
    </div>
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
              <button
                class="record-row"
                class:is-selected={r.uuid === selectedUUID}
                onclick={() => handleClick(r.uuid)}
                ondblclick={() => handleDblClick(r.uuid)}
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
            {/each}
          </div>
        {/if}
      </section>
    {/each}
  {/if}
</div>

{#if contextMenu}
  <div
    class="ctx-menu"
    role="menu"
    style="left:{contextMenu.x}px; top:{contextMenu.y}px"
  >
    {#if contextMenu.rec.Username}
      <button onclick={() => { oncopy(contextMenu.rec.Username, 'Username'); closeMenu() }}>
        Copy username
      </button>
    {/if}
    {#if contextMenu.rec.Password}
      <button onclick={() => { oncopy(contextMenu.rec.Password, 'Password'); closeMenu() }}>
        Copy password
      </button>
    {/if}
    {#if contextMenu.rec.URL}
      <button onclick={() => { oncopy(contextMenu.rec.URL, 'URL'); closeMenu() }}>
        Copy URL
      </button>
      <button onclick={() => { window.open(contextMenu.rec.URL, '_blank'); closeMenu() }}>
        Visit URL
      </button>
    {/if}
  </div>
{/if}

<style>
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
    min-width: 160px;
    background: var(--surface);
    border: 1px solid var(--border-strong);
    border-radius: var(--r-input);
    box-shadow: var(--shadow), 0 8px 24px rgba(0,0,0,0.18);
    padding: 4px;
    display: flex;
    flex-direction: column;
  }

  .ctx-menu button {
    display: block;
    width: 100%;
    text-align: left;
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
</style>
