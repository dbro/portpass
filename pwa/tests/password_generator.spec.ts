import { test, expect } from '@playwright/test'
import { openVault, createVault } from './helpers'

async function openEditWithGenerator(page) {
  await createVault(page)
  await page.getByRole('button', { name: 'New', exact: true }).click()
  await page.getByPlaceholder('e.g. Bank of America').fill('Gen Test')
}

test.describe('Password generator — quick generate', () => {

  test('Refresh icon opens generator and Use fills the password field', async ({ page }) => {
    await openEditWithGenerator(page)

    const pwInput = page.locator('input.mono').first()
    const before  = await pwInput.inputValue()

    await page.getByLabel('Open password generator').click()
    await expect(page.locator('.generator')).toBeVisible()
    await page.getByRole('button', { name: 'Use' }).click()

    const after = await pwInput.inputValue()
    expect(after.length).toBeGreaterThan(0)
    expect(after).not.toBe(before)
  })

  test('Generator produces different passwords each time', async ({ page }) => {
    await openEditWithGenerator(page)

    await page.getByLabel('Open password generator').click()
    await page.locator('.gen-regen').click()
    const first = await page.locator('.gen-output-value').textContent()

    await page.locator('.gen-regen').click()
    const second = await page.locator('.gen-output-value').textContent()

    // Statistically near-impossible to collide
    expect(first).not.toBe(second)
  })

})

test.describe('Password generator — options screen', () => {

  test('refresh icon opens generator screen', async ({ page }) => {
    await openEditWithGenerator(page)
    await page.getByLabel('Open password generator').click()
    await expect(page.locator('.generator')).toBeVisible()
  })

  test('generator screen has Use and Cancel buttons', async ({ page }) => {
    await openEditWithGenerator(page)
    await page.getByLabel('Open password generator').click()
    await expect(page.getByRole('button', { name: 'Use' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Cancel' })).toBeVisible()
  })

  test('Cancel returns to edit without changing password', async ({ page }) => {
    await openEditWithGenerator(page)
    const pwInput = page.locator('input.mono').first()
    const before  = await pwInput.inputValue()

    await page.getByLabel('Open password generator').click()
    await page.getByRole('button', { name: 'Cancel' }).click()

    await expect(page.locator('.generator')).not.toBeVisible()
    expect(await pwInput.inputValue()).toBe(before)
  })

  test('Use applies generated password to field', async ({ page }) => {
    await openEditWithGenerator(page)
    await page.getByLabel('Open password generator').click()

    const generated = await page.locator('.gen-output-value').textContent()
    await page.getByRole('button', { name: 'Use' }).click()

    await expect(page.locator('.generator')).not.toBeVisible()
    const applied = await page.locator('input.mono').first().inputValue()
    expect(applied).toBe(generated?.trim())
  })

  test('length slider changes output length', async ({ page }) => {
    await openEditWithGenerator(page)
    await page.getByLabel('Open password generator').click()

    const slider = page.locator('.gen-range')
    await slider.fill('20')

    const generated = await page.locator('.gen-output-value').textContent()
    expect(generated?.trim().length).toBe(20)
  })

  test('disabling all character sets produces empty output', async ({ page }) => {
    await openEditWithGenerator(page)
    await page.getByLabel('Open password generator').click()

    // Toggle all chips off
    for (const chip of await page.locator('.gen-chip').all()) {
      const isOn = await chip.evaluate(el => el.classList.contains('on'))
      if (isOn) await chip.click()
    }

    const generated = await page.locator('.gen-output-value').textContent()
    expect(generated?.trim()).toBe('')
  })

  test('exclude characters field filters output', async ({ page }) => {
    await openEditWithGenerator(page)
    await page.getByLabel('Open password generator').click()

    // Add a character to exclude list (pick something common like 'a')
    const excludeInput = page.getByPlaceholder('e.g. 0O Il1')
    await excludeInput.fill('a')

    // Regenerate several times and verify 'a' doesn't appear
    for (let i = 0; i < 10; i++) {
      await page.getByLabel('Regenerate').click()
      const pw = await page.locator('.gen-output-value').textContent()
      expect(pw).not.toContain('a')
    }
  })

})
