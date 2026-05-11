<script>
  import Icon from './Icon.svelte'
  import { SYMBOL_PALETTE, DEFAULT_SYMBOLS, generatePassword, loadOpts, saveOpts } from './passwordgen.js'

  let { onclose, onuse } = $props()

  let opts = $state(loadOpts())
  let value = $state(generatePassword(opts))

  let activeSymbols = $derived(new Set(opts.customSymbols.split('')))

  function toggleSymbol(char) {
    const s = new Set(opts.customSymbols.split(''))
    if (s.has(char)) { s.delete(char) } else { s.add(char) }
    const next = SYMBOL_PALETTE.split('').filter(c => s.has(c)).join('')
    set('customSymbols', next || DEFAULT_SYMBOLS)
  }

  function set(k, v) {
    opts = { ...opts, [k]: v }
    saveOpts(opts)
    value = generatePassword(opts)
  }

  function regen() { value = generatePassword(opts) }
</script>

<div class="generator">
  <div class="gen-bar">
    <button class="btn-text" onclick={onclose}>Cancel</button>
    <div class="gen-title">Generate password</div>
    <button class="btn-text primary" onclick={() => onuse(value)} disabled={!value}>Use</button>
  </div>

  <div class="gen-body">
    <div class="gen-output">
      <div class="gen-output-value mono">{value || ' '}</div>
      <button class="icon-btn-flat gen-regen" onclick={regen} aria-label="Regenerate">
        <Icon name="refresh" size={20}/>
      </button>
    </div>

    <div class="gen-controls">
      <div class="gen-slider">
        <div class="gen-row">
          <span class="gen-row-label">Length</span>
          <span class="gen-row-value mono">{opts.length}</span>
        </div>
        <input type="range" min="8" max="40" value={opts.length}
          oninput={e => set('length', Number(e.target.value))} class="gen-range"/>
      </div>

      <div class="gen-chips">
        {#each [
          { key: 'lowercase', glyph: 'az', label: 'lowercase' },
          { key: 'uppercase', glyph: 'AZ', label: 'uppercase' },
          { key: 'digits',    glyph: '09', label: 'digits'    },
          { key: 'symbols',   glyph: '!@', label: 'symbols'   },
        ] as chip}
          <button
            class="gen-chip"
            class:on={opts[chip.key]}
            onclick={() => set(chip.key, !opts[chip.key])}
          >
            <span class="gen-chip-glyph mono">{chip.glyph}</span>
            <span>{chip.label}</span>
          </button>
        {/each}
      </div>

      {#if opts.symbols}
        <div class="sym-picker">
          {#each SYMBOL_PALETTE.split('') as char}
            <button
              class="sym-key mono"
              class:on={activeSymbols.has(char)}
              onclick={() => toggleSymbol(char)}
              aria-label="{activeSymbols.has(char) ? 'Remove' : 'Add'} {char}"
            >{char}</button>
          {/each}
        </div>
      {/if}

      <div class="gen-toggle-row">
        <div>
          <div class="gen-toggle-label">Exclude similar</div>
          <div class="gen-toggle-hint mono">0O Il1 5S Z2</div>
        </div>
        <button
          class="switch"
          class:on={opts.excludeSimilar}
          onclick={() => set('excludeSimilar', !opts.excludeSimilar)}
          aria-label="Exclude similar characters"
        ></button>
      </div>
    </div>
  </div>
</div>

<style>
  .sym-picker {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .sym-key {
    width: 36px;
    height: 36px;
    border-radius: 6px;
    border: 1px solid var(--border-strong);
    background: var(--surface);
    color: var(--text-muted);
    font-size: 15px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background .1s, border-color .1s, color .1s;
    appearance: none;
    -webkit-appearance: none;
  }

  .sym-key.on {
    background: var(--accent-soft);
    border-color: var(--accent);
    color: var(--accent-strong);
  }

  .gen-toggle-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 4px 2px;
  }

  .gen-toggle-label {
    font-size: 14px;
    color: var(--text-muted);
  }

  .gen-toggle-hint {
    font-size: 12px;
    color: var(--text-soft);
    letter-spacing: 0.04em;
    margin-top: 2px;
  }
</style>
