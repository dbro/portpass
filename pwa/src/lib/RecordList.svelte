<script>
  import { derived } from 'svelte/store'
  import { dbItems } from '../store.js'
  import { searchRecords } from '../wasm.js'
  import Icon from './Icon.svelte'

  let { selectedUUID = null, query = '', ontap } = $props()

  // Track which groups are open; default all open
  let openGroups = $state({})

  // Build grouped list, re-running when items or query change
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
        // detect duplicate titles to show username
        const counts = {}
        items.forEach(r => { counts[r.title] = (counts[r.title] || 0) + 1 })
        const sorted = items
          .map(r => ({ ...r, showUsername: counts[r.title] > 1 }))
          .sort((a, b) => a.title.localeCompare(b.title))
        return { group: g, items: sorted }
      })
      .sort((a, b) => a.group.localeCompare(b.group))
  })

  // Auto-open all groups when query is active; restore when cleared
  $effect(() => {
    if (query.trim()) {
      // force all open while searching — don't mutate openGroups, handle in template
    }
  })

  function toggle(group) {
    openGroups = { ...openGroups, [group]: !isOpen(group) }
  }

  function isOpen(group) {
    if (query.trim()) return true                     // force open when searching
    if (group in openGroups) return openGroups[group]
    return true                                        // default open
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
          <span class="coll-name">{group}</span>
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
                  <span class="record-row-title">{r.title}</span>
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
