import { get, set } from 'idb-keyval'
import { encryptForSecondaryVaults, decryptForSecondaryVaults } from '../wasm.js'

const STORAGE_KEY   = 'secondary-vaults-v1'
const MAX_SECONDARY = 10

// Encryption and decryption happen entirely inside WASM using the vault's stretched key.
// No key material ever appears in JS — only ciphertext and IVs (both non-secret).
// Secondary vault associations are cleared automatically when the primary vault's master
// password changes, because the stretched key changes with the new salt.

async function load()    { return (await get(STORAGE_KEY)) ?? {} }
async function save(all) { await set(STORAGE_KEY, all) }

// Returns [{filename, vaultUuid, handle, masterPassword}] for the given primary vault.
export async function getSecondaryCredentials(primaryVaultUuid) {
  const all     = await load()
  const entries = all[primaryVaultUuid] ?? []
  const results = []
  for (const e of entries) {
    try {
      const masterPassword = decryptForSecondaryVaults(primaryVaultUuid, e.iv, e.ciphertext)
      results.push({ filename: e.filename, vaultUuid: e.vaultUuid, handle: e.handle ?? null, masterPassword })
    } catch {}
  }
  return results
}

export async function addSecondaryCredential(primaryVaultUuid, filename, vaultUuid, secondaryMasterPassword, handle = null) {
  const { iv, ciphertext } = encryptForSecondaryVaults(primaryVaultUuid, secondaryMasterPassword)
  const all     = await load()
  const entries = (all[primaryVaultUuid] ?? []).filter(e => e.vaultUuid !== vaultUuid)
  entries.unshift({ filename, vaultUuid, handle, iv, ciphertext })
  all[primaryVaultUuid] = entries.slice(0, MAX_SECONDARY)
  try {
    await save(all)
  } catch (e) {
    if (e.name === 'DataCloneError') {
      all[primaryVaultUuid] = all[primaryVaultUuid].map(entry =>
        entry.vaultUuid === vaultUuid ? { ...entry, handle: null } : entry
      )
      await save(all)
    } else throw e
  }
}

export async function removeSecondaryCredential(primaryVaultUuid, secondaryVaultUuid) {
  const all = await load()
  if (!all[primaryVaultUuid]) return
  all[primaryVaultUuid] = all[primaryVaultUuid].filter(e => e.vaultUuid !== secondaryVaultUuid)
  if (all[primaryVaultUuid].length === 0) delete all[primaryVaultUuid]
  await save(all)
}
