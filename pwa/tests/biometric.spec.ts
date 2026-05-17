import { test, expect, type Page } from '@playwright/test'
import fs from 'fs'
import { THREE_DB_PATH } from './helpers'

const THREE_B64 = fs.readFileSync(THREE_DB_PATH).toString('base64')

// ── test helpers ──────────────────────────────────────────────────────────────

// Mock WebAuthn with a fixed PRF output so enroll/unlock are deterministic.
async function setupBiometricMock(page: Page) {
  await page.addInitScript(() => {
    const PRF = new Uint8Array(32).fill(0x42)
    const CID = new Uint8Array(16).fill(0x01)

    if (window.PublicKeyCredential) {
      ;(window.PublicKeyCredential as any).isUserVerifyingPlatformAuthenticatorAvailable =
        async () => true
    }
    navigator.credentials.create = async () => ({
      rawId: CID.buffer,
      getClientExtensionResults: () => ({ prf: { results: { first: PRF.buffer } } }),
    }) as any
    navigator.credentials.get = async () => ({
      getClientExtensionResults: () => ({ prf: { results: { first: PRF.buffer } } }),
    }) as any
  })
}

async function setupThreeFilePicker(page: Page) {
  await page.addInitScript((b64: string) => {
    const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0))
    ;(window as any).showOpenFilePicker = async () => [{
      name: 'three.dat',
      getFile:           async () => new File([bytes], 'three.dat'),
      queryPermission:   async () => 'granted',
      requestPermission: async () => 'granted',
      createWritable:    async () => ({ write: async () => {}, close: async () => {}, abort: async () => {} }),
    }]
    ;(window as any).showSaveFilePicker = async () => ({
      name: 'test.psafe3',
      createWritable: async () => ({ write: async () => {}, close: async () => {}, abort: async () => {} }),
    })
  }, THREE_B64)
}

// Open three.dat, unlock, and enroll fast unlock via the offer screen.
// Leaves the dashboard visible.
async function openVaultAndEnroll(page: Page) {
  await setupBiometricMock(page)
  await setupThreeFilePicker(page)
  await page.goto('/portpass/')

  await page.getByRole('button', { name: 'Open vault file' }).click()
  await page.getByPlaceholder('Master password').fill('three3#;')
  await page.getByRole('button', { name: 'Unlock' }).click()

  await expect(page.getByText('Enable biometric/PIN unlock?')).toBeVisible({ timeout: 10000 })
  await page.getByRole('button', { name: 'Enable biometric/PIN unlock' }).click()
  await expect(page.getByPlaceholder('Search vault')).toBeVisible({ timeout: 10000 })
}

// Open three.dat, unlock, and dismiss the offer screen without enrolling.
// Leaves the dashboard visible.
async function openVaultNoEnroll(page: Page) {
  await setupBiometricMock(page)
  await setupThreeFilePicker(page)
  await page.goto('/portpass/')

  await page.getByRole('button', { name: 'Open vault file' }).click()
  await page.getByPlaceholder('Master password').fill('three3#;')
  await page.getByRole('button', { name: 'Unlock' }).click()

  await expect(page.getByText('Enable biometric/PIN unlock?')).toBeVisible({ timeout: 10000 })
  await page.getByRole('button', { name: 'Not now' }).click()
  await expect(page.getByPlaceholder('Search vault')).toBeVisible({ timeout: 10000 })
}

// Lock the vault and wait for the landing screen.
async function lockVault(page: Page) {
  await page.locator('.vault-pill').click()
  await expect(page.locator('.vault-settings-body')).toBeVisible()
  await page.getByRole('button', { name: /Lock vault/ }).click()
  await expect(page.getByRole('button', { name: 'Open vault file' })).toBeVisible({ timeout: 5000 })
}

// ── tests ─────────────────────────────────────────────────────────────────────

test.describe('Biometric/PIN unlock', () => {

  test.describe('VaultSheet modal enrollment', () => {

    test('toggle opens modal and enrollment succeeds with correct password', async ({ page }) => {
      await openVaultNoEnroll(page)

      await page.locator('.vault-pill').click()
      await expect(page.locator('.vault-settings-body')).toBeVisible()
      await page.locator('.vault-card').first().click()
      await expect(page.locator('.vault-toggle-help')).not.toHaveText('Enabled')

      // Click toggle — modal should appear
      await page.getByRole('button', { name: 'Biometric/PIN unlock' }).click()
      await expect(page.locator('.modal')).toBeVisible()
      await expect(page.getByText('Enable biometric/PIN unlock')).toBeVisible()

      // Enter password and confirm
      await page.locator('.modal').getByPlaceholder('Master password').fill('three3#;')
      await page.locator('.modal').getByRole('button', { name: 'Enable' }).click()

      // Modal closes and toggle flips on
      await expect(page.locator('.modal')).not.toBeVisible({ timeout: 10000 })
      await expect(page.locator('.vault-toggle-help')).toHaveText('Enabled')
    })

    test('cancel closes modal without enrolling', async ({ page }) => {
      await openVaultNoEnroll(page)

      await page.locator('.vault-pill').click()
      await page.locator('.vault-card').first().click()
      await page.getByRole('button', { name: 'Biometric/PIN unlock' }).click()
      await expect(page.locator('.modal')).toBeVisible()

      await page.locator('.modal').getByRole('button', { name: 'Cancel' }).click()

      await expect(page.locator('.modal')).not.toBeVisible()
      await expect(page.locator('.vault-toggle-help')).not.toHaveText('Enabled')
    })

    test('clicking backdrop closes modal without enrolling', async ({ page }) => {
      await openVaultNoEnroll(page)

      await page.locator('.vault-pill').click()
      await page.locator('.vault-card').first().click()
      await page.getByRole('button', { name: 'Biometric/PIN unlock' }).click()
      await expect(page.locator('.modal')).toBeVisible()

      await page.locator('.modal-overlay').click({ position: { x: 5, y: 5 } })

      await expect(page.locator('.modal')).not.toBeVisible()
      await expect(page.locator('.vault-toggle-help')).not.toHaveText('Enabled')
    })

    test('wrong password shows error and keeps modal open', async ({ page }) => {
      await openVaultNoEnroll(page)

      await page.locator('.vault-pill').click()
      await page.locator('.vault-card').first().click()
      await page.getByRole('button', { name: 'Biometric/PIN unlock' }).click()
      await expect(page.locator('.modal')).toBeVisible()

      await page.locator('.modal').getByPlaceholder('Master password').fill('wrongpassword')
      await page.locator('.modal').getByRole('button', { name: 'Enable' }).click()

      await expect(page.locator('.unlock-error')).toBeVisible({ timeout: 5000 })
      await expect(page.locator('.modal')).toBeVisible()
      await expect(page.locator('.vault-toggle-help')).not.toHaveText('Enabled')
    })

  })

  test('enrolled vault shows fast unlock as enabled in VaultSheet', async ({ page }) => {
    await openVaultAndEnroll(page)

    await page.locator('.vault-pill').click()
    await expect(page.locator('.vault-settings-body')).toBeVisible()
    await page.locator('.vault-card').first().click()
    await expect(page.locator('.vault-toggle-help')).toHaveText('Enabled')
  })

  test('new vault shows fast unlock as disabled when another vault is enrolled', async ({ page }) => {
    await openVaultAndEnroll(page)
    await lockVault(page)

    // Create a brand-new vault — no fast unlock enrollment for it
    await page.getByRole('button', { name: 'Create one' }).click()
    await page.getByPlaceholder('Master password').fill('newpassword')
    await page.getByRole('button', { name: 'Create vault' }).click()
    await expect(page.getByPlaceholder('Search vault')).toBeVisible({ timeout: 10000 })

    await page.locator('.vault-pill').click()
    await expect(page.locator('.vault-settings-body')).toBeVisible()
    await page.locator('.vault-card').first().click()
    await expect(page.locator('.vault-toggle-help')).not.toHaveText('Enabled')
  })

  test('stale enrollment is cleared and error shown when fast unlock password does not match', async ({ page }) => {
    await openVaultAndEnroll(page)
    await lockVault(page)

    // Re-open file — fast unlock button should appear for three.dat
    await page.getByRole('button', { name: 'Open vault file' }).click()
    await expect(page.locator('.btn-biometric')).toBeVisible({ timeout: 5000 })

    // Simulate vault password being changed after enrollment
    await page.evaluate(() => {
      ;(window as any).openDB = () => 'Wrong password or corrupt file'
    })

    await page.locator('.btn-biometric').click()

    await expect(page.locator('.unlock-error')).toContainText('out of date', { timeout: 10000 })
    await expect(page.locator('.btn-biometric')).not.toBeVisible()
  })

  test('cancelled biometric prompt does not clear enrollment', async ({ page }) => {
    await openVaultAndEnroll(page)
    await lockVault(page)

    await page.getByRole('button', { name: 'Open vault file' }).click()
    await expect(page.locator('.btn-biometric')).toBeVisible({ timeout: 5000 })

    // Simulate user cancelling the biometric prompt
    await page.evaluate(() => {
      navigator.credentials.get = async () => {
        throw Object.assign(new Error('User cancelled'), { name: 'NotAllowedError' })
      }
    })

    await page.locator('.btn-biometric').click()

    await expect(page.locator('.unlock-error')).toContainText('cancelled', { timeout: 5000 })
    await expect(page.locator('.btn-biometric')).toBeVisible()
  })

})
