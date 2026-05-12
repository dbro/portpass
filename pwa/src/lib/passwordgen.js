export const SYMBOLS = '!@#$%^&*()-_=+?[]{}|;:\'",./<>\\~`'

export const DEFAULT_OPTS = {
  length:       16,
  lowercase:    true,
  uppercase:    true,
  digits:       true,
  symbols:      true,
  excludeChars: "{}|;:'\",./<>\\~`",
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

function filtered(pool, excludeChars) {
  if (!excludeChars) return pool
  const exclude = new Set(excludeChars.split(''))
  return pool.split('').filter(c => !exclude.has(c)).join('')
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
  const exclude = opts.excludeChars || ''
  const activePools = []
  if (opts.lowercase) activePools.push(filtered(POOLS.lowercase, exclude))
  if (opts.uppercase) activePools.push(filtered(POOLS.uppercase, exclude))
  if (opts.digits)    activePools.push(filtered(POOLS.digits, exclude))
  if (opts.symbols)   activePools.push(filtered(SYMBOLS, exclude))

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
