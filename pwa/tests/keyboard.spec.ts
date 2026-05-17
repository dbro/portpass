import { test, expect, type Page } from '@playwright/test'
import { openVault } from './helpers'

// three.dat records (alphabetical order within groups):
//   group "group 3": "three entry 3"  url="https://group3.com"  pass=",./<>?`~0"
//   group "group1":  "three entry 1"  url="http://group1.com"   pass="three1!@$%^&*()"  user="three1_user"
//   group "group2":  "three entry 2"  (no URL)                  pass="three2_-+=\|][}{';:" user="three2_user"
//
// flatList order (groups sorted alphabetically, records within sorted alphabetically):
//   0: three entry 3  (group "group 3" sorts before "group1" because space < '1')
//   1: three entry 1
//   2: three entry 2

test.describe('Keyboard shortcuts', () => {

  test.beforeEach(async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await openVault(page)
  })

  // ── Lock ────────────────────────────────────────────────────────────────────

  test('Ctrl+L locks vault and returns to unlock screen', async ({ page }) => {
    await page.keyboard.press('ArrowDown') // moves focus off search (required — Ctrl+L blocked while search is focused)
    await page.keyboard.press('Control+l')
    await expect(page.getByRole('button', { name: 'Open vault file' })).toBeVisible({ timeout: 5000 })
  })

  // ── New record ──────────────────────────────────────────────────────────────

  test('Ctrl+= opens new record form', async ({ page }) => {
    await page.keyboard.press('ArrowDown') // move focus off search
    await page.keyboard.press('Control+=')
    await expect(page.getByPlaceholder('e.g. Bank of America')).toBeVisible()
  })

  test('Ctrl++ opens new record form', async ({ page }) => {
    await page.keyboard.press('ArrowDown') // move focus off search
    await page.keyboard.press('Control++')
    await expect(page.getByPlaceholder('e.g. Bank of America')).toBeVisible()
  })

  // ── Navigation ──────────────────────────────────────────────────────────────

  test('ArrowDown from search selects first record', async ({ page }) => {
    await expect(page.getByPlaceholder('Search vault')).toBeFocused()
    await page.keyboard.press('ArrowDown')
    await expect(page.locator('.record-title')).toBeVisible()
  })

  test('ArrowDown navigates through records', async ({ page }) => {
    await page.keyboard.press('ArrowDown') // three entry 3 (first)
    await expect(page.locator('.record-title')).toHaveText('three entry 3')
    await page.keyboard.press('ArrowDown') // three entry 1 (second)
    await expect(page.locator('.record-title')).toHaveText('three entry 1')
  })

  test('ArrowUp from first record returns focus to search', async ({ page }) => {
    await page.keyboard.press('ArrowDown') // select record 0
    await page.keyboard.press('ArrowUp')   // back to search
    await expect(page.getByPlaceholder('Search vault')).toBeFocused()
  })

  test('ArrowUp from search selects last record', async ({ page }) => {
    await expect(page.getByPlaceholder('Search vault')).toBeFocused()
    await page.keyboard.press('ArrowUp')
    await expect(page.locator('.record-title')).toContainText('three entry 2')
  })

  // ── Edit ────────────────────────────────────────────────────────────────────

  test('Ctrl+Enter opens edit form for selected record', async ({ page }) => {
    await page.keyboard.press('ArrowDown') // select first record
    await page.keyboard.press('Control+Enter')
    await expect(page.getByPlaceholder('e.g. Bank of America')).toBeVisible()
  })

  // ── Enter opens URL ─────────────────────────────────────────────────────────

  test('Enter opens URL in new tab for records with a URL', async ({ page, context }) => {
    // Select "three entry 1" which has url="http://group1.com"
    await page.keyboard.press('ArrowDown') // three entry 3 (group 3)
    await page.keyboard.press('ArrowDown') // three entry 1 (group1) — has URL

    const [newPage] = await Promise.all([
      context.waitForEvent('page'),
      page.keyboard.press('Enter'),
    ])
    expect(newPage.url()).toContain('group1.com')
    await newPage.close()
  })

  // ── Copy shortcuts ───────────────────────────────────────────────────────────

  test('Ctrl+C copies password of selected record', async ({ page }) => {
    await page.keyboard.press('ArrowDown') // select three entry 3
    await page.keyboard.press('Control+c')
    const text = await page.evaluate(() => navigator.clipboard.readText())
    expect(text).toBe(',./<>?`~0')
  })

  test('Ctrl+B copies username of selected record', async ({ page }) => {
    await page.keyboard.press('ArrowDown') // three entry 3
    await page.keyboard.press('ArrowDown') // three entry 1 — user="three1_user"
    await page.keyboard.press('Control+b')
    const text = await page.evaluate(() => navigator.clipboard.readText())
    expect(text).toBe('three1_user')
  })

  test('Ctrl+U copies URL of selected record', async ({ page }) => {
    await page.keyboard.press('ArrowDown') // three entry 3
    await page.keyboard.press('ArrowDown') // three entry 1 — url="http://group1.com"
    await page.keyboard.press('Control+u')
    const text = await page.evaluate(() => navigator.clipboard.readText())
    expect(text).toContain('group1.com')
  })

  // ── Escape key ───────────────────────────────────────────────────────────────

  test('Escape clears search query when search is focused', async ({ page }) => {
    await page.getByPlaceholder('Search vault').fill('entry')
    await expect(page.locator('.record-row')).toHaveCount(3) // all match
    await page.keyboard.press('Escape')
    await expect(page.getByPlaceholder('Search vault')).toHaveValue('')
  })

  test('Escape deselects selected record', async ({ page }) => {
    await page.locator('.record-row').first().click()
    await expect(page.locator('.record-title')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.locator('.record-title')).not.toBeVisible()
  })

  // ── Help modal ────────────────────────────────────────────────────────────────

  test('? opens help modal', async ({ page }) => {
    await page.keyboard.press('ArrowDown') // move focus off search
    await page.keyboard.press('?')
    await expect(page.locator('.help-modal')).toBeVisible()
    await expect(page.locator('.help-modal')).toContainText('Keyboard shortcuts')
  })

  test('Escape closes help modal', async ({ page }) => {
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('?')
    await expect(page.locator('.help-modal')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.locator('.help-modal')).not.toBeVisible()
  })

  // ── Collapse / expand groups ─────────────────────────────────────────────────

  test('Ctrl+- collapses all groups', async ({ page }) => {
    await page.keyboard.press('ArrowDown') // move focus off search
    await page.keyboard.press('Control+-')
    // All coll-group sections should now be closed (not have .is-open)
    const openCount = await page.locator('.coll-group.is-open').count()
    expect(openCount).toBe(0)
  })

  test('Ctrl+- expands all groups when all are collapsed', async ({ page }) => {
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Control+-') // collapse all
    await page.keyboard.press('Control+-') // expand all (all were collapsed)
    const openCount = await page.locator('.coll-group.is-open').count()
    expect(openCount).toBeGreaterThan(0)
  })

  // ── Ctrl+E ───────────────────────────────────────────────────────────────────

  test('Ctrl+E does not crash when email is not set', async ({ page }) => {
    await page.keyboard.press('ArrowDown') // select three entry 3 (no email)
    await page.keyboard.press('Control+e')
    // page remains functional — no crash
    await expect(page.getByPlaceholder('Search vault')).toBeVisible()
  })

})
