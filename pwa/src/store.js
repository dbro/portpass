import { writable } from 'svelte/store'

export const selectedFile     = writable(null) // { handle, name, readonly }
export const dbItems          = writable([])   // Array of { uuid, title, group } — primary vault only
export const secondaryVaults  = writable([])   // Array of { handle, name, filename, readonly, items, uuid, masterPassword }
export const toast            = writable(null) // { message, action?, duration? }
export const clipboardSession = writable(null) // { token: number, expiresAt: number } | null
export const clipboardContext = writable(null) // { token, field, uuid, hash: number[] } | null
