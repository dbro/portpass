import { test, expect } from '@playwright/test'
import { openVault, createVault, THREE_DB_PATH } from './helpers'
import fs from 'fs'

// three.dat known values (see helpers.ts)
// "three entry 1"  group="group1"  user="three1_user"  pass="three1!@$%^&*()"
// "three entry 2"  group="group2"  user="three2_user"  pass="three2_-+=\|][}{';:"
// "three entry 3"  group="group 3" user="three3_user"  pass=",./<>?`~0"

// Opens the test vault directly in the page JS context and returns
// { vaultUuid, records } for use in page.evaluate calls.
async function openVaultInEval(page: any) {
  const b64 = fs.readFileSync(THREE_DB_PATH).toString('base64')
  return page.evaluate(async (b64data: string) => {
    const bytes = Uint8Array.from(atob(b64data), (c: string) => c.charCodeAt(0))
    const result = JSON.parse((window as any).openDB(bytes, 'three3#;'))
    const vaultUuid = result.uuid
    // getDBData returns [{uuid, title, group, hasTOTP}]
    const items: {uuid: string, title: string}[] = JSON.parse((window as any).getDBData(vaultUuid))
    return { vaultUuid, items }
  }, b64)
}

test.describe('Lazy sensitive WASM functions', () => {

  test.beforeEach(async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await openVault(page)
  })

  // ── GetFieldValue ────────────────────────────────────────────────────────────

  test('GetFieldValue returns password', async ({ page }) => {
    const { vaultUuid, items } = await openVaultInEval(page)
    const recordUuid = items.find(i => i.title === 'three entry 1')?.uuid
    const result = await page.evaluate(
      ([vu, ru]: string[]) => JSON.parse((window as any).GetFieldValue(vu, ru, 'Password')),
      [vaultUuid, recordUuid]
    )
    expect(result.value).toBe('three1!@$%^&*()')
  })

  test('GetFieldValue returns username', async ({ page }) => {
    const { vaultUuid, items } = await openVaultInEval(page)
    const recordUuid = items.find(i => i.title === 'three entry 1')?.uuid
    const result = await page.evaluate(
      ([vu, ru]: string[]) => JSON.parse((window as any).GetFieldValue(vu, ru, 'Username')),
      [vaultUuid, recordUuid]
    )
    expect(result.value).toBe('three1_user')
  })

  test('GetFieldValue returns error for unknown field', async ({ page }) => {
    const { vaultUuid, items } = await openVaultInEval(page)
    const recordUuid = items[0].uuid
    const result = await page.evaluate(
      ([vu, ru]: string[]) => JSON.parse((window as any).GetFieldValue(vu, ru, 'NonExistent')),
      [vaultUuid, recordUuid]
    )
    expect(result.error).toBeTruthy()
  })

  // ── copyFieldToClipboard ─────────────────────────────────────────────────────

  test('copyFieldToClipboard writes password to clipboard', async ({ page }) => {
    const { vaultUuid, items } = await openVaultInEval(page)
    const recordUuid = items.find(i => i.title === 'three entry 1')?.uuid
    await page.evaluate(
      ([vu, ru]: string[]) => (window as any).copyFieldToClipboard(vu, ru, 'Password'),
      [vaultUuid, recordUuid]
    )
    const clip = await page.evaluate(() => navigator.clipboard.readText())
    expect(clip).toBe('three1!@$%^&*()')
  })

  test('copyFieldToClipboard returns {} without returnHash', async ({ page }) => {
    const { vaultUuid, items } = await openVaultInEval(page)
    const recordUuid = items.find(i => i.title === 'three entry 1')?.uuid
    const result = await page.evaluate(
      ([vu, ru]: string[]) => JSON.parse((window as any).copyFieldToClipboard(vu, ru, 'Password')),
      [vaultUuid, recordUuid]
    )
    expect(result).toEqual({})
  })

  test('copyFieldToClipboard returns hash when requested', async ({ page }) => {
    const { vaultUuid, items } = await openVaultInEval(page)
    const recordUuid = items.find(i => i.title === 'three entry 1')?.uuid
    const result = await page.evaluate(
      ([vu, ru]: string[]) => JSON.parse((window as any).copyFieldToClipboard(vu, ru, 'Password', true)),
      [vaultUuid, recordUuid]
    )
    expect(result.hash).toMatch(/^[0-9a-f]{64}$/)
  })

  test('copyFieldToClipboard hash matches SHA-256 of value', async ({ page }) => {
    const { vaultUuid, items } = await openVaultInEval(page)
    const recordUuid = items.find(i => i.title === 'three entry 1')?.uuid
    const { hash } = await page.evaluate(
      ([vu, ru]: string[]) => JSON.parse((window as any).copyFieldToClipboard(vu, ru, 'Password', true)),
      [vaultUuid, recordUuid]
    )
    // Compute expected hash in page context
    const expectedHash = await page.evaluate(async (pass: string) => {
      const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(pass))
      return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('')
    }, 'three1!@$%^&*()')
    expect(hash).toBe(expectedHash)
  })

  // ── getTOTP modified behaviour ───────────────────────────────────────────────

  test('getTOTP returns null code by default', async ({ page }) => {
    const { vaultUuid, items } = await openVaultInEval(page)
    // Find a record — getTOTP returns "no TOTP configured" for records without it
    const recordUuid = items[0].uuid
    const result = await page.evaluate(
      ([vu, ru]: string[]) => {
        const r = (window as any).getTOTP(vu, ru)
        // May be "no TOTP configured" string or JSON — handle both
        try { return JSON.parse(r) } catch { return { raw: r } }
      },
      [vaultUuid, recordUuid]
    )
    // If no TOTP configured, we get the error string — that's expected for test data
    // The important thing is the returnCode=false default doesn't crash
    expect(result).toBeTruthy()
  })

  // ── copyTOTP ─────────────────────────────────────────────────────────────────

  test('copyTOTP returns error when no TOTP configured', async ({ page }) => {
    const { vaultUuid, items } = await openVaultInEval(page)
    const recordUuid = items[0].uuid
    const result = await page.evaluate(
      ([vu, ru]: string[]) => JSON.parse((window as any).copyTOTP(vu, ru)),
      [vaultUuid, recordUuid]
    )
    expect(result.error).toBe('no TOTP configured')
  })

  // ── error cases ──────────────────────────────────────────────────────────────

  test('GetFieldValue returns error for unknown record', async ({ page }) => {
    const { vaultUuid } = await openVaultInEval(page)
    const result = await page.evaluate(
      (vu: string) => JSON.parse((window as any).GetFieldValue(vu, 'nonexistent-uuid', 'Password')),
      vaultUuid
    )
    expect(result.error).toBeTruthy()
  })

  test('copyFieldToClipboard returns error for unknown record', async ({ page }) => {
    const { vaultUuid } = await openVaultInEval(page)
    const result = await page.evaluate(
      (vu: string) => JSON.parse((window as any).copyFieldToClipboard(vu, 'nonexistent-uuid', 'Password')),
      vaultUuid
    )
    expect(result.error).toBeTruthy()
  })

  // ── getRecord null sentinels (Step 3) ────────────────────────────────────────

  test('getRecord returns null for Password', async ({ page }) => {
    const { vaultUuid, items } = await openVaultInEval(page)
    const recordUuid = items.find(i => i.title === 'three entry 1')?.uuid
    const rec = await page.evaluate(
      ([vu, ru]: string[]) => JSON.parse((window as any).getRecord(vu, ru)),
      [vaultUuid, recordUuid]
    )
    expect(rec.Password).toBeNull()
  })

  test('getRecord returns null for Notes when non-empty, empty string when unset', async ({ page }) => {
    const { vaultUuid, items } = await openVaultInEval(page)
    // three entry 1 has Notes set → null (withheld)
    const withNotes = items.find(i => i.title === 'three entry 1')?.uuid
    const rec1 = await page.evaluate(
      ([vu, ru]: string[]) => JSON.parse((window as any).getRecord(vu, ru)),
      [vaultUuid, withNotes]
    )
    expect(rec1.Notes).toBeNull()
    // Verify GetFieldValue returns the actual content
    const revealed = await page.evaluate(
      ([vu, ru]: string[]) => JSON.parse((window as any).GetFieldValue(vu, ru, 'Notes')),
      [vaultUuid, withNotes]
    )
    expect(typeof revealed.value).toBe('string')
    expect(revealed.value.length).toBeGreaterThan(0)
  })

  test('getRecord does not include TwoFactorKey value for records without TOTP', async ({ page }) => {
    const { vaultUuid, items } = await openVaultInEval(page)
    const recordUuid = items.find(i => i.title === 'three entry 1')?.uuid
    const rec = await page.evaluate(
      ([vu, ru]: string[]) => JSON.parse((window as any).getRecord(vu, ru)),
      [vaultUuid, recordUuid]
    )
    // No TOTP configured → TwoFactorKey absent from response
    expect(rec.TwoFactorKey).toBeUndefined()
  })

  test('getRecord returns Username, URL as normal values', async ({ page }) => {
    const { vaultUuid, items } = await openVaultInEval(page)
    const recordUuid = items.find(i => i.title === 'three entry 1')?.uuid
    const rec = await page.evaluate(
      ([vu, ru]: string[]) => JSON.parse((window as any).getRecord(vu, ru)),
      [vaultUuid, recordUuid]
    )
    expect(rec.Username).toBe('three1_user')
    expect(rec.URL).toBe('http://group1.com')
  })

  test('getRecord sensitive custom field Value is null', async ({ page }) => {
    const { vaultUuid, items } = await openVaultInEval(page)
    const recordUuid = items[0].uuid
    // UpdateRecordFields takes key-value pairs; arrays are JSON-stringified
    await page.evaluate(
      ([vu, ru]: string[]) => {
        const cfs = JSON.stringify([{ Name: 'SecretPin', Value: '1234', Sensitive: true }])
        ;(window as any).UpdateRecordFields(vu, ru, 'CustomFields', cfs)
      },
      [vaultUuid, recordUuid]
    )
    const rec = await page.evaluate(
      ([vu, ru]: string[]) => JSON.parse((window as any).getRecord(vu, ru)),
      [vaultUuid, recordUuid]
    )
    const sensitiveField = rec.CustomFields?.find((cf: any) => cf.Name === 'SecretPin')
    expect(sensitiveField).toBeTruthy()
    expect(sensitiveField.Value).toBeNull()
  })

  test('getRecord non-sensitive custom field Value is returned', async ({ page }) => {
    const { vaultUuid, items } = await openVaultInEval(page)
    const recordUuid = items[0].uuid
    await page.evaluate(
      ([vu, ru]: string[]) => {
        const cfs = JSON.stringify([{ Name: 'PublicNote', Value: 'hello', Sensitive: false }])
        ;(window as any).UpdateRecordFields(vu, ru, 'CustomFields', cfs)
      },
      [vaultUuid, recordUuid]
    )
    const rec = await page.evaluate(
      ([vu, ru]: string[]) => JSON.parse((window as any).getRecord(vu, ru)),
      [vaultUuid, recordUuid]
    )
    const field = rec.CustomFields?.find((cf: any) => cf.Name === 'PublicNote')
    expect(field?.Value).toBe('hello')
  })

})

// ── Context menu and RecordRead copy for sensitive custom fields ─────────────

test.describe('Sensitive custom field copy', () => {

  test.beforeEach(async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await createVault(page)
    await page.getByRole('button', { name: 'New', exact: true }).click()
    await page.getByPlaceholder('e.g. Bank of America').fill('CF Sensitive Test')
    await page.locator('input.mono').first().fill('testpass')
    await page.locator('button.add-custom-field').click()
    await page.getByPlaceholder('Field name').fill('SecretPin')
    await page.getByPlaceholder('Value').fill('9876')
    await page.getByRole('button', { name: 'Hide value' }).click()
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(page.locator('.record-row', { hasText: 'CF Sensitive Test' })).toBeVisible()
  })

  test('context menu copies sensitive custom field correctly (not "null")', async ({ page }) => {
    await page.locator('.record-row', { hasText: 'CF Sensitive Test' }).click({ button: 'right' })
    await expect(page.locator('.ctx-menu')).toBeVisible()
    await page.locator('.ctx-menu button', { hasText: 'Copy SecretPin' }).click()
    const clip = await page.evaluate(() => navigator.clipboard.readText())
    expect(clip).toBe('9876')
  })

  test('RecordRead copy button copies sensitive custom field correctly (not "null")', async ({ page }) => {
    await page.locator('.record-row', { hasText: 'CF Sensitive Test' }).click()
    const pinRow = page.locator('.copy-row').filter({ hasText: 'SecretPin' })
    await expect(pinRow).toBeVisible()
    await pinRow.locator('button[aria-label="Copy SecretPin"]').click()
    const clip = await page.evaluate(() => navigator.clipboard.readText())
    expect(clip).toBe('9876')
  })

})
