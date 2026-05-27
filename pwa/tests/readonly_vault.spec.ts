import { test, expect, type Page } from '@playwright/test'
import fs from 'fs'
import { THREE_DB_PATH } from './helpers'

// ── helpers ──────────────────────────────────────────────────────────────────

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

// Opens three.dat via fallback file input (simulates iOS / no showOpenFilePicker).
// Expects showOpenFilePicker to already be deleted via a prior addInitScript call,
// or deletes it itself when no init scripts have been queued yet.
// Dismisses the biometric offer if it appears.
async function openFallbackVault(page: Page) {
  await page.addInitScript(() => {
    delete (window as any).showOpenFilePicker
  })
  await page.goto('/portpass/')

  const [fileChooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.getByRole('button', { name: 'Open vault file' }).click(),
  ])
  await fileChooser.setFiles(THREE_DB_PATH)

  await page.getByPlaceholder('Master password').fill('three3#;')
  await page.getByRole('button', { name: 'Unlock' }).click()

  const notNow = page.getByRole('button', { name: 'Not now' })
  if (await notNow.isVisible({ timeout: 3000 }).catch(() => false)) {
    await notNow.click()
  }

  await expect(page.getByPlaceholder('Search vault')).toBeVisible({ timeout: 10000 })
}

async function lockVault(page: Page) {
  await page.locator('.vault-pill').click()
  await expect(page.locator('.vault-settings-body')).toBeVisible()
  await page.getByRole('button', { name: /Lock vault/ }).click()
  await expect(page.getByRole('button', { name: 'Open vault file' })).toBeVisible({ timeout: 5000 })
}

// ── tests ─────────────────────────────────────────────────────────────────────

test.describe('Read-only vault (fallback file input)', () => {

  test('landing page shows read-only note when showOpenFilePicker is unavailable', async ({ page }) => {
    await page.addInitScript(() => {
      delete (window as any).showOpenFilePicker
    })
    await page.goto('/portpass/')
    await expect(page.getByText('Read-only', { exact: false })).toBeVisible()
  })

  test('records show Edit button with read-only chip', async ({ page }) => {
    await openFallbackVault(page)
    await page.locator('.record-row').first().click()
    await expect(page.getByRole('button', { name: 'Edit' })).toBeVisible()
    await expect(page.locator('.record-pane-header .ro-chip')).toBeVisible()
  })

  test('edit form shows Save as button instead of Save', async ({ page }) => {
    await openFallbackVault(page)
    await page.locator('.record-row').first().click()
    await page.getByRole('button', { name: 'Edit' }).click()
    await expect(page.getByRole('button', { name: 'Save as' })).toBeVisible()
  })

  test('edit form shows delete note for read-only vault', async ({ page }) => {
    await openFallbackVault(page)
    await page.locator('.record-row').first().click()
    await page.getByRole('button', { name: 'Edit' }).click()
    await expect(page.locator('.delete-ro-note')).toBeVisible()
  })

  test('desktop new button is visible for read-only vault', async ({ page }) => {
    await openFallbackVault(page)
    await expect(page.locator('.desktop-new-btn')).toBeVisible()
  })

  test('Save as calls showSaveFilePicker and vault becomes writable', async ({ page }) => {
    await page.addInitScript(() => {
      delete (window as any).showOpenFilePicker
      ;(window as any).showSaveFilePicker = async () => {
        ;(window as any).__savePickerCalled = true
        return {
          name: 'three-saved.psafe3',
          createWritable: async () => ({ write: async () => {}, close: async () => {}, abort: async () => {} }),
          getFile: async () => new File([], 'three-saved.psafe3', { lastModified: Date.now() }),
        }
      }
    })
    await page.goto('/portpass/')
    const [fc] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.getByRole('button', { name: 'Open vault file' }).click(),
    ])
    await fc.setFiles(THREE_DB_PATH)
    await page.getByPlaceholder('Master password').fill('three3#;')
    await page.getByRole('button', { name: 'Unlock' }).click()
    const notNow = page.getByRole('button', { name: 'Not now' })
    if (await notNow.isVisible({ timeout: 3000 }).catch(() => false)) await notNow.click()
    await expect(page.getByPlaceholder('Search vault')).toBeVisible({ timeout: 10000 })

    await page.locator('.record-row').first().click()
    await expect(page.locator('.record-pane-header .ro-chip')).toBeVisible()
    await page.getByRole('button', { name: 'Edit' }).click()
    await page.getByPlaceholder('e.g. Bank of America').fill('Saved entry')
    await page.getByRole('button', { name: 'Save as' }).click()

    // Edit closes and vault is no longer read-only after Save As
    await expect(page.getByRole('button', { name: 'Edit' })).toBeVisible({ timeout: 5000 })
    await expect(page.locator('.ro-chip')).not.toBeVisible()
    const pickerCalled = await page.evaluate(() => !!(window as any).__savePickerCalled)
    expect(pickerCalled).toBe(true)
  })

  test('triggers download when showSaveFilePicker is also unavailable', async ({ page }) => {
    await page.addInitScript(() => {
      delete (window as any).showOpenFilePicker
      delete (window as any).showSaveFilePicker
    })
    await page.goto('/portpass/')
    const [fc] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.getByRole('button', { name: 'Open vault file' }).click(),
    ])
    await fc.setFiles(THREE_DB_PATH)
    await page.getByPlaceholder('Master password').fill('three3#;')
    await page.getByRole('button', { name: 'Unlock' }).click()
    const notNow = page.getByRole('button', { name: 'Not now' })
    if (await notNow.isVisible({ timeout: 3000 }).catch(() => false)) await notNow.click()
    await expect(page.getByPlaceholder('Search vault')).toBeVisible({ timeout: 10000 })

    await page.locator('.record-row').first().click()
    await page.getByRole('button', { name: 'Edit' }).click()
    await page.getByPlaceholder('e.g. Bank of America').fill('iOS save test')

    const downloadPromise = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Save as' }).click()
    const dl = await downloadPromise
    expect(dl.suggestedFilename()).toMatch(/three\.dat$/)
  })

})

test.describe('Biometric/PIN unlock on fallback path (iOS)', () => {

  test('biometric offer appears after fallback vault unlock', async ({ page }) => {
    await setupBiometricMock(page)
    await page.addInitScript(() => {
      delete (window as any).showOpenFilePicker
    })
    await page.goto('/portpass/')

    const [fc] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.getByRole('button', { name: 'Open vault file' }).click(),
    ])
    await fc.setFiles(THREE_DB_PATH)
    await page.getByPlaceholder('Master password').fill('three3#;')
    await page.getByRole('button', { name: 'Unlock' }).click()

    await expect(page.getByText('Enable biometric/PIN unlock?')).toBeVisible({ timeout: 10000 })
  })

  test('biometric button appears on file re-selection when enrolled', async ({ page }) => {
    await setupBiometricMock(page)
    await page.addInitScript(() => {
      delete (window as any).showOpenFilePicker
    })
    await page.goto('/portpass/')

    const [fc1] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.getByRole('button', { name: 'Open vault file' }).click(),
    ])
    await fc1.setFiles(THREE_DB_PATH)
    await page.getByPlaceholder('Master password').fill('three3#;')
    await page.getByRole('button', { name: 'Unlock' }).click()
    await expect(page.getByText('Enable biometric/PIN unlock?')).toBeVisible({ timeout: 10000 })
    await page.getByRole('button', { name: 'Enable biometric/PIN unlock' }).click()
    await expect(page.getByPlaceholder('Search vault')).toBeVisible({ timeout: 10000 })

    await lockVault(page)

    // Re-select the same file — biometric button should appear
    const [fc2] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.getByRole('button', { name: 'Open vault file' }).click(),
    ])
    await fc2.setFiles(THREE_DB_PATH)

    await expect(page.locator('.btn-biometric')).toBeVisible({ timeout: 5000 })
  })

  test('biometric unlock succeeds on fallback path', async ({ page }) => {
    await setupBiometricMock(page)
    await page.addInitScript(() => {
      delete (window as any).showOpenFilePicker
    })
    await page.goto('/portpass/')

    const [fc1] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.getByRole('button', { name: 'Open vault file' }).click(),
    ])
    await fc1.setFiles(THREE_DB_PATH)
    await page.getByPlaceholder('Master password').fill('three3#;')
    await page.getByRole('button', { name: 'Unlock' }).click()
    await expect(page.getByText('Enable biometric/PIN unlock?')).toBeVisible({ timeout: 10000 })
    await page.getByRole('button', { name: 'Enable biometric/PIN unlock' }).click()
    await expect(page.getByPlaceholder('Search vault')).toBeVisible({ timeout: 10000 })

    await lockVault(page)

    const [fc2] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.getByRole('button', { name: 'Open vault file' }).click(),
    ])
    await fc2.setFiles(THREE_DB_PATH)

    await expect(page.locator('.btn-biometric')).toBeVisible({ timeout: 5000 })
    await page.locator('.btn-biometric').click()

    await expect(page.getByPlaceholder('Search vault')).toBeVisible({ timeout: 10000 })
  })

})
