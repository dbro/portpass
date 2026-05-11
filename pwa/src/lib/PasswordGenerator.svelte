<script>
  import Icon from './Icon.svelte'

  let { onclose, onuse } = $props()

  const POOLS = {
    lowercase: 'abcdefghijklmnopqrstuvwxyz',
    uppercase: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
    digits:    '0123456789',
    symbols:   '!@#$%^&*-_=+?',
  }

  let opts = $state({ length: 16, lowercase: true, uppercase: true, digits: true, symbols: true })
  let value = $state(generate(opts))

  function generate(o) {
    let pool = ''
    if (o.lowercase) pool += POOLS.lowercase
    if (o.uppercase) pool += POOLS.uppercase
    if (o.digits)    pool += POOLS.digits
    if (o.symbols)   pool += POOLS.symbols
    if (!pool) return ''
    const arr = new Uint32Array(o.length)
    crypto.getRandomValues(arr)
    let out = ''
    for (let i = 0; i < o.length; i++) out += pool[arr[i] % pool.length]
    return out
  }

  function set(k, v) {
    opts = { ...opts, [k]: v }
    value = generate(opts)
  }

  function regen() { value = generate(opts) }

  function strengthBits(v, o) {
    if (!v) return 0
    let pool = 0
    if (o.lowercase) pool += 26
    if (o.uppercase) pool += 26
    if (o.digits)    pool += 10
    if (o.symbols)   pool += POOLS.symbols.length
    return Math.min(128, Math.round(v.length * Math.log2(pool || 1)))
  }

  function strengthLabel(bits) {
    if (bits < 40) return { label: 'weak',     pct: 0.25 }
    if (bits < 60) return { label: 'fair',     pct: 0.50 }
    if (bits < 80) return { label: 'good',     pct: 0.75 }
    return              { label: 'excellent', pct: 1.0  }
  }

  let bits = $derived(strengthBits(value, opts))
  let s    = $derived(strengthLabel(bits))
</script>

<div class="generator">
  <div class="gen-bar">
    <button class="btn-text" onclick={onclose}>Cancel</button>
    <div class="gen-title">Generate password</div>
    <button class="btn-text primary" onclick={() => onuse(value)} disabled={!value}>Use</button>
  </div>

  <div class="gen-body">
    <div class="gen-output">
      <div class="gen-output-value mono">{value || ' '}</div>
      <button class="icon-btn-flat gen-regen" onclick={regen} aria-label="Regenerate">
        <Icon name="refresh" size={20}/>
      </button>
    </div>

    <div class="gen-strength">
      <div class="gen-strength-bar">
        <div class="gen-strength-fill s-{s.label}" style="width:{s.pct * 100}%"></div>
      </div>
      <div class="gen-strength-label">
        <span class="s-{s.label}">{s.label}</span>
        <span class="muted">{bits} bits</span>
      </div>
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
          { key: 'lowercase', glyph: 'a', label: 'lowercase' },
          { key: 'uppercase', glyph: 'A', label: 'uppercase' },
          { key: 'digits',    glyph: '9', label: 'digits' },
          { key: 'symbols',   glyph: '!@', label: 'symbols' },
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
    </div>
  </div>
</div>
