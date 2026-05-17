import { test, expect, type Page } from '@playwright/test'
import fs from 'fs'
import { openVault, THREE_DB_PATH, SIMPLE_DB_PATH } from './helpers'

const SIMPLE_BYTES = [...fs.readFileSync(SIMPLE_DB_PATH)]

async function openWithSecondary(page: Page, secondaryReadonly = false) {
  await openVault(page, THREE_DB_PATH, 'three3#;')

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

  await page.locator('.vault-pill').click()
  await expect(page.locator('.vault-settings-body')).toBeVisible()
  await page.getByRole('button', { name: 'Unlock additional vault' }).click()
  await expect(page.getByPlaceholder('Master password for this vault')).toBeVisible({ timeout: 5000 })
  await page.getByPlaceholder('Master password for this vault').fill('password')
  await page.locator('.modal .btn-primary').click()
  await expect(page.locator('.vault-pill')).toContainText('(+1)', { timeout: 8000 })
  await page.keyboard.press('Escape')
  await expect(page.getByPlaceholder('Search vault')).toBeVisible({ timeout: 3000 })
}

test.describe('VaultSheet per-vault editing', () => {

  test('editing primary vault name updates the vault card', async ({ page }) => {
    await openVault(page)
    await page.locator('.vault-pill').click()
    await expect(page.locator('.vault-settings-body')).toBeVisible()

    // Navigate to primary vault detail
    await page.locator('.vault-card').first().click()

    // Type a new name
    await page.getByPlaceholder('Optional name').fill('My Test Vault')

    // Save button appears and saves
    await page.getByRole('button', { name: 'Save' }).click()

    // Back on the main settings page — card should show the new name
    await expect(page.locator('.vault-card-name').first()).toHaveText('My Test Vault')
  })

  test('editing primary vault notes updates on save', async ({ page }) => {
    await openVault(page)
    await page.locator('.vault-pill').click()
    await page.locator('.vault-card').first().click()

    await page.getByPlaceholder('Optional description').fill('These are my notes')
    await page.getByRole('button', { name: 'Save' }).click()

    // Verify we returned to the main settings page (Save navigates back)
    await expect(page.locator('.vault-section-title', { hasText: 'VAULTS' })).toBeVisible()
  })

  test('editing secondary vault name updates the vault card', async ({ page }) => {
    await openWithSecondary(page)
    await page.locator('.vault-pill').click()
    await expect(page.locator('.vault-settings-body')).toBeVisible()

    // Navigate to secondary vault detail (last card)
    await page.locator('.vault-card').last().click()

    await page.getByPlaceholder('Optional name').fill('Family Vault')
    await page.getByRole('button', { name: 'Save' }).click()

    // Card name updated in list
    await expect(page.locator('.vault-card-name').last()).toHaveText('Family Vault')
  })

  test('Save button does not appear when no changes are made', async ({ page }) => {
    await openVault(page)
    await page.locator('.vault-pill').click()
    await page.locator('.vault-card').first().click()

    // No changes — Save should not be visible
    await expect(page.getByRole('button', { name: 'Save' })).not.toBeVisible()
  })

  test('back button returns to main settings page from per-vault detail', async ({ page }) => {
    await openVault(page)
    await page.locator('.vault-pill').click()
    await page.locator('.vault-card').first().click()

    // Should now be on per-vault detail
    const header = page.locator('.record-pane-header')
    await expect(header).toContainText('Vault')

    // Click back
    await page.locator('.record-pane-header .icon-btn').click()

    // Back on main settings
    await expect(header).toContainText('Vault settings')
  })

})

test.describe('VaultSheet read-only vault', () => {

  test('read-only notice shown in per-vault detail for read-only secondary', async ({ page }) => {
    await openWithSecondary(page, /* readonly */ true)
    await page.locator('.vault-pill').click()
    await page.locator('.vault-card').last().click()
    await expect(page.locator('.vault-ro-notice')).toBeVisible()
    await expect(page.locator('.vault-ro-notice')).toContainText('Read-only')
  })

  test('name and notes inputs hidden for read-only vault with blank name', async ({ page }) => {
    await openWithSecondary(page, /* readonly */ true)
    await page.locator('.vault-pill').click()
    await page.locator('.vault-card').last().click()

    // simple.dat has no name or notes — fields should be hidden entirely
    await expect(page.getByPlaceholder('Optional name')).not.toBeVisible()
    await expect(page.getByPlaceholder('Optional description')).not.toBeVisible()
  })

  test('read-only secondary vault shows no Save button', async ({ page }) => {
    await openWithSecondary(page, /* readonly */ true)
    await page.locator('.vault-pill').click()
    await page.locator('.vault-card').last().click()

    await expect(page.getByRole('button', { name: 'Save' })).not.toBeVisible()
  })

  test('read-only badge shown on vault card in main settings', async ({ page }) => {
    await openWithSecondary(page, /* readonly */ true)
    await page.locator('.vault-pill').click()

    // Secondary vault card should have read-only badge
    const secondaryCard = page.locator('.vault-card').last()
    await expect(secondaryCard.locator('.vault-badge-ro')).toBeVisible()
    await expect(secondaryCard.locator('.vault-badge-ro')).toContainText('READ-ONLY')
  })

})
