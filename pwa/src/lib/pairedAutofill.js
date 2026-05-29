import { get, set, del } from 'idb-keyval'

const STORAGE_KEY = 'paired-autofill-profiles-v1'

async function load() {
  return (await get(STORAGE_KEY)) ?? {}
}

async function save(all) {
  if (Object.keys(all).length === 0) await del(STORAGE_KEY)
  else await set(STORAGE_KEY, all)
}

function bytesToB64(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
}

function b64ToBytes(b64) {
  return Uint8Array.from(atob(b64), c => c.charCodeAt(0))
}

function b64urlEncode(s) {
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function b64urlDecode(s) {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - s.length % 4) % 4)
  return atob(b64)
}

const BASE32 = 'abcdefghijklmnopqrstuvwxyz234567'

function base32NoPad(bytes) {
  let out = ''
  let bits = ''
  for (const byte of bytes) {
    bits += byte.toString(2).padStart(8, '0')
    while (bits.length >= 5) {
      out += BASE32[parseInt(bits.slice(0, 5), 2)]
      bits = bits.slice(5)
    }
  }
  if (bits.length > 0) out += BASE32[parseInt(bits.padEnd(5, '0'), 2)]
  return out
}

async function delegateIdFromPublicKey(publicKeySpki) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', publicKeySpki))
  const fp = base32NoPad(digest.slice(0, 16))
  return {
    delegateId: `afp1_${fp}`,
    displayCode: fp.slice(-8).replace(/(.{4})/g, '$1-').replace(/-$/, '').toUpperCase(),
  }
}

export async function delegateIdentityFromPublicKey(publicKeySpki) {
  return delegateIdFromPublicKey(publicKeySpki)
}

export function makePairingToken(profile, { name = '', ttlMs = 10 * 60 * 1000 } = {}) {
  const now = Date.now()
  const token = {
    v: 1,
    type: 'portpass-autofill-pairing',
    delegateId: profile.delegateId,
    displayCode: profile.displayCode,
    name,
    publicKeyB64: profile.publicKeyB64,
    relayUrl: profile.relayUrl || '',
    pairingId: profile.pairingId || crypto.randomUUID(),
    created: profile.created || now,
    expires: now + ttlMs,
  }
  return 'ppair1_' + b64urlEncode(JSON.stringify(token))
}

export async function parsePairingToken(raw) {
  const text = (raw || '').trim()
  if (!text.startsWith('ppair1_')) throw new Error('Pairing token must start with ppair1_')
  let token
  try {
    token = JSON.parse(b64urlDecode(text.slice('ppair1_'.length)))
  } catch {
    throw new Error('Pairing token is not valid')
  }
  if (token?.type !== 'portpass-autofill-pairing' || token.v !== 1) {
    throw new Error('Pairing token is not a Portpass autofill token')
  }
  if (!token.publicKeyB64 || !token.delegateId) throw new Error('Pairing token is missing key data')
  if (!token.expires || Date.now() > token.expires) throw new Error('Pairing token has expired')
  const publicKey = b64ToBytes(token.publicKeyB64)
  const identity = await delegateIdFromPublicKey(publicKey.buffer)
  if (identity.delegateId !== token.delegateId) throw new Error('Pairing token fingerprint does not match its public key')
  return {
    ...token,
    displayCode: token.displayCode || identity.displayCode,
    publicKey: publicKey.buffer,
  }
}

export async function createPairedAutofillProfile({ relayUrl = '', dashboardId = 'local-dashboard' } = {}) {
  const keyPair = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify']
  )
  const publicKeySpki = await crypto.subtle.exportKey('spki', keyPair.publicKey)
  const { delegateId, displayCode } = await delegateIdFromPublicKey(publicKeySpki)
  const profile = {
    delegateId,
    displayCode,
    dashboardId,
    relayUrl,
    pairingId: crypto.randomUUID(),
    created: Date.now(),
    signingKey: keyPair.privateKey,
    publicKey: Array.from(new Uint8Array(publicKeySpki)),
    publicKeyB64: bytesToB64(publicKeySpki),
  }
  const all = await load()
  all[delegateId] = profile
  all.defaultDelegateId = delegateId
  await save(all)
  return profile
}

export async function getPairedAutofillProfile(delegateId = null) {
  const all = await load()
  const id = delegateId || all.defaultDelegateId
  if (!id) return null
  return all[id] ?? null
}

export async function removePairedAutofillProfile(delegateId) {
  const all = await load()
  delete all[delegateId]
  if (all.defaultDelegateId === delegateId) {
    const next = Object.keys(all).find(k => k !== 'defaultDelegateId')
    if (next) all.defaultDelegateId = next
    else delete all.defaultDelegateId
  }
  await save(all)
}

export async function signPairedAutofillMessage(profile, payload) {
  const bytes = new TextEncoder().encode(JSON.stringify(payload))
  const sig = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' }, profile.signingKey, bytes
  )
  return bytesToB64(sig)
}
