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

const BASE32 = 'abcdefghijklmnopqrstuvwxyz234567'

function base32NoPad(bytes) {
  let out = ''
  let value = 0
  let bits = 0
  for (const byte of bytes) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31]
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
