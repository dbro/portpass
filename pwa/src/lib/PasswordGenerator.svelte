<script>
  import Icon from './Icon.svelte'
  import { generatePassword, loadOpts, saveOpts } from './passwordgen.js'

  let { onclose, onuse } = $props()

  let opts = $state(loadOpts())
  let value = $state(generatePassword(opts))

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
        <span class="gen-row-label">Length</span>
        <input type="range" min="8" max="40" value={opts.length}
          oninput={e => set('length', Number(e.target.value))} class="gen-range"/>
        <span class="gen-row-value mono">{opts.length}</span>
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

      <label class="gen-field">
        <span class="gen-field-label">Exclude these characters</span>
        <input
          class="input"
          type="text"
          value={opts.excludeChars}
          oninput={e => set('excludeChars', e.target.value)}
          placeholder="e.g. 0O Il1"
        />
      </label>
    </div>
  </div>
</div>

<style>
  .gen-field {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 8px 2px 2px;
  }

  .gen-field-label {
    font-size: 14px;
    color: var(--text-muted);
  }
</style>
