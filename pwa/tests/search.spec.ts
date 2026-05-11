import { test, expect } from '@playwright/test'
import { openVault } from './helpers'

// three.dat contents:
//   "three entry 1"  group="group1"   user="three1_user"  url="http://group1.com"
//   "three entry 2"  group="group2"   user="three2_user"
//   "three entry 3"  group="group 3"  user="three3_user"  url="https://group3.com"

test.describe('Search', () => {

  test('all records shown when search is empty', async ({ page }) => {
    await openVault(page)
    await expect(page.locator('.record-row')).toHaveCount(3)
  })

  test('filters by title substring', async ({ page }) => {
    await openVault(page)
    await page.getByPlaceholder('Search vault').fill('entry 1')
    await expect(page.locator('.record-row')).toHaveCount(1)
    await expect(page.locator('.record-row')).toContainText('three entry 1')
  })

  test('filters by group name', async ({ page }) => {
    await openVault(page)
    await page.getByPlaceholder('Search vault').fill('group2')
    await expect(page.locator('.record-row')).toHaveCount(1)
    await expect(page.locator('.record-row')).toContainText('three entry 2')
  })

  test('filters by username', async ({ page }) => {
    await openVault(page)
    await page.getByPlaceholder('Search vault').fill('three1_user')
    await expect(page.locator('.record-row')).toHaveCount(1)
    await expect(page.locator('.record-row')).toContainText('three entry 1')
  })

  test('filters by URL', async ({ page }) => {
    await openVault(page)
    await page.getByPlaceholder('Search vault').fill('group3.com')
    await expect(page.locator('.record-row')).toHaveCount(1)
    await expect(page.locator('.record-row')).toContainText('three entry 3')
  })

  test('multi-word search is AND — both terms must match', async ({ page }) => {
    await openVault(page)
    await page.getByPlaceholder('Search vault').fill('entry group1')
    await expect(page.locator('.record-row')).toHaveCount(1)
    await expect(page.locator('.record-row')).toContainText('three entry 1')
  })

  test('no match shows empty state', async ({ page }) => {
    await openVault(page)
    await page.getByPlaceholder('Search vault').fill('zzznotfound')
    await expect(page.locator('.record-row')).toHaveCount(0)
    await expect(page.locator('.empty-state')).toBeVisible()
  })

  test('clear button removes query and restores all records', async ({ page }) => {
    await openVault(page)
    await page.getByPlaceholder('Search vault').fill('entry 1')
    await expect(page.locator('.record-row')).toHaveCount(1)
    await page.getByLabel('Clear search').click()
    await expect(page.locator('.record-row')).toHaveCount(3)
  })

  test('search forces all groups open', async ({ page }) => {
    await openVault(page)
    // Collapse all groups first
    for (const header of await page.locator('.coll-header').all()) {
      await header.click()
    }
    await expect(page.locator('.record-row').first()).not.toBeVisible()

    await page.getByPlaceholder('Search vault').fill('entry')
    await expect(page.locator('.record-row')).toHaveCount(3)
  })

  test('match highlights appear in title', async ({ page }) => {
    await openVault(page)
    await page.getByPlaceholder('Search vault').fill('entry')
    await expect(page.locator('.hl-primary').first()).toBeVisible()
  })

})
