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

        // GitHub Pages serves .gz as a raw binary without Content-Encoding: gzip,
        // so we decompress manually. Vite dev server sets the header and browsers
        // decompress transparently.
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

export function openDatabase(fileData, password) {
    const err = window.openDB(fileData, password)
    if (err) throw new Error(err)
}

function parseOrThrow(res) {
    if (typeof res !== 'string') return res
    try { return JSON.parse(res) } catch { throw new Error(res) }
}

export function getDatabaseData() {
    return parseOrThrow(window.getDBData()) || []
}

export function getRecordData(uuid) {
    return parseOrThrow(window.getRecord(uuid))
}

export function createDatabase(password) {
    const err = window.createDatabase(password)
    if (err) throw new Error(err)
}

export function getDatabaseInfo() {
    return parseOrThrow(window.getDBInfo())
}

export function saveDatabase() {
    const res = window.saveDB()
    if (typeof res === 'string') throw new Error(res)
    return res // Uint8Array
}

export function updateRecordFields(uuid, fields) {
    const args = [uuid ?? '']
    for (const [k, v] of Object.entries(fields)) args.push(k, String(v ?? ''))
    const res = window.UpdateRecordFields(...args)
    if (typeof res === 'string' && res.length === 32) return res // UUID hex (new record)
    if (res) throw new Error(res)
}

export function updateDBFields(fields) {
    const args = []
    for (const [k, v] of Object.entries(fields)) args.push(k, String(v ?? ''))
    const err = window.UpdateDBFields(...args)
    if (err) throw new Error(err)
}

export function deleteRecord(uuid) {
    const err = window.deleteRecord(uuid)
    if (err) throw new Error(err)
}

export function searchRecords(query, namesOnly) {
    return parseOrThrow(window.searchRecords(query, namesOnly))
}

export function getAutocompleteSuggestion(field, prefix) {
    return window.getSuggestion(field, prefix) || ''
}
