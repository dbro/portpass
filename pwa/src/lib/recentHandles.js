import { get, set } from 'idb-keyval'

// Stores { handle, uuid } for primary vaults only — drives auto-load on startup.

export async function getRecentHandles() {
  return (await get('recentHandles')) ?? []
}

export async function pushRecentHandle(handle, uuid = '') {
  const handles = await getRecentHandles()
  const filtered = handles.filter(h => {
    if (uuid && h.uuid === uuid) return false
    if (h.handle?.name === handle.name) return false
    return true
  })
  await set('recentHandles', [{ handle, uuid }, ...filtered].slice(0, 10))
}
