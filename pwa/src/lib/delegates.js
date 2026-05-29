import { get, set, del } from 'idb-keyval'

const STORAGE_KEY = 'delegates-v1'
const SWITCHBOARD_URL_DEFAULT = 'ws://localhost:7577'

function delegateDisplayCode(id) {
  if (!id?.startsWith('afp1_')) return null
  const fp = id.slice(5)
  return fp.slice(-8).replace(/(.{4})/g, '$1-').replace(/-$/, '').toUpperCase()
}

async function load() {
  return (await get(STORAGE_KEY)) ?? {}
}

async function save(all) {
  if (Object.keys(all).length === 0) await del(STORAGE_KEY)
  else await set(STORAGE_KEY, all)
}

function migrate(d) {
  if ('useCount' in d || 'lastUsed' in d) {
    const { useCount, lastUsed, ...rest } = d
    return { ...rest, bcCount: 0, bcLastUsed: null, relayCount: 0, relayLastUsed: null }
  }
  return d
}

export function delegateFillMode(delegate) {
  const bcCount = delegate?.bcCount ?? 0
  const relayCount = delegate?.relayCount ?? 0
  const usedSameProfile = bcCount > 0
  const usedCrossProfile = relayCount > 0

  if (usedSameProfile && usedCrossProfile) return 'same profile + cross profile'
  if (usedCrossProfile) return 'cross profile'
  if (usedSameProfile) return 'same profile'
  return delegate?.pairingId || delegate?.relayUrl ? 'cross profile' : 'same profile'
}

export async function getDelegates(vaultUuid) {
  if (!vaultUuid) return []
  const all = await load()
  return (all[vaultUuid] ?? []).map(migrate)
}

export async function getDelegate(vaultUuid, delegateId) {
  if (!vaultUuid || !delegateId) return null
  const all = await load()
  return (all[vaultUuid] ?? []).map(migrate).find(d => d.id === delegateId) ?? null
}

export async function addDelegate(vaultUuid, name, publicKeySpki, id = crypto.randomUUID(), options = {}) {
  const all = await load()
  const current = all[vaultUuid] ?? []
  if (current.some(d => d.id === id)) throw new Error('This autofill profile is already paired')
  const delegate = {
    id,
    name,
    publicKey: Array.from(new Uint8Array(publicKeySpki)),
    displayCode: delegateDisplayCode(id),
    created: Date.now(),
    pairingId: options.pairingId || null,
    relayUrl: options.relayUrl || null,
    pairedAt: options.pairedAt || Date.now(),
    bcCount: 0,
    bcLastUsed: null,
    relayCount: 0,
    relayLastUsed: null,
  }
  all[vaultUuid] = [delegate, ...current]
  await save(all)
  return delegate
}

export async function revokeDelegate(vaultUuid, delegateId) {
  const all = await load()
  const list = (all[vaultUuid] ?? []).filter(d => d.id !== delegateId)
  if (list.length === 0) delete all[vaultUuid]
  else all[vaultUuid] = list
  await save(all)
}

// Verify a signature against registered delegates. Returns the matching delegate
// on success, null if no delegate matches or the signature is invalid.
export async function verifyDelegate(vaultUuid, spkiBytes, message, signatureBytes) {
  const all = await load()
  const list = (all[vaultUuid] ?? []).map(migrate)
  for (const d of list) {
    const stored = new Uint8Array(d.publicKey)
    if (stored.length !== spkiBytes.length) continue
    if (!stored.every((b, i) => b === spkiBytes[i])) continue
    try {
      const key = await crypto.subtle.importKey(
        'spki', spkiBytes, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']
      )
      const valid = await crypto.subtle.verify(
        { name: 'ECDSA', hash: 'SHA-256' }, key, signatureBytes, message
      )
      if (valid) return d
    } catch { continue }
  }
  return null
}

export async function verifyDelegateById(vaultUuid, delegateId, message, signatureBytes) {
  const d = await getDelegate(vaultUuid, delegateId)
  if (!d) return null
  try {
    const spkiBytes = new Uint8Array(d.publicKey)
    const key = await crypto.subtle.importKey(
      'spki', spkiBytes, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']
    )
    const valid = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' }, key, signatureBytes, message
    )
    return valid ? d : null
  } catch {
    return null
  }
}

// Record a successful page fill for a delegate. Called when autofill.html shows
// its done/checkmark screen — once per page filled, not per field or connection.
export async function recordFill(vaultUuid, delegateId, channel) {
  const all = await load()
  const list = (all[vaultUuid] ?? []).map(migrate)
  const d = list.find(x => x.id === delegateId)
  if (!d) return
  if (channel === 'relay') {
    d.relayCount = (d.relayCount ?? 0) + 1
    d.relayLastUsed = Date.now()
  } else {
    d.bcCount = (d.bcCount ?? 0) + 1
    d.bcLastUsed = Date.now()
  }
  all[vaultUuid] = list
  await save(all)
}

export async function getSwitchboardUrl(vaultUuid) {
  if (!vaultUuid) return SWITCHBOARD_URL_DEFAULT
  const key = `switchboard-url-${vaultUuid}`
  return (await get(key)) ?? SWITCHBOARD_URL_DEFAULT
}

export async function setSwitchboardUrl(vaultUuid, url) {
  const key = `switchboard-url-${vaultUuid}`
  if (!url || url === SWITCHBOARD_URL_DEFAULT) await del(key)
  else await set(key, url)
}

export async function getCrossProfileEnabled(vaultUuid) {
  if (!vaultUuid) return false
  return (await get(`cross-profile-enabled-${vaultUuid}`)) === true
}

export async function setCrossProfileEnabled(vaultUuid, enabled) {
  const key = `cross-profile-enabled-${vaultUuid}`
  if (enabled) await set(key, true)
  else await del(key)
}
