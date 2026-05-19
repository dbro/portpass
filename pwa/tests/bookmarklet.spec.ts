import { test, expect, BrowserContext, Page } from '@playwright/test'
import { makeBookmarkletUrl } from '../src/lib/bookmarklet.js'

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

// Stand up the login page and a Portpass popup from it so window.opener is set.
// Returns { loginPage, portpassPopup }.
async function setupAutofillTest(context: BrowserContext): Promise<{ login: Page, portpass: Page }> {
  await context.addInitScript(() => {
    if ((window as any).PublicKeyCredential) {
      (window.PublicKeyCredential as any).isUserVerifyingPlatformAuthenticatorAvailable = async () => false
    }
    ;(window as any).showSaveFilePicker = async () => ({
      name: 'new.psafe3',
      createWritable: async () => ({ write: async () => {}, close: async () => {}, abort: async () => {} }),
    })
  })

  // Serve the login form at LOGIN_PATH.
  const login = await context.newPage()
  await login.route(LOGIN_PATH, route =>
    route.fulfill({ contentType: 'text/html', body: LOGIN_FORM_HTML })
  )
  await login.goto(LOGIN_URL)

  // Open Portpass from the login page so window.opener is established.
  const [portpass] = await Promise.all([
    context.waitForEvent('page'),
    login.evaluate((url) => {
      ;(window as any).portpassWin = window.open(url, 'portpass_autofill')
    }, PORTPASS_URL),
  ])

  // Create a vault in the popup.
  await portpass.getByRole('button', { name: 'Create one' }).click()
  await portpass.getByPlaceholder('Master password').fill('testpassword')
  await portpass.getByRole('button', { name: 'Create vault' }).click()
  await expect(portpass.getByPlaceholder('Search vault')).toBeVisible({ timeout: 10000 })

  return { login, portpass }
}

// Create a record in portpass and open its detail view.
async function createRecord(portpass: Page, opts: {
  title: string, username?: string, password?: string, autotype: string
}) {
  await portpass.getByRole('button', { name: 'New', exact: true }).click()
  await portpass.getByPlaceholder('e.g. Bank of America').fill(opts.title)
  await portpass.locator('input.mono').first().fill(opts.password ?? 'secret')
  if (opts.username) {
    await portpass.locator('input.input').nth(2).fill(opts.username)
  }
  await portpass.locator('.autotype-input').fill(opts.autotype)
  await portpass.getByRole('button', { name: 'Save' }).click()
  await portpass.locator('.record-row', { hasText: opts.title }).click()
}

// Run the bookmarklet on the login page and wait for the overlay to appear.
async function activateBookmarklet(login: Page) {
  const code = makeBookmarkletUrl(PORTPASS_URL)
    .replace('javascript:', '')  // strip the scheme — evaluate runs the code directly
  await login.evaluate(new Function(decodeURIComponent(code)) as any)
  await expect(login.locator('#__pp')).toBeVisible({ timeout: 12000 })
  // Give the browser one animation frame so the click listener registered inside showOverlay()
  // is guaranteed to be active before the test clicks a field.
  await login.evaluate(() => new Promise(r => requestAnimationFrame(r)))
}

test.setTimeout(25000)

test.describe('Bookmarklet — overlay and autofill', () => {

  test('overlay shows record title and "Click the field to start from"', async ({ context }) => {
    const { login, portpass } = await setupAutofillTest(context)
    await createRecord(portpass, { title: 'My Bank', autotype: '\\u\\t\\p\\n' })

    await activateBookmarklet(login)
    await expect(login.locator('#__pp')).toContainText('My Bank')
    await expect(login.locator('#__pp')).toContainText('Click the field to start from')
  })

  test('\\u\\t\\p fills username, tabs to password, fills password', async ({ context }) => {
    const { login, portpass } = await setupAutofillTest(context)
    await createRecord(portpass, {
      title: 'My Bank', username: 'alice', password: 'hunter2', autotype: '\\u\\t\\p',
    })

    await activateBookmarklet(login)
    await login.locator('#user').click()
    // Overlay is removed by onFieldClick — its absence confirms autotype ran.
    await expect(login.locator('#__pp')).not.toBeVisible({ timeout: 3000 })

    await expect(login.locator('#user')).toHaveValue('alice')
    await expect(login.locator('#pass')).toHaveValue('hunter2')
  })

  test('\\u\\t\\p\\n fills both fields and submits the form', async ({ context }) => {
    const { login, portpass } = await setupAutofillTest(context)
    await createRecord(portpass, {
      title: 'My Bank', username: 'alice', password: 'hunter2', autotype: '\\u\\t\\p\\n',
    })

    // Detect form submission.
    let submitted = false
    await login.exposeFunction('__ppSubmitted', () => { submitted = true })
    await login.evaluate(() => {
      document.getElementById('f')!.addEventListener('submit', () => (window as any).__ppSubmitted())
    })

    await activateBookmarklet(login)
    await login.locator('#user').click()

    await expect(login.locator('#user')).toHaveValue('alice')
    await expect(login.locator('#pass')).toHaveValue('hunter2')
    expect(submitted).toBe(true)
  })

  test('\\u only fills username, does not touch password', async ({ context }) => {
    const { login, portpass } = await setupAutofillTest(context)
    await createRecord(portpass, {
      title: 'Site', username: 'bob', password: 'secret', autotype: '\\u',
    })

    await activateBookmarklet(login)
    await login.locator('#user').click()

    await expect(login.locator('#user')).toHaveValue('bob')
    await expect(login.locator('#pass')).toHaveValue('')
  })

  test('\\p only fills password field (starting from password input)', async ({ context }) => {
    const { login, portpass } = await setupAutofillTest(context)
    await createRecord(portpass, {
      title: 'Site', password: 'mypassword', autotype: '\\p',
    })

    await activateBookmarklet(login)
    await login.locator('#pass').click()

    await expect(login.locator('#pass')).toHaveValue('mypassword')
    await expect(login.locator('#user')).toHaveValue('')
  })

  test('\\t skips non-input elements (e.g. show-password button) to reach password field', async ({ context }) => {
    // Form with a button between username and password — simulates real-world sites.
    const formWithButton = `<!doctype html><html><body>
<form id="f">
  <input id="user" type="text" name="username"/>
  <button type="button" id="toggle">Show</button>
  <input id="pass" type="password" name="password"/>
  <button type="submit">Log in</button>
</form>
<script>document.getElementById('f').onsubmit=e=>e.preventDefault()</script>
</body></html>`

    const { login: _login, portpass } = await setupAutofillTest(context)

    // Override the login page content with the button-in-the-middle form.
    const login = _login
    await login.route('/login-button-test', route =>
      route.fulfill({ contentType: 'text/html', body: formWithButton })
    )
    await login.goto('http://localhost:5173/login-button-test')

    await createRecord(portpass, {
      title: 'Button Site', username: 'alice', password: 'secret', autotype: '\\u\\t\\p',
    })

    await activateBookmarklet(login)
    await login.locator('#user').click()

    await expect(login.locator('#user')).toHaveValue('alice')
    // The "Show" button was skipped; password field should be filled.
    await expect(login.locator('#pass')).toHaveValue('secret')
  })

  test('dismiss button removes the overlay', async ({ context }) => {
    const { login, portpass } = await setupAutofillTest(context)
    await createRecord(portpass, { title: 'Site', autotype: '\\u\\p' })

    await activateBookmarklet(login)
    await login.locator('#__pp button').click()
    await expect(login.locator('#__pp')).toHaveCount(0)
  })

  test('error shown when no record is selected in Portpass', async ({ context }) => {
    const { login, portpass } = await setupAutofillTest(context)
    // Vault is open but no record is selected.

    await activateBookmarklet(login)
    await expect(login.locator('#__pp')).toContainText('Open a record')
  })

  test('record without autotype sequence uses the default and shows overlay', async ({ context }) => {
    const { login, portpass } = await setupAutofillTest(context)
    await portpass.getByRole('button', { name: 'New', exact: true }).click()
    await portpass.getByPlaceholder('e.g. Bank of America').fill('No Autotype')
    await portpass.locator('input.mono').first().fill('pass')
    // Leave autotype empty — should default to \u\t\p\n.
    await portpass.getByRole('button', { name: 'Save' }).click()
    await portpass.locator('.record-row', { hasText: 'No Autotype' }).click()

    await activateBookmarklet(login)
    // Overlay should show the record name, not an error.
    await expect(login.locator('#__pp')).toContainText('No Autotype')
    await expect(login.locator('#__pp')).toContainText('Click the field to start from')
  })

})
