import { Page, expect } from '@playwright/test'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname  = path.dirname(__filename)

export const THREE_DB_PATH  = path.resolve(__dirname, '../../pwsafe/test_dbs/three.dat')
export const SIMPLE_DB_PATH = path.resolve(__dirname, '../../pwsafe/test_dbs/simple.dat')

// three.dat  password: "three3#;"
//   "three entry 1"  group="group1"   user="three1_user"  pass="three1!@$%^&*()"  url="http://group1.com"
//   "three entry 2"  group="group2"   user="three2_user"  pass="three2_-+=\|][}{';:"
//   "three entry 3"  group="group 3"  user="three3_user"  pass=",./<>?`~0"        url="https://group3.com"

// simple.dat password: "password"  (one record)

export async function openVault(
  page: Page,
  dbPath = THREE_DB_PATH,
  password = 'three3#;',
) {
  // Base64 encode to avoid any JSON serialization issues with byte arrays
  const b64 = fs.readFileSync(dbPath).toString('base64')

  page.on('console', msg => {
    if (msg.type() === 'error' || msg.text().includes('decrypt') || msg.text().includes('WASM'))
      console.log('PAGE:', msg.text())
  })

  await page.addInitScript((b64data: string) => {
    const bytes = Uint8Array.from(atob(b64data), c => c.charCodeAt(0))

    ;(window as any).showOpenFilePicker = async () => [{
      name: 'three.dat',
      getFile:         async () => new File([bytes], 'three.dat'),
      queryPermission: async () => 'granted',
      createWritable:  async () => ({ write: async () => {}, close: async () => {} }),
    }]
    ;(window as any).showSaveFilePicker = async () => ({
      name: 'test.psafe3',
      createWritable: async () => ({ write: async () => {}, close: async () => {} }),
    })
  }, b64)

  await page.goto('/portpass/')
  await page.getByRole('button', { name: 'Open vault file' }).click()
  await page.getByPlaceholder('Master password').fill(password)
  await page.getByRole('button', { name: 'Unlock' }).click()
  // If the biometric offer screen appears, dismiss it
  const notNow = page.getByRole('button', { name: 'Not now' })
  if (await notNow.isVisible({ timeout: 3000 }).catch(() => false)) {
    await notNow.click()
  }
  await expect(page.getByPlaceholder('Search vault')).toBeVisible({ timeout: 10000 })
}

export async function createVault(page: Page, password = 'testpassword') {
  await page.addInitScript(() => {
    if (window.PublicKeyCredential) {
      (window.PublicKeyCredential as any).isUserVerifyingPlatformAuthenticatorAvailable =
        async () => false
    }
    ;(window as any).showSaveFilePicker = async () => ({
      name: 'new.psafe3',
      createWritable: async () => ({ write: async () => {}, close: async () => {} }),
    })
  })

  await page.goto('/portpass/')
  await page.getByRole('button', { name: 'Create one' }).click()
  await page.getByPlaceholder('Master password').fill(password)
  await page.getByRole('button', { name: 'Create vault' }).click()
  await expect(page.getByPlaceholder('Search vault')).toBeVisible({ timeout: 10000 })
}
