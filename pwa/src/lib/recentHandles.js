import { get, set } from 'idb-keyval'

// Stores { handle, uuid, name } for primary vaults only — drives auto-load on startup.
// handle may be null on browsers that lack the File System Access API write/permission methods.

export async function getRecentHandles() {
  return (await get('recentHandles')) ?? []
}

export async function pushRecentHandle(handle, uuid = '') {
  const name = handle?.name ?? null
  const handles = await getRecentHandles()
  const filtered = handles.filter(h => {
    if (uuid && h.uuid === uuid) return false
    if ((h.name ?? h.handle?.name) === name) return false
    return true
  })
  try {
    await set('recentHandles', [{ handle, uuid, name }, ...filtered].slice(0, 10))
  } catch {
    // Browser can't serialize FileSystemFileHandle (e.g. Firefox) — store name only.
    await set('recentHandles', [{ handle: null, uuid, name }, ...filtered].slice(0, 10))
  }
}

// For browsers without FileSystemFileHandle persistence — store name only.
export async function pushRecentName(name, uuid = '') {
  const handles = await getRecentHandles()
  const filtered = handles.filter(h => {
    if (uuid && h.uuid === uuid) return false
    if ((h.name ?? h.handle?.name) === name) return false
    return true
  })
  await set('recentHandles', [{ handle: null, uuid, name }, ...filtered].slice(0, 10))
}
