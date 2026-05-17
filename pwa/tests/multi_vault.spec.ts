import { test, expect, type Page } from '@playwright/test'
import fs from 'fs'
import { THREE_DB_PATH, SIMPLE_DB_PATH, openVault } from './helpers'

// three.dat: password "three3#;" — 3 records
// simple.dat: password "password" — 1 record ("Test entry")
const SIMPLE_BYTES = [...fs.readFileSync(SIMPLE_DB_PATH)]

// ── helpers ───────────────────────────────────────────────────────────────────

// Open three.dat as primary, then unlock simple.dat as secondary via the vault sheet.
async function openWithSecondary(page: Page, secondaryReadonly = false) {
  await openVault(page, THREE_DB_PATH, 'three3#;')

  // Override file picker to return simple.dat for the secondary vault pick
  await page.evaluate(({ bytes, filename, readonly }) => {
    const handle = {
      name: filename,
      getFile:           async () => new File([new Uint8Array(bytes)], filename),
      queryPermission:   async () => 'granted',
      requestPermission: async () => 'granted',
      createWritable:    readonly
        ? async () => { throw new Error('read-only') }
        : async () => ({ write: async () => {}, close: async () => {}, abort: async () => {} }),
    }
    ;(window as any).showOpenFilePicker = async () => [handle]
  }, { bytes: SIMPLE_BYTES, filename: 'simple.dat', readonly: secondaryReadonly })

  // Open vault sheet and click unlock additional vault
  await page.locator('.vault-pill').click()
  await expect(page.locator('.vault-settings-body')).toBeVisible()
  await page.getByRole('button', { name: 'Unlock additional vault' }).click()

  // Password modal appears after file picker fires (mocked)
  await expect(page.getByPlaceholder('Master password for this vault')).toBeVisible({ timeout: 5000 })
  await page.getByPlaceholder('Master password for this vault').fill('password')
  await page.locator('.modal .btn-primary').click()

  // Wait for secondary vault to be linked — topbar shows (+1)
  await expect(page.locator('.vault-pill')).toContainText('(+1)', { timeout: 8000 })

  // Close vault sheet
  await page.keyboard.press('Escape')
  await expect(page.getByPlaceholder('Search vault')).toBeVisible({ timeout: 3000 })
}

// ── tests ─────────────────────────────────────────────────────────────────────

test.describe('Multi-vault', () => {

  test('topbar shows secondary vault count after unlocking', async ({ page }) => {
    await openWithSecondary(page)
    await expect(page.locator('.vault-pill')).toContainText('(+1)')
  })

  test('record list shows vault-level groups when secondary is open', async ({ page }) => {
    await openWithSecondary(page)
    await expect(page.locator('.coll-vault-name')).toHaveCount(2)
  })

  test('primary vault records visible in list', async ({ page }) => {
    await openWithSecondary(page)
    await expect(page.locator('.record-row', { hasText: 'three entry 1' })).toBeVisible()
  })

  test('secondary vault records visible in list', async ({ page }) => {
    await openWithSecondary(page)
    // simple.dat has 1 record: "Test entry"
    await expect(page.locator('.record-row', { hasText: 'Test entry' })).toBeVisible()
  })

  test('total record count across vaults (3 + 1 = 4 rows)', async ({ page }) => {
    await openWithSecondary(page)
    await expect(page.locator('.record-row')).toHaveCount(4)
  })

  test('cross-vault search finds records from primary vault', async ({ page }) => {
    await openWithSecondary(page)
    await page.getByPlaceholder('Search vault').fill('three')
    await expect(page.locator('.record-row', { hasText: 'three entry 1' })).toBeVisible()
    await expect(page.locator('.record-row', { hasText: 'Test entry' })).not.toBeVisible()
  })

  test('can view a record from secondary vault', async ({ page }) => {
    await openWithSecondary(page)
    await page.locator('.record-row', { hasText: 'Test entry' }).click()
    await expect(page.locator('.record-title')).toHaveText('Test entry', { timeout: 3000 })
  })

  test('locking secondary vault returns to single-vault view', async ({ page }) => {
    await openWithSecondary(page)

    await page.locator('.vault-pill').click()
    await expect(page.locator('.vault-settings-body')).toBeVisible()
    await page.locator('.vault-card').last().click()
    await page.getByRole('button', { name: 'Lock this vault' }).click()
    await page.keyboard.press('Escape')

    await expect(page.locator('.vault-pill')).not.toContainText('(+1)')
    await expect(page.locator('.coll-vault-name')).toHaveCount(0)
    // Primary vault records still accessible
    await page.locator('.record-row', { hasText: 'three entry 1' }).click()
    await expect(page.locator('.record-title')).toHaveText('three entry 1')
  })

  test('secondary vault info shown in vault sheet', async ({ page }) => {
    await openWithSecondary(page)
    await page.locator('.vault-pill').click()
    await expect(page.locator('.vault-settings-body')).toBeVisible()
    await page.locator('.vault-card').last().click()
    await expect(page.locator('.vault-file-value')).toBeVisible()
    await expect(page.locator('.vault-detail-stat-label').first()).toContainText('password')
  })

  test('read-only secondary vault shows no Edit button for its records', async ({ page }) => {
    await openWithSecondary(page, /* readonly */ true)
    await page.locator('.record-row', { hasText: 'Test entry' }).click()
    await expect(page.locator('.record-title')).toHaveText('Test entry', { timeout: 3000 })
    await expect(page.getByRole('button', { name: 'Edit' })).not.toBeVisible()
  })

  test('primary vault records remain editable when secondary is read-only', async ({ page }) => {
    await openWithSecondary(page, /* readonly */ true)
    await page.locator('.record-row', { hasText: 'three entry 1' }).click()
    await expect(page.getByRole('button', { name: 'Edit' })).toBeVisible()
  })

  test('vault sheet shows "Lock all vaults" when secondary is open', async ({ page }) => {
    await openWithSecondary(page)
    await page.locator('.vault-pill').click()
    await expect(page.locator('.vault-settings-body')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Lock all vaults' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Lock vault' })).not.toBeVisible()
  })

  test('vault selector appears in new record form when multiple RW vaults are open', async ({ page }) => {
    await openWithSecondary(page)
    await page.getByRole('button', { name: 'New', exact: true }).click()
    await expect(page.locator('.vault-select-trigger')).toBeVisible()
    // Primary vault should be selected by default
    await expect(page.locator('.vault-select-trigger')).toContainText('three.dat')
  })

  test('vault selector allows switching to secondary vault for new record', async ({ page }) => {
    await openWithSecondary(page)
    await page.getByRole('button', { name: 'New', exact: true }).click()

    // Open dropdown and pick the secondary vault
    await page.locator('.vault-select-trigger').click()
    await expect(page.locator('.vault-select-menu')).toBeVisible()
    await page.locator('.vault-select-option').last().click()

    // Dropdown closes and trigger reflects new selection
    await expect(page.locator('.vault-select-menu')).not.toBeVisible()
    await expect(page.locator('.vault-select-trigger')).toContainText('simple.dat')
  })

})
