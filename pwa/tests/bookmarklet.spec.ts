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

// Creates a paired autofill profile via the VaultSheet UI and returns its
// bookmarklet URL. The URL must not contain private key material.
async function createDelegateBookmarklet(portpass: Page): Promise<string> {
  await portpass.locator('.vault-pill').click()
  await expect(portpass.locator('.vault-settings-body')).toBeVisible()

  await portpass.getByRole('button', { name: '+ Add same-profile bookmarklet' }).click()
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
  title: string, username?: string, password?: string, autotype: string, url?: string,
  notes?: string, totpSecret?: string, custom?: { name: string, value: string, sensitive?: boolean },
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
  if (opts.notes) {
    await portpass.locator('textarea.input.mono').fill(opts.notes)
  }
  if (opts.totpSecret) {
    await portpass.locator('input[placeholder="Base32 secret or otpauth:// URI"]').fill(opts.totpSecret)
  }
  if (opts.custom) {
    await portpass.locator('button.add-custom-field').click()
    await portpass.getByPlaceholder('Field name').fill(opts.custom.name)
    await portpass.getByPlaceholder('Value').fill(opts.custom.value)
    if (opts.custom.sensitive) await portpass.getByRole('button', { name: 'Hide value' }).click()
  }
  await portpass.locator('.mode-toggle').getByText('Raw').click()
  await portpass.locator('.autotype-input').fill(opts.autotype)
  await portpass.getByRole('button', { name: 'Save' }).click()
  await portpass.locator('.record-row', { hasText: opts.title }).click()
}

// Opens the autofill popup and optionally clicks the first record row (transitioning to
// the waiting phase). Returns the autofill popup Page for further assertions.
// In the new flow the popup stays open (waiting phase) until the user clicks a form
// field; there is no page-level overlay injected into the host page.
async function activateBookmarklet(
  login: Page, bookmarkletUrl: string, opts: { clickRow?: boolean } = {}
): Promise<Page> {
  const { clickRow = true } = opts
  const context = login.context()
  const popupPromise = context.waitForEvent('page')

  const code = bookmarkletUrl.replace('javascript:', '')
  await login.evaluate(new Function(decodeURIComponent(code)) as any)

  const popup = await popupPromise
  await popup.waitForLoadState('domcontentloaded')

  // Wait for: picker rows, waiting phase (single exact match auto-advance),
  // no-match notice, or popup close.
  const which = await Promise.race([
    popup.locator('.rec-row').first().waitFor({ timeout: 10000 }).then(() => 'picker').catch(() => 'timeout'),
    popup.locator('.selected-record-row').first().waitFor({ timeout: 10000 }).then(() => 'waiting').catch(() => 'timeout'),
    popup.locator('.pp-notice').first().waitFor({ timeout: 10000 }).then(() => 'no-match').catch(() => 'timeout'),
    popup.waitForEvent('close', { timeout: 10000 }).then(() => 'closed').catch(() => 'timeout'),
  ])

  if (which === 'picker' && clickRow) {
    await popup.locator('.rec-row').first().click()
    // Popup transitions to waiting phase (stays open — fill fires only after field click).
    await popup.locator('.selected-record-row').waitFor({ timeout: 5000 }).catch(() => {})
  }

  await login.evaluate(() => new Promise(r => requestAnimationFrame(r)))
  return popup
}

test.setTimeout(30000)

test.describe('Bookmarklet — autofill popup phases', () => {

  test('generated bookmarklet contains routing data but no private key material', async ({ context }) => {
    const { bookmarkletUrl } = await setupAutofillTest(context)
    const decoded = decodeURIComponent(bookmarkletUrl)

    expect(decoded).toContain('autofill.html')
    expect(decoded).toContain('delegateId')
    expect(decoded).toMatch(/afp1_[a-z2-7]{26}/)
    expect(decoded).not.toContain('privKey')
    expect(decoded).not.toContain('d":"')
    expect(decoded).not.toContain('"key_ops":["sign"]')
  })

  test('revoked paired delegate is rejected even if bookmarklet URL is stolen', async ({ context }) => {
    const { login, portpass, bookmarkletUrl } = await setupAutofillTest(context)
    await createRecord(portpass, {
      title: 'Revoked Site', username: 'alice', password: 'hunter2',
      autotype: '\\u\\t\\p', url: LOGIN_URL,
    })

    await portpass.locator('.vault-pill').click()
    await portpass.getByRole('button', { name: 'Revoke', exact: true }).click()
    await portpass.keyboard.press('Escape')
    await expect(portpass.locator('.vault-settings-body')).not.toBeVisible({ timeout: 3000 })

    const popup = await activateBookmarklet(login, bookmarkletUrl, { clickRow: false })
    await expect(popup.locator('.pp-error-title')).toBeVisible({ timeout: 5000 })
    await expect(login.locator('#user')).toHaveValue('')
    await expect(login.locator('#pass')).toHaveValue('')
  })

  test('cross-profile pairing token can be imported and shows bookmarklet without private key', async ({ context }) => {
    const { portpass } = await setupAutofillTest(context)
    const pairing = await context.newPage()
    await pairing.goto(PORTPASS_URL + 'autofill.html?pair=1')
    await pairing.getByPlaceholder('Portpass Autofill').fill('Portpass Autofill')
    await expect(pairing.getByText(/^[A-Z2-7]{4}-[A-Z2-7]{4}$/)).toBeVisible({ timeout: 15000 })
    const bookmarkletUrl = await pairing.locator('a[href^="javascript:"]').getAttribute('href') ?? ''
    const decoded = decodeURIComponent(bookmarkletUrl)
    expect(decoded).toContain('autofill.html')
    expect(decoded).toMatch(/afp1_[a-z2-7]{26}/)
    expect(decoded).not.toContain('privKey')
    await pairing.getByRole('button', { name: 'Copy token' }).click()
    const tokenBox = pairing.locator('textarea').first()
    await expect.poll(() => tokenBox.inputValue(), { timeout: 15000 }).toMatch(/^ppair1_/)
    const token = await tokenBox.inputValue()
    expect(token).toMatch(/^ppair1_/)

    await portpass.locator('.vault-pill').click()
    await expect(portpass.getByText('In your everyday browser')).toBeVisible()
    await portpass.getByRole('button', { name: '+ Pair everyday profile' }).click()
    await portpass.getByPlaceholder('ppair1_...').fill(token)
    await expect(portpass.locator('.vs-install-warning')).toContainText('Confirm this matches')
    await portpass.getByRole('button', { name: 'Pair everyday profile', exact: true }).click()
    await expect(portpass.locator('.delegate-row', { hasText: 'Everyday profile' })).toBeVisible()
    await expect(portpass.locator('.delegate-row', { hasText: 'Everyday profile' }).locator('.delegate-meta')).toContainText('0 pages filled (cross profile)')
  })

  test('wrong autofill pairing token is rejected', async ({ context }) => {
    const { portpass } = await setupAutofillTest(context)
    await portpass.locator('.vault-pill').click()
    await portpass.getByRole('button', { name: '+ Pair everyday profile' }).click()
    await portpass.getByPlaceholder('ppair1_...').fill('ppair1_not-a-token')
    await expect(portpass.locator('.unlock-error')).toContainText('Pairing token')
  })

  test('waiting phase shows selected record title', async ({ context }) => {
    const { login, portpass, bookmarkletUrl } = await setupAutofillTest(context)
    await createRecord(portpass, { title: 'My Bank', autotype: '\\u\\t\\p\\n' })

    // activateBookmarklet clicks the row — popup transitions to waiting phase.
    const popup = await activateBookmarklet(login, bookmarkletUrl)
    await expect(popup.locator('.selected-record-row')).toBeVisible({ timeout: 5000 })
    await expect(popup.locator('.selected-record-row')).toContainText('My Bank')
    await expect(popup.locator('.pp-arm')).toContainText('Click where to start Autofill')
  })

  test('\\u\\t\\p fills username, tabs to password, fills password', async ({ context }) => {
    const { login, portpass, bookmarkletUrl } = await setupAutofillTest(context)
    await createRecord(portpass, {
      title: 'My Bank', username: 'alice', password: 'hunter2', autotype: '\\u\\t\\p',
    })

    await activateBookmarklet(login, bookmarkletUrl)
    // Popup is in waiting phase. Clicking a field triggers the fill chain.
    await login.locator('#user').click()
    await expect(login.locator('#user')).toHaveValue('alice', { timeout: 5000 })
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

    await expect(login.locator('#user')).toHaveValue('alice', { timeout: 5000 })
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
    await expect(login.locator('#user')).toHaveValue('bob', { timeout: 5000 })
    await expect(login.locator('#pass')).toHaveValue('')
  })

  test('\\p only fills password field (starting from password input)', async ({ context }) => {
    const { login, portpass, bookmarkletUrl } = await setupAutofillTest(context)
    await createRecord(portpass, {
      title: 'Site', password: 'mypassword', autotype: '\\p',
    })

    await activateBookmarklet(login, bookmarkletUrl)
    await login.locator('#pass').click()
    await expect(login.locator('#pass')).toHaveValue('mypassword', { timeout: 5000 })
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
    await expect(login.locator('#user')).toHaveValue('alice', { timeout: 5000 })
    await expect(login.locator('#pass')).toHaveValue('secret')
  })

  test('popup shows done phase after fill and auto-closes', async ({ context }) => {
    const { login, portpass, bookmarkletUrl } = await setupAutofillTest(context)
    await createRecord(portpass, { title: 'My Bank', username: 'alice', password: 'hunter2', autotype: '\\u' })

    const popup = await activateBookmarklet(login, bookmarkletUrl)
    await login.locator('#user').click()
    await expect(popup.locator('.pp-phase-done')).toBeVisible({ timeout: 5000 })
    await popup.waitForEvent('close', { timeout: 5000 })
  })

  test('tapping an armed action disarms it', async ({ context }) => {
    const { login, portpass, bookmarkletUrl } = await setupAutofillTest(context)
    await createRecord(portpass, { title: 'Site', username: 'alice', autotype: '\\u\\p' })

    const popup = await activateBookmarklet(login, bookmarkletUrl)
    await expect(popup.locator('.pp-autofill-summary')).toHaveClass(/active/)
    await popup.getByRole('button', { name: 'Click where to start Autofill' }).click()
    await expect(popup.locator('.pp-autofill-summary')).not.toHaveClass(/active/)
    await expect(popup.locator('.pp-arm')).toHaveCount(0)

    await popup.locator('.pp-field-row', { hasText: 'Username' }).click()
    await expect(popup.locator('.pp-field-row.active')).toContainText('Click where to insert Username')
    await expect(popup.locator('.pp-field-row.active')).not.toContainText('Cancel')
    await popup.locator('.pp-field-row.active').click()
    await expect(popup.locator('.pp-field-row.active')).toHaveCount(0)
    await expect(popup.locator('.pp-arm')).toHaveCount(0)
    expect(popup.isClosed()).toBe(false)
  })

  test('search fallback shown when no URL matches', async ({ context }) => {
    const { login, bookmarkletUrl } = await setupAutofillTest(context)
    const popup = await activateBookmarklet(login, bookmarkletUrl)
    await expect(popup.locator('.pp-notice')).toBeVisible({ timeout: 5000 })
    await expect(popup.locator('.pp-search-wrap .pp-search')).toBeVisible()
  })

  test('single exact match auto-advances to waiting phase', async ({ context }) => {
    const { login, portpass, bookmarkletUrl } = await setupAutofillTest(context)
    await createRecord(portpass, { title: 'Login Site', autotype: '\\u\\t\\p', url: LOGIN_URL })

    const popup = await activateBookmarklet(login, bookmarkletUrl)
    // No picker shown — popup goes directly to waiting.
    await expect(popup.locator('.rec-row')).toHaveCount(0)
    await expect(popup.locator('.selected-record-row')).toBeVisible()
    await expect(popup.locator('.pp-autofill-summary')).toBeVisible()
  })

  test('fuzzy match row shows URL text and pencil; clicking transitions to waiting', async ({ context }) => {
    const { login, portpass, bookmarkletUrl } = await setupAutofillTest(context)
    await createRecord(portpass, {
      title: 'Other Page', autotype: '\\u\\t\\p',
      url: 'http://localhost:5173/different-path',
    })

    const popup = await activateBookmarklet(login, bookmarkletUrl, { clickRow: false })
    await popup.locator('.rec-row').first().waitFor({ timeout: 5000 })
    await expect(popup.locator('.rec-url').first()).toBeVisible()
    await expect(popup.locator('.rec-pencil').first()).toBeVisible()
    // Clicking the row transitions to waiting.
    await popup.locator('.rec-row').first().click()
    await expect(popup.locator('.selected-record-row')).toBeVisible({ timeout: 5000 })
  })

  test('record name and URL have title attributes for overflow tooltip', async ({ context }) => {
    const { login, portpass, bookmarkletUrl } = await setupAutofillTest(context)
    await createRecord(portpass, {
      title: 'A Very Long Record Name That Will Overflow The Column',
      autotype: '\\u\\t\\p',
      url: 'http://localhost:5173/a-very-long-path-that-will-overflow',
    })

    const popup = await activateBookmarklet(login, bookmarkletUrl, { clickRow: false })
    await popup.locator('.rec-row').first().waitFor({ timeout: 5000 })
    const nameTitle = await popup.locator('.rec-name').first().getAttribute('title')
    const urlTitle  = await popup.locator('.rec-url').first().getAttribute('title')
    expect(nameTitle).toBe('A Very Long Record Name That Will Overflow The Column')
    expect(urlTitle).toBeTruthy()
  })

  test('record without autotype sequence still reaches waiting phase with default sequence', async ({ context }) => {
    const { login, portpass, bookmarkletUrl } = await setupAutofillTest(context)
    await portpass.getByRole('button', { name: 'New', exact: true }).click()
    await portpass.getByPlaceholder('e.g. Bank of America').fill('No Autotype')
    await portpass.locator('input.mono').first().fill('pass')
    // Leave autotype empty — should default to \u\t\p\n.
    await portpass.getByRole('button', { name: 'Save' }).click()
    await portpass.locator('.record-row', { hasText: 'No Autotype' }).click()

    const popup = await activateBookmarklet(login, bookmarkletUrl)
    await expect(popup.locator('.selected-record-row')).toContainText('No Autotype', { timeout: 5000 })
  })

  test('credential panel shows non-empty values and masks password until revealed', async ({ context }) => {
    const { login, portpass, bookmarkletUrl } = await setupAutofillTest(context)
    await createRecord(portpass, {
      title: 'Panel Site', username: 'alice', password: 'hunter2', autotype: '\\u\\t\\p',
    })

    const popup = await activateBookmarklet(login, bookmarkletUrl)
    await expect(popup.locator('.pp-autofill-summary')).toContainText('Username → Tab → Password')
    await expect(popup.locator('.pp-field-row', { hasText: 'Username' })).toContainText('alice')
    const password = popup.locator('.pp-field-row', { hasText: 'Password' })
    await expect(password).toContainText('••••••••')
    await password.getByRole('button', { name: 'Reveal Password' }).click()
    await expect(popup.locator('.pp-field-row', { hasText: 'Password' })).toContainText('hunter2')
  })

  test('single-value insertion keeps popup open and ready for another action', async ({ context }) => {
    const { login, portpass, bookmarkletUrl } = await setupAutofillTest(context)
    await createRecord(portpass, {
      title: 'Insert Site', username: 'alice', password: 'hunter2', autotype: '\\u\\t\\p',
    })

    const popup = await activateBookmarklet(login, bookmarkletUrl)
    await expect(popup.locator('.pp-autofill-summary')).toHaveClass(/active/)
    const password = popup.locator('.pp-field-row', { hasText: 'Password' })
    await password.getByRole('button', { name: 'Reveal Password' }).click()
    await expect(popup.locator('.pp-field-row', { hasText: 'Password' })).toContainText('hunter2')
    await popup.locator('.pp-field-row', { hasText: 'Password' }).click()
    await expect(popup.locator('.pp-field-row.active')).toContainText('Click where to insert Password')
    await login.locator('#pass').click()
    await expect(login.locator('#user')).toHaveValue('')
    await expect(login.locator('#pass')).toHaveValue('hunter2')
    await expect(popup.locator('.pp-autofill-summary')).toBeVisible()
    await expect(popup.locator('.pp-autofill-summary')).not.toHaveClass(/active/)
    await expect(popup.locator('.pp-arm')).toHaveCount(0)
    await expect(popup.locator('.pp-field-row', { hasText: 'Password' })).toContainText('••••••••')
    expect(popup.isClosed()).toBe(false)

    await popup.locator('.pp-autofill-summary').click()
    await expect(popup.locator('.pp-autofill-summary')).toHaveClass(/active/)
    await expect(popup.locator('.pp-arm')).toContainText('Click where to start Autofill')
    await popup.locator('.pp-field-row', { hasText: 'Username' }).click()
    await login.locator('#user').click()
    await expect(login.locator('#user')).toHaveValue('alice')
    expect(popup.isClosed()).toBe(false)
  })

  test('focused page field does not start autofill until a new click', async ({ context }) => {
    const { login, portpass, bookmarkletUrl } = await setupAutofillTest(context)
    await createRecord(portpass, {
      title: 'Focus Site', username: 'alice', password: 'hunter2', autotype: '\\u\\t\\p',
    })

    await login.locator('#user').focus()
    await activateBookmarklet(login, bookmarkletUrl)
    await expect(login.locator('#user')).toHaveValue('')
    await expect(login.locator('#pass')).toHaveValue('')
    await login.locator('#user').click()
    await expect(login.locator('#user')).toHaveValue('alice')
    await expect(login.locator('#pass')).toHaveValue('hunter2')
  })

  test('unsupported autofill code shows the sequence warning state', async ({ context }) => {
    const { login, portpass, bookmarkletUrl } = await setupAutofillTest(context)
    await createRecord(portpass, {
      title: 'Warning Site', username: 'alice', password: 'hunter2', autotype: '\\u\\x\\t\\p',
    })

    const popup = await activateBookmarklet(login, bookmarkletUrl)
    await expect(popup.locator('.pp-sequence.warn')).toBeVisible()
    await expect(popup.locator('.pp-sequence.warn span')).toHaveAttribute('title', 'Portpass will skip unsupported code: \\x')
    await expect(popup.locator('.pp-arm')).toHaveCount(0)
  })

  test('notes reveal on row click without arming insertion', async ({ context }) => {
    const { login, portpass, bookmarkletUrl } = await setupAutofillTest(context)
    await createRecord(portpass, {
      title: 'Notes Site', password: 'hunter2', autotype: '\\p', notes: 'private note',
    })

    const popup = await activateBookmarklet(login, bookmarkletUrl)
    const notes = popup.locator('.pp-field-row', { hasText: 'Notes' })
    await expect(notes).toContainText('••••••••')
    await notes.click()
    await expect(popup.locator('.pp-field-row', { hasText: 'Notes' })).toContainText('private note')
    await expect(popup.locator('.pp-field-row.active')).toHaveCount(0)
  })

  test('sensitive custom field reveals lazily and can be inserted', async ({ context }) => {
    const { login, portpass, bookmarkletUrl } = await setupAutofillTest(context)
    await createRecord(portpass, {
      title: 'Custom Site', password: 'hunter2', autotype: '\\p',
      custom: { name: 'PIN', value: '1234', sensitive: true },
    })

    const popup = await activateBookmarklet(login, bookmarkletUrl)
    const pin = popup.locator('.pp-field-row', { hasText: 'PIN' })
    await expect(pin).toContainText('••••••••')
    await pin.getByRole('button', { name: 'Reveal PIN' }).click()
    await expect(popup.locator('.pp-field-row', { hasText: 'PIN' })).toContainText('1234')
    await popup.locator('.pp-field-row', { hasText: 'PIN' }).click()
    await login.locator('#pass').click()
    await expect(login.locator('#pass')).toHaveValue('1234')
  })

  test('revealed one-time code shows a draining bar and refreshes when it expires', async ({ context }) => {
    test.setTimeout(50000)
    const { login, portpass, bookmarkletUrl } = await setupAutofillTest(context)
    await createRecord(portpass, {
      title: 'OTP Site', password: 'hunter2', autotype: '\\p',
      totpSecret: 'JBSWY3DPEHPK3PXP',
    })

    const popup = await activateBookmarklet(login, bookmarkletUrl)
    const otp = popup.locator('.pp-field-row', { hasText: 'One-time code' })
    await otp.getByRole('button', { name: 'Reveal One-time code' }).click()
    await expect(popup.locator('.pp-field-row', { hasText: 'One-time code' }).locator('.pp-totp-bar')).toBeVisible()
    await popup.locator('.pp-field-row', { hasText: 'One-time code' }).getByRole('button', { name: 'Hide One-time code' }).click()
    await expect(popup.locator('.pp-field-row', { hasText: 'One-time code' })).toContainText('••••••••')
    await expect(popup.locator('.pp-field-row', { hasText: 'One-time code' }).locator('.pp-totp-bar')).toHaveCount(0)
    await popup.locator('.pp-field-row', { hasText: 'One-time code' }).getByRole('button', { name: 'Reveal One-time code' }).click()
    await expect(popup.locator('.pp-field-row', { hasText: 'One-time code' }).locator('.pp-totp-bar')).toBeVisible()
    const initial = await popup.locator('.pp-field-row', { hasText: 'One-time code' }).locator('.pp-field-value').textContent()
    await expect.poll(async () => {
      return popup.locator('.pp-field-row', { hasText: 'One-time code' }).locator('.pp-field-value').textContent()
    }, { timeout: 35000 }).not.toBe(initial)
    await popup.locator('.pp-field-row', { hasText: 'One-time code' }).click()
    await login.locator('#pass').click()
    await expect(popup.locator('.pp-field-row', { hasText: 'One-time code' })).toContainText('••••••••')
  })

})
