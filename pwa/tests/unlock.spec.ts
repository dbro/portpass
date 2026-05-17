import { test, expect } from '@playwright/test'
import fs from 'fs'
import { THREE_DB_PATH, SIMPLE_DB_PATH, openVault, createVault } from './helpers'

test.describe('Unlock screen', () => {

  test('landing page shows app name and open button', async ({ page }) => {
    await page.goto('/portpass/')
    await expect(page).toHaveTitle('Portpass')
    await expect(page.getByText('Portpass').first()).toBeVisible()
    await expect(page.getByRole('button', { name: 'Open vault file' })).toBeVisible()
  })

  test('wrong password shows error and stays on unlock screen', async ({ page }) => {
    const data = [...fs.readFileSync(THREE_DB_PATH)]
    await page.addInitScript((fileData: number[]) => {
      ;(window as any).showOpenFilePicker = async () => [{
        name: 'three.dat',
        getFile:           async () => new File([new Uint8Array(fileData)], 'three.dat'),
        queryPermission:   async () => 'granted',
        requestPermission: async () => 'granted',
        createWritable:    async () => ({ write: async () => {}, close: async () => {}, abort: async () => {} }),
      }]
    }, data)

    await page.goto('/portpass/')
    await page.getByRole('button', { name: 'Open vault file' }).click()
    await page.getByPlaceholder('Master password').fill('wrongpassword')
    await page.getByRole('button', { name: 'Unlock' }).click()

    await expect(page.locator('.unlock-error')).toBeVisible()
    await expect(page.getByPlaceholder('Search vault')).not.toBeVisible()
  })

  test('correct password opens dashboard', async ({ page }) => {
    await openVault(page)
    await expect(page.getByPlaceholder('Search vault')).toBeVisible()
    await expect(page.locator('.list-collapsible')).toBeVisible()
  })

  test('create new vault opens empty dashboard', async ({ page }) => {
    await createVault(page)
    await expect(page.getByPlaceholder('Search vault')).toBeVisible()
    await expect(page.locator('.empty-vault')).toBeVisible()
  })

  test('Enter key submits password', async ({ page }) => {
    const data = [...fs.readFileSync(THREE_DB_PATH)]
    await page.addInitScript((fileData: number[]) => {
      if (window.PublicKeyCredential) {
        (window.PublicKeyCredential as any).isUserVerifyingPlatformAuthenticatorAvailable =
          async () => false
      }
      ;(window as any).showOpenFilePicker = async () => [{
        name: 'three.dat',
        getFile:           async () => new File([new Uint8Array(fileData)], 'three.dat'),
        queryPermission:   async () => 'granted',
        requestPermission: async () => 'granted',
        createWritable:    async () => ({ write: async () => {}, close: async () => {}, abort: async () => {} }),
      }]
    }, data)

    await page.goto('/portpass/')
    await page.getByRole('button', { name: 'Open vault file' }).click()
    await page.getByPlaceholder('Master password').fill('three3#;')
    await page.getByPlaceholder('Master password').press('Enter')
    await expect(page.getByPlaceholder('Search vault')).toBeVisible({ timeout: 10000 })
  })

})
