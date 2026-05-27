import { test, expect, BrowserContext, Page } from '@playwright/test'

const PORTPASS_URL    = 'http://localhost:5173/portpass/'
const PORTPASS_ORIGIN = 'http://localhost:5173'

// Opens a Portpass popup from an opener page that is at the Portpass origin but does NOT
// run the Portpass app (which would set window.name = 'portpass_autofill' and cause
// window.open() to focus the existing tab instead of creating a new popup).
async function openPortpassPopup(context: BrowserContext): Promise<{ opener: Page, popup: Page }> {
  const opener = await context.newPage()
  // Serve a minimal launcher page at the Portpass origin so postMessage targetOrigin works.
  await opener.route('/portpass/launcher', route =>
    route.fulfill({ contentType: 'text/html', body: '<html><body>launcher</body></html>' })
  )
  await opener.goto('http://localhost:5173/portpass/launcher')

  const [popup] = await Promise.all([
    context.waitForEvent('page'),
    opener.evaluate((url) => {
      ;(window as any).portpassWin = window.open(url, 'portpass_autofill')
    }, PORTPASS_URL),
  ])

  return { opener, popup }
}

// Creates a new vault in the popup.
async function createVaultInPopup(popup: Page) {
  await popup.getByRole('button', { name: 'Create one' }).click()
  await popup.getByPlaceholder('Master password').fill('testpassword')
  await popup.getByRole('button', { name: 'Create vault' }).click()
  await expect(popup.getByPlaceholder('Search vault')).toBeVisible({ timeout: 10000 })
}

// Performs the ECDH key exchange from the opener side and returns the derived AES
// CryptoKey so subsequent calls can decrypt record responses.
async function doKeyExchange(opener: Page): Promise<void> {
  // The CryptoKey is stored in window._autofillSessionKey on the opener page.
  await opener.evaluate(async (origin) => {
    const win = (window as any).portpassWin

    const pair = await crypto.subtle.generateKey(
      { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveKey']
    )
    const pubJwk = await crypto.subtle.exportKey('jwk', pair.publicKey)

    const response = await new Promise<any>((resolve) => {
      window.addEventListener('message', (e) => {
        if (e.source === win && e.data?.type) resolve(e.data)
      }, { once: true })
      win.postMessage({ type: 'hello', pubkey: pubJwk }, origin)
    })

    if (response.type !== 'hello') {
      ;(window as any)._autofillError = response
      return
    }

    const portpassPub = await crypto.subtle.importKey(
      'jwk', response.pubkey,
      { name: 'ECDH', namedCurve: 'P-256' }, false, []
    )
    ;(window as any)._autofillSessionKey = await crypto.subtle.deriveKey(
      { name: 'ECDH', public: portpassPub },
      pair.privateKey,
      { name: 'AES-GCM', length: 256 }, false, ['decrypt']
    )
  }, PORTPASS_ORIGIN)
}

// Sends a query, then decrypts the record response using the session key stored in
// window._autofillSessionKey. Returns the full response with decrypted fields.
async function sendQuery(opener: Page): Promise<any> {
  return opener.evaluate(async (origin) => {
    const win = (window as any).portpassWin
    const sessionKey = (window as any)._autofillSessionKey

    const raw = await new Promise<any>((resolve) => {
      window.addEventListener('message', (e) => {
        if (e.source === win && e.data?.type) resolve(e.data)
      }, { once: true })
      win.postMessage({ type: 'query' }, origin)
      setTimeout(() => resolve({ timeout: true }), 5000)
    })

    if (raw.type !== 'record' || !sessionKey) return raw

    // Decrypt the fields blob.
    const iv = Uint8Array.from(atob(raw.iv), c => c.charCodeAt(0))
    const ct = Uint8Array.from(atob(raw.ciphertext), c => c.charCodeAt(0))
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, sessionKey, ct)
    const fields = JSON.parse(new TextDecoder().decode(pt))
    return { ...raw, fields }
  }, PORTPASS_ORIGIN)
}

// Sends a query WITHOUT a prior key exchange (raw, no decryption step).
async function sendRawQuery(opener: Page): Promise<any> {
  return opener.evaluate(async (origin) => {
    const win = (window as any).portpassWin
    return new Promise((resolve) => {
      window.addEventListener('message', (e) => {
        if (e.source === win && e.data?.type) resolve(e.data)
      }, { once: true })
      win.postMessage({ type: 'query' }, origin)
      setTimeout(() => resolve({ timeout: true }), 5000)
    })
  }, PORTPASS_ORIGIN)
}

test.describe('Autofill popup mode — query protocol', () => {

  test.beforeEach(async ({ context }) => {
    await context.addInitScript(() => {
      if ((window as any).PublicKeyCredential) {
        (window.PublicKeyCredential as any).isUserVerifyingPlatformAuthenticatorAvailable = async () => false
      }
      ;(window as any).showSaveFilePicker = async () => ({
        name: 'new.psafe3',
        createWritable: async () => ({ write: async () => {}, close: async () => {}, abort: async () => {} }),
      })
    })
  })

  test('hello while vault is locked returns error', async ({ context }) => {
    const { opener, popup } = await openPortpassPopup(context)
    await popup.waitForSelector('button:text("Open vault file"), button:text("Create one")', { timeout: 10000 })

    await opener.evaluate(async (origin) => {
      const win = (window as any).portpassWin
      const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveKey'])
      const pubJwk = await crypto.subtle.exportKey('jwk', pair.publicKey)
      const response = await new Promise<any>((resolve) => {
        window.addEventListener('message', (e) => { if (e.source === win) resolve(e.data) }, { once: true })
        win.postMessage({ type: 'hello', pubkey: pubJwk }, origin)
      })
      ;(window as any)._helloResponse = response
    }, PORTPASS_ORIGIN)

    const resp = await opener.evaluate(() => (window as any)._helloResponse)
    expect(resp.type).toBe('error')
    expect(resp.message).toContain('Vault is locked')
  })

  test('query without prior key exchange returns error', async ({ context }) => {
    const { opener, popup } = await openPortpassPopup(context)
    await createVaultInPopup(popup)

    const response = await sendRawQuery(opener)
    expect(response.type).toBe('error')
    expect(response.message).toContain('No secure session')
  })

  test('unlocked vault with no record selected returns error after key exchange', async ({ context }) => {
    const { opener, popup } = await openPortpassPopup(context)
    await createVaultInPopup(popup)
    await doKeyExchange(opener)

    const response = await sendQuery(opener)
    expect(response.type).toBe('error')
    expect(response.message).toContain('Open a record')
  })

  test('record without autotype uses default sequence \\u\\t\\p\\n', async ({ context }) => {
    const { opener, popup } = await openPortpassPopup(context)
    await createVaultInPopup(popup)

    await popup.getByRole('button', { name: 'New', exact: true }).click()
    await popup.getByPlaceholder('e.g. Bank of America').fill('No Autotype Site')
    await popup.locator('input.mono').first().fill('secret')
    // Leave autotype empty — bookmarklet should default to \u\t\p\n.
    await popup.getByRole('button', { name: 'Save' }).click()
    await popup.locator('.record-row', { hasText: 'No Autotype Site' }).click()

    await doKeyExchange(opener)
    const response = await sendQuery(opener)
    expect(response.type).toBe('record')
    expect(response.autotype).toBe('\\u\\t\\p\\n')
  })

  test('record response contains iv and ciphertext, not plaintext fields', async ({ context }) => {
    const { opener, popup } = await openPortpassPopup(context)
    await createVaultInPopup(popup)

    await popup.getByRole('button', { name: 'New', exact: true }).click()
    await popup.getByPlaceholder('e.g. Bank of America').fill('My Bank')
    await popup.locator('input.mono').first().fill('hunter2')
    await popup.locator('input.input').nth(2).fill('alice')
    await popup.locator('.mode-toggle').getByText('Raw').click()
    await popup.locator('.autotype-input').fill('\\u\\t\\p\\n')
    await popup.getByRole('button', { name: 'Save' }).click()
    await popup.locator('.record-row', { hasText: 'My Bank' }).click()

    await doKeyExchange(opener)

    // Get the raw (not-decrypted) response to verify ciphertext is present.
    const raw = await opener.evaluate(async (origin) => {
      const win = (window as any).portpassWin
      return new Promise<any>((resolve) => {
        window.addEventListener('message', (e) => {
          if (e.source === win && e.data?.type) resolve(e.data)
        }, { once: true })
        win.postMessage({ type: 'query' }, origin)
        setTimeout(() => resolve({ timeout: true }), 5000)
      })
    }, PORTPASS_ORIGIN)

    expect(raw.type).toBe('record')
    expect(raw.title).toBe('My Bank')
    expect(raw.autotype).toBe('\\u\\t\\p\\n')
    expect(raw.iv).toBeDefined()
    expect(raw.ciphertext).toBeDefined()
    // No plaintext fields in transit
    expect(raw.fields).toBeUndefined()
  })

  test('decrypted response contains correct credentials', async ({ context }) => {
    const { opener, popup } = await openPortpassPopup(context)
    await createVaultInPopup(popup)

    await popup.getByRole('button', { name: 'New', exact: true }).click()
    await popup.getByPlaceholder('e.g. Bank of America').fill('My Bank')
    await popup.locator('input.mono').first().fill('hunter2')
    await popup.locator('input.input').nth(2).fill('alice')
    await popup.locator('.mode-toggle').getByText('Raw').click()
    await popup.locator('.autotype-input').fill('\\u\\t\\p\\n')
    await popup.getByRole('button', { name: 'Save' }).click()
    await popup.locator('.record-row', { hasText: 'My Bank' }).click()

    await doKeyExchange(opener)
    const response = await sendQuery(opener)

    expect(response.type).toBe('record')
    expect(response.title).toBe('My Bank')
    expect(response.autotype).toBe('\\u\\t\\p\\n')
    expect(response.fields.u).toBe('alice')
    expect(response.fields.p).toBe('hunter2')
  })

  test('two sessions derive independent keys', async ({ context }) => {
    const { opener, popup } = await openPortpassPopup(context)
    await createVaultInPopup(popup)

    await popup.getByRole('button', { name: 'New', exact: true }).click()
    await popup.getByPlaceholder('e.g. Bank of America').fill('Site')
    await popup.locator('input.mono').first().fill('pass')
    await popup.locator('.mode-toggle').getByText('Raw').click()
    await popup.locator('.autotype-input').fill('\\u\\p')
    await popup.getByRole('button', { name: 'Save' }).click()
    await popup.locator('.record-row', { hasText: 'Site' }).click()

    // First session.
    await doKeyExchange(opener)
    const r1 = await opener.evaluate(async (origin) => {
      const win = (window as any).portpassWin
      return new Promise<any>((resolve) => {
        window.addEventListener('message', (e) => { if (e.source === win && e.data?.type) resolve(e.data) }, { once: true })
        win.postMessage({ type: 'query' }, origin)
      })
    }, PORTPASS_ORIGIN)

    // Second session — new hello, new key pair on both sides.
    await doKeyExchange(opener)
    const r2 = await opener.evaluate(async (origin) => {
      const win = (window as any).portpassWin
      return new Promise<any>((resolve) => {
        window.addEventListener('message', (e) => { if (e.source === win && e.data?.type) resolve(e.data) }, { once: true })
        win.postMessage({ type: 'query' }, origin)
      })
    }, PORTPASS_ORIGIN)

    // IVs are random per encryption — very high probability they differ.
    expect(r1.iv).not.toBe(r2.iv)
  })

  test('switching records updates the decrypted query response', async ({ context }) => {
    const { opener, popup } = await openPortpassPopup(context)
    await createVaultInPopup(popup)

    for (const title of ['Site A', 'Site B']) {
      await popup.getByRole('button', { name: 'New', exact: true }).click()
      await popup.getByPlaceholder('e.g. Bank of America').fill(title)
      await popup.locator('input.mono').first().fill('pass')
      await popup.locator('.mode-toggle').getByText('Raw').click()
      await popup.locator('.autotype-input').fill('\\u\\p')
      await popup.getByRole('button', { name: 'Save' }).click()
    }

    await doKeyExchange(opener)

    await popup.locator('.record-row', { hasText: 'Site A' }).click()
    const responseA = await sendQuery(opener)
    expect(responseA.title).toBe('Site A')

    await popup.locator('.record-row', { hasText: 'Site B' }).click()
    const responseB = await sendQuery(opener)
    expect(responseB.title).toBe('Site B')
  })

})

test.describe('Autofill popup mode — UI', () => {

  test('multi-instance warning is suppressed when opened as popup', async ({ context }) => {
    await context.addInitScript(() => {
      if ((window as any).PublicKeyCredential) {
        (window.PublicKeyCredential as any).isUserVerifyingPlatformAuthenticatorAvailable = async () => false
      }
      ;(window as any).showSaveFilePicker = async () => ({
        name: 'new.psafe3',
        createWritable: async () => ({ write: async () => {}, close: async () => {}, abort: async () => {} }),
      })
    })
    const { popup } = await openPortpassPopup(context)
    await popup.waitForSelector('button:text("Open vault file"), button:text("Create one")', { timeout: 10000 })
    await expect(popup.locator('.multi-instance-warning')).toHaveCount(0)
  })

  // NOTE: "Unlock to use Autofill" text on the StartPage unlock screen requires a real
  // FileSystemFileHandle (functions survive IDB structured-clone). Test-environment mock
  // handles lose their methods on IDB round-trip, so the StartPage stays at landing mode
  // after lock. Verify this text manually: open Portpass as a popup from a login page,
  // lock the vault, and confirm the sub-text reads "Unlock to use Autofill".

})

// NOTE: The autofill bridge mode tests that tested App.svelte's tryBridge() have been removed.
// That path (Portpass opened as a popup bridging postMessage↔BC) is no longer exercised
// by the bookmarklet — autofill.html now handles the same-profile BC bridging directly and
// authenticates with ECDSA. The autofill.html same-profile flow is covered by bookmarklet.spec.ts.
