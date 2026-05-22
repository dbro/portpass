import { get, set, del } from 'idb-keyval'

const STORAGE_KEY = 'delegates-v1'
const SWITCHBOARD_URL_DEFAULT = 'ws://localhost:7577'

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

export async function getDelegates(vaultUuid) {
  if (!vaultUuid) return []
  const all = await load()
  return (all[vaultUuid] ?? []).map(migrate)
}

export async function addDelegate(vaultUuid, name, publicKeySpki, id = crypto.randomUUID()) {
  const all = await load()
  const delegate = {
    id,
    name,
    publicKey: Array.from(new Uint8Array(publicKeySpki)),
    created: Date.now(),
    bcCount: 0,
    bcLastUsed: null,
    relayCount: 0,
    relayLastUsed: null,
  }
  all[vaultUuid] = [delegate, ...(all[vaultUuid] ?? [])]
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

// Verify a signature against registered delegates. On success, increments the
// counter for the given channel ('bc' or 'relay') and returns the delegate.
// Returns null if no delegate matches or signature is invalid.
export async function verifyAndUpdate(vaultUuid, spkiBytes, message, signatureBytes, channel) {
  const all = await load()
  const list = (all[vaultUuid] ?? []).map(migrate)
  for (const d of list) {
    const stored = new Uint8Array(d.publicKey)
    const lenMatch = stored.length === spkiBytes.length
    const bytesMatch = lenMatch && stored.every((b, i) => b === spkiBytes[i])
    if (!bytesMatch) continue
    try {
      const key = await crypto.subtle.importKey(
        'spki', spkiBytes, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']
      )
      const valid = await crypto.subtle.verify(
        { name: 'ECDSA', hash: 'SHA-256' }, key, signatureBytes, message
      )
      if (valid) {
        if (channel === 'relay') {
          d.relayCount = (d.relayCount ?? 0) + 1
          d.relayLastUsed = Date.now()
        } else {
          d.bcCount = (d.bcCount ?? 0) + 1
          d.bcLastUsed = Date.now()
        }
        all[vaultUuid] = list
        await save(all)
        return d
      }
    } catch { continue }
  }
  return null
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
