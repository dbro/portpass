import { test, expect } from '@playwright/test'
import { openVault } from './helpers'

test.describe('Record list', () => {

  test('records appear in groups after unlock', async ({ page }) => {
    await openVault(page)
    await expect(page.locator('.coll-group')).toHaveCount(3)
    await expect(page.locator('.record-row')).toHaveCount(3)
  })

  test('groups are expanded by default', async ({ page }) => {
    await openVault(page)
    await expect(page.locator('.record-row').first()).toBeVisible()
  })

  test('clicking group header collapses it', async ({ page }) => {
    await openVault(page)
    const firstGroup = page.locator('.coll-group').first()
    const header     = firstGroup.locator('.coll-header')
    const rows       = firstGroup.locator('.record-row')

    await expect(rows.first()).toBeVisible()
    await header.click()
    await expect(rows.first()).not.toBeVisible()
  })

  test('clicking group header again expands it', async ({ page }) => {
    await openVault(page)
    const firstGroup = page.locator('.coll-group').first()
    const header     = firstGroup.locator('.coll-header')
    const rows       = firstGroup.locator('.record-row')

    await header.click()
    await expect(rows.first()).not.toBeVisible()
    await header.click()
    await expect(rows.first()).toBeVisible()
  })

})

test.describe('Record detail', () => {

  test('clicking a record shows its detail view', async ({ page }) => {
    await openVault(page)
    await page.locator('.record-row').first().click()
    await expect(page.locator('.record-screen')).toBeVisible()
    await expect(page.locator('.record-title')).toBeVisible()
  })

  test('record title matches list entry', async ({ page }) => {
    await openVault(page)
    const row   = page.locator('.record-row').first()
    const title = await row.locator('.record-row-title').textContent()
    await row.click()
    await expect(page.locator('.record-title')).toHaveText(title!.trim())
  })

  test('password is masked by default', async ({ page }) => {
    await openVault(page)
    await page.locator('.record-row').first().click()
    const pwValue = page.locator('.copy-row-value .mono').first()
    const text = await pwValue.textContent()
    expect(text).toMatch(/^•+$/)
  })

  test('reveal button shows password', async ({ page }) => {
    await openVault(page)
    await page.locator('.record-row').first().click()

    await page.getByLabel('Reveal password').click()
    const pwValue = page.locator('.copy-row-value .mono').first()
    const text = await pwValue.textContent()
    expect(text).not.toMatch(/^•+$/)
    expect(text!.length).toBeGreaterThan(0)
  })

  test('hiding password again masks it', async ({ page }) => {
    await openVault(page)
    await page.locator('.record-row').first().click()

    await page.getByLabel('Reveal password').click()
    await page.getByLabel('Reveal password').click()
    const pwValue = page.locator('.copy-row-value .mono').first()
    const text = await pwValue.textContent()
    expect(text).toMatch(/^•+$/)
  })

  test('switching records resets reveal state', async ({ page }) => {
    await openVault(page)
    await page.locator('.record-row').first().click()
    await page.getByLabel('Reveal password').click()

    // Click a different record
    await page.locator('.record-row').nth(1).click()
    const pwValue = page.locator('.copy-row-value .mono').first()
    const text = await pwValue.textContent()
    expect(text).toMatch(/^•+$/)
  })

})

test.describe('Clipboard copy', () => {

  test('copy button flashes the field row', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await openVault(page)
    await page.locator('.record-row').first().click()

    await page.getByLabel('Copy username').click()
    await expect(page.locator('.copy-row.clipboard-active')).toBeVisible({ timeout: 3000 })
  })

  test('Copy password button puts password on clipboard', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await openVault(page)
    // First record is "three entry 3" — password ",./<>?`~0"
    await page.locator('.record-row').first().click()
    await page.getByLabel('Copy password').click()
    const text = await page.evaluate(() => navigator.clipboard.readText())
    expect(text).toBe(',./<>?`~0')
  })

  test('Copy username button puts username on clipboard', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await openVault(page)
    // "three entry 1" — username "three1_user"
    await page.locator('.record-row', { hasText: 'three entry 1' }).click()
    await page.getByLabel('Copy username').click()
    const text = await page.evaluate(() => navigator.clipboard.readText())
    expect(text).toBe('three1_user')
  })

  test('double-click flashes the record row', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await openVault(page)

    await page.locator('.record-row').first().dblclick()
    await expect(page.locator('.record-row.clipboard-active')).toBeVisible({ timeout: 3000 })
  })

  test('clicking already-selected record flashes the record row', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await openVault(page)

    const row = page.locator('.record-row').first()
    await row.click()       // select
    await row.click()       // copy
    await expect(page.locator('.record-row.clipboard-active')).toBeVisible({ timeout: 3000 })
  })

})

test.describe('Context menu', () => {

  test('right-click shows context menu', async ({ page }) => {
    await openVault(page)
    await page.locator('.record-row').first().click({ button: 'right' })
    await expect(page.locator('.ctx-menu')).toBeVisible()
  })

  test('context menu has copy options', async ({ page }) => {
    await openVault(page)
    await page.locator('.record-row').first().click({ button: 'right' })
    const menu = page.locator('.ctx-menu')
    await expect(menu.getByText('Copy username')).toBeVisible()
    await expect(menu.getByText('Copy password')).toBeVisible()
  })

  test('context menu closes on Escape', async ({ page }) => {
    await openVault(page)
    await page.locator('.record-row').first().click({ button: 'right' })
    await expect(page.locator('.ctx-menu')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.locator('.ctx-menu')).not.toBeVisible()
  })

  test('context menu for URL record includes Visit URL', async ({ page }) => {
    await openVault(page)
    // "three entry 1" has a URL
    await page.locator('.record-row', { hasText: 'three entry 1' }).click({ button: 'right' })
    await expect(page.locator('.ctx-menu').getByText('Visit URL')).toBeVisible()
  })

})
