<script>
  import { dbItems } from '../store.js'
  import { searchRecords } from '../wasm.js'
  import Icon from './Icon.svelte'

  let { selectedUUID = null, query = '', ontap } = $props()

  let openGroups = $state({})

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

  // Returns [{text, matched}] segments for inline highlighting.
  // Splits query on whitespace so each term is highlighted independently.
  function hl(text, q) {
    if (!q.trim() || !text) return [{ text: text || '', matched: false }]
    const terms = q.trim().split(/\s+/).filter(Boolean)
    const lower = text.toLowerCase()

    // Collect all [start, end) ranges for every term
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

    // Sort then merge overlapping/adjacent ranges
    ranges.sort((a, b) => a[0] - b[0])
    const merged = [ranges[0].slice()]
    for (let i = 1; i < ranges.length; i++) {
      const last = merged[merged.length - 1]
      if (ranges[i][0] <= last[1]) last[1] = Math.max(last[1], ranges[i][1])
      else merged.push(ranges[i].slice())
    }

    // Build segments
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
                onclick={() => ontap(r.uuid)}
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

<style>
  /* Title match: accent-soft background pill */
  :global(.hl-primary) {
    background: var(--accent-soft);
    color: var(--accent-strong);
    border-radius: 2px;
    padding: 0 1px;
    font-style: normal;
  }

  /* Group header match: bold + accent, no background */
  :global(.hl-secondary) {
    color: var(--accent);
    font-weight: 700;
  }
</style>
