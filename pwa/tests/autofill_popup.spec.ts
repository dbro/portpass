import { test, expect, BrowserContext, Page } from '@playwright/test'

const PORTPASS_URL    = 'http://localhost:5173/portpass/'

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

// NOTE: The autofill popup query protocol (hello/query postMessage) has been removed.
// It was a legacy direct-popup path not exercised by real bookmarklets that allowed any
// opener page to bypass delegate authentication. The delegate-authenticated BroadcastChannel
// flow (autofill.html + bookmarklet.spec.ts) is the only supported autofill path.
// The autofill.html same-profile flow is covered by bookmarklet.spec.ts.
