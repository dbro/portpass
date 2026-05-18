const WASM_URL = `${import.meta.env.BASE_URL}portpass.wasm.gz`

export async function loadWasm() {
    const go = new Go()
    const response = await fetch(WASM_URL)

    if (!response.ok) {
        throw new Error(`Failed to fetch WASM: ${response.status} ${response.statusText}`)
    }

    let instance
    try {
        let source = response
        const contentEncoding = response.headers.get('Content-Encoding')

        if (response.url.endsWith('.gz') && contentEncoding !== 'gzip') {
            const ds = new DecompressionStream('gzip')
            const decompressedStream = response.body.pipeThrough(ds)
            source = new Response(decompressedStream, { headers: { 'Content-Type': 'application/wasm' } })
        }

        const result = await WebAssembly.instantiateStreaming(source, go.importObject)
        instance = result.instance
    } catch (e) {
        console.warn('instantiateStreaming failed, trying fallback', e)
        const response2 = await fetch(WASM_URL)
        let buffer = await response2.arrayBuffer()

        const view = new Uint8Array(buffer)
        if (view[0] === 0x1f && view[1] === 0x8b) {
            const ds = new DecompressionStream('gzip')
            const stream = new Blob([buffer]).stream().pipeThrough(ds)
            buffer = await new Response(stream).arrayBuffer()
        }

        const result = await WebAssembly.instantiate(buffer, go.importObject)
        instance = result.instance
    }

    go.run(instance)
}

function parseOrThrow(res) {
    if (typeof res !== 'string') return res
    try { return JSON.parse(res) } catch { throw new Error(res) }
}

// Opens a vault from bytes. Returns the vault UUID string on success.
export function openDatabase(fileData, password) {
    const res = window.openDB(fileData, password)
    const parsed = parseOrThrow(res)
    if (parsed?.uuid) return parsed.uuid
    throw new Error(res || 'Failed to open database')
}

// Creates a new empty vault. Returns the vault UUID string on success.
export function createDatabase(password) {
    const res = window.createDatabase(password)
    const parsed = parseOrThrow(res)
    if (parsed?.uuid) return parsed.uuid
    throw new Error(res || 'Failed to create database')
}

export function closeDatabase(vaultUuid) {
    window.closeDB(vaultUuid)
}

export function getDatabaseData(vaultUuid) {
    return parseOrThrow(window.getDBData(vaultUuid)) || []
}

export function getRecordData(vaultUuid, recordUuid) {
    return parseOrThrow(window.getRecord(vaultUuid, recordUuid))
}

export function getDatabaseInfo(vaultUuid) {
    return parseOrThrow(window.getDBInfo(vaultUuid))
}

export function saveDatabase(vaultUuid) {
    const res = window.saveDB(vaultUuid)
    if (typeof res === 'string') throw new Error(res)
    return res // Uint8Array
}

export function updateRecordFields(vaultUuid, recordUuid, fields) {
    const args = [vaultUuid, recordUuid ?? '']
    for (const [k, v] of Object.entries(fields)) {
        const str = (v == null) ? '' : (typeof v === 'object') ? JSON.stringify(v) : String(v)
        args.push(k, str)
    }
    const res = window.UpdateRecordFields(...args)
    if (typeof res === 'string' && res.length === 32) return res // UUID hex (new record)
    if (res) throw new Error(res)
}

export function updateDBFields(vaultUuid, fields) {
    const args = [vaultUuid]
    for (const [k, v] of Object.entries(fields)) args.push(k, String(v ?? ''))
    const err = window.UpdateDBFields(...args)
    if (err) throw new Error(err)
}

export function deleteRecord(vaultUuid, recordUuid) {
    const err = window.deleteRecord(vaultUuid, recordUuid)
    if (err) throw new Error(err)
}

export function searchRecords(vaultUuid, query, namesOnly) {
    return parseOrThrow(window.searchRecords(vaultUuid, query, namesOnly))
}

export function getAutocompleteSuggestion(vaultUuid, field, prefix) {
    return window.getSuggestion(vaultUuid, field, prefix) || ''
}

export function getTOTP(vaultUuid, recordUuid) {
    return parseOrThrow(window.getTOTP(vaultUuid, recordUuid, true))
}

export function getTOTPTiming(vaultUuid, recordUuid) {
    return parseOrThrow(window.getTOTP(vaultUuid, recordUuid, false))
}

// Copies a standard field value directly to clipboard from WASM.
// returnHash=true causes a SHA-256 hash of the value to be returned (for clipboard drain).
export function copyFieldToClipboard(vaultUuid, recordUuid, fieldname, returnHash = false) {
    return parseOrThrow(window.copyFieldToClipboard(vaultUuid, recordUuid, fieldname, returnHash))
}

// Copies a custom field value directly to clipboard from WASM.
export function copyCustomFieldToClipboard(vaultUuid, recordUuid, customFieldName, returnHash = false) {
    return parseOrThrow(window.copyCustomFieldToClipboard(vaultUuid, recordUuid, customFieldName, returnHash))
}

// Copies the current TOTP code directly to clipboard from WASM. No drain needed (codes expire).
export function copyTOTP(vaultUuid, recordUuid) {
    return parseOrThrow(window.copyTOTP(vaultUuid, recordUuid))
}

// Returns the plaintext value of a standard sensitive field for display only.
export function getFieldValue(vaultUuid, recordUuid, fieldname) {
    const res = parseOrThrow(window.GetFieldValue(vaultUuid, recordUuid, fieldname))
    return res?.value ?? null
}

// Returns the plaintext value of a custom field for display only.
export function getCustomFieldValue(vaultUuid, recordUuid, customFieldName) {
    const res = parseOrThrow(window.GetCustomFieldValue(vaultUuid, recordUuid, customFieldName))
    return res?.value ?? null
}

// Encrypts a plaintext string inside WASM using the vault's stretched key.
// Returns { iv, ciphertext } (hex strings). No key material leaves WASM.
export function encryptForSecondaryVaults(vaultUuid, plaintext) {
    return parseOrThrow(window.encryptForSecondaryVaults(vaultUuid, plaintext))
}

// Decrypts a ciphertext encrypted by encryptForSecondaryVaults. Returns plaintext string.
export function decryptForSecondaryVaults(vaultUuid, iv, ciphertext) {
    const res = window.decryptForSecondaryVaults(vaultUuid, iv, ciphertext)
    if (typeof res !== 'string' || res === 'decryption failed' || res === 'vault not open') throw new Error(res)
    return res
}

// Read a vault file and load it into WASM. Returns the vault UUID.
export async function loadVaultFile(handle, password) {
    const file = await handle.getFile()
    const buf  = await file.arrayBuffer()
    return openDatabase(new Uint8Array(buf), password)
}
