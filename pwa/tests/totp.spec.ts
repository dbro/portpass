import { test, expect } from '@playwright/test'
import { createVault } from './helpers'

// Well-known base32 TOTP secret used throughout these tests
const TEST_SECRET = 'JBSWY3DPEHPK3PXP'

async function createRecordWithTOTP(page: any, secret = TEST_SECRET) {
  await page.getByRole('button', { name: 'New', exact: true }).click()
  await page.getByPlaceholder('e.g. Bank of America').fill('TOTP Test Entry')
  const pwInput = page.locator('input.mono').first()
  await pwInput.fill('testpassword')
  // Fill the TOTP secret field (password-type input after the password field)
  const totpInput = page.locator('input[placeholder="Base32 secret or otpauth:// URI"]')
  await totpInput.fill(secret)
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(page.locator('.record-row', { hasText: 'TOTP Test Entry' })).toBeVisible()
  await page.locator('.record-row', { hasText: 'TOTP Test Entry' }).click()
}

test.describe('TOTP', () => {

  test('one-time code row appears after adding a TOTP secret', async ({ page }) => {
    await createVault(page)
    await createRecordWithTOTP(page)

    await expect(page.locator('.copy-row-label', { hasText: 'One-time code' })).toBeVisible()
  })

  test('one-time code is masked by default', async ({ page }) => {
    await createVault(page)
    await createRecordWithTOTP(page)

    const codeValue = page.locator('.copy-row-value .mono').last()
    const text = await codeValue.textContent()
    // Should show dots, not digits
    expect(text?.trim()).toMatch(/^•+$/)
  })

  test('reveal toggles code from dots to digits', async ({ page }) => {
    await createVault(page)
    await createRecordWithTOTP(page)

    const totpRow = page.locator('.copy-row').filter({ hasText: 'One-time code' })
    const revealBtn = totpRow.locator('button[aria-label="Reveal code"]')
    await revealBtn.click()

    const codeValue = totpRow.locator('.copy-row-value .mono')
    const text = await codeValue.textContent()
    expect(text?.trim()).toMatch(/^\d{6}$/)
  })

  test('progress bar is visible', async ({ page }) => {
    await createVault(page)
    await createRecordWithTOTP(page)

    await expect(page.locator('.totp-bar')).toBeVisible()
    await expect(page.locator('.totp-bar-fill')).toBeVisible()
  })

  test('no one-time code row for records without TOTP', async ({ page }) => {
    await createVault(page)
    await page.getByRole('button', { name: 'New', exact: true }).click()
    await page.getByPlaceholder('e.g. Bank of America').fill('No TOTP Entry')
    await page.locator('input.mono').first().fill('pass')
    await page.getByRole('button', { name: 'Save' }).click()
    await page.locator('.record-row', { hasText: 'No TOTP Entry' }).click()

    await expect(page.locator('.copy-row-label', { hasText: 'One-time code' })).toHaveCount(0)
  })

  test('otpauth URI is parsed and one-time code row appears after save', async ({ page }) => {
    await createVault(page)
    await page.getByRole('button', { name: 'New', exact: true }).click()
    await page.getByPlaceholder('e.g. Bank of America').fill('URI Test Entry')
    await page.locator('input.mono').first().fill('pass')

    const totpInput = page.locator('input[placeholder="Base32 secret or otpauth:// URI"]')
    await totpInput.fill(`otpauth://totp/Test?secret=${TEST_SECRET}&issuer=Test&algorithm=SHA1&digits=6&period=30`)

    // No error shown
    await expect(page.locator('.totp-error')).toHaveCount(0)
    await page.getByRole('button', { name: 'Save' }).click()

    await expect(page.locator('.record-row', { hasText: 'URI Test Entry' })).toBeVisible()
    await page.locator('.record-row', { hasText: 'URI Test Entry' }).click()
    // One-time code row should appear — confirms the secret was extracted from the URI
    await expect(page.locator('.copy-row-label', { hasText: 'One-time code' })).toBeVisible()
  })

  test('HOTP URI shows error', async ({ page }) => {
    await createVault(page)
    await page.getByRole('button', { name: 'New', exact: true }).click()
    await page.getByPlaceholder('e.g. Bank of America').fill('HOTP Test')
    await page.locator('input.mono').first().fill('pass')

    const totpInput = page.locator('input[placeholder="Base32 secret or otpauth:// URI"]')
    await totpInput.fill('otpauth://hotp/Test?secret=JBSWY3DPEHPK3PXP&counter=0')

    await expect(page.locator('.totp-error')).toBeVisible()
    await expect(page.locator('.totp-error')).toContainText('HOTP')
  })

  test('unsupported algorithm URI shows error', async ({ page }) => {
    await createVault(page)
    await page.getByRole('button', { name: 'New', exact: true }).click()
    await page.getByPlaceholder('e.g. Bank of America').fill('SHA256 Test')
    await page.locator('input.mono').first().fill('pass')

    const totpInput = page.locator('input[placeholder="Base32 secret or otpauth:// URI"]')
    await totpInput.fill(`otpauth://totp/Test?secret=${TEST_SECRET}&algorithm=SHA256`)

    await expect(page.locator('.totp-error')).toBeVisible()
    await expect(page.locator('.totp-error')).toContainText('SHA256')
  })

  test('gear panel shows digits and period selectors', async ({ page }) => {
    await createVault(page)
    await page.getByRole('button', { name: 'New', exact: true }).click()
    await page.getByPlaceholder('e.g. Bank of America').fill('Gear Test')
    await page.locator('input.mono').first().fill('pass')
    await page.locator('input[placeholder="Base32 secret or otpauth:// URI"]').fill(TEST_SECRET)

    await page.locator('button[aria-label="TOTP settings"]').click()
    await expect(page.locator('.totp-gear')).toBeVisible()
    await expect(page.locator('.totp-gear select').first()).toBeVisible()
  })

  test('context menu shows copy one-time code for TOTP records', async ({ page }) => {
    await createVault(page)
    await createRecordWithTOTP(page)

    // Go back to list
    await page.locator('.record-row', { hasText: 'TOTP Test Entry' }).click({ button: 'right' })
    await expect(page.locator('.ctx-menu')).toBeVisible()
    await expect(page.locator('.ctx-menu button', { hasText: 'Copy one-time code' })).toBeVisible()
  })

  test('context menu does not show copy one-time code for non-TOTP records', async ({ page }) => {
    await createVault(page)
    await page.getByRole('button', { name: 'New', exact: true }).click()
    await page.getByPlaceholder('e.g. Bank of America').fill('Plain Entry')
    await page.locator('input.mono').first().fill('pass')
    await page.getByRole('button', { name: 'Save' }).click()

    await page.locator('.record-row', { hasText: 'Plain Entry' }).click({ button: 'right' })
    await expect(page.locator('.ctx-menu')).toBeVisible()
    await expect(page.locator('.ctx-menu button', { hasText: 'Copy one-time code' })).toHaveCount(0)
  })

  test('clearing TOTP secret removes one-time code row', async ({ page }) => {
    await createVault(page)
    await createRecordWithTOTP(page)
    await expect(page.locator('.copy-row-label', { hasText: 'One-time code' })).toBeVisible()

    await page.getByRole('button', { name: 'Edit' }).click()
    await page.locator('input[placeholder="Base32 secret or otpauth:// URI"]').fill('')
    await page.getByRole('button', { name: 'Save' }).click()

    await expect(page.locator('.copy-row-label', { hasText: 'One-time code' })).toHaveCount(0)
  })

})
