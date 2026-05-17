import { test, expect } from '@playwright/test'
import { openVault, createVault } from './helpers'

// All tests run at Desktop Chrome (1280×720) per playwright.config.ts,
// so isDesktop=true and the two-pane layout is always active.

test.describe('Desktop empty state', () => {

  test('empty vault shows prompt and nudge in right pane', async ({ page }) => {
    await createVault(page)
    // No record selected — right pane shows empty state
    await expect(page.locator('.empty-logo')).toBeVisible()
    await expect(page.locator('.empty-prompt')).toHaveText('Add your first password')
    await expect(page.locator('.empty-nudge')).toBeVisible()
  })

  test('non-empty vault shows password and group counts in right pane', async ({ page }) => {
    await openVault(page)
    // three.dat has 3 records across 3 groups — no record selected yet
    const nums = page.locator('.empty-num')
    await expect(nums.first()).toBeVisible()
    // Verify the counts row contains the expected values
    await expect(page.locator('.empty-stat').filter({ hasText: 'passwords' })).toContainText('3')
    await expect(page.locator('.empty-stat').filter({ hasText: 'groups' })).toContainText('3')
  })

  test('right pane shows last-saved time for non-empty vault', async ({ page }) => {
    await openVault(page)
    await expect(page.locator('.empty-save')).toContainText('Last saved')
  })

  test('right pane empty state disappears when a record is selected', async ({ page }) => {
    await openVault(page)
    await expect(page.locator('.record-empty')).toBeVisible()
    await page.locator('.record-row').first().click()
    await expect(page.locator('.record-empty')).not.toBeVisible()
    await expect(page.locator('.record-title')).toBeVisible()
  })

})
