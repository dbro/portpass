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

  test('changing primary master password updates unlock difficulty and saved bytes', async ({ page }) => {
    await openVault(page)
    await page.locator('.vault-pill').click()
    await page.locator('.vault-card').first().click()
    await page.getByRole('button', { name: 'Change master password' }).click()
    await expect(page.getByLabel('Unlock difficulty')).toHaveValue('2048')
    await expect(page.getByLabel('Unlock difficulty')).toHaveAttribute('max', '10000000')

    await page.getByPlaceholder('Current master password').fill('three3#;')
    await page.getByPlaceholder('New master password', { exact: true }).fill('new-three-pass')
    await page.getByPlaceholder('Repeat new master password').fill('new-three-pass')
    await page.getByLabel('Unlock difficulty').fill('2048')
    await page.getByRole('button', { name: 'Update password' }).click()

    await expect(page.getByRole('button', { name: 'Change master password' })).toBeVisible({ timeout: 5000 })
    await expect(page.locator('.vault-detail-line', { hasText: 'Unlock difficulty 2,048 rounds' })).toBeVisible()

    const result = await page.evaluate(() => {
      const bytes = (window as any).__lastWrittenVaultBytes
      if (!bytes) return { saved: false }
      const oldResult = (window as any).openDB(new Uint8Array(bytes), 'three3#;')
      const newResult = (window as any).openDB(new Uint8Array(bytes), 'new-three-pass')
      return { saved: true, oldResult, newResult }
    })
    expect(result.saved).toBe(true)
    expect(String(result.oldResult)).toContain('failed to decrypt')
    expect(JSON.parse(String(result.newResult)).uuid).toMatch(/^[0-9a-f]{32}$/)
  })

  test('read-only vault detail does not offer master password change', async ({ page }) => {
    await openWithSecondary(page, true)
    await page.locator('.vault-pill').click()
    await page.locator('.vault-card').last().click()

    await expect(page.locator('.vault-section-title', { hasText: 'SECURITY' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Change master password' })).not.toBeVisible()
  })

})

test.describe('VaultSheet autofill installation UI', () => {

  test('AUTOFILL section is visible on main settings page', async ({ page }) => {
    await openVault(page)
    await page.locator('.vault-pill').click()
    await expect(page.locator('.vault-section-title', { hasText: 'AUTOFILL' })).toBeVisible()
    await expect(page.getByRole('button', { name: '+ Add same-profile bookmarklet' })).not.toBeVisible()
    await page.getByRole('button', { name: '+ Create a new autofill bookmarklet' }).click()
    await expect(page.getByRole('button', { name: '+ Add same-profile bookmarklet' })).toBeVisible()
  })

  async function createBookmarklet(page) {
    await page.locator('.vault-pill').click()
    await page.getByRole('button', { name: '+ Create a new autofill bookmarklet' }).click()
    await page.getByRole('button', { name: '+ Add same-profile bookmarklet' }).click()
    // wait for key generation (chip activates once keys are ready + name is entered)
    await page.getByPlaceholder('e.g. Chrome — work profile').fill('Test')
    await expect(page.locator('.vs-bookmarklet-chip:not(.chip-inactive)')).toBeVisible({ timeout: 5000 })
  }

  test('bookmarklet chip has a javascript: href', async ({ page }) => {
    await openVault(page)
    await createBookmarklet(page)
    const href = await page.locator('.vs-bookmarklet-chip').getAttribute('href')
    expect(href).toMatch(/^javascript:/)
  })

  test('bookmarklet href contains the Portpass origin', async ({ page }) => {
    await openVault(page)
    await createBookmarklet(page)
    const href = await page.locator('.vs-bookmarklet-chip').getAttribute('href')
    expect(decodeURIComponent(href ?? '')).toContain('localhost:5173')
  })

  test('clicking the chip does not navigate away', async ({ page }) => {
    await openVault(page)
    await createBookmarklet(page)
    await page.locator('.vs-bookmarklet-chip').click()
    await expect(page.locator('.modal-title', { hasText: 'New same-profile bookmarklet' })).toBeVisible()
  })

  test('Copy link button copies the javascript: URL to clipboard', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await openVault(page)
    await createBookmarklet(page)
    await page.locator('.vs-copy-link-btn').click()
    await expect(page.locator('.vs-copy-link-btn')).toContainText('Copied!')
    const text = await page.evaluate(() => navigator.clipboard.readText())
    expect(text).toMatch(/^javascript:/)
  })

  test('Copy link button reverts to "Copy link" after 2 seconds', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await openVault(page)
    await createBookmarklet(page)
    await page.locator('.vs-copy-link-btn').click()
    await expect(page.locator('.vs-copy-link-btn')).toContainText('Copied!')
    await expect(page.locator('.vs-copy-link-btn')).toHaveText('Copy link', { timeout: 3000 })
  })

  test('modal shows name input, warning banner, and two-column install layout', async ({ page }) => {
    await openVault(page)
    await page.locator('.vault-pill').click()
    await page.getByRole('button', { name: '+ Create a new autofill bookmarklet' }).click()
    await page.getByRole('button', { name: '+ Add same-profile bookmarklet' }).click()
    await expect(page.locator('.modal-title', { hasText: 'New same-profile bookmarklet' })).toBeVisible()
    await expect(page.getByPlaceholder('e.g. Chrome — work profile')).toBeVisible()
    await expect(page.locator('.vs-install-warning')).toBeVisible()
    await expect(page.locator('.vs-install-col-drag')).toBeVisible()
    await expect(page.locator('.vs-install-col-copy')).toBeVisible()
  })

  test('chip is inactive and copy button disabled before name is entered', async ({ page }) => {
    await openVault(page)
    await page.locator('.vault-pill').click()
    await page.getByRole('button', { name: '+ Create a new autofill bookmarklet' }).click()
    await page.getByRole('button', { name: '+ Add same-profile bookmarklet' }).click()
    await expect(page.locator('.vs-bookmarklet-chip.chip-inactive')).toBeVisible({ timeout: 5000 })
    await expect(page.locator('.vs-copy-link-btn')).toBeDisabled()
    await page.getByPlaceholder('e.g. Chrome — work profile').fill('test')
    await expect(page.locator('.vs-bookmarklet-chip:not(.chip-inactive)')).toBeVisible({ timeout: 5000 })
    await expect(page.locator('.vs-copy-link-btn')).toBeEnabled()
  })

  test('"Save and Close" is disabled until a name is entered', async ({ page }) => {
    await openVault(page)
    await page.locator('.vault-pill').click()
    await page.getByRole('button', { name: '+ Create a new autofill bookmarklet' }).click()
    await page.getByRole('button', { name: '+ Add same-profile bookmarklet' }).click()
    await expect(page.locator('.vs-close-btn')).toBeDisabled()
    await page.getByPlaceholder('e.g. Chrome — work profile').fill('My bookmark')
    await expect(page.locator('.vs-close-btn')).toBeEnabled({ timeout: 5000 })
  })

  test('X button cancels without saving when chip unused', async ({ page }) => {
    await openVault(page)
    await page.locator('.vault-pill').click()
    await page.getByRole('button', { name: '+ Create a new autofill bookmarklet' }).click()
    await page.getByRole('button', { name: '+ Add same-profile bookmarklet' }).click()
    await page.locator('.vs-modal-x').click()
    await expect(page.locator('.modal-title', { hasText: 'New same-profile bookmarklet' })).not.toBeVisible()
    await expect(page.locator('.delegate-name')).not.toBeVisible()
  })

  test('globe tip disclosure expands and collapses', async ({ page }) => {
    await openVault(page)
    await createBookmarklet(page)
    await expect(page.locator('.vs-globe-tip-body')).not.toBeVisible()
    await page.locator('.vs-globe-tip-toggle').click()
    await expect(page.locator('.vs-globe-tip-body')).toBeVisible()
    await page.locator('.vs-globe-tip-toggle').click()
    await expect(page.locator('.vs-globe-tip-body')).not.toBeVisible()
  })

  test('"Save and Close" saves the delegate and dismisses the modal', async ({ page }) => {
    await openVault(page)
    await createBookmarklet(page)
    await expect(page.locator('.modal-title', { hasText: 'New same-profile bookmarklet' })).toBeVisible()
    await page.locator('.vs-close-btn').click()
    await expect(page.locator('.modal-title', { hasText: 'New same-profile bookmarklet' })).not.toBeVisible()
    await expect(page.locator('.delegate-name', { hasText: 'Test' })).toBeVisible()
    await expect(page.locator('.delegate-row', { hasText: 'Test' }).locator('.delegate-meta')).toContainText('0 autofill uses (same profile)')
  })

  test('bookmarklet is not visible on per-vault detail page', async ({ page }) => {
    await openVault(page)
    await page.locator('.vault-pill').click()
    await page.locator('.vault-card').first().click()
    await expect(page.locator('.vs-bookmarklet-chip')).not.toBeVisible()
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
