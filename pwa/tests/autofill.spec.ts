import { test, expect } from '@playwright/test'
import { createVault } from './helpers'

// Helper: create a new record with an autofill sequence and open its detail view.
async function createRecordWithAutotype(page: any, autotype: string) {
  await page.getByRole('button', { name: 'New', exact: true }).click()
  await page.getByPlaceholder('e.g. Bank of America').fill('Autofill Test')
  await page.locator('input.mono').first().fill('testpassword')
  await page.locator('.autotype-input').fill(autotype)
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(page.locator('.record-row', { hasText: 'Autofill Test' })).toBeVisible()
  await page.locator('.record-row', { hasText: 'Autofill Test' }).click()
}

test.describe('Autofill sequence — edit form', () => {

  test('"Autofill sequence" field label visible in edit form', async ({ page }) => {
    await createVault(page)
    await page.getByRole('button', { name: 'New', exact: true }).click()
    await expect(page.locator('.field-label', { hasText: 'Autofill sequence' })).toBeVisible()
  })

  test('autofill input has placeholder \\u\\t\\p\\n', async ({ page }) => {
    await createVault(page)
    await page.getByRole('button', { name: 'New', exact: true }).click()
    await expect(page.locator('.autotype-input')).toHaveAttribute('placeholder', '\\u\\t\\p\\n')
  })

  test('valid sequence enables Save and shows hint', async ({ page }) => {
    await createVault(page)
    await page.getByRole('button', { name: 'New', exact: true }).click()
    await page.getByPlaceholder('e.g. Bank of America').fill('Test')
    await page.locator('input.mono').first().fill('pass')
    await page.locator('.autotype-input').fill('\\u\\t\\p\\n')
    await expect(page.locator('.autotype-hint')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Save' })).not.toBeDisabled()
  })

  test('unknown code shows warning but does not block Save', async ({ page }) => {
    await createVault(page)
    await page.getByRole('button', { name: 'New', exact: true }).click()
    await page.getByPlaceholder('e.g. Bank of America').fill('Test')
    await page.locator('input.mono').first().fill('pass')
    await page.locator('.autotype-input').fill('\\u\\x\\p')
    await expect(page.locator('.autotype-warning')).toBeVisible()
    await expect(page.locator('.autotype-warning')).toContainText('\\x')
    await expect(page.getByRole('button', { name: 'Save' })).not.toBeDisabled()
  })

  test('trailing backslash blocks Save and shows error', async ({ page }) => {
    await createVault(page)
    await page.getByRole('button', { name: 'New', exact: true }).click()
    await page.getByPlaceholder('e.g. Bank of America').fill('Test')
    await page.locator('input.mono').first().fill('pass')
    await page.locator('.autotype-input').fill('\\u\\')
    await expect(page.locator('.autotype-error')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Save' })).toBeDisabled()
  })

  test('\\f0 blocks Save and shows error', async ({ page }) => {
    await createVault(page)
    await page.getByRole('button', { name: 'New', exact: true }).click()
    await page.getByPlaceholder('e.g. Bank of America').fill('Test')
    await page.locator('input.mono').first().fill('pass')
    await page.locator('.autotype-input').fill('\\f0')
    await expect(page.locator('.autotype-error')).toBeVisible()
    await expect(page.locator('.autotype-error')).toContainText('\\f0')
    await expect(page.getByRole('button', { name: 'Save' })).toBeDisabled()
  })

  test('\\w with no digits blocks Save and shows error', async ({ page }) => {
    await createVault(page)
    await page.getByRole('button', { name: 'New', exact: true }).click()
    await page.getByPlaceholder('e.g. Bank of America').fill('Test')
    await page.locator('input.mono').first().fill('pass')
    await page.locator('.autotype-input').fill('\\w')
    await expect(page.locator('.autotype-error')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Save' })).toBeDisabled()
  })

  test('literal text in sequence is valid', async ({ page }) => {
    await createVault(page)
    await page.getByRole('button', { name: 'New', exact: true }).click()
    await page.getByPlaceholder('e.g. Bank of America').fill('Test')
    await page.locator('input.mono').first().fill('pass')
    await page.locator('.autotype-input').fill('\\u\\tabc123\\t\\p')
    await expect(page.locator('.autotype-error')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Save' })).not.toBeDisabled()
  })

  test('empty sequence shows default hint and does not block save', async ({ page }) => {
    await createVault(page)
    await page.getByRole('button', { name: 'New', exact: true }).click()
    await page.getByPlaceholder('e.g. Bank of America').fill('Test')
    await page.locator('input.mono').first().fill('pass')
    await expect(page.locator('.autotype-error')).toHaveCount(0)
    await expect(page.locator('.autotype-hint')).toContainText('Leave blank to use default')
    await expect(page.getByRole('button', { name: 'Save' })).not.toBeDisabled()
  })

  test('correcting a structural error clears it', async ({ page }) => {
    await createVault(page)
    await page.getByRole('button', { name: 'New', exact: true }).click()
    await page.getByPlaceholder('e.g. Bank of America').fill('Test')
    await page.locator('input.mono').first().fill('pass')
    await page.locator('.autotype-input').fill('\\f0')
    await expect(page.locator('.autotype-error')).toBeVisible()
    await page.locator('.autotype-input').fill('\\u\\p')
    await expect(page.locator('.autotype-error')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Save' })).not.toBeDisabled()
  })

})

test.describe('Autofill sequence — read view', () => {

  test('sequence shown in read view after save', async ({ page }) => {
    await createVault(page)
    await createRecordWithAutotype(page, '\\u\\t\\p\\n')
    await expect(page.locator('.copy-row-label', { hasText: 'Autofill sequence' })).toBeVisible()
    await expect(page.locator('.autotype-value')).toHaveText('\\u\\t\\p\\n')
  })

  test('autofill section absent when sequence is empty', async ({ page }) => {
    await createVault(page)
    await page.getByRole('button', { name: 'New', exact: true }).click()
    await page.getByPlaceholder('e.g. Bank of America').fill('No Autofill')
    await page.locator('input.mono').first().fill('testpassword')
    await page.getByRole('button', { name: 'Save' }).click()
    await page.locator('.record-row', { hasText: 'No Autofill' }).click()
    await expect(page.locator('.autotype-value')).toHaveCount(0)
  })

  test('autofill section absent after clearing sequence on edit', async ({ page }) => {
    await createVault(page)
    await createRecordWithAutotype(page, '\\u\\t\\p\\n')
    await expect(page.locator('.autotype-value')).toBeVisible()
    await page.getByRole('button', { name: 'Edit' }).click()
    await page.locator('.autotype-input').fill('')
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(page.locator('.autotype-value')).toHaveCount(0)
  })

})

test.describe('Autofill sequence — round-trip persistence', () => {

  test('autotype value preserved when re-opening edit form', async ({ page }) => {
    await createVault(page)
    await createRecordWithAutotype(page, '\\u\\t\\p\\n')
    await page.getByRole('button', { name: 'Edit' }).click()
    await expect(page.locator('.autotype-input')).toHaveValue('\\u\\t\\p\\n')
  })

  test('updated sequence reflected in read view', async ({ page }) => {
    await createVault(page)
    await createRecordWithAutotype(page, '\\u\\t\\p\\n')
    await page.getByRole('button', { name: 'Edit' }).click()
    await page.locator('.autotype-input').fill('\\u\\t\\p')
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(page.locator('.autotype-value')).toHaveText('\\u\\t\\p')
  })

  test('each valid token combination passes validation', async ({ page }) => {
    await createVault(page)
    await page.getByRole('button', { name: 'New', exact: true }).click()
    await page.getByPlaceholder('e.g. Bank of America').fill('Test')
    await page.locator('input.mono').first().fill('pass')
    for (const seq of [
      '\\u', '\\p', '\\t', '\\n', '\\m', '\\2', '\\s', '\\\\',
      '\\f', '\\f1', '\\f9',
      '\\w1', '\\w100', '\\w999', '\\W1', '\\W999',
      '\\u\\t\\p\\n', 'abc', '\\u\\tabc123\\t\\p',
    ]) {
      await page.locator('.autotype-input').fill(seq)
      await expect(page.locator('.autotype-error')).toHaveCount(0)
    }
  })

})
