import { test, expect } from '@playwright/test'
import { createVault } from './helpers'

async function createRecordWithCustomField(
  page: any,
  fieldName = 'WiFi SSID',
  fieldValue = 'MyNetwork',
  sensitive = false,
) {
  await page.getByRole('button', { name: 'New', exact: true }).click()
  await page.getByPlaceholder('e.g. Bank of America').fill('CF Test Entry')
  await page.locator('input.mono').first().fill('testpassword')
  await page.locator('button.add-custom-field').click()
  await page.getByPlaceholder('Field name').fill(fieldName)
  await page.getByPlaceholder('Value').fill(fieldValue)
  if (sensitive) {
    await page.getByRole('button', { name: 'Hide value' }).click()
  }
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(page.locator('.record-row', { hasText: 'CF Test Entry' })).toBeVisible()
  await page.locator('.record-row', { hasText: 'CF Test Entry' }).click()
}

test.describe('Custom fields', () => {

  test('"Custom fields" section header visible in edit form', async ({ page }) => {
    await createVault(page)
    await page.getByRole('button', { name: 'New', exact: true }).click()
    await expect(page.locator('.field-label', { hasText: 'Custom fields' })).toBeVisible()
  })

  test('"Add custom field" button adds a name/value row', async ({ page }) => {
    await createVault(page)
    await page.getByRole('button', { name: 'New', exact: true }).click()
    await expect(page.getByPlaceholder('Field name')).toHaveCount(0)
    await page.locator('button.add-custom-field').click()
    await expect(page.getByPlaceholder('Field name')).toBeVisible()
    await expect(page.getByPlaceholder('Value')).toBeVisible()
  })

  test('custom field appears in detail view after save', async ({ page }) => {
    await createVault(page)
    await createRecordWithCustomField(page, 'Account Number', '123456789')
    await expect(page.locator('.copy-row-label', { hasText: 'Account Number' })).toBeVisible()
    const valueEl = page.locator('.copy-row').filter({ hasText: 'Account Number' }).locator('.copy-row-value')
    await expect(valueEl).toHaveText('123456789')
  })

  test('sensitive custom field is masked in detail view', async ({ page }) => {
    await createVault(page)
    await createRecordWithCustomField(page, 'PIN', '1234', true)
    const valueEl = page.locator('.copy-row').filter({ hasText: 'PIN' }).locator('.copy-row-value')
    const text = await valueEl.textContent()
    expect(text?.trim()).toMatch(/^•+$/)
  })

  test('sensitive custom field can be revealed', async ({ page }) => {
    await createVault(page)
    await createRecordWithCustomField(page, 'PIN', '1234', true)
    const pinRow = page.locator('.copy-row').filter({ hasText: 'PIN' })
    await pinRow.locator('button[aria-label="Reveal value"]').click()
    await expect(pinRow.locator('.copy-row-value')).toHaveText('1234')
  })

  test('save blocked when custom field name is empty', async ({ page }) => {
    await createVault(page)
    await page.getByRole('button', { name: 'New', exact: true }).click()
    await page.getByPlaceholder('e.g. Bank of America').fill('Test')
    await page.locator('input.mono').first().fill('pass')
    await page.locator('button.add-custom-field').click()
    await page.getByPlaceholder('Value').fill('somevalue')
    // Name is empty — save must be disabled
    await expect(page.getByRole('button', { name: 'Save' })).toBeDisabled()
  })

  test('save blocked when custom field value is empty', async ({ page }) => {
    await createVault(page)
    await page.getByRole('button', { name: 'New', exact: true }).click()
    await page.getByPlaceholder('e.g. Bank of America').fill('Test')
    await page.locator('input.mono').first().fill('pass')
    await page.locator('button.add-custom-field').click()
    await page.getByPlaceholder('Field name').fill('MyField')
    // Value is empty — save must be disabled
    await expect(page.getByRole('button', { name: 'Save' })).toBeDisabled()
  })

  test('custom field can be deleted from edit form', async ({ page }) => {
    await createVault(page)
    await page.getByRole('button', { name: 'New', exact: true }).click()
    await page.locator('button.add-custom-field').click()
    await page.getByPlaceholder('Field name').fill('ToDelete')
    await page.getByPlaceholder('Value').fill('val')
    await page.getByRole('button', { name: 'Remove field' }).click()
    await expect(page.getByPlaceholder('Field name')).toHaveCount(0)
    await expect(page.locator('button.add-custom-field')).toBeVisible()
  })

  test('"Add custom field" button hidden after 9 fields added', async ({ page }) => {
    await createVault(page)
    await page.getByRole('button', { name: 'New', exact: true }).click()
    for (let i = 0; i < 9; i++) {
      await page.locator('button.add-custom-field').click()
    }
    await expect(page.locator('button.add-custom-field')).toHaveCount(0)
  })

  test('context menu shows "Copy [fieldname]" for records with custom fields', async ({ page }) => {
    await createVault(page)
    await createRecordWithCustomField(page, 'WiFi Password', 'secret')
    await page.locator('.record-row', { hasText: 'CF Test Entry' }).click({ button: 'right' })
    await expect(page.locator('.ctx-menu')).toBeVisible()
    await expect(page.locator('.ctx-menu button', { hasText: 'Copy WiFi Password' })).toBeVisible()
  })

  test('context menu shows Ctrl+1 hint for first custom field', async ({ page }) => {
    await createVault(page)
    await createRecordWithCustomField(page, 'API Key', 'abc123')
    await page.locator('.record-row', { hasText: 'CF Test Entry' }).click({ button: 'right' })
    const menuBtn = page.locator('.ctx-menu button', { hasText: 'Copy API Key' })
    await expect(menuBtn.locator('.ctx-keys')).toContainText('1')
  })

  test('Ctrl+1 copies the first custom field value to clipboard', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await createVault(page)
    await createRecordWithCustomField(page, 'API Key', 'my-secret-token')

    // Record is already selected; press Ctrl+1
    await page.keyboard.press('Control+1')
    const text = await page.evaluate(() => navigator.clipboard.readText())
    expect(text).toBe('my-secret-token')
  })

  test('editing a record preserves existing custom fields', async ({ page }) => {
    await createVault(page)
    await createRecordWithCustomField(page, 'Security Q', 'Fluffy')
    await page.getByRole('button', { name: 'Edit' }).click()
    await expect(page.getByPlaceholder('Field name')).toHaveValue('Security Q')
    await expect(page.getByPlaceholder('Value')).toHaveValue('Fluffy')
  })

})

test.describe('Email field', () => {

  test('email input visible in edit form', async ({ page }) => {
    await createVault(page)
    await page.getByRole('button', { name: 'New', exact: true }).click()
    await expect(page.locator('input[type="email"]')).toBeVisible()
  })

  test('email shown in detail view after save', async ({ page }) => {
    await createVault(page)
    await page.getByRole('button', { name: 'New', exact: true }).click()
    await page.getByPlaceholder('e.g. Bank of America').fill('Email Test')
    await page.locator('input.mono').first().fill('pass')
    await page.locator('input[type="email"]').fill('user@example.com')
    await page.getByRole('button', { name: 'Save' }).click()
    await page.locator('.record-row', { hasText: 'Email Test' }).click()
    await expect(page.locator('.copy-row-label', { hasText: 'Email' })).toBeVisible()
    const valueEl = page.locator('.copy-row').filter({ hasText: 'Email' }).locator('.copy-row-value')
    await expect(valueEl).toHaveText('user@example.com')
  })

  test('email row not shown when email is empty', async ({ page }) => {
    await createVault(page)
    await page.getByRole('button', { name: 'New', exact: true }).click()
    await page.getByPlaceholder('e.g. Bank of America').fill('No Email')
    await page.locator('input.mono').first().fill('pass')
    await page.getByRole('button', { name: 'Save' }).click()
    await page.locator('.record-row', { hasText: 'No Email' }).click()
    await expect(page.locator('.copy-row-label', { hasText: 'Email' })).toHaveCount(0)
  })

  test('email field is included in search', async ({ page }) => {
    await createVault(page)
    await page.getByRole('button', { name: 'New', exact: true }).click()
    await page.getByPlaceholder('e.g. Bank of America').fill('Search Email Test')
    await page.locator('input.mono').first().fill('pass')
    await page.locator('input[type="email"]').fill('findme@example.com')
    await page.getByRole('button', { name: 'Save' }).click()
    await page.getByPlaceholder('Search vault').fill('findme')
    await expect(page.locator('.record-row', { hasText: 'Search Email Test' })).toBeVisible()
  })

  test('email can be edited and updated', async ({ page }) => {
    await createVault(page)
    await page.getByRole('button', { name: 'New', exact: true }).click()
    await page.getByPlaceholder('e.g. Bank of America').fill('Edit Email Test')
    await page.locator('input.mono').first().fill('pass')
    await page.locator('input[type="email"]').fill('old@example.com')
    await page.getByRole('button', { name: 'Save' }).click()
    await page.locator('.record-row', { hasText: 'Edit Email Test' }).click()
    await page.getByRole('button', { name: 'Edit', exact: true }).click()
    await page.locator('input[type="email"]').fill('new@example.com')
    await page.getByRole('button', { name: 'Save' }).click()
    const valueEl = page.locator('.copy-row').filter({ hasText: 'Email' }).locator('.copy-row-value')
    await expect(valueEl).toHaveText('new@example.com')
  })

})
