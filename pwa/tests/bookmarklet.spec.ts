import { test, expect, BrowserContext, Page } from '@playwright/test'
import { makeDelegateBookmarkletUrl } from '../src/lib/bookmarklet.js'

const PORTPASS_URL    = 'http://localhost:5173/portpass/'
const PORTPASS_ORIGIN = 'http://localhost:5173'
const LOGIN_PATH      = '/login-test'
const LOGIN_URL       = PORTPASS_ORIGIN + LOGIN_PATH

const LOGIN_FORM_HTML = `<!doctype html><html><body>
<form id="f">
  <input id="user" type="text"     name="username" autocomplete="username"/>
  <input id="pass" type="password" name="password" autocomplete="current-password"/>
  <button type="submit">Log in</button>
</form>
<script>document.getElementById('f').onsubmit=e=>e.preventDefault()</script>
</body></html>`

// Creates a delegate via the VaultSheet UI and returns its bookmarklet URL.
// The private key is embedded in the returned javascript: URL by the app.
async function createDelegateBookmarklet(portpass: Page): Promise<string> {
  await portpass.locator('.vault-pill').click()
  await expect(portpass.locator('.vault-settings-body')).toBeVisible()

  await portpass.getByRole('button', { name: '+ New bookmarklet' }).click()
  await portpass.getByPlaceholder('e.g. Chrome — work profile').fill('test')
  await portpass.locator('.vs-bookmarklet-chip:not(.chip-inactive)').waitFor({ timeout: 5000 })
  const url = await portpass.locator('.vs-bookmarklet-chip').getAttribute('href') ?? ''

  await portpass.locator('.vs-close-btn').click()
  await portpass.keyboard.press('Escape')
  await expect(portpass.locator('.vault-settings-body')).not.toBeVisible({ timeout: 3000 })

  return url
}

// Opens a main (non-popup) Portpass tab with an unlocked vault, registers a delegate
// bookmarklet, then opens a separate login page. Returns the login page, the Portpass
// page, and the bookmarklet URL to use when activating autofill.
async function setupAutofillTest(context: BrowserContext): Promise<{ login: Page, portpass: Page, bookmarkletUrl: string }> {
  await context.addInitScript(() => {
    if ((window as any).PublicKeyCredential) {
      (window.PublicKeyCredential as any).isUserVerifyingPlatformAuthenticatorAvailable = async () => false
    }
    ;(window as any).showSaveFilePicker = async () => ({
      name: 'new.psafe3',
      createWritable: async () => ({ write: async () => {}, close: async () => {}, abort: async () => {} }),
    })
  })

  const portpass = await context.newPage()
  await portpass.goto(PORTPASS_URL)
  await portpass.getByRole('button', { name: 'Create one' }).click()
  await portpass.getByPlaceholder('Master password').fill('testpassword')
  await portpass.getByRole('button', { name: 'Create vault' }).click()
  await expect(portpass.getByPlaceholder('Search vault')).toBeVisible({ timeout: 10000 })

  const bookmarkletUrl = await createDelegateBookmarklet(portpass)

  const login = await context.newPage()
  await login.route(LOGIN_PATH, route =>
    route.fulfill({ contentType: 'text/html', body: LOGIN_FORM_HTML })
  )
  await login.goto(LOGIN_URL)

  return { login, portpass, bookmarkletUrl }
}

// Create a record in portpass and open its detail view.
async function createRecord(portpass: Page, opts: {
  title: string, username?: string, password?: string, autotype: string, url?: string
}) {
  await portpass.getByRole('button', { name: 'New', exact: true }).click()
  await portpass.getByPlaceholder('e.g. Bank of America').fill(opts.title)
  await portpass.locator('input.mono').first().fill(opts.password ?? 'secret')
  if (opts.username) {
    await portpass.locator('input.input').nth(2).fill(opts.username)
  }
  if (opts.url) {
    await portpass.getByLabel('URL').fill(opts.url)
  }
  await portpass.locator('.autotype-input').fill(opts.autotype)
  await portpass.getByRole('button', { name: 'Save' }).click()
  await portpass.locator('.record-row', { hasText: opts.title }).click()
}

// Run the bookmarklet on the login page. Opens the relay popup, drives the picker
// (selecting the first record), and waits for the popup to close.
// Returns the relay Page so callers can inspect its contents for no-match / error cases.
async function activateBookmarklet(
  login: Page, bookmarkletUrl: string, opts: { clickRow?: boolean } = {}
): Promise<Page> {
  const { clickRow = true } = opts
  const context = login.context()
  const popupPromise = context.waitForEvent('page')

  const code = bookmarkletUrl.replace('javascript:', '')
  await login.evaluate(new Function(decodeURIComponent(code)) as any)

  const relay = await popupPromise
  await relay.waitForLoadState('domcontentloaded')

  // Wait for: picker rows, no-match notice, popup close, or error overlay on login page.
  const which = await Promise.race([
    relay.locator('.rec-row').first().waitFor({ timeout: 10000 }).then(() => 'picker').catch(() => 'timeout'),
    relay.locator('.pp-notice').first().waitFor({ timeout: 10000 }).then(() => 'no-match').catch(() => 'timeout'),
    relay.waitForEvent('close', { timeout: 10000 }).then(() => 'closed').catch(() => 'timeout'),
    login.locator('#__pp').waitFor({ timeout: 10000 }).then(() => 'error').catch(() => 'timeout'),
  ])

  if (which === 'picker' && clickRow) {
    // Click the first record row — single click triggers autofill immediately.
    await relay.locator('.rec-row').first().click()
    // Wait for relay to close after delivering the fill command.
    await relay.waitForEvent('close', { timeout: 12000 }).catch(() => {})
  }

  // Give the browser one animation frame so any fill overlay or error overlay on the
  // login page is guaranteed to be mounted before the test makes assertions.
  await login.evaluate(() => new Promise(r => requestAnimationFrame(r)))
  return relay
}

test.setTimeout(30000)

test.describe('Bookmarklet — overlay and autofill', () => {

  test('overlay shows record title and "Click the field to start from"', async ({ context }) => {
    const { login, portpass, bookmarkletUrl } = await setupAutofillTest(context)
    await createRecord(portpass, { title: 'My Bank', autotype: '\\u\\t\\p\\n' })

    await activateBookmarklet(login, bookmarkletUrl)
    await expect(login.locator('#__pp')).toContainText('My Bank')
    await expect(login.locator('#__pp')).toContainText('Click the field to start from')
  })

  test('\\u\\t\\p fills username, tabs to password, fills password', async ({ context }) => {
    const { login, portpass, bookmarkletUrl } = await setupAutofillTest(context)
    await createRecord(portpass, {
      title: 'My Bank', username: 'alice', password: 'hunter2', autotype: '\\u\\t\\p',
    })

    await activateBookmarklet(login, bookmarkletUrl)
    await login.locator('#user').click()
    // After autotype: success overlay appears, then auto-dismisses after 1.5s.
    await expect(login.locator('#__pp')).toContainText('Filled successfully', { timeout: 3000 })
    await expect(login.locator('#__pp')).toHaveCount(0, { timeout: 3000 })

    await expect(login.locator('#user')).toHaveValue('alice')
    await expect(login.locator('#pass')).toHaveValue('hunter2')
  })

  test('\\u\\t\\p\\n fills both fields and submits the form', async ({ context }) => {
    const { login, portpass, bookmarkletUrl } = await setupAutofillTest(context)
    await createRecord(portpass, {
      title: 'My Bank', username: 'alice', password: 'hunter2', autotype: '\\u\\t\\p\\n',
    })

    let submitted = false
    await login.exposeFunction('__ppSubmitted', () => { submitted = true })
    await login.evaluate(() => {
      document.getElementById('f')!.addEventListener('submit', () => (window as any).__ppSubmitted())
    })

    await activateBookmarklet(login, bookmarkletUrl)
    await login.locator('#user').click()

    await expect(login.locator('#user')).toHaveValue('alice')
    await expect(login.locator('#pass')).toHaveValue('hunter2')
    expect(submitted).toBe(true)
  })

  test('\\u only fills username, does not touch password', async ({ context }) => {
    const { login, portpass, bookmarkletUrl } = await setupAutofillTest(context)
    await createRecord(portpass, {
      title: 'Site', username: 'bob', password: 'secret', autotype: '\\u',
    })

    await activateBookmarklet(login, bookmarkletUrl)
    await login.locator('#user').click()

    await expect(login.locator('#user')).toHaveValue('bob')
    await expect(login.locator('#pass')).toHaveValue('')
  })

  test('\\p only fills password field (starting from password input)', async ({ context }) => {
    const { login, portpass, bookmarkletUrl } = await setupAutofillTest(context)
    await createRecord(portpass, {
      title: 'Site', password: 'mypassword', autotype: '\\p',
    })

    await activateBookmarklet(login, bookmarkletUrl)
    await login.locator('#pass').click()

    await expect(login.locator('#pass')).toHaveValue('mypassword')
    await expect(login.locator('#user')).toHaveValue('')
  })

  test('\\t skips non-input elements (e.g. show-password button) to reach password field', async ({ context }) => {
    const formWithButton = `<!doctype html><html><body>
<form id="f">
  <input id="user" type="text" name="username"/>
  <button type="button" id="toggle">Show</button>
  <input id="pass" type="password" name="password"/>
  <button type="submit">Log in</button>
</form>
<script>document.getElementById('f').onsubmit=e=>e.preventDefault()</script>
</body></html>`

    const { login: _login, portpass, bookmarkletUrl } = await setupAutofillTest(context)

    const login = _login
    await login.route('/login-button-test', route =>
      route.fulfill({ contentType: 'text/html', body: formWithButton })
    )
    await login.goto('http://localhost:5173/login-button-test')

    await createRecord(portpass, {
      title: 'Button Site', username: 'alice', password: 'secret', autotype: '\\u\\t\\p',
    })

    await activateBookmarklet(login, bookmarkletUrl)
    await login.locator('#user').click()

    await expect(login.locator('#user')).toHaveValue('alice')
    await expect(login.locator('#pass')).toHaveValue('secret')
  })

  test('overlay is positioned at fixed top-right', async ({ context }) => {
    const { login, portpass, bookmarkletUrl } = await setupAutofillTest(context)
    await createRecord(portpass, { title: 'Site', autotype: '\\u\\p' })

    await activateBookmarklet(login, bookmarkletUrl)
    const box = await login.locator('#__pp').boundingBox()
    expect(box).not.toBeNull()
    if (box) {
      expect(box.y).toBeLessThan(30)  // near top (14px)
      const vw = login.viewportSize()!.width
      expect(box.x + box.width).toBeGreaterThan(vw - 30)  // near right edge (14px)
    }
  })

  test('success overlay shown after fill and auto-dismisses', async ({ context }) => {
    const { login, portpass, bookmarkletUrl } = await setupAutofillTest(context)
    await createRecord(portpass, { title: 'My Bank', username: 'alice', password: 'hunter2', autotype: '\\u' })

    await activateBookmarklet(login, bookmarkletUrl)
    await login.locator('#user').click()
    await expect(login.locator('#__pp')).toContainText('Filled successfully', { timeout: 3000 })
    await expect(login.locator('#__pp')).toHaveCount(0, { timeout: 3000 })
  })

  test('dismiss button removes the overlay', async ({ context }) => {
    const { login, portpass, bookmarkletUrl } = await setupAutofillTest(context)
    await createRecord(portpass, { title: 'Site', autotype: '\\u\\p' })

    await activateBookmarklet(login, bookmarkletUrl)
    await login.locator('#__pp button').click()
    await expect(login.locator('#__pp')).toHaveCount(0)
  })

  test('search fallback shown when no URL matches in Portpass', async ({ context }) => {
    const { login, bookmarkletUrl } = await setupAutofillTest(context)
    // Vault is open but no records match the login page URL.

    const relay = await activateBookmarklet(login, bookmarkletUrl)
    // New behaviour: relay shows the search fallback (notice bar + search input)
    // instead of an error overlay on the login page.
    await expect(relay.locator('.pp-notice')).toBeVisible({ timeout: 5000 })
    await expect(relay.locator('.pp-search')).toBeVisible()
  })

  test('exact match row shows ✓ match badge and no pencil button', async ({ context }) => {
    const { login, portpass, bookmarkletUrl } = await setupAutofillTest(context)
    await createRecord(portpass, {
      title: 'Login Site', autotype: '\\u\\t\\p', url: LOGIN_URL,
    })

    const relay = await activateBookmarklet(login, bookmarkletUrl, { clickRow: false })
    await expect(relay.locator('.rec-match-badge')).toBeVisible({ timeout: 5000 })
    await expect(relay.locator('.rec-pencil')).not.toBeVisible()
  })

  test('fuzzy match row shows URL text and pencil button', async ({ context }) => {
    const { login, portpass, bookmarkletUrl } = await setupAutofillTest(context)
    await createRecord(portpass, {
      title: 'Other Page', autotype: '\\u\\t\\p',
      url: 'http://localhost:5173/different-path',  // same host, different path → fuzzy
    })

    const relay = await activateBookmarklet(login, bookmarkletUrl, { clickRow: false })
    await relay.locator('.rec-row').first().waitFor({ timeout: 5000 })
    await expect(relay.locator('.rec-url').first()).toBeVisible()
    await expect(relay.locator('.rec-pencil').first()).toBeVisible()
  })

  test('record name and URL have title attributes for overflow tooltip', async ({ context }) => {
    const { login, portpass, bookmarkletUrl } = await setupAutofillTest(context)
    await createRecord(portpass, {
      title: 'A Very Long Record Name That Will Overflow The Column',
      autotype: '\\u\\t\\p',
      url: 'http://localhost:5173/a-very-long-path-that-will-overflow',
    })

    const relay = await activateBookmarklet(login, bookmarkletUrl, { clickRow: false })
    await relay.locator('.rec-row').first().waitFor({ timeout: 5000 })
    const nameTitle = await relay.locator('.rec-name').first().getAttribute('title')
    const urlTitle  = await relay.locator('.rec-url').first().getAttribute('title')
    expect(nameTitle).toBe('A Very Long Record Name That Will Overflow The Column')
    expect(urlTitle).toBeTruthy()
  })

  test('record without autotype sequence uses the default and shows overlay', async ({ context }) => {
    const { login, portpass, bookmarkletUrl } = await setupAutofillTest(context)
    await portpass.getByRole('button', { name: 'New', exact: true }).click()
    await portpass.getByPlaceholder('e.g. Bank of America').fill('No Autotype')
    await portpass.locator('input.mono').first().fill('pass')
    // Leave autotype empty — should default to \u\t\p\n.
    await portpass.getByRole('button', { name: 'Save' }).click()
    await portpass.locator('.record-row', { hasText: 'No Autotype' }).click()

    await activateBookmarklet(login, bookmarkletUrl)
    await expect(login.locator('#__pp')).toContainText('No Autotype')
    await expect(login.locator('#__pp')).toContainText('Click the field to start from')
  })

})
