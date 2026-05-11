export const SYMBOL_PALETTE = '!@#$%^&*()-_=+?[]{}|;:\'",./<>\\~`'
export const DEFAULT_SYMBOLS = '!@#$%^&*-_=+?'
export const SIMILAR = new Set(['0','O','I','i','l','1','|','5','S','Z','2'])

export const DEFAULT_OPTS = {
  length:         16,
  lowercase:      true,
  uppercase:      true,
  digits:         true,
  symbols:        true,
  excludeSimilar: false,
  customSymbols:  DEFAULT_SYMBOLS,
}

const POOLS = {
  lowercase: 'abcdefghijklmnopqrstuvwxyz',
  uppercase: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  digits:    '0123456789',
}

export function loadOpts() {
  try {
    const saved = localStorage.getItem('genOpts')
    return saved ? { ...DEFAULT_OPTS, ...JSON.parse(saved) } : { ...DEFAULT_OPTS }
  } catch { return { ...DEFAULT_OPTS } }
}

export function saveOpts(opts) {
  try { localStorage.setItem('genOpts', JSON.stringify(opts)) } catch {}
}

function filtered(pool, opts) {
  if (!opts.excludeSimilar) return pool
  return pool.split('').filter(c => !SIMILAR.has(c)).join('')
}

function randomFrom(pool) {
  if (!pool) return ''
  const arr = new Uint32Array(1)
  crypto.getRandomValues(arr)
  return pool[arr[0] % pool.length]
}

function cryptoShuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const rnd = new Uint32Array(1)
    crypto.getRandomValues(rnd)
    const j = rnd[0] % (i + 1)
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
}

export function generatePassword(opts = DEFAULT_OPTS) {
  const activePools = []
  if (opts.lowercase) activePools.push(filtered(POOLS.lowercase, opts))
  if (opts.uppercase) activePools.push(filtered(POOLS.uppercase, opts))
  if (opts.digits)    activePools.push(filtered(POOLS.digits, opts))
  if (opts.symbols)   activePools.push(filtered(opts.customSymbols || DEFAULT_SYMBOLS, opts))

  const nonEmpty = activePools.filter(p => p.length > 0)
  if (nonEmpty.length === 0) return ''

  const fullPool = nonEmpty.join('')
  const required = nonEmpty.map(p => randomFrom(p))
  const remaining = Math.max(0, opts.length - required.length)
  const extra = Array.from({ length: remaining }, () => randomFrom(fullPool))

  const all = [...required, ...extra]
  cryptoShuffle(all)
  return all.join('')
}
