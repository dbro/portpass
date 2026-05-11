import { test, expect } from '@playwright/test'
import { openVault, createVault } from './helpers'

async function openEditWithGenerator(page) {
  await createVault(page)
  await page.getByRole('button', { name: 'New', exact: true }).click()
  await page.getByPlaceholder('e.g. Bank of America').fill('Gen Test')
}

test.describe('Password generator — quick generate', () => {

  test('Generate button fills the password field', async ({ page }) => {
    await openEditWithGenerator(page)

    const pwInput = page.locator('input.mono').first()
    const before  = await pwInput.inputValue()

    await page.getByRole('button', { name: 'Generate' }).click()

    const after = await pwInput.inputValue()
    expect(after.length).toBeGreaterThan(0)
    expect(after).not.toBe(before)
  })

  test('Generate button produces different passwords each time', async ({ page }) => {
    await openEditWithGenerator(page)

    await page.getByRole('button', { name: 'Generate' }).click()
    const first = await page.locator('input.mono').first().inputValue()

    await page.getByRole('button', { name: 'Generate' }).click()
    const second = await page.locator('input.mono').first().inputValue()

    // Statistically near-impossible to collide
    expect(first).not.toBe(second)
  })

})

test.describe('Password generator — options screen', () => {

  test('gear icon opens generator screen', async ({ page }) => {
    await openEditWithGenerator(page)
    await page.getByLabel('Password options').click()
    await expect(page.locator('.generator')).toBeVisible()
  })

  test('generator screen has Use and Cancel buttons', async ({ page }) => {
    await openEditWithGenerator(page)
    await page.getByLabel('Password options').click()
    await expect(page.getByRole('button', { name: 'Use' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Cancel' })).toBeVisible()
  })

  test('Cancel returns to edit without changing password', async ({ page }) => {
    await openEditWithGenerator(page)
    const pwInput = page.locator('input.mono').first()
    const before  = await pwInput.inputValue()

    await page.getByLabel('Password options').click()
    await page.getByRole('button', { name: 'Cancel' }).click()

    await expect(page.locator('.generator')).not.toBeVisible()
    expect(await pwInput.inputValue()).toBe(before)
  })

  test('Use applies generated password to field', async ({ page }) => {
    await openEditWithGenerator(page)
    await page.getByLabel('Password options').click()

    const generated = await page.locator('.gen-output-value').textContent()
    await page.getByRole('button', { name: 'Use' }).click()

    await expect(page.locator('.generator')).not.toBeVisible()
    const applied = await page.locator('input.mono').first().inputValue()
    expect(applied).toBe(generated?.trim())
  })

  test('length slider changes output length', async ({ page }) => {
    await openEditWithGenerator(page)
    await page.getByLabel('Password options').click()

    const slider = page.locator('.gen-range')
    await slider.fill('20')

    const generated = await page.locator('.gen-output-value').textContent()
    expect(generated?.trim().length).toBe(20)
  })

  test('disabling all character sets produces empty output', async ({ page }) => {
    await openEditWithGenerator(page)
    await page.getByLabel('Password options').click()

    // Toggle all chips off
    for (const chip of await page.locator('.gen-chip').all()) {
      const isOn = await chip.evaluate(el => el.classList.contains('on'))
      if (isOn) await chip.click()
    }

    const generated = await page.locator('.gen-output-value').textContent()
    expect(generated?.trim()).toBe('')
  })

  test('symbol palette toggles individual characters', async ({ page }) => {
    await openEditWithGenerator(page)
    await page.getByLabel('Password options').click()

    // Symbol chips should be visible (symbols enabled by default)
    await expect(page.locator('.sym-key').first()).toBeVisible()

    // Toggle first symbol off and verify by character, not by re-querying the live locator
    const char = (await page.locator('.sym-key.on').first().textContent())!.trim()
    await page.locator('.sym-key.on').first().click()
    await expect(page.locator('.sym-key.on').filter({ hasText: char })).toHaveCount(0)

    // Regenerate several times and verify char doesn't appear
    for (let i = 0; i < 5; i++) {
      await page.getByLabel('Regenerate').click()
      const pw = await page.locator('.gen-output-value').textContent()
      expect(pw).not.toContain(char)
    }
  })

})
