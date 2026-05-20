import { get, set, del } from 'idb-keyval'

const STORAGE_KEY = 'delegates-v1'

async function load() {
  return (await get(STORAGE_KEY)) ?? {}
}

async function save(all) {
  if (Object.keys(all).length === 0) await del(STORAGE_KEY)
  else await set(STORAGE_KEY, all)
}

export async function getDelegates(vaultUuid) {
  if (!vaultUuid) return []
  const all = await load()
  return all[vaultUuid] ?? []
}

export async function addDelegate(vaultUuid, name, publicKeySpki) {
  const all = await load()
  const delegate = {
    id: crypto.randomUUID(),
    name,
    publicKey: Array.from(new Uint8Array(publicKeySpki)),
    created: Date.now(),
    useCount: 0,
    lastUsed: null,
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

// Verify a signature against registered delegates. On success, increments useCount/lastUsed
// and returns the matching delegate. Returns null if no delegate matches or signature is invalid.
export async function verifyAndUpdate(vaultUuid, spkiBytes, message, signatureBytes) {
  const all = await load()
  const list = all[vaultUuid] ?? []
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
        d.useCount++
        d.lastUsed = Date.now()
        await save(all)
        return d
      }
    } catch { continue }
  }
  return null
}
