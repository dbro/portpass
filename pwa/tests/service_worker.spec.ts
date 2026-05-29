import { test, expect } from '@playwright/test'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(__dirname, '..')

test.describe('PWA service worker routing', () => {
  test('autofill pairing page is served as its own page', async ({ page }) => {
    await page.goto('/portpass/autofill.html?pair=1')

    await expect(page.getByText('Pair this autofill profile')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Create pairing token' })).toBeVisible()
    await expect(page.getByText('Vault is locked')).not.toBeVisible()
  })

  test('production service worker does not app-shell rewrite autofill.html', async () => {
    const config = fs.readFileSync(path.join(projectRoot, 'vite.config.js'), 'utf8')

    expect(config).toContain('navigateFallbackDenylist')
    expect(config).toContain('/\\/autofill\\.html(?:\\?.*)?$/')
  })
})
