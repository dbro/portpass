import { test, expect } from '@playwright/test'
import { openVault, createVault } from './helpers'

test.describe('Record write operations', () => {

  test('create new record appears in list', async ({ page }) => {
    await createVault(page)

    // On desktop the FAB is hidden; use the topbar New button
    await page.getByRole('button', { name: 'New', exact: true }).click()
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

    // Accept the browser confirm dialog
    page.on('dialog', d => d.accept())
    await page.getByRole('button', { name: 'Delete' }).click()

    await expect(page.locator('.record-row', { hasText: 'three entry 1' })).not.toBeVisible()
    await expect(page.locator('.record-screen .record-title')).not.toBeVisible()
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
