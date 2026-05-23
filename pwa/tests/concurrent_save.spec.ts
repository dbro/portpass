import { test, expect } from '@playwright/test'
import fs from 'fs'
import { THREE_DB_PATH } from './helpers'

// Opens the vault with a mock handle whose lastModified is controlled via
// window.__fileState.lastModified, and write attempts are counted in
// window.__fileState.writeCount.
async function openVaultMutable(page: any) {
  const b64 = fs.readFileSync(THREE_DB_PATH).toString('base64')

  await page.addInitScript((b64data: string) => {
    const bytes = Uint8Array.from(atob(b64data), c => c.charCodeAt(0))
    ;(window as any).__fileState = { lastModified: 1000000, writeCount: 0 }
    ;(window as any).showOpenFilePicker = async () => [{
      name: 'three.dat',
      getFile:           async () => new File([bytes], 'three.dat', { lastModified: (window as any).__fileState.lastModified }),
      queryPermission:   async () => 'granted',
      requestPermission: async () => 'granted',
      createWritable:    async () => ({
        write: async () => { ;(window as any).__fileState.writeCount++ },
        close: async () => {},
        abort: async () => {},
      }),
    }]
    ;(window as any).showSaveFilePicker = async () => ({
      name: 'test.psafe3',
      getFile: async () => new File([], 'test.psafe3', { lastModified: (window as any).__fileState.lastModified }),
      createWritable: async () => ({ write: async () => {}, close: async () => {}, abort: async () => {} }),
    })
  }, b64)

  await page.goto('/portpass/')
  await page.getByRole('button', { name: 'Open vault file' }).click()
  await page.getByPlaceholder('Master password').fill('three3#;')
  await page.getByRole('button', { name: 'Unlock' }).click()
  const notNow = page.getByRole('button', { name: 'Not now' })
  if (await notNow.isVisible({ timeout: 3000 }).catch(() => false)) await notNow.click()
  await expect(page.getByPlaceholder('Search vault')).toBeVisible({ timeout: 10000 })
}

async function triggerSave(page: any) {
  await page.locator('.record-row', { hasText: 'three entry 1' }).click()
  await page.getByRole('button', { name: 'Edit' }).click()
  await page.getByPlaceholder('e.g. Bank of America').fill('Renamed Entry')
  await page.getByRole('button', { name: 'Save' }).click()
  await page.waitForTimeout(300)
}

test.describe('Concurrent save protection', () => {

  test('save proceeds without dialog when file is unmodified', async ({ page }) => {
    let dialogAppeared = false
    page.on('dialog', async (dialog: any) => { dialogAppeared = true; await dialog.accept() })

    await openVaultMutable(page)
    await triggerSave(page)

    expect(dialogAppeared).toBe(false)
    const writeCount = await page.evaluate(() => (window as any).__fileState.writeCount)
    expect(writeCount).toBe(1)
  })

  test('shows conflict dialog when file modified externally', async ({ page }) => {
    let dialogMessage = ''
    page.on('dialog', async (dialog: any) => { dialogMessage = dialog.message(); await dialog.accept() })

    await openVaultMutable(page)
    await page.evaluate(() => { (window as any).__fileState.lastModified = 2000000 })
    await triggerSave(page)

    expect(dialogMessage).toContain('modified by another Portpass instance')
  })

  test('saves after user accepts conflict dialog', async ({ page }) => {
    page.on('dialog', async (dialog: any) => { await dialog.accept() })

    await openVaultMutable(page)
    await page.evaluate(() => { (window as any).__fileState.lastModified = 2000000 })
    await triggerSave(page)

    const writeCount = await page.evaluate(() => (window as any).__fileState.writeCount)
    expect(writeCount).toBe(1)
  })

  test('blocks save when user dismisses conflict dialog', async ({ page }) => {
    page.on('dialog', async (dialog: any) => { await dialog.dismiss() })

    await openVaultMutable(page)
    await page.evaluate(() => { (window as any).__fileState.lastModified = 2000000 })
    await triggerSave(page)

    const writeCount = await page.evaluate(() => (window as any).__fileState.writeCount)
    expect(writeCount).toBe(0)
  })

  test('updates tracked timestamp after save so a subsequent change is re-detected', async ({ page }) => {
    let dialogCount = 0
    page.on('dialog', async (dialog: any) => { dialogCount++; await dialog.accept() })

    await openVaultMutable(page)

    // First conflict — accept
    await page.evaluate(() => { (window as any).__fileState.lastModified = 2000000 })
    await triggerSave(page)
    expect(dialogCount).toBe(1)

    // getFile still returns 2000000 — same as what we just saved with, no new conflict
    await page.locator('.record-row', { hasText: 'Renamed Entry' }).click()
    await page.getByRole('button', { name: 'Edit' }).click()
    await page.getByPlaceholder('e.g. Bank of America').fill('Second rename')
    await page.getByRole('button', { name: 'Save' }).click()
    await page.waitForTimeout(300)
    expect(dialogCount).toBe(1)  // no new dialog

    // Bump again — third save should conflict again
    await page.evaluate(() => { (window as any).__fileState.lastModified = 3000000 })
    await page.locator('.record-row', { hasText: 'Second rename' }).click()
    await page.getByRole('button', { name: 'Edit' }).click()
    await page.getByPlaceholder('e.g. Bank of America').fill('Third rename')
    await page.getByRole('button', { name: 'Save' }).click()
    await page.waitForTimeout(300)
    expect(dialogCount).toBe(2)
  })

})
