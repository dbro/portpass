import { test, expect } from '@playwright/test'
import { openVault, createVault } from './helpers'

test.describe('Record write operations', () => {

  test('create new record appears in list', async ({ page }) => {
    await createVault(page)

    // On desktop the FAB is hidden; use the bottom-left New record button
    await page.getByRole('button', { name: 'New record' }).click()
    await page.getByPlaceholder('e.g. Bank of America').fill('My New Record')
    await page.getByPlaceholder('e.g. Banking').fill('Test Group')
    await page.getByPlaceholder('e.g. Bank of America').press('Tab') // move focus

    // Fill password
    const pwInput = page.locator('input.mono').first()
    await pwInput.fill('secret123')

    await page.getByRole('button', { name: 'Save' }).click()

    await expect(page.locator('.record-row', { hasText: 'My New Record' })).toBeVisible()
    await expect(page.locator('.coll-name', { hasText: 'Test Group' })).toBeVisible()
  })

  test('edit record updates list and detail', async ({ page }) => {
    await openVault(page)

    await page.locator('.record-row', { hasText: 'three entry 1' }).click()
    await page.getByRole('button', { name: 'Edit' }).click()

    const titleInput = page.getByPlaceholder('e.g. Bank of America')
    await titleInput.fill('Renamed Entry')
    await page.getByRole('button', { name: 'Save' }).click()

    await expect(page.locator('.record-row', { hasText: 'Renamed Entry' })).toBeVisible()
    await expect(page.locator('.record-title')).toHaveText('Renamed Entry')
  })

  test('delete record removes it from list', async ({ page }) => {
    await openVault(page)

    await page.locator('.record-row', { hasText: 'three entry 1' }).click()
    await page.getByRole('button', { name: 'Edit' }).click()
    await page.getByRole('button', { name: 'Delete' }).click()

    // Toast should appear with delete message
    await expect(page.locator('.toast')).toContainText('Deleting', { timeout: 2000 })

    // Record disappears from list (wait a bit for reactivity)
    await page.waitForTimeout(200)
    await expect(page.locator('.record-row', { hasText: 'three entry 1' })).toHaveCount(0)

    // Wait for undo timeout to expire and record to be permanently deleted
    await page.waitForTimeout(5500)
    await expect(page.locator('.toast')).not.toBeVisible()
  })


  test('password history appears after password change', async ({ page }) => {
    await openVault(page)

    await page.locator('.record-row', { hasText: 'three entry 1' }).click()
    await page.getByRole('button', { name: 'Edit' }).click()

    const pwInput = page.locator('input.mono').first()
    await pwInput.fill('brand-new-password')
    await page.getByRole('button', { name: 'Save' }).click()

    // Re-open edit to check history
    await page.getByRole('button', { name: 'Edit' }).click()
    await expect(page.locator('.history-toggle')).toBeVisible()
  })

})
