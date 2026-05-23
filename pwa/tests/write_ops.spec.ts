import { test, expect } from '@playwright/test'
import { openVault, createVault } from './helpers'

test.describe('Record write operations', () => {

  test('create new record appears in list', async ({ page }) => {
    await createVault(page)

    // On desktop the FAB is hidden; use the bottom-left New button
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
    await page.getByRole('button', { name: 'Edit' }).click()
    await page.getByRole('button', { name: /^Delete / }).click()

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

  test('password history shows the previous password value', async ({ page }) => {
    await openVault(page)

    await page.locator('.record-row', { hasText: 'three entry 1' }).click()
    await page.getByRole('button', { name: 'Edit' }).click()

    const pwInput = page.locator('input.mono').first()
    await pwInput.fill('brand-new-password')
    await page.getByRole('button', { name: 'Save' }).click()

    // Reveal password in detail view, then open history
    await page.getByLabel('Reveal password').click()
    await page.locator('.history-toggle').click()

    // Old password should be visible in the history list
    await expect(page.locator('.history-pw').first()).toHaveText('three1!@$%^&*()')
  })

})

test.describe('Notes reveal in edit view', () => {

  test('notes are masked when opening edit view for a record with notes', async ({ page }) => {
    await openVault(page)
    await page.locator('.record-row', { hasText: 'three entry 1' }).click()
    await page.getByRole('button', { name: 'Edit' }).click()

    await expect(page.locator('.notes-masked')).toBeVisible()
    const text = await page.locator('.notes-masked').textContent()
    expect(text).toMatch(/^•+$/)
  })

  test('reveal button loads and shows actual notes content', async ({ page }) => {
    await openVault(page)
    await page.locator('.record-row', { hasText: 'three entry 1' }).click()
    await page.getByRole('button', { name: 'Edit' }).click()

    await page.getByLabel('Reveal notes').click()

    const textarea = page.locator('textarea')
    await expect(textarea).toBeVisible()
    const value = await textarea.inputValue()
    expect(value.length).toBeGreaterThan(0)
    expect(value).not.toMatch(/^•+$/)
  })

  test('hide button returns notes to masked state', async ({ page }) => {
    await openVault(page)
    await page.locator('.record-row', { hasText: 'three entry 1' }).click()
    await page.getByRole('button', { name: 'Edit' }).click()

    await page.getByLabel('Reveal notes').click()
    await expect(page.locator('textarea')).toBeVisible()

    await page.getByLabel('Hide notes').click()
    await expect(page.locator('.notes-masked')).toBeVisible()
    await expect(page.locator('textarea')).not.toBeVisible()
  })

  test('records without notes show textarea directly with no eye icon', async ({ page }) => {
    await openVault(page)
    // three entry 2 has no notes set
    await page.locator('.record-row', { hasText: 'three entry 2' }).click()
    await page.getByRole('button', { name: 'Edit' }).click()

    await expect(page.locator('textarea')).toBeVisible()
    await expect(page.locator('.notes-masked')).not.toBeVisible()
    await expect(page.getByLabel('Reveal notes')).not.toBeVisible()
  })

})
